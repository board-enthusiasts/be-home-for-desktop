import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import {
  acquireBdbTool,
  dismissSetupWizardWindow,
  loadSetupGateState,
  showMainWorkspaceWindow,
} from "../desktop/client";
import type { BdbAcquisitionResult, SetupGateState } from "../desktop/types";
import {
  formatScanFolders,
  locationSourceLabel,
  statusLabel,
} from "../desktop-shell/formatters";
import { DetailRow, StatusChip, StatusSummaryCard } from "../desktop-shell/ui";

type SetupViewStep = "systemCheck" | "toolSetup" | "reviewDefaults";

interface SetupStepCardProps {
  stepNumber: number;
  title: string;
  summary: string;
  status: "active" | "complete" | "upcoming";
}

interface ToolActionState {
  loading: boolean;
  message: string | null;
  detail: string | null;
  lastOutcome: BdbAcquisitionResult["outcome"] | null;
}

function SetupStepCard({ stepNumber, title, summary, status }: SetupStepCardProps) {
  return (
    <li
      className={
        status === "active"
          ? "desktop-step-card desktop-step-card--active"
          : status === "complete"
            ? "desktop-step-card desktop-step-card--complete"
            : "desktop-step-card"
      }
    >
      <span className="desktop-step-number">{stepNumber}</span>
      <div className="desktop-step-copy">
        <h3>{title}</h3>
        <p>{summary}</p>
      </div>
    </li>
  );
}

function describeSetupStepStatus(
  activeStep: SetupViewStep,
  step: SetupViewStep,
): "active" | "complete" | "upcoming" {
  const stepOrder: Record<SetupViewStep, number> = {
    systemCheck: 1,
    toolSetup: 2,
    reviewDefaults: 3,
  };

  if (step === activeStep) {
    return "active";
  }

  if (stepOrder[step] < stepOrder[activeStep]) {
    return "complete";
  }

  return "upcoming";
}

export default function SetupWizardApp() {
  const [setupGateState, setSetupGateState] = useState<SetupGateState | null>(null);
  const [setupViewStep, setSetupViewStep] = useState<SetupViewStep>("systemCheck");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toolActionState, setToolActionState] = useState<ToolActionState>({
    loading: false,
    message: null,
    detail: null,
    lastOutcome: null,
  });

  useEffect(() => {
    void refreshSetupGateState();
  }, []);

  useEffect(() => {
    let unlistenCloseRequest: (() => void) | null = null;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
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

  async function refreshSetupGateState(options?: {
    showReviewDefaultsOnReady?: boolean;
  }): Promise<void> {
    try {
      const state = await loadSetupGateState();
      setSetupGateState(state);
      setErrorMessage(null);

      if (state.status === "ready") {
        setSetupViewStep("reviewDefaults");
        return;
      }

      if (options?.showReviewDefaultsOnReady === true) {
        setSetupViewStep("reviewDefaults");
        return;
      }

      setSetupViewStep(state.requiredStep === "toolSetup" ? "toolSetup" : "systemCheck");
    } catch {
      setErrorMessage(
        "We couldn't reach the desktop host just yet. Try closing and reopening the app.",
      );
    }
  }

  async function handleAcquireBdbTool(repair: boolean): Promise<void> {
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
      await refreshSetupGateState({
        showReviewDefaultsOnReady:
          result.toolState.status === "runnable" &&
          (result.outcome === "downloaded" || result.outcome === "repaired"),
      });
    } catch {
      setToolActionState({
        loading: false,
        message: "BE Home couldn't finish the bdb setup step.",
        detail: "Please try again in a moment.",
        lastOutcome: "failed",
      });
    }
  }

  async function handleCancelSetup(): Promise<void> {
    await dismissSetupWizardWindow();
  }

  async function handleOpenWorkspace(): Promise<void> {
    await showMainWorkspaceWindow();
    await dismissSetupWizardWindow();
  }

  if (errorMessage !== null) {
    return (
      <main className="page-shell desktop-shell desktop-utility-window">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">Setup Wizard</div>
            <h2>Please close BE Home for Desktop and try again.</h2>
            <p className="panel-description">{errorMessage}</p>
          </section>
        </section>
      </main>
    );
  }

  if (setupGateState === null) {
    return (
      <main className="page-shell desktop-shell desktop-utility-window">
        <section className="page-grid narrow">
          <section className="panel desktop-state-card" aria-live="polite">
            <div className="eyebrow">Setup Wizard</div>
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
    <main className="page-shell desktop-shell desktop-utility-window">
      <section className="page-grid desktop-grid">
        <section className="hero-panel desktop-banner">
          <div className="hero-copy desktop-banner-copy">
            <div className="eyebrow">Setup Wizard</div>
            <h1>Get your install workspace ready</h1>
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
              <>
                <div className="eyebrow">Step 1</div>
                <h2>Check this computer before downloading anything.</h2>
                <p className="panel-description">{setupGateState.guidance}</p>
                <dl className="desktop-detail-grid">
                  <DetailRow label="Support status" value={statusLabel(setupGateState.status)} />
                  <DetailRow
                    label="Operating system"
                    value={setupGateState.toolState.sourcePlan.support.operatingSystem}
                  />
                  <DetailRow
                    label="Architecture"
                    value={setupGateState.toolState.sourcePlan.support.architecture}
                  />
                  <DetailRow
                    label="Windows build"
                    value={
                      setupGateState.toolState.sourcePlan.support.windowsBuild === null
                        ? "Not needed on this platform"
                        : String(setupGateState.toolState.sourcePlan.support.windowsBuild)
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
                    disabled={setupGateState.status === "unsupported"}
                    onClick={() => setSetupViewStep("toolSetup")}
                    type="button"
                  >
                    Continue to bdb setup
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void refreshSetupGateState()}
                    type="button"
                  >
                    Refresh checks
                  </button>
                  <button
                    className="tertiary-button"
                    onClick={() => void handleCancelSetup()}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : null}

            {setupViewStep === "toolSetup" ? (
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
                    onClick={() =>
                      void handleAcquireBdbTool(setupGateState.toolState.executableExists)
                    }
                    type="button"
                  >
                    {toolActionState.loading
                      ? "Working..."
                      : setupGateState.toolState.executableExists
                        ? "Repair bdb"
                        : "Download bdb"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={toolActionState.loading}
                    onClick={() => void refreshSetupGateState()}
                    type="button"
                  >
                    Refresh checks
                  </button>
                  <button
                    className="tertiary-button"
                    disabled={toolActionState.loading}
                    onClick={() => setSetupViewStep("systemCheck")}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className="tertiary-button"
                    disabled={toolActionState.loading}
                    onClick={() => void handleCancelSetup()}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : null}

            {setupViewStep === "reviewDefaults" ? (
              <>
                <div className="eyebrow">Step 3</div>
                <h2>Review the local defaults BE Home will start with.</h2>
                <p className="panel-description">
                  You can change these locations later, but this is the familiar starting point
                  BE Home will use today.
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
                  <button className="primary-button" onClick={() => void handleOpenWorkspace()} type="button">
                    Open workspace
                  </button>
                  <button
                    className="tertiary-button"
                    onClick={() => setSetupViewStep("toolSetup")}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className="tertiary-button"
                    onClick={() => void handleCancelSetup()}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : null}
          </section>
        </section>
      </section>
    </main>
  );
}
