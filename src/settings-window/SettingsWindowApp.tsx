import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import {
  acquireBdbTool,
  emitSettingsUpdated,
  loadDesktopSettings,
  loadSetupGateState,
  saveDesktopSettings,
} from "../desktop/client";
import type {
  DesktopSettings,
  DesktopSettingsInput,
  SetupGateState,
} from "../desktop/types";
import { locationSourceLabel } from "../desktop-shell/formatters";
import { DetailRow, StatusSummaryCard } from "../desktop-shell/ui";

interface SettingsActionState {
  loading: boolean;
  message: string | null;
  detail: string | null;
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

export default function SettingsWindowApp() {
  const [setupGateState, setSetupGateState] = useState<SetupGateState | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settingsActionState, setSettingsActionState] = useState<SettingsActionState>({
    loading: false,
    message: null,
    detail: null,
  });

  useEffect(() => {
    void refreshWindowState();
  }, []);

  async function refreshWindowState(): Promise<void> {
    try {
      const [setupState, settings] = await Promise.all([
        loadSetupGateState(),
        loadDesktopSettings(),
      ]);
      setSetupGateState(setupState);
      setDesktopSettings(settings);
      setErrorMessage(null);
    } catch {
      setErrorMessage(
        "BE Home couldn't load your settings just yet. Try closing and reopening the window.",
      );
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
      await emitSettingsUpdated();
      await refreshWindowState();
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

    try {
      const result = await acquireBdbTool(true);
      setSettingsActionState({
        loading: false,
        message: result.summary,
        detail: result.guidance,
      });
      await emitSettingsUpdated();
      await refreshWindowState();
    } catch {
      setSettingsActionState({
        loading: false,
        message: "BE Home couldn't start the bdb repair just yet.",
        detail: "Please try again in a moment.",
      });
    }
  }

  if (errorMessage !== null) {
    return (
      <main className="page-shell desktop-shell desktop-utility-window">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">Settings</div>
            <h2>Please close BE Home for Desktop and try again.</h2>
            <p className="panel-description">{errorMessage}</p>
          </section>
        </section>
      </main>
    );
  }

  if (setupGateState === null || desktopSettings === null) {
    return (
      <main className="page-shell desktop-shell desktop-utility-window">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">Settings</div>
            <h2>Loading your folder settings.</h2>
            <p className="panel-description">
              BE Home is loading your current scan folders and storage choices.
            </p>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell desktop-shell desktop-utility-window">
      <section className="page-grid desktop-grid">
        <article className="hero-panel desktop-banner desktop-banner--compact">
          <div className="hero-copy desktop-banner-copy">
            <div className="eyebrow">Settings</div>
            <h1>Keep folders and storage understandable</h1>
            <p>
              These settings stay focused on the places BE Home actually uses, so you can shape
              your install routine without hunting through app files.
            </p>
          </div>
        </article>

        <section className="desktop-settings-layout">
          <article className="panel desktop-workspace-panel">
            <div className="eyebrow">Scan folders</div>
            <h2>Keep your local game folders in view.</h2>
            <p className="panel-description">
              BE Home can check these folders when you want to find downloads again later.
            </p>
            <div className="desktop-folder-list">
              {desktopSettings.scanFolders.length === 0 ? (
                <p className="desktop-folder-empty">
                  You do not have any scan folders yet. Add one when you want BE Home to keep a
                  folder in view.
                </p>
              ) : (
                desktopSettings.scanFolders.map((folder) => (
                  <article className="desktop-folder-card" key={folder.path}>
                    <div className="desktop-folder-copy">
                      <h3>{folder.path}</h3>
                      <p className="desktop-folder-meta">
                        {folder.source === "default" ? "App default" : "Custom"}
                      </p>
                    </div>
                    <button
                      className="secondary-button secondary-button--compact"
                      disabled={settingsActionState.loading}
                      onClick={() => void handleRemoveScanFolder(folder.path)}
                      type="button"
                    >
                      Remove
                    </button>
                  </article>
                ))
              )}
            </div>
            <div className="desktop-action-row">
              <button
                className="primary-button"
                disabled={settingsActionState.loading}
                onClick={() => void handleAddScanFolder()}
                type="button"
              >
                Add scan folder
              </button>
            </div>
          </article>

          <article className="panel desktop-workspace-panel">
            <div className="eyebrow">Managed APK library</div>
            <h2>Keep your saved copies in one familiar place.</h2>
            <p className="panel-description">
              This is where BE Home keeps the app-managed library of files you want to reuse later.
            </p>
            <dl className="desktop-detail-grid">
              <DetailRow label="Current location" value={desktopSettings.apkLibrary.effectivePath} />
              <DetailRow
                label="Location source"
                value={locationSourceLabel(desktopSettings.apkLibrary)}
              />
            </dl>
            <div className="desktop-action-row">
              <button
                className="primary-button"
                disabled={settingsActionState.loading}
                onClick={() => void handleChangeApkLibraryLocation()}
                type="button"
              >
                Change library folder
              </button>
              {desktopSettings.apkLibrary.overridePath !== null ? (
                <button
                  className="secondary-button"
                  disabled={settingsActionState.loading}
                  onClick={() => void handleResetApkLibraryLocation()}
                  type="button"
                >
                  Use app default
                </button>
              ) : null}
            </div>
          </article>

          <article className="panel desktop-workspace-panel">
            <div className="eyebrow">Board tool</div>
            <h2>Keep Board's install tool ready.</h2>
            <p className="panel-description">
              This path is read-only here, but you can repair the managed Board tool when it needs
              attention.
            </p>
            <dl className="desktop-detail-grid">
              <DetailRow label="Managed bdb location" value={desktopSettings.bdbExecutablePath} />
              <DetailRow label="Current state" value={setupGateState.toolState.summary} />
              <DetailRow label="Settings file" value={desktopSettings.settingsFilePath} />
            </dl>

            <StatusSummaryCard
              title="Current tool state"
              summary={setupGateState.toolState.summary}
              guidance={setupGateState.toolState.guidance}
            />

            <div className="desktop-action-row">
              <button
                className="primary-button"
                disabled={settingsActionState.loading}
                onClick={() => void handleRepairFromSettings()}
                type="button"
              >
                Repair bdb
              </button>
            </div>
          </article>
        </section>

        {settingsActionState.message !== null ? (
          <article className="panel desktop-workspace-panel desktop-inline-message">
            <h3>{settingsActionState.message}</h3>
            {settingsActionState.detail !== null ? <p>{settingsActionState.detail}</p> : null}
          </article>
        ) : null}
      </section>
    </main>
  );
}
