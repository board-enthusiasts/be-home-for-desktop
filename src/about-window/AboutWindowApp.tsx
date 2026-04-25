import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { closeAboutWindow, loadSetupGateState } from "../desktop/client";
import type { SetupGateState } from "../desktop/types";

async function handleOpenSupportEmail(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
  event.preventDefault();
  try {
    await openUrl("mailto:support@boardenthusiasts.com");
  } catch {
    window.location.href = "mailto:support@boardenthusiasts.com";
  }
}

async function handleCloseWindow(): Promise<void> {
  try {
    await closeAboutWindow();
    return;
  } catch {
    // Fall through to the local window handle for non-Tauri test and preview contexts.
  }

  try {
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

export default function AboutWindowApp() {
  const [setupGateState, setSetupGateState] = useState<SetupGateState | null>(null);

  useEffect(() => {
    void loadSetupGateState()
      .then((state) => {
        setSetupGateState(state);
      })
      .catch(() => {
        setSetupGateState(null);
      });
  }, []);

  return (
    <main className="page-shell desktop-shell desktop-utility-window">
      <section className="desktop-utility-grid">
        <section className="desktop-utility-dialog desktop-utility-dialog--about">
          <div className="desktop-about-copy">
            <h1>BE Home for Desktop</h1>
            <p className="panel-description">
              BE Home for Desktop helps players keep Board game and app installs in one guided
              desktop workspace instead of working through terminal steps by hand.
            </p>
            <p>
              Version: <strong>{setupGateState?.version ?? "0.1.0"}</strong>
            </p>
            <p>
              Board's install helper is formally named <strong>Board Developer Bridge (bdb)</strong>.
            </p>
            <p>
              The desktop app keeps Board checks, local game files, and saved library locations
              close by in one place.
            </p>
            <p>
              Need help? Contact{" "}
              <a
                className="desktop-support-link"
                href="mailto:support@boardenthusiasts.com"
                onClick={(event) => void handleOpenSupportEmail(event)}
              >
                support@boardenthusiasts.com
              </a>
              .
            </p>
          </div>
          <footer className="desktop-utility-footer desktop-utility-footer--about">
            <button
              className="primary-button"
              onClick={() => void handleCloseWindow()}
              type="button"
            >
              Close
            </button>
          </footer>
        </section>
      </section>
    </main>
  );
}
