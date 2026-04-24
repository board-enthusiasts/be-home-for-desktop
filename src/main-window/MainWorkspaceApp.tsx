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
  openSettingsWindow,
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
import {
  MAIN_WORKSPACE_NAVIGATE_EVENT,
  MAIN_WORKSPACE_RESCAN_EVENT,
  SETTINGS_UPDATED_EVENT,
  type MainWorkspaceNavigationEvent,
} from "../desktop-shell/constants";
import { DetailRow, StatusChip, StatusSummaryCard } from "../desktop-shell/ui";

type WorkspaceSectionId = "device" | "apkLibrary" | "installed";

interface WorkspaceSection {
  id: WorkspaceSectionId;
  label: string;
  eyebrow: string;
}

type DeviceGuidanceAction = "refresh" | "settings";

interface DeviceGuidanceContent {
  eyebrow: string;
  title: string;
  summary: string;
  steps: string[];
  tone: "success" | "warning" | "neutral";
  primaryAction: DeviceGuidanceAction;
  primaryActionLabel: string;
  secondaryAction?: DeviceGuidanceAction;
  secondaryActionLabel?: string;
}

const DEFAULT_DEVICE_POLL_INTERVAL_MS = 5_000;

const workspaceSections: WorkspaceSection[] = [
  {
    id: "device",
    label: "Device",
    eyebrow: "Board connection",
  },
  {
    id: "apkLibrary",
    label: "APK Library",
    eyebrow: "Local APKs",
  },
  {
    id: "installed",
    label: "Installed on Board",
    eyebrow: "Current titles",
  },
];

