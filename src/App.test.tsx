import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  ApkCandidate,
  ApkDiscoverySnapshot,
  DesktopSettings,
  DeviceStatusSnapshot,
  InstallApkResult,
  InstalledTitlesSnapshot,
  ManagedApkLibraryImportResult,
  ManagedApkLibrarySnapshot,
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

const installedTitlesFixture: InstalledTitlesSnapshot = {
  status: "ready",
  summary: "Board reported 2 installed title(s).",
  guidance:
    "This list is ready for the later uninstall and launch actions that stay tied to package identity.",
  titles: [
    {
      stableId: "package:co.board.luckydice",
      displayName: "Lucky Dice",
      packageName: "co.board.luckydice",
      subtitle: "co.board.luckydice",
      canLaunch: true,
      canUninstall: true,
    },
    {
      stableId: "package:fun.board.familymatch",
      displayName: "Family Match",
      packageName: "fun.board.familymatch",
      subtitle: "fun.board.familymatch",
      canLaunch: true,
      canUninstall: true,
    },
  ],
};

const apkDiscoveryFixture: ApkDiscoverySnapshot = {
  status: "ready",
  summary: "BE Home found 2 strong Board APK match(es) across the current scan folders.",
  guidance:
    "Use rescan after you add new downloads to a watched folder, or choose a file manually when you already know where it lives.",
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
    {
      stableId: "apk:c:\\users\\matt\\games\\familymatch.apk",
      fileName: "FamilyMatch.apk",
      sourcePath: "C:\\Users\\Matt\\Games\\FamilyMatch.apk",
      discoverySource: "scanFolder",
      discoveredFromPath: "C:\\Users\\Matt\\Games",
      fileSizeBytes: 1024000,
      packageName: "fun.board.familymatch",
      confidence: "strongMatch",
      confidenceSummary: "BE Home found a strong Board SDK marker in this APK.",
    },
  ],
};

const manualApkCandidateFixture: ApkCandidate = {
  stableId: "apk:c:\\users\\matt\\downloads\\manualchoice.apk",
  fileName: "ManualChoice.apk",
  sourcePath: "C:\\Users\\Matt\\Downloads\\ManualChoice.apk",
  discoverySource: "manualSelection",
  discoveredFromPath: null,
  fileSizeBytes: 3072000,
  packageName: "fun.board.manualchoice",
  confidence: "possibleMatch",
  confidenceSummary:
    "BE Home found some Android packaging signals, but not the strongest Board marker yet.",
};

const emptyManagedLibraryFixture: ManagedApkLibrarySnapshot = {
  status: "empty",
  summary: "The managed APK library is still empty.",
  guidance:
    "Keep a copy from a scanned APK or a manual pick when you want later reinstalls to stay close by.",
  items: [],
};

const managedLibraryFixture: ManagedApkLibrarySnapshot = {
  status: "ready",
  summary: "BE Home is keeping 1 APK file(s) in the managed library.",
  guidance:
    "These managed copies stay available for later installs even if the original downloads move somewhere else.",
  items: [
    {
      stableId: "library:c:\\users\\matt\\downloads\\luckydice.apk",
      fileName: "LuckyDice.apk",
      originalSourcePath: "C:\\Users\\Matt\\Downloads\\LuckyDice.apk",
      managedPath:
        "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\apk-library\\LuckyDice.apk",
      packageName: "fun.board.luckydice",
      confidence: "strongMatch",
      confidenceSummary: "BE Home found a strong Board SDK marker in this APK.",
      fileSizeBytes: 2048000,
      importedAtUnixMs: 1_713_957_600_000,
      sourceModifiedAtUnixMs: 1_713_957_000_000,
      managedModifiedAtUnixMs: 1_713_957_600_000,
    },
  ],
};

