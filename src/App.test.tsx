import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  ApkDiscoverySnapshot,
  DesktopSettings,
  DeviceStatusSnapshot,
  InstalledTitlesSnapshot,
  ManagedApkLibrarySnapshot,
  SetupGateState,
} from "./desktop/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const currentWindowState = vi.hoisted(() => ({
  label: undefined as string | undefined,
  theme: "dark" as "light" | "dark" | null,
}));

const onFocusChangedMock = vi.hoisted(() => vi.fn().mockResolvedValue(() => {}));
const onThemeChangedMock = vi.hoisted(() => vi.fn().mockResolvedValue(() => {}));
const onCloseRequestedMock = vi.hoisted(() => vi.fn().mockResolvedValue(() => {}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    get label() {
      return currentWindowState.label;
    },
    theme: vi.fn().mockResolvedValue(currentWindowState.theme),
    onThemeChanged: onThemeChangedMock,
    onFocusChanged: onFocusChangedMock,
    onCloseRequested: onCloseRequestedMock,
  })),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const invokeHandlers = vi.hoisted(
  () =>
    ({
      current: {} as Record<string, (args?: unknown) => unknown>,
    }) satisfies { current: Record<string, (args?: unknown) => unknown> },
);

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const openMock = vi.mocked(open);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);

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
    summary: "Board's install tool is missing.",
    guidance: "Download bdb so BE Home can keep Board actions inside the desktop flow.",
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
  bdbTools: runnableFixture.storage.bdbTools,
  apkLibrary: runnableFixture.storage.apkLibrary,
  bdbExecutablePath: runnableFixture.toolState.executablePath,
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
  guidance: "You can keep using the desktop workspace while BE Home refreshes the connection in the background.",
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

const installedTitlesFixture: InstalledTitlesSnapshot = {
  status: "ready",
  summary: "Board reported 1 installed title(s).",
  guidance: "The current device inventory is ready to review.",
  titles: [
    {
      stableId: "package:co.board.luckydice",
      displayName: "Lucky Dice",
      packageName: "co.board.luckydice",
      subtitle: "co.board.luckydice",
      canLaunch: true,
      canUninstall: true,
    },
  ],
};

const apkDiscoveryFixture: ApkDiscoverySnapshot = {
  status: "ready",
  summary: "BE Home found 1 strong Board APK match.",
  guidance: "Use rescan after you add new downloads to a watched folder.",
  candidates: [
    {
      stableId: "apk:c:\\users\\matt\\downloads\\luckydice.apk",
      fileName: "LuckyDice.apk",
      sourcePath: "C:\\Users\\Matt\\Downloads\\LuckyDice.apk",
      discoverySource: "scanFolder",
      discoveredFromPath: "C:\\Users\\Matt\\Downloads",
      fileSizeBytes: 2048000,
      packageName: "fun.board.luckydice",
      confidence: "strongMatch",
      confidenceSummary: "BE Home found a strong Board SDK marker in this APK.",
    },
  ],
};

const managedLibraryFixture: ManagedApkLibrarySnapshot = {
  status: "ready",
  summary: "BE Home is keeping 1 APK file in the managed library.",
  guidance: "Keep reusable copies here for later installs.",
  items: [
    {
      stableId: "library:luckydice",
      fileName: "LuckyDice.apk",
      originalSourcePath: "C:\\Users\\Matt\\Downloads\\LuckyDice.apk",
      managedPath:
        "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\apk-library\\LuckyDice.apk",
      packageName: "fun.board.luckydice",
      confidence: "strongMatch",
      confidenceSummary: "BE Home found a strong Board SDK marker in this APK.",
      fileSizeBytes: 2048000,
      importedAtUnixMs: 1_717_000_000_000,
      sourceModifiedAtUnixMs: 1_717_000_000_000,
      managedModifiedAtUnixMs: 1_717_000_000_000,
    },
  ],
};

