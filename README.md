# BE Home for Desktop

`be-home-for-desktop` is the desktop utility for helping Board players install, manage, and launch indie Board titles from Windows, macOS, and Linux with a guided experience instead of direct `bdb` terminal usage.

The maintained desktop stack uses:

- Tauri for the desktop shell
- React + TypeScript for the renderer UI
- Vite for frontend development and production builds

## Product Scope

The desktop utility is intended to:

- download and manage the correct `bdb` binary for the current OS without redistributing it
- guide players through Board USB connection and ongoing device status checks
- scan for likely Board-compatible APKs and allow manual override installs
- keep a managed local APK library for reinstall and recovery scenarios
- work offline for local APK inventory and installed-title management after initial setup
- optionally light up Board Enthusiasts account features such as library and wishlist install helpers

## Important Constraints

- The app must not redistribute or package `bdb`; it must download `bdb` from Board-controlled distribution URLs at runtime or first-run setup.
- The app must always allow manual APK selection or override so players are not blocked by stale detection heuristics.
- The core install workflow must remain usable without a Board Enthusiasts account.
- Signed-in capabilities should enhance the flow without becoming a prerequisite.

## Planned Repository Structure

- `src/`: React renderer source
- `src-tauri/`: Tauri and Rust host application code
- `docs/`: developer-facing documentation for this repo
- `planning/`: active planning artifacts for this repo

## Current App Foundation

The current desktop foundation includes:

- a runnable Tauri desktop shell with player-facing BE product copy
- shared BE styling imported from the `frontend` theme so the suite stays visually aligned
- a Rust host command that returns structured shell state to the renderer
- baseline renderer and host tests so future waves can extend the app safely

Next delivery waves will add real `bdb` download, validation, device monitoring, APK scanning, and install orchestration services behind this foundation.

## Local Development Prerequisites

The desktop stack needs both JavaScript and Rust toolchains.

- Node.js and npm for the React/Vite frontend and Tauri CLI
- Rust toolchain (`rustup`, `cargo`, `rustc`) for the Tauri host app
- Platform-specific Tauri prerequisites for Windows, macOS, or Linux packaging/signing

## Local Development

Install dependencies and launch the desktop shell:

```bash
npm install
npm run tauri dev
```

Useful validation commands:

```bash
npm run build
npm run test
```

## Planning

Active planning lives in [`planning/`](planning/README.md).
