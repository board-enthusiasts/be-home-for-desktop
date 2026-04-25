mod actions;
mod apk;
mod bdb;
mod bdb_tool;
mod device;
mod installed_titles;
mod library;
mod process_runner;
mod setup;
mod shell;
mod storage;

async fn run_blocking<T, F>(operation_name: &'static str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("BE Home could not finish {operation_name}: {error}"))?
}

#[tauri::command]
async fn load_setup_gate_state() -> Result<setup::SetupGateState, String> {
    run_blocking("loading setup state", setup::load_setup_gate_state).await
}

#[tauri::command]
async fn load_apk_discovery_snapshot() -> Result<apk::ApkDiscoverySnapshot, String> {
    run_blocking(
        "scanning this computer for games and apps",
        apk::load_current_apk_discovery_snapshot,
    )
    .await
}

#[tauri::command]
async fn inspect_manual_apk_path(
    input: apk::ManualApkPathInput,
) -> Result<apk::ApkCandidate, String> {
    run_blocking("checking the selected game or app", move || {
        apk::inspect_manual_apk_path(input)
    })
    .await
}

#[tauri::command]
async fn load_managed_apk_library_snapshot() -> Result<library::ManagedApkLibrarySnapshot, String> {
    run_blocking(
        "loading the saved game and app library",
        library::load_current_managed_apk_library_snapshot,
    )
    .await
}

#[tauri::command]
async fn import_apk_to_managed_library(
    input: library::ManagedApkLibraryImportInput,
) -> Result<library::ManagedApkLibraryImportResult, String> {
    run_blocking("saving a copy of that game or app", move || {
        library::import_apk_to_managed_library(input)
    })
    .await
}

#[tauri::command]
async fn install_apk_to_connected_board(
    input: actions::InstallApkInput,
) -> Result<actions::InstallApkResult, String> {
    run_blocking("installing the game or app on Board", move || {
        actions::install_apk_to_connected_board(input)
    })
    .await
}

#[tauri::command]
async fn uninstall_installed_title_from_board(
    input: actions::UninstallInstalledTitleInput,
) -> Result<actions::UninstallInstalledTitleResult, String> {
    run_blocking("removing the title from Board", move || {
        actions::uninstall_installed_title_from_board(input)
    })
    .await
}

#[tauri::command]
async fn launch_installed_title_on_board(
    input: actions::LaunchInstalledTitleInput,
) -> Result<actions::LaunchInstalledTitleResult, String> {
    run_blocking("opening the title on Board", move || {
        actions::launch_installed_title_on_board(input)
    })
    .await
}

#[tauri::command]
async fn load_bdb_source_plan() -> Result<bdb::BdbSourcePlan, String> {
    run_blocking("loading Board install tool support details", || {
        Ok(bdb::resolve_current_bdb_source_plan())
    })
    .await
}

#[tauri::command]
async fn load_bdb_tool_state() -> Result<bdb_tool::BdbToolState, String> {
    run_blocking(
        "checking the Board install tool",
        bdb_tool::load_current_bdb_tool_state,
    )
    .await
}

#[tauri::command]
async fn refresh_bdb_tool_state() -> Result<bdb_tool::BdbToolState, String> {
    run_blocking("checking for Board install tool updates", || {
        bdb_tool::load_current_bdb_tool_state_with_remote_refresh(true)
    })
    .await
}

#[tauri::command]
async fn acquire_bdb_tool(repair: bool) -> Result<bdb_tool::BdbAcquisitionResult, String> {
    run_blocking("downloading the Board install tool", move || {
        bdb_tool::acquire_current_bdb_tool(repair)
    })
    .await
}

#[tauri::command]
async fn load_device_status_snapshot() -> Result<device::DeviceStatusSnapshot, String> {
    run_blocking(
        "checking the Board connection",
        device::load_current_device_status_snapshot,
    )
    .await
}

#[tauri::command]
async fn load_installed_titles_snapshot(
) -> Result<installed_titles::InstalledTitlesSnapshot, String> {
    run_blocking(
        "reading installed titles from Board",
        installed_titles::load_current_installed_titles_snapshot,
    )
    .await
}

