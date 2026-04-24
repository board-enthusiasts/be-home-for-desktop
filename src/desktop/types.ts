/**
 * Describes whether the app must keep the player inside setup before opening the workspace.
 */
export type SetupGateStatus = "requiresSetup" | "ready" | "unsupported";

/**
 * Describes the setup step that should be active based on current host state.
 */
export type SetupRequiredStep = "systemCheck" | "toolSetup" | "workspace";

/**
 * Describes the stable setup-gate contract returned by the desktop host.
 */
export interface SetupGateState {
  appName: string;
  version: string;
  platformLabel: string;
  status: SetupGateStatus;
  requiredStep: SetupRequiredStep;
  summary: string;
  guidance: string;
  toolState: BdbToolState;
  storage: ManagedStorageSettings;
  defaultScanFolders: string[];
}

/**
 * Describes the normalized device-connection state for the current `bdb` session.
 */
export type DeviceStatusKind =
  | "toolMissing"
  | "toolBroken"
  | "unsupportedHost"
  | "boardDisconnected"
  | "boardConnected"
  | "executionError";

/**
 * Describes whether BE Home could read a friendly `bdb version` string.
 */
export type BdbVersionStatus = "available" | "unavailable";

/**
 * Describes the latest `bdb version` check for the current session.
 */
export interface BdbVersionDetails {
  status: BdbVersionStatus;
  command: string;
  value: string | null;
  exitCode: number | null;
  summary: string;
  detail: string | null;
}

/**
 * Describes the current Board connection state plus related `bdb` diagnostics.
 */
export interface DeviceStatusSnapshot {
  status: DeviceStatusKind;
  summary: string;
  guidance: string;
  detail: string | null;
  pollIntervalMs: number;
  bdbVersion: BdbVersionDetails;
}

/**
 * Describes whether the installed-title inventory is ready, empty, or temporarily unavailable.
 */
export type InstalledTitlesStatus = "ready" | "empty" | "unavailable";

/**
 * Describes one title currently reported by `bdb list`.
 */
export interface InstalledTitle {
  stableId: string;
  displayName: string;
  packageName: string | null;
  subtitle: string | null;
  canLaunch: boolean;
  canUninstall: boolean;
}

/**
 * Describes the current installed-title inventory model for Board.
 */
export interface InstalledTitlesSnapshot {
  status: InstalledTitlesStatus;
  summary: string;
  guidance: string;
  titles: InstalledTitle[];
}

/**
 * Describes whether the current machine matches a supported Board `bdb` target.
 */
export type BdbSupportStatus = "supported" | "unsupported";

/**
 * Explains why the current machine could not be matched to a supported `bdb` source.
 */
export type BdbUnsupportedReason =
  | "unsupportedOperatingSystem"
  | "unsupportedArchitecture"
  | "unsupportedOperatingSystemVersion"
  | "platformProbeFailed"
  | "missingManifestEntry";

/**
 * Describes the normalized operating system being evaluated for `bdb`.
 */
export type BdbOperatingSystem = "windows" | "macos" | "linux" | "unknown";

/**
 * Describes the normalized CPU architecture being evaluated for `bdb`.
 */
export type BdbArchitecture = "x86_64" | "aarch64" | "x86" | "arm" | "unknown";

/**
 * Describes the current machine's compatibility with the maintained `bdb` support matrix.
 */
export interface BdbPlatformSupport {
  status: BdbSupportStatus;
  operatingSystem: BdbOperatingSystem;
  architecture: BdbArchitecture;
  windowsBuild: number | null;
  platformKey: string | null;
  reason: BdbUnsupportedReason | null;
  guidance: string;
}

/**
 * Describes the Board-hosted `bdb` source chosen for the current machine.
 */
export interface BdbDownloadSource {
  platformKey: string;
  downloadUrl: string;
}

/**
 * Describes the maintained source-resolution plan for `bdb` on the current machine.
 */
export interface BdbSourcePlan {
  manifestSource: string;
  remoteManifestUrl: string;
  manifestCachePath: string | null;
  manifestSchemaVersion: number;
  support: BdbPlatformSupport;
  source: BdbDownloadSource | null;
}

/**
 * Describes the local readiness state for the managed `bdb` binary.
 */
export type BdbToolStatus = "unsupported" | "missing" | "downloaded" | "runnable";

/**
 * Describes the runnable validation result for the managed `bdb` binary.
 */
export type BdbRunnableStatus = "unsupported" | "missing" | "blocked" | "runnable";

/**
 * Describes the latest no-device-required validation result for the managed `bdb` binary.
 */
export interface BdbRunnableValidation {
  status: BdbRunnableStatus;
  command: string;
  exitCode: number | null;
  summary: string;
  detail: string | null;
}

/**
 * Describes the current managed `bdb` tool state.
 */
export interface BdbToolState {
  status: BdbToolStatus;
  summary: string;
  guidance: string;
  executablePath: string;
  executableExists: boolean;
  storage: ManagedStorageLocation;
  sourcePlan: BdbSourcePlan;
  validation: BdbRunnableValidation;
}

/**
 * Describes the outcome of an acquire or repair attempt for `bdb`.
 */
export type BdbAcquisitionOutcome =
  | "unsupported"
  | "alreadyReady"
  | "downloaded"
  | "repaired"
  | "failed";

/**
 * Describes the result returned after BE Home attempts to acquire or repair `bdb`.
 */
export interface BdbAcquisitionResult {
  outcome: BdbAcquisitionOutcome;
  summary: string;
  guidance: string;
  toolState: BdbToolState;
}

/**
 * Describes whether a managed storage location is using the default path or an override.
 */
export type ManagedStoragePathSource = "default" | "override";

/**
 * Describes one managed storage location and how its current path was chosen.
 */
export interface ManagedStorageLocation {
  defaultPath: string;
  overridePath: string | null;
  effectivePath: string;
  source: ManagedStoragePathSource;
}

/**
 * Describes whether a scan folder comes from the app defaults or was added later.
 */
export type ConfiguredScanFolderSource = "default" | "custom";

/**
 * Describes one active scan folder in the desktop settings model.
 */
export interface ConfiguredScanFolder {
  path: string;
  source: ConfiguredScanFolderSource;
}

/**
 * Describes the normalized operating system used for managed-storage defaults.
 */
export type StorageOperatingSystem = "windows" | "macos" | "linux";

/**
 * Describes the current managed storage configuration for the desktop app.
 */
export interface ManagedStorageSettings {
  operatingSystem: StorageOperatingSystem;
  settingsFilePath: string;
  bdbTools: ManagedStorageLocation;
  apkLibrary: ManagedStorageLocation;
}

/**
 * Describes the player-facing desktop settings model.
 */
export interface DesktopSettings {
  operatingSystem: StorageOperatingSystem;
  settingsFilePath: string;
  bdbTools: ManagedStorageLocation;
  apkLibrary: ManagedStorageLocation;
  bdbExecutablePath: string;
  scanFolders: ConfiguredScanFolder[];
}

/**
 * Represents the persisted override payload accepted by the desktop host.
 */
export interface ManagedStorageOverridesInput {
  bdbToolsOverride: string | null;
  apkLibraryOverride: string | null;
}

/**
 * Describes the desktop settings payload accepted by the host.
 */
export interface DesktopSettingsInput {
  apkLibraryOverride: string | null;
  scanFolderPaths: string[];
}
