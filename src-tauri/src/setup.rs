use crate::{bdb_tool, storage};
use serde::Serialize;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::PathBuf;

const APP_NAME: &str = "BE Home for Desktop";
const DOWNLOADS_DIRECTORY_NAME: &str = "Downloads";

/// Describes whether the app must keep the player inside setup before opening the workspace.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SetupGateStatus {
    RequiresSetup,
    Ready,
    Unsupported,
}

/// Describes the setup step that should be active based on current host state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SetupRequiredStep {
    SystemCheck,
    ToolSetup,
    Workspace,
}

/// Describes the stable setup-gate contract returned by the desktop host.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupGateState {
    pub(crate) app_name: String,
    pub(crate) version: String,
    pub(crate) platform_label: String,
    pub(crate) status: SetupGateStatus,
    pub(crate) required_step: SetupRequiredStep,
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) tool_state: bdb_tool::BdbToolState,
    pub(crate) storage: storage::ManagedStorageSettings,
    pub(crate) default_scan_folders: Vec<String>,
}

/// Load the current setup-gate state used to decide whether the app can open the workspace.
pub(crate) fn load_setup_gate_state() -> Result<SetupGateState, String> {
    let storage = storage::load_managed_storage_settings()?;
    let tool_state = bdb_tool::load_current_bdb_tool_state()?;

    Ok(build_setup_gate_state(
        tool_state,
        storage,
        resolve_default_scan_folders(),
    ))
}

fn build_setup_gate_state(
    tool_state: bdb_tool::BdbToolState,
    storage: storage::ManagedStorageSettings,
    default_scan_folders: Vec<String>,
) -> SetupGateState {
    let (status, required_step, summary, guidance) = match tool_state.status {
        bdb_tool::BdbToolStatus::Unsupported => (
            SetupGateStatus::Unsupported,
            SetupRequiredStep::SystemCheck,
            "This computer cannot complete the Board install-tool setup yet.".into(),
            tool_state.guidance.clone(),
        ),
        bdb_tool::BdbToolStatus::Runnable => (
            SetupGateStatus::Ready,
            SetupRequiredStep::Workspace,
            "Board's install tool is ready, so BE Home can open your desktop workspace."
                .into(),
            "You can come back to repair the install tool later if anything changes.".into(),
        ),
        bdb_tool::BdbToolStatus::Missing => (
            SetupGateStatus::RequiresSetup,
            SetupRequiredStep::ToolSetup,
            "BE Home still needs to download Board's install tool before the workspace can open."
                .into(),
            tool_state.guidance.clone(),
        ),
        bdb_tool::BdbToolStatus::Downloaded => (
            SetupGateStatus::RequiresSetup,
            SetupRequiredStep::ToolSetup,
            "BE Home found Board's install tool, but it still needs attention before installs can start."
                .into(),
            tool_state.guidance.clone(),
        ),
    };

    SetupGateState {
        app_name: APP_NAME.into(),
        version: env!("CARGO_PKG_VERSION").into(),
        platform_label: current_platform_label().into(),
        status,
        required_step,
        summary,
        guidance,
        tool_state,
        storage,
        default_scan_folders,
    }
}

fn resolve_default_scan_folders() -> Vec<String> {
    resolve_default_scan_folders_from_environment(&std::env::vars_os().collect::<BTreeMap<_, _>>())
}

