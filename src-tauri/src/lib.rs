mod actions;
mod apk;
mod bdb;
mod bdb_tool;
mod device;
mod installed_titles;
mod library;
mod setup;
mod storage;

#[tauri::command]
fn load_setup_gate_state() -> Result<setup::SetupGateState, String> {
    setup::load_setup_gate_state()
}

#[tauri::command]
fn load_apk_discovery_snapshot() -> Result<apk::ApkDiscoverySnapshot, String> {
    apk::load_current_apk_discovery_snapshot()
}

#[tauri::command]
fn inspect_manual_apk_path(input: apk::ManualApkPathInput) -> Result<apk::ApkCandidate, String> {
    apk::inspect_manual_apk_path(input)
}

#[tauri::command]
fn load_managed_apk_library_snapshot(
) -> Result<library::ManagedApkLibrarySnapshot, String> {
    library::load_current_managed_apk_library_snapshot()
}

#[tauri::command]
fn import_apk_to_managed_library(
    input: library::ManagedApkLibraryImportInput,
) -> Result<library::ManagedApkLibraryImportResult, String> {
    library::import_apk_to_managed_library(input)
}

#[tauri::command]
fn install_apk_to_connected_board(
    input: actions::InstallApkInput,
) -> Result<actions::InstallApkResult, String> {
    actions::install_apk_to_connected_board(input)
}

#[tauri::command]
fn uninstall_installed_title_from_board(
    input: actions::UninstallInstalledTitleInput,
) -> Result<actions::UninstallInstalledTitleResult, String> {
    actions::uninstall_installed_title_from_board(input)
}

#[tauri::command]
fn load_bdb_source_plan() -> bdb::BdbSourcePlan {
    bdb::resolve_current_bdb_source_plan()
}

#[tauri::command]
fn load_bdb_tool_state() -> Result<bdb_tool::BdbToolState, String> {
    bdb_tool::load_current_bdb_tool_state()
}

#[tauri::command]
fn acquire_bdb_tool(repair: bool) -> Result<bdb_tool::BdbAcquisitionResult, String> {
    bdb_tool::acquire_current_bdb_tool(repair)
}

#[tauri::command]
fn load_device_status_snapshot() -> Result<device::DeviceStatusSnapshot, String> {
    device::load_current_device_status_snapshot()
}

#[tauri::command]
fn load_installed_titles_snapshot(
) -> Result<installed_titles::InstalledTitlesSnapshot, String> {
    installed_titles::load_current_installed_titles_snapshot()
}

#[tauri::command]
fn load_managed_storage_settings() -> Result<storage::ManagedStorageSettings, String> {
    storage::load_managed_storage_settings()
}

#[tauri::command]
fn load_desktop_settings() -> Result<storage::DesktopSettings, String> {
    storage::load_desktop_settings()
}

#[tauri::command]
fn save_managed_storage_settings(
    overrides: storage::ManagedStorageOverridesInput,
) -> Result<storage::ManagedStorageSettings, String> {
    storage::save_managed_storage_settings(overrides)
}

#[tauri::command]
fn save_desktop_settings(
    input: storage::DesktopSettingsInput,
) -> Result<storage::DesktopSettings, String> {
    storage::save_desktop_settings(input)
}

/// Starts the Tauri desktop host for BE Home for Desktop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_setup_gate_state,
            load_apk_discovery_snapshot,
            inspect_manual_apk_path,
            load_managed_apk_library_snapshot,
            import_apk_to_managed_library,
            install_apk_to_connected_board,
            uninstall_installed_title_from_board,
            load_bdb_source_plan,
            load_bdb_tool_state,
            acquire_bdb_tool,
            load_device_status_snapshot,
            load_installed_titles_snapshot,
            load_managed_storage_settings,
            load_desktop_settings,
            save_managed_storage_settings,
            save_desktop_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running BE Home for Desktop");
}

#[cfg(test)]
mod tests {
    #[test]
    fn setup_gate_state_serializes_the_bootstrap_contract() {
        let state =
            super::load_setup_gate_state().expect("setup gate state should load successfully");
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
        let snapshot = super::load_apk_discovery_snapshot()
            .expect("apk discovery snapshot should load successfully");
        let serialized =
            serde_json::to_value(snapshot).expect("apk discovery snapshot should serialize");

        assert!(serialized.get("status").is_some());
        assert!(serialized.get("guidance").is_some());
        assert!(serialized.get("candidates").is_some());
    }

    #[test]
    fn managed_apk_library_snapshot_serializes_the_library_contract() {
        let snapshot = super::load_managed_apk_library_snapshot()
            .expect("managed APK library snapshot should load successfully");
        let serialized =
            serde_json::to_value(snapshot).expect("managed APK library snapshot should serialize");

        assert!(serialized.get("status").is_some());
        assert!(serialized.get("guidance").is_some());
        assert!(serialized.get("items").is_some());
    }

    #[test]
    fn bdb_source_plan_uses_the_bundled_manifest_contract() {
        let plan = super::load_bdb_source_plan();
        let serialized = serde_json::to_value(plan).expect("bdb source plan should serialize");

        assert!(serialized
            .get("manifestSource")
            .and_then(|value| value.as_str())
            .is_some_and(|value| matches!(value, "bundled" | "cached" | "remote")));
        assert_eq!(
            Some(1),
            serialized
                .get("manifestSchemaVersion")
                .and_then(|value| value.as_u64())
        );
        assert!(serialized
            .get("remoteManifestUrl")
            .and_then(|value| value.as_str())
            .is_some_and(|value| value.contains("raw.githubusercontent.com/board-enthusiasts/be-home-for-desktop/main/config/bdb-sources.json")));
    }

    #[test]
    fn managed_storage_settings_serialize_with_distinct_tool_and_library_locations() {
        let settings = super::load_managed_storage_settings().expect("managed storage should load");
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
        let settings = super::load_desktop_settings().expect("desktop settings should load");
        let serialized = serde_json::to_value(settings).expect("desktop settings should serialize");

        assert!(serialized.get("scanFolders").is_some());
        assert!(serialized.get("bdbExecutablePath").is_some());
    }

    #[test]
    fn bdb_tool_state_serializes_the_host_side_status_contract() {
        let state = super::load_bdb_tool_state().expect("bdb tool state should load");
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
        let snapshot =
            super::load_device_status_snapshot().expect("device status snapshot should load");
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
        let snapshot = super::load_installed_titles_snapshot()
            .expect("installed titles snapshot should load");
        let serialized =
            serde_json::to_value(snapshot).expect("installed titles snapshot should serialize");

        assert!(serialized.get("status").is_some());
        assert!(serialized.get("guidance").is_some());
        assert!(serialized.get("titles").is_some());
    }
}
