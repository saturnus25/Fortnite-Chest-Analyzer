use std::io::{self, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdout = io::stdout().lock();
    let mut stdout = io::BufWriter::new(stdout);
    for path in std::env::args_os().skip(1) {
        let result = fortnite_replay_engine::analyze(&std::fs::read(path)?);
        serde_json::to_writer(&mut stdout, &result)?;
        stdout.write_all(b"\n")?;
    }
    Ok(())
}
