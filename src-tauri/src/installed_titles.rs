use crate::{bdb_tool, device};
use serde::Serialize;
use std::collections::BTreeSet;
use std::io;
use std::path::Path;
use std::process::Command;

const BDB_LIST_ARGUMENT: &str = "list";

/// Describes whether the installed-title inventory is ready, empty, or temporarily unavailable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum InstalledTitlesStatus {
    Ready,
    Empty,
    Unavailable,
}

/// Describes one title currently reported by `bdb list`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledTitle {
    pub(crate) stable_id: String,
    pub(crate) display_name: String,
    pub(crate) package_name: Option<String>,
    pub(crate) subtitle: Option<String>,
    pub(crate) can_launch: bool,
    pub(crate) can_uninstall: bool,
}

/// Describes the current installed-title inventory model for Board.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledTitlesSnapshot {
    pub(crate) status: InstalledTitlesStatus,
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) titles: Vec<InstalledTitle>,
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
    _detail: String,
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

/// Load the current installed-title snapshot reported by `bdb list`.
pub(crate) fn load_current_installed_titles_snapshot() -> Result<InstalledTitlesSnapshot, String> {
    let device_status = device::load_current_device_status_snapshot()?;
    let tool_state = bdb_tool::load_current_bdb_tool_state()?;

    Ok(load_installed_titles_snapshot_with_runner(
        &device_status,
        &tool_state,
        &CommandProcessRunner,
    ))
}

fn load_installed_titles_snapshot_with_runner<P: ProcessRunner>(
    device_status: &device::DeviceStatusSnapshot,
    tool_state: &bdb_tool::BdbToolState,
    runner: &P,
) -> InstalledTitlesSnapshot {
    if device_status.status != device::DeviceStatusKind::BoardConnected {
        return InstalledTitlesSnapshot {
            status: InstalledTitlesStatus::Unavailable,
            summary: unavailable_summary_for_device_status(device_status.status).into(),
            guidance: device_status.guidance.clone(),
            titles: Vec::new(),
        };
    }

    if tool_state.status != bdb_tool::BdbToolStatus::Runnable {
        return InstalledTitlesSnapshot {
            status: InstalledTitlesStatus::Unavailable,
            summary: "BE Home could not trust the managed Board tool enough to refresh the installed-title list."
                .into(),
            guidance: tool_state.guidance.clone(),
            titles: Vec::new(),
        };
    }

    match runner.run(Path::new(&tool_state.executable_path), &[BDB_LIST_ARGUMENT]) {
        Ok(output) => normalize_list_output(output),
        Err(failure) => {
            let (summary, guidance) = match failure.kind {
                ProcessRunFailureKind::PermissionDenied => (
                    "BE Home could not reopen Board's install tool to refresh the installed-title list."
                        .into(),
                    "Repair bdb from settings, then refresh the installed titles again.".into(),
                ),
                ProcessRunFailureKind::NotFound => (
                    "The managed Board install tool was missing when BE Home tried to refresh the installed-title list."
                        .into(),
                    "Repair or re-download bdb from settings, then refresh again.".into(),
                ),
                ProcessRunFailureKind::Other => (
                    "BE Home could not finish reading the installed-title list from Board right now."
                        .into(),
                    "Reconnect Board if needed, then refresh the installed titles again.".into(),
                ),
            };

            InstalledTitlesSnapshot {
                status: InstalledTitlesStatus::Unavailable,
                summary,
                guidance,
                titles: Vec::new(),
            }
        }
    }
}

fn unavailable_summary_for_device_status(status: device::DeviceStatusKind) -> &'static str {
    match status {
        device::DeviceStatusKind::ToolMissing => {
            "Board's install tool needs to be downloaded before the installed-title list can load."
        }
        device::DeviceStatusKind::ToolBroken => {
            "Board's install tool needs repair before the installed-title list can load."
        }
        device::DeviceStatusKind::UnsupportedHost => {
            "This computer is outside Board's current support for the installed-title workflow."
        }
        device::DeviceStatusKind::BoardDisconnected => {
            "Connect Board before refreshing what is already installed."
        }
        device::DeviceStatusKind::ExecutionError => {
            "BE Home needs a clean Board connection check before it can trust the installed-title list."
        }
        device::DeviceStatusKind::BoardConnected => {
            "The installed-title list is temporarily unavailable."
        }
    }
}

