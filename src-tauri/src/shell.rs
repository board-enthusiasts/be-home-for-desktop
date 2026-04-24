use crate::setup::{self, SetupGateStatus};
use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const SETUP_WIZARD_WINDOW_LABEL: &str = "setup-wizard";
pub(crate) const SETTINGS_WINDOW_LABEL: &str = "settings";
pub(crate) const ABOUT_WINDOW_LABEL: &str = "about";

pub(crate) const MAIN_WORKSPACE_NAVIGATE_EVENT: &str = "desktop-shell://navigate";
pub(crate) const MAIN_WORKSPACE_RESCAN_EVENT: &str = "desktop-shell://rescan-games-and-apps";
pub(crate) const SETTINGS_UPDATED_EVENT: &str = "desktop-shell://settings-updated";

const MENU_FILE_SETUP_WIZARD: &str = "shell.file.setupWizard";
const MENU_FILE_SETTINGS: &str = "shell.file.settings";
const MENU_FILE_EXIT: &str = "shell.file.exit";
const MENU_VIEW_GAMES_AND_APPS: &str = "shell.view.gamesAndApps";
const MENU_VIEW_INSTALLED_ON_BOARD: &str = "shell.view.installedOnBoard";
const MENU_VIEW_RESCAN_GAMES_AND_APPS: &str = "shell.view.rescanGamesAndApps";
const MENU_HELP_ABOUT: &str = "shell.help.about";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MainWorkspaceTarget {
    GamesAndApps,
    InstalledOnBoard,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MainWorkspaceNavigationEvent {
    pub(crate) target: MainWorkspaceTarget,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartupMode {
    ShowMainWorkspace,
    OpenSetupWizard,
}

pub(crate) fn initialize_native_shell<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let menu = build_app_menu(app)?;
    app.set_menu(menu)
        .map_err(|error| format!("failed to register the app menu: {error}"))?;
    sync_shell_to_setup_state(app)
}

pub(crate) fn sync_shell_to_setup_state<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let setup_state = setup::load_setup_gate_state()?;
    match startup_mode_for_status(setup_state.status) {
        StartupMode::ShowMainWorkspace => {
            show_main_workspace_window(app)?;
            close_window_if_open(app, SETUP_WIZARD_WINDOW_LABEL)?;
        }
        StartupMode::OpenSetupWizard => {
            hide_main_workspace_window(app)?;
            open_setup_wizard_window(app)?;
        }
    }

    Ok(())
}

pub(crate) fn open_setup_wizard_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    show_or_focus_window(
        app,
        SETUP_WIZARD_WINDOW_LABEL,
        "Setup Wizard",
        920.0,
        760.0,
        700.0,
        620.0,
        true,
    )
}

pub(crate) fn open_settings_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    show_or_focus_window(
        app,
        SETTINGS_WINDOW_LABEL,
        "Settings",
        980.0,
        820.0,
        760.0,
        620.0,
        true,
    )
}

pub(crate) fn open_about_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    show_or_focus_window(
        app,
        ABOUT_WINDOW_LABEL,
        "About BE Home for Desktop",
        560.0,
        440.0,
        420.0,
        320.0,
        false,
    )
}

pub(crate) fn show_main_workspace_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "the main workspace window is unavailable".to_string())?;
    show_and_focus_window(&main_window)
}

pub(crate) fn hide_main_workspace_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "the main workspace window is unavailable".to_string())?;

    main_window
        .hide()
        .map_err(|error| format!("failed to hide the main workspace window: {error}"))
}

pub(crate) fn dismiss_setup_wizard_or_exit<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let setup_state = setup::load_setup_gate_state()?;
    if setup_state.status == SetupGateStatus::Ready {
        close_window_if_open(app, SETUP_WIZARD_WINDOW_LABEL)?;
        return Ok(());
    }

    app.exit(0);
    Ok(())
}

pub(crate) fn emit_settings_updated<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    app.emit_to(MAIN_WINDOW_LABEL, SETTINGS_UPDATED_EVENT, ())
        .map_err(|error| format!("failed to notify the main workspace about settings changes: {error}"))
}

pub(crate) fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) -> Result<(), String> {
    match menu_id {
        MENU_FILE_SETUP_WIZARD => open_setup_wizard_window(app),
        MENU_FILE_SETTINGS => open_settings_window(app),
        MENU_HELP_ABOUT => open_about_window(app),
        MENU_FILE_EXIT => {
            app.exit(0);
            Ok(())
        }
        MENU_VIEW_GAMES_AND_APPS => navigate_main_workspace(app, MainWorkspaceTarget::GamesAndApps),
        MENU_VIEW_INSTALLED_ON_BOARD => {
            navigate_main_workspace(app, MainWorkspaceTarget::InstalledOnBoard)
        }
        MENU_VIEW_RESCAN_GAMES_AND_APPS => rescan_games_and_apps(app),
        _ => Ok(()),
    }
}

fn navigate_main_workspace<R: Runtime>(
    app: &AppHandle<R>,
    target: MainWorkspaceTarget,
) -> Result<(), String> {
    let setup_state = setup::load_setup_gate_state()?;
    if setup_state.status != SetupGateStatus::Ready {
        return open_setup_wizard_window(app);
    }

    show_main_workspace_window(app)?;
    app.emit_to(
        MAIN_WINDOW_LABEL,
        MAIN_WORKSPACE_NAVIGATE_EVENT,
        MainWorkspaceNavigationEvent { target },
    )
    .map_err(|error| format!("failed to navigate the main workspace: {error}"))
}

