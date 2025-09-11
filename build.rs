use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=.git/HEAD");
    let output = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .expect("Failed to execute command");

    let git_hash = String::from_utf8_lossy(&output.stdout);

    println!("cargo:rustc-env=GIT_HASH={git_hash}");

    if let Ok(env) = std::env::var("BACKEND_DATABASE_URL") {
        println!("cargo:rustc-env=DATABASE_URL={env}");
    } else {
        #[cfg(not(target_os = "macos"))]
        println!("cargo:rustc-env=DATABASE_URL=mysql://root@localhost/backend");

        #[cfg(target_os = "macos")]
        println!("cargo:rustc-env=DATABASE_URL=mysql://root@mariadb.mac.orb.local/backend");
    }
}
