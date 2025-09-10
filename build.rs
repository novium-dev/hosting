use std::path::PathBuf;
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
        #[cfg(target_os = "linux")]
        {
            if let Ok(path) = PathBuf::from(
                std::env::var_os("CARGO_MANIFEST_DIR").expect("Manifest directory isn't present"),
            )
            .join("mariadb/sockets/mysqld.sock")
            .canonicalize()
            {
                println!(
                    "cargo:rustc-env=DATABASE_URL=mysql://root@localhost/backend?socket={}",
                    path.to_string_lossy()
                );
            }
        }

        #[cfg(target_os = "macos")]
        println!("cargo:rustc-env=DATABASE_URL=mysql://root@mariadb.mac.orb.local/backend");
    }
}
