use crate::auth::user::UserAuthentication;

mod user;

#[derive(Debug)]
pub enum Authentication {
    User(UserAuthentication),
}
