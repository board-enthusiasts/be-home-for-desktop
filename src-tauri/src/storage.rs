use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

const APP_VENDOR_DIRECTORY: &str = "Board Enthusiasts";
const APP_PRODUCT_DIRECTORY: &str = "BE Home for Desktop";
const APK_LIBRARY_DIRECTORY: &str = "apk-library";
const DOWNLOADS_DIRECTORY: &str = "Downloads";
const SETTINGS_DIRECTORY: &str = "settings";
const STORAGE_SETTINGS_FILE_NAME: &str = "managed-storage.json";
const TOOLS_DIRECTORY: &str = "tools";
const DEFAULT_BOARD_CONNECTION_POLL_INTERVAL_SECONDS: u32 = 5;
const BOARD_CONNECTION_POLL_INTERVAL_OPTIONS: [u32; 3] = [5, 10, 30];

/// Describes the normalized operating system used for managed-storage defaults.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum StorageOperatingSystem {
    Windows,
    Macos,
    Linux,
}

/// Describes whether a managed storage location is using the default path or an override.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ManagedStoragePathSource {
    Default,
    Override,
}

/// Describes whether a scan folder is part of the app defaults or was added later.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConfiguredScanFolderSource {
    Default,
    Custom,
}

/// Describes one managed storage location and how its current path was chosen.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedStorageLocation {
    pub(crate) default_path: String,
    pub(crate) override_path: Option<String>,
    pub(crate) effective_path: String,
    pub(crate) source: ManagedStoragePathSource,
}

/// Describes one active scan folder in the desktop settings model.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfiguredScanFolder {
    pub(crate) path: String,
    pub(crate) source: ConfiguredScanFolderSource,
}

/// Describes the persisted Board connection preferences for the desktop app.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BoardConnectionSettings {
    pub(crate) poll_interval_seconds: u32,
}

/// Describes the current managed storage configuration for the desktop app.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedStorageSettings {
    pub(crate) operating_system: StorageOperatingSystem,
    pub(crate) settings_file_path: String,
    pub(crate) bdb_tools: ManagedStorageLocation,
    pub(crate) apk_library: ManagedStorageLocation,
}

/// Describes the player-facing desktop settings model.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSettings {
    pub(crate) operating_system: StorageOperatingSystem,
    pub(crate) settings_file_path: String,
    pub(crate) bdb_tools: ManagedStorageLocation,
    pub(crate) apk_library: ManagedStorageLocation,
    pub(crate) bdb_executable_path: String,
    pub(crate) board_connection: BoardConnectionSettings,
    pub(crate) scan_folders: Vec<ConfiguredScanFolder>,
}

/// Represents the persisted override payload accepted by the desktop host.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedStorageOverridesInput {
    bdb_tools_override: Option<String>,
    apk_library_override: Option<String>,
}

/// Represents the desktop-settings payload accepted by the host.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSettingsInput {
    apk_library_override: Option<String>,
    board_connection_poll_interval_seconds: Option<u32>,
    scan_folder_paths: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedDesktopSettings {
    bdb_tools_override: Option<String>,
    apk_library_override: Option<String>,
    board_connection_poll_interval_seconds: Option<u32>,
    scan_folder_paths: Option<Vec<String>>,
}

#[derive(Clone, Debug)]
struct ManagedStorageContext {
    operating_system: StorageOperatingSystem,
    app_data_root: PathBuf,
    settings_file_path: PathBuf,
    home_directory: Option<PathBuf>,
}

/// Load the current managed storage settings for the desktop app.
pub(crate) fn load_managed_storage_settings() -> Result<ManagedStorageSettings, String> {
    let context = current_storage_context()?;
    let persisted = load_persisted_settings(&context.settings_file_path)?;
    Ok(build_managed_storage_settings(&context, &persisted))
}

/// Load the player-facing desktop settings for the desktop app.
pub(crate) fn load_desktop_settings() -> Result<DesktopSettings, String> {
    let context = current_storage_context()?;
    let persisted = load_persisted_settings(&context.settings_file_path)?;
    Ok(build_desktop_settings(&context, &persisted))
}

