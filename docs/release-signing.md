# Release Signing Requirements

This document captures the current operational requirements for shipping public BE Home for Desktop builds with a deliberate trust story.

The first public release baseline for Epic 1 is:

- Windows: NSIS setup executable (`-setup.exe`)
- macOS: signed and notarized DMG
- Linux: AppImage plus published SHA-256 checksums

Release automation should build each bundle type explicitly. Do not rely on Tauri's broad `"all"` bundle target for public release jobs.

## Trust Boundary

Signing BE Home for Desktop only covers the BE-managed application binary and installer artifacts.

It does **not** sign, notarize, or bless Board's separately distributed `bdb` binary. Even after BE Home itself is signed, players may still encounter trust prompts, reputation gaps, or host-security policies that apply specifically to the Board-hosted `bdb` download.

## Windows Requirements

Primary release path: Azure Artifact Signing (formerly Trusted Signing) for public non-Store releases.

Why this is the maintained default:

- Tauri documents Azure-backed signing integration for Windows bundles via `signCommand`
- Microsoft Learn currently recommends Azure Artifact Signing for non-Store distribution
- it avoids shipping a private certificate file into CI and fits GitHub Actions better than manual token handling

Operational notes:

- Microsoft Learn notes that SmartScreen reputation still builds over time for Azure Artifact Signing and OV certificates
- Microsoft Learn also notes that EV certificates no longer provide an automatic SmartScreen bypass as of the 2024 policy change
- a self-signed certificate is acceptable for local development only and is not acceptable for public release artifacts

Required accounts and material:

- Microsoft or Azure account with access to Azure Artifact Signing
- validated publisher identity for the signing account
- Azure signing account and certificate profile
- GitHub Actions secrets for:
  - `AZURE_CLIENT_ID`
  - `AZURE_CLIENT_SECRET`
  - `AZURE_TENANT_ID`
- repo or environment variables for:
  - signing endpoint URL
  - signing account name
  - certificate profile name

Fallback if Azure Artifact Signing is not available:

- use a public-trust OV code-signing certificate from a supported certificate authority
- expect hardware-token or HSM handling requirements and higher manual setup overhead

## macOS Requirements

Public macOS distribution requires Apple Developer signing plus notarization.

Operational notes:

- Tauri documents that macOS code signing requires an Apple Developer account and an Apple device for signing workflows
- Tauri also notes that the free Apple Developer plan is suitable for testing only and does not allow notarized public distribution
- Apple requires Developer ID signing for software distributed outside the Mac App Store
- Apple notarization requires `notarytool` or a newer Xcode-based workflow; Apple no longer accepts `altool` submissions as of November 1, 2023
- Apple requires hardened runtime, valid code signatures, secure timestamps, and Developer ID certificates for notarized outside-the-Store distribution

Required accounts and material:

- paid Apple Developer account
- Developer ID Application certificate
- exported `.p12` certificate for CI usage
- GitHub Actions secrets for:
  - `APPLE_CERTIFICATE`
  - `APPLE_CERTIFICATE_PASSWORD`
  - `KEYCHAIN_PASSWORD`
- notarization credentials using one of:
  - App Store Connect API:
    - `APPLE_API_ISSUER`
    - `APPLE_API_KEY`
    - private key material that the workflow can write to an `APPLE_API_KEY_PATH` file
  - Apple ID credentials:
    - `APPLE_ID`
    - app-specific password or equivalent Apple credential material

Maintained preference:

- use App Store Connect API credentials in CI instead of interactive Apple ID credentials
- staple the notarization ticket to the DMG or app bundle so offline installs do not depend on a live notarization lookup

## Linux Requirements

Epic 1 does not assume a platform-wide Linux code-signing authority comparable to Gatekeeper or SmartScreen.

The maintained Linux public-distribution policy is:

- ship an AppImage for broad distribution outside any one package manager
- publish a `SHA256SUMS` file alongside the AppImage
- publish brief checksum-verification instructions in the release notes or docs

Current secret requirements:

- none for checksum-only publication

Optional later hardening:

- detached GPG, Minisign, or Sigstore signing once the project is ready to manage a long-lived Linux release-signing key

## Required Human and Repo Prerequisites

Before public signed releases can succeed end to end, the project still needs:

- someone who owns the Microsoft/Azure signing account and can maintain its identity and billing
- someone who owns the Apple Developer account and can manage certificate rotation
- GitHub repository secrets configured for Windows and macOS signing
- certificate rotation and credential-recovery procedures documented somewhere the maintainers can access
- a release owner who can verify generated checksums and smoke-test installers before publication

## Current Public-Release Gaps

The repo can automate build steps before these prerequisites exist, but public release jobs should still be treated as incomplete until:

- Windows signing credentials are available
- macOS Developer ID and notarization credentials are available
- a named maintainer owns checksum publication and release verification

## References

- [Tauri Windows Code Signing](https://tauri.app/distribute/sign/windows/)
- [Tauri macOS Code Signing](https://tauri.app/distribute/sign/macos/)
- [Tauri Windows Installer](https://tauri.app/distribute/windows-installer/)
- [Tauri DMG Distribution](https://v2.tauri.app/distribute/dmg/)
- [Tauri AppImage Distribution](https://v2.tauri.app/distribute/appimage/)
- [Tauri Configuration Reference](https://v2.tauri.app/reference/config/)
- [Microsoft Learn: Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Apple Developer: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple Developer: Signing Mac Software with Developer ID](https://developer.apple.com/developer-id/)
