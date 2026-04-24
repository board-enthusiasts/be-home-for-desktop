import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  ApkDiscoverySnapshot,
  BdbToolState,
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
const closeWindowMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    get label() {
      return currentWindowState.label;
    },
    theme: vi.fn(() => Promise.resolve(currentWindowState.theme)),
    onThemeChanged: onThemeChangedMock,
    onFocusChanged: onFocusChangedMock,
    onCloseRequested: onCloseRequestedMock,
    close: closeWindowMock,
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

const runnableToolFixture: BdbToolState = {
  status: "runnable",
  summary: "Board's install tool is ready to use.",
  guidance: "BE Home confirmed that the Board Install Tool can open from its saved location.",
  executablePath:
    "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\tools\\bdb.exe",
  executableExists: true,
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
    manifestSchemaVersion: 2,
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
      version: "Board OS Version: 1.8.1",
    },
  },
  versionCheck: {
    status: "available",
    command: "bdb version",
    value: "Board OS Version: 1.8.1",
    exitCode: 0,
    summary: "Installed version: Board OS Version: 1.8.1",
    detail: null,
  },
  updateStatus: {
    status: "upToDate",
    currentVersion: "Board OS Version: 1.8.1",
    availableVersion: "Board OS Version: 1.8.1",
    guidance: "This Board Install Tool matches the latest version in BE Home's source list.",
  },
  supportRequestDraft: null,
  validation: {
    status: "runnable",
    command: "bdb help",
    exitCode: 0,
    summary: "BE Home could open bdb from its managed tools folder.",
    detail: null,
  },
};

const missingToolFixture: BdbToolState = {
  ...runnableToolFixture,
  status: "missing",
  summary: "BE Home has not downloaded bdb into the managed tools folder yet.",
  guidance: "Continue setup and BE Home will download Board's bdb into its managed tools folder for you.",
  executableExists: false,
  versionCheck: {
    status: "unavailable",
    command: "bdb version",
    value: null,
    exitCode: null,
    summary: "BE Home has not downloaded the Board Install Tool yet.",
    detail: null,
  },
  updateStatus: {
    status: "unknown",
    currentVersion: null,
    availableVersion: "Board OS Version: 1.8.1",
    guidance:
      "Download the Board Install Tool first, then use Check for Update whenever you want to compare it with Board's latest download.",
  },
  validation: {
    status: "missing",
    command: "bdb help",
    exitCode: null,
    summary: "No managed bdb executable is present yet.",
    detail: null,
  },
};

