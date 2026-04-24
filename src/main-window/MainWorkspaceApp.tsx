import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  importApkToManagedLibrary,
  inspectManualApkPath,
  installApkToConnectedBoard,
  launchInstalledTitleOnBoard,
  loadApkDiscoverySnapshot,
  loadDesktopSettings,
  loadDeviceStatusSnapshot,
  loadInstalledTitlesSnapshot,
  loadManagedApkLibrarySnapshot,
  loadSetupGateState,
  openSetupWizardWindow,
  uninstallInstalledTitleFromBoard,
} from "../desktop/client";
import type {
  ApkCandidate,
  ApkDiscoverySnapshot,
  DesktopSettings,
  DeviceStatusSnapshot,
  InstallApkResult,
  InstalledTitlesSnapshot,
  LaunchInstalledTitleResult,
  ManagedApkLibraryImportResult,
  ManagedApkLibrarySnapshot,
  SetupGateState,
  UninstallInstalledTitleResult,
} from "../desktop/types";
import { formatBoardInstallToolVersion } from "../desktop/presentation";
import {
  MAIN_WORKSPACE_NAVIGATE_EVENT,
  MAIN_WORKSPACE_RESCAN_EVENT,
  SETTINGS_UPDATED_EVENT,
  type MainWorkspaceNavigationEvent,
} from "../desktop-shell/constants";

type WorkspaceSectionId = "gamesAndApps" | "installedOnBoard";
type NoticeTone = "success" | "warning" | "neutral";

interface DeviceState {
  loading: boolean;
  snapshot: DeviceStatusSnapshot | null;
  errorMessage: string | null;
  errorDetail: string | null;
}

interface InstalledTitlesState {
  loading: boolean;
  snapshot: InstalledTitlesSnapshot | null;
  errorMessage: string | null;
  errorDetail: string | null;
}

interface ApkDiscoveryState {
  loading: boolean;
  snapshot: ApkDiscoverySnapshot | null;
  manualCandidate: ApkCandidate | null;
  errorMessage: string | null;
  errorDetail: string | null;
}

interface ManagedLibraryState {
  loading: boolean;
  snapshot: ManagedApkLibrarySnapshot | null;
  errorMessage: string | null;
  errorDetail: string | null;
  actionPath: string | null;
  actionMessage: string | null;
  actionDetail: string | null;
}

interface InstallState {
  actionPath: string | null;
  message: string | null;
  detail: string | null;
  lastStatus: InstallApkResult["status"] | null;
}

interface InstalledTitleActionState {
  actionKind: "launch" | "uninstall" | null;
  actionPackage: string | null;
  confirmPackage: string | null;
  message: string | null;
  detail: string | null;
  tone: NoticeTone | null;
}

interface BoardStatusPresentation {
  tone: "success" | "danger" | "warning" | "neutral";
  label: string;
  tooltip: string;
}

const workspaceSections: Array<{ id: WorkspaceSectionId; label: string; summary: string }> = [
  {
    id: "gamesAndApps",
    label: "Games & Apps",
    summary: "Files on this computer and your saved library",
  },
  {
    id: "installedOnBoard",
    label: "Installed on Board",
    summary: "What is already on your Board",
  },
];

