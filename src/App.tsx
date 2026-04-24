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

function UnsupportedWindow() {
  return (
    <main className="page-shell desktop-shell desktop-utility-window">
      <section className="page-grid narrow">
        <section className="panel desktop-state-card">
          <div className="eyebrow">Desktop Shell</div>
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
  const windowLabel = getCurrentWindow().label ?? MAIN_WINDOW_LABEL;

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