fn rescan_games_and_apps<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let setup_state = setup::load_setup_gate_state()?;
    if setup_state.status != SetupGateStatus::Ready {
        return open_setup_wizard_window(app);
    }

    show_main_workspace_window(app)?;
    app.emit_to(MAIN_WINDOW_LABEL, MAIN_WORKSPACE_RESCAN_EVENT, ())
        .map_err(|error| format!("failed to trigger a games-and-apps rescan: {error}"))
}

fn show_or_focus_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    title: &str,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    resizable: bool,
) -> Result<(), String> {
    if let Some(existing_window) = app.get_webview_window(label) {
        return show_and_focus_window(&existing_window);
    }

    let created_window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(min_width, min_height)
        .resizable(resizable)
        .center()
        .build()
        .map_err(|error| format!("failed to build the `{label}` window: {error}"))?;

    show_and_focus_window(&created_window)
}

fn show_and_focus_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window
        .is_minimized()
        .map_err(|error| format!("failed to inspect the `{}` window state: {error}", window.label()))?
    {
        window
            .unminimize()
            .map_err(|error| format!("failed to restore the `{}` window: {error}", window.label()))?;
    }

    if !window
        .is_visible()
        .map_err(|error| format!("failed to inspect the `{}` visibility: {error}", window.label()))?
    {
        window
            .show()
            .map_err(|error| format!("failed to show the `{}` window: {error}", window.label()))?;
    }

    window
        .set_focus()
        .map_err(|error| format!("failed to focus the `{}` window: {error}", window.label()))
}

fn close_window_if_open<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window
            .close()
            .map_err(|error| format!("failed to close the `{label}` window: {error}"))?;
    }

    Ok(())
}

fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::menu::Menu<R>, String> {
    let setup_wizard_item =
        MenuItem::with_id(app, MENU_FILE_SETUP_WIZARD, "Setup Wizard...", true, None::<&str>)
            .map_err(|error| format!("failed to create the setup wizard menu item: {error}"))?;
    let settings_item =
        MenuItem::with_id(app, MENU_FILE_SETTINGS, "Settings...", true, Some("CmdOrCtrl+,"))
            .map_err(|error| format!("failed to create the settings menu item: {error}"))?;
    let exit_item = MenuItem::with_id(app, MENU_FILE_EXIT, "Exit", true, None::<&str>)
        .map_err(|error| format!("failed to create the exit menu item: {error}"))?;
    let games_and_apps_item = MenuItem::with_id(
        app,
        MENU_VIEW_GAMES_AND_APPS,
        "Games && Apps",
        true,
        None::<&str>,
    )
    .map_err(|error| format!("failed to create the Games & Apps menu item: {error}"))?;
    let installed_on_board_item = MenuItem::with_id(
        app,
        MENU_VIEW_INSTALLED_ON_BOARD,
        "Installed on Board",
        true,
        None::<&str>,
    )
    .map_err(|error| format!("failed to create the Installed on Board menu item: {error}"))?;
    let rescan_games_and_apps_item = MenuItem::with_id(
        app,
        MENU_VIEW_RESCAN_GAMES_AND_APPS,
        "Rescan Games && Apps",
        true,
        None::<&str>,
    )
    .map_err(|error| format!("failed to create the rescan menu item: {error}"))?;
    let about_item =
        MenuItem::with_id(app, MENU_HELP_ABOUT, "About BE Home for Desktop", true, None::<&str>)
            .map_err(|error| format!("failed to create the About menu item: {error}"))?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&setup_wizard_item)
        .item(&settings_item)
        .separator()
        .item(&exit_item)
        .build()
        .map_err(|error| format!("failed to build the File menu: {error}"))?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&games_and_apps_item)
        .item(&installed_on_board_item)
        .separator()
        .item(&rescan_games_and_apps_item)
        .build()
        .map_err(|error| format!("failed to build the View menu: {error}"))?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&about_item)
        .build()
        .map_err(|error| format!("failed to build the Help menu: {error}"))?;

    MenuBuilder::new(app)
        .item(&file_menu)
        .item(&view_menu)
        .item(&help_menu)
        .build()
        .map_err(|error| format!("failed to build the application menu: {error}"))
}

fn startup_mode_for_status(status: SetupGateStatus) -> StartupMode {
    match status {
        SetupGateStatus::Ready => StartupMode::ShowMainWorkspace,
        SetupGateStatus::RequiresSetup | SetupGateStatus::Unsupported => StartupMode::OpenSetupWizard,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        startup_mode_for_status, MainWorkspaceTarget, StartupMode, MENU_VIEW_GAMES_AND_APPS,
        MENU_VIEW_INSTALLED_ON_BOARD,
    };
    use crate::setup::SetupGateStatus;

    #[test]
    fn ready_setup_status_opens_the_main_workspace_first() {
        assert_eq!(
            StartupMode::ShowMainWorkspace,
            startup_mode_for_status(SetupGateStatus::Ready)
        );
    }

    #[test]
    fn incomplete_setup_statuses_stay_in_the_wizard() {
        assert_eq!(
            StartupMode::OpenSetupWizard,
            startup_mode_for_status(SetupGateStatus::RequiresSetup)
        );
        assert_eq!(
            StartupMode::OpenSetupWizard,
            startup_mode_for_status(SetupGateStatus::Unsupported)
        );
    }

    #[test]
    fn menu_target_routes_stay_stable_for_the_main_workspace() {
        assert_eq!("shell.view.gamesAndApps", MENU_VIEW_GAMES_AND_APPS);
        assert_eq!(
            MainWorkspaceTarget::GamesAndApps,
            MainWorkspaceTarget::GamesAndApps
        );
        assert_eq!("shell.view.installedOnBoard", MENU_VIEW_INSTALLED_ON_BOARD);
        assert_eq!(
            MainWorkspaceTarget::InstalledOnBoard,
            MainWorkspaceTarget::InstalledOnBoard
        );
    }
}