export default function MainWorkspaceApp() {
  const [setupGateState, setSetupGateState] = useState<SetupGateState | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState>({
    loading: false,
    snapshot: null,
    errorMessage: null,
    errorDetail: null,
  });
  const [installedTitlesState, setInstalledTitlesState] = useState<InstalledTitlesState>({
    loading: false,
    snapshot: null,
    errorMessage: null,
    errorDetail: null,
  });
  const [apkDiscoveryState, setApkDiscoveryState] = useState<ApkDiscoveryState>({
    loading: false,
    snapshot: null,
    manualCandidate: null,
    errorMessage: null,
    errorDetail: null,
  });
  const [managedLibraryState, setManagedLibraryState] = useState<ManagedLibraryState>({
    loading: false,
    snapshot: null,
    errorMessage: null,
    errorDetail: null,
    actionPath: null,
    actionMessage: null,
    actionDetail: null,
  });
  const [apkInstallState, setApkInstallState] = useState<InstallState>({
    actionPath: null,
    message: null,
    detail: null,
    lastStatus: null,
  });
  const [installedTitleActionState, setInstalledTitleActionState] =
    useState<InstalledTitleActionState>({
      actionKind: null,
      actionPackage: null,
      confirmPackage: null,
      message: null,
      detail: null,
      tone: null,
    });
  const [activeSectionId, setActiveSectionId] = useState<WorkspaceSectionId>("gamesAndApps");
  const [windowFocused, setWindowFocused] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  const [gamesAndAppsLoaded, setGamesAndAppsLoaded] = useState(false);
  const [installedLoaded, setInstalledLoaded] = useState(false);
  const apkInstallInFlightRef = useRef(false);

  useEffect(() => {
    void refreshSetupGateState();
  }, []);

  useEffect(() => {
    if (setupGateState?.status === "ready") {
      void refreshDesktopSettings();
    } else {
      setDesktopSettings(null);
      setGamesAndAppsLoaded(false);
      setInstalledLoaded(false);
    }
  }, [setupGateState?.status]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setDocumentVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let removeFocusListener: (() => void) | null = null;
    void getCurrentWindow()
      .onFocusChanged(({ payload }) => {
        setWindowFocused(payload);
      })
      .then((unlisten) => {
        removeFocusListener = unlisten;
      })
      .catch(() => {
        setWindowFocused(true);
      });

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (removeFocusListener !== null) {
        removeFocusListener();
      }
    };
  }, []);

  const refreshSetupGateState = useEffectEvent(async (): Promise<void> => {
    try {
      const state = await loadSetupGateState();
      setSetupGateState(state);
      setWindowError(null);
    } catch {
      setWindowError(
        "BE Home couldn't open the desktop workspace just yet. Please close the app and try again.",
      );
    }
  });

  const refreshDesktopSettings = useEffectEvent(async (): Promise<void> => {
    try {
      const settings = await loadDesktopSettings();
      setDesktopSettings(settings);
    } catch {
      setWindowError("BE Home couldn't load the latest desktop settings.");
    }
  });

  const refreshDeviceStatus = useEffectEvent(
    async (source: "initial" | "poll" | "manual" = "manual"): Promise<void> => {
      if (setupGateState?.status !== "ready") {
        return;
      }

      if (source !== "poll") {
        setDeviceState((previous) => ({
          ...previous,
          loading: true,
          errorMessage: null,
          errorDetail: null,
        }));
      }

      try {
        const snapshot = await loadDeviceStatusSnapshot();
        setDeviceState({
          loading: false,
          snapshot,
          errorMessage: null,
          errorDetail: null,
        });
      } catch {
        setDeviceState((previous) => ({
          loading: false,
          snapshot: previous.snapshot,
          errorMessage: "BE Home couldn't refresh the latest Board check.",
          errorDetail:
            source === "poll"
              ? "It will keep trying again while the window stays visible."
              : "Please try again in a moment.",
        }));
      }
    },
  );

  const refreshInstalledTitles = useEffectEvent(
    async (source: "initial" | "manual" = "manual"): Promise<void> => {
      if (setupGateState?.status !== "ready") {
        return;
      }

      setInstalledTitlesState((previous) => ({
        ...previous,
        loading: true,
        errorMessage: null,
        errorDetail: null,
      }));

      try {
        const snapshot = await loadInstalledTitlesSnapshot();
        setInstalledTitlesState({
          loading: false,
          snapshot,
          errorMessage: null,
          errorDetail: null,
        });
      } catch {
        setInstalledTitlesState((previous) => ({
          loading: false,
          snapshot: previous.snapshot,
          errorMessage: "BE Home couldn't load the latest installed titles.",
          errorDetail:
            source === "initial"
              ? "Open Installed on Board again in a moment."
              : "Please try refreshing the list again.",
        }));
      }
    },
  );

  const refreshApkDiscovery = useEffectEvent(
    async (source: "initial" | "manual" = "manual"): Promise<void> => {
      if (setupGateState?.status !== "ready") {
        return;
      }

      setApkDiscoveryState((previous) => ({
        ...previous,
        loading: true,
        errorMessage: null,
        errorDetail: null,
      }));

      try {
        const snapshot = await loadApkDiscoverySnapshot();
        setApkDiscoveryState((previous) => ({
          ...previous,
          loading: false,
          snapshot,
          errorMessage: null,
          errorDetail: null,
        }));
      } catch {
        setApkDiscoveryState((previous) => ({
          ...previous,
          loading: false,
          errorMessage: "BE Home couldn't rescan this computer right now.",
          errorDetail:
            source === "initial"
              ? "Open Games & Apps again in a moment."
              : "Please try rescanning again.",
        }));
      }
    },
  );

  const refreshManagedLibrary = useEffectEvent(
    async (source: "initial" | "manual" = "manual"): Promise<void> => {
      if (setupGateState?.status !== "ready") {
        return;
      }

      setManagedLibraryState((previous) => ({
        ...previous,
        loading: true,
        errorMessage: null,
        errorDetail: null,
      }));

      try {
        const snapshot = await loadManagedApkLibrarySnapshot();
        setManagedLibraryState((previous) => ({
          ...previous,
          loading: false,
          snapshot,
          errorMessage: null,
          errorDetail: null,
        }));
      } catch {
        setManagedLibraryState((previous) => ({
          ...previous,
          loading: false,
          errorMessage: "BE Home couldn't load your saved library right now.",
          errorDetail:
            source === "initial"
              ? "Open Games & Apps again in a moment."
              : "Please try refreshing the saved library again.",
        }));
      }
    },
  );

  const devicePollIntervalMs =
    deviceState.snapshot?.pollIntervalMs ??
    (desktopSettings?.boardConnection.pollIntervalSeconds ?? 5) * 1000;
  useEffect(() => {
    if (setupGateState?.status !== "ready") {
      setDeviceState({
        loading: false,
        snapshot: null,
        errorMessage: null,
        errorDetail: null,
      });
      return;
    }

    if (!documentVisible || !windowFocused) {
      return;
    }

    void refreshDeviceStatus("initial");
    const timer = window.setInterval(() => {
      void refreshDeviceStatus("poll");
    }, devicePollIntervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [devicePollIntervalMs, documentVisible, setupGateState?.status, windowFocused]);

  useEffect(() => {
    if (setupGateState?.status !== "ready") {
      return;
    }

    if (activeSectionId === "gamesAndApps" && !gamesAndAppsLoaded) {
      setGamesAndAppsLoaded(true);
      void refreshApkDiscovery("initial");
      void refreshManagedLibrary("initial");
    }

    if (activeSectionId === "installedOnBoard" && !installedLoaded) {
      setInstalledLoaded(true);
      void refreshInstalledTitles("initial");
    }
  }, [activeSectionId, gamesAndAppsLoaded, installedLoaded, setupGateState?.status]);

  const handleShellNavigation = useEffectEvent((payload: MainWorkspaceNavigationEvent) => {
    setActiveSectionId(payload.target);
  });

  const handleShellRescan = useEffectEvent(() => {
    setActiveSectionId("gamesAndApps");
    void refreshApkDiscovery("manual");
    void refreshManagedLibrary("manual");
  });

  const handleSettingsUpdated = useEffectEvent(() => {
    void refreshSetupGateState();
    void refreshDesktopSettings();
    void refreshDeviceStatus("manual");
    if (gamesAndAppsLoaded) {
      void refreshApkDiscovery("manual");
      void refreshManagedLibrary("manual");
    }
    if (installedLoaded) {
      void refreshInstalledTitles("manual");
    }
  });

  useEffect(() => {
    let mounted = true;
    let unlistenFunctions: Array<() => void> = [];

    void Promise.all([
      listen<MainWorkspaceNavigationEvent>(MAIN_WORKSPACE_NAVIGATE_EVENT, ({ payload }) => {
        handleShellNavigation(payload);
      }),
      listen(MAIN_WORKSPACE_RESCAN_EVENT, () => {
        handleShellRescan();
      }),
      listen(SETTINGS_UPDATED_EVENT, () => {
        handleSettingsUpdated();
      }),
    ]).then((unlisten) => {
      if (mounted) {
        unlistenFunctions = unlisten;
        return;
      }

      for (const removeListener of unlisten) {
        removeListener();
      }
    });

    return () => {
      mounted = false;
      for (const removeListener of unlistenFunctions) {
        removeListener();
      }
    };
  }, []);

  async function handleOpenSetupWizard(): Promise<void> {
    await openSetupWizardWindow();
  }

  async function handleImportApkIntoManagedLibrary(
    sourcePath: string,
  ): Promise<ManagedApkLibraryImportResult | null> {
    setManagedLibraryState((previous) => ({
      ...previous,
      actionPath: sourcePath,
      actionMessage: null,
      actionDetail: null,
      errorMessage: null,
      errorDetail: null,
    }));

    try {
      const result = await importApkToManagedLibrary(sourcePath);
      setManagedLibraryState((previous) => ({
        ...previous,
        snapshot: result.snapshot,
        actionPath: null,
        actionMessage: result.summary,
        actionDetail: result.guidance,
        errorMessage: null,
        errorDetail: null,
      }));
      return result;
    } catch {
      setManagedLibraryState((previous) => ({
        ...previous,
        actionPath: null,
        errorMessage: "BE Home couldn't save that file right now.",
        errorDetail: "Please try the same game or app again in a moment.",
      }));
      return null;
    }
  }

  async function handleInstallApk(apkPath: string): Promise<InstallApkResult | null> {
    if (apkInstallInFlightRef.current) {
      return null;
    }

    apkInstallInFlightRef.current = true;
    setApkInstallState({
      actionPath: apkPath,
      message: null,
      detail: null,
      lastStatus: null,
    });

    try {
      const result = await installApkToConnectedBoard(apkPath);
      setApkInstallState({
        actionPath: null,
        message: result.summary,
        detail: result.detail ?? result.guidance,
        lastStatus: result.status,
      });

      if (result.status === "installed") {
        await refreshDeviceStatus("manual");
        await refreshInstalledTitles("manual");
      }

      return result;
    } catch (error) {
      setApkInstallState({
        actionPath: null,
        message: "BE Home couldn't finish that install right now.",
        detail: extractActionErrorDetail(
          error,
          "Please keep Board connected and try the same game or app again.",
        ),
        lastStatus: "failed",
      });
      return null;
    } finally {
      apkInstallInFlightRef.current = false;
    }
  }

  function handleRequestUninstall(packageName: string): void {
    setInstalledTitleActionState((previous) => ({
      ...previous,
      actionKind: null,
      confirmPackage: packageName,
      message: null,
      detail: null,
      tone: null,
    }));
  }

  function handleCancelUninstall(): void {
    setInstalledTitleActionState((previous) => ({
      ...previous,
      confirmPackage: null,
    }));
  }

  async function handleUninstallInstalledTitle(
    packageName: string,
    displayName: string,
  ): Promise<UninstallInstalledTitleResult | null> {
    setInstalledTitleActionState({
      actionKind: "uninstall",
      actionPackage: packageName,
      confirmPackage: packageName,
      message: null,
      detail: null,
      tone: null,
    });

    try {
      const result = await uninstallInstalledTitleFromBoard(packageName, displayName);
      setInstalledTitleActionState({
        actionKind: null,
        actionPackage: null,
        confirmPackage: null,
        message: result.summary,
        detail: result.detail ?? result.guidance,
        tone: result.status === "removed" ? "success" : "warning",
      });

      if (result.status === "removed") {
        await refreshDeviceStatus("manual");
        await refreshInstalledTitles("manual");
      }

      return result;
    } catch {
      setInstalledTitleActionState({
        actionKind: null,
        actionPackage: null,
        confirmPackage: null,
        message: `BE Home couldn't remove ${displayName} right now.`,
        detail: "Please keep Board connected and try removing it again.",
        tone: "warning",
      });
      return null;
    }
  }

  async function handleLaunchInstalledTitle(
    packageName: string,
    displayName: string,
  ): Promise<LaunchInstalledTitleResult | null> {
    setInstalledTitleActionState({
      actionKind: "launch",
      actionPackage: packageName,
      confirmPackage: null,
      message: null,
      detail: null,
      tone: null,
    });

    try {
      const result = await launchInstalledTitleOnBoard(packageName, displayName);
      setInstalledTitleActionState({
        actionKind: null,
        actionPackage: null,
        confirmPackage: null,
        message: result.summary,
        detail: result.detail ?? result.guidance,
        tone: result.status === "launched" ? "success" : "warning",
      });

      await refreshDeviceStatus("manual");
      return result;
    } catch {
      setInstalledTitleActionState({
        actionKind: null,
        actionPackage: null,
        confirmPackage: null,
        message: `BE Home couldn't open ${displayName} right now.`,
        detail: "Please keep Board connected and try again.",
        tone: "warning",
      });
      return null;
    }
  }

  async function handleChooseManualApk(): Promise<void> {
    const selectedPath = await pickSinglePath(
      await open({
        multiple: false,
        filters: [
          {
            name: "Games and apps",
            extensions: ["apk"],
          },
        ],
      }),
    );
    if (selectedPath === null) {
      return;
    }

    setApkDiscoveryState((previous) => ({
      ...previous,
      loading: true,
      errorMessage: null,
      errorDetail: null,
    }));

    try {
      const manualCandidate = await inspectManualApkPath(selectedPath);
      setApkDiscoveryState((previous) => ({
        ...previous,
        loading: false,
        manualCandidate,
        errorMessage: null,
        errorDetail: null,
      }));

      if (manualCandidate.confidence === "strongMatch") {
        await handleImportApkIntoManagedLibrary(selectedPath);
      }
    } catch {
      setApkDiscoveryState((previous) => ({
        ...previous,
        loading: false,
        errorMessage: "BE Home couldn't read that file yet.",
        errorDetail: "Choose another game or app, or try the same file again.",
      }));
    }
  }

  const boardStatus = buildBoardStatusPresentation(deviceState.snapshot, setupGateState, deviceState);
  const bdbVersionValue = formatBoardInstallToolVersion(
    deviceState.snapshot?.bdbVersion.value ?? setupGateState?.toolState.versionCheck.value,
  );
  const boardOsVersionValue = deviceState.snapshot?.boardOsVersion ?? "Unavailable";

  if (windowError !== null) {
    return (
      <main className="page-shell desktop-shell">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">BE Home for Desktop</div>
            <h2>Please close the app and try again.</h2>
            <p className="panel-description">{windowError}</p>
          </section>
        </section>
      </main>
    );
  }

  if (setupGateState === null) {
    return (
      <main className="page-shell desktop-shell">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">Opening BE Home for Desktop</div>
            <h2>Getting your desktop workspace ready</h2>
            <p className="panel-description">
              BE Home is checking your setup and Board status.
            </p>
          </section>
        </section>
      </main>
    );
  }

  if (setupGateState.status !== "ready") {
    return (
      <main className="page-shell desktop-shell">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card desktop-inline-message--warning" aria-live="polite">
            <div className="eyebrow">Setup Needed</div>
            <h2>Finish setup in the Setup Wizard first.</h2>
            <p className="panel-description">{setupGateState.summary}</p>
            <div className="desktop-inline-button-row">
              <button className="primary-button" onClick={() => void handleOpenSetupWizard()} type="button">
                Open Setup Wizard
              </button>
            </div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell desktop-shell desktop-shell--workspace">
      <section className="page-grid desktop-grid">
        <section className="panel desktop-app-shell">
          <header className="desktop-app-header">
            <div className="desktop-app-heading">
              <div className="eyebrow">BE Home for Desktop</div>
              <h1>Keep your Board installs close by.</h1>
              <p className="panel-description">
                Choose between the files on this computer and what is already installed on your
                Board.
              </p>
            </div>
          </header>

          <section className="desktop-status-strip" aria-label="Board status">
            <span className={`desktop-status-chip desktop-status-chip--${boardStatus.tone}`}>
              {boardStatus.label}
            </span>
            <div className="desktop-help-chip-wrap">
              <button
                aria-describedby="board-status-help-tooltip"
                aria-label="What this Board status means"
                className="desktop-help-chip"
                type="button"
              >
                ?
              </button>
              <span className="desktop-help-tooltip" id="board-status-help-tooltip" role="tooltip">
                {boardStatus.tooltip}
              </span>
            </div>
            <StatusValueChip label="bdb" value={bdbVersionValue} />
            <StatusValueChip label="Board OS" value={boardOsVersionValue} />
          </section>

          <section className="desktop-main-layout">
            <aside className="desktop-sidebar" aria-label="Workspace sections">
              {workspaceSections.map((section) => (
                <button
                  className={
                    section.id === activeSectionId
                      ? "desktop-sidebar-button desktop-sidebar-button--active"
                      : "desktop-sidebar-button"
                  }
                  key={section.id}
                  onClick={() => setActiveSectionId(section.id)}
                  type="button"
                >
                  <span className="desktop-sidebar-button-label">{section.label}</span>
                  <span className="desktop-sidebar-button-summary">{section.summary}</span>
                </button>
              ))}
            </aside>

            <section className="desktop-main-content">
              {activeSectionId === "gamesAndApps" ? (
                <GamesAndAppsSection
                  apkDiscoveryState={apkDiscoveryState}
                  apkInstallState={apkInstallState}
                  desktopSettings={desktopSettings}
                  managedLibraryState={managedLibraryState}
                  onChooseManualApk={() => void handleChooseManualApk()}
                  onImportCandidate={(sourcePath) => void handleImportApkIntoManagedLibrary(sourcePath)}
                  onInstallApk={(apkPath) => void handleInstallApk(apkPath)}
                  onRescan={() => {
                    void refreshApkDiscovery("manual");
                    void refreshManagedLibrary("manual");
                  }}
                />
              ) : (
                <InstalledOnBoardSection
                  installedTitleActionState={installedTitleActionState}
                  installedTitlesState={installedTitlesState}
                  onCancelUninstall={handleCancelUninstall}
                  onLaunchTitle={(packageName, displayName) =>
                    void handleLaunchInstalledTitle(packageName, displayName)
                  }
                  onRefresh={() => void refreshInstalledTitles("manual")}
                  onRequestUninstall={handleRequestUninstall}
                  onUninstallTitle={(packageName, displayName) =>
                    void handleUninstallInstalledTitle(packageName, displayName)
                  }
                />
              )}
            </section>
          </section>
        </section>
      </section>
    </main>
  );
}

interface StatusValueChipProps {
  label: string;
  value: string;
}

function StatusValueChip({ label, value }: StatusValueChipProps) {
  return (
    <span className="desktop-value-chip">
      <span className="desktop-value-chip-label">{label}</span>
      <span className="desktop-value-chip-value">{value}</span>
    </span>
  );
}

interface GamesAndAppsSectionProps {
  apkDiscoveryState: ApkDiscoveryState;
  apkInstallState: InstallState;
  desktopSettings: DesktopSettings | null;
  managedLibraryState: ManagedLibraryState;
  onChooseManualApk: () => void;
  onImportCandidate: (sourcePath: string) => void;
  onInstallApk: (apkPath: string) => void;
  onRescan: () => void;
}

function GamesAndAppsSection({
  apkDiscoveryState,
  apkInstallState,
  desktopSettings,
  managedLibraryState,
  onChooseManualApk,
  onImportCandidate,
  onInstallApk,
  onRescan,
}: GamesAndAppsSectionProps) {
  const discoverySnapshot = apkDiscoveryState.snapshot;
  const librarySnapshot = managedLibraryState.snapshot;
  const importedSourcePathKeys = new Set(
    managedLibraryState.snapshot?.items.flatMap((item) => [
      pathIdentityKey(item.originalSourcePath),
      pathIdentityKey(item.managedPath),
    ]) ?? [],
  );
  const manualCandidateImported =
    apkDiscoveryState.manualCandidate !== null &&
    importedSourcePathKeys.has(pathIdentityKey(apkDiscoveryState.manualCandidate.sourcePath));
  const scanFolderCount = desktopSettings?.scanFolders.length ?? 0;

  return (
    <section className="desktop-section-stack">
      <section className="desktop-section-header">
        <div>
          <div className="eyebrow">Games &amp; Apps</div>
          <h2>Choose a game or app from this computer.</h2>
          <p className="panel-description">
            BE Home can check your chosen folders, keep saved copies in one library, or let you
            pick a file manually whenever you want.
          </p>
        </div>
        <div className="desktop-inline-button-row">
          <button className="primary-button" onClick={onChooseManualApk} type="button">
            Choose Game or App
          </button>
          <button
            className="secondary-button"
            disabled={apkDiscoveryState.loading || managedLibraryState.loading}
            onClick={onRescan}
            type="button"
          >
            {apkDiscoveryState.loading || managedLibraryState.loading ? "Refreshing..." : "Rescan"}
          </button>
        </div>
      </section>

      <section className="desktop-summary-row">
        <StatusValueChip
          label="Folders"
          value={scanFolderCount === 0 ? "Manual choice only" : `${scanFolderCount} selected`}
        />
        <StatusValueChip
          label="Saved library"
          value={librarySnapshot === null ? "Loading..." : `${librarySnapshot.items.length} saved`}
        />
      </section>

      {apkInstallState.message !== null ? (
        <article
          className={
            apkInstallState.lastStatus === "failed"
              ? "desktop-inline-message desktop-inline-message--warning"
              : "desktop-inline-message desktop-inline-message--success"
          }
        >
          <h3>{apkInstallState.message}</h3>
          {apkInstallState.detail !== null ? <p>{apkInstallState.detail}</p> : null}
        </article>
      ) : null}

      <section className="desktop-two-column-grid">
        <article className="desktop-content-card">
          <div className="eyebrow">Found on This Computer</div>
          <h3>Folders BE Home can already see</h3>
          <p className="desktop-section-copy">
            {scanFolderCount === 0
              ? "No folders are selected right now. You can still choose a file manually."
              : "These are the strongest matches from your selected folders."}
          </p>

          {apkDiscoveryState.errorMessage !== null ? (
            <article className="desktop-inline-message desktop-inline-message--warning">
              <h3>{apkDiscoveryState.errorMessage}</h3>
              {apkDiscoveryState.errorDetail !== null ? <p>{apkDiscoveryState.errorDetail}</p> : null}
            </article>
          ) : discoverySnapshot === null ? (
            <article className="desktop-inline-card">
              <h3>Loading games and apps</h3>
              <p>BE Home is checking the folders you selected.</p>
            </article>
          ) : discoverySnapshot.candidates.length === 0 ? (
            <article className="desktop-inline-card">
              <h3>{discoverySnapshot.summary}</h3>
              <p>{discoverySnapshot.guidance}</p>
            </article>
          ) : (
            <ul className="desktop-entity-list">
              {discoverySnapshot.candidates.map((candidate) => (
                <li className="desktop-entity-item" key={candidate.stableId}>
                  <div className="desktop-entity-copy">
                    <h4>{candidate.fileName}</h4>
                    <p>{candidate.packageName ?? "Package name not available yet"}</p>
                    <p className="desktop-entity-meta">
                      {candidate.discoveredFromPath ?? candidate.sourcePath} ·{" "}
                      {formatFileSize(candidate.fileSizeBytes)}
                    </p>
                  </div>
                  <div className="desktop-entity-actions">
                    <span className="desktop-entity-pill">{apkConfidenceLabel(candidate.confidence)}</span>
                    <div className="desktop-inline-action-stack">
                      <button
                        className="primary-button desktop-inline-button"
                        disabled={apkInstallState.actionPath === candidate.sourcePath}
                        onClick={() => onInstallApk(candidate.sourcePath)}
                        type="button"
                      >
                        {apkInstallState.actionPath === candidate.sourcePath ? "Installing..." : "Install"}
                      </button>
                      <button
                        className="secondary-button desktop-inline-button"
                        disabled={managedLibraryState.actionPath === candidate.sourcePath}
                        onClick={() => onImportCandidate(candidate.sourcePath)}
                        type="button"
                      >
                        {managedLibraryState.actionPath === candidate.sourcePath
                          ? "Saving..."
                          : "Save Copy"}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="desktop-content-card">
          <div className="eyebrow">Chosen Manually</div>
          <h3>Use any game or app file you already trust.</h3>
          <p className="desktop-section-copy">
            If you already know which file you want, you can choose it directly even when no scan
            folders are selected.
          </p>

          {apkDiscoveryState.manualCandidate === null ? (
            <article className="desktop-inline-card">
              <h3>No file chosen yet</h3>
              <p>Choose a game or app to install it right away or save a copy for later.</p>
            </article>
          ) : (
            <article className="desktop-manual-card">
              <h4>{apkDiscoveryState.manualCandidate.fileName}</h4>
              <p>{apkDiscoveryState.manualCandidate.packageName ?? "Package name not available yet"}</p>
              <p className="desktop-entity-meta">
                {apkConfidenceLabel(apkDiscoveryState.manualCandidate.confidence)}
              </p>
              {apkDiscoveryState.manualCandidate.confidence !== "strongMatch" ? (
                <article className="desktop-inline-message desktop-inline-message--warning">
                  <h3>BE Home could not fully confirm this file for Board.</h3>
                  <p>
                    If this is the file you want, you can still install it now or save a copy for
                    later.
                  </p>
                </article>
              ) : null}
              <div className="desktop-inline-action-stack">
                <button
                  className="primary-button desktop-inline-button"
                  disabled={apkInstallState.actionPath === apkDiscoveryState.manualCandidate.sourcePath}
                  onClick={() => onInstallApk(apkDiscoveryState.manualCandidate!.sourcePath)}
                  type="button"
                >
                  {apkInstallState.actionPath === apkDiscoveryState.manualCandidate.sourcePath
                    ? "Installing..."
                    : "Install"}
                </button>
                <button
                  className="secondary-button desktop-inline-button"
                  disabled={
                    managedLibraryState.actionPath === apkDiscoveryState.manualCandidate.sourcePath ||
                    manualCandidateImported
                  }
                  onClick={() => onImportCandidate(apkDiscoveryState.manualCandidate!.sourcePath)}
                  type="button"
                >
                  {managedLibraryState.actionPath === apkDiscoveryState.manualCandidate.sourcePath
                    ? "Saving..."
                    : manualCandidateImported
                      ? "Saved Copy Ready"
                      : "Save Copy"}
                </button>
              </div>
            </article>
          )}
        </article>
      </section>

      <article className="desktop-content-card">
        <div className="eyebrow">Saved Library</div>
        <h3>Saved copies you can reuse later</h3>
        <p className="desktop-section-copy">
          BE Home keeps saved copies here so reinstalling later takes fewer steps.
        </p>

        {managedLibraryState.actionMessage !== null ? (
          <article className="desktop-inline-message desktop-inline-message--success">
            <h3>{managedLibraryState.actionMessage}</h3>
            {managedLibraryState.actionDetail !== null ? <p>{managedLibraryState.actionDetail}</p> : null}
          </article>
        ) : null}

        {managedLibraryState.errorMessage !== null ? (
          <article className="desktop-inline-message desktop-inline-message--warning">
            <h3>{managedLibraryState.errorMessage}</h3>
            {managedLibraryState.errorDetail !== null ? <p>{managedLibraryState.errorDetail}</p> : null}
          </article>
        ) : librarySnapshot === null ? (
          <article className="desktop-inline-card">
            <h3>Loading your saved library</h3>
            <p>BE Home is loading the copies you already saved.</p>
          </article>
        ) : librarySnapshot.items.length === 0 ? (
          <article className="desktop-inline-card">
            <h3>{librarySnapshot.summary}</h3>
            <p>{librarySnapshot.guidance}</p>
          </article>
        ) : (
          <ul className="desktop-entity-list">
            {librarySnapshot.items.map((item) => (
              <li className="desktop-entity-item" key={item.stableId}>
                <div className="desktop-entity-copy">
                  <h4>{item.fileName}</h4>
                  <p>{item.packageName ?? "Package name not available yet"}</p>
                  <p className="desktop-entity-meta">
                    Saved {formatTimestamp(item.importedAtUnixMs)} · {formatFileSize(item.fileSizeBytes)}
                  </p>
                </div>
                <div className="desktop-entity-actions">
                  <button
                    className="primary-button desktop-inline-button"
                    disabled={apkInstallState.actionPath === item.managedPath}
                    onClick={() => onInstallApk(item.managedPath)}
                    type="button"
                  >
                    {apkInstallState.actionPath === item.managedPath ? "Installing..." : "Install"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

interface InstalledOnBoardSectionProps {
  installedTitleActionState: InstalledTitleActionState;
  installedTitlesState: InstalledTitlesState;
  onCancelUninstall: () => void;
  onLaunchTitle: (packageName: string, displayName: string) => void;
  onRefresh: () => void;
  onRequestUninstall: (packageName: string) => void;
  onUninstallTitle: (packageName: string, displayName: string) => void;
}

function InstalledOnBoardSection({
  installedTitleActionState,
  installedTitlesState,
  onCancelUninstall,
  onLaunchTitle,
  onRefresh,
  onRequestUninstall,
  onUninstallTitle,
}: InstalledOnBoardSectionProps) {
  const snapshot = installedTitlesState.snapshot;

  return (
    <section className="desktop-section-stack">
      <section className="desktop-section-header">
        <div>
          <div className="eyebrow">Installed on Board</div>
          <h2>Review what is already on your Board.</h2>
          <p className="panel-description">
            Open a game that is ready to launch, or remove something you no longer want on the
            device.
          </p>
        </div>
        <div className="desktop-inline-button-row">
          <button
            className="secondary-button"
            disabled={installedTitlesState.loading}
            onClick={onRefresh}
            type="button"
          >
            {installedTitlesState.loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {installedTitleActionState.message !== null ? (
        <article
          className={
            installedTitleActionState.tone === "warning"
              ? "desktop-inline-message desktop-inline-message--warning"
              : "desktop-inline-message desktop-inline-message--success"
          }
        >
          <h3>{installedTitleActionState.message}</h3>
          {installedTitleActionState.detail !== null ? <p>{installedTitleActionState.detail}</p> : null}
        </article>
      ) : null}

      <article className="desktop-content-card">
        <div className="eyebrow">Current List</div>
        <h3>Titles BE Home can read right now</h3>
        <p className="desktop-section-copy">
          BE Home keeps launch and remove actions next to the title they affect.
        </p>

        {installedTitlesState.errorMessage !== null ? (
          <article className="desktop-inline-message desktop-inline-message--warning">
            <h3>{installedTitlesState.errorMessage}</h3>
            {installedTitlesState.errorDetail !== null ? <p>{installedTitlesState.errorDetail}</p> : null}
          </article>
        ) : snapshot === null ? (
          <article className="desktop-inline-card">
            <h3>Loading installed titles</h3>
            <p>BE Home is asking Board for the latest list.</p>
          </article>
        ) : snapshot.titles.length === 0 ? (
          <article className="desktop-inline-card">
            <h3>{snapshot.summary}</h3>
            <p>{snapshot.guidance}</p>
          </article>
        ) : (
          <ul className="desktop-entity-list">
            {snapshot.titles.map((title) => (
              <li className="desktop-entity-item" key={title.stableId}>
                <div className="desktop-entity-copy">
                  <h4>{title.displayName}</h4>
                  <p>{title.subtitle ?? "Package details are not available yet"}</p>
                </div>
                <div className="desktop-entity-actions">
                  {title.packageName !== null && title.canUninstall ? (
                    installedTitleActionState.confirmPackage === title.packageName ? (
                      <div className="desktop-inline-action-stack">
                        <button
                          className="primary-button desktop-inline-button"
                          disabled={installedTitleActionState.actionPackage === title.packageName}
                          onClick={() => onUninstallTitle(title.packageName!, title.displayName)}
                          type="button"
                        >
                          {installedTitleActionState.actionPackage === title.packageName &&
                          installedTitleActionState.actionKind === "uninstall"
                            ? "Removing..."
                            : "Confirm Remove"}
                        </button>
                        <button
                          className="secondary-button desktop-inline-button"
                          disabled={installedTitleActionState.actionPackage === title.packageName}
                          onClick={onCancelUninstall}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="desktop-inline-action-stack">
                        {title.canLaunch ? (
                          <button
                            className="primary-button desktop-inline-button"
                            disabled={installedTitleActionState.actionPackage === title.packageName}
                            onClick={() => onLaunchTitle(title.packageName!, title.displayName)}
                            type="button"
                          >
                            {installedTitleActionState.actionPackage === title.packageName &&
                            installedTitleActionState.actionKind === "launch"
                              ? "Opening..."
                              : "Open on Board"}
                          </button>
                        ) : null}
                        <button
                          className="secondary-button desktop-inline-button"
                          disabled={installedTitleActionState.actionPackage === title.packageName}
                          onClick={() => onRequestUninstall(title.packageName!)}
                          type="button"
                        >
                          Remove from Board
                        </button>
                      </div>
                    )
                  ) : (
                    <span className="desktop-entity-pill">Read only</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

function buildBoardStatusPresentation(
  snapshot: DeviceStatusSnapshot | null,
  setupGateState: SetupGateState | null,
  deviceState: DeviceState,
): BoardStatusPresentation {
  if (setupGateState?.toolState.status === "unsupported" || snapshot?.status === "unsupportedHost") {
    return {
      tone: "neutral",
      label: "Board support unavailable",
      tooltip:
        "Gray means Board does not currently publish support for this computer, so BE Home cannot check Board status here.",
    };
  }

  if (snapshot === null) {
    return {
      tone: "neutral",
      label: "Checking Board",
      tooltip: "BE Home is checking for your Board now.",
    };
  }

  switch (snapshot.status) {
    case "boardConnected":
      return {
        tone: "success",
        label: "Board connected",
        tooltip: "Green means BE Home can see your Board right now.",
      };
    case "boardDisconnected":
      return {
        tone: "danger",
        label: "Board not connected",
        tooltip:
          "Red means BE Home cannot see a connected Board right now. Plug in your Board and wake it if needed.",
      };
    case "toolMissing":
    case "toolBroken":
    case "executionError":
    default:
      return {
        tone: "warning",
        label: "Board needs attention",
        tooltip:
          deviceState.errorDetail ??
          "Amber means BE Home needs a quick fix or retry before it can trust the current Board status.",
      };
  }
}

function apkConfidenceLabel(value: ApkCandidate["confidence"]): string {
  switch (value) {
    case "strongMatch":
      return "Strong match";
    case "possibleMatch":
      return "Possible match";
    case "unknown":
    default:
      return "Board match unclear";
  }
}

function formatFileSize(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${value} bytes`;
}

function formatTimestamp(value: number): string {
  if (value <= 0) {
    return "just now";
  }

  return new Date(value).toLocaleString();
}

function pathIdentityKey(path: string): string {
  return path.toLowerCase();
}

function extractActionErrorDetail(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

async function pickSinglePath(selection: string | string[] | null): Promise<string | null> {
  if (selection === null) {
    return null;
  }

  if (Array.isArray(selection)) {
    return selection[0] ?? null;
  }

  return selection;
}
