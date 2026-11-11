#![windows_subsystem = "windows"]

use std::{os::windows::process::CommandExt, process::Command};

fn main() {
    let launched = std::env::current_exe().and_then(|path| {
        Command::new(path.with_file_name("Abrir analizador.exe"))
            .arg("--overlay-only")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
    });
    if launched.is_err() {
        std::process::exit(1);
    }
}
