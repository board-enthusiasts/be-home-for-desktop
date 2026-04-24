use crate::{bdb, storage};
use reqwest::blocking::Client;
use serde::Serialize;
use std::fs;
use std::io;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const BDB_HELP_ARGUMENT: &str = "help";
const BDB_VERSION_ARGUMENT: &str = "version";
const BDB_DOWNLOAD_TIMEOUT_SECONDS: u64 = 30;
const BOARD_SUPPORT_EMAIL: &str = "hello@board.fun";
const BOARD_SUPPORT_SUBJECT: &str = "OS Support Request for bdb";

/// Describes the local `bdb` readiness state the renderer can consume.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BdbToolStatus {
    Unsupported,
    Missing,
    Downloaded,
    Runnable,
}

/// Describes the result of the no-device-required runnable validation command.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BdbRunnableStatus {
    Unsupported,
    Missing,
    Blocked,
    Runnable,
}

/// Describes whether BE Home could read a friendly Board Install Tool version line.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BdbToolVersionStatus {
    Available,
    Unavailable,
}

/// Describes the latest `bdb version` check for the managed Board Install Tool.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbToolVersionCheck {
    pub(crate) status: BdbToolVersionStatus,
    pub(crate) command: String,
    pub(crate) value: Option<String>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) summary: String,
    pub(crate) detail: Option<String>,
}

/// Describes the latest manual update-check result for the managed Board Install Tool.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BdbUpdateStatusKind {
    UpToDate,
    UpdateAvailable,
    Unknown,
    Unsupported,
    Error,
}

/// Describes whether the managed Board Install Tool matches the latest manifest version.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbUpdateStatus {
    pub(crate) status: BdbUpdateStatusKind,
    pub(crate) current_version: Option<String>,
    pub(crate) available_version: Option<String>,
    pub(crate) guidance: String,
}

/// Describes a prefilled Board support request for unsupported-OS cases.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupportRequestDraft {
    pub(crate) to: String,
    pub(crate) subject: String,
    pub(crate) body: String,
    pub(crate) mailto_url: String,
}

/// Describes the latest runnable-validation result for the stored `bdb` binary.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbRunnableValidation {
    pub(crate) status: BdbRunnableStatus,
    pub(crate) command: String,
    pub(crate) exit_code: Option<i32>,
    pub(crate) summary: String,
    pub(crate) detail: Option<String>,
}

/// Describes the managed `bdb` tool state for the current machine.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbToolState {
    pub(crate) status: BdbToolStatus,
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) executable_path: String,
    pub(crate) executable_exists: bool,
    pub(crate) storage: storage::ManagedStorageLocation,
    pub(crate) source_plan: bdb::BdbSourcePlan,
    pub(crate) version_check: BdbToolVersionCheck,
    pub(crate) update_status: BdbUpdateStatus,
    pub(crate) support_request_draft: Option<SupportRequestDraft>,
    pub(crate) validation: BdbRunnableValidation,
}

/// Describes the outcome of an acquire or repair attempt for `bdb`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BdbAcquisitionOutcome {
    Unsupported,
    AlreadyReady,
    Downloaded,
    Repaired,
    Failed,
}

/// Describes the acquire or repair result returned to the renderer.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbAcquisitionResult {
    pub(crate) outcome: BdbAcquisitionOutcome,
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) tool_state: BdbToolState,
}

#[derive(Clone, Debug)]
struct UserFacingError {
    summary: String,
    guidance: String,
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

trait BinaryDownloader {
    fn download(&self, url: &str) -> Result<Vec<u8>, UserFacingError>;
}

trait ProcessRunner {
    fn run(
        &self,
        executable_path: &Path,
        args: &[&str],
    ) -> Result<ProcessRunOutput, ProcessRunFailure>;
}

struct ReqwestBinaryDownloader {
    client: Client,
}

impl ReqwestBinaryDownloader {
    fn new() -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_secs(BDB_DOWNLOAD_TIMEOUT_SECONDS))
            .build()
            .map_err(|error| {
                format!("The desktop app could not prepare its bdb download client: {error}")
            })?;
        Ok(Self { client })
    }
}