#[tauri::command]
async fn load_managed_storage_settings() -> Result<storage::ManagedStorageSettings, String> {
    run_blocking(
        "loading storage settings",
        storage::load_managed_storage_settings,
    )
    .await
}

#[tauri::command]
async fn load_desktop_settings() -> Result<storage::DesktopSettings, String> {
    run_blocking("loading desktop settings", storage::load_desktop_settings).await
}

#[tauri::command]
async fn save_managed_storage_settings(
    overrides: storage::ManagedStorageOverridesInput,
) -> Result<storage::ManagedStorageSettings, String> {
    run_blocking("saving storage settings", move || {
        storage::save_managed_storage_settings(overrides)
    })
    .await
}

#[tauri::command]
async fn save_desktop_settings(
    input: storage::DesktopSettingsInput,
) -> Result<storage::DesktopSettings, String> {
    run_blocking("saving desktop settings", move || {
        storage::save_desktop_settings(input)
    })
    .await
}

#[tauri::command]
fn complete_setup_wizard() -> Result<(), String> {
    storage::save_setup_completed(true)
}

#[tauri::command]
fn open_setup_wizard_window(app: tauri::AppHandle) -> Result<(), String> {
    shell::open_setup_wizard_window(&app)
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    shell::open_settings_window(&app)
}

#[tauri::command]
fn open_about_window(app: tauri::AppHandle) -> Result<(), String> {
    shell::open_about_window(&app)
}

#[tauri::command]
fn close_about_window(app: tauri::AppHandle) -> Result<(), String> {
    shell::close_about_window(&app)
}

#[tauri::command]
fn show_main_workspace_window(app: tauri::AppHandle) -> Result<(), String> {
    shell::show_main_workspace_window(&app)
}

#[tauri::command]
fn dismiss_setup_wizard_window(app: tauri::AppHandle) -> Result<(), String> {
    shell::dismiss_setup_wizard_or_exit(&app)
}

#[tauri::command]
fn finish_setup_wizard_window(app: tauri::AppHandle) -> Result<(), String> {
    shell::finish_setup_wizard_window(&app)
}

#[tauri::command]
fn emit_settings_updated(app: tauri::AppHandle) -> Result<(), String> {
    shell::emit_settings_updated(&app)
}

#[tauri::command]
fn exit_application(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// Starts the Tauri desktop host for BE Home for Desktop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            shell::initialize_native_shell(&app.handle()).map_err(|error| {
                Box::<dyn std::error::Error>::from(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    error,
                ))
            })
        })
        .invoke_handler(tauri::generate_handler![
            load_setup_gate_state,
            load_apk_discovery_snapshot,
            inspect_manual_apk_path,
            load_managed_apk_library_snapshot,
            import_apk_to_managed_library,
            install_apk_to_connected_board,
            uninstall_installed_title_from_board,
            launch_installed_title_on_board,
            load_bdb_source_plan,
            load_bdb_tool_state,
            refresh_bdb_tool_state,
            acquire_bdb_tool,
            load_device_status_snapshot,
            load_installed_titles_snapshot,
            load_managed_storage_settings,
            load_desktop_settings,
            save_managed_storage_settings,
            save_desktop_settings,
            complete_setup_wizard,
            open_setup_wizard_window,
            open_settings_window,
            open_about_window,
            close_about_window,
            show_main_workspace_window,
            dismiss_setup_wizard_window,
            finish_setup_wizard_window,
            emit_settings_updated,
            exit_application
        ])
        .run(tauri::generate_context!())
        .expect("error while running BE Home for Desktop");
}

#[cfg(test)]
mod tests {
    use std::future::Future;

    fn run_command<T>(future: impl Future<Output = Result<T, String>>) -> T {
        tauri::async_runtime::block_on(future).expect("command should complete successfully")
    }

    #[test]
    fn setup_gate_state_serializes_the_bootstrap_contract() {
        let state = run_command(super::load_setup_gate_state());
        let serialized =
            serde_json::to_value(state).expect("setup gate state should serialize successfully");

        assert!(serialized.get("status").is_some());
        assert!(serialized.get("requiredStep").is_some());
        assert!(serialized.get("toolState").is_some());
        assert!(serialized.get("storage").is_some());
        assert!(serialized.get("defaultScanFolders").is_some());
    }