/// Resolve the app-owned root directory used for desktop settings, tools, and cached files.
pub(crate) fn resolve_app_data_root() -> Result<PathBuf, String> {
    Ok(current_storage_context()?.app_data_root)
}

/// Save managed storage overrides and return the updated effective settings.
pub(crate) fn save_managed_storage_settings(
    input: ManagedStorageOverridesInput,
) -> Result<ManagedStorageSettings, String> {
    let context = current_storage_context()?;
    let mut persisted = load_persisted_settings(&context.settings_file_path)?;
    persisted.bdb_tools_override = normalize_override(input.bdb_tools_override)?;
    persisted.apk_library_override = normalize_override(input.apk_library_override)?;

    save_persisted_settings(&context.settings_file_path, &persisted)?;
    Ok(build_managed_storage_settings(&context, &persisted))
}

/// Save the player-facing desktop settings and return the updated effective model.
pub(crate) fn save_desktop_settings(
    input: DesktopSettingsInput,
) -> Result<DesktopSettings, String> {
    let context = current_storage_context()?;
    let mut persisted = load_persisted_settings(&context.settings_file_path)?;
    persisted.apk_library_override = normalize_override(input.apk_library_override)?;
    persisted.board_connection_poll_interval_seconds =
        Some(normalize_board_connection_poll_interval(
            input.board_connection_poll_interval_seconds,
            persisted.board_connection_poll_interval_seconds,
        )?);
    persisted.scan_folder_paths = Some(normalize_scan_folder_paths(input.scan_folder_paths)?);

    save_persisted_settings(&context.settings_file_path, &persisted)?;
    Ok(build_desktop_settings(&context, &persisted))
}

fn build_managed_storage_settings(
    context: &ManagedStorageContext,
    persisted: &PersistedDesktopSettings,
) -> ManagedStorageSettings {
    let default_bdb_tools_path = context.app_data_root.join(TOOLS_DIRECTORY);
    let default_apk_library_path = context.app_data_root.join(APK_LIBRARY_DIRECTORY);
    let bdb_tools_override = normalize_loaded_override(persisted.bdb_tools_override.as_deref());
    let apk_library_override = normalize_loaded_override(persisted.apk_library_override.as_deref());

    ManagedStorageSettings {
        operating_system: context.operating_system,
        settings_file_path: path_to_string(&context.settings_file_path),
        bdb_tools: build_location(default_bdb_tools_path, bdb_tools_override),
        apk_library: build_location(default_apk_library_path, apk_library_override),
    }
}

fn build_desktop_settings(
    context: &ManagedStorageContext,
    persisted: &PersistedDesktopSettings,
) -> DesktopSettings {
    let managed_storage = build_managed_storage_settings(context, persisted);
        DesktopSettings {
        operating_system: managed_storage.operating_system,
        settings_file_path: managed_storage.settings_file_path.clone(),
        bdb_tools: managed_storage.bdb_tools.clone(),
        apk_library: managed_storage.apk_library.clone(),
        bdb_executable_path: resolve_bdb_executable_path(&managed_storage.bdb_tools),
        board_connection: BoardConnectionSettings {
            poll_interval_seconds: resolve_board_connection_poll_interval_seconds(persisted),
        },
        scan_folders: build_scan_folders(context, persisted),
    }
}

fn build_location(default_path: PathBuf, override_path: Option<String>) -> ManagedStorageLocation {
    let default_path_string = path_to_string(&default_path);
    match override_path {
        Some(override_path) => ManagedStorageLocation {
            default_path: default_path_string,
            override_path: Some(override_path.clone()),
            effective_path: override_path,
            source: ManagedStoragePathSource::Override,
        },
        None => ManagedStorageLocation {
            default_path: default_path_string.clone(),
            override_path: None,
            effective_path: default_path_string,
            source: ManagedStoragePathSource::Default,
        },
    }
}

