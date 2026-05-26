use core::fmt::{Display, Formatter};
use core::ops::RangeInclusive;
use serde::{Deserialize, Serialize};
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::{Database, Decode, Encode, Postgres};

#[derive(Clone, Eq, PartialEq)]
pub struct ServerPort {
    pub host: String,
    pub name: String,
    pub protocol: NetworkProtocol,
    pub internal_port: u16,
    pub external_port: RangeInclusive<u16>,
    pub bind: Option<String>,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
pub enum NetworkProtocol {
    #[serde(rename = "tcp")]
    Tcp,
    #[serde(rename = "udp")]
    Udp,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, utoipa::ToSchema)]
pub struct NetworkPort {
    pub id: u32,
    pub host: String,
    pub name: String, // only for ux purposes
    pub external_port_start: u16,
    pub external_port_end: u16,
    pub internal_port: u16,
    pub protocol: NetworkProtocol,
    pub bind: Option<String>, // Only visible to admins
}

impl sqlx::Type<Postgres> for NetworkProtocol {
    fn type_info() -> <sqlx::Postgres as sqlx::Database>::TypeInfo {
        <&str as sqlx::Type<Postgres>>::type_info()
    }

    fn compatible(ty: &<sqlx::Postgres as sqlx::Database>::TypeInfo) -> bool {
        <&str as sqlx::Type<Postgres>>::compatible(ty)
    }
}

impl sqlx::Encode<'_, Postgres> for NetworkProtocol {
    fn encode_by_ref(
        &self,
        buf: &mut <Postgres as Database>::ArgumentBuffer,
    ) -> Result<IsNull, BoxDynError> {
        let str = self.to_string();
        <&str as Encode<'_, Postgres>>::encode_by_ref(&&*str, buf)
    }

    fn produces(&self) -> Option<<sqlx::Postgres as sqlx::Database>::TypeInfo> {
        <&str as Encode<'_, Postgres>>::produces(&&*self.to_string())
    }

    fn size_hint(&self) -> usize {
        <&str as Encode<'_, Postgres>>::size_hint(&&*self.to_string())
    }
}

impl<'r> sqlx::Decode<'r, Postgres> for NetworkProtocol {
    fn decode(value: <Postgres as Database>::ValueRef<'r>) -> Result<Self, BoxDynError> {
        let value = <&str as Decode<'r, Postgres>>::decode(value)?;
        Ok(Self::by_name(value))
    }
}

impl Display for NetworkProtocol {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(match self {
            Self::Tcp => "tcp",
            Self::Udp => "udp",
        })
    }
}

impl NetworkProtocol {
    pub fn by_name(name: &str) -> Self {
        if name.eq("udp") { Self::Udp } else { Self::Tcp }
    }
}

pub(crate) fn merge_ports(ports: &mut Vec<NetworkPort>) {
    let mut remove = None;
    'outer: loop {
        if let Some(remove) = remove.take() {
            ports.remove(remove);
        }
        let ports_clone = ports.clone();
        for port1 in &mut *ports {
            let diff = port1.external_port_end - port1.external_port_start;
            for (index2, port2) in ports_clone.iter().enumerate() {
                if *port1 == *port2 {
                    continue;
                }
                if port2.external_port_start == port1.external_port_end + 1
                    && port2.internal_port == (port1.internal_port + diff + 1)
                    && port2.protocol == port1.protocol
                    && port2.bind == port1.bind
                    && port2.host == port1.host
                {
                    port1.external_port_end = port2.external_port_end;
                    remove = Some(index2);
                    ports.remove(index2);
                    continue 'outer;
                }
            }
        }
        break;
    }
}
