import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import {
  acquireBdbTool,
  dismissSetupWizardWindow,
  emitSettingsUpdated,
  loadBdbToolState,
  loadDesktopSettings,
  loadSetupGateState,
  refreshBdbToolState,
  saveDesktopSettings,
  showMainWorkspaceWindow,
} from "../desktop/client";
import type {
  BdbToolState,
  DesktopSettings,
  DesktopSettingsInput,
  SetupGateState,
  SupportRequestDraft,
} from "../desktop/types";

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
  const [supportDialogDraft, setSupportDialogDraft] = useState<SupportRequestDraft | null>(null);

  const currentStepIndex = wizardSteps.findIndex((step) => step.id === currentStepId);
  const toolStepBlocked = toolState?.supportRequestDraft !== null;
  const canAdvancePastToolStep = toolState?.status === "runnable" && !toolStepBlocked;

  useEffect(() => {
    void refreshWindowState();
  }, []);

  useEffect(() => {
    let unlistenCloseRequest: (() => void) | null = null;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (setupGateState?.status === "ready") {
          return;
        }

        event.preventDefault();
        await handleCancelSetup();
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
  }, [setupGateState?.status]);

  const readySummaryRows = useMemo(
    () =>
      [
        {
          label: "Board Install Tool",
          value:
            toolState?.versionCheck.value ??
            (toolState?.status === "runnable" ? "Installed" : "Still needs to be downloaded"),
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
      await emitSettingsUpdated();
      return true;
    } catch {
      setInlineNotice({
        tone: "warning",
        title: "BE Home couldn't save these setup choices yet.",
        detail: "Please try again in a moment.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSetup(): Promise<void> {
    await dismissSetupWizardWindow();
  }

  async function handleOpenWorkspace(): Promise<void> {
    await emitSettingsUpdated();
    await showMainWorkspaceWindow();
    await dismissSetupWizardWindow();
  }

  async function handleDownloadOrRepair(): Promise<void> {
    if (toolState === null) {
      return;
    }

    setBusy(true);
    setInlineNotice(null);

    try {
      const result = await acquireBdbTool(toolState.executableExists);
      setInlineNotice({
        tone: result.outcome === "failed" ? "warning" : "success",
        title: result.summary,
        detail: result.guidance,
      });
      await refreshWindowState({
        refreshManifest: result.outcome !== "failed",
      });
    } catch {
      setInlineNotice({
        tone: "warning",
        title: "BE Home couldn't finish that Board Install Tool step.",
        detail: "Please try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckForUpdate(): Promise<void> {
    setBusy(true);
    setInlineNotice(null);

    try {
      const latestToolState = await refreshBdbToolState();
      setToolState(latestToolState);
      setInlineNotice({
        tone: latestToolState.updateStatus.status === "updateAvailable" ? "warning" : "neutral",
        title: "BE Home checked Board's latest Board Install Tool version.",
        detail:
          latestToolState.updateStatus.guidance ??
          "You can review the current version details below.",
      });
    } catch {
      setInlineNotice({
        tone: "warning",
        title: "BE Home couldn't check for Board Install Tool updates right now.",
        detail: "Please try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddScanFolder(): Promise<void> {
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

    if (scanFolderDraft.includes(selectedPath)) {
      setInlineNotice({
        tone: "neutral",
        title: "That folder is already on the list.",
        detail: "Choose another folder if you want BE Home to watch an additional place.",
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
      setInlineNotice({
        tone: "warning",
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
      setInlineNotice({
        tone: "warning",
        title: "BE Home couldn't copy the email draft automatically.",
        detail: "Please use the text shown in this window instead.",
      });
    }
  }

  async function handleFinish(): Promise<void> {
    if (!(await saveDraftSettings())) {
      return;
    }

    await handleOpenWorkspace();
  }

  async function handleNext(): Promise<void> {
    setInlineNotice(null);

    switch (currentStepId) {
      case "welcome":
        setCurrentStepId("boardTool");
        return;
      case "boardTool":
        if (!canAdvancePastToolStep) {
          setInlineNotice({
            tone: "warning",
            title: "Finish the Board Install Tool step first.",
            detail: toolStepBlocked
              ? "This build of the Board Install Tool is not compatible with this computer yet."
              : "BE Home needs the Board Install Tool ready before it can open the workspace.",
          });
          return;
        }
        setCurrentStepId("scanFolders");
        return;
      case "scanFolders":
        if (await saveDraftSettings()) {
          setCurrentStepId("libraryLocation");
        }
        return;
      case "libraryLocation":
        if (await saveDraftSettings()) {
          setCurrentStepId("ready");
        }
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
    setCurrentStepId((previousStepId) => {
      const previousIndex = wizardSteps.findIndex((step) => step.id === previousStepId) - 1;
      return wizardSteps[Math.max(previousIndex, 0)]?.id ?? "welcome";
    });
  }

  if (windowError !== null) {
    return (
      <main className="page-shell desktop-shell desktop-utility-window">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">Setup Wizard</div>
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
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">Setup Wizard</div>
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
      <section className="page-grid narrow desktop-utility-grid">
        <section className="panel desktop-utility-card">
          <header className="desktop-utility-header">
            <div className="desktop-utility-heading">
              <div className="eyebrow">Setup Wizard</div>
              <h1>Set up BE Home for Desktop</h1>
              <p className="panel-description">
                BE Home for Desktop helps you find games and apps on this computer, keep a saved
                library close by, and install them on Board without command-line steps.
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
                <div className="eyebrow">Welcome</div>
                <h2>Here’s what setup will help you do.</h2>
                <p className="panel-description">
                  This quick setup will download the Board Install Tool, choose where BE Home looks
                  for games and apps, and choose where saved copies should live on this computer.
                </p>
                <ul className="desktop-wizard-checklist">
                  <li>Get the Board Install Tool ready so BE Home can talk to your Board.</li>
                  <li>Choose the folders BE Home should check for game and app files.</li>
                  <li>Choose where saved copies should be kept for later installs.</li>
                </ul>
              </section>
            ) : null}

            {currentStepId === "boardTool" ? (
              <section className="desktop-wizard-page">
                <div className="eyebrow">Board Install Tool</div>
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
                      {toolState.versionCheck.value ?? "Not installed yet"}
                    </div>
                  </label>
                  <label className="desktop-field">
                    <span className="desktop-field-label">Latest version in BE Home</span>
                    <div className="desktop-readonly-field">
                      {toolState.updateStatus.availableVersion ?? "Not available yet"}
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
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void handleCheckForUpdate()}
                    type="button"
                  >
                    Check for Update
                  </button>
                </div>

                <p className="desktop-footnote">
                  Board’s formal name for this helper is <strong>Board Developer Bridge (bdb)</strong>.
                </p>
              </section>
            ) : null}

            {currentStepId === "scanFolders" ? (
              <section className="desktop-wizard-page">
                <div className="eyebrow">Look for Games &amp; Apps</div>
                <h2>Choose the folders BE Home should check.</h2>
                <p className="panel-description">
                  BE Home can look in these folders when you rescan this computer for games and
                  apps. You can leave the list empty if you prefer to choose files manually.
                </p>

                <section className="desktop-list-editor">
                  <div className="desktop-list-editor-header">
                    <span className="desktop-field-label">Folders to check</span>
                    {iconButtonLabel("add", "Add folder", () => void handleAddScanFolder(), busy)}
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
                          {iconButtonLabel(
                            "remove",
                            `Remove ${path}`,
                            () => handleRemoveScanFolder(path),
                            busy,
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </section>
            ) : null}

            {currentStepId === "libraryLocation" ? (
              <section className="desktop-wizard-page">
                <div className="eyebrow">Library Location</div>
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
                <div className="eyebrow">Ready to Go</div>
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
              onClick={() => void handleCancelSetup()}
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

      {supportDialogDraft !== null ? (
        <section className="desktop-modal-scrim" role="presentation">
          <article
            aria-labelledby="support-request-title"
            className="panel desktop-modal-card"
            role="dialog"
          >
            <div className="eyebrow">Board Support</div>
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
    </main>
  );
}
