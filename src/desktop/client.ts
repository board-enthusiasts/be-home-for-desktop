import { invoke } from "@tauri-apps/api/core";
import type {
  ApkCandidate,
  ApkDiscoverySnapshot,
  InstallApkResult,
  ManagedApkLibraryImportResult,
  ManagedApkLibrarySnapshot,
  BdbAcquisitionResult,
  BdbSourcePlan,
  BdbToolState,
  DesktopSettings,
  DesktopSettingsInput,
  DeviceStatusSnapshot,
  InstalledTitlesSnapshot,
  ManagedStorageOverridesInput,
  ManagedStorageSettings,
  SetupGateState,
} from "./types";

/**
 * Loads the current setup gate state from the Rust host.
 */
export function loadSetupGateState(): Promise<SetupGateState> {
  return invoke<SetupGateState>("load_setup_gate_state");
}

/**
 * Loads the current APK discovery snapshot built from configured scan folders.
 */
export function loadApkDiscoverySnapshot(): Promise<ApkDiscoverySnapshot> {
  return invoke<ApkDiscoverySnapshot>("load_apk_discovery_snapshot");
}

/**
 * Inspects one manually selected APK path and returns a normalized candidate model.
 */
export function inspectManualApkPath(path: string): Promise<ApkCandidate> {
  return invoke<ApkCandidate>("inspect_manual_apk_path", {
    input: { path },
  });
}

/**
 * Loads the current managed APK library inventory from the Rust host.
 */
export function loadManagedApkLibrarySnapshot(): Promise<ManagedApkLibrarySnapshot> {
  return invoke<ManagedApkLibrarySnapshot>("load_managed_apk_library_snapshot");
}

/**
 * Copies one APK into the managed library and returns the updated inventory snapshot.
 */
export function importApkToManagedLibrary(
  sourcePath: string,
): Promise<ManagedApkLibraryImportResult> {
  return invoke<ManagedApkLibraryImportResult>("import_apk_to_managed_library", {
    input: { sourcePath },
  });
}

/**
 * Installs one APK onto the currently connected Board device.
 */
export function installApkToConnectedBoard(apkPath: string): Promise<InstallApkResult> {
  return invoke<InstallApkResult>("install_apk_to_connected_board", {
    input: { apkPath },
  });
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
 * Loads the current Board connection snapshot and `bdb` version details.
 */
export function loadDeviceStatusSnapshot(): Promise<DeviceStatusSnapshot> {
  return invoke<DeviceStatusSnapshot>("load_device_status_snapshot");
}

/**
 * Loads the current installed-title inventory from the desktop host.
 */
export function loadInstalledTitlesSnapshot(): Promise<InstalledTitlesSnapshot> {
  return invoke<InstalledTitlesSnapshot>("load_installed_titles_snapshot");
}

/**
 * Loads the current managed storage settings from the desktop host.
 */
export function loadManagedStorageSettings(): Promise<ManagedStorageSettings> {
  return invoke<ManagedStorageSettings>("load_managed_storage_settings");
}

/**
 * Loads the player-facing desktop settings model from the desktop host.
 */
export function loadDesktopSettings(): Promise<DesktopSettings> {
  return invoke<DesktopSettings>("load_desktop_settings");
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

/**
 * Saves desktop settings such as scan folders and the managed APK library location.
 */
export function saveDesktopSettings(input: DesktopSettingsInput): Promise<DesktopSettings> {
  return invoke<DesktopSettings>("save_desktop_settings", {
    input,
  });
}
