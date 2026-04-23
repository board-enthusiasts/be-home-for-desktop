# BE Home for Desktop

Read the `README.md` for repo context first.

## Coding Standard

- Build the maintained desktop utility as a Tauri shell with a React + TypeScript renderer.
- Keep desktop-runtime code in `src-tauri/` and renderer code in `src/`.
- Keep developer-facing documentation in `docs/` and active planning artifacts in `planning/`.
- Treat all UI copy and content as player-facing production copy. Do not ship text that reads like developer notes, setup placeholders, implementation breadcrumbs, or future-feature narration.
- Write desktop UI copy for non-technical players in a friendly, helpful tone that matches the rest of the Board Enthusiasts product experience.
- Keep desktop styling aligned with the maintained Board Enthusiasts visual language, especially the `frontend` UI, unless the platform or interaction model requires a deliberate deviation.
- Prefer reusing or extracting shared BE styling primitives, tokens, and patterns over duplicating or independently re-creating similar styles in the desktop app.
- Do not redistribute `bdb` in source control, packaged releases, or local bootstrap artifacts. The utility must download the correct Board-hosted `bdb` binary for the current platform as part of setup.
- Preserve an offline-capable local experience for device checks, local APK inventory, install, uninstall, and launch flows after first-time setup completes.
- Treat Board Enthusiasts account features as optional enhancements on top of the account-free local utility path.
- Always provide a manual APK selection or install override path even when automatic Board-APK detection is available.
- Translate device, file-system, network, and CLI failures into plain-language product guidance suitable for non-technical players.

## GitHub Workflow

- Work GitHub tickets in dependency order instead of skipping ahead to blocked work.
- Keep the linked issue thread updated as work moves into progress, PR open, and merge-ready states.
- Open a dedicated PR for each ticket-sized change set instead of batching unrelated ticket work together.
- Do not start a blocked or dependent ticket until every prerequisite ticket has at least an active PR open.
- When a prerequisite PR is still unmerged, branch the dependent work from that prerequisite branch rather than from `main` so the dependency chain stays explicit in Git history.
