import { invoke } from "@tauri-apps/api/core";
import type {
  BdbAcquisitionResult,
  BdbSourcePlan,
  BdbToolState,
  DesktopShellState,
  ManagedStorageOverridesInput,
  ManagedStorageSettings,
} from "./types";

/**
 * Loads the current desktop shell state from the Rust host.
 */
export function loadDesktopShellState(): Promise<DesktopShellState> {
  return invoke<DesktopShellState>("load_shell_state");
}

/**
 * Loads the maintained `bdb` source-resolution plan for the current machine.
 */
export function loadBdbSourcePlan(): Promise<BdbSourcePlan> {
  return invoke<BdbSourcePlan>("load_bdb_source_plan");
}

/**
 * Loads the current managed `bdb` tool state from the desktop host.
 */
export function loadBdbToolState(): Promise<BdbToolState> {
  return invoke<BdbToolState>("load_bdb_tool_state");
}

/**
 * Downloads or repairs the managed `bdb` binary, then returns the updated state.
 */
export function acquireBdbTool(repair = false): Promise<BdbAcquisitionResult> {
  return invoke<BdbAcquisitionResult>("acquire_bdb_tool", { repair });
}

/**
 * Loads the current managed storage settings from the desktop host.
 */
export function loadManagedStorageSettings(): Promise<ManagedStorageSettings> {
  return invoke<ManagedStorageSettings>("load_managed_storage_settings");
}

/**
 * Saves managed storage overrides and returns the updated effective settings.
 */
export function saveManagedStorageSettings(
  overrides: ManagedStorageOverridesInput,
): Promise<ManagedStorageSettings> {
  return invoke<ManagedStorageSettings>("save_managed_storage_settings", {
    overrides,
  });
}
