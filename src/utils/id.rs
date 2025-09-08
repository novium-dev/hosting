use arrayvec::ArrayString;
use serde::de::{Error, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::{Database, Decode, Encode, MySql};
use std::fmt::{Display, Formatter};
use std::io;
use std::io::ErrorKind;
use std::marker::PhantomData;
use std::ops::Deref;
use crate::error::HttpError;

pub use concat_idents::concat_idents;

pub const LENGTH: usize = 6;

#[derive(Debug, Hash, Eq, PartialEq, Copy, Clone)]
#[repr(transparent)]
pub struct GenericNanoId<T: ?Sized>(
    pub(super) ArrayString<LENGTH>,
    pub(super) PhantomData<T>,
);

impl<T: ?Sized> GenericNanoId<T> {
    pub const fn dummy() -> Self {
        Self(ArrayString::<LENGTH>::new_const(), PhantomData)
    }
}

impl<T> TryFrom<Vec<u8>> for GenericNanoId<T> {
    type Error = HttpError;

    fn try_from(value: Vec<u8>) -> Result<Self, Self::Error> {
        let Ok(str) = String::from_utf8(value) else {
            return Err(crate::error::server::NOT_FOUND);
        };
        Self::try_from(str)
    }
}

impl<T> TryFrom<String> for GenericNanoId<T> {
    type Error = HttpError;

    fn try_from(v: String) -> Result<Self, Self::Error> {
        if v.len() != LENGTH {
            return Err(crate::error::server::NOT_FOUND);
        }
        if v.chars().any(|c| !nanoid::alphabet::SAFE.contains(&c)) {
            return Err(crate::error::server::NOT_FOUND);
        }
        Ok(GenericNanoId(
            arrayvec::ArrayString::from(&v).unwrap(),
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
        let v = <&str as Decode<'r, MySql>>::decode(value)?;
        if v.len() != LENGTH {
            return Err(io::Error::new(ErrorKind::InvalidData, "String has wrong length.").into());
        }
        if v.chars().any(|c| !nanoid::alphabet::SAFE.contains(&c)) {
            return Err(io::Error::new(ErrorKind::InvalidData, "Invalid alphabet").into());
        }
        Ok(GenericNanoId(
            arrayvec::ArrayString::from(v).unwrap(),
            PhantomData,
        ))
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
        GenericNanoId(
            arrayvec::ArrayString::from(
                nanoid::format(nanoid::rngs::default, &nanoid::alphabet::SAFE, LENGTH).as_str(),
            )
                .unwrap(),
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

            fn expecting(&self, formatter: &mut Formatter) -> std::fmt::Result {
                write!(
                    formatter,
                    "a string with {}-sized characters with only characters available in the nanoid SAFE alphabet.",
                    LENGTH
                )
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: Error,
            {
                if v.len() != LENGTH {
                    return Err(E::custom("String has wrong length."));
                }
                if v.chars().any(|c| !nanoid::alphabet::SAFE.contains(&c)) {
                    return Err(E::custom("Invalid alphabet"));
                }
                Ok(GenericNanoId(
                    arrayvec::ArrayString::from(v).unwrap(),
                    PhantomData,
                ))
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
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        <ArrayString<LENGTH> as Display>::fmt(&self.0, f)
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
