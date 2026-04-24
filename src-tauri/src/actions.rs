use crate::{apk, bdb_tool, device};
use serde::Serialize;
use std::io;
use std::path::Path;
use std::process::Command;

const BDB_INSTALL_ARGUMENT: &str = "install";

/// Describes whether an install attempt completed successfully.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum InstallApkStatus {
    Installed,
    Failed,
}

/// Represents the install payload accepted by the desktop host.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallApkInput {
    apk_path: String,
}

/// Describes the player-facing result of one `bdb install` attempt.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallApkResult {
    pub(crate) status: InstallApkStatus,
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) detail: Option<String>,
    pub(crate) command: String,
    pub(crate) exit_code: Option<i32>,
}

#[derive(Clone, Debug)]
struct ProcessRunOutput {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProcessRunFailureKind {
    PermissionDenied,
    NotFound,
    Other,
}

#[derive(Clone, Debug)]
struct ProcessRunFailure {
    kind: ProcessRunFailureKind,
    detail: String,
}

trait ProcessRunner {
    fn run(
        &self,
        executable_path: &Path,
        args: &[&str],
    ) -> Result<ProcessRunOutput, ProcessRunFailure>;
}

struct CommandProcessRunner;

impl ProcessRunner for CommandProcessRunner {
    fn run(
        &self,
        executable_path: &Path,
        args: &[&str],
    ) -> Result<ProcessRunOutput, ProcessRunFailure> {
        let output = Command::new(executable_path)
            .args(args)
            .output()
            .map_err(classify_process_failure)?;

        Ok(ProcessRunOutput {
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// Install one APK onto the currently connected Board device.
pub(crate) fn install_apk_to_connected_board(
    input: InstallApkInput,
) -> Result<InstallApkResult, String> {
    let apk_path = apk::normalize_apk_path(&input.apk_path)?;
    let tool_state = bdb_tool::load_current_bdb_tool_state()?;
    let device_status = device::load_current_device_status_snapshot()?;

    Ok(install_apk_with_runner(
        &tool_state,
        &device_status,
        &apk_path,
        &CommandProcessRunner,
    ))
}

fn install_apk_with_runner<P: ProcessRunner>(
    tool_state: &bdb_tool::BdbToolState,
    device_status: &device::DeviceStatusSnapshot,
    apk_path: &Path,
    runner: &P,
) -> InstallApkResult {
    let apk_path_string = path_to_string(apk_path);
    let file_name = apk_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("that APK")
        .to_owned();
    let command = build_command_string(&tool_state.executable_path, &apk_path_string);

    if tool_state.status != bdb_tool::BdbToolStatus::Runnable {
        return blocked_install_result(
            &file_name,
            &command,
            None,
            tool_guidance_for_install(tool_state),
        );
    }

    if device_status.status != device::DeviceStatusKind::BoardConnected {
        return blocked_install_result(
            &file_name,
            &command,
            None,
            device_guidance_for_install(device_status),
        );
    }

    match runner.run(
        Path::new(&tool_state.executable_path),
        &[BDB_INSTALL_ARGUMENT, apk_path_string.as_str()],
    ) {
        Ok(output) => normalize_install_output(&file_name, command, output),
        Err(failure) => match failure.kind {
            ProcessRunFailureKind::PermissionDenied => InstallApkResult {
                status: InstallApkStatus::Failed,
                summary: format!(
                    "BE Home couldn't reopen Board's install tool to install {file_name}."
                ),
                guidance: "Repair bdb from settings, then try the install again.".into(),
                detail: Some(failure.detail),
                command,
                exit_code: None,
            },
            ProcessRunFailureKind::NotFound => InstallApkResult {
                status: InstallApkStatus::Failed,
                summary: format!(
                    "Board's install tool went missing before {file_name} could be installed."
                ),
                guidance: "Repair or re-download bdb from settings, then try again.".into(),
                detail: Some(failure.detail),
                command,
                exit_code: None,
            },
            ProcessRunFailureKind::Other => InstallApkResult {
                status: InstallApkStatus::Failed,
                summary: format!("BE Home couldn't finish installing {file_name} on Board yet."),
                guidance:
                    "Keep Board connected, then try the install again in a moment.".into(),
                detail: Some("The install command could not finish cleanly.".into()),
                command,
                exit_code: None,
            },
        },
    }
}

fn normalize_install_output(
    file_name: &str,
    command: String,
    output: ProcessRunOutput,
) -> InstallApkResult {
    if output.exit_code == Some(0) {
        return InstallApkResult {
            status: InstallApkStatus::Installed,
            summary: format!("BE Home installed {file_name} on Board."),
            guidance:
                "The device and installed-title views will refresh now so you can confirm the new install."
                    .into(),
            detail: first_non_empty_line(&combined_output_text(&output)),
            command,
            exit_code: output.exit_code,
        };
    }

    let combined_output = combined_output_text(&output);
    let normalized_output = combined_output.to_ascii_lowercase();
    let (guidance, detail) = if contains_any(
        &normalized_output,
        &["already exists", "already_exists", "already installed"],
    ) {
        (
            "Board says this app is already installed. You can open Installed on Board if you want to remove it first."
                .into(),
            Some("Board reported that the app is already present.".into()),
        )
    } else if contains_any(&normalized_output, &["not enough space", "insufficient storage", "no space"]) {
        (
            "Board says it does not have enough storage space for this install right now.".into(),
            Some("Free up space on Board, then try the install again.".into()),
        )
    } else if contains_any(&normalized_output, &["invalid", "corrupt", "parse", "manifest"]) {
        (
            "Board did not accept this APK as a valid install package.".into(),
            Some("Try another copy of the APK if you have one.".into()),
        )
    } else if contains_any(&normalized_output, &["signature", "downgrade"]) {
        (
            "Board rejected this install because it conflicts with the app version or signature already on the device."
                .into(),
            Some("Remove the current install first if you want to replace it with this build.".into()),
        )
    } else {
        (
            "Keep Board connected and make sure this APK is the build you meant to install, then try again."
                .into(),
            first_non_empty_line(&combined_output),
        )
    };

    InstallApkResult {
        status: InstallApkStatus::Failed,
        summary: format!("BE Home couldn't install {file_name} on Board yet."),
        guidance,
        detail,
        command,
        exit_code: output.exit_code,
    }
}

fn blocked_install_result(
    file_name: &str,
    command: &str,
    exit_code: Option<i32>,
    guidance: (&'static str, String, Option<String>),
) -> InstallApkResult {
    InstallApkResult {
        status: InstallApkStatus::Failed,
        summary: format!("BE Home couldn't start installing {file_name} yet."),
        guidance: guidance.1,
        detail: guidance.2.or_else(|| Some(guidance.0.into())),
        command: command.into(),
        exit_code,
    }
}

fn tool_guidance_for_install(
    tool_state: &bdb_tool::BdbToolState,
) -> (&'static str, String, Option<String>) {
    match tool_state.status {
        bdb_tool::BdbToolStatus::Unsupported => (
            "unsupported",
            "This computer is outside Board's current support for desktop installs.".into(),
            Some(tool_state.guidance.clone()),
        ),
        bdb_tool::BdbToolStatus::Missing => (
            "missing",
            "Download Board's install tool before trying to install an APK.".into(),
            Some(tool_state.guidance.clone()),
        ),
        bdb_tool::BdbToolStatus::Downloaded => (
            "repair",
            "Repair bdb from settings before trying this install again.".into(),
            Some(tool_state.guidance.clone()),
        ),
        bdb_tool::BdbToolStatus::Runnable => (
            "ready",
            "Board's install tool is ready.".into(),
            None,
        ),
    }
}

fn device_guidance_for_install(
    device_status: &device::DeviceStatusSnapshot,
) -> (&'static str, String, Option<String>) {
    match device_status.status {
        device::DeviceStatusKind::BoardDisconnected => (
            "disconnected",
            "Connect Board with USB, unlock it if needed, then try the install again.".into(),
            Some(device_status.guidance.clone()),
        ),
        device::DeviceStatusKind::ExecutionError => (
            "retry",
            "Refresh the Board connection check before trying this install again.".into(),
            Some(device_status.guidance.clone()),
        ),
        device::DeviceStatusKind::ToolBroken => (
            "repair",
            "Repair bdb from settings before trying this install again.".into(),
            Some(device_status.guidance.clone()),
        ),
        device::DeviceStatusKind::ToolMissing => (
            "missing",
            "Download Board's install tool before trying this install.".into(),
            Some(device_status.guidance.clone()),
        ),
        device::DeviceStatusKind::UnsupportedHost => (
            "unsupported",
            "This computer is outside Board's current support for desktop installs.".into(),
            Some(device_status.guidance.clone()),
        ),
        device::DeviceStatusKind::BoardConnected => (
            "ready",
            "Board is connected.".into(),
            None,
        ),
    }
}

fn combined_output_text(output: &ProcessRunOutput) -> String {
    [output.stdout.trim(), output.stderr.trim()]
        .into_iter()
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn first_non_empty_line(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned)
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn build_command_string(executable_path: &str, apk_path: &str) -> String {
    format!("{executable_path} {BDB_INSTALL_ARGUMENT} {apk_path}")
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn classify_process_failure(error: io::Error) -> ProcessRunFailure {
    let kind = match error.kind() {
        io::ErrorKind::PermissionDenied => ProcessRunFailureKind::PermissionDenied,
        io::ErrorKind::NotFound => ProcessRunFailureKind::NotFound,
        _ => ProcessRunFailureKind::Other,
    };

    ProcessRunFailure {
        kind,
        detail: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        install_apk_with_runner, InstallApkStatus, ProcessRunFailure, ProcessRunFailureKind,
        ProcessRunOutput, ProcessRunner,
    };
    use crate::{bdb, bdb_tool, device, storage};
    use std::path::Path;

    struct MockProcessRunner {
        outcome: Result<ProcessRunOutput, ProcessRunFailure>,
    }

    impl ProcessRunner for MockProcessRunner {
        fn run(
            &self,
            _executable_path: &Path,
            _args: &[&str],
        ) -> Result<ProcessRunOutput, ProcessRunFailure> {
            self.outcome.clone()
        }
    }

    #[test]
    fn install_requires_a_connected_board() {
        let result = install_apk_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardDisconnected),
            sample_apk_path(),
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(InstallApkStatus::Failed, result.status);
        assert!(result.guidance.contains("Connect Board"));
    }

    #[test]
    fn install_succeeds_when_bdb_returns_zero() {
        let result = install_apk_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            sample_apk_path(),
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Installed fun.board.luckydice".into(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(InstallApkStatus::Installed, result.status);
        assert!(result.summary.contains("LuckyDice.apk"));
    }

    #[test]
    fn install_maps_already_installed_output_to_guidance() {
        let result = install_apk_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            sample_apk_path(),
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(1),
                    stdout: "INSTALL_FAILED_ALREADY_EXISTS".into(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(InstallApkStatus::Failed, result.status);
        assert!(result.guidance.contains("already installed"));
    }

    #[test]
    fn install_maps_permission_failures_to_repair_guidance() {
        let result = install_apk_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            sample_apk_path(),
            &MockProcessRunner {
                outcome: Err(ProcessRunFailure {
                    kind: ProcessRunFailureKind::PermissionDenied,
                    detail: "Access is denied.".into(),
                }),
            },
        );

        assert_eq!(InstallApkStatus::Failed, result.status);
        assert!(result.guidance.contains("Repair bdb"));
    }

    #[test]
    fn install_is_blocked_when_tool_is_not_runnable() {
        let mut tool_state = sample_runnable_tool_state();
        tool_state.status = bdb_tool::BdbToolStatus::Downloaded;

        let result = install_apk_with_runner(
            &tool_state,
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            sample_apk_path(),
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(InstallApkStatus::Failed, result.status);
        assert!(result.guidance.contains("Repair bdb"));
    }

    fn sample_apk_path() -> &'static Path {
        if cfg!(target_os = "windows") {
            Path::new(r"C:\Users\matt\Downloads\LuckyDice.apk")
        } else {
            Path::new("/home/matt/Downloads/LuckyDice.apk")
        }
    }

    fn sample_runnable_tool_state() -> bdb_tool::BdbToolState {
        bdb_tool::BdbToolState {
            status: bdb_tool::BdbToolStatus::Runnable,
            summary: "Board's install tool is ready to use.".into(),
            guidance: "You can use the managed bdb copy now.".into(),
            executable_path: if cfg!(target_os = "windows") {
                r"C:\Users\matt\AppData\Local\Board Enthusiasts\BE Home for Desktop\tools\bdb.exe"
                    .into()
            } else {
                "/home/matt/.local/share/Board Enthusiasts/BE Home for Desktop/tools/bdb".into()
            },
            executable_exists: true,
            storage: storage::ManagedStorageLocation {
                default_path: sample_tools_path(),
                override_path: None,
                effective_path: sample_tools_path(),
                source: storage::ManagedStoragePathSource::Default,
            },
            source_plan: bdb::BdbSourcePlan {
                manifest_source: "bundled".into(),
                remote_manifest_url: "https://example.com/bdb-sources.json".into(),
                manifest_cache_path: None,
                manifest_schema_version: 1,
                support: bdb::BdbPlatformSupport {
                    status: bdb::BdbSupportStatus::Supported,
                    operating_system: bdb::BdbOperatingSystem::Windows,
                    architecture: bdb::BdbArchitecture::X86_64,
                    windows_build: Some(26100),
                    platform_key: Some("windows-x86_64".into()),
                    reason: None,
                    guidance: "This machine matches a Board-published bdb target.".into(),
                },
                source: Some(bdb::BdbDownloadSource {
                    platform_key: "windows-x86_64".into(),
                    download_url: "https://example.com/bdb.exe".into(),
                }),
            },
            validation: bdb_tool::BdbRunnableValidation {
                status: bdb_tool::BdbRunnableStatus::Runnable,
                command: "bdb help".into(),
                exit_code: Some(0),
                summary: "BE Home could open bdb from its managed tools folder.".into(),
                detail: None,
            },
        }
    }

    fn sample_device_status(status: device::DeviceStatusKind) -> device::DeviceStatusSnapshot {
        device::DeviceStatusSnapshot {
            status,
            summary: "Board connection looks ready.".into(),
            guidance: "Refresh the connection when you need to.".into(),
            detail: None,
            poll_interval_ms: 5_000,
            bdb_version: device::BdbVersionDetails {
                status: device::BdbVersionStatus::Available,
                command: "bdb version".into(),
                value: Some("bdb 0.2.0".into()),
                exit_code: Some(0),
                summary: "BE Home is using `bdb 0.2.0`.".into(),
                detail: None,
            },
        }
    }

    fn sample_tools_path() -> String {
        if cfg!(target_os = "windows") {
            r"C:\Users\matt\AppData\Local\Board Enthusiasts\BE Home for Desktop\tools".into()
        } else {
            "/home/matt/.local/share/Board Enthusiasts/BE Home for Desktop/tools".into()
        }
    }
}
