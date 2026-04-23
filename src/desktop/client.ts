import { invoke } from "@tauri-apps/api/core";
import type { DesktopShellState } from "./types";

/**
 * Loads the current desktop shell state from the Rust host.
 */
export function loadDesktopShellState(): Promise<DesktopShellState> {
  return invoke<DesktopShellState>("load_shell_state");
}
