# Release Automation

The desktop release workflow lives in [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml).

## Triggers

The workflow currently runs on:

- manual `workflow_dispatch`
- pushed tags that match `v*`

Manual runs are for rehearsal and artifact inspection. Tag-triggered runs are the path that can publish GitHub release assets.

## Explicit Bundle Targets

The workflow builds each public-distribution bundle explicitly instead of relying on Tauri's `"all"` bundle target:

- Windows: `nsis`
- macOS: `dmg`
- Linux: `appimage`

That keeps the release graph easy to reason about and makes platform-specific signing gaps visible instead of buried inside an opaque multi-target build.

## Current Output Shape

Each workflow run produces:

- one uploaded artifact per platform bundle
- one `SIGNING-STATUS.txt` note per platform bundle
- one aggregated `SHA256SUMS` file generated from the NSIS, DMG, and AppImage outputs

When the workflow runs from a pushed tag, it also uploads those files to the GitHub release for that tag.

## Signing Placeholder Behavior

Epic 1 intentionally stages the release workflow before live signing integration is fully wired.

That means:

- Windows bundles can be produced before Azure signing is connected
- macOS DMGs can be produced before certificate import and notarization steps are connected
- Linux follows the checksum-first policy from [`release-signing.md`](release-signing.md)

The workflow writes explicit `SIGNING-STATUS.txt` notes so anyone inspecting the artifacts can immediately tell whether a platform is still using placeholder unsigned output.

## Future Follow-Up

The next release-hardening pass should:

1. wire Azure Artifact Signing into the Windows build job
2. import the Apple certificate into a temporary keychain on macOS runners
3. materialize the App Store Connect private key and wire notarization plus stapling
4. decide whether Linux should stay checksum-only or add detached signatures
