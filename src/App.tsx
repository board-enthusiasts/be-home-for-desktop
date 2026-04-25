import { getCurrentWindow } from "@tauri-apps/api/window";
import AboutWindowApp from "./about-window/AboutWindowApp";
import {
  ABOUT_WINDOW_LABEL,
  MAIN_WINDOW_LABEL,
  SETTINGS_WINDOW_LABEL,
  SETUP_WIZARD_WINDOW_LABEL,
} from "./desktop-shell/constants";
import { useWindowTheme } from "./desktop-shell/useWindowTheme";
import MainWorkspaceApp from "./main-window/MainWorkspaceApp";
import SettingsWindowApp from "./settings-window/SettingsWindowApp";
import SetupWizardApp from "./setup-window/SetupWizardApp";

const knownWindowLabels = new Set([
  MAIN_WINDOW_LABEL,
  SETUP_WIZARD_WINDOW_LABEL,
  SETTINGS_WINDOW_LABEL,
  ABOUT_WINDOW_LABEL,
]);

function normalizedWindowLabel(value: string | null | undefined): string | null {
  if (value === undefined || value === null || !knownWindowLabels.has(value)) {
    return null;
  }

  return value;
}

function routedWindowLabel(): string | null {
  const hashLabel = normalizedWindowLabel(window.location.hash.replace(/^#/, ""));
  if (hashLabel !== null) {
    return hashLabel;
  }

  return normalizedWindowLabel(new URLSearchParams(window.location.search).get("window"));
}

function currentWindowLabel(): string {
  const routeLabel = routedWindowLabel();
  if (routeLabel !== null) {
    return routeLabel;
  }

  try {
    return normalizedWindowLabel(getCurrentWindow().label) ?? MAIN_WINDOW_LABEL;
  } catch {
    return MAIN_WINDOW_LABEL;
  }
}

function UnsupportedWindow() {
  return (
    <main className="page-shell desktop-shell desktop-utility-window">
      <section className="desktop-utility-grid">
        <section className="desktop-state-view">
          <h2>This desktop window is not recognized.</h2>
          <p className="panel-description">
            Please close the extra window and reopen the desktop app from the main workspace.
          </p>
        </section>
      </section>
    </main>
  );
}

export default function App() {
  useWindowTheme();
  const windowLabel = currentWindowLabel();

  switch (windowLabel) {
    case MAIN_WINDOW_LABEL:
      return <MainWorkspaceApp />;
    case SETUP_WIZARD_WINDOW_LABEL:
      return <SetupWizardApp />;
    case SETTINGS_WINDOW_LABEL:
      return <SettingsWindowApp />;
    case ABOUT_WINDOW_LABEL:
      return <AboutWindowApp />;
    default:
      return <UnsupportedWindow />;
  }
}