const managedLibraryImportResultFixture: ManagedApkLibraryImportResult = {
  summary: "BE Home copied LuckyDice.apk into the managed APK library.",
  guidance:
    "Your original APK stayed where it was, and this managed copy is ready for later reinstall steps.",
  item: managedLibraryFixture.items[0],
  snapshot: managedLibraryFixture,
};

const installSuccessResultFixture: InstallApkResult = {
  status: "installed",
  summary: "BE Home installed LuckyDice.apk on Board.",
  guidance:
    "The device and installed-title views will refresh now so you can confirm the new install.",
  detail: "Installed fun.board.luckydice",
  command:
    "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\tools\\bdb.exe install C:\\Users\\Matt\\Downloads\\LuckyDice.apk",
  exitCode: 0,
};

const uninstallSuccessResultFixture = {
  status: "removed",
  summary: "BE Home removed Lucky Dice from Board.",
  guidance:
    "The device and installed-title views will refresh now so the inventory can catch up.",
  detail: "Removed fun.board.luckydice",
  command:
    "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\tools\\bdb.exe remove fun.board.luckydice",
  exitCode: 0,
} as const;

const launchSuccessResultFixture = {
  status: "launched",
  summary: "BE Home launched Lucky Dice on Board.",
  guidance:
    "The device check will refresh now while the installed-title list stays in place.",
  detail: "Launched fun.board.luckydice",
  command:
    "C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\tools\\bdb.exe launch fun.board.luckydice",
  exitCode: 0,
} as const;