fn normalize_list_output(output: ProcessRunOutput) -> InstalledTitlesSnapshot {
    let combined_output = combined_output_text(&output);
    let titles = parse_installed_titles(&combined_output);

    if output.exit_code != Some(0) && titles.is_empty() {
        return InstalledTitlesSnapshot {
            status: InstalledTitlesStatus::Unavailable,
            summary: "BE Home could not finish reading the installed-title list from Board yet."
                .into(),
            guidance:
                "Reconnect Board if needed, then refresh the installed titles again.".into(),
            titles,
        };
    }

    if titles.is_empty() {
        if combined_output.trim().is_empty() {
            return InstalledTitlesSnapshot {
                status: InstalledTitlesStatus::Empty,
                summary: "Board did not report any installed titles yet.".into(),
                guidance: "Once you install something, it will show up here so uninstall and launch actions can stay close by.".into(),
                titles,
            };
        }

        return InstalledTitlesSnapshot {
            status: InstalledTitlesStatus::Unavailable,
            summary: "BE Home could not turn the latest installed-title response into a reliable list yet."
                .into(),
            guidance:
                "Refresh the installed titles again. If this keeps happening, reconnect Board and try once more."
                    .into(),
            titles,
        };
    }

    InstalledTitlesSnapshot {
        status: InstalledTitlesStatus::Ready,
        summary: format!("Board reported {} installed title(s).", titles.len()),
        guidance:
            "This list is ready for the later uninstall and launch actions that stay tied to package identity."
                .into(),
        titles,
    }
}

fn parse_installed_titles(output_text: &str) -> Vec<InstalledTitle> {
    let mut titles = Vec::new();
    let mut seen_ids = BTreeSet::new();

    for (index, line) in output_text.lines().enumerate() {
        let Some(title) = parse_installed_title_line(index, line) else {
            continue;
        };

        if seen_ids.insert(title.stable_id.clone()) {
            titles.push(title);
        }
    }

    titles
}

fn parse_installed_title_line(index: usize, line: &str) -> Option<InstalledTitle> {
    let normalized_line = trim_inventory_prefix(line.trim());
    if normalized_line.is_empty() {
        return None;
    }

    let package_name = extract_package_name(normalized_line);
    let display_name = normalize_display_name(normalized_line, package_name.as_deref());
    if package_name.is_none() && !display_name.chars().any(|character| character.is_ascii_alphanumeric()) {
        return None;
    }
    let stable_id = build_stable_id(&display_name, package_name.as_deref(), index);
    let subtitle = package_name
        .as_ref()
        .filter(|package_name| *package_name != &display_name)
        .cloned();
    let can_launch = package_name.is_some();
    let can_uninstall = package_name.is_some();

    Some(InstalledTitle {
        stable_id,
        display_name,
        package_name,
        subtitle,
        can_launch,
        can_uninstall,
    })
}

fn extract_package_name(line: &str) -> Option<String> {
    extract_parenthetical_package(line).or_else(|| {
        line.split(|character: char| {
            character.is_whitespace()
                || matches!(character, ',' | ';' | '|' | '(' | ')' | '[' | ']')
        })
        .filter_map(normalize_package_candidate)
        .find(|candidate| looks_like_package_name(candidate))
    })
}

fn extract_parenthetical_package(line: &str) -> Option<String> {
    let open_index = line.rfind('(')?;
    let close_index = line.rfind(')')?;
    if close_index <= open_index {
        return None;
    }

    let candidate = line[(open_index + 1)..close_index].trim();
    if looks_like_package_name(candidate) {
        Some(candidate.to_owned())
    } else {
        None
    }
}

fn normalize_package_candidate(token: &str) -> Option<String> {
    let trimmed = token.trim_matches(|character: char| {
        matches!(character, ',' | ';' | '|' | '(' | ')' | '[' | ']' | '"' | '\'')
    });
    if trimmed.is_empty() {
        return None;
    }

    let candidate = trimmed
        .split(['=', ':'])
        .next_back()
        .unwrap_or(trimmed)
        .trim();
    if candidate.is_empty() {
        return None;
    }

    Some(candidate.to_owned())
}

