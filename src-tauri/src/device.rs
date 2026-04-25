use crate::{bdb_tool, process_runner, storage};
use serde::Serialize;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

const BDB_STATUS_ARGUMENT: &str = "status";
const BDB_VERSION_ARGUMENT: &str = "version";
const DEFAULT_DEVICE_STATUS_POLL_INTERVAL_MS: u32 = 5_000;
const BACKGROUND_DEVICE_STATUS_POLL_INTERVAL_MS: u32 = 15_000;
const BDB_STATUS_TIMEOUT_SECONDS: u64 = 3;

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
    pub(crate) board_os_version: Option<String>,
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

#[derive(Default)]
struct DeviceStatusSession {
    last_status: Option<DeviceStatusKind>,
    cached_board_os_version: Option<String>,
    cached_bdb_version: Option<BdbVersionDetails>,
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
        let output = process_runner::run_with_timeout(
            executable_path,
            args,
            Duration::from_secs(BDB_STATUS_TIMEOUT_SECONDS),
        )
        .map_err(map_process_failure)?;

        Ok(ProcessRunOutput {
            exit_code: output.exit_code,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
}

static DEVICE_STATUS_SESSION: OnceLock<Mutex<DeviceStatusSession>> = OnceLock::new();

/// Load the current device-status snapshot for the managed `bdb` session.
pub(crate) fn load_current_device_status_snapshot() -> Result<DeviceStatusSnapshot, String> {
    let tool_state = bdb_tool::load_current_bdb_tool_state_for_device_poll()?;
    Ok(load_device_status_snapshot_with_runner_and_session(
        &tool_state,
        &CommandProcessRunner,
        device_status_session(),
    ))
}

#[cfg(test)]
fn load_device_status_snapshot_with_runner<P: ProcessRunner>(
    tool_state: &bdb_tool::BdbToolState,
    runner: &P,
) -> DeviceStatusSnapshot {
    let session = Mutex::new(DeviceStatusSession::default());
    load_device_status_snapshot_with_runner_and_session(tool_state, runner, &session)
}

fn load_device_status_snapshot_with_runner_and_session<P: ProcessRunner>(
    tool_state: &bdb_tool::BdbToolState,
    runner: &P,
    session: &Mutex<DeviceStatusSession>,
) -> DeviceStatusSnapshot {
    let configured_poll_interval_ms = current_poll_interval_ms();
    match tool_state.status {
        bdb_tool::BdbToolStatus::Unsupported => record_status(
            session,
            DeviceStatusSnapshot {
                status: DeviceStatusKind::UnsupportedHost,
                summary:
                    "This computer is outside Board's current support for the desktop install tool."
                        .into(),
                guidance: tool_state.guidance.clone(),
                detail: None,
                board_os_version: None,
                poll_interval_ms: poll_interval_for_status(
                    DeviceStatusKind::UnsupportedHost,
                    configured_poll_interval_ms,
                ),
                bdb_version: unavailable_version_details(
                    &tool_state.executable_path,
                    tool_state.summary.clone(),
                ),
            },
        ),
        bdb_tool::BdbToolStatus::Missing => record_status(
            session,
            DeviceStatusSnapshot {
                status: DeviceStatusKind::ToolMissing,
                summary: "Board's install tool still needs to be downloaded before device checks can start."
                    .into(),
                guidance: tool_state.guidance.clone(),
                detail: None,
                board_os_version: None,
                poll_interval_ms: poll_interval_for_status(
                    DeviceStatusKind::ToolMissing,
                    configured_poll_interval_ms,
                ),
                bdb_version: unavailable_version_details(
                    &tool_state.executable_path,
                    "BE Home has not downloaded bdb yet.".into(),
                ),
            },
        ),
        bdb_tool::BdbToolStatus::Downloaded => record_status(
            session,
            DeviceStatusSnapshot {
                status: DeviceStatusKind::ToolBroken,
                summary: "BE Home found the Board install tool, but this computer is not letting it run cleanly yet."
                    .into(),
                guidance: tool_state.guidance.clone(),
                detail: Some("Choose repair in settings to fetch a fresh copy of bdb.".into()),
                board_os_version: None,
                poll_interval_ms: poll_interval_for_status(
                    DeviceStatusKind::ToolBroken,
                    configured_poll_interval_ms,
                ),
                bdb_version: unavailable_version_details(
                    &tool_state.executable_path,
                    "BE Home could not trust the stored bdb copy enough to read its version."
                        .into(),
                ),
            },
        ),
        bdb_tool::BdbToolStatus::Runnable => {
            inspect_runnable_device_status(tool_state, runner, configured_poll_interval_ms, session)
        }
    }
}

fn inspect_runnable_device_status<P: ProcessRunner>(
    tool_state: &bdb_tool::BdbToolState,
    runner: &P,
    configured_poll_interval_ms: u32,
    session: &Mutex<DeviceStatusSession>,
) -> DeviceStatusSnapshot {
    let executable_path = Path::new(&tool_state.executable_path);
    let version = bdb_version_details_from_tool_state(tool_state);
    let status_command = build_command_string(&tool_state.executable_path, BDB_STATUS_ARGUMENT);

    match runner.run(executable_path, &[BDB_STATUS_ARGUMENT]) {
        Ok(output) => {
            let mut snapshot =
                normalize_status_output(output, version, configured_poll_interval_ms);
            refresh_connected_board_details(&mut snapshot, executable_path, runner, session);
            snapshot
        }
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
                    Some(format!(
                        "The last check attempted `{status_command}`. {}",
                        failure.detail
                    )),
                ),
            };
            let poll_interval_ms = poll_interval_for_status(status, configured_poll_interval_ms);

            record_status(
                session,
                DeviceStatusSnapshot {
                    status,
                    summary,
                    guidance,
                    detail,
                    board_os_version: None,
                    poll_interval_ms,
                    bdb_version: version,
                },
            )
        }
    }
}

