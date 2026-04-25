# Release Automation

The desktop release workflow lives in [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml).

## Current Status

The Unity cutover baseline intentionally disables the old WebView-era packaging workflow. The current workflow is a manual release-readiness note while cross-platform Unity packaging and signing are redesigned.

For local validation today, use the root automation:

```bash
python ./scripts/dev.py desktop test
python ./scripts/dev.py desktop build
```

## Future Follow-Up

The next release-hardening pass should:

1. add Unity player builds for Windows, macOS, and Linux runners
2. decide the installer/package shape for each platform
3. wire Windows signing into the Windows package job
4. import the Apple certificate into a temporary keychain on macOS runners
5. materialize the App Store Connect private key and wire notarization plus stapling
6. decide whether Linux should stay checksum-only or add detached signatures
