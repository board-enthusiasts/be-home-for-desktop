# BE Home for Desktop

Read the `README.md` for repo context first.

## Coding Standard

- Build the maintained desktop utility as a Tauri shell with a React + TypeScript renderer.
- Keep desktop-runtime code in `src-tauri/` and renderer code in `src/`.
- Keep developer-facing documentation in `docs/` and active planning artifacts in `planning/`.
- Do not redistribute `bdb` in source control, packaged releases, or local bootstrap artifacts. The utility must download the correct Board-hosted `bdb` binary for the current platform as part of setup.
- Preserve an offline-capable local experience for device checks, local APK inventory, install, uninstall, and launch flows after first-time setup completes.
- Treat Board Enthusiasts account features as optional enhancements on top of the account-free local utility path.
- Always provide a manual APK selection or install override path even when automatic Board-APK detection is available.
- Translate device, file-system, network, and CLI failures into plain-language product guidance suitable for non-technical players.
