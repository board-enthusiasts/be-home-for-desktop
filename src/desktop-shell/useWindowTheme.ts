import { getCurrentWindow, type Theme } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

export type DesktopTheme = "light" | "dark";

function fallbackTheme(): DesktopTheme {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }

  return "dark";
}

function normalizeTheme(theme: Theme | null): DesktopTheme {
  return theme === "light" ? "light" : "dark";
}

function applyTheme(theme: DesktopTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/**
 * Keeps the current window in sync with the operating-system light or dark theme.
 */
export function useWindowTheme(): DesktopTheme {
  const [theme, setTheme] = useState<DesktopTheme>(fallbackTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    let unlistenThemeChange: (() => void) | null = null;
    const currentWindow = getCurrentWindow();

    if (typeof currentWindow.theme === "function") {
      void currentWindow
        .theme()
        .then((windowTheme) => {
          if (mounted) {
            setTheme(normalizeTheme(windowTheme));
          }
        })
        .catch(() => {
          if (mounted) {
            setTheme(fallbackTheme());
          }
        });
    } else if (mounted) {
      setTheme(fallbackTheme());
    }

    if (typeof currentWindow.onThemeChanged === "function") {
      void currentWindow
        .onThemeChanged(({ payload }) => {
          setTheme(normalizeTheme(payload));
        })
        .then((unlisten) => {
          unlistenThemeChange = unlisten;
        })
        .catch(() => {
          if (mounted) {
            setTheme(fallbackTheme());
          }
        });
    } else if (mounted) {
      setTheme(fallbackTheme());
    }

    return () => {
      mounted = false;
      if (unlistenThemeChange !== null) {
        unlistenThemeChange();
      }
    };
  }, []);

  return theme;
}
