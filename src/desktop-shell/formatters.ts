import type {
  ManagedStorageLocation,
  SetupGateState,
} from "../desktop/types";

/**
 * Formats one or more scan folders for compact display.
 */
export function formatScanFolders(scanFolders: string[]): string {
  if (scanFolders.length === 0) {
    return "None yet";
  }

  return scanFolders.join(", ");
}

/**
 * Maps setup and tool states to the compact shell labels used in shared chrome.
 */
export function statusLabel(
  value: SetupGateState["status"] | SetupGateState["toolState"]["status"] | SetupGateState["toolState"]["validation"]["status"],
): string {
  switch (value) {
    case "requiresSetup":
      return "Needs setup";
    case "ready":
      return "Ready";
    case "unsupported":
      return "Unsupported";
    case "missing":
      return "Missing";
    case "downloaded":
      return "Needs repair";
    case "runnable":
      return "Runnable";
    case "blocked":
      return "Blocked";
    default:
      return value;
  }
}

/**
 * Maps one managed storage location back to the source that chose its current path.
 */
export function locationSourceLabel(location: ManagedStorageLocation): string {
  return location.source === "override" ? "Custom" : "App default";
}
