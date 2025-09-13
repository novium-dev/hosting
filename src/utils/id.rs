use arrayvec::ArrayString;
pub use concat_idents::concat_idents;
use core::fmt::{Display, Formatter};
use core::marker::PhantomData;
use core::ops::Deref;
use core::str::FromStr;
use std::borrow::Cow;
use serde::de::{Error, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::{Database, Decode, Encode, MySql};
use std::io;
use std::io::ErrorKind;
use utoipa::openapi::{Object, RefOr, Schema, Type};
use utoipa::{PartialSchema, ToSchema};
use utoipa::openapi::schema::SchemaType;

pub const LENGTH: usize = 6;

#[derive(Debug, Hash, Eq, PartialEq, Copy, Clone)]
#[repr(transparent)]
pub struct GenericNanoId<T: ?Sized>(pub(super) ArrayString<LENGTH>, pub(super) PhantomData<T>);

impl<T: ?Sized> GenericNanoId<T> {
    pub const fn dummy() -> Self {
        Self(ArrayString::<LENGTH>::new_const(), PhantomData)
    }
}

impl<T> TryFrom<Vec<u8>> for GenericNanoId<T> {
    type Error = ();

    fn try_from(value: Vec<u8>) -> Result<Self, Self::Error> {
        let Ok(str) = str::from_utf8(&value) else {
            return Err(());
        };
        Self::from_str(str)
    }
}

impl<T> FromStr for GenericNanoId<T> {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.len() != LENGTH {
            return Err(());
        }
        if value
            .chars()
            .any(|ch| !nanoid::alphabet::SAFE.contains(&ch))
        {
            return Err(());
        }
        Ok(Self(
            arrayvec::ArrayString::from(value).expect("Unable to create array vec"),
            PhantomData,
        ))
    }
}

impl<T> sqlx::Type<MySql> for GenericNanoId<T> {
    fn type_info() -> <sqlx::MySql as sqlx::Database>::TypeInfo {
        <&str as sqlx::Type<MySql>>::type_info()
    }

    fn compatible(ty: &<sqlx::MySql as sqlx::Database>::TypeInfo) -> bool {
        <&str as sqlx::Type<MySql>>::compatible(ty)
    }
}

impl<'q, T> sqlx::Encode<'q, MySql> for GenericNanoId<T> {
    fn encode_by_ref(
        &self,
        buf: &mut <MySql as Database>::ArgumentBuffer<'q>,
    ) -> Result<IsNull, BoxDynError> {
        let str = self.as_str();
        <&str as Encode<'_, MySql>>::encode_by_ref(&str, buf)
    }

    fn produces(&self) -> Option<<sqlx::MySql as sqlx::Database>::TypeInfo> {
        <&str as Encode<'_, MySql>>::produces(&self.as_str())
    }

    fn size_hint(&self) -> usize {
        <&str as Encode<'_, MySql>>::size_hint(&self.as_str())
    }
}

impl<'r, T> sqlx::Decode<'r, MySql> for GenericNanoId<T> {
    fn decode(value: <MySql as Database>::ValueRef<'r>) -> Result<Self, BoxDynError> {
        let value = <&str as Decode<'r, MySql>>::decode(value)?;

        Self::from_str(value)
            .map_err(|()| io::Error::new(ErrorKind::InvalidData, "Invalid nano id").into())
    }
}

impl<T> Deref for GenericNanoId<T> {
    type Target = arrayvec::ArrayString<LENGTH>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<T> GenericNanoId<T> {
    pub fn generate() -> Self {
        Self(
            arrayvec::ArrayString::from(
                nanoid::format(nanoid::rngs::default, &nanoid::alphabet::SAFE, LENGTH).as_str(),
            )
            .expect("Unable to generate nano id"),
            PhantomData,
        )
    }
}

impl<'de, T> Deserialize<'de> for GenericNanoId<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct StringVisitor<F>(PhantomData<F>);
        impl<F> Visitor<'_> for StringVisitor<F> {
            type Value = GenericNanoId<F>;

            fn expecting(&self, formatter: &mut Formatter) -> core::fmt::Result {
                write!(
                    formatter,
                    "a string with {LENGTH}-sized characters with only characters available in the nanoid SAFE alphabet."
                )
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: Error,
            {
                GenericNanoId::from_str(value).map_err(|()| E::custom("Invalid nano id"))
            }
        }
        deserializer.deserialize_str(StringVisitor(PhantomData))
    }
}

impl<T> Serialize for GenericNanoId<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<T> Display for GenericNanoId<T> {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        <ArrayString<LENGTH> as Display>::fmt(&self.0, formatter)
    }
}

impl<T> PartialSchema for GenericNanoId<T> {
    fn schema() -> RefOr<Schema> {
        RefOr::T(Schema::Object(
            Object::builder()
                .min_length(Some(LENGTH))
                .max_length(Some(LENGTH))
                .pattern(Some(format!("^[{}]{{{LENGTH}}}$", nanoid::alphabet::SAFE.iter().rev().collect::<String>())))
                .schema_type(SchemaType::Type(Type::String))
                .examples(
                    vec![serde_json::json!({"value": "A1b2C3"})]
                )
                .build(),
        ))
    }
}

impl<T> ToSchema for GenericNanoId<T> {
    fn name() -> Cow<'static, str> {
        Cow::Borrowed("NanoId")
    }
}

#[macro_export]
macro_rules! define_id {
    ($x: ident) => {
        $crate::utils::id::concat_idents!(inner_name = $x, Inner {
            pub type $x = $crate::utils::id::GenericNanoId<inner_name>;

            #[derive(Debug, Hash, Eq, PartialEq, Copy, Clone)]
            pub struct inner_name;
        });
        pub const DUMMY_ID: $x = $crate::utils::id::GenericNanoId::dummy();
    };
}
