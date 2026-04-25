# Continuous Integration

This repository is in the Unity cutover baseline. The authoritative local validation path is currently the root automation:

```bash
python ./scripts/dev.py desktop test
python ./scripts/dev.py desktop build
```

## Current Validation Scope

The maintained desktop validation covers:

- Unity `6000.4.0f1` project import
- EditMode tests for `bdb` parsing, process timeout/cancellation, setup state, APK discovery, and shared style loading
- PlayMode tests for UI Toolkit route/navigation state
- a USS property review against the Unity `6000.4` USS property reference
- a Windows standalone player build

## Current Gaps

The CI baseline does **not** yet do the following:

- build signed installers
- notarize or sign macOS releases
- sign Windows installers
- produce Linux release artifacts for distribution
- publish checksums or packaged desktop releases

Those release concerns are intentionally staged after the Unity desktop baseline is merged.
