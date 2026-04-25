# BE Home for Desktop

Read the `README.md` for repo context first.

## Coding Standard

- Build the maintained desktop utility as a Unity `6000.4.0f1` standalone desktop app with UI Toolkit.
- Keep desktop runtime code in `Assets/BEHomeDesktop/Runtime`, editor/build helpers in `Assets/BEHomeDesktop/Editor`, and tests in `Assets/BEHomeDesktop/Tests`.
- Keep reusable Unity code in the root `unity-shared/` package (`com.be.unity.shared`) when both `be-home` and `be-home-for-desktop` need it.
- Do not copy React/Tauri code or CSS into the Unity implementation.
- Use only Unity `6000.4` supported USS properties. Avoid web CSS assumptions such as `gap`, `row-gap`, `column-gap`, complex selectors, unsupported filters, and arbitrary CSS functions.
- Use Unity `Awaitable` for UI-facing async flows and main/background thread switching.
- Run `bdb` through an awaitable `System.Diagnostics.Process` runner with timeout, cancellation, stdout/stderr capture, and no UI-thread blocking.
- Do not run `bdb` commands through Unity Jobs. Use Jobs only for short CPU-bound, job-friendly work after data is copied into compatible structures.
- Treat all UI copy and content as player-facing production copy. Do not ship text that reads like developer notes, setup placeholders, implementation breadcrumbs, or future-feature narration.
- Do not redistribute `bdb` in source control, packaged releases, or local bootstrap artifacts.
- Preserve an offline-capable local experience for device checks, local APK inventory, install, uninstall, and launch flows after first-time setup completes.
- Always provide a manual APK selection or install override path even when automatic Board-APK detection is available.
- Translate device, file-system, network, and CLI failures into plain-language product guidance suitable for non-technical players.

## Validation

- Prefer root automation: `python ./scripts/dev.py desktop test` and `python ./scripts/dev.py desktop build`.
- Keep EditMode tests focused on services/parsers/process behavior and PlayMode tests focused on UI Toolkit navigation behavior.

## GitHub Workflow

- Work GitHub tickets in dependency order instead of skipping ahead to blocked work.
- Keep the linked issue thread updated as work moves into progress, PR open, and merge-ready states.
- Open a dedicated PR for each ticket-sized change set instead of batching unrelated ticket work together.
- Do not start a blocked or dependent ticket until every prerequisite ticket has at least an active PR open.
- When a prerequisite PR is still unmerged, branch the dependent work from that prerequisite branch rather than from `main` so the dependency chain stays explicit in Git history.
