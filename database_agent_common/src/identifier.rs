use arrayvec::ArrayString;
use core::fmt::{Display, Formatter};
use core::marker::PhantomData;
use core::str::FromStr;
use serde::de::Visitor;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::borrow::Cow;
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Schema, Type};
use utoipa::{PartialSchema, ToSchema};

pub const LABEL_MIN_LENGTH: usize = 2;
pub const LABEL_MAX_LENGTH: usize = 23;

pub trait IdentifierPrefix {
    const PREFIX: char;
    const SCHEMA_NAME: &'static str;
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
pub struct UserPrefix;

impl IdentifierPrefix for UserPrefix {
    const PREFIX: char = 'u';
    const SCHEMA_NAME: &'static str = "UserIdentifier";
}

pub type UserIdentifier = StructuredIdentifier<UserPrefix>;

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
pub struct StructuredIdentifier<P: IdentifierPrefix> {
    short_uuid: u32,
    label: ArrayString<LABEL_MAX_LENGTH>,
    marker: PhantomData<P>,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum IdentifierError {
    LabelNotAlphanumeric,
    LabelTooLong,
    LabelTooShort,
    MissingPrefix,
    MissingSeparator,
    ShortUuidInvalid,
}

impl Display for IdentifierError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(match *self {
            Self::LabelNotAlphanumeric => "the label part must be ascii alphanumeric",
            Self::LabelTooLong => "the label part is too long",
            Self::LabelTooShort => "the label part is too short",
            Self::MissingPrefix => "the identifier is missing its prefix",
            Self::MissingSeparator => "the identifier is missing its separator",
            Self::ShortUuidInvalid => "the identifier carries an invalid short uuid",
        })
    }
}

impl core::error::Error for IdentifierError {}

impl<P: IdentifierPrefix> StructuredIdentifier<P> {
    pub fn from_parts(short_uuid: u32, label: &str) -> Result<Self, IdentifierError> {
        if label.len() < LABEL_MIN_LENGTH {
            return Err(IdentifierError::LabelTooShort);
        }
        if !label.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
            return Err(IdentifierError::LabelNotAlphanumeric);
        }

        Ok(Self {
            short_uuid,
            label: ArrayString::from(label).map_err(|_err| IdentifierError::LabelTooLong)?,
            marker: PhantomData,
        })
    }

    #[must_use]
    pub const fn short_uuid(&self) -> u32 {
        self.short_uuid
    }

    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }
}

impl<P: IdentifierPrefix> Display for StructuredIdentifier<P> {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        write!(
            formatter,
            "{}{:08x}_{}",
            P::PREFIX,
            self.short_uuid,
            self.label()
        )
    }
}

impl<P: IdentifierPrefix> FromStr for StructuredIdentifier<P> {
    type Err = IdentifierError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let trimmed = value
            .strip_prefix(P::PREFIX)
            .ok_or(IdentifierError::MissingPrefix)?;
        let (short_uuid, label) = trimmed
            .split_once('_')
            .ok_or(IdentifierError::MissingSeparator)?;

        if short_uuid.len() != 8 || !short_uuid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(IdentifierError::ShortUuidInvalid);
        }

        Self::from_parts(
            u32::from_str_radix(short_uuid, 16)
                .map_err(|_err| IdentifierError::ShortUuidInvalid)?,
            label,
        )
    }
}

impl<P: IdentifierPrefix> Serialize for StructuredIdentifier<P> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de, P: IdentifierPrefix> Deserialize<'de> for StructuredIdentifier<P> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct IdentifierVisitor<F: IdentifierPrefix>(PhantomData<F>);

        impl<F: IdentifierPrefix> Visitor<'_> for IdentifierVisitor<F> {
            type Value = StructuredIdentifier<F>;

            fn expecting(&self, formatter: &mut Formatter) -> core::fmt::Result {
                write!(
                    formatter,
                    "an identifier of the form {}<8 hex digits>_<alphanumeric label>",
                    F::PREFIX
                )
            }

            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
                StructuredIdentifier::from_str(value).map_err(E::custom)
            }
        }

        deserializer.deserialize_str(IdentifierVisitor(PhantomData))
    }
}

impl<P: IdentifierPrefix> PartialSchema for StructuredIdentifier<P> {
    fn schema() -> RefOr<Schema> {
        RefOr::T(Schema::Object(
            Object::builder()
                .schema_type(SchemaType::Type(Type::String))
                .min_length(Some(11))
                .max_length(Some(10 + LABEL_MAX_LENGTH))
                .pattern(Some(format!(
                    "^{}[0-9a-f]{{8}}_[A-Za-z0-9]{{{LABEL_MIN_LENGTH},{LABEL_MAX_LENGTH}}}$",
                    P::PREFIX
                )))
                .build(),
        ))
    }
}

impl<P: IdentifierPrefix> ToSchema for StructuredIdentifier<P> {
    fn name() -> Cow<'static, str> {
        Cow::Borrowed(P::SCHEMA_NAME)
    }
}
