import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  acquireBdbTool,
  dismissSetupWizardWindow,
  finishSetupWizardWindow,
  loadBdbToolState,
  loadDesktopSettings,
  loadSetupGateState,
  refreshBdbToolState,
  saveDesktopSettings,
} from "../desktop/client";
import type {
  BdbToolState,
  DesktopSettings,
  DesktopSettingsInput,
  SetupGateState,
  SupportRequestDraft,
} from "../desktop/types";
import { formatBoardInstallToolVersion } from "../desktop/presentation";

type WizardStepId = "welcome" | "boardTool" | "scanFolders" | "libraryLocation" | "ready";

interface WizardStep {
  id: WizardStepId;
  label: string;
}

interface InlineNotice {
  tone: "neutral" | "warning" | "success";
  title: string;
  detail: string | null;
}

interface WizardAlertDialog {
  title: string;
  detail: string | null;
  acknowledgeLabel?: string;
}

const wizardSteps: WizardStep[] = [
  { id: "welcome", label: "Welcome" },
  { id: "boardTool", label: "Board Install Tool" },
  { id: "scanFolders", label: "Look for Games & Apps" },
  { id: "libraryLocation", label: "Library Location" },
  { id: "ready", label: "Ready to Go" },
];

function iconButtonLabel(icon: string, label: string, onClick: () => void, disabled = false) {
  return (
    <button
      aria-label={label}
      className="desktop-icon-button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className="material-symbols-outlined">
        {icon}
      </span>
    </button>
  );
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

function normalizeLibraryOverride(defaultPath: string, draftValue: string): string | null {
  const normalizedDraft = draftValue.trim();
  if (normalizedDraft.length === 0 || normalizedDraft === defaultPath) {
    return null;
  }

  return normalizedDraft;
}

function normalizeFolderPathForComparison(path: string, operatingSystem: DesktopSettings["operatingSystem"]): string {
  const normalized = path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  return operatingSystem === "windows" ? normalized.toLowerCase() : normalized;
}

function findCoveringScanFolder(
  scanFolders: string[],
  candidatePath: string,
  operatingSystem: DesktopSettings["operatingSystem"],
): string | null {
  const normalizedCandidate = normalizeFolderPathForComparison(candidatePath, operatingSystem);

  for (const existingPath of scanFolders) {
    const normalizedExisting = normalizeFolderPathForComparison(existingPath, operatingSystem);

    if (
      normalizedCandidate.length > normalizedExisting.length &&
      normalizedCandidate.startsWith(`${normalizedExisting}/`)
    ) {
      return existingPath;
    }
  }

  return null;
}

function supportInstructionText(): string {
  return "Please enter your email address in the From field and add your name at the end before sending.";
}

function updateActionLabel(toolState: BdbToolState): string {
  if (!toolState.executableExists) {
    return "Download";
  }

  if (toolState.updateStatus.status === "updateAvailable") {
    return "Download Update";
  }

  return "Reinstall";
}

export default function SetupWizardApp() {
  const [setupGateState, setSetupGateState] = useState<SetupGateState | null>(null);
  const [toolState, setToolState] = useState<BdbToolState | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [currentStepId, setCurrentStepId] = useState<WizardStepId>("welcome");
  const [scanFolderDraft, setScanFolderDraft] = useState<string[]>([]);
  const [libraryPathDraft, setLibraryPathDraft] = useState("");
  const [windowError, setWindowError] = useState<string | null>(null);
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [latestVersionRefreshing, setLatestVersionRefreshing] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [supportDialogDraft, setSupportDialogDraft] = useState<SupportRequestDraft | null>(null);
  const [wizardAlertDialog, setWizardAlertDialog] = useState<WizardAlertDialog | null>(null);
  const allowWindowCloseRef = useRef(false);

  const currentStepIndex = wizardSteps.findIndex((step) => step.id === currentStepId);
  const toolStepBlocked = toolState?.supportRequestDraft !== null;
  const canAdvancePastToolStep = toolState?.status === "runnable" && !toolStepBlocked;

  useEffect(() => {
    void refreshWindowState();
  }, []);

  useEffect(() => {
    if (currentStepId !== "boardTool") {
      return;
    }

    void refreshBoardToolDetails({ announceResult: false });
  }, [currentStepId]);

  useEffect(() => {
    let unlistenCloseRequest: (() => void) | null = null;
    let currentWindow: ReturnType<typeof getCurrentWindow>;

    try {
      currentWindow = getCurrentWindow();
    } catch {
      return () => undefined;
    }

    void currentWindow
      .onCloseRequested(async (event) => {
        if (allowWindowCloseRef.current) {
          return;
        }

        event.preventDefault();
        setSupportDialogDraft(null);
        setCancelDialogOpen(true);
      })
      .then((unlisten) => {
        unlistenCloseRequest = unlisten;
      })
      .catch(() => undefined);

    return () => {
      if (unlistenCloseRequest !== null) {
        unlistenCloseRequest();
      }
    };
  }, []);

  const readySummaryRows = useMemo(
    () =>
      [
        {
          label: "Board Install Tool",
          value: formatBoardInstallToolVersion(
            toolState?.versionCheck.value,
            toolState?.status === "runnable" ? "Installed" : "Still needs to be downloaded",
          ),
        },
        {
          label: "Games and apps folders",
          value:
            scanFolderDraft.length === 0 ? "No folders selected. You can still choose files manually." : scanFolderDraft.join("\n"),
        },
        {
          label: "Saved library",
          value: libraryPathDraft.trim(),
        },
      ] satisfies Array<{ label: string; value: string }>,
    [libraryPathDraft, scanFolderDraft, toolState],
  );

  async function refreshWindowState(options?: { refreshManifest?: boolean }): Promise<void> {
    try {
      const [setupState, settings, latestToolState] = await Promise.all([
        loadSetupGateState(),
        loadDesktopSettings(),
        options?.refreshManifest === true ? refreshBdbToolState() : loadBdbToolState(),
      ]);
      setSetupGateState(setupState);
      setDesktopSettings(settings);
      setToolState(latestToolState);
      setScanFolderDraft(settings.scanFolders.map((folder) => folder.path));
      setLibraryPathDraft(settings.apkLibrary.effectivePath);
      setWindowError(null);
    } catch {
      setWindowError(
        "BE Home couldn't load the setup wizard just yet. Please close the app and try again.",
      );
    }
  }

  function showWizardAlert(dialog: WizardAlertDialog): void {
    setInlineNotice(null);
    setWizardAlertDialog(dialog);
  }

  async function saveDraftSettings(): Promise<boolean> {
    if (desktopSettings === null) {
      return false;
    }

    setBusy(true);
    setInlineNotice(null);

    try {
      const input: DesktopSettingsInput = {
        apkLibraryOverride: normalizeLibraryOverride(
          desktopSettings.apkLibrary.defaultPath,
          libraryPathDraft,
        ),
        boardConnectionPollIntervalSeconds: desktopSettings.boardConnection.pollIntervalSeconds,
        scanFolderPaths: scanFolderDraft,
      };
      const savedSettings = await saveDesktopSettings(input);
      setDesktopSettings(savedSettings);
      setScanFolderDraft(savedSettings.scanFolders.map((folder) => folder.path));
      setLibraryPathDraft(savedSettings.apkLibrary.effectivePath);
      return true;
    } catch {
      showWizardAlert({
        title: "BE Home couldn't save these setup choices yet.",
        detail: "Please try again in a moment.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function dismissWizardOrExitProgrammatically(): Promise<void> {
    allowWindowCloseRef.current = true;

    try {
      await dismissSetupWizardWindow();
    } catch (error) {
      allowWindowCloseRef.current = false;
      throw error;
    }
  }

  function handleCancelSetup(): void {
    if (busy) {
      return;
    }

    setSupportDialogDraft(null);
    setCancelDialogOpen(true);
  }

  async function handleConfirmCancelSetup(): Promise<void> {
    setBusy(true);
    setInlineNotice(null);
    setWizardAlertDialog(null);

    try {
      await dismissWizardOrExitProgrammatically();
    } catch {
      setBusy(false);
      setCancelDialogOpen(false);
      showWizardAlert({
        title: "BE Home couldn't close setup just yet.",
        detail: "Please try again in a moment.",
      });
    }
  }

  async function handleDownloadOrRepair(): Promise<void> {
    if (toolState === null) {
      return;
    }

    setBusy(true);
    setInlineNotice(null);
    setWizardAlertDialog(null);

    try {
      const result = await acquireBdbTool(toolState.executableExists);
      if (result.outcome === "failed") {
        showWizardAlert({
          title: result.summary,
          detail: result.guidance,
        });
      } else {
        setInlineNotice({
          tone: "success",
          title: result.summary,
          detail: result.guidance,
        });
      }
      await refreshWindowState({
        refreshManifest: result.outcome !== "failed",
      });
    } catch {
      showWizardAlert({
        title: "BE Home couldn't finish that Board Install Tool step.",
        detail: "Please try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshBoardToolDetails(options: {
    announceResult: boolean;
  }): Promise<void> {
    setLatestVersionRefreshing(true);

    try {
      const latestToolState = await refreshBdbToolState();
      setToolState(latestToolState);

      if (options.announceResult) {
        setInlineNotice({
          tone: "neutral",
          title: "BE Home checked Board's latest Board Install Tool version.",
          detail:
            latestToolState.updateStatus.guidance ??
            "You can review the current version details below.",
        });
      }
    } catch {
      if (options.announceResult) {
        showWizardAlert({
          title: "BE Home couldn't check for Board Install Tool updates right now.",
          detail: "Please try again in a moment.",
        });
      }
    } finally {
      setLatestVersionRefreshing(false);
    }
  }

  async function handleCheckForUpdate(): Promise<void> {
    setBusy(true);
    setInlineNotice(null);
    setWizardAlertDialog(null);

    try {
      await refreshBoardToolDetails({ announceResult: true });
    } finally {
      setBusy(false);
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
        defaultPath: scanFolderDraft[scanFolderDraft.length - 1] ?? libraryPathDraft,
      }),
    );
    if (selectedPath === null) {
      return;
    }

    const normalizedSelectedPath = normalizeFolderPathForComparison(
      selectedPath,
      desktopSettings.operatingSystem,
    );
    const existingExactMatch = scanFolderDraft.find(
      (path) =>
        normalizeFolderPathForComparison(path, desktopSettings.operatingSystem) ===
        normalizedSelectedPath,
    );

    if (existingExactMatch !== undefined) {
      setInlineNotice({
        tone: "neutral",
        title: "That folder is already on the list.",
        detail: "Choose another folder if you want BE Home to watch an additional place.",
      });
      return;
    }

    const coveringFolder = findCoveringScanFolder(
      scanFolderDraft,
      selectedPath,
      desktopSettings.operatingSystem,
    );

    if (coveringFolder !== null) {
      showWizardAlert({
        title: "That folder is already covered by another rule.",
        detail: `BE Home is already checking ${coveringFolder}, so you don't need to add ${selectedPath} separately.`,
        acknowledgeLabel: "Got it",
      });
      return;
    }

    setScanFolderDraft((previous) => [...previous, selectedPath]);
  }

  function handleRemoveScanFolder(path: string): void {
    setScanFolderDraft((previous) => previous.filter((currentPath) => currentPath !== path));
  }

  async function handleBrowseLibraryLocation(): Promise<void> {
    const selectedPath = await pickSinglePath(
      await open({
        directory: true,
        multiple: false,
        defaultPath: libraryPathDraft,
      }),
    );
    if (selectedPath !== null) {
      setLibraryPathDraft(selectedPath);
    }
  }

  function handleUseRecommendedLibraryLocation(): void {
    if (desktopSettings !== null) {
      setLibraryPathDraft(desktopSettings.apkLibrary.defaultPath);
    }
  }

  async function handleOpenSupportEmail(): Promise<void> {
    if (supportDialogDraft === null) {
      return;
    }

    try {
      await openUrl(supportDialogDraft.mailtoUrl);
    } catch {
      showWizardAlert({
        title: "BE Home couldn't open your email app automatically.",
        detail: "You can still copy the email draft from this window.",
      });
    }
  }

  async function handleCopySupportDraft(): Promise<void> {
    if (supportDialogDraft === null) {
      return;
    }

    const draftText = [
      `To: ${supportDialogDraft.to}`,
      `Subject: ${supportDialogDraft.subject}`,
      "",
      supportDialogDraft.body,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(draftText);
      setInlineNotice({
        tone: "success",
        title: "Email draft copied.",
        detail: "Paste it into your mail app, then add your email address and name before sending.",
      });
    } catch {
      showWizardAlert({
        title: "BE Home couldn't copy the email draft automatically.",
        detail: "Please use the text shown in this window instead.",
      });
    }
  }

  async function handleFinish(): Promise<void> {
    if (!(await saveDraftSettings())) {
      return;
    }

    try {
      allowWindowCloseRef.current = true;
      setCancelDialogOpen(false);
      await finishSetupWizardWindow();
    } catch {
      allowWindowCloseRef.current = false;
      showWizardAlert({
        title: "BE Home couldn't finish setup just yet.",
        detail: "Please try again in a moment.",
      });
    }
  }

  async function handleNext(): Promise<void> {
    setInlineNotice(null);
    setWizardAlertDialog(null);

    switch (currentStepId) {
      case "welcome":
        setCurrentStepId("boardTool");
        return;
      case "boardTool":
        if (!canAdvancePastToolStep) {
          showWizardAlert({
            title: "Download the Board Install Tool first.",
            detail: toolStepBlocked
              ? "This Board Install Tool download is not compatible with this computer yet. Use Email Board Support in this step if you want to ask Board for support."
              : "BE Home can't move to the next step until the Board Install Tool is downloaded and ready. Choose Download in this step, then try Next again.",
            acknowledgeLabel: toolStepBlocked ? "OK" : "Got it",
          });
          return;
        }
        setCurrentStepId("scanFolders");
        return;
      case "scanFolders":
        setCurrentStepId("libraryLocation");
        return;
      case "libraryLocation":
        setCurrentStepId("ready");
        return;
      case "ready":
        await handleFinish();
        return;
      default:
        return;
    }
  }

  function handleBack(): void {
    setInlineNotice(null);
    setWizardAlertDialog(null);
    setCurrentStepId((previousStepId) => {
      const previousIndex = wizardSteps.findIndex((step) => step.id === previousStepId) - 1;
      return wizardSteps[Math.max(previousIndex, 0)]?.id ?? "welcome";
    });
  }

  if (windowError !== null) {
    return (
      <main className="page-shell desktop-shell desktop-utility-window">
        <section className="desktop-utility-grid">
          <section className="desktop-state-view" aria-live="polite">
            <h2>Please close BE Home for Desktop and try again.</h2>
            <p className="panel-description">{windowError}</p>
          </section>
        </section>
      </main>
    );
  }

  if (setupGateState === null || toolState === null || desktopSettings === null) {
    return (
      <main className="page-shell desktop-shell desktop-utility-window">
        <section className="desktop-utility-grid">
          <section className="desktop-state-view" aria-live="polite">
            <h2>Getting setup ready</h2>
            <p className="panel-description">
              BE Home is checking your Board Install Tool, game folders, and saved library
              location.
            </p>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell desktop-shell desktop-utility-window">
      <section className="desktop-utility-grid">
        <section className="desktop-utility-dialog desktop-utility-dialog--wizard">
          <header className="desktop-utility-header">
            <div className="desktop-utility-heading">
              <h1>Set up BE Home for Desktop</h1>
              <p className="panel-description">
                Setup gets BE Home ready to find games and apps on this computer and install them
                on Board without command-line steps.
              </p>
            </div>
            <ol className="desktop-wizard-step-row" aria-label="Setup steps">
              {wizardSteps.map((step, index) => {
                const state =
                  currentStepId === step.id
                    ? "current"
                    : index < currentStepIndex
                      ? "complete"
                      : "upcoming";

                return (
                  <li className={`desktop-wizard-step desktop-wizard-step--${state}`} key={step.id}>
                    <span className="desktop-wizard-step-number">{index + 1}</span>
                    <span>{step.label}</span>
                  </li>
                );
              })}
            </ol>
          </header>

          <section className="desktop-utility-body" aria-live="polite">
            {currentStepId === "welcome" ? (
              <section className="desktop-wizard-page">
                <h2>Here’s what setup will do.</h2>
                <p className="panel-description">
                  You’ll download the Board Install Tool, choose which folders BE Home checks for
                  games and apps, and pick where saved copies should live on this computer.
                </p>
              </section>
            ) : null}

            {currentStepId === "boardTool" ? (
              <section className="desktop-wizard-page">
                <h2>Get the Board Install Tool ready.</h2>
                <p className="panel-description">
                  BE Home needs Board’s install helper so it can install games and apps on your
                  Board for you.
                </p>

                <div className="desktop-form-grid">
                  <label className="desktop-field">
                    <span className="desktop-field-label">Install location</span>
                    <div className="desktop-readonly-field">{toolState.executablePath}</div>
                  </label>
                  <label className="desktop-field">
                    <span className="desktop-field-label">Current version</span>
                    <div className="desktop-readonly-field">
                      {formatBoardInstallToolVersion(toolState.versionCheck.value, "Not installed yet")}
                    </div>
                  </label>
                  <label className="desktop-field">
                    <span className="desktop-field-label">Latest version available from Board</span>
                    <div className="desktop-readonly-field">
                      {formatBoardInstallToolVersion(
                        toolState.updateStatus.availableVersion,
                        latestVersionRefreshing ? "Checking..." : "Not available yet",
                      )}
                    </div>
                  </label>
                </div>

                <article className="desktop-inline-card">
                  <h3>{toolState.summary}</h3>
                  <p>{toolState.guidance}</p>
                </article>

                {toolState.supportRequestDraft !== null ? (
                  <article className="desktop-inline-message desktop-inline-message--warning">
                    <h3>This version of the Board Install Tool is not compatible with this computer.</h3>
                    <p>
                      You can ask Board for support and include the exact message BE Home received
                      from the tool.
                    </p>
                    <div className="desktop-inline-button-row">
                      <button
                        className="secondary-button"
                        onClick={() => setSupportDialogDraft(toolState.supportRequestDraft)}
                        type="button"
                      >
                        Email Board Support...
                      </button>
                    </div>
                  </article>
                ) : null}

                <div className="desktop-inline-button-row">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void handleDownloadOrRepair()}
                    type="button"
                  >
                    {busy ? "Working..." : updateActionLabel(toolState)}
                  </button>
                  {toolState.executableExists ? (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void handleCheckForUpdate()}
                      type="button"
                    >
                      Check for Update
                    </button>
                  ) : null}
                </div>

                <p className="desktop-footnote">
                  Board’s formal name for this helper is <strong>Board Developer Bridge (bdb)</strong>.
                </p>
              </section>
            ) : null}

            {currentStepId === "scanFolders" ? (
              <section className="desktop-wizard-page">
                <h2>Choose the folders BE Home should check.</h2>
                <p className="panel-description">
                  BE Home can look in these folders when you rescan this computer for games and
                  apps. You can leave the list empty if you prefer to choose files manually.
                </p>

                <section className="desktop-list-editor">
                  <div className="desktop-list-editor-header">
                    <span className="desktop-field-label">Folders to check</span>
                  </div>

                  {scanFolderDraft.length === 0 ? (
                    <div className="desktop-empty-note">
                      BE Home will wait for you to choose a game or app manually.
                    </div>
                  ) : (
                    <ul className="desktop-folder-list desktop-folder-list--compact">
                      {scanFolderDraft.map((path) => (
                        <li className="desktop-folder-item" key={path}>
                          <div className="desktop-folder-copy">
                            <p className="desktop-folder-path">{path}</p>
                          </div>
                          <div className="desktop-folder-actions">
                            {iconButtonLabel(
                              "remove",
                              `Remove ${path}`,
                              () => handleRemoveScanFolder(path),
                              busy,
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="desktop-list-editor-footer">
                    <div className="desktop-list-editor-actions">
                      {iconButtonLabel("add", "Add folder", () => void handleAddScanFolder(), busy)}
                    </div>
                  </div>
                </section>
              </section>
            ) : null}

            {currentStepId === "libraryLocation" ? (
              <section className="desktop-wizard-page">
                <h2>Choose where saved copies should live.</h2>
                <p className="panel-description">
                  BE Home can keep reusable copies of your games and apps in one saved library so
                  they’re easier to install again later.
                </p>

                <label className="desktop-field">
                  <span className="desktop-field-label">Saved library folder</span>
                  <div className="desktop-input-with-button">
                    <input
                      className="desktop-text-field"
                      onChange={(event) => setLibraryPathDraft(event.target.value)}
                      spellCheck={false}
                      type="text"
                      value={libraryPathDraft}
                    />
                    {iconButtonLabel(
                      "folder_open",
                      "Choose library folder",
                      () => void handleBrowseLibraryLocation(),
                      busy,
                    )}
                  </div>
                </label>

                <div className="desktop-recommended-row">
                  <span className="desktop-recommended-badge">
                    {normalizeLibraryOverride(desktopSettings.apkLibrary.defaultPath, libraryPathDraft) === null
                      ? "Recommended"
                      : "Custom"}
                  </span>
                  <button
                    className="tertiary-button desktop-link-button"
                    disabled={busy}
                    onClick={handleUseRecommendedLibraryLocation}
                    type="button"
                  >
                    Use recommended location
                  </button>
                </div>
              </section>
            ) : null}

            {currentStepId === "ready" ? (
              <section className="desktop-wizard-page">
                <h2>Your setup choices are ready.</h2>
                <p className="panel-description">
                  You can finish now and open BE Home, or go back if you want to change anything.
                </p>
                <div className="desktop-summary-grid">
                  {readySummaryRows.map((row) => (
                    <div className="desktop-detail-row" key={row.label}>
                      <dt>{row.label}</dt>
                      <dd className="desktop-detail-value-block">{row.value}</dd>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {inlineNotice !== null ? (
              <article
                className={
                  inlineNotice.tone === "warning"
                    ? "desktop-inline-message desktop-inline-message--warning"
                    : inlineNotice.tone === "success"
                      ? "desktop-inline-message desktop-inline-message--success"
                      : "desktop-inline-message"
                }
              >
                <h3>{inlineNotice.title}</h3>
                {inlineNotice.detail !== null ? <p>{inlineNotice.detail}</p> : null}
              </article>
            ) : null}
          </section>

          <footer className="desktop-utility-footer">
            <button
              className="tertiary-button"
              disabled={busy}
              onClick={handleCancelSetup}
              type="button"
            >
              Cancel
            </button>
            <div className="desktop-utility-footer-actions">
              {currentStepId !== "welcome" ? (
                <button className="secondary-button" disabled={busy} onClick={handleBack} type="button">
                  Back
                </button>
              ) : null}
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void handleNext()}
                type="button"
              >
                {currentStepId === "ready" ? "Finish" : "Next"}
              </button>
            </div>
          </footer>
        </section>
      </section>

      {cancelDialogOpen ? (
        <section className="desktop-modal-scrim" role="presentation">
          <article
            aria-labelledby="cancel-setup-title"
            className="desktop-modal-card"
            role="dialog"
          >
            <h2 id="cancel-setup-title">Cancel setup?</h2>
            <p className="panel-description">
              If you cancel setup now, the choices you made in this window will be lost.
            </p>
            <div className="desktop-inline-button-row">
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void handleConfirmCancelSetup()}
                type="button"
              >
                Yes, Cancel Setup
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setCancelDialogOpen(false)}
                type="button"
              >
                Keep Setup Open
              </button>
            </div>
          </article>
        </section>
      ) : null}

      {supportDialogDraft !== null ? (
        <section className="desktop-modal-scrim" role="presentation">
          <article
            aria-labelledby="support-request-title"
            className="desktop-modal-card"
            role="dialog"
          >
            <h2 id="support-request-title">Email Board Support</h2>
            <p className="panel-description">
              BE Home can open a draft in your mail app with the details below.
            </p>
            <div className="desktop-form-grid">
              <label className="desktop-field">
                <span className="desktop-field-label">To</span>
                <div className="desktop-readonly-field">{supportDialogDraft.to}</div>
              </label>
              <label className="desktop-field">
                <span className="desktop-field-label">Subject</span>
                <div className="desktop-readonly-field">{supportDialogDraft.subject}</div>
              </label>
              <label className="desktop-field">
                <span className="desktop-field-label">Email draft</span>
                <textarea
                  className="desktop-text-area"
                  readOnly
                  value={supportDialogDraft.body}
                />
              </label>
            </div>
            <p className="desktop-footnote">{supportInstructionText()}</p>
            <div className="desktop-inline-button-row">
              <button className="primary-button" onClick={() => void handleOpenSupportEmail()} type="button">
                Open Mail App
              </button>
              <button className="secondary-button" onClick={() => void handleCopySupportDraft()} type="button">
                Copy Email Draft
              </button>
              <button
                className="tertiary-button"
                onClick={() => setSupportDialogDraft(null)}
                type="button"
              >
                Close
              </button>
            </div>
          </article>
        </section>
      ) : null}

      {wizardAlertDialog !== null ? (
        <section className="desktop-modal-scrim" role="presentation">
          <article
            aria-labelledby="wizard-alert-title"
            className="desktop-modal-card"
            role="dialog"
          >
            <h2 id="wizard-alert-title">{wizardAlertDialog.title}</h2>
            {wizardAlertDialog.detail !== null ? (
              <p className="panel-description">{wizardAlertDialog.detail}</p>
            ) : null}
            <div className="desktop-inline-button-row">
              <button
                autoFocus
                className="primary-button"
                onClick={() => setWizardAlertDialog(null)}
                type="button"
              >
                {wizardAlertDialog.acknowledgeLabel ?? "OK"}
              </button>
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