fn normalize_status_output(
    output: ProcessRunOutput,
    version: BdbVersionDetails,
    configured_poll_interval_ms: u32,
) -> DeviceStatusSnapshot {
    let combined_text = combined_output_text(&output);
    let normalized_text = combined_text.to_ascii_lowercase();
    let board_os_version = extract_board_os_version(&combined_text).or_else(|| {
        version
            .value
            .as_deref()
            .and_then(extract_board_os_version_from_version_text)
    });

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
    } else if output.exit_code == Some(0) || contains_any(&normalized_text, &["connected", "ready"])
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
    let poll_interval_ms = poll_interval_for_status(status, configured_poll_interval_ms);

    DeviceStatusSnapshot {
        status,
        summary,
        guidance,
        detail,
        board_os_version,
        poll_interval_ms,
        bdb_version: version,
    }
}

fn refresh_connected_board_details<P: ProcessRunner>(
    snapshot: &mut DeviceStatusSnapshot,
    executable_path: &Path,
    runner: &P,
    session: &Mutex<DeviceStatusSession>,
) {
    if snapshot.status != DeviceStatusKind::BoardConnected {
        record_snapshot_status(session, snapshot);
        return;
    }

    if should_refresh_connected_details(session) {
        let refreshed_version = load_bdb_version(executable_path, runner);
        if let Some(board_os_version) = refreshed_version
            .value
            .as_deref()
            .and_then(extract_board_os_version_from_version_text)
        {
            snapshot.board_os_version = Some(board_os_version);
        }
        snapshot.bdb_version = refreshed_version;
        record_snapshot_status(session, snapshot);
        return;
    }

    let (cached_board_os_version, cached_bdb_version) = cached_connected_details(session);
    if snapshot.board_os_version.is_none() {
        snapshot.board_os_version = cached_board_os_version;
    }
    if let Some(cached_bdb_version) = cached_bdb_version {
        snapshot.bdb_version = cached_bdb_version;
    }
    record_snapshot_status(session, snapshot);
}

