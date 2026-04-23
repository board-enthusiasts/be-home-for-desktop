/**
 * Allowed accent families for a dashboard section card.
 */
export type ShellTone = "sunrise" | "forest" | "ocean" | "slate";

/**
 * Describes a small status badge shown inside a dashboard section.
 */
export interface ShellBadge {
  label: string;
  value: string;
}

/**
 * Describes one major workflow area in the desktop shell.
 */
export interface ShellSection {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  tone: ShellTone;
  badges: ShellBadge[];
  bullets: string[];
}

/**
 * Describes the dashboard content returned by the Tauri host during app bootstrap.
 */
export interface DesktopShellState {
  appName: string;
  version: string;
  platformLabel: string;
  introEyebrow: string;
  introSummary: string;
  highlights: ShellBadge[];
  gettingStartedTitle: string;
  gettingStartedSteps: string[];
  helpTitle: string;
  helpSummary: string;
  helpBullets: string[];
  sections: ShellSection[];
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
  manifestSchemaVersion: number;
  support: BdbPlatformSupport;
  source: BdbDownloadSource | null;
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
 * Represents the persisted override payload accepted by the desktop host.
 */
export interface ManagedStorageOverridesInput {
  bdbToolsOverride: string | null;
  apkLibraryOverride: string | null;
}