const readySetupFixture: SetupGateState = {
  appName: "BE Home for Desktop",
  version: "0.1.0",
  platformLabel: "Windows",
  status: "ready",
  requiredStep: "workspace",
  summary: "Board's install tool is ready, so BE Home can open your desktop workspace.",
  guidance: "You can come back to repair the install tool later if anything changes.",
  toolState: runnableToolFixture,
  storage: {
    operatingSystem: "windows",
    settingsFilePath:
      "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\settings\\managed-storage.json",
    bdbTools: runnableToolFixture.storage,
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

const needsSetupFixture: SetupGateState = {
  ...readySetupFixture,
  status: "requiresSetup",
  requiredStep: "toolSetup",
  summary: "BE Home still needs to download Board's install tool before the workspace can open.",
  guidance: "Continue setup and BE Home will download Board's bdb into its managed tools folder for you.",
  toolState: missingToolFixture,
};

const desktopSettingsFixture: DesktopSettings = {
  operatingSystem: "windows",
  settingsFilePath:
    "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\settings\\managed-storage.json",
  bdbTools: readySetupFixture.storage.bdbTools,
  apkLibrary: readySetupFixture.storage.apkLibrary,
  bdbExecutablePath: runnableToolFixture.executablePath,
  boardConnection: {
    pollIntervalSeconds: 5,
  },
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
  boardOsVersion: "1.8.1",
  pollIntervalMs: 5000,
  bdbVersion: {
    status: "available",
    command: "bdb version",
    value: "Board OS Version: 1.8.1",
    exitCode: 0,
    summary: "BE Home is using `Board OS Version: 1.8.1`.",
    detail: null,
  },
};

const installedTitlesFixture: InstalledTitlesSnapshot = {
  status: "ready",
  summary: "Board reported 1 installed title.",
  guidance: "The current title list is ready to review.",
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
  summary: "BE Home found 1 strong Board match.",
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

function installDefaultInvokeHandlers(options?: {
  setupState?: SetupGateState;
  toolState?: BdbToolState;
  desktopSettings?: DesktopSettings;
}): void {
  const setupState = options?.setupState ?? readySetupFixture;
  const toolState = options?.toolState ?? runnableToolFixture;
  const desktopSettings = options?.desktopSettings ?? desktopSettingsFixture;

  invokeHandlers.current = {
    load_setup_gate_state: () => setupState,
    load_bdb_tool_state: () => toolState,
    refresh_bdb_tool_state: () => toolState,
    load_desktop_settings: () => desktopSettings,
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
      summary: "Downloaded the Board Install Tool.",
      guidance: "The Board Install Tool is ready.",
      toolState: runnableToolFixture,
    }),
    save_desktop_settings: () => desktopSettings,
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
    closeWindowMock.mockResolvedValue(undefined);

    installDefaultInvokeHandlers();
  });

  it("defaults to the main workspace window when the label is missing", async () => {
    render(<App />);

    expect(await screen.findByText("Keep your Board installs close by.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Games & Apps/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Installed on Board/i })).toBeInTheDocument();
    expect(screen.getByLabelText("What this Board status means")).toBeInTheDocument();
  });

  it("routes the setup wizard window", async () => {
    currentWindowState.label = "setup-wizard";
    installDefaultInvokeHandlers({
      setupState: needsSetupFixture,
      toolState: missingToolFixture,
    });

    render(<App />);

    expect(await screen.findByText("Set up BE Home for Desktop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("routes the settings window", async () => {
    currentWindowState.label = "settings";

    render(<App />);

    expect(await screen.findByText("BE Home for Desktop settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Board Install Tool" })).toBeInTheDocument();
  });

  it("routes the about window", async () => {
    currentWindowState.label = "about";

    render(<App />);

    expect(await screen.findByText("BE Home for Desktop")).toBeInTheDocument();
    expect(screen.getByText(/Board Developer Bridge \(bdb\)/)).toBeInTheDocument();
  });

  it("shows the main-window setup blocker and opens the setup wizard", async () => {
    installDefaultInvokeHandlers({
      setupState: needsSetupFixture,
      toolState: missingToolFixture,
    });

    render(<App />);

    expect(await screen.findByText("Finish setup in the Setup Wizard first.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Setup Wizard" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("open_setup_wizard_window");
    });
  });

  it("lazy-loads installed titles only after that section is opened", async () => {
    render(<App />);

    expect(await screen.findByText("Choose a game or app from this computer.")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("load_installed_titles_snapshot");

    fireEvent.click(screen.getByRole("button", { name: /Installed on Board/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("load_installed_titles_snapshot");
    });
  });

  it("keeps manual choice available even when no scan folders are selected", async () => {
    installDefaultInvokeHandlers({
      desktopSettings: {
        ...desktopSettingsFixture,
        scanFolders: [],
      },
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Choose Game or App" })).toBeInTheDocument();
    expect(screen.getByText("Manual choice only")).toBeInTheDocument();
  });

  it("cancelling setup uses the shared dismiss command", async () => {
    currentWindowState.label = "setup-wizard";
    installDefaultInvokeHandlers({
      setupState: needsSetupFixture,
      toolState: missingToolFixture,
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("dismiss_setup_wizard_window");
    });
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

    await screen.findByText("Keep your Board installs close by.");

    expect(getCurrentWindowMock).toHaveBeenCalled();
    expect(onFocusChangedMock).toHaveBeenCalled();
    expect(onThemeChangedMock).toHaveBeenCalled();
    expect(listenMock).toHaveBeenCalledTimes(3);
  });
});
