use crate::bdb_tool;
use serde::Serialize;
use std::io;
use std::path::Path;
use std::process::Command;

const BDB_STATUS_ARGUMENT: &str = "status";
const BDB_VERSION_ARGUMENT: &str = "version";
const DEVICE_STATUS_POLL_INTERVAL_MS: u32 = 5_000;

/// Describes the normalized connection state that the device workspace can consume.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DeviceStatusKind {
    ToolMissing,
    ToolBroken,
    UnsupportedHost,
    BoardDisconnected,
    BoardConnected,
    ExecutionError,
}

/// Describes whether BE Home could read a friendly `bdb version` string.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BdbVersionStatus {
    Available,
    Unavailable,
}

/// Describes the latest `bdb version` check for the current session.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbVersionDetails {
    pub(crate) status: BdbVersionStatus,
    pub(crate) command: String,
    pub(crate) value: Option<String>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) summary: String,
    pub(crate) detail: Option<String>,
}

/// Describes the current Board connection state and related `bdb` diagnostics.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceStatusSnapshot {
    pub(crate) status: DeviceStatusKind,
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) detail: Option<String>,
    pub(crate) poll_interval_ms: u32,
    pub(crate) bdb_version: BdbVersionDetails,
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

/// Load the current device-status snapshot for the managed `bdb` session.
pub(crate) fn load_current_device_status_snapshot() -> Result<DeviceStatusSnapshot, String> {
    let tool_state = bdb_tool::load_current_bdb_tool_state()?;
    Ok(load_device_status_snapshot_with_runner(
        &tool_state,
        &CommandProcessRunner,
    ))
}

fn load_device_status_snapshot_with_runner<P: ProcessRunner>(
    tool_state: &bdb_tool::BdbToolState,
    runner: &P,
) -> DeviceStatusSnapshot {
    match tool_state.status {
        bdb_tool::BdbToolStatus::Unsupported => DeviceStatusSnapshot {
            status: DeviceStatusKind::UnsupportedHost,
            summary: "This computer is outside Board's current support for the desktop install tool."
                .into(),
            guidance: tool_state.guidance.clone(),
            detail: None,
            poll_interval_ms: DEVICE_STATUS_POLL_INTERVAL_MS,
            bdb_version: unavailable_version_details(&tool_state.executable_path, tool_state.summary.clone()),
        },
        bdb_tool::BdbToolStatus::Missing => DeviceStatusSnapshot {
            status: DeviceStatusKind::ToolMissing,
            summary: "Board's install tool still needs to be downloaded before device checks can start."
                .into(),
            guidance: tool_state.guidance.clone(),
            detail: None,
            poll_interval_ms: DEVICE_STATUS_POLL_INTERVAL_MS,
            bdb_version: unavailable_version_details(
                &tool_state.executable_path,
                "BE Home has not downloaded bdb yet.".into(),
            ),
        },
        bdb_tool::BdbToolStatus::Downloaded => DeviceStatusSnapshot {
            status: DeviceStatusKind::ToolBroken,
            summary: "BE Home found the Board install tool, but this computer is not letting it run cleanly yet."
                .into(),
            guidance: tool_state.guidance.clone(),
            detail: Some("Choose repair in settings to fetch a fresh copy of bdb.".into()),
            poll_interval_ms: DEVICE_STATUS_POLL_INTERVAL_MS,
            bdb_version: unavailable_version_details(
                &tool_state.executable_path,
                "BE Home could not trust the stored bdb copy enough to read its version.".into(),
            ),
        },
        bdb_tool::BdbToolStatus::Runnable => inspect_runnable_device_status(tool_state, runner),
    }
}

fn inspect_runnable_device_status<P: ProcessRunner>(
    tool_state: &bdb_tool::BdbToolState,
    runner: &P,
) -> DeviceStatusSnapshot {
    let executable_path = Path::new(&tool_state.executable_path);
    let version = load_bdb_version(executable_path, runner);
    let status_command = build_command_string(&tool_state.executable_path, BDB_STATUS_ARGUMENT);

    match runner.run(executable_path, &[BDB_STATUS_ARGUMENT]) {
        Ok(output) => normalize_status_output(output, version),
        Err(failure) => {
            let (status, summary, guidance, detail) = match failure.kind {
                ProcessRunFailureKind::PermissionDenied => (
                    DeviceStatusKind::ToolBroken,
                    "BE Home could not reopen Board's install tool for the latest device check."
                        .into(),
                    "Choose repair in settings to fetch a fresh copy of bdb, then try again.".into(),
                    Some(failure.detail),
                ),
                ProcessRunFailureKind::NotFound => (
                    DeviceStatusKind::ToolMissing,
                    "The managed Board install tool was no longer available when BE Home checked for your device."
                        .into(),
                    "Download or repair bdb again, then refresh the device check.".into(),
                    Some(failure.detail),
                ),
                ProcessRunFailureKind::Other => (
                    DeviceStatusKind::ExecutionError,
                    "BE Home could not finish the latest Board connection check.".into(),
                    "Keep Board connected, close anything else using bdb, then refresh the device check.".into(),
                    Some(format!("The last check attempted `{status_command}`.")),
                ),
            };

            DeviceStatusSnapshot {
                status,
                summary,
                guidance,
                detail,
                poll_interval_ms: DEVICE_STATUS_POLL_INTERVAL_MS,
                bdb_version: version,
            }
        }
    }
}

