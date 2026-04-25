import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import {
  acquireBdbTool,
  emitSettingsUpdated,
  loadBdbToolState,
  loadDesktopSettings,
  refreshBdbToolState,
  saveDesktopSettings,
} from "../desktop/client";
import type {
  BdbToolState,
  DesktopSettings,
  DesktopSettingsInput,
  SupportRequestDraft,
} from "../desktop/types";
import { formatBoardInstallToolVersion } from "../desktop/presentation";

type SettingsTabId = "locations" | "boardConnection" | "boardTool";

interface InlineNotice {
  tone: "neutral" | "warning" | "success";
  title: string;
  detail: string | null;
}

const pollIntervalOptions = [
  { label: "5 seconds", value: 5 },
  { label: "10 seconds", value: 10 },
  { label: "30 seconds", value: 30 },
];

function iconButton(icon: string, label: string, onClick: () => void, disabled = false) {
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

function normalizeLibraryOverride(defaultPath: string, currentPath: string): string | null {
  const trimmed = currentPath.trim();
  if (trimmed.length === 0 || trimmed === defaultPath) {
    return null;
  }

  return trimmed;
}

function toolActionLabel(toolState: BdbToolState): string {
  if (!toolState.executableExists) {
    return "Download";
  }

  if (toolState.updateStatus.status === "updateAvailable") {
    return "Download Update";
  }

  return "Reinstall";
}

export default function SettingsWindowApp() {
  const [activeTabId, setActiveTabId] = useState<SettingsTabId>("locations");
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [toolState, setToolState] = useState<BdbToolState | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null);
  const [supportDialogDraft, setSupportDialogDraft] = useState<SupportRequestDraft | null>(null);

  useEffect(() => {
    void refreshWindowState();
  }, []);

  async function refreshWindowState(options?: { refreshManifest?: boolean }): Promise<void> {
    try {
      const [settings, latestToolState] = await Promise.all([
        loadDesktopSettings(),
        options?.refreshManifest === true ? refreshBdbToolState() : loadBdbToolState(),
      ]);
      setDesktopSettings(settings);
      setToolState(latestToolState);
      setWindowError(null);
    } catch {
      setWindowError(
        "BE Home couldn't load this settings window just yet. Please close it and try again.",
      );
    }
  }

  async function persistSettings(
    input: DesktopSettingsInput,
    successTitle: string,
    successDetail: string,
  ): Promise<void> {
    setBusy(true);
    setInlineNotice(null);

    try {
      const savedSettings = await saveDesktopSettings(input);
      setDesktopSettings(savedSettings);
      setInlineNotice({
        tone: "success",
        title: successTitle,
        detail: successDetail,
      });
      await emitSettingsUpdated();
      await refreshWindowState();
    } catch {
      setInlineNotice({
        tone: "warning",
        title: "BE Home couldn't save these settings yet.",
        detail: "Please try again in a moment.",
      });
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
        defaultPath:
          desktopSettings.scanFolders[desktopSettings.scanFolders.length - 1]?.path ??
          desktopSettings.apkLibrary.effectivePath,
      }),
    );
    if (selectedPath === null) {
      return;
    }

    if (desktopSettings.scanFolders.some((folder) => folder.path === selectedPath)) {
      setInlineNotice({
        tone: "neutral",
        title: "That folder is already on the list.",
        detail: "Choose another folder if you want BE Home to check an additional place.",
      });
      return;
    }

    await persistSettings(
      {
        apkLibraryOverride: desktopSettings.apkLibrary.overridePath,
        boardConnectionPollIntervalSeconds: desktopSettings.boardConnection.pollIntervalSeconds,
        scanFolderPaths: [...desktopSettings.scanFolders.map((folder) => folder.path), selectedPath],
      },
      "Games and apps folders updated.",
      "BE Home will keep this new folder in view the next time you rescan.",
    );
  }

  async function handleRemoveScanFolder(path: string): Promise<void> {
    if (desktopSettings === null) {
      return;
    }

    await persistSettings(
      {
        apkLibraryOverride: desktopSettings.apkLibrary.overridePath,
        boardConnectionPollIntervalSeconds: desktopSettings.boardConnection.pollIntervalSeconds,
        scanFolderPaths: desktopSettings.scanFolders
          .map((folder) => folder.path)
          .filter((folderPath) => folderPath !== path),
      },
      "Games and apps folders updated.",
      "BE Home saved the new folder list.",
    );
  }

  async function handleChangeLibraryLocation(): Promise<void> {
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

    await persistSettings(
      {
        apkLibraryOverride: normalizeLibraryOverride(
          desktopSettings.apkLibrary.defaultPath,
          selectedPath,
        ),
        boardConnectionPollIntervalSeconds: desktopSettings.boardConnection.pollIntervalSeconds,
        scanFolderPaths: desktopSettings.scanFolders.map((folder) => folder.path),
      },
      "Saved library location updated.",
      "BE Home will use this folder for saved copies from now on.",
    );
  }

  async function handleResetLibraryLocation(): Promise<void> {
    if (desktopSettings === null) {
      return;
    }

    await persistSettings(
      {
        apkLibraryOverride: null,
        boardConnectionPollIntervalSeconds: desktopSettings.boardConnection.pollIntervalSeconds,
        scanFolderPaths: desktopSettings.scanFolders.map((folder) => folder.path),
      },
      "Saved library location reset.",
      "BE Home is using the recommended location again.",
    );
  }

  async function handleChangePollInterval(nextValue: number): Promise<void> {
    if (desktopSettings === null) {
      return;
    }

    await persistSettings(
      {
        apkLibraryOverride: desktopSettings.apkLibrary.overridePath,
        boardConnectionPollIntervalSeconds: nextValue,
        scanFolderPaths: desktopSettings.scanFolders.map((folder) => folder.path),
      },
      "Board connection timing updated.",
      "BE Home will use the new refresh timing the next time it checks your Board.",
    );
  }

  async function handleCheckForUpdate(): Promise<void> {
    setBusy(true);
    setInlineNotice(null);

    try {
      const latestToolState = await refreshBdbToolState();
      setToolState(latestToolState);
      setInlineNotice({
        tone:
          latestToolState.updateStatus.status === "updateAvailable" ? "warning" : "neutral",
        title: "BE Home checked Board's latest Board Install Tool version.",
        detail: latestToolState.updateStatus.guidance,
      });
      await emitSettingsUpdated();
    } catch {
      setInlineNotice({
        tone: "warning",
        title: "BE Home couldn't check for updates right now.",
        detail: "Please try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRepairOrReinstall(): Promise<void> {
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
      await refreshWindowState({ refreshManifest: true });
      await emitSettingsUpdated();
    } catch {
      setInlineNotice({
        tone: "warning",
        title: "BE Home couldn't finish that Board Install Tool action.",
        detail: "Please try again in a moment.",
      });
    } finally {
      setBusy(false);
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
        detail: "You can still copy the draft from this window.",
      });
    }
  }

  async function handleCopySupportDraft(): Promise<void> {
    if (supportDialogDraft === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        [`To: ${supportDialogDraft.to}`, `Subject: ${supportDialogDraft.subject}`, "", supportDialogDraft.body].join(
          "\n",
        ),
      );
      setInlineNotice({
        tone: "success",
        title: "Email draft copied.",
        detail: "Paste it into your mail app, then add your email address and name before sending.",
      });
    } catch {
      setInlineNotice({
        tone: "warning",
        title: "BE Home couldn't copy the email draft automatically.",
        detail: "Please use the draft text shown in this window instead.",
      });
    }
  }

  async function handleCloseWindow(): Promise<void> {
    await getCurrentWindow().close();
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

  if (desktopSettings === null || toolState === null) {
    return (
      <main className="page-shell desktop-shell desktop-utility-window">
        <section className="desktop-utility-grid">
          <section className="desktop-state-view" aria-live="polite">
            <h2>Loading settings</h2>
            <p className="panel-description">
              BE Home is loading your folder choices and Board Install Tool details.
            </p>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell desktop-shell desktop-utility-window">
      <section className="desktop-utility-grid">
        <section className="desktop-utility-dialog">
          <header className="desktop-utility-header">
            <div className="desktop-utility-heading">
              <h1>BE Home for Desktop settings</h1>
              <p className="panel-description">
                Keep the most important folders, Board checks, and Board Install Tool options in
                one easy place.
              </p>
            </div>
            <nav aria-label="Settings sections" className="desktop-tab-row">
              <button
                className={
                  activeTabId === "locations"
                    ? "desktop-tab-button desktop-tab-button--active"
                    : "desktop-tab-button"
                }
                onClick={() => setActiveTabId("locations")}
                type="button"
              >
                Locations
              </button>
              <button
                className={
                  activeTabId === "boardConnection"
                    ? "desktop-tab-button desktop-tab-button--active"
                    : "desktop-tab-button"
                }
                onClick={() => setActiveTabId("boardConnection")}
                type="button"
              >
                Board Connection
              </button>
              <button
                className={
                  activeTabId === "boardTool"
                    ? "desktop-tab-button desktop-tab-button--active"
                    : "desktop-tab-button"
                }
                onClick={() => setActiveTabId("boardTool")}
                type="button"
              >
                Board Install Tool
              </button>
            </nav>
          </header>

          <section className="desktop-utility-body" aria-live="polite">
            {activeTabId === "locations" ? (
              <section className="desktop-settings-page">
                <h2>Choose where BE Home looks and saves.</h2>

                <section className="desktop-settings-section">
                  <div className="desktop-list-editor-header desktop-list-editor-header--stacked">
                    <div>
                      <span className="desktop-field-label">Games and apps folders</span>
                      <p className="desktop-section-copy">
                        BE Home checks these folders when you rescan this computer.
                      </p>
                    </div>
                    <div className="desktop-list-editor-actions">
                      {iconButton("add", "Add folder", () => void handleAddScanFolder(), busy)}
                    </div>
                  </div>

                  {desktopSettings.scanFolders.length === 0 ? (
                    <div className="desktop-empty-note">
                      No folders are selected. You can still choose games and apps manually.
                    </div>
                  ) : (
                    <ul className="desktop-folder-list desktop-folder-list--compact">
                      {desktopSettings.scanFolders.map((folder) => (
                        <li className="desktop-folder-item" key={folder.path}>
                          <div className="desktop-folder-copy">
                            <p className="desktop-folder-path">{folder.path}</p>
                            <p className="desktop-folder-meta">
                              {folder.source === "default" ? "Recommended folder" : "Custom folder"}
                            </p>
                          </div>
                          <div className="desktop-folder-actions">
                            {iconButton(
                              "remove",
                              `Remove ${folder.path}`,
                              () => void handleRemoveScanFolder(folder.path),
                              busy,
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="desktop-settings-section">
                  <label className="desktop-field">
                    <span className="desktop-field-label">Saved library folder</span>
                    <div className="desktop-input-with-button">
                      <input
                        className="desktop-text-field"
                        readOnly
                        type="text"
                        value={desktopSettings.apkLibrary.effectivePath}
                      />
                      {iconButton(
                        "folder_open",
                        "Choose saved library folder",
                        () => void handleChangeLibraryLocation(),
                        busy,
                      )}
                    </div>
                  </label>
                  <div className="desktop-recommended-row">
                    <span className="desktop-recommended-badge">
                      {desktopSettings.apkLibrary.overridePath === null ? "Recommended" : "Custom"}
                    </span>
                    {desktopSettings.apkLibrary.overridePath !== null ? (
                      <button
                        className="tertiary-button desktop-link-button"
                        disabled={busy}
                        onClick={() => void handleResetLibraryLocation()}
                        type="button"
                      >
                        Use recommended location
                      </button>
                    ) : null}
                  </div>
                </section>

                <section className="desktop-settings-section">
                  <label className="desktop-field">
                    <span className="desktop-field-label">Board Install Tool location</span>
                    <div className="desktop-readonly-field">{desktopSettings.bdbExecutablePath}</div>
                  </label>
                </section>
              </section>
            ) : null}

            {activeTabId === "boardConnection" ? (
              <section className="desktop-settings-page">
                <h2>Choose how often BE Home checks your Board.</h2>
                <p className="panel-description">
                  BE Home only refreshes while its main window is visible.
                </p>
                <div className="desktop-radio-list" role="radiogroup" aria-label="Board refresh timing">
                  {pollIntervalOptions.map((option) => (
                    <button
                      aria-checked={
                        desktopSettings.boardConnection.pollIntervalSeconds === option.value
                      }
                      className={
                        desktopSettings.boardConnection.pollIntervalSeconds === option.value
                          ? "desktop-radio-card desktop-radio-card--active"
                          : "desktop-radio-card"
                      }
                      disabled={busy}
                      key={option.value}
                      onClick={() => void handleChangePollInterval(option.value)}
                      role="radio"
                      type="button"
                    >
                      <span className="desktop-radio-title">{option.label}</span>
                      <span className="desktop-radio-copy">
                        {option.value === 5
                          ? "Recommended for most players."
                          : option.value === 10
                            ? "A little quieter while still feeling current."
                            : "Best when you prefer fewer checks."}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {activeTabId === "boardTool" ? (
              <section className="desktop-settings-page">
                <h2>Keep the Board Install Tool ready.</h2>
                <p className="panel-description">
                  BE Home uses this helper to talk to your Board and install games and apps.
                </p>

                <div className="desktop-form-grid">
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
                        "Not available yet",
                      )}
                    </div>
                  </label>
                  <label className="desktop-field">
                    <span className="desktop-field-label">Install location</span>
                    <div className="desktop-readonly-field">{toolState.executablePath}</div>
                  </label>
                </div>

                <article className="desktop-inline-card">
                  <h3>{toolState.summary}</h3>
                  <p>{toolState.updateStatus.guidance}</p>
                </article>

                {toolState.supportRequestDraft !== null ? (
                  <article className="desktop-inline-message desktop-inline-message--warning">
                    <h3>This build of the Board Install Tool is not compatible with this computer.</h3>
                    <p>BE Home can help you start a support email to Board with the exact error.</p>
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
                    onClick={() => void handleRepairOrReinstall()}
                    type="button"
                  >
                    {busy ? "Working..." : toolActionLabel(toolState)}
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
            <div />
            <div className="desktop-utility-footer-actions">
              <button className="primary-button" onClick={() => void handleCloseWindow()} type="button">
                Done
              </button>
            </div>
          </footer>
        </section>
      </section>

      {supportDialogDraft !== null ? (
        <section className="desktop-modal-scrim" role="presentation">
          <article
            aria-labelledby="settings-support-request-title"
            className="desktop-modal-card"
            role="dialog"
          >
            <h2 id="settings-support-request-title">Email Board Support</h2>
            <p className="panel-description">
              BE Home can open this draft in your mail app for you.
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
                <textarea className="desktop-text-area" readOnly value={supportDialogDraft.body} />
              </label>
            </div>
            <p className="desktop-footnote">
              Please enter your email address in the From field and add your name at the end before
              sending.
            </p>
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