fn normalize_display_name(line: &str, package_name: Option<&str>) -> String {
    let mut cleaned = line.to_owned();
    if let Some(package_name) = package_name {
        cleaned = cleaned.replace(package_name, " ");
    }

    for pattern in [
        "package=",
        "package =",
        "package:",
        "package :",
        "title=",
        "title =",
        "title:",
        "title :",
        "name=",
        "name =",
        "name:",
        "name :",
        "app=",
        "app =",
        "app:",
        "app :",
        "bundle=",
        "bundle =",
        "bundle:",
        "bundle :",
        "identifier=",
        "identifier =",
        "identifier:",
        "identifier :",
        "appId=",
        "appId =",
        "appId:",
        "appId :",
        "|",
        " - ",
        ",",
        ";",
        "(",
        ")",
        "[",
        "]",
    ] {
        cleaned = cleaned.replace(pattern, " ");
    }

    let display_name = cleaned
        .split_whitespace()
        .filter(|segment| {
            let lowered = segment.to_ascii_lowercase();
            !matches!(
                lowered.as_str(),
                "package" | "title" | "name" | "app" | "bundle" | "identifier" | "appid"
            )
        })
        .collect::<Vec<_>>()
        .join(" ");

    if display_name.is_empty() {
        package_name.unwrap_or(line).to_owned()
    } else {
        display_name
    }
}

fn build_stable_id(display_name: &str, package_name: Option<&str>, index: usize) -> String {
    package_name
        .map(|package_name| format!("package:{package_name}"))
        .unwrap_or_else(|| format!("title:{}:{index}", slugify(display_name)))
}

fn slugify(value: &str) -> String {
    let slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();

    if slug.is_empty() {
        "installed-title".into()
    } else {
        slug
    }
}

fn looks_like_package_name(value: &str) -> bool {
    if value.contains(' ') || !value.contains('.') {
        return false;
    }

    let segments = value.split('.').collect::<Vec<_>>();
    if segments.len() < 2 || segments.iter().any(|segment| segment.is_empty()) {
        return false;
    }

    value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
    }) && value.chars().any(|character| character.is_ascii_lowercase())
}

fn trim_inventory_prefix(line: &str) -> &str {
    let digits = line.chars().take_while(|character| character.is_ascii_digit()).count();
    if digits == 0 {
        return line;
    }

    let remainder = &line[digits..];
    if let Some(stripped) = remainder
        .strip_prefix('.')
        .or_else(|| remainder.strip_prefix(')'))
    {
        stripped.trim_start()
    } else {
        line
    }
}

