export const MAIN_WINDOW_LABEL = "main";
export const SETUP_WIZARD_WINDOW_LABEL = "setup-wizard";
export const SETTINGS_WINDOW_LABEL = "settings";
export const ABOUT_WINDOW_LABEL = "about";

export const MAIN_WORKSPACE_NAVIGATE_EVENT = "desktop-shell://navigate";
export const MAIN_WORKSPACE_RESCAN_EVENT = "desktop-shell://rescan-games-and-apps";
export const SETTINGS_UPDATED_EVENT = "desktop-shell://settings-updated";

export type MainWorkspaceTarget = "gamesAndApps" | "installedOnBoard";

export interface MainWorkspaceNavigationEvent {
  target: MainWorkspaceTarget;
}