impl BinaryDownloader for ReqwestBinaryDownloader {
    fn download(&self, url: &str) -> Result<Vec<u8>, UserFacingError> {
        let response = self.client.get(url).send().map_err(|error| {
            if error.is_timeout() {
                return UserFacingError {
                    summary: "BE Home could not finish reaching Board's bdb download in time."
                        .into(),
                    guidance:
                        "Check your internet connection, then try the download again.".into(),
                };
            }

            if error.is_connect() {
                return UserFacingError {
                    summary: "BE Home could not reach Board's bdb download right now.".into(),
                    guidance:
                        "Check your internet connection, then try the download again.".into(),
                };
            }

            UserFacingError {
                summary: "BE Home could not download bdb from Board right now.".into(),
                guidance:
                    "Wait a moment and try again. If the problem keeps happening, Board's download host may be unavailable."
                        .into(),
            }
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(UserFacingError {
                summary: "Board's download host did not accept the bdb request.".into(),
                guidance: format!(
                    "Board responded with HTTP status {status}. Try again in a little while."
                ),
            });
        }

        response
            .bytes()
            .map(|bytes| bytes.to_vec())
            .map_err(|_| UserFacingError {
                summary: "BE Home could not finish reading Board's bdb download.".into(),
                guidance: "Try the download again in a moment.".into(),
            })
    }
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

/// Load the current `bdb` tool state for the local machine.
pub(crate) fn load_current_bdb_tool_state() -> Result<BdbToolState, String> {
    load_current_bdb_tool_state_with_remote_refresh(false)
}

/// Load the current `bdb` tool state, optionally refreshing the remote source manifest first.
pub(crate) fn load_current_bdb_tool_state_with_remote_refresh(
    refresh_manifest: bool,
) -> Result<BdbToolState, String> {
    let source_plan = if refresh_manifest {
        bdb::refresh_current_bdb_source_plan()
    } else {
        bdb::resolve_current_bdb_source_plan()
    };
    let storage_settings = storage::load_managed_storage_settings()?;
    Ok(inspect_bdb_tool_state_with_plan_and_runner(
        source_plan,
        storage_settings,
        &CommandProcessRunner,
    ))
}

/// Download or repair `bdb`, then return the updated state.
pub(crate) fn acquire_current_bdb_tool(repair: bool) -> Result<BdbAcquisitionResult, String> {
    let source_plan = bdb::refresh_current_bdb_source_plan();
    let storage_settings = storage::load_managed_storage_settings()?;
    let downloader = ReqwestBinaryDownloader::new()?;
    Ok(acquire_bdb_tool_with_dependencies(
        source_plan,
        storage_settings,
        &downloader,
        &CommandProcessRunner,
        repair,
    ))
}

fn inspect_bdb_tool_state_with_plan_and_runner<P: ProcessRunner>(
    source_plan: bdb::BdbSourcePlan,
    storage_settings: storage::ManagedStorageSettings,
    runner: &P,
) -> BdbToolState {
    let storage_location = storage_settings.bdb_tools.clone();
    let executable_path = resolve_bdb_executable_path(&storage_location);
    let executable_exists = executable_path.exists();
    let validation_command = build_validation_command(&executable_path);

    if source_plan.support.status == bdb::BdbSupportStatus::Unsupported {
        let version_check = unavailable_version_check(
            &executable_path,
            "BE Home cannot read a Board Install Tool version for this computer yet.".into(),
        );
        return BdbToolState {
            status: BdbToolStatus::Unsupported,
            summary: "This computer is outside Board's current bdb support matrix.".into(),
            guidance: source_plan.support.guidance.clone(),
            executable_path: path_to_string(&executable_path),
            executable_exists,
            storage: storage_location,
            source_plan: source_plan.clone(),
            version_check: version_check.clone(),
            update_status: build_update_status(&source_plan, executable_exists, &version_check),
            support_request_draft: None,
            validation: BdbRunnableValidation {
                status: BdbRunnableStatus::Unsupported,
                command: validation_command,
                exit_code: None,
                summary: "BE Home skipped the bdb runnable check because Board does not publish a supported download for this computer.".into(),
                detail: None,
            },
        };
    }

    if !executable_exists {
        let version_check = unavailable_version_check(
            &executable_path,
            "BE Home has not downloaded the Board Install Tool yet.".into(),
        );
        return BdbToolState {
            status: BdbToolStatus::Missing,
            summary: "BE Home has not downloaded bdb into the managed tools folder yet.".into(),
            guidance: "Continue setup and BE Home will download Board's bdb into its managed tools folder for you.".into(),
            executable_path: path_to_string(&executable_path),
            executable_exists: false,
            storage: storage_location,
            source_plan: source_plan.clone(),
            version_check: version_check.clone(),
            update_status: build_update_status(&source_plan, false, &version_check),
            support_request_draft: None,
            validation: BdbRunnableValidation {
                status: BdbRunnableStatus::Missing,
                command: validation_command,
                exit_code: None,
                summary: "No managed bdb executable is present yet.".into(),
                detail: None,
            },
        };
    }

    let version_check = load_bdb_tool_version_check(&executable_path, runner);
    let validation = validate_runnable(&executable_path, runner);
    let support_request_draft =
        build_support_request_draft(&source_plan, &version_check, &validation);
    let update_status = build_update_status(&source_plan, executable_exists, &version_check);
    let (status, summary, guidance) = match validation.status {
        BdbRunnableStatus::Runnable => (
            BdbToolStatus::Runnable,
            "Board's install tool is ready to use.".into(),
            "BE Home confirmed that bdb can open from its managed tools folder.".into(),
        ),
        BdbRunnableStatus::Blocked if support_request_draft.is_some() => (
            BdbToolStatus::Downloaded,
            "BE Home downloaded the Board Install Tool, but this computer is not supported by this build yet.".into(),
            "You can ask Board about OS support from this step, or switch to another supported computer.".into(),
        ),
        BdbRunnableStatus::Blocked => (
            BdbToolStatus::Downloaded,
            "BE Home found bdb, but this computer did not let it open yet.".into(),
            "Choose repair to download a fresh copy, or move the managed tools folder to a location you control.".into(),
        ),
        BdbRunnableStatus::Missing => (
            BdbToolStatus::Missing,
            "BE Home has not downloaded bdb into the managed tools folder yet.".into(),
            "Continue setup and BE Home will download Board's bdb into its managed tools folder for you.".into(),
        ),
        BdbRunnableStatus::Unsupported => (
            BdbToolStatus::Unsupported,
            "This computer is outside Board's current bdb support matrix.".into(),
            source_plan.support.guidance.clone(),
        ),
    };

    BdbToolState {
        status,
        summary,
        guidance,
        executable_path: path_to_string(&executable_path),
        executable_exists,
        storage: storage_location,
        source_plan,
        version_check,
        update_status,
        support_request_draft,
        validation,
    }
}

fn acquire_bdb_tool_with_dependencies<D: BinaryDownloader, P: ProcessRunner>(
    source_plan: bdb::BdbSourcePlan,
    storage_settings: storage::ManagedStorageSettings,
    downloader: &D,
    runner: &P,
    repair: bool,
) -> BdbAcquisitionResult {
    let initial_state = inspect_bdb_tool_state_with_plan_and_runner(
        source_plan.clone(),
        storage_settings.clone(),
        runner,
    );

    if initial_state.status == BdbToolStatus::Unsupported {
        return BdbAcquisitionResult {
            outcome: BdbAcquisitionOutcome::Unsupported,
            summary: initial_state.summary.clone(),
            guidance: initial_state.guidance.clone(),
            tool_state: initial_state,
        };
    }

    if initial_state.status == BdbToolStatus::Runnable && !repair {
        return BdbAcquisitionResult {
            outcome: BdbAcquisitionOutcome::AlreadyReady,
            summary: "Board's install tool was already ready.".into(),
            guidance: "No new download was needed.".into(),
            tool_state: initial_state,
        };
    }

    let Some(source) = source_plan.source.as_ref() else {
        return BdbAcquisitionResult {
            outcome: BdbAcquisitionOutcome::Unsupported,
            summary: initial_state.summary.clone(),
            guidance: initial_state.guidance.clone(),
            tool_state: initial_state,
        };
    };

    let download_result =
        download_and_store_bdb(&initial_state.storage, &source.download_url, downloader);
    let updated_state =
        inspect_bdb_tool_state_with_plan_and_runner(source_plan, storage_settings, runner);

    match download_result {
        Ok(()) if updated_state.status == BdbToolStatus::Runnable => {
            let outcome = if initial_state.executable_exists {
                BdbAcquisitionOutcome::Repaired
            } else {
                BdbAcquisitionOutcome::Downloaded
            };
            let summary = if outcome == BdbAcquisitionOutcome::Repaired {
                "BE Home repaired the managed bdb install.".into()
            } else {
                "BE Home downloaded Board's bdb into the managed tools folder.".into()
            };

            BdbAcquisitionResult {
                outcome,
                summary,
                guidance: "The managed bdb binary is now runnable.".into(),
                tool_state: updated_state,
            }
        }
        Ok(()) => BdbAcquisitionResult {
            outcome: BdbAcquisitionOutcome::Failed,
            summary: "BE Home downloaded bdb, but this computer still did not let it open.".into(),
            guidance: updated_state.guidance.clone(),
            tool_state: updated_state,
        },
        Err(error) => BdbAcquisitionResult {
            outcome: BdbAcquisitionOutcome::Failed,
            summary: error.summary,
            guidance: error.guidance,
            tool_state: updated_state,
        },
    }
}

fn download_and_store_bdb<D: BinaryDownloader>(
    storage_location: &storage::ManagedStorageLocation,
    download_url: &str,
    downloader: &D,
) -> Result<(), UserFacingError> {
    let executable_path = resolve_bdb_executable_path(storage_location);
    let tools_directory = executable_path
        .parent()
        .expect("bdb executable path should have a parent")
        .to_path_buf();
    let temp_path = tools_directory.join(format!("{}.download", bdb_executable_file_name()));

    let bytes = downloader.download(download_url)?;

    fs::create_dir_all(&tools_directory)
        .map_err(|error| storage_write_error(&tools_directory, &error))?;
    let _ = fs::remove_file(&temp_path);

    fs::write(&temp_path, bytes).map_err(|error| storage_write_error(&temp_path, &error))?;

    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(&temp_path)
            .map_err(|error| storage_write_error(&temp_path, &error))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&temp_path, permissions)
            .map_err(|error| storage_write_error(&temp_path, &error))?;
    }

