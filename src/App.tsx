import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  acquireBdbTool,
  importApkToManagedLibrary,
  installApkToConnectedBoard,
  inspectManualApkPath,
  loadApkDiscoverySnapshot,
  loadDesktopSettings,
  loadDeviceStatusSnapshot,
  loadInstalledTitlesSnapshot,
  loadManagedApkLibrarySnapshot,
  loadSetupGateState,
  saveDesktopSettings,
} from "./desktop/client";
import type {
  ApkCandidate,
  ApkDiscoverySnapshot,
  BdbAcquisitionResult,
  DesktopSettings,
  DesktopSettingsInput,
  DeviceStatusSnapshot,
  InstallApkResult,
  InstalledTitlesSnapshot,
  ManagedApkLibraryImportResult,
  ManagedApkLibrarySnapshot,
  ManagedStorageLocation,
  SetupGateState,
} from "./desktop/types";

type SetupViewStep = "systemCheck" | "toolSetup" | "reviewDefaults";
type WorkspaceSectionId = "device" | "apkLibrary" | "installed" | "settings";

interface WorkspaceSection {
  id: WorkspaceSectionId;
  label: string;
  eyebrow: string;
  title: string;
  summary: string;
  bullets: string[];
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
    title: "Keep connection checks in one place",
    summary:
      "This area becomes your quick read on whether Board is nearby and ready before you try an install.",
    bullets: [
      "Check Board connection before you reach for an APK.",
      "Keep repair and retry guidance close to the status that needs it.",
      "Stay in the desktop flow instead of jumping into terminal troubleshooting.",
    ],
  },
  {
    id: "apkLibrary",
    label: "APK Library",
    eyebrow: "Local APKs",
    title: "Bring trusted downloads together",
    summary:
      "Use familiar folders and a managed library so reinstalling later takes fewer steps and less guessing.",
    bullets: [
      "Start with Downloads and add more folders when your routine needs them.",
      "Keep Board-ready APKs available in one stable library location.",
      "Stay flexible when you want to pick a file yourself.",
    ],
  },
  {
    id: "installed",
    label: "Installed on Board",
    eyebrow: "What is already there",
    title: "Keep current installs easy to review",
    summary:
      "Installed titles will live here so uninstall and launch actions stay close to the packages that are already on Board.",
    bullets: [
      "See what is already installed before you repeat work.",
      "Keep uninstall and launch actions near the inventory they affect.",
      "Refresh Board state without restarting the app.",
    ],
  },
  {
    id: "settings",
    label: "Settings",
    eyebrow: "Your storage routine",
    title: "Keep folders and storage understandable",
    summary:
      "Settings stay focused on the locations that matter so the app still feels friendly without filesystem jargon.",
    bullets: [
      "Keep the managed APK library in a place that feels familiar.",
      "See where Board's install tool lives without digging through app data manually.",
      "Adjust the folders you want BE Home to pay attention to.",
    ],
  },
];

