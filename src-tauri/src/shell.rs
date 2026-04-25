use crate::setup::{self, SetupGateStatus};
use std::path::PathBuf;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const SETUP_WIZARD_WINDOW_LABEL: &str = "setup-wizard";
pub(crate) const SETTINGS_WINDOW_LABEL: &str = "settings";
pub(crate) const ABOUT_WINDOW_LABEL: &str = "about";

pub(crate) const SETTINGS_UPDATED_EVENT: &str = "desktop-shell://settings-updated";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartupMode {
    ShowMainWorkspace,
    OpenSetupWizard,
}

pub(crate) fn initialize_native_shell<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
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
    let setup_state = setup::load_setup_gate_state()?;
    let parent_label = if setup_state.status == SetupGateStatus::Ready {
        Some(MAIN_WINDOW_LABEL)
    } else {
        None
    };

    show_or_focus_window(
        app,
        WindowPresentation {
            label: SETUP_WIZARD_WINDOW_LABEL,
            title: "BE Home for Desktop",
            width: 920.0,
            height: 760.0,
            min_width: 700.0,
            min_height: 620.0,
            resizable: true,
            maximizable: false,
            minimizable: false,
            skip_taskbar: parent_label.is_some(),
            always_on_top: true,
            parent_label,
        },
    )
}

pub(crate) fn open_settings_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    show_or_focus_window(
        app,
        WindowPresentation {
            label: SETTINGS_WINDOW_LABEL,
            title: "BE Home for Desktop",
            width: 980.0,
            height: 820.0,
            min_width: 760.0,
            min_height: 620.0,
            resizable: true,
            maximizable: false,
            minimizable: false,
            skip_taskbar: true,
            always_on_top: true,
            parent_label: Some(MAIN_WINDOW_LABEL),
        },
    )
}

pub(crate) fn open_about_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    show_or_focus_window(
        app,
        WindowPresentation {
            label: ABOUT_WINDOW_LABEL,
            title: "About BE Home for Desktop",
            width: 520.0,
            height: 420.0,
            min_width: 420.0,
            min_height: 320.0,
            resizable: false,
            maximizable: false,
            minimizable: false,
            skip_taskbar: true,
            always_on_top: false,
            parent_label: Some(MAIN_WINDOW_LABEL),
        },
    )
}

pub(crate) fn close_about_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    close_window_if_open(app, ABOUT_WINDOW_LABEL)
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

pub(crate) fn finish_setup_wizard_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    crate::storage::save_setup_completed(true)?;
    close_window_if_open(app, SETUP_WIZARD_WINDOW_LABEL)?;
    show_main_workspace_window(app)?;
    emit_settings_updated(app)
}

pub(crate) fn emit_settings_updated<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    app.emit_to(MAIN_WINDOW_LABEL, SETTINGS_UPDATED_EVENT, ())
        .map_err(|error| {
            format!("failed to notify the main workspace about settings changes: {error}")
        })
}

struct WindowPresentation<'a> {
    label: &'a str,
    title: &'a str,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    resizable: bool,
    maximizable: bool,
    minimizable: bool,
    skip_taskbar: bool,
    always_on_top: bool,
    parent_label: Option<&'a str>,
}

fn show_or_focus_window<R: Runtime>(
    app: &AppHandle<R>,
    presentation: WindowPresentation<'_>,
) -> Result<(), String> {
    if let Some(existing_window) = app.get_webview_window(presentation.label) {
        return show_and_focus_window(&existing_window);
    }

    let mut builder = WebviewWindowBuilder::new(
        app,
        presentation.label,
        app_url_for_label(presentation.label),
    )
    .title(presentation.title)
    .inner_size(presentation.width, presentation.height)
    .min_inner_size(presentation.min_width, presentation.min_height)
    .resizable(presentation.resizable)
    .maximizable(presentation.maximizable)
    .minimizable(presentation.minimizable)
    .closable(true)
    .skip_taskbar(presentation.skip_taskbar)
    .always_on_top(presentation.always_on_top)
    .decorations(true)
    .center();

    if let Some(parent_label) = presentation.parent_label {
        let parent_window = app
            .get_webview_window(parent_label)
            .ok_or_else(|| format!("the `{parent_label}` window is unavailable"))?;
        builder = builder.parent(&parent_window).map_err(|error| {
            format!("failed to set `{parent_label}` as the owner window: {error}")
        })?;
    }

    let created_window = builder.build().map_err(|error| {
        format!(
            "failed to build the `{}` window: {error}",
            presentation.label
        )
    })?;

    show_and_focus_window(&created_window)
}

fn app_url_for_label(_label: &str) -> WebviewUrl {
    WebviewUrl::App(PathBuf::from("index.html"))
}

fn show_and_focus_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window.is_minimized().map_err(|error| {
        format!(
            "failed to inspect the `{}` window state: {error}",
            window.label()
        )
    })? {
        window.unminimize().map_err(|error| {
            format!("failed to restore the `{}` window: {error}", window.label())
        })?;
    }

    if !window.is_visible().map_err(|error| {
        format!(
            "failed to inspect the `{}` visibility: {error}",
            window.label()
        )
    })? {
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
            .destroy()
            .map_err(|error| format!("failed to close the `{label}` window: {error}"))?;
    }

    Ok(())
}

fn startup_mode_for_status(status: SetupGateStatus) -> StartupMode {
    match status {
        SetupGateStatus::Ready => StartupMode::ShowMainWorkspace,
        SetupGateStatus::RequiresSetup | SetupGateStatus::Unsupported => {
            StartupMode::OpenSetupWizard
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{app_url_for_label, startup_mode_for_status, StartupMode};
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
    fn secondary_windows_load_the_bundled_renderer_document() {
        assert_eq!("index.html", app_url_for_label("about").to_string());
        assert_eq!("index.html", app_url_for_label("setup-wizard").to_string());
    }
}