    replace_stored_bdb_binary(&temp_path, &executable_path)
}

fn replace_stored_bdb_binary(
    temp_path: &Path,
    executable_path: &Path,
) -> Result<(), UserFacingError> {
    replace_stored_bdb_binary_with_rename(temp_path, executable_path, &mut |from, to| {
        fs::rename(from, to)
    })
}

fn replace_stored_bdb_binary_with_rename<R>(
    temp_path: &Path,
    executable_path: &Path,
    rename_file: &mut R,
) -> Result<(), UserFacingError>
where
    R: FnMut(&Path, &Path) -> io::Result<()>,
{
    let backup_path = resolve_bdb_backup_path(executable_path);
    if backup_path.exists() {
        fs::remove_file(&backup_path).map_err(|error| storage_write_error(&backup_path, &error))?;
    }

    if executable_path.exists() {
        rename_file(executable_path, &backup_path)
            .map_err(|error| storage_write_error(executable_path, &error))?;
    }

    if let Err(error) = rename_file(temp_path, executable_path) {
        if backup_path.exists() {
            let _ = rename_file(&backup_path, executable_path);
        }

        return Err(storage_write_error(executable_path, &error));
    }

    if backup_path.exists() {
        let _ = fs::remove_file(&backup_path);
    }

    Ok(())
}