function installDefaultInvokeHandlers(setupState: SetupGateState = runnableFixture): void {
  invokeHandlers.current = {
    load_setup_gate_state: () => setupState,
    load_desktop_settings: () => desktopSettingsFixture,
    load_device_status_snapshot: () => deviceStatusFixture,
    load_installed_titles_snapshot: () => installedTitlesFixture,
    load_apk_discovery_snapshot: () => apkDiscoveryFixture,
    load_managed_apk_library_snapshot: () => managedLibraryFixture,
    open_setup_wizard_window: () => undefined,
    open_settings_window: () => undefined,
    open_about_window: () => undefined,
    dismiss_setup_wizard_window: () => undefined,
    show_main_workspace_window: () => undefined,
    emit_settings_updated: () => undefined,
    exit_application: () => undefined,
    acquire_bdb_tool: () => ({
      outcome: "downloaded",
      summary: "Downloaded bdb.",
      guidance: "Ready to go.",
      toolState: runnableFixture.toolState,
    }),
    save_desktop_settings: () => desktopSettingsFixture,
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentWindowState.label = undefined;
    currentWindowState.theme = "dark";
    document.documentElement.dataset.theme = "";
    document.documentElement.style.colorScheme = "";

    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      const handler = invokeHandlers.current[command];
      if (handler === undefined) {
        throw new Error(`Unhandled invoke command: ${command}`);
      }

      return handler(args);
    });

    listenMock.mockResolvedValue(() => {});
    openMock.mockResolvedValue(null);
    onFocusChangedMock.mockResolvedValue(() => {});
    onThemeChangedMock.mockResolvedValue(() => {});
    onCloseRequestedMock.mockResolvedValue(() => {});

    installDefaultInvokeHandlers();
  });

  it("defaults to the main workspace window when the label is missing", async () => {
    render(<App />);

    expect(await screen.findByText("Your desktop install space is ready.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Device Board connection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "APK Library Local APKs" }),
    ).toBeInTheDocument();
  });

  it("routes the setup wizard window", async () => {
    currentWindowState.label = "setup-wizard";
    installDefaultInvokeHandlers(missingToolFixture);

    render(<App />);

    expect(await screen.findByText("Get your install workspace ready")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancel" }).length).toBeGreaterThan(0);
  });

  it("routes the settings window", async () => {
    currentWindowState.label = "settings";

    render(<App />);

    expect(await screen.findByText("Keep folders and storage understandable")).toBeInTheDocument();
    expect(screen.getByText("Board tool")).toBeInTheDocument();
  });

  it("routes the about window", async () => {
    currentWindowState.label = "about";

    render(<App />);

    expect(await screen.findByText("BE Home for Desktop")).toBeInTheDocument();
    expect(
      screen.getByText(/Board Developer Bridge \(bdb\)/),
    ).toBeInTheDocument();
  });

  it("shows the main-window setup blocker and opens the setup wizard", async () => {
    installDefaultInvokeHandlers(missingToolFixture);

    render(<App />);

    expect(
      await screen.findByText("Finish setup in the wizard before opening the workspace."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open setup wizard" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("open_setup_wizard_window");
    });
  });

  it("loads the ready workspace data on the main window", async () => {
    render(<App />);

    expect(
      await screen.findByText("Keep the latest device check easy to trust."),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("load_device_status_snapshot");
      expect(invokeMock).toHaveBeenCalledWith("load_desktop_settings");
      expect(invokeMock).toHaveBeenCalledWith("load_apk_discovery_snapshot");
      expect(invokeMock).toHaveBeenCalledWith("load_managed_apk_library_snapshot");
      expect(invokeMock).toHaveBeenCalledWith("load_installed_titles_snapshot");
    });
  });

  it("falls back to the unsupported-window panel for unknown labels", async () => {
    currentWindowState.label = "mystery-window";

    render(<App />);

    expect(await screen.findByText("This desktop window is not recognized.")).toBeInTheDocument();
  });

  it("applies the current window theme to the document", async () => {
    currentWindowState.theme = "light";

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.documentElement.style.colorScheme).toBe("light");
    });
  });

  it("keeps Tauri window listeners wired for the routed shell", async () => {
    render(<App />);

    await screen.findByText("Your desktop install space is ready.");

    expect(getCurrentWindowMock).toHaveBeenCalled();
    expect(onFocusChangedMock).toHaveBeenCalled();
    expect(onThemeChangedMock).toHaveBeenCalled();
    expect(listenMock).toHaveBeenCalledTimes(3);
  });
});
