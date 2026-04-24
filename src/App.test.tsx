import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  DesktopSettings,
  DeviceStatusSnapshot,
  SetupGateState,
} from "./desktop/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const onFocusChangedMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onFocusChanged: onFocusChangedMock,
  })),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);
const openMock = vi.mocked(open);

const missingToolFixture: SetupGateState = {
  appName: "BE Home for Desktop",
  version: "0.1.0",
  platformLabel: "Windows",
  status: "requiresSetup",
  requiredStep: "toolSetup",
  summary: "BE Home still needs to download Board's install tool before the workspace can open.",
  guidance: "Continue setup and BE Home will download Board's bdb into its managed tools folder for you.",
  toolState: {
    status: "missing",
    summary: "BE Home has not downloaded bdb into the managed tools folder yet.",
    guidance:
      "Continue setup and BE Home will download Board's bdb into its managed tools folder for you.",
    executablePath: "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\tools\\bdb.exe",
    executableExists: false,
    storage: {
      defaultPath: "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\tools",
      overridePath: null,
      effectivePath: "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\tools",
      source: "default",
    },
    sourcePlan: {
      manifestSource: "bundled",
      remoteManifestUrl: "https://example.com/bdb-sources.json",
      manifestCachePath: null,
      manifestSchemaVersion: 1,
      support: {
        status: "supported",
        operatingSystem: "windows",
        architecture: "x86_64",
        windowsBuild: 26100,
        platformKey: "windows-x86_64",
        reason: null,
        guidance: "This machine matches a Board-published bdb target.",
      },
      source: {
        platformKey: "windows-x86_64",
        downloadUrl: "https://example.com/bdb.exe",
      },
    },
    validation: {
      status: "missing",
      command: "bdb help",
      exitCode: null,
      summary: "No managed bdb executable is present yet.",
      detail: null,
    },
  },
  storage: {
    operatingSystem: "windows",
    settingsFilePath:
      "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\settings\\managed-storage.json",
    bdbTools: {
      defaultPath: "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\tools",
      overridePath: null,
      effectivePath: "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\tools",
      source: "default",
    },
    apkLibrary: {
      defaultPath:
        "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\apk-library",
      overridePath: null,
      effectivePath:
        "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\apk-library",
      source: "default",
    },
  },
  defaultScanFolders: ["C:\\Users\\Matt\\Downloads"],
};

const runnableFixture: SetupGateState = {
  ...missingToolFixture,
  status: "ready",
  requiredStep: "workspace",
  summary: "Board's install tool is ready, so BE Home can open your desktop workspace.",
  guidance: "You can come back to repair the install tool later if anything changes.",
  toolState: {
    ...missingToolFixture.toolState,
    status: "runnable",
    summary: "Board's install tool is ready to use.",
    executableExists: true,
    validation: {
      status: "runnable",
      command: "bdb help",
      exitCode: 0,
      summary: "BE Home could open bdb from its managed tools folder.",
      detail: null,
    },
  },
};

const desktopSettingsFixture: DesktopSettings = {
  operatingSystem: "windows",
  settingsFilePath:
    "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\settings\\managed-storage.json",
  bdbTools: missingToolFixture.storage.bdbTools,
  apkLibrary: missingToolFixture.storage.apkLibrary,
  bdbExecutablePath: missingToolFixture.toolState.executablePath,
  scanFolders: [
    {
      path: "C:\\Users\\Matt\\Downloads",
      source: "default",
    },
  ],
};

const deviceStatusFixture: DeviceStatusSnapshot = {
  status: "boardConnected",
  summary: "Board connection looks ready.",
  guidance:
    "You can keep using the desktop workspace while BE Home refreshes the connection in the background.",
  detail: "Board connected and ready.",
  pollIntervalMs: 5000,
  bdbVersion: {
    status: "available",
    command: "bdb version",
    value: "bdb 0.19.0",
    exitCode: 0,
    summary: "BE Home is using `bdb 0.19.0`.",
    detail: null,
  },
};

const disconnectedDeviceStatusFixture: DeviceStatusSnapshot = {
  ...deviceStatusFixture,
  status: "boardDisconnected",
  summary: "Board is not connected yet.",
  guidance: "Connect your Board with USB, unlock it if needed, then choose refresh.",
  detail:
    "Once Board is connected, BE Home will keep install and inventory actions close by.",
};

const brokenToolDeviceStatusFixture: DeviceStatusSnapshot = {
  ...deviceStatusFixture,
  status: "toolBroken",
  summary:
    "BE Home found the Board install tool, but this computer is not letting it run cleanly yet.",
  guidance: "Choose repair in settings to fetch a fresh copy of bdb, then try again.",
  detail: "Choose repair in settings to fetch a fresh copy of bdb.",
};

