import { render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { DesktopShellState } from "./desktop/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const shellStateFixture: DesktopShellState = {
  appName: "BE Home for Desktop",
  version: "0.1.0",
  platformLabel: "Windows",
  introEyebrow: "Board installs made easier",
  introSummary:
    "Keep your Board install tool ready, choose an APK from your computer, and keep favorite installs close for later.",
  highlights: [
    {
      label: "Manual choice",
      value: "Always welcome",
    },
  ],
  gettingStartedTitle: "Keep your next install close and familiar.",
  gettingStartedSteps: [
    "Connect your Board with USB when you are ready to install.",
    "Choose a game or app APK from a folder you already trust.",
  ],
  helpTitle: "Built for real player routines",
  helpSummary: "BE Home keeps the most important install steps in one place so getting back to play feels less scattered.",
  helpBullets: ["Your BE account stays optional."],
  sections: [
    {
      id: "apk-library",
      eyebrow: "Choose what to install",
      title: "Find downloads from familiar folders or your saved library",
      summary:
        "Keep Board-ready APKs together, browse what you already downloaded, and pick an APK yourself whenever that is fastest.",
      tone: "forest",
      badges: [
        {
          label: "Manual choice",
          value: "Always welcome",
        },
      ],
      bullets: ["Pick any APK yourself when that is the fastest way to move forward."],
    },
  ],
};

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("renders shell content returned by the Tauri host", async () => {
    invokeMock.mockResolvedValue(shellStateFixture);

    render(<App />);

    expect(screen.getByText("Opening BE Home for Desktop")).toBeInTheDocument();
    expect(
      await screen.findByText("Find downloads from familiar folders or your saved library"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "BE Home for Desktop" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pick any APK yourself when that is the fastest way to move forward."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/scaffold/i)).not.toBeInTheDocument();
  });

  it("shows a friendly host failure message", async () => {
    invokeMock.mockRejectedValue(new Error("host unavailable"));

    render(<App />);

    expect(
      await screen.findByText("Please close BE Home for Desktop and try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't reach the desktop host just yet. Try reloading the window or restarting the app."),
    ).toBeInTheDocument();
  });
});
