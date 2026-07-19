fn main() {
    println!("cargo:rerun-if-changed=../assets/icon.ico");
    tauri_build::build()
}
