# BE Home for Desktop MVP Plan

## Overview

`be-home-for-desktop` is the desktop utility companion for Board Enthusiasts that makes Board indie title installation significantly less technical for players while staying inside Board's current USB-and-`bdb` constraints.

The MVP will focus on the minimum complete player experience needed to:

- install the BE desktop utility on Windows, macOS, and Linux
- complete a mandatory first-run `bdb` setup flow that downloads the correct Board-hosted binary without redistributing it
- detect whether a Board device is connected and keep that state fresh while the app is open
- inventory locally available Board-capable APKs from friendly user-configured folders
- import or copy APKs into a managed app-controlled library for later reuse
- install, uninstall, list, and launch titles through UI actions that wrap `bdb`
- allow all core local workflows without requiring a Board Enthusiasts account
- optionally enhance the experience for signed-in users with library and wishlist-aware install helpers

## Constraints and Non-Negotiables

### Board Constraints

- Board currently requires USB connection to a computer for sideloading.
- Board currently requires `bdb` for install and management workflows.
- Board's terms prohibit redistribution or repackaging of `bdb`.
- `bdb` availability and behavior are Board-controlled external dependencies.

### Product Constraints

- The utility must be as low-friction and low-footprint as practical.
- The app itself should be signed per target platform to reduce OS and browser trust warnings.
- The app must not block installs when Board-APK heuristics fail; manual selection and override must remain available.
- Core player flows must work without a BE account and, after initial setup, should work as well as practical while offline.
- Diagnostic export is a developer-role-only signed-in feature, not a general-player workflow.

## Planned Technology Choice

### Desktop Runtime

- Unity `6000.4.0f1`
- UI Toolkit

### Shared Unity Package

- Shared reusable Unity code lives in `com.be.unity.shared` from the root `unity-shared/` submodule.
- Shared code must stay platform-neutral and avoid Board SDK, Android-only, and desktop-only `bdb` dependencies.

### Why This Stack

- Unity is now the selected runtime for both `be-home` and `be-home-for-desktop`, which lets the products share UI Toolkit theme primitives, contracts, and common helpers without WebView-rendered UI.
- UI Toolkit keeps setup, settings, and About flows inside a single native Unity app window for v1.
- A native desktop runtime is required because browser-only SPA capabilities are not sufficient for reliable native binary execution, local folder scanning, controlled app storage, and USB-adjacent command orchestration.

## MVP Experience

### First-Run Setup

The MVP should open into a mandatory guided setup flow before exposing the main utility if `bdb` is not yet available.

That flow must:

- detect the current OS and architecture
- resolve the correct `bdb` download source from Board-hosted URLs
- explain plainly why `bdb` is required
- let the user choose a storage location, with a player-friendly default app-data location preselected
- download and store `bdb`
- validate that the binary can be executed from the stored location
- surface clear explanations when Board does not provide a compatible binary for the user's system or when the OS blocks execution

### Main Utility Surface

The main MVP surface should provide:

- prominent display of `bdb version` once for the current session or load state
- automatic `bdb status` checks on load and at a reasonable polling cadence
- friendly connection instructions when Board is not detected
- `bdb list` inventory of currently sideloaded titles
- install, uninstall, and launch actions that wrap `bdb`
- a local Board-APK library and scan/import experience
- settings for scan folders and managed storage locations

## Local Storage Model

### Managed `bdb` Location

Use an app-owned default path with a friendly override option:

- Windows: `%LocalAppData%/Board Enthusiasts/BE Home for Desktop/tools/...`
- macOS: `~/Library/Application Support/Board Enthusiasts/BE Home for Desktop/tools/...`
- Linux: `~/.local/share/Board Enthusiasts/BE Home for Desktop/tools/...`

### Managed APK Library

Use a separate app-owned default path with an override option:

- Windows: `%LocalAppData%/Board Enthusiasts/BE Home for Desktop/apk-library/...`
- macOS: `~/Library/Application Support/Board Enthusiasts/BE Home for Desktop/apk-library/...`
- Linux: `~/.local/share/Board Enthusiasts/BE Home for Desktop/apk-library/...`

### Scan Folder Defaults

Start with friendly folder-list settings instead of technical include/exclude rules.

Default folder list:

- Windows: `Downloads`
- macOS: `Downloads`
- Linux: `Downloads`

The MVP settings should let the player:

- see configured scan folders
- add a folder through a picker
- remove a folder
- trigger a rescan

## Board APK Detection

### MVP Detection Goal

Identify likely Board-compatible APKs without preventing manual installs of unknown APKs.

### Candidate Signals

The current analysis of a Board-SDK-built sample APK indicates strong Board-specific signals such as:

- presence of `libnativeBoardSDK.so`
- Board SDK symbol and string references in native libraries
- standard Android package metadata that can still be used for package-name extraction

### Detection Strategy

Use a tiered model:

1. release metadata package-name match for signed-in/title-aware flows
2. strong local heuristic match for Board SDK markers
3. weaker heuristic match with lower confidence messaging
4. manual override path that still allows install

The UX must explain confidence without using technical jargon that confuses players.

## Offline Behavior

### Supported Offline

After `bdb` is already downloaded, the MVP should support offline use for:

- Board connection checks
- local APK folder scanning
- local managed library browsing
- install, uninstall, and launch actions
- manual APK import and reinstall workflows

### Requires Network

The MVP should require network only for:

- first-time `bdb` download
- future `bdb` updates or repair download flows
- BE account sign-in and account-linked enhancements

## BE Account-Linked Enhancements

These are optional MVP enhancements rather than requirements for core local use:

- sign-in support in the desktop utility
- viewing wishlist and library entries relevant to install workflows
- one-click install attempts that search the local APK inventory for the expected package name
- optional auto-add to BE library after successful local install

## Product and Data Changes Outside This Repo

The MVP also needs at least one supporting BE platform change outside the desktop repo:

- release-level expected package name metadata so title-aware install helpers know what to search for locally

At MVP scope, expected package name is the only new release metadata currently required.

## Delivery Tracks

### Epic 1: Foundation and Distribution

- scaffold the desktop repo and local development workflow
- establish signing-aware packaging and release requirements
- implement `bdb` download, storage, validation, and update-check foundations

### Epic 2: Local Device and APK Management

- implement Board connection monitoring and friendly recovery guidance
- implement local APK scanning, Board-compatibility heuristics, manual import, and managed storage
- implement installed-title inventory plus install, uninstall, and launch flows

### Epic 3: Account Enhancements and Platform Integration

- add expected package name support to BE release metadata
- add optional desktop sign-in and library/wishlist-enhanced install helpers
- add developer-role diagnostic export and supportability features

## Outstanding Unknowns

- the exact Board-hosted `bdb` URL patterns and whether they remain stable across release updates
- how often Board changes `bdb` packaging, signing, or OS compatibility behavior
- the precise cross-platform signing and notarization pipeline the team will adopt for release automation
- how much of the BE account experience should be embedded directly in the desktop utility versus delegated to existing web flows
- whether Board exposes enough consistent information from `bdb list` and related commands to reliably map installed titles back to BE release metadata in every case

## Explicit Non-Goals for MVP

- replacing Board's USB requirement
- replacing Board's dependency on `bdb`
- checksum enforcement for downloaded APK authenticity
- advanced multi-root search rules such as regex or file-system query syntax
- requiring a BE account for local sideload management
