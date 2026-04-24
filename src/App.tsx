import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import {
  acquireBdbTool,
  loadDesktopSettings,
  loadSetupGateState,
  saveDesktopSettings,
} from "./desktop/client";
import type {
  BdbAcquisitionResult,
  DesktopSettings,
  DesktopSettingsInput,
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
    options?: {
      showReviewDefaultsOnReady?: boolean;
    },
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
      const shouldShowReviewDefaults =
        options?.showReviewDefaultsOnReady === true &&
        result.toolState.status === "runnable" &&
        (result.outcome === "downloaded" || result.outcome === "repaired");
      await refreshSetupGateState({
        showReviewDefaultsOnReady: shouldShowReviewDefaults,
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
    setSettingsActionState({
      loading: true,
      message: null,
      detail: null,
    });

    const result = await handleAcquireBdbTool(true, {
      showReviewDefaultsOnReady: false,
    });
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
                  onDownload={() =>
                    void handleAcquireBdbTool(false, {
                      showReviewDefaultsOnReady: true,
                    })
                  }
                  onRepair={() =>
                    void handleAcquireBdbTool(true, {
                      showReviewDefaultsOnReady: true,
                    })
                  }
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
