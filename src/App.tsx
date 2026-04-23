import { useEffect, useState } from "react";
import { loadDesktopShellState } from "./desktop/client";
import type { DesktopShellState, ShellSection } from "./desktop/types";

function App() {
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadState(): Promise<void> {
      try {
        const state = await loadDesktopShellState();
        if (!isCancelled) {
          setShellState(state);
        }
      } catch {
        if (!isCancelled) {
          setErrorMessage("We couldn't reach the desktop host just yet. Try reloading the window or restarting the app.");
        }
      }
    }

    void loadState();

    return () => {
      isCancelled = true;
    };
  }, []);

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

  if (shellState === null) {
    return (
      <main className="page-shell desktop-shell">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">Opening BE Home for Desktop</div>
            <h2>Just a moment while we get things ready.</h2>
            <p className="panel-description">We're opening your Board install workspace and checking the desktop connection.</p>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell desktop-shell">
      <section className="page-grid desktop-grid">
        <section className="hero-panel compact desktop-hero">
          <div className="hero-copy desktop-hero-copy">
            <div className="eyebrow">{shellState.introEyebrow}</div>
            <h1>{shellState.appName}</h1>
            <p>{shellState.introSummary}</p>
            <p className="desktop-platform-note">{shellState.platformLabel} desktop · v{shellState.version}</p>
          </div>
          <div className="desktop-highlight-row" aria-label="Key install notes">
            {shellState.highlights.map((highlight) => (
              <span className="desktop-highlight" key={`${highlight.label}-${highlight.value}`}>
                <span className="desktop-highlight-label">{highlight.label}</span>
                <span className="desktop-highlight-value">{highlight.value}</span>
              </span>
            ))}
          </div>
        </section>

        <section className="desktop-info-grid" aria-label="Desktop install overview">
          <article className="panel desktop-panel">
            <div className="eyebrow">Getting started</div>
            <h2>{shellState.gettingStartedTitle}</h2>
            <ol className="desktop-list desktop-list--ordered">
              {shellState.gettingStartedSteps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </article>
          <article className="panel desktop-panel">
            <div className="eyebrow">Good to know</div>
            <h2>{shellState.helpTitle}</h2>
            <p className="panel-description">{shellState.helpSummary}</p>
            <ul className="desktop-list">
              {shellState.helpBullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </section>

        <section className="desktop-section-grid" aria-label="What BE Home for Desktop keeps in one place">
          {shellState.sections.map((section) => (
            <SectionCard key={section.id} section={section} />
          ))}
        </section>
      </section>
    </main>
  );
}

interface SectionCardProps {
  section: ShellSection;
}

function SectionCard({ section }: SectionCardProps) {
  return (
    <article className={`panel desktop-section desktop-section--${section.tone}`}>
      <div className="eyebrow">{section.eyebrow}</div>
      <h2>{section.title}</h2>
      <p className="panel-description">{section.summary}</p>
      <div className="desktop-badge-row" aria-label={`${section.title} highlights`}>
        {section.badges.map((badge) => (
          <span className="status-chip" key={`${section.id}-${badge.label}`}>
            {badge.label}: {badge.value}
          </span>
        ))}
      </div>
      <ul className="desktop-list">
        {section.bullets.map((item) => (
          <li key={`${section.id}-${item}`}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

export default App;
