import { invoke } from "@tauri-apps/api/core";
import type { BdbSourcePlan, DesktopShellState } from "./types";

/**
 * Loads the current desktop shell state from the Rust host.
 */
export function loadDesktopShellState(): Promise<DesktopShellState> {
  return invoke<DesktopShellState>("load_shell_state");
}

/**
 * Loads the maintained `bdb` source-resolution plan for the current machine.
 */
export function loadBdbSourcePlan(): Promise<BdbSourcePlan> {
  return invoke<BdbSourcePlan>("load_bdb_source_plan");
}