fn build_scan_folders(
    context: &ManagedStorageContext,
    persisted: &PersistedDesktopSettings,
) -> Vec<ConfiguredScanFolder> {
    let default_paths = default_scan_folder_paths(context)
        .into_iter()
        .map(|path| path_to_string(&path))
        .collect::<Vec<_>>();
    let default_keys = default_paths
        .iter()
        .map(|path| path_identity_key(path))
        .collect::<BTreeSet<_>>();
    let effective_paths = persisted
        .scan_folder_paths
        .as_ref()
        .map(|paths| normalize_loaded_scan_folder_paths(paths.as_slice()))
        .unwrap_or(default_paths);

    effective_paths
        .into_iter()
        .map(|path| ConfiguredScanFolder {
            source: if default_keys.contains(&path_identity_key(&path)) {
                ConfiguredScanFolderSource::Default
            } else {
                ConfiguredScanFolderSource::Custom
            },
            path,
        })
        .collect()
}

fn default_scan_folder_paths(context: &ManagedStorageContext) -> Vec<PathBuf> {
    context
        .home_directory
        .as_ref()
        .map(|home_directory| vec![home_directory.join(DOWNLOADS_DIRECTORY)])
        .unwrap_or_default()
}

fn normalize_loaded_override(value: Option<&str>) -> Option<String> {
    normalize_override(value.map(str::to_owned)).ok().flatten()
}

fn normalize_loaded_scan_folder_paths(values: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = BTreeSet::new();

    for value in values {
        if let Ok(Some(path)) = normalize_override(Some(value.clone())) {
            let key = path_identity_key(&path);
            if seen.insert(key) {
                normalized.push(path);
            }
        }
    }

    normalized
}

fn resolve_board_connection_poll_interval_seconds(
    persisted: &PersistedDesktopSettings,
) -> u32 {
    persisted
        .board_connection_poll_interval_seconds
        .filter(|value| BOARD_CONNECTION_POLL_INTERVAL_OPTIONS.contains(value))
        .unwrap_or(DEFAULT_BOARD_CONNECTION_POLL_INTERVAL_SECONDS)
}

fn normalize_board_connection_poll_interval(
    requested: Option<u32>,
    current: Option<u32>,
) -> Result<u32, String> {
    let poll_interval = requested
        .or(current)
        .unwrap_or(DEFAULT_BOARD_CONNECTION_POLL_INTERVAL_SECONDS);

    if BOARD_CONNECTION_POLL_INTERVAL_OPTIONS.contains(&poll_interval) {
        return Ok(poll_interval);
    }

    Err(format!(
        "The desktop app only supports Board connection refresh intervals of {} seconds.",
        BOARD_CONNECTION_POLL_INTERVAL_OPTIONS
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn current_storage_context() -> Result<ManagedStorageContext, String> {
    let environment = std::env::vars_os().collect::<BTreeMap<_, _>>();
    current_storage_context_from_environment(&environment)
}

fn current_storage_context_from_environment(
    environment: &BTreeMap<OsString, OsString>,
) -> Result<ManagedStorageContext, String> {
    if cfg!(target_os = "windows") {
        let local_app_data = require_environment_path(environment, "LOCALAPPDATA")?;
        return Ok(ManagedStorageContext {
            operating_system: StorageOperatingSystem::Windows,
            app_data_root: local_app_data
                .join(APP_VENDOR_DIRECTORY)
                .join(APP_PRODUCT_DIRECTORY),
            settings_file_path: local_app_data
                .join(APP_VENDOR_DIRECTORY)
                .join(APP_PRODUCT_DIRECTORY)
                .join(SETTINGS_DIRECTORY)
                .join(STORAGE_SETTINGS_FILE_NAME),
            home_directory: resolve_home_directory(environment),
        });
    }

    let home_directory = require_environment_path(environment, "HOME")?;
    if cfg!(target_os = "macos") {
        let root = home_directory
            .join("Library")
            .join("Application Support")
            .join(APP_VENDOR_DIRECTORY)
            .join(APP_PRODUCT_DIRECTORY);
        return Ok(ManagedStorageContext {
            operating_system: StorageOperatingSystem::Macos,
            settings_file_path: root
                .join(SETTINGS_DIRECTORY)
                .join(STORAGE_SETTINGS_FILE_NAME),
            app_data_root: root,
            home_directory: Some(home_directory),
        });
    }

    let root = home_directory
        .join(".local")
        .join("share")
        .join(APP_VENDOR_DIRECTORY)
        .join(APP_PRODUCT_DIRECTORY);
    Ok(ManagedStorageContext {
        operating_system: StorageOperatingSystem::Linux,
        settings_file_path: root
            .join(SETTINGS_DIRECTORY)
            .join(STORAGE_SETTINGS_FILE_NAME),
        app_data_root: root,
        home_directory: Some(home_directory),
    })
}

fn require_environment_path(
    environment: &BTreeMap<OsString, OsString>,
    key: &str,
) -> Result<PathBuf, String> {
    lookup_environment_value(environment, key)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| {
            format!(
                "The desktop app could not resolve its managed storage defaults because the `{key}` environment variable was unavailable."
            )
        })
}

fn resolve_home_directory(environment: &BTreeMap<OsString, OsString>) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        lookup_environment_value(environment, "USERPROFILE")
            .or_else(|| {
                let drive = lookup_environment_value(environment, "HOMEDRIVE")?;
                let path = lookup_environment_value(environment, "HOMEPATH")?;
                Some(format!("{}{}", drive.to_string_lossy(), path.to_string_lossy()).into())
            })
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
    }

    #[cfg(not(target_os = "windows"))]
    {
        lookup_environment_value(environment, "HOME")
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
    }
}

