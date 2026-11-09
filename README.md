# Fortnite Chest Analyzer

**A local replay dashboard for Fortnite chests, loot, and squad activity.**

[![Latest release](https://img.shields.io/github/v/release/saturnus25/Fortnite-Chest-Analyzer?style=for-the-badge&label=Latest%20release&logo=github&color=69a95f)](https://github.com/saturnus25/Fortnite-Chest-Analyzer/releases/latest)
[![Windows x64](https://img.shields.io/badge/Portable-Windows%20x64-0078d4?style=for-the-badge)](https://github.com/saturnus25/Fortnite-Chest-Analyzer/releases/latest)
[![License](https://img.shields.io/badge/License-GPL--3.0--or--later-567aa7?style=for-the-badge)](LICENSE)
[![Languages](https://img.shields.io/badge/Language-English%20%7C%20Espa%C3%B1ol-4b6070?style=for-the-badge)](README.es.md)

[Download for Windows](https://github.com/saturnus25/Fortnite-Chest-Analyzer/releases/latest) · [How it works](#how-it-works) · [Español](README.es.md) · [Report an issue](https://github.com/saturnus25/Fortnite-Chest-Analyzer/issues)

> [!NOTE]
> **AI-assisted development.** OpenAI Codex helped implement, translate, and document this project. The replay reader was checked against a private set of 100 Fortnite 43.00 recordings, with 99 analyzed and one marked unsupported. The preview below uses synthetic data. The project is independent of Epic Games.

![Dashboard preview showing chest averages, container activity, and supply drop counts with synthetic data](docs/dashboard.png)

## What you can see

| Chests and dispensers | Squad activity |
| :--- | :--- |
| Openings, breaks, and loot cannon shots are counted separately. Compare chests per match, view the internal container class, and distinguish observed supply drops from recorded openings. | Switch between your squad and everything captured by the replay. Sort player stats by any numeric column and browse the Epic display names recorded for each account. |
| **Loot and gizmos** | **Local workflow** |
| See linked loot, unresolved sources, extraction consumables, and identified gizmo wheel actors. The report keeps pickup status and source evidence separate. | Import folders, individual `.replay` files, or ZIP archives. Export and reimport JSON or CSV. English and Spanish can be switched without clearing the analysis. |

## Quick start

1. Download **Fortnite-Chest-Analyzer-Windows-x64.zip** from the [latest release](https://github.com/saturnus25/Fortnite-Chest-Analyzer/releases/latest).
2. Extract the whole archive and run **Abrir analizador.exe**. It opens the dashboard in your browser on loopback. Keep its window open while using the app. The package includes the runtime and needs no Rust, Node.js, or .NET installation.
3. Select your replay folder or import files. Folder imports include subfolders. Extract RAR archives first.
4. Use the **Language** selector next to the CSV and JSON buttons to choose **English** or **Español**. The browser remembers the choice.

## How it works

React and TypeScript render the dashboard. A Rust reader compiled to WebAssembly processes recordings across up to four Web Workers. The legacy .NET WebAssembly reader provides a fallback for other replay protocols. The Windows launcher serves static files over loopback. Replays and imported reports stay on the device, and the analysis requires no account or upload.

**Validated format.** Fortnite `43.00`, replay container `7`, network header `19`, and engine protocol `45`. Later or older builds may yield partial or unsupported results. Local recordings only capture the actors and changes replicated to the recording client. A gizmo actor sighting does not establish who used it or when it was obtained. **Pirate Shop Access.** The reward panel checks the replicated chest prize for the exact template `DelilahPrize:PirateAccount`. Two different reward templates were decoded from real replays. The positive Pirate Shop case was tested with synthetic data and still needs a real recording containing the token. See the [format and validation notes](INVESTIGACION.md) for the evidence rules, coverage, and upstream sources.

**Local catalog.** The app accepts a folder with item images and optional `catalogo.json`, `catalog.json`, or `items.json`. Supply the exact `id` and optionally `name`, `rarity`, `icon`, or `branch`. A verified pirate token can be marked with `"special": "pirate-token"` and an exact `branch`. User-provided names and raw game IDs are preserved when switching languages. Existing CSV and JSON report fields retain their original schema.

## Build from source

Use Node.js 24, the .NET 10 SDK, and stable Rust. The source for the dashboard, both replay engines, and the Windows launcher is under [src](src/), [engine-rust](engine-rust/), [parser](parser/), and [launcher](launcher/).

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run build
npm run preview -- --port 5182
```

On Windows, run `pwsh -File scripts/build-portable.ps1` after the build to package the Windows x64 release. To host it as a static site, serve `dist/` over HTTPS.

Run `cargo test --manifest-path engine-rust/Cargo.toml` for the Rust tests. The [browser test](tests/browser.mjs) expects local replay fixtures. Set `REPLAY_SAMPLES` to a folder containing your files, `REPLAY_URL` to your running app if needed, and `REPLAY_BROWSER` to the Edge or Chromium executable. The full replay regression suite uses the private validation set.

## License

The project is licensed under **GNU GPL v3 or later**. Redistribution of covered versions remains subject to the GPL, including its corresponding-source requirements. Third-party notices are in [public/licenses](public/licenses/), [parser](parser/), and the portable package. [Read the license](LICENSE).