fn load_bdb_version<P: ProcessRunner>(executable_path: &Path, runner: &P) -> BdbVersionDetails {
    let command = build_command_string(&executable_path.to_string_lossy(), BDB_VERSION_ARGUMENT);

    match runner.run(executable_path, &[BDB_VERSION_ARGUMENT]) {
        Ok(output) => {
            let combined_text = combined_output_text(&output);
            if output.exit_code == Some(0) {
                match first_non_empty_line(&combined_text) {
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
                        summary: "BE Home could not read a friendly version string from bdb."
                            .into(),
                        detail: Some(
                            "The tool opened, but it did not return a readable version line."
                                .into(),
                        ),
                    },
                }
            } else {
                BdbVersionDetails {
                    status: BdbVersionStatus::Unavailable,
                    command,
                    value: None,
                    exit_code: output.exit_code,
                    summary: "BE Home could not confirm which bdb version is loaded right now."
                        .into(),
                    detail: Some(if combined_text.is_empty() {
                        "bdb exited before it shared a readable version line.".into()
                    } else {
                        combined_text
                    }),
                }
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

fn bdb_version_details_from_tool_state(tool_state: &bdb_tool::BdbToolState) -> BdbVersionDetails {
    let version_check = &tool_state.version_check;
    let status = match version_check.status {
        bdb_tool::BdbToolVersionStatus::Available => BdbVersionStatus::Available,
        bdb_tool::BdbToolVersionStatus::Unavailable => BdbVersionStatus::Unavailable,
    };

    BdbVersionDetails {
        status,
        command: version_check.command.clone(),
        value: version_check.value.clone(),
        exit_code: version_check.exit_code,
        summary: version_check.summary.clone(),
        detail: version_check.detail.clone(),
    }
}

fn device_status_session() -> &'static Mutex<DeviceStatusSession> {
    DEVICE_STATUS_SESSION.get_or_init(|| Mutex::new(DeviceStatusSession::default()))
}

fn should_refresh_connected_details(session: &Mutex<DeviceStatusSession>) -> bool {
    let session = lock_device_status_session(session);
    session.last_status != Some(DeviceStatusKind::BoardConnected)
        || (session.cached_board_os_version.is_none() && session.cached_bdb_version.is_none())
}

fn cached_connected_details(
    session: &Mutex<DeviceStatusSession>,
) -> (Option<String>, Option<BdbVersionDetails>) {
    let session = lock_device_status_session(session);
    (
        session.cached_board_os_version.clone(),
        session.cached_bdb_version.clone(),
    )
}

fn record_status(
    session: &Mutex<DeviceStatusSession>,
    snapshot: DeviceStatusSnapshot,
) -> DeviceStatusSnapshot {
    record_snapshot_status(session, &snapshot);
    snapshot
}

fn record_snapshot_status(session: &Mutex<DeviceStatusSession>, snapshot: &DeviceStatusSnapshot) {
    let mut session = lock_device_status_session(session);
    session.last_status = Some(snapshot.status);
    if snapshot.status == DeviceStatusKind::BoardConnected {
        session.cached_board_os_version = snapshot.board_os_version.clone();
        session.cached_bdb_version = Some(snapshot.bdb_version.clone());
    } else {
        session.cached_board_os_version = None;
        session.cached_bdb_version = None;
    }
}

fn lock_device_status_session(
    session: &Mutex<DeviceStatusSession>,
) -> MutexGuard<'_, DeviceStatusSession> {
    session
        .lock()
        .unwrap_or_else(|poisoned_session| poisoned_session.into_inner())
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

fn extract_board_os_version(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find_map(|line| {
            let lower = line.to_ascii_lowercase();
            lower
                .strip_prefix("board os version:")
                .map(|_| line["Board OS Version:".len()..].trim().to_owned())
        })
        .filter(|version| !version.is_empty())
}

fn extract_board_os_version_from_version_text(value: &str) -> Option<String> {
    extract_board_os_version(value).or_else(|| {
        first_non_empty_line(value)
            .filter(|line| looks_like_plain_version(line))
            .map(|line| line.trim().to_owned())
    })
}

fn looks_like_plain_version(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.starts_with(|character: char| character.is_ascii_digit())
        && trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
}

fn contains_any(value: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|candidate| value.contains(candidate))
}

fn first_non_empty_line(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned)
}

fn map_process_failure(failure: process_runner::ProcessCommandFailure) -> ProcessRunFailure {
    let kind = match failure.kind {
        process_runner::ProcessCommandFailureKind::PermissionDenied => {
            ProcessRunFailureKind::PermissionDenied
        }
        process_runner::ProcessCommandFailureKind::NotFound => ProcessRunFailureKind::NotFound,
        process_runner::ProcessCommandFailureKind::TimedOut
        | process_runner::ProcessCommandFailureKind::Other => ProcessRunFailureKind::Other,
    };

    ProcessRunFailure {
        kind,
        detail: failure.detail,
    }
}

fn build_command_string(executable_path: &str, argument: &str) -> String {
    format!("{executable_path} {argument}")
}

