# `bdb` Tool Lifecycle

The desktop host is responsible for the full local `bdb` bootstrap flow. The renderer consumes typed state and result objects instead of parsing file-system or process details itself.

## Managed Executable Path

The host always stores the managed executable inside the configured `bdb` tools directory:

- Windows: `<managed tools path>/bdb.exe`
- macOS and Linux: `<managed tools path>/bdb`

The managed tools directory itself comes from the persisted storage contract described in [`managed-storage.md`](managed-storage.md).

## Runtime Flow

When the app inspects or acquires `bdb`, it follows this order:

1. resolve the current Board-hosted source plan using remote, cached, then bundled manifest precedence
2. resolve the current managed `bdb` storage directory
3. look for the expected `bdb` executable in that directory
4. if the file exists, run `bdb help` to confirm the binary can open without requiring a Board device
5. if download or repair is requested, fetch the Board-hosted binary, replace the managed copy, and validate it again

## State Model

The host exposes four player-facing tool states:

- `unsupported`: Board does not publish a maintained `bdb` target for this computer
- `missing`: no managed `bdb` executable is present yet
- `downloaded`: a managed `bdb` file exists, but BE Home could not confirm that the OS would let it open
- `runnable`: the managed `bdb` executable opened successfully during `bdb help` validation

The validation contract also captures whether the last check was `unsupported`, `missing`, `blocked`, or `runnable`, along with the command BE Home attempted.

## Repair Behavior

Repair does not require players to browse hidden folders or delete files manually. The host:

- downloads a fresh Board-hosted binary
- writes it into the managed tools directory
- replaces the existing managed copy if one is already present
- re-runs runnable validation immediately

## Failure Normalization

The host translates common failure categories into player-friendly guidance:

- unsupported-system outcomes point back to Board's current platform matrix
- download failures explain that Board's host or the player's connection was unavailable
- storage failures explain that the managed tools folder could not be written
- blocked-executable failures explain that the file exists but the computer would not let BE Home open it yet

No repo asset, cached manifest, or release artifact redistributes `bdb`. The binary is only downloaded from Board-hosted URLs at runtime.
