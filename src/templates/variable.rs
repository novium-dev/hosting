#![allow(unused)]

use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde::{Serialize, Serializer};
use serde_json::Value;
use std::borrow::Borrow;
use std::collections::HashSet;
use std::fmt::Debug;

#[derive(Debug, Serialize, Default)]
pub struct VariablePayload {
    pub groups: Vec<VariableGroup>,
    pub data: Vec<Value>,
}

#[derive(Debug, Serialize)]
pub struct VariableGroup {
    pub(crate) name: Option<String>,
    pub(crate) variables: Vec<VariableField>,
}

#[derive(Debug, Serialize)]
pub struct VariableField {
    pub(crate) id: String,
    pub(crate) current: Option<String>,
    pub(crate) data: VariableType,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum VariableType {
    StaticSet(IndexSet<String>),
    Checkbox { label: String },
    Hierarchy { field_index: u8, data_index: u8 },
    Regex { regex: String },
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum VariableContent {
    NumberRange {
        prefix: Option<String>,
        range_start: u16,
        range_end: u16,
        exclude: HashSet<u16>,
    },
    StringSet {
        content: IndexSet<String>,
    },
    Disabled {},
}

type VariableMapFunction<'a, const LAYERS: usize, T, E> =
Box<dyn Fn(T) -> Vec<([String; LAYERS], E)> + 'a>;

pub struct VariableDataBuilder<'a, const LAYERS: usize, T: Clone + 'a, E: 'a> {
    base: Vec<T>,
    current: VariableMapFunction<'a, LAYERS, T, E>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum VariableDataBuilderRecursiveMapEntry {
    Last(VariableContent),
    Recursive(IndexMap<String, VariableDataBuilderRecursiveMapEntry>),
}

impl VariableDataBuilderRecursiveMapEntry {
    fn map(&mut self) -> &mut IndexMap<String, VariableDataBuilderRecursiveMapEntry> {
        if let VariableDataBuilderRecursiveMapEntry::Recursive(map) = self {
            map
        } else {
            unreachable!()
        }
    }
}

impl<'a, T: Clone + 'a> VariableDataBuilder<'a, 0, T, T> {
    pub fn new(base: Vec<T>) -> Self {
        Self {
            base,
            current: Box::new(|t| vec![([], t.clone())]),
        }
    }
}

impl<'a, const LAYERS: usize, T: Clone + 'a> VariableDataBuilder<'a, LAYERS, T, VariableContent> {
    pub fn into_data(self) -> Value {
        let mut data: Vec<([String; LAYERS], VariableContent)> = Vec::new();
        for base in self.base {
            data.extend((self.current)(base));
        }

        let mut map: IndexMap<String, VariableDataBuilderRecursiveMapEntry> = IndexMap::new();
        for (keys, content) in data {
            let mut current = &mut map;
            for (index, key) in keys.iter().enumerate() {
                if (index + 1) == keys.len() {
                    current.insert(
                        key.clone(),
                        VariableDataBuilderRecursiveMapEntry::Last(content),
                    );
                    break;
                } else {
                    if !current.contains_key(key) {
                        current.insert(
                            key.clone(),
                            VariableDataBuilderRecursiveMapEntry::Recursive(IndexMap::new()),
                        );
                    }
                    current = current.get_mut(key).unwrap().map();
                }
            }
        }
        serde_json::to_value(map).unwrap()
    }
}

impl<'a, const LAYERS: usize, T: Clone + 'a, E: 'a> VariableDataBuilder<'a, LAYERS, T, E> {
    pub fn layer<const LAYERS2: usize, F: Fn(&E) -> Vec<(String, G)> + 'a, G>(
        self,
        f: F,
    ) -> VariableDataBuilder<'a, LAYERS2, T, G> {
        let old_current = self.current;
        VariableDataBuilder {
            base: self.base,
            current: Box::new(move |v| {
                let mut result = Vec::new();
                for (vec, val) in old_current(v) {
                    for (str, obj) in f(&val) {
                        let vec2: [String; LAYERS2] = std::array::from_fn(|i| {
                            if i == LAYERS {
                                str.clone()
                            } else {
                                vec[i].clone()
                            }
                        });
                        result.push((vec2, obj));
                    }
                }

                result
            }),
        }
    }

    pub fn layer_impl<const LAYERS2: usize, F: Fn(&E) -> Vec<G> + 'a, G: ToString>(
        self,
        f: F,
    ) -> VariableDataBuilder<'a, LAYERS2, T, G> {
        self.layer(move |e| {
            let val = f(e);
            val.into_iter().map(|val| (val.to_string(), val)).collect()
        })
    }
}