fn resolve_bdb_backup_path(executable_path: &Path) -> PathBuf {
    let backup_file_name = executable_path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .map(|file_name| format!("{file_name}.previous"))
        .unwrap_or_else(|| "bdb.previous".into());
    executable_path.with_file_name(backup_file_name)
}

fn validate_runnable<P: ProcessRunner>(
    executable_path: &Path,
    runner: &P,
) -> BdbRunnableValidation {
    let command = build_validation_command(executable_path);

    match runner.run(executable_path, &[BDB_HELP_ARGUMENT]) {
        Ok(output) => BdbRunnableValidation {
            status: BdbRunnableStatus::Runnable,
            command,
            exit_code: output.exit_code,
            summary: "BE Home could open bdb from its managed tools folder.".into(),
            detail: output.exit_code.and_then(|code| {
                if code == 0 {
                    None
                } else {
                    Some(format!(
                        "bdb opened successfully and then exited with code {code}."
                    ))
                }
            }),
        },
        Err(failure) => match failure.kind {
            ProcessRunFailureKind::PermissionDenied => BdbRunnableValidation {
                status: BdbRunnableStatus::Blocked,
                command,
                exit_code: None,
                summary: "This computer would not let BE Home open the stored bdb binary.".into(),
                detail: Some(failure.detail),
            },
            ProcessRunFailureKind::NotFound => BdbRunnableValidation {
                status: BdbRunnableStatus::Missing,
                command,
                exit_code: None,
                summary:
                    "The managed bdb file was no longer present when BE Home tried to open it."
                        .into(),
                detail: Some(failure.detail),
            },
            ProcessRunFailureKind::Other => BdbRunnableValidation {
                status: BdbRunnableStatus::Blocked,
                command,
                exit_code: None,
                summary: "BE Home could not confirm that the stored bdb binary is runnable.".into(),
                detail: Some(failure.detail),
            },
        },
    }
}

