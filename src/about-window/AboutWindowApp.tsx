import { useEffect, useState } from "react";
import { loadSetupGateState } from "../desktop/client";
import type { SetupGateState } from "../desktop/types";

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
      <section className="page-grid narrow">
        <section className="panel desktop-state-card">
          <div className="eyebrow">About</div>
          <h2>BE Home for Desktop</h2>
          <p className="panel-description">
            BE Home for Desktop helps players keep Board game and app installs in one guided
            desktop workspace instead of working through terminal steps by hand.
          </p>
          <div className="desktop-about-list">
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
          </div>
        </section>
      </section>
    </main>
  );
}