fn normalize_status_output(
    output: ProcessRunOutput,
    version: BdbVersionDetails,
) -> DeviceStatusSnapshot {
    let combined_text = combined_output_text(&output);
    let normalized_text = combined_text.to_ascii_lowercase();

    let (status, summary, guidance, detail) = if contains_any(
        &normalized_text,
        &[
            "not connected",
            "no device",
            "device not found",
            "waiting for device",
            "disconnected",
        ],
    ) {
        (
            DeviceStatusKind::BoardDisconnected,
            "Board is not connected yet.".into(),
            "Connect your Board with USB, unlock it if needed, then choose refresh.".into(),
            Some(
                "Once Board is connected, BE Home will keep install and inventory actions close by."
                    .into(),
            ),
        )
    } else if output.exit_code == Some(0)
        || contains_any(&normalized_text, &["connected", "ready"])
    {
        (
            DeviceStatusKind::BoardConnected,
            "Board connection looks ready.".into(),
            "You can keep using the desktop workspace while BE Home refreshes the connection in the background.".into(),
            first_non_empty_line(&combined_text)
                .filter(|line| !line.eq_ignore_ascii_case("connected"))
                .filter(|line| !line.eq_ignore_ascii_case("ready")),
        )
    } else {
        (
            DeviceStatusKind::ExecutionError,
            "BE Home could not turn the latest Board response into a reliable ready state.".into(),
            "Refresh the connection check. If this keeps happening, reconnect Board and try again.".into(),
            first_non_empty_line(&combined_text)
                .map(|_| "The last bdb status response did not look like a normal connected or disconnected state.".into()),
        )
    };

    DeviceStatusSnapshot {
        status,
        summary,
        guidance,
        detail,
        poll_interval_ms: DEVICE_STATUS_POLL_INTERVAL_MS,
        bdb_version: version,
    }
}

fn load_bdb_version<P: ProcessRunner>(
    executable_path: &Path,
    runner: &P,
) -> BdbVersionDetails {
    let command = build_command_string(&path_to_string(executable_path), BDB_VERSION_ARGUMENT);

    match runner.run(executable_path, &[BDB_VERSION_ARGUMENT]) {
        Ok(output) => {
            let version_value = first_non_empty_line(&combined_output_text(&output));
            match version_value {
                Some(version_value) => BdbVersionDetails {
                    status: BdbVersionStatus::Available,
                    command,
                    value: Some(version_value.clone()),
                    exit_code: output.exit_code,
                    summary: format!("BE Home is using `{version_value}`."),
                    detail: None,
                },
                None => BdbVersionDetails {
                    status: BdbVersionStatus::Unavailable,
                    command,
                    value: None,
                    exit_code: output.exit_code,
                    summary: "BE Home could not read a friendly version string from bdb.".into(),
                    detail: Some(
                        "The tool opened, but it did not return a readable version line.".into(),
                    ),
                },
            }
        }
        Err(failure) => BdbVersionDetails {
            status: BdbVersionStatus::Unavailable,
            command,
            value: None,
            exit_code: None,
            summary: "BE Home could not confirm which bdb version is loaded right now.".into(),
            detail: Some(failure.detail),
        },
    }
}

fn unavailable_version_details(executable_path: &str, summary: String) -> BdbVersionDetails {
    BdbVersionDetails {
        status: BdbVersionStatus::Unavailable,
        command: build_command_string(executable_path, BDB_VERSION_ARGUMENT),
        value: None,
        exit_code: None,
        summary,
        detail: None,
    }
}

fn combined_output_text(output: &ProcessRunOutput) -> String {
    [output.stdout.trim(), output.stderr.trim()]
        .into_iter()
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn contains_any(value: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|candidate| value.contains(candidate))
}

fn first_non_empty_line(value: &str) -> Option<String> {
    value.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned)
}

fn classify_process_failure(error: io::Error) -> ProcessRunFailure {
    let detail = error.to_string();
    let kind = match error.kind() {
        io::ErrorKind::PermissionDenied => ProcessRunFailureKind::PermissionDenied,
        io::ErrorKind::NotFound => ProcessRunFailureKind::NotFound,
        _ => ProcessRunFailureKind::Other,
    };

    ProcessRunFailure { kind, detail }
}