fn lookup_environment_value(
    environment: &BTreeMap<OsString, OsString>,
    key: &str,
) -> Option<OsString> {
    #[cfg(target_os = "windows")]
    {
        environment
            .iter()
            .find(|(candidate, _)| candidate.to_string_lossy().eq_ignore_ascii_case(key))
            .map(|(_, value)| value.clone())
    }

    #[cfg(not(target_os = "windows"))]
    {
        environment.get(&OsString::from(key)).cloned()
    }
}

fn load_persisted_settings(settings_file_path: &Path) -> Result<PersistedDesktopSettings, String> {
    if !settings_file_path.exists() {
        return Ok(PersistedDesktopSettings::default());
    }

    let content = fs::read_to_string(settings_file_path).map_err(|error| {
        format!(
            "The desktop app could not read its managed storage settings file at `{}`: {error}",
            settings_file_path.display()
        )
    })?;

    serde_json::from_str(&content).map_err(|error| {
        format!(
            "The desktop app could not parse its managed storage settings file at `{}`: {error}",
            settings_file_path.display()
        )
    })
}

fn save_persisted_settings(
    settings_file_path: &Path,
    persisted: &PersistedDesktopSettings,
) -> Result<(), String> {
    if let Some(parent) = settings_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "The desktop app could not create the managed storage settings directory at `{}`: {error}",
                parent.display()
            )
        })?;
    }

    let content =
        serde_json::to_string_pretty(persisted).expect("desktop settings should serialize");
    fs::write(settings_file_path, content).map_err(|error| {
        format!(
            "The desktop app could not save its managed storage settings file at `{}`: {error}",
            settings_file_path.display()
        )
    })
}

fn normalize_override(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!(
            "Managed storage overrides must use absolute paths. `{trimmed}` is not absolute."
        ));
    }

    Ok(Some(path_to_string(&path)))
}

fn normalize_scan_folder_paths(values: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut seen = BTreeSet::new();

    for value in values {
        let Some(path) = normalize_override(Some(value))? else {
            continue;
        };
        let key = path_identity_key(&path);
        if seen.insert(key) {
            normalized.push(path);
        }
    }

    Ok(normalized)
}

fn path_identity_key(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        path.to_lowercase()
    }

    #[cfg(not(target_os = "windows"))]
    {
        path.to_string()
    }
}

