use crate::{apk, bdb_tool, device, process_runner};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

const BDB_INSTALL_ARGUMENT: &str = "install";
const BDB_LAUNCH_ARGUMENT: &str = "launch";
const BDB_REMOVE_ARGUMENT: &str = "remove";
const BDB_INSTALL_TIMEOUT_SECONDS: u64 = 300;
const BDB_ACTION_TIMEOUT_SECONDS: u64 = 30;

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

/// Describes whether an uninstall attempt completed successfully.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum UninstallInstalledTitleStatus {
    Removed,
    Failed,
}

/// Represents the uninstall payload accepted by the desktop host.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UninstallInstalledTitleInput {
    package_name: String,
    display_name: Option<String>,
}

/// Describes the player-facing result of one `bdb remove` attempt.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UninstallInstalledTitleResult {
    pub(crate) status: UninstallInstalledTitleStatus,
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) detail: Option<String>,
    pub(crate) command: String,
    pub(crate) exit_code: Option<i32>,
}

/// Describes whether a launch attempt completed successfully.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LaunchInstalledTitleStatus {
    Launched,
    Failed,
}

/// Represents the launch payload accepted by the desktop host.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchInstalledTitleInput {
    package_name: String,
    display_name: Option<String>,
}

/// Describes the player-facing result of one `bdb launch` attempt.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchInstalledTitleResult {
    pub(crate) status: LaunchInstalledTitleStatus,
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
        let output =
            process_runner::run_with_timeout(executable_path, args, timeout_for_args(args))
                .map_err(map_process_failure)?;

        Ok(ProcessRunOutput {
            exit_code: output.exit_code,
            stdout: output.stdout,
            stderr: output.stderr,
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

/// Remove one installed title from the currently connected Board device.
pub(crate) fn uninstall_installed_title_from_board(
    input: UninstallInstalledTitleInput,
) -> Result<UninstallInstalledTitleResult, String> {
    let package_name = normalize_package_name(&input.package_name)?;
    let display_name = normalize_display_name(input.display_name.as_deref(), &package_name);
    let tool_state = bdb_tool::load_current_bdb_tool_state()?;
    let device_status = device::load_current_device_status_snapshot()?;

    Ok(uninstall_installed_title_with_runner(
        &tool_state,
        &device_status,
        &package_name,
        &display_name,
        &CommandProcessRunner,
    ))
}

/// Launch one installed title on the currently connected Board device.
pub(crate) fn launch_installed_title_on_board(
    input: LaunchInstalledTitleInput,
) -> Result<LaunchInstalledTitleResult, String> {
    let package_name = normalize_package_name(&input.package_name)?;
    let display_name = normalize_display_name(input.display_name.as_deref(), &package_name);
    let tool_state = bdb_tool::load_current_bdb_tool_state()?;
    let device_status = device::load_current_device_status_snapshot()?;

    Ok(launch_installed_title_with_runner(
        &tool_state,
        &device_status,
        &package_name,
        &display_name,
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
    let command = build_command_string(
        &tool_state.executable_path,
        BDB_INSTALL_ARGUMENT,
        &apk_path_string,
    );

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
                guidance: "Keep Board connected, then try the install again in a moment.".into(),
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
    } else if contains_any(
        &normalized_output,
        &["not enough space", "insufficient storage", "no space"],
    ) {
        (
            "Board says it does not have enough storage space for this install right now.".into(),
            Some("Free up space on Board, then try the install again.".into()),
        )
    } else if contains_any(
        &normalized_output,
        &["invalid", "corrupt", "parse", "manifest"],
    ) {
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

fn uninstall_installed_title_with_runner<P: ProcessRunner>(
    tool_state: &bdb_tool::BdbToolState,
    device_status: &device::DeviceStatusSnapshot,
    package_name: &str,
    display_name: &str,
    runner: &P,
) -> UninstallInstalledTitleResult {
    let command = build_command_string(
        &tool_state.executable_path,
        BDB_REMOVE_ARGUMENT,
        package_name,
    );

    if tool_state.status != bdb_tool::BdbToolStatus::Runnable {
        return blocked_uninstall_result(
            display_name,
            &command,
            None,
            tool_guidance_for_install(tool_state),
        );
    }

    if device_status.status != device::DeviceStatusKind::BoardConnected {
        return blocked_uninstall_result(
            display_name,
            &command,
            None,
            device_guidance_for_install(device_status),
        );
    }

    match runner.run(
        Path::new(&tool_state.executable_path),
        &[BDB_REMOVE_ARGUMENT, package_name],
    ) {
        Ok(output) => normalize_uninstall_output(display_name, command, output),
        Err(failure) => match failure.kind {
            ProcessRunFailureKind::PermissionDenied => UninstallInstalledTitleResult {
                status: UninstallInstalledTitleStatus::Failed,
                summary: format!(
                    "BE Home couldn't reopen Board's install tool to remove {display_name}."
                ),
                guidance: "Repair bdb from settings, then try removing the title again.".into(),
                detail: Some(failure.detail),
                command,
                exit_code: None,
            },
            ProcessRunFailureKind::NotFound => UninstallInstalledTitleResult {
                status: UninstallInstalledTitleStatus::Failed,
                summary: format!(
                    "Board's install tool went missing before {display_name} could be removed."
                ),
                guidance: "Repair or re-download bdb from settings, then try again.".into(),
                detail: Some(failure.detail),
                command,
                exit_code: None,
            },
            ProcessRunFailureKind::Other => UninstallInstalledTitleResult {
                status: UninstallInstalledTitleStatus::Failed,
                summary: format!("BE Home couldn't finish removing {display_name} from Board yet."),
                guidance: "Keep Board connected, then try removing the title again in a moment."
                    .into(),
                detail: Some("The uninstall command could not finish cleanly.".into()),
                command,
                exit_code: None,
            },
        },
    }
}

fn normalize_uninstall_output(
    display_name: &str,
    command: String,
    output: ProcessRunOutput,
) -> UninstallInstalledTitleResult {
    if output.exit_code == Some(0) {
        return UninstallInstalledTitleResult {
            status: UninstallInstalledTitleStatus::Removed,
            summary: format!("BE Home removed {display_name} from Board."),
            guidance:
                "The device and installed-title views will refresh now so the inventory can catch up."
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
        &[
            "not installed",
            "unknown package",
            "no such package",
            "package not found",
        ],
    ) {
        (
            "Board says this title is not installed anymore. Refresh the installed list and try again if you still need to clean it up."
                .into(),
            Some("Board reported that the app was already missing.".into()),
        )
    } else {
        (
            "Keep Board connected, then try removing the title again.".into(),
            first_non_empty_line(&combined_output),
        )
    };

    UninstallInstalledTitleResult {
        status: UninstallInstalledTitleStatus::Failed,
        summary: format!("BE Home couldn't remove {display_name} from Board yet."),
        guidance,
        detail,
        command,
        exit_code: output.exit_code,
    }
}

fn launch_installed_title_with_runner<P: ProcessRunner>(
    tool_state: &bdb_tool::BdbToolState,
    device_status: &device::DeviceStatusSnapshot,
    package_name: &str,
    display_name: &str,
    runner: &P,
) -> LaunchInstalledTitleResult {
    let command = build_command_string(
        &tool_state.executable_path,
        BDB_LAUNCH_ARGUMENT,
        package_name,
    );

    if tool_state.status != bdb_tool::BdbToolStatus::Runnable {
        return blocked_launch_result(
            display_name,
            &command,
            None,
            tool_guidance_for_launch(tool_state),
        );
    }

    if device_status.status != device::DeviceStatusKind::BoardConnected {
        return blocked_launch_result(
            display_name,
            &command,
            None,
            device_guidance_for_launch(device_status),
        );
    }

    match runner.run(
        Path::new(&tool_state.executable_path),
        &[BDB_LAUNCH_ARGUMENT, package_name],
    ) {
        Ok(output) => normalize_launch_output(display_name, command, output),
        Err(failure) => match failure.kind {
            ProcessRunFailureKind::PermissionDenied => LaunchInstalledTitleResult {
                status: LaunchInstalledTitleStatus::Failed,
                summary: format!(
                    "BE Home couldn't reopen Board's install tool to launch {display_name}."
                ),
                guidance: "Repair bdb from settings, then try launching the title again.".into(),
                detail: Some(failure.detail),
                command,
                exit_code: None,
            },
            ProcessRunFailureKind::NotFound => LaunchInstalledTitleResult {
                status: LaunchInstalledTitleStatus::Failed,
                summary: format!(
                    "Board's install tool went missing before {display_name} could launch."
                ),
                guidance: "Repair or re-download bdb from settings, then try again.".into(),
                detail: Some(failure.detail),
                command,
                exit_code: None,
            },
            ProcessRunFailureKind::Other => LaunchInstalledTitleResult {
                status: LaunchInstalledTitleStatus::Failed,
                summary: format!("BE Home couldn't finish launching {display_name} on Board yet."),
                guidance: "Keep Board connected, then try opening the title again in a moment."
                    .into(),
                detail: Some("The launch command could not finish cleanly.".into()),
                command,
                exit_code: None,
            },
        },
    }
}

fn normalize_launch_output(
    display_name: &str,
    command: String,
    output: ProcessRunOutput,
) -> LaunchInstalledTitleResult {
    if output.exit_code == Some(0) {
        return LaunchInstalledTitleResult {
            status: LaunchInstalledTitleStatus::Launched,
            summary: format!("BE Home launched {display_name} on Board."),
            guidance:
                "The device check will refresh now while the installed-title list stays in place."
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
        &[
            "not installed",
            "unknown package",
            "no such package",
            "package not found",
        ],
    ) {
        (
            "Board says this title is not installed anymore. Refresh the installed list if you want to confirm what is still there."
                .into(),
            Some("Board reported that the app was already missing.".into()),
        )
    } else {
        (
            "Keep Board connected, then try opening the title again.".into(),
            first_non_empty_line(&combined_output),
        )
    };

    LaunchInstalledTitleResult {
        status: LaunchInstalledTitleStatus::Failed,
        summary: format!("BE Home couldn't launch {display_name} on Board yet."),
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

fn blocked_uninstall_result(
    display_name: &str,
    command: &str,
    exit_code: Option<i32>,
    guidance: (&'static str, String, Option<String>),
) -> UninstallInstalledTitleResult {
    UninstallInstalledTitleResult {
        status: UninstallInstalledTitleStatus::Failed,
        summary: format!("BE Home couldn't start removing {display_name} yet."),
        guidance: guidance.1,
        detail: guidance.2.or_else(|| Some(guidance.0.into())),
        command: command.into(),
        exit_code,
    }
}

fn blocked_launch_result(
    display_name: &str,
    command: &str,
    exit_code: Option<i32>,
    guidance: (&'static str, String, Option<String>),
) -> LaunchInstalledTitleResult {
    LaunchInstalledTitleResult {
        status: LaunchInstalledTitleStatus::Failed,
        summary: format!("BE Home couldn't start launching {display_name} yet."),
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
        bdb_tool::BdbToolStatus::Runnable => {
            ("ready", "Board's install tool is ready.".into(), None)
        }
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
        device::DeviceStatusKind::BoardConnected => ("ready", "Board is connected.".into(), None),
    }
}

fn tool_guidance_for_launch(
    tool_state: &bdb_tool::BdbToolState,
) -> (&'static str, String, Option<String>) {
    match tool_state.status {
        bdb_tool::BdbToolStatus::Unsupported => (
            "unsupported",
            "This computer cannot use Board's current desktop tool yet, so BE Home can't open titles from here.".into(),
            Some(tool_state.guidance.clone()),
        ),
        bdb_tool::BdbToolStatus::Missing => (
            "missing",
            "Download Board's install tool before trying to open a title from Board.".into(),
            Some(tool_state.guidance.clone()),
        ),
        bdb_tool::BdbToolStatus::Downloaded => (
            "repair",
            "Repair bdb from settings, then try opening the title again.".into(),
            Some(tool_state.guidance.clone()),
        ),
        bdb_tool::BdbToolStatus::Runnable => (
            "ready",
            "Board's install tool is ready.".into(),
            None,
        ),
    }
}

fn device_guidance_for_launch(
    device_status: &device::DeviceStatusSnapshot,
) -> (&'static str, String, Option<String>) {
    match device_status.status {
        device::DeviceStatusKind::BoardDisconnected => (
            "disconnected",
            "Connect Board with USB, unlock it if needed, then try opening the title again.".into(),
            Some(device_status.guidance.clone()),
        ),
        device::DeviceStatusKind::ExecutionError => (
            "retry",
            "Refresh the Board connection check before trying to open the title again.".into(),
            Some(device_status.guidance.clone()),
        ),
        device::DeviceStatusKind::ToolBroken => (
            "repair",
            "Repair bdb from settings, then try opening the title again.".into(),
            Some(device_status.guidance.clone()),
        ),
        device::DeviceStatusKind::ToolMissing => (
            "missing",
            "Download Board's install tool before trying to open a title from Board.".into(),
            Some(device_status.guidance.clone()),
        ),
        device::DeviceStatusKind::UnsupportedHost => (
            "unsupported",
            "This computer cannot use Board's current desktop tool yet, so BE Home can't open titles from here.".into(),
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

fn build_command_string(executable_path: &str, command_name: &str, target: &str) -> String {
    format!("{executable_path} {command_name} {target}")
}

fn normalize_package_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(
            "Choose an installed title with a package name before asking BE Home to remove it."
                .into(),
        );
    }

    Ok(trimmed.to_owned())
}

fn normalize_display_name(display_name: Option<&str>, fallback: &str) -> String {
    let Some(display_name) = display_name else {
        return fallback.to_owned();
    };
    let trimmed = display_name.trim();
    if trimmed.is_empty() {
        fallback.to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn timeout_for_args(args: &[&str]) -> Duration {
    match args.first().copied() {
        Some(BDB_INSTALL_ARGUMENT) => Duration::from_secs(BDB_INSTALL_TIMEOUT_SECONDS),
        Some(BDB_LAUNCH_ARGUMENT) | Some(BDB_REMOVE_ARGUMENT) | None => {
            Duration::from_secs(BDB_ACTION_TIMEOUT_SECONDS)
        }
        Some(_) => Duration::from_secs(BDB_ACTION_TIMEOUT_SECONDS),
    }
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

#[cfg(test)]
mod tests {
    use super::{
        install_apk_with_runner, launch_installed_title_with_runner,
        uninstall_installed_title_with_runner, InstallApkStatus, LaunchInstalledTitleStatus,
        ProcessRunFailure, ProcessRunFailureKind, ProcessRunOutput, ProcessRunner,
        UninstallInstalledTitleStatus,
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

    #[test]
    fn uninstall_succeeds_when_bdb_returns_zero() {
        let result = uninstall_installed_title_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            "fun.board.luckydice",
            "Lucky Dice",
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Removed fun.board.luckydice".into(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(UninstallInstalledTitleStatus::Removed, result.status);
        assert!(result.summary.contains("Lucky Dice"));
    }

    #[test]
    fn uninstall_maps_missing_package_output_to_guidance() {
        let result = uninstall_installed_title_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            "fun.board.luckydice",
            "Lucky Dice",
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(1),
                    stdout: "Package not installed".into(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(UninstallInstalledTitleStatus::Failed, result.status);
        assert!(result.guidance.contains("not installed anymore"));
    }

    #[test]
    fn uninstall_does_not_treat_device_not_found_as_a_missing_package() {
        let result = uninstall_installed_title_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            "fun.board.luckydice",
            "Lucky Dice",
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(1),
                    stdout: String::new(),
                    stderr: "device not found".into(),
                }),
            },
        );

        assert_eq!(UninstallInstalledTitleStatus::Failed, result.status);
        assert!(result.guidance.contains("Keep Board connected"));
        assert!(!result.guidance.contains("not installed anymore"));
    }

    #[test]
    fn uninstall_requires_a_connected_board() {
        let result = uninstall_installed_title_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardDisconnected),
            "fun.board.luckydice",
            "Lucky Dice",
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(UninstallInstalledTitleStatus::Failed, result.status);
        assert!(result.guidance.contains("Connect Board"));
    }

    #[test]
    fn launch_succeeds_when_bdb_returns_zero() {
        let result = launch_installed_title_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            "fun.board.luckydice",
            "Lucky Dice",
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Launched fun.board.luckydice".into(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(LaunchInstalledTitleStatus::Launched, result.status);
        assert!(result.summary.contains("Lucky Dice"));
    }

    #[test]
    fn launch_uses_launch_specific_guidance_when_tool_is_not_runnable() {
        let mut tool_state = sample_runnable_tool_state();
        tool_state.status = bdb_tool::BdbToolStatus::Downloaded;
        tool_state.guidance = "Repair guidance from the current tool snapshot.".into();

        let result = launch_installed_title_with_runner(
            &tool_state,
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            "fun.board.luckydice",
            "Lucky Dice",
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(LaunchInstalledTitleStatus::Failed, result.status);
        assert!(result.guidance.contains("opening the title again"));
        assert!(!result.guidance.contains("trying this install again"));
    }

    #[test]
    fn launch_maps_missing_package_output_to_guidance() {
        let result = launch_installed_title_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            "fun.board.luckydice",
            "Lucky Dice",
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(1),
                    stdout: "Package not installed".into(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(LaunchInstalledTitleStatus::Failed, result.status);
        assert!(result.guidance.contains("not installed anymore"));
    }

    #[test]
    fn launch_does_not_treat_device_not_found_as_a_missing_package() {
        let result = launch_installed_title_with_runner(
            &sample_runnable_tool_state(),
            &sample_device_status(device::DeviceStatusKind::BoardConnected),
            "fun.board.luckydice",
            "Lucky Dice",
            &MockProcessRunner {
                outcome: Ok(ProcessRunOutput {
                    exit_code: Some(1),
                    stdout: String::new(),
                    stderr: "device not found".into(),
                }),
            },
        );

        assert_eq!(LaunchInstalledTitleStatus::Failed, result.status);
        assert!(result.guidance.contains("Keep Board connected"));
        assert!(!result.guidance.contains("not installed anymore"));
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
                    version: None,
                }),
            },
            version_check: bdb_tool::BdbToolVersionCheck {
                status: bdb_tool::BdbToolVersionStatus::Available,
                command: "bdb version".into(),
                value: Some("Board OS Version: 1.8.1".into()),
                exit_code: Some(0),
                summary: "Installed version: Board OS Version: 1.8.1".into(),
                detail: None,
            },
            update_status: bdb_tool::BdbUpdateStatus {
                status: bdb_tool::BdbUpdateStatusKind::UpToDate,
                current_version: Some("Board OS Version: 1.8.1".into()),
                available_version: Some("Board OS Version: 1.8.1".into()),
                guidance:
                    "This Board Install Tool matches the latest version in BE Home's source list."
                        .into(),
            },
            support_request_draft: None,
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
            board_os_version: Some("1.8.1".into()),
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