fn build_command_string(executable_path: &str, argument: &str) -> String {
    format!("{executable_path} {argument}")
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        load_device_status_snapshot_with_runner, BdbVersionStatus, DeviceStatusKind,
        DeviceStatusSnapshot, ProcessRunFailure, ProcessRunFailureKind, ProcessRunOutput,
        ProcessRunner,
    };
    use crate::{
        bdb::{
            BdbArchitecture, BdbDownloadSource, BdbOperatingSystem, BdbPlatformSupport,
            BdbSourcePlan, BdbSupportStatus,
        },
        bdb_tool::{BdbRunnableStatus, BdbRunnableValidation, BdbToolState, BdbToolStatus},
        storage::{ManagedStorageLocation, ManagedStoragePathSource},
    };
    use std::path::Path;

    struct StaticRunner {
        version: Result<ProcessRunOutput, ProcessRunFailure>,
        status: Result<ProcessRunOutput, ProcessRunFailure>,
    }

    impl ProcessRunner for StaticRunner {
        fn run(
            &self,
            _executable_path: &Path,
            args: &[&str],
        ) -> Result<ProcessRunOutput, ProcessRunFailure> {
            match args.first().copied() {
                Some("version") => self.version.clone(),
                Some("status") => self.status.clone(),
                _ => panic!("unexpected command arguments: {args:?}"),
            }
        }
    }

    #[test]
    fn missing_tool_skips_runtime_commands() {
        let snapshot = load_device_status_snapshot_with_runner(
            &sample_tool_state(BdbToolStatus::Missing, BdbRunnableStatus::Missing),
            &StaticRunner {
                version: Err(ProcessRunFailure {
                    kind: ProcessRunFailureKind::Other,
                    detail: "should not be called".into(),
                }),
                status: Err(ProcessRunFailure {
                    kind: ProcessRunFailureKind::Other,
                    detail: "should not be called".into(),
                }),
            },
        );

        assert_eq!(DeviceStatusKind::ToolMissing, snapshot.status);
        assert_eq!(BdbVersionStatus::Unavailable, snapshot.bdb_version.status);
    }

    #[test]
    fn connected_status_surfaces_a_ready_snapshot_and_version() {
        let snapshot = runnable_snapshot_with_runner(StaticRunner {
            version: Ok(ProcessRunOutput {
                exit_code: Some(0),
                stdout: "bdb 0.19.0".into(),
                stderr: String::new(),
            }),
            status: Ok(ProcessRunOutput {
                exit_code: Some(0),
                stdout: "Board connected and ready.".into(),
                stderr: String::new(),
            }),
        });

        assert_eq!(DeviceStatusKind::BoardConnected, snapshot.status);
        assert_eq!(Some("bdb 0.19.0"), snapshot.bdb_version.value.as_deref());
    }

    #[test]
    fn disconnected_markers_map_to_board_disconnected() {
        let snapshot = runnable_snapshot_with_runner(StaticRunner {
            version: Ok(ProcessRunOutput {
                exit_code: Some(0),
                stdout: "bdb 0.19.0".into(),
                stderr: String::new(),
            }),
            status: Ok(ProcessRunOutput {
                exit_code: Some(1),
                stdout: "Board not connected. Connect via USB and try again.".into(),
                stderr: String::new(),
            }),
        });

        assert_eq!(DeviceStatusKind::BoardDisconnected, snapshot.status);
        assert_eq!(
            "Connect your Board with USB, unlock it if needed, then choose refresh.",
            snapshot.guidance
        );
    }

    #[test]
    fn permission_denied_during_status_is_treated_as_a_broken_tool_state() {
        let snapshot = runnable_snapshot_with_runner(StaticRunner {
            version: Ok(ProcessRunOutput {
                exit_code: Some(0),
                stdout: "bdb 0.19.0".into(),
                stderr: String::new(),
            }),
            status: Err(ProcessRunFailure {
                kind: ProcessRunFailureKind::PermissionDenied,
                detail: "Access is denied".into(),
            }),
        });

        assert_eq!(DeviceStatusKind::ToolBroken, snapshot.status);
        assert_eq!(Some("Access is denied"), snapshot.detail.as_deref());
    }

    #[test]
    fn unexpected_status_output_becomes_execution_error() {
        let snapshot = runnable_snapshot_with_runner(StaticRunner {
            version: Ok(ProcessRunOutput {
                exit_code: Some(0),
                stdout: "bdb 0.19.0".into(),
                stderr: String::new(),
            }),
            status: Ok(ProcessRunOutput {
                exit_code: Some(2),
                stdout: "rpc handshake failed".into(),
                stderr: String::new(),
            }),
        });

        assert_eq!(DeviceStatusKind::ExecutionError, snapshot.status);
        assert!(snapshot.guidance.contains("Refresh the connection check"));
    }

    fn runnable_snapshot_with_runner(runner: StaticRunner) -> DeviceStatusSnapshot {
        load_device_status_snapshot_with_runner(
            &sample_tool_state(BdbToolStatus::Runnable, BdbRunnableStatus::Runnable),
            &runner,
        )
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
}
