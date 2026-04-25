# BE Home for Desktop

`be-home-for-desktop` is the Unity desktop utility for helping Board players install, manage, and launch indie Board titles from Windows, macOS, and Linux with a guided experience instead of direct `bdb` terminal usage.

The maintained desktop stack uses:

- Unity `6000.4.0f1`
- C# with UI Toolkit for the desktop UI
- The shared Unity package `com.be.unity.shared` from the root `unity-shared/` submodule

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
- All `bdb` process calls must run asynchronously through awaitable process execution with timeout and cancellation.
- Unity Jobs are reserved for short CPU-bound work over job-compatible data, not process execution.
- USS must use only properties listed in the Unity `6000.4` UI Toolkit USS property reference.
- The core install workflow must remain usable without a Board Enthusiasts account.
- Signed-in capabilities should enhance the flow without becoming a prerequisite.

## Repository Structure

- `Assets/`: Unity desktop runtime, editor helpers, UI Toolkit assets, and tests
- `Packages/`: Unity package manifest and lock file
- `ProjectSettings/`: Unity project settings
- `docs/`: developer-facing documentation for this repo
- `planning/`: active planning artifacts for this repo

## Local Development Prerequisites

- Unity `6000.4.0f1`
- Python for root automation
- Optional: set `BE_UNITY_EDITOR_PATH` or `UNITY_EDITOR_PATH` when Unity is not discoverable at the standard Hub install path

## Local Development

From the root `board-enthusiasts` workspace:

```bash
python ./scripts/dev.py desktop test
python ./scripts/dev.py desktop build
```

You can also open the project directly in Unity:

```bash
python ./scripts/dev.py desktop --local-only
```

## Planning

Active planning lives in [`planning/`](planning/README.md).

## Docs

Contributor-facing desktop workflow notes live in [`docs/`](docs/README.md).