fn resolve_bdb_executable_path(location: &ManagedStorageLocation) -> String {
    PathBuf::from(&location.effective_path)
        .join(bdb_executable_file_name())
        .to_string_lossy()
        .into_owned()
}

fn bdb_executable_file_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "bdb.exe"
    } else {
        "bdb"
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        build_desktop_settings, build_managed_storage_settings,
        current_storage_context_from_environment, load_persisted_settings, normalize_override,
        normalize_scan_folder_paths, save_desktop_settings, save_managed_storage_settings,
        save_persisted_settings, DesktopSettingsInput,
        DEFAULT_BOARD_CONNECTION_POLL_INTERVAL_SECONDS, ManagedStorageContext,
        ManagedStorageOverridesInput, PersistedDesktopSettings, StorageOperatingSystem,
    };
    use std::collections::BTreeMap;
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};

    fn sample_tools_override_path() -> String {
        if cfg!(target_os = "windows") {
            r"C:\temp\be\tools".into()
        } else {
            "/tmp/be/tools".into()
        }
    }

    fn sample_apk_library_override_path() -> String {
        if cfg!(target_os = "windows") {
            r"C:\temp\be\apk-library".into()
        } else {
            "/tmp/be/apk-library".into()
        }
    }

    fn sample_scan_folder_path() -> String {
        if cfg!(target_os = "windows") {
            r"C:\Users\matt\Games".into()
        } else {
            "/home/matt/Games".into()
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_defaults_use_local_app_data() {
        let mut environment = BTreeMap::new();
        environment.insert(
            OsString::from("LOCALAPPDATA"),
            OsString::from(r"C:\Users\matt\AppData\Local"),
        );
        environment.insert(
            OsString::from("USERPROFILE"),
            OsString::from(r"C:\Users\matt"),
        );

        let context = current_storage_context_from_environment(&environment)
            .expect("windows context should resolve");

        assert_eq!(StorageOperatingSystem::Windows, context.operating_system);
        assert_eq!(
            PathBuf::from(r"C:\Users\matt\AppData\Local")
                .join("Board Enthusiasts")
                .join("BE Home for Desktop")
                .join("tools"),
            PathBuf::from(
                build_managed_storage_settings(&context, &PersistedDesktopSettings::default(),)
                    .bdb_tools
                    .effective_path
            )
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_defaults_allow_case_insensitive_local_app_data_keys() {
        let mut environment = BTreeMap::new();
        environment.insert(
            OsString::from("LocalAppData"),
            OsString::from(r"C:\Users\matt\AppData\Local"),
        );
        environment.insert(
            OsString::from("UserProfile"),
            OsString::from(r"C:\Users\matt"),
        );

        let context = current_storage_context_from_environment(&environment)
            .expect("windows context should resolve");

        assert_eq!(StorageOperatingSystem::Windows, context.operating_system);
        assert_eq!(
            PathBuf::from(r"C:\Users\matt\AppData\Local")
                .join("Board Enthusiasts")
                .join("BE Home for Desktop")
                .join("tools"),
            PathBuf::from(
                build_managed_storage_settings(&context, &PersistedDesktopSettings::default(),)
                    .bdb_tools
                    .effective_path
            )
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_defaults_use_application_support() {
        let mut environment = BTreeMap::new();
        environment.insert(OsString::from("HOME"), OsString::from("/Users/matt"));

        let context = current_storage_context_from_environment(&environment)
            .expect("macos context should resolve");

        assert_eq!(StorageOperatingSystem::Macos, context.operating_system);
        assert_eq!(
            PathBuf::from("/Users/matt")
                .join("Library")
                .join("Application Support")
                .join("Board Enthusiasts")
                .join("BE Home for Desktop")
                .join("apk-library"),
            PathBuf::from(
                build_managed_storage_settings(&context, &PersistedDesktopSettings::default(),)
                    .apk_library
                    .effective_path
            )
        );
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    #[test]
    fn linux_defaults_use_local_share() {
        let mut environment = BTreeMap::new();
        environment.insert(OsString::from("HOME"), OsString::from("/home/matt"));

        let context = current_storage_context_from_environment(&environment)
            .expect("linux context should resolve");

        assert_eq!(StorageOperatingSystem::Linux, context.operating_system);
        assert_eq!(
            PathBuf::from("/home/matt")
                .join(".local")
                .join("share")
                .join("Board Enthusiasts")
                .join("BE Home for Desktop")
                .join("tools"),
            PathBuf::from(
                build_managed_storage_settings(&context, &PersistedDesktopSettings::default(),)
                    .bdb_tools
                    .effective_path
            )
        );
    }

    #[test]
    fn override_paths_must_be_absolute() {
        let result = normalize_override(Some("relative/path".into()));

        assert!(result.is_err());
    }

    #[test]
    fn scan_folder_paths_must_be_absolute() {
        let result = normalize_scan_folder_paths(vec!["relative/path".into()]);

        assert!(result.is_err());
    }

    #[test]
    fn round_tripped_overrides_preserve_effective_paths() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let context = sample_context(temp_directory.path());
        let persisted = PersistedDesktopSettings {
            bdb_tools_override: Some(sample_tools_override_path()),
            apk_library_override: Some(sample_apk_library_override_path()),
            board_connection_poll_interval_seconds: Some(30),
            scan_folder_paths: Some(vec![sample_scan_folder_path()]),
        };

        save_persisted_settings(&context.settings_file_path, &persisted)
            .expect("settings file should save");
        let loaded = load_persisted_settings(&context.settings_file_path)
            .expect("settings file should load");
        let settings = build_managed_storage_settings(&context, &loaded);

        assert_eq!(
            Some(sample_tools_override_path().as_str()),
            settings.bdb_tools.override_path.as_deref()
        );
        assert_eq!(
            sample_tools_override_path(),
            settings.bdb_tools.effective_path
        );
        assert_eq!(
            Some(sample_apk_library_override_path().as_str()),
            settings.apk_library.override_path.as_deref()
        );
        assert_eq!(
            sample_apk_library_override_path(),
            settings.apk_library.effective_path
        );
    }

    #[test]
    fn invalid_loaded_overrides_fall_back_to_defaults() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let context = sample_context(temp_directory.path());
        let persisted = PersistedDesktopSettings {
            bdb_tools_override: Some("relative/tools".into()),
            apk_library_override: Some(sample_apk_library_override_path()),
            board_connection_poll_interval_seconds: Some(12),
            scan_folder_paths: Some(vec!["relative/Downloads".into()]),
        };

        let settings = build_managed_storage_settings(&context, &persisted);

        assert_eq!(None, settings.bdb_tools.override_path);
        assert_eq!(
            context.app_data_root.join("tools"),
            PathBuf::from(settings.bdb_tools.effective_path)
        );
        assert_eq!(
            Some(sample_apk_library_override_path().as_str()),
            settings.apk_library.override_path.as_deref()
        );
    }

    #[test]
    fn desktop_settings_default_to_downloads_scan_folder() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let context = sample_context(temp_directory.path());
        let settings = build_desktop_settings(&context, &PersistedDesktopSettings::default());
        let expected_downloads_path = context
            .home_directory
            .as_ref()
            .expect("sample context should include a home directory")
            .join("Downloads")
            .to_string_lossy()
            .into_owned();

        assert_eq!(1, settings.scan_folders.len());
        assert_eq!(expected_downloads_path, settings.scan_folders[0].path);
        assert_eq!(
            "default",
            serde_json::to_value(&settings.scan_folders[0])
                .expect("scan folder should serialize")
                .get("source")
                .and_then(|value| value.as_str())
                .expect("source should serialize")
        );
        assert_eq!(DEFAULT_BOARD_CONNECTION_POLL_INTERVAL_SECONDS, settings.board_connection.poll_interval_seconds);
    }

    #[test]
    fn save_desktop_settings_persists_scan_folders_and_library_override() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let previous_home = std::env::var_os("HOME");
        let previous_local_app_data = std::env::var_os("LOCALAPPDATA");
        let previous_user_profile = std::env::var_os("USERPROFILE");

        if cfg!(target_os = "windows") {
            unsafe {
                std::env::set_var("LOCALAPPDATA", temp_directory.path().join("local-app-data"));
                std::env::set_var("USERPROFILE", temp_directory.path().join("home"));
            }
        } else {
            unsafe {
                std::env::set_var("HOME", temp_directory.path().join("home"));
            }
        }

        let result = save_desktop_settings(DesktopSettingsInput {
            apk_library_override: Some(sample_apk_library_override_path()),
            board_connection_poll_interval_seconds: Some(10),
            scan_folder_paths: vec![sample_scan_folder_path()],
        })
        .expect("desktop settings should save");

        restore_env(
            previous_home,
            previous_local_app_data,
            previous_user_profile,
        );

        assert_eq!(sample_scan_folder_path(), result.scan_folders[0].path);
        assert_eq!(
            Some(sample_apk_library_override_path().as_str()),
            result.apk_library.override_path.as_deref()
        );
        assert_eq!(10, result.board_connection.poll_interval_seconds);
        assert!(PathBuf::from(&result.settings_file_path).exists());
    }

    #[test]
    fn saving_managed_storage_keeps_existing_scan_folders() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let settings_file_path = temp_directory
            .path()
            .join("settings")
            .join("managed-storage.json");
        let previous_home = std::env::var_os("HOME");
        let previous_local_app_data = std::env::var_os("LOCALAPPDATA");
        let previous_user_profile = std::env::var_os("USERPROFILE");

        if cfg!(target_os = "windows") {
            unsafe {
                std::env::set_var("LOCALAPPDATA", temp_directory.path().join("local-app-data"));
                std::env::set_var("USERPROFILE", temp_directory.path().join("home"));
            }
        } else {
            unsafe {
                std::env::set_var("HOME", temp_directory.path().join("home"));
            }
        }

        save_persisted_settings(
            &settings_file_path,
            &PersistedDesktopSettings {
                bdb_tools_override: None,
                apk_library_override: None,
                board_connection_poll_interval_seconds: None,
                scan_folder_paths: Some(vec![sample_scan_folder_path()]),
            },
        )
        .expect("seed settings should save");

        let updated = save_managed_storage_settings(ManagedStorageOverridesInput {
            bdb_tools_override: Some(sample_tools_override_path()),
            apk_library_override: None,
        })
        .expect("managed storage settings should save");

        let loaded =
            load_persisted_settings(&settings_file_path).expect("updated settings should load");
        restore_env(
            previous_home,
            previous_local_app_data,
            previous_user_profile,
        );

        assert_eq!(
            Some(sample_tools_override_path().as_str()),
            updated.bdb_tools.override_path.as_deref()
        );
        assert_eq!(
            Some(vec![sample_scan_folder_path()]),
            loaded.scan_folder_paths
        );
    }

    fn sample_context(root: &Path) -> ManagedStorageContext {
        let home = if cfg!(target_os = "windows") {
            root.join("home")
        } else {
            PathBuf::from("/home/matt")
        };

        ManagedStorageContext {
            operating_system: StorageOperatingSystem::Linux,
            app_data_root: root.join("app-data"),
            settings_file_path: root.join("settings").join("managed-storage.json"),
            home_directory: Some(home),
        }
    }

    fn restore_env(
        previous_home: Option<OsString>,
        previous_local_app_data: Option<OsString>,
        previous_user_profile: Option<OsString>,
    ) {
        if cfg!(target_os = "windows") {
            unsafe {
                restore_var("LOCALAPPDATA", previous_local_app_data);
                restore_var("USERPROFILE", previous_user_profile);
            }
        } else {
            unsafe {
                restore_var("HOME", previous_home);
            }
        }
    }

    unsafe fn restore_var(key: &str, value: Option<OsString>) {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }
}
