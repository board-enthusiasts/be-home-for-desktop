use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

const APP_VENDOR_DIRECTORY: &str = "Board Enthusiasts";
const APP_PRODUCT_DIRECTORY: &str = "BE Home for Desktop";
const APK_LIBRARY_DIRECTORY: &str = "apk-library";
const SETTINGS_DIRECTORY: &str = "settings";
const STORAGE_SETTINGS_FILE_NAME: &str = "managed-storage.json";
const TOOLS_DIRECTORY: &str = "tools";

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

/// Describes one managed storage location and how its current path was chosen.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedStorageLocation {
    pub(crate) default_path: String,
    pub(crate) override_path: Option<String>,
    pub(crate) effective_path: String,
    pub(crate) source: ManagedStoragePathSource,
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

/// Represents the persisted override payload accepted by the desktop host.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedStorageOverridesInput {
    bdb_tools_override: Option<String>,
    apk_library_override: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedManagedStorageOverrides {
    bdb_tools_override: Option<String>,
    apk_library_override: Option<String>,
}

#[derive(Clone, Debug)]
struct ManagedStorageContext {
    operating_system: StorageOperatingSystem,
    app_data_root: PathBuf,
    settings_file_path: PathBuf,
}

/// Load the current managed storage settings for the desktop app.
pub(crate) fn load_managed_storage_settings() -> Result<ManagedStorageSettings, String> {
    let context = current_storage_context()?;
    let persisted = load_persisted_overrides(&context.settings_file_path)?;
    Ok(build_managed_storage_settings(&context, &persisted))
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
    let persisted = PersistedManagedStorageOverrides {
        bdb_tools_override: normalize_override(input.bdb_tools_override)?,
        apk_library_override: normalize_override(input.apk_library_override)?,
    };

    save_persisted_overrides(&context.settings_file_path, &persisted)?;
    Ok(build_managed_storage_settings(&context, &persisted))
}

fn build_managed_storage_settings(
    context: &ManagedStorageContext,
    persisted: &PersistedManagedStorageOverrides,
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

fn normalize_loaded_override(value: Option<&str>) -> Option<String> {
    normalize_override(value.map(str::to_owned)).ok().flatten()
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

fn load_persisted_overrides(
    settings_file_path: &Path,
) -> Result<PersistedManagedStorageOverrides, String> {
    if !settings_file_path.exists() {
        return Ok(PersistedManagedStorageOverrides::default());
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

fn save_persisted_overrides(
    settings_file_path: &Path,
    overrides: &PersistedManagedStorageOverrides,
) -> Result<(), String> {
    if let Some(parent) = settings_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "The desktop app could not create the managed storage settings directory at `{}`: {error}",
                parent.display()
            )
        })?;
    }

    let content = serde_json::to_string_pretty(overrides)
        .expect("managed storage overrides should serialize");
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

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        build_managed_storage_settings, current_storage_context_from_environment,
        load_persisted_overrides, normalize_override, save_persisted_overrides,
        ManagedStorageContext, PersistedManagedStorageOverrides, StorageOperatingSystem,
    };
    use std::collections::BTreeMap;
    use std::ffi::OsString;
    use std::path::PathBuf;

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

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_defaults_use_local_app_data() {
        let mut environment = BTreeMap::new();
        environment.insert(
            OsString::from("LOCALAPPDATA"),
            OsString::from(r"C:\Users\matt\AppData\Local"),
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
                build_managed_storage_settings(
                    &context,
                    &PersistedManagedStorageOverrides::default(),
                )
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

        let context = current_storage_context_from_environment(&environment)
            .expect("windows context should resolve");

        assert_eq!(StorageOperatingSystem::Windows, context.operating_system);
        assert_eq!(
            PathBuf::from(r"C:\Users\matt\AppData\Local")
                .join("Board Enthusiasts")
                .join("BE Home for Desktop")
                .join("tools"),
            PathBuf::from(
                build_managed_storage_settings(
                    &context,
                    &PersistedManagedStorageOverrides::default(),
                )
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
                build_managed_storage_settings(
                    &context,
                    &PersistedManagedStorageOverrides::default(),
                )
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
                build_managed_storage_settings(
                    &context,
                    &PersistedManagedStorageOverrides::default(),
                )
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
    fn round_tripped_overrides_preserve_effective_paths() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let context = ManagedStorageContext {
            operating_system: StorageOperatingSystem::Linux,
            app_data_root: temp_directory.path().join("app-data"),
            settings_file_path: temp_directory
                .path()
                .join("settings")
                .join("managed-storage.json"),
        };
        let overrides = PersistedManagedStorageOverrides {
            bdb_tools_override: Some(sample_tools_override_path()),
            apk_library_override: Some(sample_apk_library_override_path()),
        };

        save_persisted_overrides(&context.settings_file_path, &overrides)
            .expect("settings file should save");
        let loaded = load_persisted_overrides(&context.settings_file_path)
            .expect("settings file should load");
        let settings = build_managed_storage_settings(&context, &loaded);

        assert_eq!(
            Some(sample_tools_override_path().as_str()),
            settings.bdb_tools.override_path.as_deref()
        );
        assert_eq!(sample_tools_override_path(), settings.bdb_tools.effective_path);
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
        let context = ManagedStorageContext {
            operating_system: StorageOperatingSystem::Linux,
            app_data_root: temp_directory.path().join("app-data"),
            settings_file_path: temp_directory
                .path()
                .join("settings")
                .join("managed-storage.json"),
        };
        let persisted = PersistedManagedStorageOverrides {
            bdb_tools_override: Some("relative/tools".into()),
            apk_library_override: Some(sample_apk_library_override_path()),
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
}