    #[test]
    fn apk_discovery_snapshot_serializes_the_discovery_contract() {
        let snapshot = run_command(super::load_apk_discovery_snapshot());
        let serialized =
            serde_json::to_value(snapshot).expect("apk discovery snapshot should serialize");

        assert!(serialized.get("status").is_some());
        assert!(serialized.get("guidance").is_some());
        assert!(serialized.get("candidates").is_some());
    }

    #[test]
    fn managed_apk_library_snapshot_serializes_the_library_contract() {
        let snapshot = run_command(super::load_managed_apk_library_snapshot());
        let serialized =
            serde_json::to_value(snapshot).expect("managed APK library snapshot should serialize");

        assert!(serialized.get("status").is_some());
        assert!(serialized.get("guidance").is_some());
        assert!(serialized.get("items").is_some());
    }

    #[test]
    fn bdb_source_plan_uses_the_supported_manifest_contract() {
        let plan = run_command(super::load_bdb_source_plan());
        let serialized = serde_json::to_value(plan).expect("bdb source plan should serialize");

        assert!(serialized
            .get("manifestSource")
            .and_then(|value| value.as_str())
            .is_some_and(|value| matches!(value, "bundled" | "cached" | "remote")));
        assert!(serialized
            .get("manifestSchemaVersion")
            .and_then(|value| value.as_u64())
            .is_some_and(|value| matches!(value, 1 | 2)));
        assert!(serialized
            .get("remoteManifestUrl")
            .and_then(|value| value.as_str())
            .is_some_and(|value| value.contains("raw.githubusercontent.com/board-enthusiasts/be-home-for-desktop/main/config/bdb-sources.json")));
    }

    #[test]
    fn managed_storage_settings_serialize_with_distinct_tool_and_library_locations() {
        let settings = run_command(super::load_managed_storage_settings());
        let serialized =
            serde_json::to_value(settings).expect("managed storage settings should serialize");

        assert!(serialized.get("settingsFilePath").is_some());
        assert!(serialized
            .get("bdbTools")
            .and_then(|value| value.get("effectivePath"))
            .is_some());
        assert!(serialized
            .get("apkLibrary")
            .and_then(|value| value.get("effectivePath"))
            .is_some());
    }

    #[test]
    fn desktop_settings_serialize_with_scan_folders_and_bdb_path() {
        let settings = run_command(super::load_desktop_settings());
        let serialized = serde_json::to_value(settings).expect("desktop settings should serialize");

        assert!(serialized.get("scanFolders").is_some());
        assert!(serialized.get("bdbExecutablePath").is_some());
    }

    #[test]
    fn bdb_tool_state_serializes_the_host_side_status_contract() {
        let state = run_command(super::load_bdb_tool_state());
        let serialized = serde_json::to_value(state).expect("bdb tool state should serialize");

        assert!(serialized.get("status").is_some());
        assert!(serialized.get("storage").is_some());
        assert!(serialized.get("sourcePlan").is_some());
        assert!(serialized
            .get("validation")
            .and_then(|value| value.get("status"))
            .is_some());
    }

    #[test]
    fn device_status_snapshot_serializes_the_runtime_contract() {
        let snapshot = run_command(super::load_device_status_snapshot());
        let serialized =
            serde_json::to_value(snapshot).expect("device status snapshot should serialize");

        assert!(serialized.get("status").is_some());
        assert!(serialized.get("guidance").is_some());
        assert!(serialized.get("pollIntervalMs").is_some());
        assert!(serialized
            .get("bdbVersion")
            .and_then(|value| value.get("status"))
            .is_some());
    }

    #[test]
    fn installed_titles_snapshot_serializes_the_inventory_contract() {
        let snapshot = run_command(super::load_installed_titles_snapshot());
        let serialized =
            serde_json::to_value(snapshot).expect("installed titles snapshot should serialize");

        assert!(serialized.get("status").is_some());
        assert!(serialized.get("guidance").is_some());
        assert!(serialized.get("titles").is_some());
    }
}