fn load_bdb_tool_version_check<P: ProcessRunner>(
    executable_path: &Path,
    runner: &P,
) -> BdbToolVersionCheck {
    let command = build_version_command(executable_path);

    match runner.run(executable_path, &[BDB_VERSION_ARGUMENT]) {
        Ok(output) => {
            let combined_text = combined_output_text(&output);
            if output.exit_code == Some(0) {
                match first_non_empty_line(&combined_text) {
                    Some(version_value) => BdbToolVersionCheck {
                        status: BdbToolVersionStatus::Available,
                        command,
                        value: Some(version_value.clone()),
                        exit_code: output.exit_code,
                        summary: format!("Installed version: {version_value}"),
                        detail: None,
                    },
                    None => BdbToolVersionCheck {
                        status: BdbToolVersionStatus::Unavailable,
                        command,
                        value: None,
                        exit_code: output.exit_code,
                        summary: "BE Home could not read a version number from the Board Install Tool.".into(),
                        detail: Some(
                            "The tool opened, but it did not return a readable version line.".into(),
                        ),
                    },
                }
            } else {
                BdbToolVersionCheck {
                    status: BdbToolVersionStatus::Unavailable,
                    command,
                    value: None,
                    exit_code: output.exit_code,
                    summary: "BE Home could not confirm which Board Install Tool version is stored here.".into(),
                    detail: Some(if combined_text.is_empty() {
                        "The Board Install Tool exited before it returned a readable version line."
                            .into()
                    } else {
                        combined_text
                    }),
                }
            }
        }
        Err(failure) => BdbToolVersionCheck {
            status: BdbToolVersionStatus::Unavailable,
            command,
            value: None,
            exit_code: None,
            summary: "BE Home could not confirm which Board Install Tool version is stored here."
                .into(),
            detail: Some(failure.detail),
        },
    }
}

fn unavailable_version_check(executable_path: &Path, summary: String) -> BdbToolVersionCheck {
    BdbToolVersionCheck {
        status: BdbToolVersionStatus::Unavailable,
        command: build_version_command(executable_path),
        value: None,
        exit_code: None,
        summary,
        detail: None,
    }
}

fn build_update_status(
    source_plan: &bdb::BdbSourcePlan,
    executable_exists: bool,
    version_check: &BdbToolVersionCheck,
) -> BdbUpdateStatus {
    let available_version = source_plan.source.as_ref().and_then(|source| source.version.clone());
    let current_version = version_check.value.clone();

    if source_plan.support.status == bdb::BdbSupportStatus::Unsupported {
        return BdbUpdateStatus {
            status: BdbUpdateStatusKind::Unsupported,
            current_version,
            available_version,
            guidance: "Board does not currently publish a supported Board Install Tool download for this computer.".into(),
        };
    }

    if !executable_exists {
        return BdbUpdateStatus {
            status: BdbUpdateStatusKind::Unknown,
            current_version,
            available_version,
            guidance:
                "Download the Board Install Tool first, then use Check for Update whenever you want to compare it with Board's latest download."
                    .into(),
        };
    }

    match (&current_version, &available_version, version_check.status) {
        (Some(current), Some(available), BdbToolVersionStatus::Available) => {
            if normalized_version(current) == normalized_version(available) {
                BdbUpdateStatus {
                    status: BdbUpdateStatusKind::UpToDate,
                    current_version,
                    available_version,
                    guidance: "This Board Install Tool matches the latest version in BE Home's source list.".into(),
                }
            } else {
                BdbUpdateStatus {
                    status: BdbUpdateStatusKind::UpdateAvailable,
                    current_version,
                    available_version,
                    guidance:
                        "Board has a newer Board Install Tool version available. You can download it from this window."
                            .into(),
                }
            }
        }
        (_, Some(_), BdbToolVersionStatus::Unavailable) => BdbUpdateStatus {
            status: BdbUpdateStatusKind::Error,
            current_version,
            available_version,
            guidance:
                "BE Home could not compare the stored Board Install Tool with the latest source version just yet."
                    .into(),
        },
        _ => BdbUpdateStatus {
            status: BdbUpdateStatusKind::Unknown,
            current_version,
            available_version,
            guidance:
                "BE Home could not compare versions yet, but you can still repair or reinstall the Board Install Tool from here."
                    .into(),
        },
    }
}

