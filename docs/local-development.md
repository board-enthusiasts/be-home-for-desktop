# Local Development

This guide explains the maintained local workflow for `be-home-for-desktop`.

## Prerequisites

- Unity `6000.4.0f1`
- Python for the root developer automation
- The root workspace with `unity-shared/` initialized beside this Unity project

If Unity is not installed in the standard Unity Hub location, set one of these environment variables to the Unity editor executable:

```bash
BE_UNITY_EDITOR_PATH=/path/to/Unity
UNITY_EDITOR_PATH=/path/to/Unity
```

## Root Commands

Run desktop EditMode and PlayMode tests:

```bash
python ./scripts/dev.py desktop test
```

Build the Windows standalone player:

```bash
python ./scripts/dev.py desktop build
```

Open the Unity editor for local desktop work:

```bash
python ./scripts/dev.py desktop --local-only
```

## Contributor Notes

- Keep root automation current when Unity project workflows change.
- Keep player-facing copy in runtime code and contributor-facing guidance in `docs/`.
- Keep shared Unity code in `unity-shared/` only when both Unity apps need it.
- Verify USS property additions against the Unity `6000.4` UI Toolkit USS reference before committing them.
