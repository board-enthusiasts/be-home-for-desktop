# BE Home for Desktop

`be-home-for-desktop` is the planned desktop utility for helping Board players install, manage, and launch indie Board titles from Windows, macOS, and Linux with a guided experience instead of direct `bdb` terminal usage.

The maintained desktop stack is planned to use:

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

## Local Development Prerequisites

The planned desktop stack needs both JavaScript and Rust toolchains.

- Node.js and npm for the React/Vite frontend and Tauri CLI
- Rust toolchain (`rustup`, `cargo`, `rustc`) for the Tauri host app
- Platform-specific Tauri prerequisites for Windows, macOS, or Linux packaging/signing

At the time this repo was scaffolded in the current workspace, Node.js was available but Rust tooling was not yet installed locally. The planning and repository structure are in place, but the local desktop build toolchain still needs to be bootstrapped before Tauri builds can run here.

## Planning

Active planning lives in [`planning/`](planning/README.md).