function App() {
  const [setupGateState, setSetupGateState] = useState<SetupGateState | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [setupViewStep, setSetupViewStep] = useState<SetupViewStep>("systemCheck");
  const [showReviewDefaults, setShowReviewDefaults] = useState(false);
  const [toolActionState, setToolActionState] = useState<{
    loading: boolean;
    message: string | null;
    detail: string | null;
    lastOutcome: BdbAcquisitionResult["outcome"] | null;
  }>({
    loading: false,
    message: null,
    detail: null,
    lastOutcome: null,
  });
  const [settingsActionState, setSettingsActionState] = useState<{
    loading: boolean;
    message: string | null;
    detail: string | null;
  }>({
    loading: false,
    message: null,
    detail: null,
  });
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
    } else {
      setDesktopSettings(null);
    }
  }, [setupGateState?.status]);

  const shouldShowSetup =
    setupGateState !== null &&
    (setupGateState.status !== "ready" || showReviewDefaults);

  const activeWorkspaceSectionState = useMemo(
    () =>
      workspaceSections.find((section) => section.id === activeWorkspaceSection) ??
      workspaceSections[0],
    [activeWorkspaceSection],
  );
  const devicePollIntervalMs =
    deviceStatusState.snapshot?.pollIntervalMs ?? DEFAULT_DEVICE_POLL_INTERVAL_MS;
  const devicePollingActive = setupGateState?.status === "ready" && documentVisible && windowFocused;

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

  async function refreshSetupGateState(options?: {
    showReviewDefaultsOnReady?: boolean;
  }): Promise<void> {
    try {
      const state = await loadSetupGateState();
      setSetupGateState(state);
      setErrorMessage(null);

      if (options?.showReviewDefaultsOnReady === true && state.status === "ready") {
        setShowReviewDefaults(true);
        setSetupViewStep("reviewDefaults");
        return;
      }

      if (state.status === "ready") {
        setShowReviewDefaults(false);
        return;
      }

      setShowReviewDefaults(false);
      setSetupViewStep(state.requiredStep === "toolSetup" ? "toolSetup" : "systemCheck");
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
      setSettingsActionState({
        loading: false,
        message: "BE Home couldn't load your settings just yet.",
        detail: "Try refreshing the app or reopening the settings section.",
      });
    }
  }

  async function handleAcquireBdbTool(
    repair: boolean,
  ): Promise<BdbAcquisitionResult | null> {
    setToolActionState({
      loading: true,
      message: null,
      detail: null,
      lastOutcome: null,
    });

    try {
      const result = await acquireBdbTool(repair);
      setToolActionState({
        loading: false,
        message: result.summary,
        detail: result.guidance,
        lastOutcome: result.outcome,
      });
      await refreshSetupGateState({
        showReviewDefaultsOnReady:
          result.toolState.status === "runnable" &&
          (result.outcome === "downloaded" || result.outcome === "repaired"),
      });
      return result;
    } catch {
      setToolActionState({
        loading: false,
        message: "BE Home couldn't finish the bdb setup step.",
        detail: "Please try again in a moment.",
        lastOutcome: "failed",
      });
      return null;
    }
  }

  async function persistDesktopSettings(
    input: DesktopSettingsInput,
    successMessage: string,
  ): Promise<void> {
    setSettingsActionState({
      loading: true,
      message: null,
      detail: null,
    });

    try {
      const savedSettings = await saveDesktopSettings(input);
      setDesktopSettings(savedSettings);
      setSettingsActionState({
        loading: false,
        message: successMessage,
        detail: "Your changes are saved and will still be here when you reopen the app.",
      });
      await refreshSetupGateState();
    } catch {
      setSettingsActionState({
        loading: false,
        message: "BE Home couldn't save those settings.",
        detail: "Please try again in a moment.",
      });
    }
  }

  async function handleAddScanFolder(): Promise<void> {
    if (desktopSettings === null) {
      return;
    }

    const selectedPath = await pickSinglePath(
      await open({
        directory: true,
        multiple: false,
        defaultPath:
          desktopSettings.scanFolders[desktopSettings.scanFolders.length - 1]?.path ??
          desktopSettings.apkLibrary.effectivePath,
      }),
    );
    if (selectedPath === null) {
      return;
    }

    if (desktopSettings.scanFolders.some((folder) => folder.path === selectedPath)) {
      setSettingsActionState({
        loading: false,
        message: "That folder is already on your scan list.",
        detail: "Choose another folder if you want BE Home to watch an additional place.",
      });
      return;
    }

    await persistDesktopSettings(
      {
        apkLibraryOverride: desktopSettings.apkLibrary.overridePath,
        scanFolderPaths: [
          ...desktopSettings.scanFolders.map((folder) => folder.path),
          selectedPath,
        ],
      },
      "BE Home added a new scan folder.",
    );
  }

  async function handleRemoveScanFolder(path: string): Promise<void> {
    if (desktopSettings === null) {
      return;
    }

    await persistDesktopSettings(
      {
        apkLibraryOverride: desktopSettings.apkLibrary.overridePath,
        scanFolderPaths: desktopSettings.scanFolders
          .map((folder) => folder.path)
          .filter((scanFolderPath) => scanFolderPath !== path),
      },
      "BE Home updated your scan folder list.",
    );
  }

  async function handleChangeApkLibraryLocation(): Promise<void> {
    if (desktopSettings === null) {
      return;
    }

    const selectedPath = await pickSinglePath(
      await open({
        directory: true,
        multiple: false,
        defaultPath: desktopSettings.apkLibrary.effectivePath,
      }),
    );
    if (selectedPath === null) {
      return;
    }

    await persistDesktopSettings(
      {
        apkLibraryOverride: selectedPath,
        scanFolderPaths: desktopSettings.scanFolders.map((folder) => folder.path),
      },
      "BE Home updated the managed APK library location.",
    );
  }

  async function handleResetApkLibraryLocation(): Promise<void> {
    if (desktopSettings === null) {
      return;
    }

    await persistDesktopSettings(
      {
        apkLibraryOverride: null,
        scanFolderPaths: desktopSettings.scanFolders.map((folder) => folder.path),
      },
      "BE Home switched the APK library back to the app default folder.",
    );
  }

  async function handleRepairFromSettings(): Promise<void> {
    const result = await handleAcquireBdbTool(true);
    if (result === null) {
      setSettingsActionState({
        loading: false,
        message: "BE Home couldn't start the bdb repair just yet.",
        detail: "Please try again in a moment.",
      });
      return;
    }

    setSettingsActionState({
      loading: false,
      message: result.summary,
      detail: result.guidance,
    });
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

  async function handleInstallApk(
    apkPath: string,
  ): Promise<InstallApkResult | null> {
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
    } catch {
      setApkInstallState({
        actionPath: null,
        message: "BE Home couldn't finish that install request just yet.",
        detail: "Please keep Board connected and try the same APK again in a moment.",
        lastStatus: "failed",
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

  return (
    <main className="page-shell desktop-shell">
      <section className="page-grid desktop-grid">
        <section className="hero-panel desktop-banner">
          <div className="hero-copy desktop-banner-copy">
            <div className="eyebrow">BE Home for Desktop</div>
            <h1>
              {shouldShowSetup
                ? "Get your install workspace ready"
                : "Your desktop install space is ready"}
            </h1>
            <p>{setupGateState.summary}</p>
            <p className="desktop-platform-note">
              {setupGateState.platformLabel} desktop · v{setupGateState.version}
            </p>
          </div>
          <div className="desktop-highlight-row" aria-label="Setup summary">
            <StatusChip label="Setup" value={statusLabel(setupGateState.status)} />
            <StatusChip
              label="Board tool"
              value={statusLabel(setupGateState.toolState.status)}
            />
            <StatusChip
              label="Managed tool folder"
              value={locationSourceLabel(setupGateState.toolState.storage)}
            />
          </div>
        </section>

        {shouldShowSetup ? (
          <section className="desktop-setup-layout">
            <aside className="panel desktop-stepper" aria-label="Setup steps">
              <div className="eyebrow">Required setup</div>
              <h2>Stay inside setup until Board's tool is ready.</h2>
              <ol className="desktop-step-list">
                <SetupStepCard
                  stepNumber={1}
                  title="Check this computer"
                  summary="Confirm that this computer matches Board's current download support."
                  status={describeSetupStepStatus(setupViewStep, "systemCheck")}
                />
                <SetupStepCard
                  stepNumber={2}
                  title="Get Board's install tool ready"
                  summary="Download or repair bdb so BE Home can use it without terminal steps."
                  status={describeSetupStepStatus(setupViewStep, "toolSetup")}
                />
                <SetupStepCard
                  stepNumber={3}
                  title="Review your local defaults"
                  summary="See where BE Home starts with scan folders and managed storage before the workspace opens."
                  status={describeSetupStepStatus(setupViewStep, "reviewDefaults")}
                />
              </ol>
            </aside>

            <section className="panel desktop-setup-panel" aria-live="polite">
              {setupViewStep === "systemCheck" ? (
                <SystemCheckStep
                  setupGateState={setupGateState}
                  onContinue={() => setSetupViewStep("toolSetup")}
                  onRefresh={() => void refreshSetupGateState()}
                />
              ) : null}

              {setupViewStep === "toolSetup" ? (
                <ToolSetupStep
                  setupGateState={setupGateState}
                  toolActionState={toolActionState}
                  onBack={() => setSetupViewStep("systemCheck")}
                  onDownload={() => void handleAcquireBdbTool(false)}
                  onRepair={() => void handleAcquireBdbTool(true)}
                  onRefresh={() => void refreshSetupGateState()}
                />
              ) : null}

              {setupViewStep === "reviewDefaults" ? (
                <ReviewDefaultsStep
                  setupGateState={setupGateState}
                  onOpenWorkspace={() => setShowReviewDefaults(false)}
                  onBack={() => setSetupViewStep("toolSetup")}
                />
              ) : null}
            </section>
          </section>
        ) : (
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
              {activeWorkspaceSection === "settings" ? (
                <SettingsWorkspacePanel
                  desktopSettings={desktopSettings}
                  setupGateState={setupGateState}
                  settingsActionState={settingsActionState}
                  onAddScanFolder={() => void handleAddScanFolder()}
                  onRemoveScanFolder={(path) => void handleRemoveScanFolder(path)}
                  onChangeApkLibraryLocation={() => void handleChangeApkLibraryLocation()}
                  onResetApkLibraryLocation={() => void handleResetApkLibraryLocation()}
                  onRepairBdb={() => void handleRepairFromSettings()}
                />
              ) : activeWorkspaceSection === "device" ? (
                <DeviceWorkspacePanel
                  deviceStatusState={deviceStatusState}
                  pollingActive={devicePollingActive}
                  setupGateState={setupGateState}
                  onOpenSettings={() => setActiveWorkspaceSection("settings")}
                  onRefresh={() => void refreshDeviceStatus("manual")}
                />
              ) : activeWorkspaceSection === "installed" ? (
                <InstalledTitlesWorkspacePanel
                  installedTitlesState={installedTitlesState}
                  onRefresh={() => void refreshInstalledTitles("manual")}
                />
              ) : activeWorkspaceSection === "apkLibrary" ? (
                <ApkLibraryWorkspacePanel
                  apkDiscoveryState={apkDiscoveryState}
                  apkInstallState={apkInstallState}
                  desktopSettings={desktopSettings}
                  managedLibraryState={managedLibraryState}
                  onInstallApk={(apkPath) => void handleInstallApk(apkPath)}
                  onChooseManualApk={() => void handleChooseManualApk()}
                  onImportCandidate={(sourcePath) =>
                    void handleImportApkIntoManagedLibrary(sourcePath)
                  }
                  onRefresh={() => void refreshApkDiscovery("manual")}
                  onRefreshManagedLibrary={() => void refreshManagedLibrary("manual")}
                />
              ) : (
                <>
                  <article className="panel desktop-workspace-panel">
                    <div className="eyebrow">{activeWorkspaceSectionState.eyebrow}</div>
                    <h2>{activeWorkspaceSectionState.title}</h2>
                    <p className="panel-description">{activeWorkspaceSectionState.summary}</p>
                    <ul className="desktop-list">
                      {activeWorkspaceSectionState.bullets.map((item) => (
                        <li key={`${activeWorkspaceSectionState.id}-${item}`}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="panel desktop-workspace-panel">
                    <div className="eyebrow">Ready now</div>
                    <h2>Board's install tool is already checked.</h2>
                    <p className="panel-description">{setupGateState.toolState.summary}</p>
                    <dl className="desktop-detail-grid">
                      <DetailRow
                        label="Managed bdb location"
                        value={setupGateState.toolState.executablePath}
                      />
                      <DetailRow
                        label="Managed APK library"
                        value={setupGateState.storage.apkLibrary.effectivePath}
                      />
                      <DetailRow
                        label="Active scan folder"
                        value={formatScanFolders(setupGateState.defaultScanFolders)}
                      />
                    </dl>
                  </article>
                </>
              )}
            </section>
          </section>
        )}
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
    managedLibraryState.snapshot?.items.map((item) => pathIdentityKey(item.originalSourcePath)) ??
      [],
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
            {apkDiscoveryState.errorDetail !== null ? (
              <p>{apkDiscoveryState.errorDetail}</p>
            ) : null}
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
                disabled={apkInstallState.actionPath === apkDiscoveryState.manualCandidate.sourcePath}
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
                      disabled={apkInstallState.actionPath === candidate.sourcePath}
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
          <DetailRow
            label="Copy behavior"
            value="Original downloads stay in place"
          />
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
                    disabled={apkInstallState.actionPath === item.managedPath}
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
  installedTitlesState: {
    loading: boolean;
    snapshot: InstalledTitlesSnapshot | null;
    errorMessage: string | null;
    errorDetail: string | null;
  };
  onRefresh: () => void;
}

function InstalledTitlesWorkspacePanel({
  installedTitlesState,
  onRefresh,
}: InstalledTitlesWorkspacePanelProps) {
  const snapshot = installedTitlesState.snapshot;
  const launchReadyCount =
    snapshot?.titles.filter((title) => title.canLaunch).length ?? 0;

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

        <dl className="desktop-detail-grid">
          <DetailRow
            label="Installed titles"
            value={snapshot ? String(snapshot.titles.length) : "Loading..."}
          />
          <DetailRow
            label="Launch-ready titles"
            value={snapshot ? String(launchReadyCount) : "Loading..."}
          />
          <DetailRow
            label="Inventory state"
            value={snapshot ? installedTitlesStatusLabel(snapshot.status) : "Loading..."}
          />
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
        <div className="eyebrow">Current inventory</div>
        <h2>See the titles Board is already reporting.</h2>
        <p className="panel-description">
          Package identity stays with each entry when BE Home can read it, so later launch and
          uninstall actions have a stable place to start.
        </p>

        {snapshot === null ? (
          <article className="desktop-inline-card">
            <h3>Loading the installed-title inventory.</h3>
            <p>BE Home is reading the current `bdb list` response from Board.</p>
          </article>
        ) : snapshot.status === "ready" ? (
          <ul className="desktop-inventory-list">
            {snapshot.titles.map((title) => (
              <li className="desktop-inventory-item" key={title.stableId}>
                <div className="desktop-inventory-copy">
                  <h3>{title.displayName}</h3>
                  <p>
                    {title.subtitle ??
                      "Package identity is not available yet for this installed title."}
                  </p>
                </div>
                <div className="desktop-inventory-meta">
                  <span className="desktop-inventory-pill">
                    {title.canLaunch ? "Launch ready" : "Package needed"}
                  </span>
                  <span className="desktop-inventory-pill">
                    {title.canUninstall ? "Uninstall ready" : "Read only"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <article className="desktop-inline-card">
            <h3>{snapshot.summary}</h3>
            <p>{snapshot.guidance}</p>
          </article>
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
  const guidanceContent = snapshot
    ? buildDeviceGuidanceContent(snapshot, setupGateState)
    : null;

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
            <span className="desktop-status-band-label">
              {deviceStatusLabel(snapshot.status)}
            </span>
            <h3>{snapshot.summary}</h3>
            <p>{snapshot.guidance}</p>
          </article>
        ) : null}

        {deviceStatusState.errorMessage !== null ? (
          <article className="desktop-inline-message desktop-inline-message--warning">
            <h3>{deviceStatusState.errorMessage}</h3>
            {deviceStatusState.errorDetail !== null ? (
              <p>{deviceStatusState.errorDetail}</p>
            ) : null}
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
              <DetailRow
                label="Connection state"
                value={deviceStatusLabel(snapshot.status)}
              />
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
              guidance={snapshot.guidance}
            />
          </>
        )}
      </article>

      {guidanceContent === null ? (
        <article className="panel desktop-workspace-panel">
          <div className="eyebrow">Recovery help</div>
          <h2>We’ll load the right next steps after the first device check.</h2>
          <p className="panel-description">
            Once BE Home has the current Board status, this area will turn it into simple recovery
            guidance instead of terminal-style troubleshooting.
          </p>
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
              onClick={
                guidanceContent.primaryAction === "settings" ? onOpenSettings : onRefresh
              }
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
                onClick={
                  guidanceContent.secondaryAction === "settings"
                    ? onOpenSettings
                    : onRefresh
                }
                type="button"
              >
                {guidanceContent.secondaryAction === "refresh" &&
                deviceStatusState.loading
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

interface SetupStepCardProps {
  stepNumber: number;
  title: string;
  summary: string;
  status: "complete" | "active" | "upcoming";
}

function SetupStepCard({ stepNumber, title, summary, status }: SetupStepCardProps) {
  return (
    <li className={`desktop-step-card desktop-step-card--${status}`}>
      <span className="desktop-step-number">{stepNumber}</span>
      <div className="desktop-step-copy">
        <h3>{title}</h3>
        <p>{summary}</p>
      </div>
    </li>
  );
}

interface SystemCheckStepProps {
  setupGateState: SetupGateState;
  onContinue: () => void;
  onRefresh: () => void;
}

function SystemCheckStep({
  setupGateState,
  onContinue,
  onRefresh,
}: SystemCheckStepProps) {
  const support = setupGateState.toolState.sourcePlan.support;
  const isBlocked = setupGateState.status === "unsupported";

  return (
    <>
      <div className="eyebrow">Step 1</div>
      <h2>Check this computer before downloading anything.</h2>
      <p className="panel-description">{setupGateState.guidance}</p>
      <dl className="desktop-detail-grid">
        <DetailRow label="Support status" value={statusLabel(setupGateState.status)} />
        <DetailRow label="Operating system" value={support.operatingSystem} />
        <DetailRow label="Architecture" value={support.architecture} />
        <DetailRow
          label="Windows build"
          value={
            support.windowsBuild === null
              ? "Not needed on this platform"
              : String(support.windowsBuild)
          }
        />
      </dl>

      <StatusSummaryCard
        title="What BE Home found"
        summary={setupGateState.toolState.summary}
        guidance={setupGateState.toolState.guidance}
      />

      {isBlocked ? (
        <article className="desktop-inline-message desktop-inline-message--warning">
          <h3>This computer is outside Board's current supported desktop list.</h3>
          <p>{setupGateState.toolState.guidance}</p>
          <p>
            If Board expands desktop support later, you can come back and refresh this check
            again from here.
          </p>
        </article>
      ) : null}

      <div className="desktop-action-row">
        <button
          className="primary-button"
          disabled={isBlocked}
          onClick={onContinue}
          type="button"
        >
          Continue to bdb setup
        </button>
        <button className="secondary-button" onClick={onRefresh} type="button">
          Refresh checks
        </button>
      </div>
    </>
  );
}

interface ToolSetupStepProps {
  setupGateState: SetupGateState;
  toolActionState: {
    loading: boolean;
    message: string | null;
    detail: string | null;
    lastOutcome: BdbAcquisitionResult["outcome"] | null;
  };
  onBack: () => void;
  onDownload: () => void;
  onRepair: () => void;
  onRefresh: () => void;
}

function ToolSetupStep({
  setupGateState,
  toolActionState,
  onBack,
  onDownload,
  onRepair,
  onRefresh,
}: ToolSetupStepProps) {
  const isRepair = setupGateState.toolState.executableExists;
  const primaryActionLabel = isRepair ? "Repair bdb" : "Download bdb";

  return (
    <>
      <div className="eyebrow">Step 2</div>
      <h2>Get Board's install tool ready.</h2>
      <p className="panel-description">{setupGateState.toolState.guidance}</p>
      <dl className="desktop-detail-grid">
        <DetailRow
          label="Managed tool folder"
          value={setupGateState.toolState.storage.effectivePath}
        />
        <DetailRow
          label="Executable path"
          value={setupGateState.toolState.executablePath}
        />
        <DetailRow
          label="Runnable check"
          value={statusLabel(setupGateState.toolState.validation.status)}
        />
      </dl>

      <StatusSummaryCard
        title="Current tool state"
        summary={setupGateState.toolState.summary}
        guidance={setupGateState.toolState.validation.summary}
      />

      {toolActionState.message !== null ? (
        <article
          className={
            toolActionState.lastOutcome === "failed"
              ? "desktop-inline-message desktop-inline-message--warning"
              : "desktop-inline-message"
          }
        >
          <h3>{toolActionState.message}</h3>
          {toolActionState.detail !== null ? <p>{toolActionState.detail}</p> : null}
        </article>
      ) : null}

      <div className="desktop-action-row">
        <button
          className="primary-button"
          disabled={toolActionState.loading}
          onClick={isRepair ? onRepair : onDownload}
          type="button"
        >
          {toolActionState.loading ? "Working..." : primaryActionLabel}
        </button>
        <button
          className="secondary-button"
          disabled={toolActionState.loading}
          onClick={onRefresh}
          type="button"
        >
          Refresh checks
        </button>
        <button
          className="tertiary-button"
          disabled={toolActionState.loading}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
      </div>
    </>
  );
}

interface ReviewDefaultsStepProps {
  setupGateState: SetupGateState;
  onOpenWorkspace: () => void;
  onBack: () => void;
}

function ReviewDefaultsStep({
  setupGateState,
  onOpenWorkspace,
  onBack,
}: ReviewDefaultsStepProps) {
  return (
    <>
      <div className="eyebrow">Step 3</div>
      <h2>Review the local defaults BE Home will start with.</h2>
      <p className="panel-description">
        You can change these locations later, but this is the familiar starting
        point BE Home will use today.
      </p>
      <dl className="desktop-detail-grid">
        <DetailRow
          label="Managed bdb folder"
          value={setupGateState.storage.bdbTools.effectivePath}
        />
        <DetailRow
          label="Managed APK library"
          value={setupGateState.storage.apkLibrary.effectivePath}
        />
        <DetailRow
          label="Default scan folder"
          value={formatScanFolders(setupGateState.defaultScanFolders)}
        />
      </dl>
      <div className="desktop-action-row">
        <button className="primary-button" onClick={onOpenWorkspace} type="button">
          Open workspace
        </button>
        <button className="tertiary-button" onClick={onBack} type="button">
          Back
        </button>
      </div>
    </>
  );
}

interface SettingsWorkspacePanelProps {
  desktopSettings: DesktopSettings | null;
  setupGateState: SetupGateState;
  settingsActionState: {
    loading: boolean;
    message: string | null;
    detail: string | null;
  };
  onAddScanFolder: () => void;
  onRemoveScanFolder: (path: string) => void;
  onChangeApkLibraryLocation: () => void;
  onResetApkLibraryLocation: () => void;
  onRepairBdb: () => void;
}

function SettingsWorkspacePanel({
  desktopSettings,
  setupGateState,
  settingsActionState,
  onAddScanFolder,
  onRemoveScanFolder,
  onChangeApkLibraryLocation,
  onResetApkLibraryLocation,
  onRepairBdb,
}: SettingsWorkspacePanelProps) {
  if (desktopSettings === null) {
    return (
      <>
        <article className="panel desktop-workspace-panel">
          <div className="eyebrow">Settings</div>
          <h2>Loading your folder settings.</h2>
          <p className="panel-description">
            BE Home is loading your current scan folders and storage choices.
          </p>
        </article>
        <article className="panel desktop-workspace-panel">
          <div className="eyebrow">Ready now</div>
          <h2>Board's install tool is still checked.</h2>
          <p className="panel-description">{setupGateState.toolState.summary}</p>
        </article>
      </>
    );
  }

  return (
    <>
      <article className="panel desktop-workspace-panel">
        <div className="eyebrow">Settings</div>
        <h2>Keep folders and storage understandable.</h2>
        <p className="panel-description">
          These settings stay focused on the places BE Home actually uses, so you
          can shape your install routine without hunting through app files.
        </p>

        {settingsActionState.message !== null ? (
          <article className="desktop-inline-message">
            <h3>{settingsActionState.message}</h3>
            {settingsActionState.detail !== null ? (
              <p>{settingsActionState.detail}</p>
            ) : null}
          </article>
        ) : null}

        <section className="desktop-settings-group">
          <div className="desktop-settings-group-copy">
            <h3>Scan folders</h3>
            <p>BE Home starts with places that already feel familiar, like Downloads.</p>
          </div>
          <ul className="desktop-folder-list">
            {desktopSettings.scanFolders.map((folder) => (
              <li className="desktop-folder-item" key={folder.path}>
                <div className="desktop-folder-copy">
                  <span className="desktop-folder-path">{folder.path}</span>
                  <span className="desktop-folder-meta">
                    {folder.source === "default" ? "App default" : "Added by you"}
                  </span>
                </div>
                <button
                  className="tertiary-button desktop-inline-button"
                  disabled={settingsActionState.loading}
                  onClick={() => onRemoveScanFolder(folder.path)}
                  type="button"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button
            className="secondary-button"
            disabled={settingsActionState.loading}
            onClick={onAddScanFolder}
            type="button"
          >
            Add scan folder
          </button>
        </section>

        <section className="desktop-settings-group">
          <div className="desktop-settings-group-copy">
            <h3>Managed APK library</h3>
            <p>
              Keep reused APKs in one steady place so reinstalling later takes fewer steps.
            </p>
          </div>
          <dl className="desktop-detail-grid">
            <DetailRow
              label="Current location"
              value={desktopSettings.apkLibrary.effectivePath}
            />
            <DetailRow
              label="Location style"
              value={locationSourceLabel(desktopSettings.apkLibrary)}
            />
          </dl>
          <div className="desktop-action-row">
            <button
              className="secondary-button"
              disabled={settingsActionState.loading}
              onClick={onChangeApkLibraryLocation}
              type="button"
            >
              Choose another folder
            </button>
            {desktopSettings.apkLibrary.overridePath !== null ? (
              <button
                className="tertiary-button"
                disabled={settingsActionState.loading}
                onClick={onResetApkLibraryLocation}
                type="button"
              >
                Use app default
              </button>
            ) : null}
          </div>
        </section>
      </article>

      <article className="panel desktop-workspace-panel">
        <div className="eyebrow">Board tool</div>
        <h2>Keep bdb easy to find and easy to repair.</h2>
        <p className="panel-description">
          BE Home keeps the Board install tool in its own managed folder for MVP,
          then offers repair here if the stored copy ever needs attention.
        </p>
        <dl className="desktop-detail-grid">
          <DetailRow
            label="Managed bdb location"
            value={desktopSettings.bdbExecutablePath}
          />
          <DetailRow
            label="Current status"
            value={setupGateState.toolState.summary}
          />
          <DetailRow
            label="Settings file"
            value={desktopSettings.settingsFilePath}
          />
        </dl>
        <div className="desktop-action-row">
          <button
            className="primary-button"
            disabled={settingsActionState.loading}
            onClick={onRepairBdb}
            type="button"
          >
            Repair bdb
          </button>
        </div>
      </article>
    </>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="desktop-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

interface StatusSummaryCardProps {
  title: string;
  summary: string;
  guidance: string;
}

function StatusSummaryCard({ title, summary, guidance }: StatusSummaryCardProps) {
  return (
    <article className="desktop-inline-card">
      <h3>{title}</h3>
      <p>{summary}</p>
      <p>{guidance}</p>
    </article>
  );
}

interface StatusChipProps {
  label: string;
  value: string;
}

function StatusChip({ label, value }: StatusChipProps) {
  return (
    <span className="desktop-highlight">
      <span className="desktop-highlight-label">{label}</span>
      <span className="desktop-highlight-value">{value}</span>
    </span>
  );
}

function describeSetupStepStatus(
  currentStep: SetupViewStep,
  targetStep: SetupViewStep,
): "complete" | "active" | "upcoming" {
  const order: SetupViewStep[] = ["systemCheck", "toolSetup", "reviewDefaults"];
  const currentIndex = order.indexOf(currentStep);
  const targetIndex = order.indexOf(targetStep);

  if (currentIndex === targetIndex) {
    return "active";
  }

  return currentIndex > targetIndex ? "complete" : "upcoming";
}

function formatScanFolders(scanFolders: string[]): string {
  return scanFolders.length === 0
    ? "Add a folder when you want BE Home to look beyond manual file picks."
    : scanFolders.join(", ");
}

function statusLabel(
  value:
    | SetupGateState["status"]
    | SetupGateState["toolState"]["status"]
    | SetupGateState["toolState"]["validation"]["status"],
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

function locationSourceLabel(location: ManagedStorageLocation): string {
  return location.source === "override" ? "Custom location" : "App default";
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
      return "Needs retry";
    default:
      return value;
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
      return "Temporarily unavailable";
    default:
      return value;
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
      return "Nothing found yet";
    default:
      return value;
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
      return "Nothing copied yet";
    default:
      return value;
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

async function pickSinglePath(
  selection: string | string[] | null,
): Promise<string | null> {
  if (selection === null) {
    return null;
  }

  if (Array.isArray(selection)) {
    return selection[0] ?? null;
  }

  return selection;
}

export default App;
