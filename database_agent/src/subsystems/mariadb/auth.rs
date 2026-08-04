use sha1::{Digest as _, Sha1};

fn sha1(data: &[u8]) -> [u8; 20] {
    Sha1::digest(data).into()
}

pub fn native_token(scramble: &[u8], password: &[u8]) -> Vec<u8> {
    if password.is_empty() {
        return Vec::new();
    }

    let stage1 = sha1(password);
    let stage2 = sha1(&stage1);

    let mut hasher = Sha1::new();
    hasher.update(scramble);
    hasher.update(stage2);
    let digest: [u8; 20] = hasher.finalize().into();

    stage1
        .iter()
        .zip(digest)
        .map(|(stage, byte)| stage ^ byte)
        .collect()
}
