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
 * Describes whether a candidate came from configured scan folders or a manual file pick.
 */
export type ApkCandidateSource = "scanFolder" | "manualSelection";

/**
 * Describes whether the current APK discovery result has content to show.
 */
export type ApkDiscoveryStatus = "ready" | "empty";

/**
 * Describes the current Board-confidence level for one APK candidate.
 */
export type ApkConfidence = "strongMatch" | "possibleMatch" | "unknown";

/**
 * Describes one locally discovered APK candidate.
 */
export interface ApkCandidate {
  stableId: string;
  fileName: string;
  sourcePath: string;
  discoverySource: ApkCandidateSource;
  discoveredFromPath: string | null;
  fileSizeBytes: number;
  packageName: string | null;
  confidence: ApkConfidence;
  confidenceSummary: string;
}

/**
 * Describes the current APK discovery snapshot built from configured scan folders.
 */
export interface ApkDiscoverySnapshot {
  status: ApkDiscoveryStatus;
  summary: string;
  guidance: string;
  candidates: ApkCandidate[];
}

/**
 * Describes whether the managed APK library currently has imported items to show.
 */
export type ManagedApkLibraryStatus = "ready" | "empty";

/**
 * Describes one APK retained inside the managed library.
 */
export interface LibraryItem {
  stableId: string;
  fileName: string;
  originalSourcePath: string;
  managedPath: string;
  packageName: string | null;
  confidence: ApkConfidence;
  confidenceSummary: string;
  fileSizeBytes: number;
  importedAtUnixMs: number;
  sourceModifiedAtUnixMs: number | null;
  managedModifiedAtUnixMs: number | null;
}

/**
 * Describes the current managed APK library inventory.
 */
export interface ManagedApkLibrarySnapshot {
  status: ManagedApkLibraryStatus;
  summary: string;
  guidance: string;
  items: LibraryItem[];
}

/**
 * Describes the outcome of importing one APK into the managed library.
 */
export interface ManagedApkLibraryImportResult {
  summary: string;
  guidance: string;
  item: LibraryItem;
  snapshot: ManagedApkLibrarySnapshot;
}

/**
 * Describes whether one install attempt completed successfully.
 */
export type InstallApkStatus = "installed" | "failed";

/**
 * Describes the player-facing result of one `bdb install` attempt.
 */
export interface InstallApkResult {
  status: InstallApkStatus;
  summary: string;
  guidance: string;
  detail: string | null;
  command: string;
  exitCode: number | null;
}

/**
 * Describes whether one uninstall attempt completed successfully.
 */
export type UninstallInstalledTitleStatus = "removed" | "failed";

/**
 * Describes the player-facing result of one `bdb remove` attempt.
 */
export interface UninstallInstalledTitleResult {
  status: UninstallInstalledTitleStatus;
  summary: string;
  guidance: string;
  detail: string | null;
  command: string;
  exitCode: number | null;
}

/**
 * Describes whether one launch attempt completed successfully.
 */
export type LaunchInstalledTitleStatus = "launched" | "failed";

/**
 * Describes the player-facing result of one `bdb launch` attempt.
 */
export interface LaunchInstalledTitleResult {
  status: LaunchInstalledTitleStatus;
  summary: string;
  guidance: string;
  detail: string | null;
  command: string;
  exitCode: number | null;
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
  boardOsVersion: string | null;
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
  version: string | null;
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
 * Describes whether BE Home could read a friendly Board Install Tool version line.
 */
export type BdbToolVersionStatus = "available" | "unavailable";

/**
 * Describes the latest `bdb version` check for the managed Board Install Tool.
 */
export interface BdbToolVersionCheck {
  status: BdbToolVersionStatus;
  command: string;
  value: string | null;
  exitCode: number | null;
  summary: string;
  detail: string | null;
}

/**
 * Describes the latest manual update-check result for the managed Board Install Tool.
 */
export type BdbUpdateStatusKind =
  | "upToDate"
  | "updateAvailable"
  | "unknown"
  | "unsupported"
  | "error";

/**
 * Describes whether the current Board Install Tool matches BE Home's latest source version.
 */
export interface BdbUpdateStatus {
  status: BdbUpdateStatusKind;
  currentVersion: string | null;
  availableVersion: string | null;
  guidance: string;
}

/**
 * Describes a prefilled Board support request draft for unsupported-OS cases.
 */
export interface SupportRequestDraft {
  to: string;
  subject: string;
  body: string;
  mailtoUrl: string;
}

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
  versionCheck: BdbToolVersionCheck;
  updateStatus: BdbUpdateStatus;
  supportRequestDraft: SupportRequestDraft | null;
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
  boardConnection: BoardConnectionSettings;
  scanFolders: ConfiguredScanFolder[];
}

/**
 * Describes the saved Board connection preferences for the desktop app.
 */
export interface BoardConnectionSettings {
  pollIntervalSeconds: number;
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
  boardConnectionPollIntervalSeconds?: number;
  scanFolderPaths: string[];
}