fn combined_output_text(output: &ProcessRunOutput) -> String {
    [output.stdout.trim(), output.stderr.trim()]
        .into_iter()
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn classify_process_failure(error: io::Error) -> ProcessRunFailure {
    let kind = match error.kind() {
        io::ErrorKind::PermissionDenied => ProcessRunFailureKind::PermissionDenied,
        io::ErrorKind::NotFound => ProcessRunFailureKind::NotFound,
        _ => ProcessRunFailureKind::Other,
    };

    ProcessRunFailure {
        kind,
        _detail: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        load_installed_titles_snapshot_with_runner, parse_installed_titles, InstalledTitlesStatus,
        ProcessRunFailure, ProcessRunOutput, ProcessRunner,
    };
    use crate::{
        bdb::{
            BdbArchitecture, BdbDownloadSource, BdbOperatingSystem, BdbPlatformSupport,
            BdbSourcePlan, BdbSupportStatus,
        },
        bdb_tool::{BdbRunnableStatus, BdbRunnableValidation, BdbToolState, BdbToolStatus},
        device::{BdbVersionDetails, BdbVersionStatus, DeviceStatusKind, DeviceStatusSnapshot},
        storage::{ManagedStorageLocation, ManagedStoragePathSource},
    };
    use std::path::Path;

    struct StaticRunner {
        result: Result<ProcessRunOutput, ProcessRunFailure>,
    }

    impl ProcessRunner for StaticRunner {
        fn run(
            &self,
            _executable_path: &Path,
            _args: &[&str],
        ) -> Result<ProcessRunOutput, ProcessRunFailure> {
            self.result.clone()
        }
    }

    #[test]
    fn parser_handles_package_only_lines() {
        let titles = parse_installed_titles("co.board.luckydice\ncom.example.familymatch");

        assert_eq!(2, titles.len());
        assert_eq!(Some("co.board.luckydice"), titles[0].package_name.as_deref());
        assert_eq!("co.board.luckydice", titles[0].display_name);
    }

    #[test]
    fn parser_handles_titles_with_parenthetical_packages() {
        let titles = parse_installed_titles("1. Lucky Dice (co.board.luckydice)");

        assert_eq!(1, titles.len());
        assert_eq!("Lucky Dice", titles[0].display_name);
        assert_eq!(Some("co.board.luckydice"), titles[0].package_name.as_deref());
        assert!(titles[0].can_launch);
    }

    #[test]
    fn parser_handles_labelled_package_lines() {
        let titles = parse_installed_titles("title=Family Match package=fun.board.familymatch");

        assert_eq!(1, titles.len());
        assert_eq!("Family Match", titles[0].display_name);
        assert_eq!(
            Some("fun.board.familymatch"),
            titles[0].package_name.as_deref()
        );
    }

    #[test]
    fn connected_device_loads_a_ready_inventory_snapshot() {
        let snapshot = load_installed_titles_snapshot_with_runner(
            &connected_device_status(),
            &runnable_tool_state(),
            &StaticRunner {
                result: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "Lucky Dice (co.board.luckydice)\nFamily Match | fun.board.familymatch".into(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(InstalledTitlesStatus::Ready, snapshot.status);
        assert_eq!(2, snapshot.titles.len());
        assert_eq!(Some("co.board.luckydice"), snapshot.titles[0].package_name.as_deref());
    }

    #[test]
    fn disconnected_device_keeps_inventory_unavailable() {
        let snapshot = load_installed_titles_snapshot_with_runner(
            &device_status(DeviceStatusKind::BoardDisconnected),
            &runnable_tool_state(),
            &StaticRunner {
                result: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(InstalledTitlesStatus::Unavailable, snapshot.status);
        assert!(snapshot.summary.contains("Connect Board"));
    }

    #[test]
    fn empty_output_becomes_an_explicit_empty_state() {
        let snapshot = load_installed_titles_snapshot_with_runner(
            &connected_device_status(),
            &runnable_tool_state(),
            &StaticRunner {
                result: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(InstalledTitlesStatus::Empty, snapshot.status);
        assert!(snapshot.titles.is_empty());
    }

    #[test]
    fn malformed_output_becomes_an_unavailable_state() {
        let snapshot = load_installed_titles_snapshot_with_runner(
            &connected_device_status(),
            &runnable_tool_state(),
            &StaticRunner {
                result: Ok(ProcessRunOutput {
                    exit_code: Some(0),
                    stdout: "::::\n====".into(),
                    stderr: String::new(),
                }),
            },
        );

        assert_eq!(InstalledTitlesStatus::Unavailable, snapshot.status);
        assert!(snapshot.titles.is_empty());
    }

    fn connected_device_status() -> DeviceStatusSnapshot {
        device_status(DeviceStatusKind::BoardConnected)
    }

    fn device_status(status: DeviceStatusKind) -> DeviceStatusSnapshot {
        DeviceStatusSnapshot {
            status,
            summary: "sample device summary".into(),
            guidance: "sample device guidance".into(),
            detail: None,
            poll_interval_ms: 5_000,
            bdb_version: BdbVersionDetails {
                status: BdbVersionStatus::Available,
                command: "bdb version".into(),
                value: Some("bdb 0.19.0".into()),
                exit_code: Some(0),
                summary: "version summary".into(),
                detail: None,
            },
        }
    }

    fn runnable_tool_state() -> BdbToolState {
        BdbToolState {
            status: BdbToolStatus::Runnable,
            summary: "sample summary".into(),
            guidance: "sample guidance".into(),
            executable_path: "/tmp/bdb".into(),
            executable_exists: true,
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
                status: BdbRunnableStatus::Runnable,
                command: "/tmp/bdb help".into(),
                exit_code: Some(0),
                summary: "validation summary".into(),
                detail: None,
            },
        }
    }
}