export default function MainWorkspaceApp() {
  const [setupGateState, setSetupGateState] = useState<SetupGateState | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deviceStatusState, setDeviceStatusState] = useState<{
    loading: boolean;
    snapshot: DeviceStatusSnapshot | null;
    errorMessage: string | null;
    errorDetail: string | null;
  }>({
    loading: false,
    snapshot: null,
    errorMessage: null,
    errorDetail: null,
  });
  const [installedTitlesState, setInstalledTitlesState] = useState<{
    loading: boolean;
    snapshot: InstalledTitlesSnapshot | null;
    errorMessage: string | null;
    errorDetail: string | null;
  }>({
    loading: false,
    snapshot: null,
    errorMessage: null,
    errorDetail: null,
  });
  const [apkDiscoveryState, setApkDiscoveryState] = useState<{
    loading: boolean;
    snapshot: ApkDiscoverySnapshot | null;
    manualCandidate: ApkCandidate | null;
    errorMessage: string | null;
    errorDetail: string | null;
  }>({
    loading: false,
    snapshot: null,
    manualCandidate: null,
    errorMessage: null,
    errorDetail: null,
  });
  const [managedLibraryState, setManagedLibraryState] = useState<{
    loading: boolean;
    snapshot: ManagedApkLibrarySnapshot | null;
    errorMessage: string | null;
    errorDetail: string | null;
    actionPath: string | null;
    actionMessage: string | null;
    actionDetail: string | null;
  }>({
    loading: false,
    snapshot: null,
    errorMessage: null,
    errorDetail: null,
    actionPath: null,
    actionMessage: null,
    actionDetail: null,
  });
  const [apkInstallState, setApkInstallState] = useState<{
    actionPath: string | null;
    message: string | null;
    detail: string | null;
    lastStatus: InstallApkResult["status"] | null;
  }>({
    actionPath: null,
    message: null,
    detail: null,
    lastStatus: null,
  });
  const apkInstallInFlightRef = useRef(false);
  const [installedTitleActionState, setInstalledTitleActionState] = useState<{
    actionKind: "launch" | "uninstall" | null;
    actionPackage: string | null;
    confirmPackage: string | null;
    message: string | null;
    detail: string | null;
    tone: "success" | "warning" | null;
  }>({
    actionKind: null,
    actionPackage: null,
    confirmPackage: null,
    message: null,
    detail: null,
    tone: null,
  });
  const [windowFocused, setWindowFocused] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  const [activeWorkspaceSection, setActiveWorkspaceSection] =
    useState<WorkspaceSectionId>("device");

  useEffect(() => {
    void refreshSetupGateState();
  }, []);

  useEffect(() => {
    if (setupGateState?.status === "ready") {
      void refreshDesktopSettings();
      return;
    }

    setDesktopSettings(null);
  }, [setupGateState?.status]);

  const devicePollIntervalMs =
    deviceStatusState.snapshot?.pollIntervalMs ?? DEFAULT_DEVICE_POLL_INTERVAL_MS;
  const devicePollingActive =
    setupGateState?.status === "ready" && documentVisible && windowFocused;

  const refreshDeviceStatus = useEffectEvent(
    async (source: "initial" | "poll" | "manual" = "manual"): Promise<void> => {
      if (setupGateState?.status !== "ready") {
        return;
      }

      if (source !== "poll") {
        setDeviceStatusState((previous) => ({
          ...previous,
          loading: true,
          errorMessage: null,
          errorDetail: null,
        }));
      }

      try {
        const snapshot = await loadDeviceStatusSnapshot();
        setDeviceStatusState({
          loading: false,
          snapshot,
          errorMessage: null,
          errorDetail: null,
        });
      } catch {
        setDeviceStatusState((previous) => ({
          loading: false,
          snapshot: previous.snapshot,
          errorMessage: "BE Home couldn't refresh the latest Board connection check.",
          errorDetail:
            source === "poll"
              ? "We'll keep trying again while the desktop window stays visible."
              : "Please try refreshing the device check again in a moment.",
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
          errorMessage: "BE Home couldn't refresh the installed titles right now.",
          errorDetail:
            source === "initial"
              ? "The first installed-title read did not finish cleanly. You can try again from the Installed on Board section."
              : "Please try refreshing the installed titles again in a moment.",
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
          errorMessage: "BE Home couldn't refresh the current APK scan just yet.",
          errorDetail:
            source === "initial"
              ? "You can try again from the APK Library section once the workspace finishes loading."
              : "Please try rescanning the current folders again in a moment.",
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
          errorMessage: "BE Home couldn't refresh the managed APK library right now.",
          errorDetail:
            source === "initial"
              ? "The first library read did not finish cleanly. You can try again from the APK Library section."
              : "Please try refreshing the managed library again in a moment.",
        }));
      }
    },
  );

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

  useEffect(() => {
    if (setupGateState?.status !== "ready") {
      setDeviceStatusState({
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
  }, [
    devicePollIntervalMs,
    documentVisible,
    setupGateState?.status,
    windowFocused,
  ]);

  useEffect(() => {
    if (setupGateState?.status !== "ready") {
      setInstalledTitlesState({
        loading: false,
        snapshot: null,
        errorMessage: null,
        errorDetail: null,
      });
      return;
    }

    void refreshInstalledTitles("initial");
  }, [setupGateState?.status]);

  useEffect(() => {
    if (setupGateState?.status !== "ready") {
      setApkDiscoveryState({
        loading: false,
        snapshot: null,
        manualCandidate: null,
        errorMessage: null,
        errorDetail: null,
      });
      return;
    }

    void refreshApkDiscovery("initial");
  }, [setupGateState?.status]);

  useEffect(() => {
    if (setupGateState?.status !== "ready") {
      setManagedLibraryState({
        loading: false,
        snapshot: null,
        errorMessage: null,
        errorDetail: null,
        actionPath: null,
        actionMessage: null,
        actionDetail: null,
      });
      return;
    }

    void refreshManagedLibrary("initial");
  }, [setupGateState?.status]);

  async function refreshSetupGateState(): Promise<void> {
    try {
      const state = await loadSetupGateState();
      setSetupGateState(state);
      setErrorMessage(null);
    } catch {
      setErrorMessage(
        "We couldn't reach the desktop host just yet. Try reloading the window or restarting the app.",
      );
    }
  }

  async function refreshDesktopSettings(): Promise<void> {
    try {
      const settings = await loadDesktopSettings();
      setDesktopSettings(settings);
    } catch {
      setErrorMessage(
        "BE Home couldn't load the latest folder settings just yet. Try reopening the main window.",
      );
    }
  }

  const handleShellNavigation = useEffectEvent((payload: MainWorkspaceNavigationEvent) => {
    const nextSection = payload.target === "installedOnBoard" ? "installed" : "apkLibrary";
    setActiveWorkspaceSection(nextSection);

    if (nextSection === "installed") {
      void refreshInstalledTitles("manual");
      return;
    }

    void refreshApkDiscovery("manual");
    void refreshManagedLibrary("manual");
  });

  const handleShellRescan = useEffectEvent(() => {
    setActiveWorkspaceSection("apkLibrary");
    void refreshApkDiscovery("manual");
    void refreshManagedLibrary("manual");
  });

  const handleSettingsUpdated = useEffectEvent(() => {
    void refreshSetupGateState();
    void refreshDesktopSettings();
    void refreshApkDiscovery("manual");
    void refreshManagedLibrary("manual");
    void refreshDeviceStatus("manual");
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

  async function handleOpenSettingsWindow(): Promise<void> {
    await openSettingsWindow();
  }

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
        errorMessage: "BE Home couldn't add that APK to the managed library just yet.",
        errorDetail: "Please try the same file again in a moment.",
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
        message: "BE Home couldn't finish that install request just yet.",
        detail: extractActionErrorDetail(
          error,
          "Please keep Board connected and try the same APK again in a moment.",
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
        message: `BE Home couldn't remove ${displayName} just yet.`,
        detail: "Please keep Board connected and try removing the title again in a moment.",
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
        message: `BE Home couldn't launch ${displayName} just yet.`,
        detail: "Please keep Board connected and try opening the title again in a moment.",
        tone: "warning",
      });
      return null;
    }
  }

  async function handleChooseManualApk(): Promise<void> {
    const selectedPath = await pickSinglePath(
      await open({
        directory: false,
        filters: [
          {
            name: "Android Packages",
            extensions: ["apk"],
          },
        ],
        multiple: false,
        defaultPath:
          desktopSettings?.scanFolders[0]?.path ?? desktopSettings?.apkLibrary.effectivePath,
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
        errorMessage: "BE Home couldn't inspect that APK just yet.",
        errorDetail: "Choose another `.apk` file or try the same file again in a moment.",
      }));
    }
  }

  if (errorMessage !== null) {
    return (
      <main className="page-shell desktop-shell">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">We couldn't open the desktop app</div>
            <h2>Please close BE Home for Desktop and try again.</h2>
            <p className="panel-description">{errorMessage}</p>
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
            <h2>Just a moment while we check your setup.</h2>
            <p className="panel-description">
              We're checking whether Board's install tool is ready and whether your desktop
              workspace can open.
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
          <section className="hero-panel compact desktop-banner">
            <div className="hero-copy desktop-banner-copy">
              <div className="eyebrow">Setup required</div>
              <h1>Finish setup in the wizard before opening the workspace.</h1>
              <p>{setupGateState.summary}</p>
              <p className="desktop-platform-note">
                {setupGateState.platformLabel} desktop · v{setupGateState.version}
              </p>
            </div>
            <div className="desktop-highlight-row" aria-label="Setup status">
              <StatusChip label="Setup" value="Wizard required" />
              <StatusChip label="Board tool" value={setupGateState.toolState.summary} />
            </div>
          </section>

          <section className="panel desktop-workspace-panel">
            <div className="eyebrow">Next step</div>
            <h2>Open the setup wizard to continue.</h2>
            <p className="panel-description">
              The desktop shell is ready, but BE Home still needs to finish setup before the main
              workspace should be used.
            </p>
            <StatusSummaryCard
              title="Current setup state"
              summary={setupGateState.summary}
              guidance={setupGateState.guidance}
            />
            <div className="desktop-action-row">
              <button className="primary-button" onClick={() => void handleOpenSetupWizard()} type="button">
                Open setup wizard
              </button>
            </div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell desktop-shell">
      <section className="page-grid desktop-grid">
        <section className="hero-panel compact desktop-banner">
          <div className="hero-copy desktop-banner-copy">
            <div className="eyebrow">BE Home for Desktop</div>
            <h1>Your desktop install space is ready.</h1>
            <p>
              Keep Board checks, local APK choices, and installed-title actions in one desktop
              workspace instead of bouncing between tools.
            </p>
            <p className="desktop-platform-note">
              {setupGateState.platformLabel} desktop · v{setupGateState.version}
            </p>
          </div>
          <div className="desktop-highlight-row" aria-label="Workspace summary">
            <StatusChip label="Board tool" value={setupGateState.toolState.summary} />
            <StatusChip
              label="Library"
              value={desktopSettings?.apkLibrary.effectivePath ?? "Loading..."}
            />
            <StatusChip
              label="Scan folders"
              value={
                desktopSettings === null
                  ? "Loading..."
                  : desktopSettings.scanFolders.length === 0
                    ? "Manual picks only"
                    : `${desktopSettings.scanFolders.length} configured`
              }
            />
          </div>
        </section>

        <section className="desktop-workspace-layout">
          <aside className="panel desktop-nav-panel" aria-label="Workspace navigation">
            <div className="eyebrow">Workspace</div>
            <h2>Choose the area you want to keep close.</h2>
            <nav className="desktop-nav-list">
              {workspaceSections.map((section) => (
                <button
                  className={
                    section.id === activeWorkspaceSection
                      ? "desktop-nav-button desktop-nav-button--active"
                      : "desktop-nav-button"
                  }
                  key={section.id}
                  onClick={() => setActiveWorkspaceSection(section.id)}
                  type="button"
                >
                  <span className="desktop-nav-label">{section.label}</span>
                  <span className="desktop-nav-summary">{section.eyebrow}</span>
                </button>
              ))}
            </nav>
          </aside>

          <section className="desktop-workspace-main">
            {activeWorkspaceSection === "device" ? (
              <DeviceWorkspacePanel
                deviceStatusState={deviceStatusState}
                pollingActive={devicePollingActive}
                setupGateState={setupGateState}
                onOpenSettings={() => void handleOpenSettingsWindow()}
                onRefresh={() => void refreshDeviceStatus("manual")}
              />
            ) : null}

            {activeWorkspaceSection === "apkLibrary" ? (
              <ApkLibraryWorkspacePanel
                apkDiscoveryState={apkDiscoveryState}
                apkInstallState={apkInstallState}
                desktopSettings={desktopSettings}
                managedLibraryState={managedLibraryState}
                onChooseManualApk={() => void handleChooseManualApk()}
                onImportCandidate={(sourcePath) => void handleImportApkIntoManagedLibrary(sourcePath)}
                onInstallApk={(apkPath) => void handleInstallApk(apkPath)}
                onRefresh={() => void refreshApkDiscovery("manual")}
                onRefreshManagedLibrary={() => void refreshManagedLibrary("manual")}
              />
            ) : null}

            {activeWorkspaceSection === "installed" ? (
              <InstalledTitlesWorkspacePanel
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
            ) : null}
          </section>
        </section>
      </section>
    </main>
  );
}

interface ApkLibraryWorkspacePanelProps {
  apkDiscoveryState: {
    loading: boolean;
    snapshot: ApkDiscoverySnapshot | null;
    manualCandidate: ApkCandidate | null;
    errorMessage: string | null;
    errorDetail: string | null;
  };
  apkInstallState: {
    actionPath: string | null;
    message: string | null;
    detail: string | null;
    lastStatus: InstallApkResult["status"] | null;
  };
  desktopSettings: DesktopSettings | null;
  managedLibraryState: {
    loading: boolean;
    snapshot: ManagedApkLibrarySnapshot | null;
    errorMessage: string | null;
    errorDetail: string | null;
    actionPath: string | null;
    actionMessage: string | null;
    actionDetail: string | null;
  };
  onInstallApk: (apkPath: string) => void;
  onChooseManualApk: () => void;
  onImportCandidate: (sourcePath: string) => void;
  onRefresh: () => void;
  onRefreshManagedLibrary: () => void;
}

function ApkLibraryWorkspacePanel({
  apkDiscoveryState,
  apkInstallState,
  desktopSettings,
  managedLibraryState,
  onInstallApk,
  onChooseManualApk,
  onImportCandidate,
  onRefresh,
  onRefreshManagedLibrary,
}: ApkLibraryWorkspacePanelProps) {
  const discoverySnapshot = apkDiscoveryState.snapshot;
  const librarySnapshot = managedLibraryState.snapshot;
  const scanFolderCount = desktopSettings?.scanFolders.length ?? 0;
  const importedSourcePathKeys = new Set(
    managedLibraryState.snapshot?.items.flatMap((item) => [
      pathIdentityKey(item.originalSourcePath),
      pathIdentityKey(item.managedPath),
    ]) ?? [],
  );
  const manualCandidateImported =
    apkDiscoveryState.manualCandidate !== null &&
    importedSourcePathKeys.has(pathIdentityKey(apkDiscoveryState.manualCandidate.sourcePath));

  return (
    <>
      <article className="panel desktop-workspace-panel">
        <div className="eyebrow">APK Library</div>
        <h2>Keep local APK discovery simple and repeatable.</h2>
        <p className="panel-description">
          BE Home can walk your configured scan folders for `.apk` files, then keep manual file
          picks on the same discovery model so the later heuristic and library steps have one place
          to build from.
        </p>

        {discoverySnapshot !== null ? (
          <article
            className={`desktop-status-band desktop-status-band--${apkDiscoveryStatusTone(discoverySnapshot.status)}`}
          >
            <span className="desktop-status-band-label">
              {apkDiscoveryStatusLabel(discoverySnapshot.status)}
            </span>
            <h3>{discoverySnapshot.summary}</h3>
            <p>{discoverySnapshot.guidance}</p>
          </article>
        ) : null}

        {apkDiscoveryState.errorMessage !== null ? (
          <article className="desktop-inline-message desktop-inline-message--warning">
            <h3>{apkDiscoveryState.errorMessage}</h3>
            {apkDiscoveryState.errorDetail !== null ? <p>{apkDiscoveryState.errorDetail}</p> : null}
          </article>
        ) : null}

        {apkInstallState.message !== null ? (
          <article
            className={
              apkInstallState.lastStatus === "failed"
                ? "desktop-inline-message desktop-inline-message--warning"
                : "desktop-inline-message"
            }
          >
            <h3>{apkInstallState.message}</h3>
            {apkInstallState.detail !== null ? <p>{apkInstallState.detail}</p> : null}
          </article>
        ) : null}

        <dl className="desktop-detail-grid">
          <DetailRow
            label="Scan folders"
            value={scanFolderCount === 0 ? "No folders configured yet" : String(scanFolderCount)}
          />
          <DetailRow
            label="Scanned APKs"
            value={discoverySnapshot ? String(discoverySnapshot.candidates.length) : "Loading..."}
          />
          <DetailRow
            label="Manual pick"
            value={
              apkDiscoveryState.manualCandidate?.fileName ??
              "Choose an `.apk` when you already know the file you want."
            }
          />
        </dl>

        <div className="desktop-action-row">
          <button
            className="primary-button"
            disabled={apkDiscoveryState.loading}
            onClick={onChooseManualApk}
            type="button"
          >
            Choose APK
          </button>
          <button
            className="secondary-button"
            disabled={apkDiscoveryState.loading}
            onClick={onRefresh}
            type="button"
          >
            {apkDiscoveryState.loading ? "Scanning..." : "Rescan folders"}
          </button>
        </div>
      </article>

      <article className="panel desktop-workspace-panel">
        <div className="eyebrow">Current candidates</div>
        <h2>See what BE Home has already discovered.</h2>
        <p className="panel-description">
          Duplicate scan results stay collapsed to a stable path-based identity, so rescans do not
          fill this list with repeat entries.
        </p>

        {apkDiscoveryState.manualCandidate !== null ? (
          <article
            className={
              apkDiscoveryState.manualCandidate.confidence === "strongMatch"
                ? "desktop-inline-card"
                : "desktop-inline-message desktop-inline-message--warning"
            }
          >
            <h3>Latest manual APK pick</h3>
            <p>{apkDiscoveryState.manualCandidate.fileName}</p>
            <p>{apkConfidenceLabel(apkDiscoveryState.manualCandidate.confidence)}</p>
            <p>{apkDiscoveryState.manualCandidate.confidenceSummary}</p>
            {apkDiscoveryState.manualCandidate.packageName !== null ? (
              <p>{apkDiscoveryState.manualCandidate.packageName}</p>
            ) : null}
            <div className="desktop-action-row">
              <button
                className="primary-button"
                disabled={apkInstallState.actionPath !== null}
                onClick={() => onInstallApk(apkDiscoveryState.manualCandidate!.sourcePath)}
                type="button"
              >
                {apkInstallState.actionPath === apkDiscoveryState.manualCandidate.sourcePath
                  ? "Installing..."
                  : apkDiscoveryState.manualCandidate.confidence === "strongMatch"
                    ? "Install on Board"
                    : "Install anyway"}
              </button>
              <button
                className="secondary-button"
                disabled={
                  managedLibraryState.actionPath === apkDiscoveryState.manualCandidate.sourcePath ||
                  manualCandidateImported
                }
                onClick={() => onImportCandidate(apkDiscoveryState.manualCandidate!.sourcePath)}
                type="button"
              >
                {managedLibraryState.actionPath === apkDiscoveryState.manualCandidate.sourcePath
                  ? "Copying..."
                  : manualCandidateImported
                    ? "Already in library"
                    : "Keep a copy"}
              </button>
            </div>
          </article>
        ) : null}

        {discoverySnapshot === null ? (
          <article className="desktop-inline-card">
            <h3>Scanning the current APK folders.</h3>
            <p>BE Home is walking the configured folders for `.apk` files now.</p>
          </article>
        ) : discoverySnapshot.candidates.length === 0 ? (
          <article className="desktop-inline-card">
            <h3>{discoverySnapshot.summary}</h3>
            <p>{discoverySnapshot.guidance}</p>
          </article>
        ) : (
          <ul className="desktop-inventory-list">
            {discoverySnapshot.candidates.map((candidate) => (
              <li className="desktop-inventory-item" key={candidate.stableId}>
                <div className="desktop-inventory-copy">
                  <h3>{candidate.fileName}</h3>
                  <p>{candidate.sourcePath}</p>
                </div>
                <div className="desktop-inventory-side">
                  <div className="desktop-inventory-meta">
                    <span className="desktop-inventory-pill">
                      {apkConfidenceLabel(candidate.confidence)}
                    </span>
                    <span className="desktop-inventory-pill">
                      {formatFileSize(candidate.fileSizeBytes)}
                    </span>
                  </div>
                  <div className="desktop-inline-action-stack">
                    <button
                      className="primary-button desktop-inline-button"
                      disabled={apkInstallState.actionPath !== null}
                      onClick={() => onInstallApk(candidate.sourcePath)}
                      type="button"
                    >
                      {apkInstallState.actionPath === candidate.sourcePath
                        ? "Installing..."
                        : "Install on Board"}
                    </button>
                    <button
                      className="secondary-button desktop-inline-button"
                      disabled={
                        managedLibraryState.actionPath === candidate.sourcePath ||
                        importedSourcePathKeys.has(pathIdentityKey(candidate.sourcePath))
                      }
                      onClick={() => onImportCandidate(candidate.sourcePath)}
                      type="button"
                    >
                      {managedLibraryState.actionPath === candidate.sourcePath
                        ? "Copying..."
                        : importedSourcePathKeys.has(pathIdentityKey(candidate.sourcePath))
                          ? "Already in library"
                          : "Keep a copy"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="panel desktop-workspace-panel">
        <div className="eyebrow">Managed library</div>
        <h2>Keep reusable APK copies in one steady inventory.</h2>
        <p className="panel-description">
          BE Home stores imported APKs as managed copies, keeps the original source path nearby in
          the inventory, and leaves your original downloads where they were.
        </p>

        {librarySnapshot !== null ? (
          <article
            className={`desktop-status-band desktop-status-band--${managedLibraryStatusTone(librarySnapshot.status)}`}
          >
            <span className="desktop-status-band-label">
              {managedLibraryStatusLabel(librarySnapshot.status)}
            </span>
            <h3>{librarySnapshot.summary}</h3>
            <p>{librarySnapshot.guidance}</p>
          </article>
        ) : null}

        {managedLibraryState.actionMessage !== null ? (
          <article className="desktop-inline-message">
            <h3>{managedLibraryState.actionMessage}</h3>
            {managedLibraryState.actionDetail !== null ? (
              <p>{managedLibraryState.actionDetail}</p>
            ) : null}
          </article>
        ) : null}

        {managedLibraryState.errorMessage !== null ? (
          <article className="desktop-inline-message desktop-inline-message--warning">
            <h3>{managedLibraryState.errorMessage}</h3>
            {managedLibraryState.errorDetail !== null ? (
              <p>{managedLibraryState.errorDetail}</p>
            ) : null}
          </article>
        ) : null}

        <dl className="desktop-detail-grid">
          <DetailRow
            label="Managed items"
            value={librarySnapshot ? String(librarySnapshot.items.length) : "Loading..."}
          />
          <DetailRow
            label="Current library folder"
            value={desktopSettings?.apkLibrary.effectivePath ?? "Loading..."}
          />
          <DetailRow label="Copy behavior" value="Original downloads stay in place" />
        </dl>

        <div className="desktop-action-row">
          <button
            className="secondary-button"
            disabled={managedLibraryState.loading}
            onClick={onRefreshManagedLibrary}
            type="button"
          >
            {managedLibraryState.loading ? "Refreshing..." : "Refresh managed library"}
          </button>
        </div>

        {librarySnapshot === null ? (
          <article className="desktop-inline-card">
            <h3>Loading the managed library inventory.</h3>
            <p>BE Home is reading the current managed APK manifest and retained copies.</p>
          </article>
        ) : librarySnapshot.items.length === 0 ? (
          <article className="desktop-inline-card">
            <h3>{librarySnapshot.summary}</h3>
            <p>{librarySnapshot.guidance}</p>
          </article>
        ) : (
          <ul className="desktop-inventory-list">
            {librarySnapshot.items.map((item) => (
              <li className="desktop-inventory-item" key={item.stableId}>
                <div className="desktop-inventory-copy">
                  <h3>{item.fileName}</h3>
                  <p>{item.packageName ?? "Package name not available yet"}</p>
                  <p>Original: {item.originalSourcePath}</p>
                  <p>Managed copy: {item.managedPath}</p>
                </div>
                <div className="desktop-inventory-side">
                  <div className="desktop-inventory-meta">
                    <span className="desktop-inventory-pill">
                      {apkConfidenceLabel(item.confidence)}
                    </span>
                    <span className="desktop-inventory-pill">
                      {formatFileSize(item.fileSizeBytes)}
                    </span>
                  </div>
                  <p className="desktop-library-timestamp">
                    Imported {formatTimestamp(item.importedAtUnixMs)}
                  </p>
                  <button
                    className="primary-button desktop-inline-button"
                    disabled={apkInstallState.actionPath !== null}
                    onClick={() => onInstallApk(item.managedPath)}
                    type="button"
                  >
                    {apkInstallState.actionPath === item.managedPath
                      ? "Installing..."
                      : "Install on Board"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </>
  );
}

interface InstalledTitlesWorkspacePanelProps {
  installedTitleActionState: {
    actionKind: "launch" | "uninstall" | null;
    actionPackage: string | null;
    confirmPackage: string | null;
    message: string | null;
    detail: string | null;
    tone: "success" | "warning" | null;
  };
  installedTitlesState: {
    loading: boolean;
    snapshot: InstalledTitlesSnapshot | null;
    errorMessage: string | null;
    errorDetail: string | null;
  };
  onCancelUninstall: () => void;
  onLaunchTitle: (packageName: string, displayName: string) => void;
  onRefresh: () => void;
  onRequestUninstall: (packageName: string) => void;
  onUninstallTitle: (packageName: string, displayName: string) => void;
}

function InstalledTitlesWorkspacePanel({
  installedTitleActionState,
  installedTitlesState,
  onCancelUninstall,
  onLaunchTitle,
  onRefresh,
  onRequestUninstall,
  onUninstallTitle,
}: InstalledTitlesWorkspacePanelProps) {
  const snapshot = installedTitlesState.snapshot;
  const launchReadyCount = snapshot?.titles.filter((title) => title.canLaunch).length ?? 0;

  return (
    <>
      <article className="panel desktop-workspace-panel">
        <div className="eyebrow">Installed on Board</div>
        <h2>Keep the current Board inventory in one stable place.</h2>
        <p className="panel-description">
          This view turns `bdb list` into a title model the later uninstall and launch work can
          reuse, without asking the renderer to parse command output on its own.
        </p>

        {snapshot !== null ? (
          <article
            className={`desktop-status-band desktop-status-band--${installedTitlesStatusTone(snapshot.status)}`}
          >
            <span className="desktop-status-band-label">
              {installedTitlesStatusLabel(snapshot.status)}
            </span>
            <h3>{snapshot.summary}</h3>
            <p>{snapshot.guidance}</p>
          </article>
        ) : null}

        {installedTitlesState.errorMessage !== null ? (
          <article className="desktop-inline-message desktop-inline-message--warning">
            <h3>{installedTitlesState.errorMessage}</h3>
            {installedTitlesState.errorDetail !== null ? (
              <p>{installedTitlesState.errorDetail}</p>
            ) : null}
          </article>
        ) : null}

        {installedTitleActionState.message !== null ? (
          <article
            className={
              installedTitleActionState.tone === "warning"
                ? "desktop-inline-message desktop-inline-message--warning"
                : "desktop-inline-message"
            }
          >
            <h3>{installedTitleActionState.message}</h3>
            {installedTitleActionState.detail !== null ? (
              <p>{installedTitleActionState.detail}</p>
            ) : null}
          </article>
        ) : null}

        <dl className="desktop-detail-grid">
          <DetailRow
            label="Reported titles"
            value={snapshot ? String(snapshot.titles.length) : "Loading..."}
          />
          <DetailRow label="Launch ready" value={snapshot ? String(launchReadyCount) : "Loading..."} />
          <DetailRow label="Refresh" value={installedTitlesState.loading ? "Working now" : "Manual"} />
        </dl>

        <div className="desktop-action-row">
          <button
            className="secondary-button"
            disabled={installedTitlesState.loading}
            onClick={onRefresh}
            type="button"
          >
            {installedTitlesState.loading ? "Refreshing..." : "Refresh installed titles"}
          </button>
        </div>
      </article>

      <article className="panel desktop-workspace-panel">
        <div className="eyebrow">Current title list</div>
        <h2>Use launch and uninstall actions next to the title they affect.</h2>
        <p className="panel-description">
          When package identity is available, BE Home keeps the launch and uninstall actions on the
          same row so the current device inventory stays easy to review.
        </p>

        {snapshot === null ? (
          <article className="desktop-inline-card">
            <h3>Loading the current Board inventory.</h3>
            <p>BE Home is asking `bdb list` for the latest installed titles.</p>
          </article>
        ) : snapshot.titles.length === 0 ? (
          <article className="desktop-inline-card">
            <h3>{snapshot.summary}</h3>
            <p>{snapshot.guidance}</p>
          </article>
        ) : (
          <ul className="desktop-inventory-list">
            {snapshot.titles.map((title) => (
              <li className="desktop-inventory-item" key={title.stableId}>
                <div className="desktop-inventory-copy">
                  <h3>{title.displayName}</h3>
                  <p>{title.subtitle ?? "Package details are not available yet"}</p>
                </div>
                <div className="desktop-inventory-side">
                  <div className="desktop-inventory-meta">
                    <span className="desktop-inventory-pill">
                      {title.canLaunch ? "Launch ready" : "Launch unavailable"}
                    </span>
                    <span className="desktop-inventory-pill">
                      {title.canUninstall ? "Can uninstall" : "Read only"}
                    </span>
                  </div>
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
                            : "Confirm remove"}
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
                              ? "Launching..."
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
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </>
  );
}

interface DeviceWorkspacePanelProps {
  deviceStatusState: {
    loading: boolean;
    snapshot: DeviceStatusSnapshot | null;
    errorMessage: string | null;
    errorDetail: string | null;
  };
  pollingActive: boolean;
  setupGateState: SetupGateState;
  onOpenSettings: () => void;
  onRefresh: () => void;
}

function DeviceWorkspacePanel({
  deviceStatusState,
  pollingActive,
  setupGateState,
  onOpenSettings,
  onRefresh,
}: DeviceWorkspacePanelProps) {
  const snapshot = deviceStatusState.snapshot;
  const guidanceContent = snapshot ? buildDeviceGuidanceContent(snapshot, setupGateState) : null;

  return (
    <>
      <article className="panel desktop-workspace-panel">
        <div className="eyebrow">Board connection</div>
        <h2>Keep the latest device check easy to trust.</h2>
        <p className="panel-description">
          BE Home uses the managed Board install tool to confirm whether your Board is nearby,
          ready, and worth keeping in view while the app is open.
        </p>

        {snapshot !== null ? (
          <article
            className={`desktop-status-band desktop-status-band--${deviceStatusTone(snapshot.status)}`}
          >
            <span className="desktop-status-band-label">{deviceStatusLabel(snapshot.status)}</span>
            <h3>{snapshot.summary}</h3>
            <p>{snapshot.guidance}</p>
          </article>
        ) : null}

        {deviceStatusState.errorMessage !== null ? (
          <article className="desktop-inline-message desktop-inline-message--warning">
            <h3>{deviceStatusState.errorMessage}</h3>
            {deviceStatusState.errorDetail !== null ? <p>{deviceStatusState.errorDetail}</p> : null}
          </article>
        ) : null}

        {snapshot === null ? (
          <article className="desktop-inline-card">
            <h3>Loading the latest Board connection check.</h3>
            <p>
              BE Home is asking the managed install tool for its current version and Board
              connection state.
            </p>
          </article>
        ) : (
          <>
            <dl className="desktop-detail-grid">
              <DetailRow label="Connection state" value={deviceStatusLabel(snapshot.status)} />
              <DetailRow
                label="bdb version"
                value={snapshot.bdbVersion.value ?? "Version not available yet"}
              />
              <DetailRow
                label="Live refresh"
                value={
                  pollingActive
                    ? `Every ${Math.floor(snapshot.pollIntervalMs / 1000)} seconds while this window stays visible`
                    : "Paused until the desktop window is visible and focused again"
                }
              />
              <DetailRow
                label="Managed bdb location"
                value={setupGateState.toolState.executablePath}
              />
            </dl>

            <StatusSummaryCard
              title="Current bdb version check"
              summary={snapshot.bdbVersion.summary}
              guidance={snapshot.bdbVersion.detail ?? snapshot.guidance}
            />
          </>
        )}
      </article>

      {guidanceContent === null ? (
        <article className="panel desktop-workspace-panel">
          <div className="eyebrow">Recovery help</div>
          <h2>
            {deviceStatusState.errorMessage !== null
              ? "Try the device check again."
              : "We’ll load the right next steps after the first device check."}
          </h2>
          <p className="panel-description">
            {deviceStatusState.errorDetail ??
              "Once BE Home has the current Board status, this area will turn it into simple recovery guidance instead of terminal-style troubleshooting."}
          </p>
          {deviceStatusState.errorMessage !== null ? (
            <div className="desktop-action-row">
              <button
                className="primary-button"
                disabled={deviceStatusState.loading}
                onClick={onRefresh}
                type="button"
              >
                {deviceStatusState.loading ? "Refreshing..." : "Refresh device check"}
              </button>
            </div>
          ) : null}
        </article>
      ) : (
        <article
          className={`panel desktop-workspace-panel desktop-guidance-panel desktop-guidance-panel--${guidanceContent.tone}`}
        >
          <div className="eyebrow">{guidanceContent.eyebrow}</div>
          <h2>{guidanceContent.title}</h2>
          <p className="panel-description">{guidanceContent.summary}</p>
          <ol className="desktop-guidance-list">
            {guidanceContent.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <dl className="desktop-detail-grid">
            <DetailRow label="Tool state" value={setupGateState.toolState.summary} />
            <DetailRow
              label="Runnable check"
              value={setupGateState.toolState.validation.summary}
            />
            <DetailRow
              label="Source manifest"
              value={setupGateState.toolState.sourcePlan.manifestSource}
            />
            <DetailRow
              label="Managed tool folder"
              value={setupGateState.toolState.storage.effectivePath}
            />
          </dl>
          <div className="desktop-action-row">
            <button
              className="primary-button"
              disabled={deviceStatusState.loading}
              onClick={guidanceContent.primaryAction === "settings" ? onOpenSettings : onRefresh}
              type="button"
            >
              {guidanceContent.primaryAction === "refresh" && deviceStatusState.loading
                ? "Refreshing..."
                : guidanceContent.primaryActionLabel}
            </button>
            {guidanceContent.secondaryAction !== undefined &&
            guidanceContent.secondaryActionLabel !== undefined ? (
              <button
                className="secondary-button"
                disabled={deviceStatusState.loading}
                onClick={guidanceContent.secondaryAction === "settings" ? onOpenSettings : onRefresh}
                type="button"
              >
                {guidanceContent.secondaryAction === "refresh" && deviceStatusState.loading
                  ? "Refreshing..."
                  : guidanceContent.secondaryActionLabel}
              </button>
            ) : null}
          </div>
        </article>
      )}
    </>
  );
}

function deviceStatusLabel(value: DeviceStatusSnapshot["status"]): string {
  switch (value) {
    case "toolMissing":
      return "Tool missing";
    case "toolBroken":
      return "Tool needs repair";
    case "unsupportedHost":
      return "Unsupported host";
    case "boardDisconnected":
      return "Board disconnected";
    case "boardConnected":
      return "Board connected";
    case "executionError":
    default:
      return "Needs retry";
  }
}

function deviceStatusTone(
  value: DeviceStatusSnapshot["status"],
): "success" | "warning" | "neutral" {
  switch (value) {
    case "boardConnected":
      return "success";
    case "toolMissing":
    case "toolBroken":
    case "boardDisconnected":
    case "executionError":
      return "warning";
    case "unsupportedHost":
    default:
      return "neutral";
  }
}

function installedTitlesStatusLabel(value: InstalledTitlesSnapshot["status"]): string {
  switch (value) {
    case "ready":
      return "Inventory ready";
    case "empty":
      return "Nothing installed yet";
    case "unavailable":
    default:
      return "Temporarily unavailable";
  }
}

function installedTitlesStatusTone(
  value: InstalledTitlesSnapshot["status"],
): "success" | "warning" | "neutral" {
  switch (value) {
    case "ready":
      return "success";
    case "empty":
      return "neutral";
    case "unavailable":
    default:
      return "warning";
  }
}

function apkDiscoveryStatusLabel(value: ApkDiscoverySnapshot["status"]): string {
  switch (value) {
    case "ready":
      return "Candidates found";
    case "empty":
    default:
      return "Nothing found yet";
  }
}

function apkDiscoveryStatusTone(
  value: ApkDiscoverySnapshot["status"],
): "success" | "warning" | "neutral" {
  switch (value) {
    case "ready":
      return "success";
    case "empty":
    default:
      return "neutral";
  }
}

function managedLibraryStatusLabel(value: ManagedApkLibrarySnapshot["status"]): string {
  switch (value) {
    case "ready":
      return "Library ready";
    case "empty":
    default:
      return "Nothing copied yet";
  }
}

function managedLibraryStatusTone(
  value: ManagedApkLibrarySnapshot["status"],
): "success" | "warning" | "neutral" {
  switch (value) {
    case "ready":
      return "success";
    case "empty":
    default:
      return "neutral";
  }
}

function apkConfidenceLabel(value: ApkCandidate["confidence"]): string {
  switch (value) {
    case "strongMatch":
      return "Strong Board match";
    case "possibleMatch":
      return "Possible Board match";
    case "unknown":
    default:
      return "Board match unknown";
  }
}

function formatTimestamp(value: number): string {
  if (value <= 0) {
    return "just now";
  }

  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

function pathIdentityKey(path: string): string {
  return path.toLowerCase();
}

function buildDeviceGuidanceContent(
  snapshot: DeviceStatusSnapshot,
  setupGateState: SetupGateState,
): DeviceGuidanceContent {
  switch (snapshot.status) {
    case "boardConnected":
      return {
        eyebrow: "Ready to use",
        title: "Board is connected and the desktop workspace can stay ahead of you.",
        summary:
          "You can move into local APK work, installed-title refreshes, and later install actions without leaving the desktop flow.",
        steps: [
          "Keep Board connected with USB while you install or refresh titles.",
          "Use APK Library when you want to work from local files or managed copies.",
          "Refresh this panel again any time you reconnect the cable or wake the device.",
        ],
        tone: "success",
        primaryAction: "refresh",
        primaryActionLabel: "Refresh device check",
      };
    case "boardDisconnected":
      return {
        eyebrow: "Reconnect Board",
        title: "Connect Board and refresh when you're ready.",
        summary:
          "BE Home can finish device-aware work once Board is connected again, so this state stays focused on the quickest path back.",
        steps: [
          "Connect Board to this computer with USB.",
          "Wake the Board screen and leave it on the main device UI for a moment.",
          "Choose refresh here once the cable and device both look settled.",
        ],
        tone: "warning",
        primaryAction: "refresh",
        primaryActionLabel: "Refresh device check",
      };
    case "toolMissing":
      return {
        eyebrow: "Repair needed",
        title: "Board's install tool needs to be put back in place.",
        summary:
          "The desktop app cannot check Board again until the managed bdb copy is available in settings.",
        steps: [
          "Open Settings so you can repair or re-download Board's install tool.",
          "Let BE Home finish the repair in the managed tools folder.",
          "Come back here and refresh the device check once repair is done.",
        ],
        tone: "warning",
        primaryAction: "settings",
        primaryActionLabel: "Open settings",
        secondaryAction: "refresh",
        secondaryActionLabel: "Refresh device check",
      };
    case "toolBroken":
      return {
        eyebrow: "Repair needed",
        title: "Board's install tool needs a quick repair before device checks can continue.",
        summary:
          "BE Home found the stored bdb copy, but this computer is not letting it run cleanly enough to trust the result.",
        steps: [
          "Open Settings and choose the repair action for bdb.",
          "Let the fresh copy finish downloading into the managed tools folder.",
          "Return here and refresh the device check once repair is complete.",
        ],
        tone: "warning",
        primaryAction: "settings",
        primaryActionLabel: "Open settings",
        secondaryAction: "refresh",
        secondaryActionLabel: "Refresh device check",
      };
    case "unsupportedHost":
      return {
        eyebrow: "Unsupported system",
        title: "This computer is outside Board's current supported desktop list.",
        summary:
          "BE Home will stay honest here instead of asking you to troubleshoot a setup Board does not currently publish bdb for.",
        steps: [
          setupGateState.toolState.guidance,
          "If Board expands desktop support later, refresh the check from this panel.",
          "For now, use a computer that matches Board's published support matrix for bdb.",
        ],
        tone: "neutral",
        primaryAction: "refresh",
        primaryActionLabel: "Refresh device check",
      };
    case "executionError":
    default:
      return {
        eyebrow: "Try again",
        title: "The last device check didn't finish cleanly.",
        summary:
          "This usually means the latest `bdb status` attempt could not settle into a clear connected or disconnected answer yet.",
        steps: [
          "Reconnect Board if the cable looks loose or the device has gone to sleep.",
          "Close any other window or terminal that might still be using bdb.",
          "Refresh the device check here once the connection path looks clear again.",
        ],
        tone: "warning",
        primaryAction: "refresh",
        primaryActionLabel: "Refresh device check",
      };
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
