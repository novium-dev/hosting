use core::fmt::{Display, Formatter};
use serde::de::{Error, Visitor};
use serde::{Deserialize, Deserializer};

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
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::String(value) => formatter.write_str(value),
            Self::U64(value) => <u64 as Display>::fmt(value, formatter),
            Self::U32(value) => <u32 as Display>::fmt(value, formatter),
            Self::U16(value) => <u16 as Display>::fmt(value, formatter),
            Self::U8(value) => <u8 as Display>::fmt(value, formatter),
            Self::Bool(value) => <bool as Display>::fmt(value, formatter),
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

            fn expecting(&self, formatter: &mut Formatter) -> core::fmt::Result {
                write!(formatter, "a string parsable to u16")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: Error,
            {
                let val: u16 = value
                    .parse()
                    .map_err(|_err| E::custom("String isn't a u16"))?;
                Ok(SerdeStringToU16Wrapper(val))
            }
        }
        deserializer.deserialize_str(StringToU16WrapperVisitor)
    }
}