const unsupportedSetupFixture: SetupGateState = {
  ...missingToolFixture,
  status: "unsupported",
  requiredStep: "systemCheck",
  summary: "This computer cannot complete the Board install-tool setup yet.",
  guidance:
    "Board currently publishes bdb only for macOS, Linux amd64, and Windows 11 x86_64.",
  toolState: {
    ...missingToolFixture.toolState,
    status: "unsupported",
    summary: "This computer is outside Board's current bdb support matrix.",
    guidance:
      "Board currently publishes bdb only for macOS, Linux amd64, and Windows 11 x86_64.",
    sourcePlan: {
      ...missingToolFixture.toolState.sourcePlan,
      support: {
        ...missingToolFixture.toolState.sourcePlan.support,
        status: "unsupported",
        platformKey: null,
        reason: "unsupportedOperatingSystemVersion",
      },
      source: null,
    },
    validation: {
      ...missingToolFixture.toolState.validation,
      status: "unsupported",
      summary:
        "BE Home skipped the bdb runnable check because Board does not publish a supported download for this computer.",
    },
  },
};

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    getCurrentWindowMock.mockClear();
    onFocusChangedMock.mockReset();
    onFocusChangedMock.mockResolvedValue(() => undefined);
    openMock.mockReset();
  });

  it("keeps players inside the setup flow when bdb is missing", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        return missingToolFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(screen.getByText("Opening BE Home for Desktop")).toBeInTheDocument();
    expect(await screen.findByText("Get your install workspace ready")).toBeInTheDocument();
    expect(screen.getByText("Get Board's install tool ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download bdb" })).toBeInTheDocument();
  });

  it("opens the workspace when bdb is already runnable", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        return runnableFixture;
      }

      if (command === "load_desktop_settings") {
        return desktopSettingsFixture;
      }

      if (command === "load_device_status_snapshot") {
        return deviceStatusFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Your desktop install space is ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Device/ })).toBeInTheDocument();
    expect(await screen.findByText("Board connection looks ready.")).toBeInTheDocument();
    expect(screen.getByText("bdb 0.19.0")).toBeInTheDocument();
  });

  it("shows the review-defaults step after a successful bdb download", async () => {
    let setupGateReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        setupGateReads += 1;
        return setupGateReads === 1 ? missingToolFixture : runnableFixture;
      }

      if (command === "load_desktop_settings") {
        return desktopSettingsFixture;
      }

      if (command === "load_device_status_snapshot") {
        return deviceStatusFixture;
      }

      if (command === "acquire_bdb_tool") {
        return {
          outcome: "downloaded",
          summary: "BE Home downloaded Board's bdb into the managed tools folder.",
          guidance: "The managed bdb binary is now runnable.",
          toolState: runnableFixture.toolState,
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Get your install workspace ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download bdb" }));

    expect(await screen.findByText("Review the local defaults BE Home will start with.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeInTheDocument();
  });

  it("lets players add a scan folder from settings", async () => {
    openMock.mockResolvedValue("C:\\Users\\Matt\\Games");
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_setup_gate_state") {
        return runnableFixture;
      }

      if (command === "load_desktop_settings") {
        return desktopSettingsFixture;
      }

      if (command === "load_device_status_snapshot") {
        return deviceStatusFixture;
      }

      if (command === "save_desktop_settings") {
        expect(args).toEqual({
          input: {
            apkLibraryOverride: null,
            scanFolderPaths: ["C:\\Users\\Matt\\Downloads", "C:\\Users\\Matt\\Games"],
          },
        });
        return {
          ...desktopSettingsFixture,
          scanFolders: [
            ...desktopSettingsFixture.scanFolders,
            {
              path: "C:\\Users\\Matt\\Games",
              source: "custom",
            },
          ],
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Your desktop install space is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(await screen.findByText("Keep folders and storage understandable.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add scan folder" }));

    expect(await screen.findByText("C:\\Users\\Matt\\Games")).toBeInTheDocument();
    expect(screen.getByText("BE Home added a new scan folder.")).toBeInTheDocument();
  });

  it("polls device status while the workspace stays visible", async () => {
    let deviceStatusReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        return runnableFixture;
      }

      if (command === "load_desktop_settings") {
        return desktopSettingsFixture;
      }

      if (command === "load_device_status_snapshot") {
        deviceStatusReads += 1;
        return {
          ...deviceStatusFixture,
          pollIntervalMs: 20,
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Board connection looks ready.")).toBeInTheDocument();
    expect(deviceStatusReads).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      expect(deviceStatusReads).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows friendly recovery guidance when Board is disconnected", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        return runnableFixture;
      }

      if (command === "load_desktop_settings") {
        return desktopSettingsFixture;
      }

      if (command === "load_device_status_snapshot") {
        return disconnectedDeviceStatusFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(
      await screen.findByText("Connect Board and refresh when you're ready."),
    ).toBeInTheDocument();
    expect(screen.getByText("Connect Board to this computer with USB.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh device check" })).toBeInTheDocument();
  });

  it("offers a direct settings path when bdb needs repair", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        return runnableFixture;
      }

      if (command === "load_desktop_settings") {
        return desktopSettingsFixture;
      }

      if (command === "load_device_status_snapshot") {
        return brokenToolDeviceStatusFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(
      await screen.findByText(
        "Board's install tool needs a quick repair before device checks can continue.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    expect(await screen.findByText("Keep folders and storage understandable.")).toBeInTheDocument();
  });

  it("guides unsupported hosts during the setup check", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        return unsupportedSetupFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(
      await screen.findByText("This computer is outside Board's current supported desktop list."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "If Board expands desktop support later, you can come back and refresh this check again from here.",
      ),
    ).toBeInTheDocument();
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
