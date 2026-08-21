fn main() {
  // Avoid PE "export ordinal too large" / "too many exported symbols" when
  // linking the Tauri cdylib with the Windows GNU toolchain + windows-rs.
  #[cfg(all(target_os = "windows", target_env = "gnu"))]
  {
    println!("cargo:rustc-cdylib-link-arg=-Wl,--exclude-all-symbols");
  }
  tauri_build::build()
}
