# Managed Storage

This repository separates app-managed storage into two independent locations:

- `bdb` tool storage
- managed APK library storage

## Default Locations

The maintained defaults are:

- Windows: `%LocalAppData%/Board Enthusiasts/BE Home for Desktop/tools` and `%LocalAppData%/Board Enthusiasts/BE Home for Desktop/apk-library`
- macOS: `~/Library/Application Support/Board Enthusiasts/BE Home for Desktop/tools` and `~/Library/Application Support/Board Enthusiasts/BE Home for Desktop/apk-library`
- Linux: `~/.local/share/Board Enthusiasts/BE Home for Desktop/tools` and `~/.local/share/Board Enthusiasts/BE Home for Desktop/apk-library`

## Persisted Overrides

When a player changes either location, the app persists absolute-path overrides in an app-owned settings file instead of relying on command-line flags or ad hoc path parsing.

Current settings file location:

- Windows: `%LocalAppData%/Board Enthusiasts/BE Home for Desktop/settings/managed-storage.json`
- macOS: `~/Library/Application Support/Board Enthusiasts/BE Home for Desktop/settings/managed-storage.json`
- Linux: `~/.local/share/Board Enthusiasts/BE Home for Desktop/settings/managed-storage.json`

## Current Contract

The host-side storage settings contract exposes:

- the current OS
- the settings file path
- the default path for each storage area
- the optional persisted override for each storage area
- the effective path the app should use right now

This keeps later setup, settings, download, and library flows aligned on one shared source of truth.
