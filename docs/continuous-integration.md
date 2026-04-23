# Continuous Integration

This repository uses a small but real desktop validation baseline so follow-on feature work lands against visible checks.

## Current Validation Scope

The maintained pull-request workflow runs on Windows, macOS, and Linux and currently verifies:

- `npm ci`
- `npm run typecheck`
- `npm run build`
- `npm run test:renderer`
- `cargo test --manifest-path src-tauri/Cargo.toml`

This keeps the early baseline focused on renderer correctness, Rust host correctness, and cross-platform compile confidence without turning the first CI pass into a full release pipeline.

## Current Gaps

The CI baseline does **not** yet do the following:

- build signed installers
- notarize or sign macOS releases
- sign Windows installers
- produce Linux release artifacts for distribution
- publish checksums or packaged desktop releases

Those release concerns are intentionally staged for the later packaging and signing tickets in Epic 1.

## Linux Notes

The Linux workflow installs the system packages Tauri requires to compile on Debian/Ubuntu-based runners. Keep that package list aligned with the maintained Tauri prerequisites when the desktop stack evolves.
