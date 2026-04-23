# `bdb` Source Manifest

This repository keeps the maintained `bdb` source map in [`config/bdb-sources.json`](../config/bdb-sources.json).

## Purpose

- keep the current Board-hosted download URLs in one small, reviewable file
- allow the desktop app to ship with a bundled fallback manifest
- provide a repo-hosted JSON file that future runtime refresh logic can fetch without requiring a new desktop app release

## Current Remote Manifest URL

The planned remote manifest URL for runtime checks is:

[`https://raw.githubusercontent.com/board-enthusiasts/be-home-for-desktop/main/config/bdb-sources.json`](https://raw.githubusercontent.com/board-enthusiasts/be-home-for-desktop/main/config/bdb-sources.json)

## Schema

The manifest intentionally stays simple:

```json
{
  "schemaVersion": 1,
  "platforms": {
    "linux-x86_64": "https://dev.board.fun/downloads/bdb/linux/bdb",
    "macos-universal": "https://dev.board.fun/downloads/bdb/macos-universal/bdb",
    "windows-x86_64": "https://dev.board.fun/downloads/bdb/windows/bdb.exe"
  }
}
```

## Current Platform Rules

- `macos-universal`: used for both Intel and Apple Silicon macOS hosts
- `linux-x86_64`: used only for Linux amd64 / x86_64 hosts
- `windows-x86_64`: used only for Windows x86_64 hosts that pass the app’s Windows 11 compatibility check

The app owns compatibility rules such as the Windows 11 requirement. The manifest only maps supported platform keys to Board-hosted URLs.

## Fallback Strategy

The maintained precedence for the later acquisition flow is:

1. freshly fetched remote manifest
2. cached last-known-good manifest
3. bundled fallback manifest from the app build

This issue implements the bundled fallback and the maintained remote URL target. Cached manifest behavior lands in the later bootstrap/download work.

## Emergency Update Procedure

If Board changes a `bdb` URL or withdraws a build:

1. update [`config/bdb-sources.json`](../config/bdb-sources.json)
2. merge the change to `main` so the repo-hosted raw JSON updates
3. keep or remove the matching platform key deliberately rather than silently redirecting unsupported users
4. update the related docs and issue thread if the support matrix itself changed

## Current Board References

As of April 23, 2026, the Board Developer Portal advertises these `bdb` downloads:

- [macOS (Universal)](https://dev.board.fun/downloads/bdb/macos-universal/bdb)
- [Linux (amd64)](https://dev.board.fun/downloads/bdb/linux/bdb)
- [Windows (Windows 11)](https://dev.board.fun/downloads/bdb/windows/bdb.exe)