fn current_poll_interval_ms() -> u32 {
    storage::load_desktop_settings()
        .map(|settings| {
            settings
                .board_connection
                .poll_interval_seconds
                .saturating_mul(1000)
        })
        .unwrap_or(DEFAULT_DEVICE_STATUS_POLL_INTERVAL_MS)
}

fn poll_interval_for_status(status: DeviceStatusKind, configured_poll_interval_ms: u32) -> u32 {
    match status {
        DeviceStatusKind::BoardConnected => configured_poll_interval_ms,
        DeviceStatusKind::ToolMissing
        | DeviceStatusKind::ToolBroken
        | DeviceStatusKind::UnsupportedHost
        | DeviceStatusKind::BoardDisconnected
        | DeviceStatusKind::ExecutionError => {
            configured_poll_interval_ms.max(BACKGROUND_DEVICE_STATUS_POLL_INTERVAL_MS)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        current_poll_interval_ms, load_device_status_snapshot_with_runner,
        load_device_status_snapshot_with_runner_and_session, BdbVersionStatus, DeviceStatusKind,
        DeviceStatusSession, DeviceStatusSnapshot, ProcessRunFailure, ProcessRunFailureKind,
        ProcessRunOutput, ProcessRunner, BACKGROUND_DEVICE_STATUS_POLL_INTERVAL_MS,
    };
    use crate::{
        bdb::{
            BdbArchitecture, BdbDownloadSource, BdbOperatingSystem, BdbPlatformSupport,
            BdbSourcePlan, BdbSupportStatus,
        },
        bdb_tool::{
            BdbRunnableStatus, BdbRunnableValidation, BdbToolState, BdbToolStatus,
            BdbToolVersionCheck, BdbToolVersionStatus, BdbUpdateStatus, BdbUpdateStatusKind,
        },
        storage::{ManagedStorageLocation, ManagedStoragePathSource},
    };
    use std::path::Path;
    use std::sync::Mutex;

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
                stdout: "Board OS Version: 1.8.1".into(),
                stderr: String::new(),
            }),
            status: Ok(ProcessRunOutput {
                exit_code: Some(0),
                stdout: "Board connected and ready.".into(),
                stderr: String::new(),
            }),
        });

        assert_eq!(DeviceStatusKind::BoardConnected, snapshot.status);
        assert_eq!(
            Some("Board OS Version: 1.8.1"),
            snapshot.bdb_version.value.as_deref()
        );
        assert_eq!(Some("1.8.1"), snapshot.board_os_version.as_deref());
        assert_eq!(current_poll_interval_ms(), snapshot.poll_interval_ms);
    }

    #[test]
    fn connected_status_accepts_plain_board_os_version_text() {
        let snapshot = runnable_snapshot_with_runner(StaticRunner {
            version: Ok(ProcessRunOutput {
                exit_code: Some(0),
                stdout: "1.8.1".into(),
                stderr: String::new(),
            }),
            status: Ok(ProcessRunOutput {
                exit_code: Some(0),
                stdout: "Board connected and ready.".into(),
                stderr: String::new(),
            }),
        });

        assert_eq!(DeviceStatusKind::BoardConnected, snapshot.status);
        assert_eq!(Some("1.8.1"), snapshot.board_os_version.as_deref());
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
        assert_eq!(
            current_poll_interval_ms().max(BACKGROUND_DEVICE_STATUS_POLL_INTERVAL_MS),
            snapshot.poll_interval_ms
        );
    }

    #[test]
    fn connected_status_poll_reuses_cached_board_os_until_reconnection() {
        let session = Mutex::new(DeviceStatusSession::default());
        let first_snapshot = runnable_snapshot_with_runner_and_session(
            StaticRunner {
                version: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Board OS Version: 1.8.1".into(),
                    stderr: String::new(),
                }),
                status: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Board connected and ready.".into(),
                    stderr: String::new(),
                }),
            },
            &session,
        );
        let second_snapshot = runnable_snapshot_with_runner_and_session(
            StaticRunner {
                version: Err(ProcessRunFailure {
                    kind: ProcessRunFailureKind::Other,
                    detail: "version should not be called while the connection stays ready".into(),
                }),
                status: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Board connected and ready.".into(),
                    stderr: String::new(),
                }),
            },
            &session,
        );

        assert_eq!(DeviceStatusKind::BoardConnected, first_snapshot.status);
        assert_eq!(Some("1.8.1"), first_snapshot.board_os_version.as_deref());
        assert_eq!(DeviceStatusKind::BoardConnected, second_snapshot.status);
        assert_eq!(Some("1.8.1"), second_snapshot.board_os_version.as_deref());
        assert_eq!(
            Some("Board OS Version: 1.8.1"),
            second_snapshot.bdb_version.value.as_deref()
        );
    }

    #[test]
    fn connected_status_refreshes_board_os_after_disconnection() {
        let session = Mutex::new(DeviceStatusSession::default());
        let first_snapshot = runnable_snapshot_with_runner_and_session(
            StaticRunner {
                version: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Board OS Version: 1.8.1".into(),
                    stderr: String::new(),
                }),
                status: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Board connected and ready.".into(),
                    stderr: String::new(),
                }),
            },
            &session,
        );
        let disconnected_snapshot = runnable_snapshot_with_runner_and_session(
            StaticRunner {
                version: Err(ProcessRunFailure {
                    kind: ProcessRunFailureKind::Other,
                    detail: "version should not be called while disconnected".into(),
                }),
                status: Ok(ProcessRunOutput {
                    exit_code: Some(1),
                    stdout: "Board not connected.".into(),
                    stderr: String::new(),
                }),
            },
            &session,
        );
        let reconnected_snapshot = runnable_snapshot_with_runner_and_session(
            StaticRunner {
                version: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Board OS Version: 1.9.0".into(),
                    stderr: String::new(),
                }),
                status: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Board connected and ready.".into(),
                    stderr: String::new(),
                }),
            },
            &session,
        );

        assert_eq!(Some("1.8.1"), first_snapshot.board_os_version.as_deref());
        assert_eq!(
            DeviceStatusKind::BoardDisconnected,
            disconnected_snapshot.status
        );
        assert_eq!(None, disconnected_snapshot.board_os_version);
        assert_eq!(
            Some("1.9.0"),
            reconnected_snapshot.board_os_version.as_deref()
        );
    }

    #[test]
    fn connected_status_marks_board_os_unavailable_when_refresh_fails() {
        let snapshot = runnable_snapshot_with_runner(StaticRunner {
            version: Err(ProcessRunFailure {
                kind: ProcessRunFailureKind::Other,
                detail: "version probe failed".into(),
            }),
            status: Ok(ProcessRunOutput {
                exit_code: Some(0),
                stdout: "Board connected and ready.".into(),
                stderr: String::new(),
            }),
        });

        assert_eq!(DeviceStatusKind::BoardConnected, snapshot.status);
        assert_eq!(BdbVersionStatus::Unavailable, snapshot.bdb_version.status);
        assert_eq!(None, snapshot.board_os_version);
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
        assert_eq!(
            current_poll_interval_ms().max(BACKGROUND_DEVICE_STATUS_POLL_INTERVAL_MS),
            snapshot.poll_interval_ms
        );
    }

    fn runnable_snapshot_with_runner(runner: StaticRunner) -> DeviceStatusSnapshot {
        load_device_status_snapshot_with_runner(
            &sample_tool_state(BdbToolStatus::Runnable, BdbRunnableStatus::Runnable),
            &runner,
        )
    }

    fn runnable_snapshot_with_runner_and_session(
        runner: StaticRunner,
        session: &Mutex<DeviceStatusSession>,
    ) -> DeviceStatusSnapshot {
        load_device_status_snapshot_with_runner_and_session(
            &sample_tool_state(BdbToolStatus::Runnable, BdbRunnableStatus::Runnable),
            &runner,
            session,
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
                    version: None,
                }),
            },
            version_check: BdbToolVersionCheck {
                status: BdbToolVersionStatus::Available,
                command: "/tmp/bdb version".into(),
                value: Some("bdb 0.19.0".into()),
                exit_code: Some(0),
                summary: "Installed version: bdb 0.19.0".into(),
                detail: None,
            },
            update_status: BdbUpdateStatus {
                status: BdbUpdateStatusKind::UpToDate,
                current_version: Some("bdb 0.19.0".into()),
                available_version: Some("bdb 0.19.0".into()),
                guidance:
                    "This Board Install Tool matches the latest version in BE Home's source list."
                        .into(),
            },
            support_request_draft: None,
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