fn resolve_default_scan_folders_from_environment(
    environment: &BTreeMap<OsString, OsString>,
) -> Vec<String> {
    let mut folders = Vec::new();
    if let Some(home_directory) = resolve_home_directory(environment) {
        folders.push(
            home_directory
                .join(DOWNLOADS_DIRECTORY_NAME)
                .to_string_lossy()
                .into_owned(),
        );
    }

    folders
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

fn current_platform_label() -> &'static str {
    if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        "Unsupported desktop platform"
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_setup_gate_state, resolve_default_scan_folders_from_environment, SetupGateStatus,
        SetupRequiredStep,
    };
    use crate::{
        bdb::{
            BdbArchitecture, BdbDownloadSource, BdbOperatingSystem, BdbPlatformSupport,
            BdbSourcePlan, BdbSupportStatus,
        },
        bdb_tool::{BdbRunnableStatus, BdbRunnableValidation, BdbToolState, BdbToolStatus},
        storage::{
            ManagedStorageLocation, ManagedStoragePathSource, ManagedStorageSettings,
            StorageOperatingSystem,
        },
    };
    use std::collections::BTreeMap;
    use std::ffi::OsString;

    #[test]
    fn missing_tool_requires_setup_download_step() {
        let state = build_setup_gate_state(
            sample_tool_state(BdbToolStatus::Missing, BdbRunnableStatus::Missing),
            sample_storage_settings(),
            vec!["/tmp/Downloads".into()],
        );

        assert_eq!(SetupGateStatus::RequiresSetup, state.status);
        assert_eq!(SetupRequiredStep::ToolSetup, state.required_step);
    }

    #[test]
    fn runnable_tool_opens_the_workspace() {
        let state = build_setup_gate_state(
            sample_tool_state(BdbToolStatus::Runnable, BdbRunnableStatus::Runnable),
            sample_storage_settings(),
            vec!["/tmp/Downloads".into()],
        );

        assert_eq!(SetupGateStatus::Ready, state.status);
        assert_eq!(SetupRequiredStep::Workspace, state.required_step);
    }

    #[test]
    fn unsupported_host_stays_in_system_check() {
        let state = build_setup_gate_state(
            sample_tool_state(BdbToolStatus::Unsupported, BdbRunnableStatus::Unsupported),
            sample_storage_settings(),
            Vec::new(),
        );

        assert_eq!(SetupGateStatus::Unsupported, state.status);
        assert_eq!(SetupRequiredStep::SystemCheck, state.required_step);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_scan_folder_defaults_use_user_profile() {
        let mut environment = BTreeMap::new();
        environment.insert(
            OsString::from("USERPROFILE"),
            OsString::from(r"C:\Users\matt"),
        );

        let folders = resolve_default_scan_folders_from_environment(&environment);

        assert_eq!(vec![r"C:\Users\matt\Downloads".to_string()], folders);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn unix_scan_folder_defaults_use_home_downloads() {
        let mut environment = BTreeMap::new();
        environment.insert(OsString::from("HOME"), OsString::from("/home/matt"));

        let folders = resolve_default_scan_folders_from_environment(&environment);

        assert_eq!(vec!["/home/matt/Downloads".to_string()], folders);
    }

    fn sample_tool_state(
        status: BdbToolStatus,
        runnable_status: BdbRunnableStatus,
    ) -> BdbToolState {
        BdbToolState {
            status,
            summary: "sample summary".into(),
            guidance: "sample guidance".into(),
            executable_path: "/tmp/bdb".into(),
            executable_exists: matches!(
                status,
                BdbToolStatus::Downloaded | BdbToolStatus::Runnable
            ),
            storage: ManagedStorageLocation {
                default_path: "/tmp/tools".into(),
                override_path: None,
                effective_path: "/tmp/tools".into(),
                source: ManagedStoragePathSource::Default,
            },
            source_plan: BdbSourcePlan {
                manifest_source: "bundled".into(),
                remote_manifest_url: "https://example.com/bdb-sources.json".into(),
                manifest_cache_path: None,
                manifest_schema_version: 1,
                support: BdbPlatformSupport {
                    status: BdbSupportStatus::Supported,
                    operating_system: BdbOperatingSystem::Linux,
                    architecture: BdbArchitecture::X86_64,
                    windows_build: None,
                    platform_key: Some("linux-x86_64".into()),
                    reason: None,
                    guidance: "This machine matches a Board-published bdb target.".into(),
                },
                source: Some(BdbDownloadSource {
                    platform_key: "linux-x86_64".into(),
                    download_url: "https://example.com/bdb".into(),
                }),
            },
            validation: BdbRunnableValidation {
                status: runnable_status,
                command: "/tmp/bdb help".into(),
                exit_code: Some(0),
                summary: "validation summary".into(),
                detail: None,
            },
        }
    }

    fn sample_storage_settings() -> ManagedStorageSettings {
        ManagedStorageSettings {
            operating_system: StorageOperatingSystem::Linux,
            settings_file_path: "/tmp/settings/managed-storage.json".into(),
            bdb_tools: ManagedStorageLocation {
                default_path: "/tmp/tools".into(),
                override_path: None,
                effective_path: "/tmp/tools".into(),
                source: ManagedStoragePathSource::Default,
            },
            apk_library: ManagedStorageLocation {
                default_path: "/tmp/apk-library".into(),
                override_path: None,
                effective_path: "/tmp/apk-library".into(),
                source: ManagedStoragePathSource::Default,
            },
        }
    }
}