impl<'a, T: Clone + 'a, E: 'a> VariableDataBuilder<'a, 0, T, E> {
    pub fn layer_base_impl(self) -> VariableDataBuilder<'a, 1, T, E>
    where
        E: Clone + ToString,
    {
        self.layer_impl(|obj| vec![obj.clone()])
    }
}

pub struct VariableGroupBuilder(VariableGroup);

impl VariableGroupBuilder {
    pub fn new(name: Option<impl Into<String>>) -> Self {
        Self(VariableGroup {
            name: name.map(|opt| opt.into()),
            variables: Vec::new(),
        })
    }

    pub fn static_variable(
        mut self,
        id: impl Into<String>,
        current: Option<impl Into<String>>,
        values: IndexSet<impl Into<String>>,
    ) -> Self {
        let values: IndexSet<_> = values.into_iter().map(|str| str.into()).collect();
        let current = current.map(|opt| opt.into());
        #[cfg(debug_assertions)]
        if let Some(ref current) = current {
            if !values.contains(current) {
                panic!(
                    "Invalid current value! Available: {:?}, Current: {:?}",
                    values, current
                );
            }
        }
        self.0.variables.push(VariableField {
            id: id.into(),
            current,
            data: VariableType::StaticSet(values),
        });
        self
    }

    pub fn checkbox_variable(
        mut self,
        id: impl Into<String>,
        current: Option<bool>,
        label: String,
    ) -> Self {
        self.0.variables.push(VariableField {
            id: id.into(),
            current: current.map(|b| b.to_string()),
            data: VariableType::Checkbox { label },
        });
        self
    }

    pub fn hierarchy_variable(
        mut self,
        id: impl Into<String>,
        current: Option<impl Into<String>>,
        index: u8,
        data: u8,
    ) -> Self {
        self.0.variables.push(VariableField {
            id: id.into(),
            current: current.map(|opt| opt.into()),
            data: VariableType::Hierarchy {
                field_index: index,
                data_index: data,
            },
        });
        self
    }

    pub fn regex_variable(
        mut self,
        id: impl Into<String>,
        current: Option<impl Into<String>>,
        regex: impl Into<String>,
        placeholder: impl Into<String>,
    ) -> Self {
        let regex = regex.into();
        #[cfg(debug_assertions)]
        {
            if Regex::new(&regex).is_err() {
                panic!("Invalid regex value: {:?}", regex);
            }
        }
        self.0.variables.push(VariableField {
            id: id.into(),
            current: current.map(|opt| opt.into()),
            data: VariableType::Regex { regex },
        });
        self
    }

    pub fn into_group(self) -> VariableGroup {
        self.0
    }
}

#[derive(Default)]
pub struct VariableBuilder(VariablePayload);

impl VariableBuilder {
    pub fn data<const LAYERS: usize, T: Clone>(
        mut self,
        data: VariableDataBuilder<'_, LAYERS, T, VariableContent>,
    ) -> Self {
        self.0.data.push(data.into_data());
        self
    }

    pub fn group(mut self, group: VariableGroupBuilder) -> Self {
        self.0.groups.push(group.into_group());
        self
    }

    pub fn into_payload(self) -> VariablePayload {
        #[cfg(debug_assertions)]
        {
            for group in &self.0.groups {
                for variable in &group.variables {
                    if let VariableType::Hierarchy {
                        field_index,
                        data_index,
                    } = variable.data
                    {
                        if (data_index as usize >= self.0.data.len()) {
                            panic!(
                                "Hierarchy field does exist, but its out of range: {:?} {:?}",
                                self.0.data, group
                            );
                        }
                    }
                }
            }
        }
        self.0
    }
}