fn build_support_request_draft(
    source_plan: &bdb::BdbSourcePlan,
    version_check: &BdbToolVersionCheck,
    validation: &BdbRunnableValidation,
) -> Option<SupportRequestDraft> {
    let error_text = version_check
        .detail
        .as_deref()
        .or(validation.detail.as_deref())?;
    if !looks_like_os_incompatibility(error_text) {
        return None;
    }

    let subject = BOARD_SUPPORT_SUBJECT.to_string();
    let body = format!(
        "Hello.\nI tried to use your 'bdb' application on my {} and got this error:\n\n`{}`\n\nCould you please add support for my OS?\nThank you for your help!",
        describe_host_platform(source_plan),
        error_text.trim(),
    );

    Some(SupportRequestDraft {
        to: BOARD_SUPPORT_EMAIL.into(),
        subject: subject.clone(),
        mailto_url: format!(
            "mailto:{}?subject={}&body={}",
            BOARD_SUPPORT_EMAIL,
            percent_encode_component(&subject),
            percent_encode_component(&body)
        ),
        body,
    })
}

fn looks_like_os_incompatibility(detail: &str) -> bool {
    let normalized = detail.to_ascii_lowercase();
    [
        "not compatible",
        "not a valid win32 application",
        "this app can't run on your pc",
        "bad cpu type in executable",
        "exec format error",
        "wrong architecture",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn describe_host_platform(source_plan: &bdb::BdbSourcePlan) -> String {
    let operating_system = match source_plan.support.operating_system {
        bdb::BdbOperatingSystem::Windows => "Windows",
        bdb::BdbOperatingSystem::Macos => "macOS",
        bdb::BdbOperatingSystem::Linux => "Linux",
        bdb::BdbOperatingSystem::Unknown => "Unknown OS",
    };
    let architecture = match source_plan.support.architecture {
        bdb::BdbArchitecture::X86_64 => "x86_64",
        bdb::BdbArchitecture::Aarch64 => "aarch64",
        bdb::BdbArchitecture::X86 => "x86",
        bdb::BdbArchitecture::Arm => "arm",
        bdb::BdbArchitecture::Unknown => "unknown architecture",
    };

    match source_plan.support.windows_build {
        Some(build) => format!("{operating_system} {architecture} (build {build})"),
        None => format!("{operating_system} {architecture}"),
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

fn storage_write_error(path: &Path, error: &io::Error) -> UserFacingError {
    if error.kind() == io::ErrorKind::PermissionDenied {
        return UserFacingError {
            summary: "BE Home could not save bdb in its managed tools folder.".into(),
            guidance:
                "Choose a different tools folder in settings or close anything that may be locking the file."
                    .into(),
        };
    }

    UserFacingError {
        summary: "BE Home could not finish saving bdb in its managed tools folder.".into(),
        guidance: format!(
            "Check that `{}` is still available, then try again.",
            path.display()
        ),
    }
}

fn resolve_bdb_executable_path(storage_location: &storage::ManagedStorageLocation) -> PathBuf {
    PathBuf::from(&storage_location.effective_path).join(bdb_executable_file_name())
}

fn build_version_command(executable_path: &Path) -> String {
    format!("{} {}", executable_path.display(), BDB_VERSION_ARGUMENT)
}

fn build_validation_command(executable_path: &Path) -> String {
    format!("{} {}", executable_path.display(), BDB_HELP_ARGUMENT)
}

fn normalized_version(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn percent_encode_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'.'
            | b'_'
            | b'~' => vec![byte as char].into_iter().collect::<Vec<_>>(),
            b' ' => vec!['%','2','0'],
            _ => format!("%{byte:02X}").chars().collect::<Vec<_>>(),
        })
        .collect()
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
        acquire_bdb_tool_with_dependencies, bdb_executable_file_name,
        inspect_bdb_tool_state_with_plan_and_runner, replace_stored_bdb_binary_with_rename,
        resolve_bdb_backup_path, BdbAcquisitionOutcome, BdbRunnableStatus, BdbToolStatus,
        BinaryDownloader, ProcessRunFailure, ProcessRunFailureKind, ProcessRunOutput,
        ProcessRunner, UserFacingError,
    };
    use crate::{
        bdb::{
            BdbArchitecture, BdbDownloadSource, BdbOperatingSystem, BdbPlatformSupport,
            BdbSourcePlan, BdbSupportStatus,
        },
        storage::{
            ManagedStorageLocation, ManagedStoragePathSource, ManagedStorageSettings,
            StorageOperatingSystem,
        },
    };
    use std::fs;
    use std::io;
    use std::path::{Path, PathBuf};

    struct StaticDownloader {
        response: Result<Vec<u8>, UserFacingError>,
    }

    impl BinaryDownloader for StaticDownloader {
        fn download(&self, _url: &str) -> Result<Vec<u8>, UserFacingError> {
            self.response.clone()
        }
    }

    struct ContentAwareRunner;

    impl ProcessRunner for ContentAwareRunner {
        fn run(
            &self,
            executable_path: &Path,
            _args: &[&str],
        ) -> Result<ProcessRunOutput, ProcessRunFailure> {
            let content = fs::read_to_string(executable_path).unwrap_or_default();
            match content.as_str() {
                "fresh-bdb" => Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Board OS Version: 1.8.1".into(),
                    stderr: String::new(),
                }),
                "odd-but-runnable" => Ok(ProcessRunOutput {
                    exit_code: Some(1),
                    stdout: String::new(),
                    stderr: "unexpected exit".into(),
                }),
                "blocked-bdb" => Err(ProcessRunFailure {
                    kind: ProcessRunFailureKind::PermissionDenied,
                    detail: "The operating system denied access to the file.".into(),
                }),
                _ => Err(ProcessRunFailure {
                    kind: ProcessRunFailureKind::Other,
                    detail: "The stored file did not behave like bdb.".into(),
                }),
            }
        }
    }

    #[test]
    fn missing_tool_state_is_reported_before_any_download() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");

        let state = inspect_bdb_tool_state_with_plan_and_runner(
            supported_source_plan(),
            managed_storage_settings(temp_directory.path()),
            &ContentAwareRunner,
        );

        assert_eq!(BdbToolStatus::Missing, state.status);
        assert_eq!(BdbRunnableStatus::Missing, state.validation.status);
    }

    #[test]
    fn successful_download_reports_a_runnable_tool() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let settings = managed_storage_settings(temp_directory.path());

        let result = acquire_bdb_tool_with_dependencies(
            supported_source_plan(),
            settings.clone(),
            &StaticDownloader {
                response: Ok(b"fresh-bdb".to_vec()),
            },
            &ContentAwareRunner,
            false,
        );

        assert_eq!(BdbAcquisitionOutcome::Downloaded, result.outcome);
        assert_eq!(BdbToolStatus::Runnable, result.tool_state.status);
        assert_eq!(
            "fresh-bdb",
            fs::read_to_string(resolve_expected_executable_path(&settings))
                .expect("downloaded binary should be written")
        );
    }

    #[test]
    fn repair_replaces_a_blocked_binary_without_manual_cleanup() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let settings = managed_storage_settings(temp_directory.path());
        let executable_path = resolve_expected_executable_path(&settings);
        fs::create_dir_all(
            executable_path
                .parent()
                .expect("executable should have parent"),
        )
        .expect("tools directory should exist");
        fs::write(&executable_path, "blocked-bdb").expect("blocked binary should exist");

        let result = acquire_bdb_tool_with_dependencies(
            supported_source_plan(),
            settings.clone(),
            &StaticDownloader {
                response: Ok(b"fresh-bdb".to_vec()),
            },
            &ContentAwareRunner,
            false,
        );

        assert_eq!(BdbAcquisitionOutcome::Repaired, result.outcome);
        assert_eq!(BdbToolStatus::Runnable, result.tool_state.status);
        assert_eq!(
            "fresh-bdb",
            fs::read_to_string(resolve_expected_executable_path(&settings))
                .expect("repaired binary should replace the blocked copy")
        );
    }

    #[test]
    fn blocked_binary_after_download_is_reported_as_downloaded_but_not_runnable() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let settings = managed_storage_settings(temp_directory.path());

        let result = acquire_bdb_tool_with_dependencies(
            supported_source_plan(),
            settings,
            &StaticDownloader {
                response: Ok(b"blocked-bdb".to_vec()),
            },
            &ContentAwareRunner,
            false,
        );

        assert_eq!(BdbAcquisitionOutcome::Failed, result.outcome);
        assert_eq!(BdbToolStatus::Downloaded, result.tool_state.status);
        assert_eq!(
            BdbRunnableStatus::Blocked,
            result.tool_state.validation.status
        );
    }

    #[test]
    fn failed_replacement_restores_the_previous_bdb_binary() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let settings = managed_storage_settings(temp_directory.path());
        let executable_path = resolve_expected_executable_path(&settings);
        let temp_path = executable_path
            .parent()
            .expect("executable should have parent")
            .join(format!("{}.download", bdb_executable_file_name()));

        fs::create_dir_all(
            executable_path
                .parent()
                .expect("executable should have parent"),
        )
        .expect("tools directory should exist");
        fs::write(&executable_path, "fresh-bdb").expect("existing binary should exist");
        fs::write(&temp_path, "blocked-bdb").expect("downloaded replacement should exist");

        let mut rename_attempt = 0;
        let result =
            replace_stored_bdb_binary_with_rename(&temp_path, &executable_path, &mut |from, to| {
                rename_attempt += 1;
                if rename_attempt == 2 {
                    return Err(io::Error::new(io::ErrorKind::Other, "simulated rename failure"));
                }

                fs::rename(from, to)
            });

        assert!(result.is_err());
        assert_eq!(
            "fresh-bdb",
            fs::read_to_string(&executable_path)
                .expect("previous binary should be restored after a failed replacement")
        );
        assert_eq!(
            "blocked-bdb",
            fs::read_to_string(&temp_path)
                .expect("downloaded temp file should remain available after the failed replacement")
        );
        assert!(!resolve_bdb_backup_path(&executable_path).exists());
    }

    #[test]
    fn unsupported_plan_surfaces_actionable_guidance() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let state = inspect_bdb_tool_state_with_plan_and_runner(
            unsupported_source_plan(),
            managed_storage_settings(temp_directory.path()),
            &ContentAwareRunner,
        );

        assert_eq!(BdbToolStatus::Unsupported, state.status);
        assert!(state
            .guidance
            .contains("Board currently publishes bdb only"));
    }

    fn supported_source_plan() -> BdbSourcePlan {
        BdbSourcePlan {
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
        }
    }

    fn unsupported_source_plan() -> BdbSourcePlan {
        BdbSourcePlan {
            manifest_source: "bundled".into(),
            remote_manifest_url: "https://example.com/bdb-sources.json".into(),
            manifest_cache_path: None,
            manifest_schema_version: 1,
            support: BdbPlatformSupport {
                status: BdbSupportStatus::Unsupported,
                operating_system: BdbOperatingSystem::Linux,
                architecture: BdbArchitecture::Arm,
                windows_build: None,
                platform_key: None,
                reason: None,
                guidance:
                    "Board currently publishes bdb only for macOS, Linux amd64, and Windows 11 x86_64."
                        .into(),
            },
            source: None,
        }
    }

    fn managed_storage_settings(root: &Path) -> ManagedStorageSettings {
        let tools_path = root.join("tools");
        let apk_library_path = root.join("apk-library");

        ManagedStorageSettings {
            operating_system: StorageOperatingSystem::Linux,
            settings_file_path: root
                .join("settings")
                .join("managed-storage.json")
                .to_string_lossy()
                .into_owned(),
            bdb_tools: ManagedStorageLocation {
                default_path: tools_path.to_string_lossy().into_owned(),
                override_path: None,
                effective_path: tools_path.to_string_lossy().into_owned(),
                source: ManagedStoragePathSource::Default,
            },
            apk_library: ManagedStorageLocation {
                default_path: apk_library_path.to_string_lossy().into_owned(),
                override_path: None,
                effective_path: apk_library_path.to_string_lossy().into_owned(),
                source: ManagedStoragePathSource::Default,
            },
        }
    }

    fn resolve_expected_executable_path(settings: &ManagedStorageSettings) -> PathBuf {
        let file_name = if cfg!(target_os = "windows") {
            "bdb.exe"
        } else {
            "bdb"
        };

        PathBuf::from(&settings.bdb_tools.effective_path).join(file_name)
    }
}
