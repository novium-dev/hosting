use serde::de::{Error, Visitor};
use serde::{Deserialize, Deserializer};
use std::fmt::{Display, Formatter};

#[derive(Deserialize)]
#[serde(untagged)]
pub enum SerdePrimitive {
    String(String),
    U64(u64),
    U32(u32),
    U16(u16),
    U8(u8),
    Bool(bool),
}

impl Display for SerdePrimitive {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            SerdePrimitive::String(str) => f.write_str(str),
            SerdePrimitive::U64(i) => <u64 as Display>::fmt(i, f),
            SerdePrimitive::U32(i) => <u32 as Display>::fmt(i, f),
            SerdePrimitive::U16(i) => <u16 as Display>::fmt(i, f),
            SerdePrimitive::U8(i) => <u8 as Display>::fmt(i, f),
            SerdePrimitive::Bool(b) => <bool as Display>::fmt(b, f),
        }
    }
}

#[repr(transparent)]
pub struct SerdeStringToU16Wrapper(u16);

impl From<SerdeStringToU16Wrapper> for u16 {
    fn from(value: SerdeStringToU16Wrapper) -> Self {
        value.0
    }
}

impl<'de> Deserialize<'de> for SerdeStringToU16Wrapper {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct StringToU16WrapperVisitor;

        impl Visitor<'_> for StringToU16WrapperVisitor {
            type Value = SerdeStringToU16Wrapper;

            fn expecting(&self, formatter: &mut Formatter) -> std::fmt::Result {
                write!(formatter, "a string parsable to u16")
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: Error,
            {
                let val: u16 = v.parse().map_err(|_err| E::custom("String isn't a u16"))?;
                Ok(SerdeStringToU16Wrapper(val))
            }
        }
        deserializer.deserialize_str(StringToU16WrapperVisitor)
    }
}