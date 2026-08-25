use core::fmt::Debug;
use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Serialize, Deserialize, Default, utoipa::ToSchema)]
pub struct VariablePayload {
    pub groups: Vec<VariableGroup>,
    pub data: Vec<Value>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct VariableGroup {
    pub(crate) name: Option<String>,
    pub(crate) variables: Vec<VariableField>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct VariableField {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) current: Option<String>,
    pub(crate) data: VariableType,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(untagged)]
pub enum VariableType {
    StaticSet(IndexSet<String>),
    Checkbox {
        label: String,
    },
    Hierarchy {
        field_index: u8,
        data_index: u8,
    },
    Regex {
        regex: String,
        placeholder: String,
        secret: bool,
    },
}

#[derive(Debug, Serialize, Deserialize)]
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
    #[expect(
        clippy::empty_enum_variants_with_brackets,
        reason = "to ensure we don't confuse serde"
    )]
    Disabled {},
}

type VariableMapFunction<'a, const LAYERS: usize, T, E> =
    Box<dyn Fn(T) -> Vec<([String; LAYERS], E)> + 'a>;

pub struct VariableDataBuilder<'a, const LAYERS: usize, T: Clone + 'a, E: 'a> {
    base: Vec<T>,
    current: VariableMapFunction<'a, LAYERS, T, E>,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum VariableDataBuilderRecursiveMapEntry {
    Last(VariableContent),
    Recursive(IndexMap<String, Self>),
}

impl VariableDataBuilderRecursiveMapEntry {
    fn map(&mut self) -> &mut IndexMap<String, Self> {
        if let Self::Recursive(map) = self {
            map
        } else {
            unreachable!()
        }
    }
}

#[expect(
    clippy::mismatching_type_param_order,
    reason = "false positive, param used multiple times"
)]
impl<'a, T: Clone + 'a> VariableDataBuilder<'a, 0, T, T> {
    pub fn new(base: Vec<T>) -> Self {
        Self {
            base,
            current: Box::new(|data| vec![([], data)]),
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
                }
                current = current
                    .entry(key.clone())
                    .or_insert_with(|| {
                        VariableDataBuilderRecursiveMapEntry::Recursive(IndexMap::new())
                    })
                    .map();
            }
        }
        serde_json::to_value(map).expect("Unable to serialize variable to json")
    }
}

impl<'a, const LAYERS: usize, T: Clone + 'a, E: 'a> VariableDataBuilder<'a, LAYERS, T, E> {
    pub fn layer<const LAYERS2: usize, F: Fn(&E) -> Vec<(String, G)> + 'a, G>(
        self,
        func: F,
    ) -> VariableDataBuilder<'a, LAYERS2, T, G> {
        let old_current = self.current;
        VariableDataBuilder {
            base: self.base,
            current: Box::new(move |value| {
                let mut result = Vec::new();
                for (vec, val) in old_current(value) {
                    for (str, obj) in func(&val) {
                        let vec2: [String; LAYERS2] = core::array::from_fn(|i| {
                            vec.get(i).map_or_else(|| str.clone(), String::clone)
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
        func: F,
    ) -> VariableDataBuilder<'a, LAYERS2, T, G> {
        self.layer(move |data| {
            let val = func(data);
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
            name: name.map(Into::into),
            variables: Vec::new(),
        })
    }

    pub fn static_variable(
        mut self,
        id: impl Into<String>,
        name: impl Into<String>,
        current: Option<impl Into<String>>,
        values: IndexSet<impl Into<String>>,
    ) -> Self {
        let values: IndexSet<_> = values.into_iter().map(Into::into).collect();
        let current = current.map(Into::into);
        #[cfg(debug_assertions)]
        if let Some(ref current) = current {
            assert!(
                values.contains(current),
                "Invalid current value! Available: {values:?}, Current: {current:?}"
            );
        }
        self.0.variables.push(VariableField {
            id: id.into(),
            name: name.into(),
            current,
            data: VariableType::StaticSet(values),
        });
        self
    }

    pub fn checkbox_variable(
        mut self,
        id: impl Into<String>,
        name: impl Into<String>,
        current: Option<bool>,
        label: String,
    ) -> Self {
        self.0.variables.push(VariableField {
            id: id.into(),
            name: name.into(),
            current: current.map(|value| value.to_string()),
            data: VariableType::Checkbox { label },
        });
        self
    }

    pub fn hierarchy_variable(
        mut self,
        id: impl Into<String>,
        name: impl Into<String>,
        current: Option<impl Into<String>>,
        index: u8,
        data: u8,
    ) -> Self {
        self.0.variables.push(VariableField {
            id: id.into(),
            name: name.into(),
            current: current.map(Into::into),
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
        name: impl Into<String>,
        current: Option<impl Into<String>>,
        regex: impl Into<String>,
        placeholder: impl Into<String>,
        secret: bool,
    ) -> Self {
        let regex = regex.into();
        debug_assert!(Regex::new(&regex).is_ok(), "Invalid regex value: {regex:?}");
        self.0.variables.push(VariableField {
            id: id.into(),
            name: name.into(),
            current: current.map(Into::into),
            data: VariableType::Regex {
                regex,
                placeholder: placeholder.into(),
                secret,
            },
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
                    if let VariableType::Hierarchy { data_index, .. } = variable.data {
                        assert!(
                            (data_index as usize) < self.0.data.len(),
                            "Hierarchy field does exist, but its out of range: {:?} {group:?}",
                            self.0.data
                        );
                    }
                }
            }
        }
        self.0
    }
}
