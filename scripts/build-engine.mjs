import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, cpSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { homedir } from 'node:os'

const root = fileURLToPath(new URL('../', import.meta.url))
const work = path.join(root, '.research')
const dest = path.join(root, 'public', 'engine')
const rustProject = path.join(root, 'engine-rust')
const rustTarget = path.join(rustProject, 'target')
const cargoHome = path.join(work, 'cargo')
const standardCargo = path.join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo')
const cargo = existsSync(standardCargo) ? standardCargo : 'cargo'
mkdirSync(work, { recursive: true })
const staging = mkdtempSync(path.join(work, 'engine-'))
try {
  const rust = spawnSync(cargo, ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--lib'], {
    cwd: rustProject, stdio: 'inherit', env: { ...process.env, CARGO_HOME: cargoHome, CARGO_TARGET_DIR: rustTarget },
  })
  if (rust.error) throw rust.error
  if (rust.status !== 0) throw new Error('Error al compilar el lector Rust.')
  const run = spawnSync('dotnet', ['publish', 'parser/Analyzer.csproj', '-c', 'Release', '-o', staging], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, DOTNET_CLI_HOME: path.join(work, 'dotnet'),
      NUGET_PACKAGES: path.join(work, 'packages'), DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
  })
  if (run.error) throw run.error
  if (run.status !== 0) throw new Error('Error al compilar el analizador WebAssembly.')
  const source = path.join(staging, 'wwwroot', '_framework')
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(path.join(rustTarget, 'wasm32-unknown-unknown', 'release', 'fortnite_replay_engine.wasm'),
    path.join(dest, 'fortnite-replay.wasm'))
  for (const file of readdirSync(source)) {
    if (/\.(?:js|wasm|dat|json)$/.test(file) && !file.startsWith('blazor.'))
      cpSync(path.join(source, file), path.join(dest, file))
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}



