import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import {
  exitApplication,
  openAboutWindow,
  openSettingsWindow,
  openSetupWizardWindow,
} from "../desktop/client";
import type { MainWorkspaceTarget } from "./constants";

type OpenMenuId = "system" | "file" | "view" | "help" | null;

interface MainWindowTitleBarProps {
  activeSection: MainWorkspaceTarget;
  onNavigate: (target: MainWorkspaceTarget) => void;
  onRescanGamesAndApps: () => void;
}

interface TitleBarMenuItem {
  id: string;
  label: string;
  action: () => Promise<void> | void;
  selected?: boolean;
  separatorBefore?: boolean;
}

function TitleBarMenu({
  items,
  onDismiss,
}: {
  items: TitleBarMenuItem[];
  onDismiss: () => void;
}) {
  return (
    <div className="desktop-titlebar-menu" role="menu">
      {items.map((item) => (
        <div className="desktop-titlebar-menu-row" key={item.id}>
          {item.separatorBefore ? <div className="desktop-titlebar-menu-separator" /> : null}
          <button
            className={
              item.selected
                ? "desktop-titlebar-menu-item desktop-titlebar-menu-item--selected"
                : "desktop-titlebar-menu-item"
            }
            onClick={() => {
              onDismiss();
              void item.action();
            }}
            role="menuitem"
            type="button"
          >
            <span>{item.label}</span>
            {item.selected ? <span aria-hidden="true">•</span> : null}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function MainWindowTitleBar({
  activeSection,
  onNavigate,
  onRescanGamesAndApps,
}: MainWindowTitleBarProps) {
  const titleBarRef = useRef<HTMLElement | null>(null);
  const currentWindow = getCurrentWindow();
  const [openMenuId, setOpenMenuId] = useState<OpenMenuId>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    let removeResizeListener: (() => void) | null = null;

    const syncMaximizedState = async () => {
      try {
        const nextValue = await currentWindow.isMaximized();
        if (mounted) {
          setIsMaximized(nextValue);
        }
      } catch {
        if (mounted) {
          setIsMaximized(false);
        }
      }
    };

    void syncMaximizedState();
    void currentWindow
      .onResized(() => {
        void syncMaximizedState();
      })
      .then((unlisten) => {
        removeResizeListener = unlisten;
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
      if (removeResizeListener !== null) {
        removeResizeListener();
      }
    };
  }, [currentWindow]);

  useEffect(() => {
    if (openMenuId === null) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!titleBarRef.current?.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openMenuId]);

  const fileMenuItems: TitleBarMenuItem[] = [
    {
      id: "setup-wizard",
      label: "Setup Wizard...",
      action: () => openSetupWizardWindow(),
    },
    {
      id: "settings",
      label: "Settings...",
      action: () => openSettingsWindow(),
    },
    {
      id: "exit",
      label: "Exit",
      action: () => exitApplication(),
      separatorBefore: true,
    },
  ];

  const viewMenuItems: TitleBarMenuItem[] = [
    {
      id: "games-and-apps",
      label: "Games & Apps",
      action: () => onNavigate("gamesAndApps"),
      selected: activeSection === "gamesAndApps",
    },
    {
      id: "installed-on-board",
      label: "Installed on Board",
      action: () => onNavigate("installedOnBoard"),
      selected: activeSection === "installedOnBoard",
    },
    {
      id: "rescan",
      label: "Rescan Games & Apps",
      action: () => onRescanGamesAndApps(),
      separatorBefore: true,
    },
  ];

  const helpMenuItems: TitleBarMenuItem[] = [
    {
      id: "about",
      label: "About BE Home for Desktop",
      action: () => openAboutWindow(),
    },
  ];

  const systemMenuItems: TitleBarMenuItem[] = [
    {
      id: "minimize",
      label: "Minimize",
      action: () => currentWindow.minimize(),
    },
    {
      id: "toggle-maximize",
      label: isMaximized ? "Restore" : "Maximize",
      action: () => currentWindow.toggleMaximize(),
    },
    {
      id: "close",
      label: "Close",
      action: () => exitApplication(),
      separatorBefore: true,
    },
  ];

  const titleBarMenus: Array<{
    id: Exclude<OpenMenuId, "system" | null>;
    label: string;
    items: TitleBarMenuItem[];
  }> = [
    { id: "file", label: "File", items: fileMenuItems },
    { id: "view", label: "View", items: viewMenuItems },
    { id: "help", label: "Help", items: helpMenuItems },
  ];

  return (
    <header className="desktop-titlebar" ref={titleBarRef}>
      <div
        className="desktop-titlebar-drag-region"
        data-tauri-drag-region
        onDoubleClick={() => void currentWindow.toggleMaximize()}
      />

      <div className="desktop-titlebar-left">
        <div className="desktop-titlebar-menu-wrap">
          <button
            aria-expanded={openMenuId === "system"}
            aria-haspopup="menu"
            aria-label="Window menu"
            className="desktop-titlebar-icon-button"
            onClick={() => setOpenMenuId((previous) => (previous === "system" ? null : "system"))}
            type="button"
          >
            <img alt="" className="desktop-titlebar-app-icon" src="/favicon.png" />
          </button>
          {openMenuId === "system" ? (
            <TitleBarMenu
              items={systemMenuItems}
              onDismiss={() => {
                setOpenMenuId(null);
              }}
            />
          ) : null}
        </div>

        <nav aria-label="Window menu" className="desktop-titlebar-menu-strip">
          {titleBarMenus.map((menu) => (
            <div className="desktop-titlebar-menu-wrap" key={menu.id}>
              <button
                aria-expanded={openMenuId === menu.id}
                aria-haspopup="menu"
                className="desktop-titlebar-menu-trigger"
                onClick={() =>
                  setOpenMenuId((previous) => (previous === menu.id ? null : menu.id))
                }
                type="button"
              >
                {menu.label}
              </button>
              {openMenuId === menu.id ? (
                <TitleBarMenu
                  items={menu.items}
                  onDismiss={() => {
                    setOpenMenuId(null);
                  }}
                />
              ) : null}
            </div>
          ))}
        </nav>
      </div>

      <div aria-hidden="true" className="desktop-titlebar-title">
        BE Home for Desktop
      </div>

      <div className="desktop-titlebar-right">
        <button
          aria-label="Minimize"
          className="desktop-window-control"
          onClick={() => void currentWindow.minimize()}
          type="button"
        >
          <span aria-hidden="true" className="material-symbols-outlined">
            remove
          </span>
        </button>
        <button
          aria-label={isMaximized ? "Restore" : "Maximize"}
          className="desktop-window-control"
          onClick={() => void currentWindow.toggleMaximize()}
          type="button"
        >
          <span aria-hidden="true" className="material-symbols-outlined">
            {isMaximized ? "filter_none" : "crop_square"}
          </span>
        </button>
        <button
          aria-label="Close"
          className="desktop-window-control desktop-window-control--danger"
          onClick={() => void exitApplication()}
          type="button"
        >
          <span aria-hidden="true" className="material-symbols-outlined">
            close
          </span>
        </button>
      </div>
    </header>
  );
}