const installedTitlesAfterUninstallFixture: InstalledTitlesSnapshot = {
  status: "ready",
  summary: "Board reported 1 installed title(s).",
  guidance:
    "This list is ready for the later uninstall and launch actions that stay tied to package identity.",
  titles: [
    {
      stableId: "package:fun.board.familymatch",
      displayName: "Family Match",
      packageName: "fun.board.familymatch",
      subtitle: "fun.board.familymatch",
      canLaunch: true,
      canUninstall: true,
    },
  ],
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

      if (command === "load_installed_titles_snapshot") {
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
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

      if (command === "load_installed_titles_snapshot") {
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
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

      if (command === "load_installed_titles_snapshot") {
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
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

      if (command === "load_installed_titles_snapshot") {
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
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

      if (command === "load_installed_titles_snapshot") {
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
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

      if (command === "load_installed_titles_snapshot") {
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
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

  it("shows installed titles from the normalized inventory model", async () => {
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

      if (command === "load_installed_titles_snapshot") {
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Your desktop install space is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Installed on Board/ }));

    expect(await screen.findByText("Lucky Dice")).toBeInTheDocument();
    expect(screen.getByText("Family Match")).toBeInTheDocument();
    expect(screen.getAllByText("Launch ready")).toHaveLength(2);
  });

  it("shows scanned APK candidates and lets players choose a manual APK", async () => {
    openMock.mockResolvedValue("C:\\Users\\Matt\\Downloads\\ManualChoice.apk");
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

      if (command === "load_installed_titles_snapshot") {
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
      }

      if (command === "inspect_manual_apk_path") {
        return manualApkCandidateFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Your desktop install space is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /APK Library/ }));

    expect(await screen.findByText("LuckyDice.apk")).toBeInTheDocument();
    expect(screen.getByText("FamilyMatch.apk")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose APK" }));

    expect(await screen.findByText("Latest manual APK pick")).toBeInTheDocument();
    expect(screen.getAllByText("ManualChoice.apk").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Possible Board match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install anyway" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "BE Home found some Android packaging signals, but not the strongest Board marker yet.",
      ),
    ).toBeInTheDocument();
  });

  it("copies a discovered APK into the managed library inventory", async () => {
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

      if (command === "load_installed_titles_snapshot") {
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
      }

      if (command === "import_apk_to_managed_library") {
        return managedLibraryImportResultFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Your desktop install space is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /APK Library/ }));

    fireEvent.click(screen.getAllByRole("button", { name: "Keep a copy" })[0]);

    expect(
      await screen.findByText("BE Home copied LuckyDice.apk into the managed APK library."),
    ).toBeInTheDocument();
    expect(screen.getByText("fun.board.luckydice")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Managed copy: C:\\Users\\Matt\\AppData\\Local\\Board Enthusiasts\\BE Home for Desktop\\apk-library\\LuckyDice\.apk/,
      ),
    ).toBeInTheDocument();
  });

  it("refreshes device and installed titles after a successful library install", async () => {
    let deviceStatusReads = 0;
    let installedTitlesReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        return runnableFixture;
      }

      if (command === "load_desktop_settings") {
        return desktopSettingsFixture;
      }

      if (command === "load_device_status_snapshot") {
        deviceStatusReads += 1;
        return deviceStatusFixture;
      }

      if (command === "load_installed_titles_snapshot") {
        installedTitlesReads += 1;
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return managedLibraryFixture;
      }

      if (command === "install_apk_to_connected_board") {
        return installSuccessResultFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Your desktop install space is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /APK Library/ }));

    const installButtons = await screen.findAllByRole("button", { name: "Install on Board" });
    fireEvent.click(installButtons[installButtons.length - 1]);

    expect(await screen.findByText("BE Home installed LuckyDice.apk on Board.")).toBeInTheDocument();
    await waitFor(() => {
      expect(deviceStatusReads).toBeGreaterThanOrEqual(2);
      expect(installedTitlesReads).toBeGreaterThanOrEqual(2);
    });
  });

  it("confirms and refreshes the installed inventory after removing a title", async () => {
    let deviceStatusReads = 0;
    let installedTitlesReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        return runnableFixture;
      }

      if (command === "load_desktop_settings") {
        return desktopSettingsFixture;
      }

      if (command === "load_device_status_snapshot") {
        deviceStatusReads += 1;
        return deviceStatusFixture;
      }

      if (command === "load_installed_titles_snapshot") {
        installedTitlesReads += 1;
        return installedTitlesReads === 1
          ? installedTitlesFixture
          : installedTitlesAfterUninstallFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
      }

      if (command === "uninstall_installed_title_from_board") {
        return uninstallSuccessResultFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Your desktop install space is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Installed on Board/ }));

    fireEvent.click((await screen.findAllByRole("button", { name: "Remove from Board" }))[0]);
    expect(screen.getByRole("button", { name: "Confirm remove" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));

    expect(await screen.findByText("BE Home removed Lucky Dice from Board.")).toBeInTheDocument();
    await waitFor(() => {
      expect(deviceStatusReads).toBeGreaterThanOrEqual(2);
      expect(installedTitlesReads).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(screen.queryByText("Lucky Dice")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Family Match")).toBeInTheDocument();
  });

  it("refreshes only the device state after launching a title", async () => {
    let deviceStatusReads = 0;
    let installedTitlesReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_setup_gate_state") {
        return runnableFixture;
      }

      if (command === "load_desktop_settings") {
        return desktopSettingsFixture;
      }

      if (command === "load_device_status_snapshot") {
        deviceStatusReads += 1;
        return deviceStatusFixture;
      }

      if (command === "load_installed_titles_snapshot") {
        installedTitlesReads += 1;
        return installedTitlesFixture;
      }

      if (command === "load_apk_discovery_snapshot") {
        return apkDiscoveryFixture;
      }

      if (command === "load_managed_apk_library_snapshot") {
        return emptyManagedLibraryFixture;
      }

      if (command === "launch_installed_title_on_board") {
        return launchSuccessResultFixture;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    expect(await screen.findByText("Your desktop install space is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Installed on Board/ }));

    fireEvent.click((await screen.findAllByRole("button", { name: "Open on Board" }))[0]);

    expect(await screen.findByText("BE Home launched Lucky Dice on Board.")).toBeInTheDocument();
    await waitFor(() => {
      expect(deviceStatusReads).toBeGreaterThanOrEqual(2);
    });
    expect(installedTitlesReads).toBe(1);
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
