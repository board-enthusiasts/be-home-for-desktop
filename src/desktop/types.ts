/**
 * Allowed accent families for a dashboard section card.
 */
export type ShellTone = "sunrise" | "forest" | "ocean" | "slate";

/**
 * Describes a small status badge shown inside a dashboard section.
 */
export interface ShellBadge {
  label: string;
  value: string;
}

/**
 * Describes one major workflow area in the desktop shell.
 */
export interface ShellSection {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  tone: ShellTone;
  badges: ShellBadge[];
  bullets: string[];
}

/**
 * Describes the dashboard content returned by the Tauri host during app bootstrap.
 */
export interface DesktopShellState {
  appName: string;
  version: string;
  platformLabel: string;
  introEyebrow: string;
  introSummary: string;
  highlights: ShellBadge[];
  gettingStartedTitle: string;
  gettingStartedSteps: string[];
  helpTitle: string;
  helpSummary: string;
  helpBullets: string[];
  sections: ShellSection[];
}
