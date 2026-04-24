use crate::storage;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// Describes whether a candidate came from configured scan folders or a manual file pick.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ApkCandidateSource {
    ScanFolder,
    ManualSelection,
}

/// Describes whether the current APK discovery result has content to show.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ApkDiscoveryStatus {
    Ready,
    Empty,
}

/// Describes one locally discovered APK candidate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApkCandidate {
    pub(crate) stable_id: String,
    pub(crate) file_name: String,
    pub(crate) source_path: String,
    pub(crate) discovery_source: ApkCandidateSource,
    pub(crate) discovered_from_path: Option<String>,
    pub(crate) file_size_bytes: u64,
}

/// Describes the current APK discovery snapshot built from configured scan folders.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApkDiscoverySnapshot {
    pub(crate) status: ApkDiscoveryStatus,
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) candidates: Vec<ApkCandidate>,
}

/// Represents the manual APK path request accepted by the desktop host.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualApkPathInput {
    path: String,
}

/// Scan the configured folders for local APK candidates.
pub(crate) fn load_current_apk_discovery_snapshot() -> Result<ApkDiscoverySnapshot, String> {
    let settings = storage::load_desktop_settings()?;
    Ok(build_apk_discovery_snapshot(
        settings
            .scan_folders
            .iter()
            .map(|folder| folder.path.clone())
            .collect(),
    ))
}

/// Inspect one manually selected APK path and normalize it into the shared candidate model.
pub(crate) fn inspect_manual_apk_path(input: ManualApkPathInput) -> Result<ApkCandidate, String> {
    let path = normalize_apk_path(&input.path)?;
    build_apk_candidate(&path, ApkCandidateSource::ManualSelection, None)
}

fn build_apk_discovery_snapshot(scan_folder_paths: Vec<String>) -> ApkDiscoverySnapshot {
    let mut candidates_by_key = BTreeMap::new();

    for scan_folder_path in scan_folder_paths {
        let folder_path = PathBuf::from(&scan_folder_path);
        if !folder_path.exists() || !folder_path.is_dir() {
            continue;
        }

        for apk_path in walk_apk_files(&folder_path) {
            if let Ok(candidate) = build_apk_candidate(
                &apk_path,
                ApkCandidateSource::ScanFolder,
                Some(scan_folder_path.clone()),
            ) {
                candidates_by_key.entry(candidate.stable_id.clone()).or_insert(candidate);
            }
        }
    }

    let mut candidates = candidates_by_key.into_values().collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.file_name
            .to_ascii_lowercase()
            .cmp(&right.file_name.to_ascii_lowercase())
            .then_with(|| left.source_path.cmp(&right.source_path))
    });

    if candidates.is_empty() {
        return ApkDiscoverySnapshot {
            status: ApkDiscoveryStatus::Empty,
            summary: "BE Home did not find any APK files in the current scan folders yet.".into(),
            guidance:
                "Choose a manual APK when you already know the file you want, or add another scan folder in settings."
                    .into(),
            candidates,
        };
    }

    ApkDiscoverySnapshot {
        status: ApkDiscoveryStatus::Ready,
        summary: format!("BE Home found {} APK file(s) across the current scan folders.", candidates.len()),
        guidance:
            "Use rescan after you add new downloads to a watched folder, or choose a file manually when you already know where it lives."
                .into(),
        candidates,
    }
}

fn walk_apk_files(root: &Path) -> Vec<PathBuf> {
    let mut directories = vec![root.to_path_buf()];
    let mut visited_directories = HashSet::new();
    let mut apk_paths = Vec::new();

    while let Some(directory) = directories.pop() {
        let canonical_directory =
            fs::canonicalize(&directory).unwrap_or_else(|_| directory.clone());
        if !visited_directories.insert(canonical_directory) {
            continue;
        }

        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if file_type.is_dir() {
                directories.push(path);
                continue;
            }

            if file_type.is_symlink() {
                if path.is_file() && is_apk_path(&path) {
                    apk_paths.push(path);
                }
                continue;
            }

            if is_apk_path(&path) {
                apk_paths.push(path);
            }
        }
    }

    apk_paths
}

fn build_apk_candidate(
    path: &Path,
    discovery_source: ApkCandidateSource,
    discovered_from_path: Option<String>,
) -> Result<ApkCandidate, String> {
    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "BE Home could not read the APK file at `{}`: {error}",
            path.display()
        )
    })?;

    let absolute_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("BE Home could not resolve the current working directory: {error}"))?
            .join(path)
    };

    let source_path = path_to_string(&absolute_path);
    let file_name = absolute_path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .map(str::to_owned)
        .ok_or_else(|| {
            format!(
                "BE Home could not read a usable file name from `{}`.",
                absolute_path.display()
            )
        })?;

    Ok(ApkCandidate {
        stable_id: format!("apk:{}", path_identity_key(&source_path)),
        file_name,
        source_path,
        discovery_source,
        discovered_from_path,
        file_size_bytes: metadata.len(),
    })
}

fn normalize_apk_path(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Choose an APK file before asking BE Home to inspect it.".into());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("BE Home expects an absolute APK path from the file picker.".into());
    }

    if !path.exists() {
        return Err(format!(
            "BE Home could not find the APK file at `{}` anymore.",
            path.display()
        ));
    }

    if !path.is_file() {
        return Err("Choose an APK file, not a folder, so BE Home can inspect it.".into());
    }

    if !is_apk_path(&path) {
        return Err("Choose an `.apk` file so BE Home can inspect it.".into());
    }

    Ok(path)
}

fn is_apk_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("apk"))
}

fn path_identity_key(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        path.to_lowercase()
    }

    #[cfg(not(target_os = "windows"))]
    {
        path.to_owned()
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        build_apk_candidate, build_apk_discovery_snapshot, inspect_manual_apk_path,
        ApkCandidateSource, ApkDiscoveryStatus, ManualApkPathInput,
    };
    use std::fs;
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    #[test]
    fn discovery_snapshot_walks_nested_scan_folders_and_deduplicates_results() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let root = temp_directory.path();
        let downloads = root.join("Downloads");
        let nested = downloads.join("nested");
        fs::create_dir_all(&nested).expect("nested folder should exist");
        fs::write(downloads.join("LuckyDice.apk"), "apk").expect("top-level apk should exist");
        fs::write(nested.join("FamilyMatch.apk"), "apk").expect("nested apk should exist");

        let snapshot = build_apk_discovery_snapshot(vec![
            downloads.to_string_lossy().into_owned(),
            nested.to_string_lossy().into_owned(),
        ]);

        assert_eq!(ApkDiscoveryStatus::Ready, snapshot.status);
        assert_eq!(2, snapshot.candidates.len());
    }

    #[test]
    fn discovery_snapshot_reports_empty_when_no_apks_are_found() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let downloads = temp_directory.path().join("Downloads");
        fs::create_dir_all(&downloads).expect("downloads should exist");
        fs::write(downloads.join("notes.txt"), "not an apk").expect("text file should exist");

        let snapshot = build_apk_discovery_snapshot(vec![downloads.to_string_lossy().into_owned()]);

        assert_eq!(ApkDiscoveryStatus::Empty, snapshot.status);
        assert!(snapshot.candidates.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn discovery_snapshot_skips_symlinked_directory_cycles() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let downloads = temp_directory.path().join("Downloads");
        let nested = downloads.join("nested");
        fs::create_dir_all(&nested).expect("nested folder should exist");
        fs::write(nested.join("LuckyDice.apk"), "apk").expect("apk should exist");
        symlink(&downloads, nested.join("loop")).expect("directory symlink should exist");

        let snapshot = build_apk_discovery_snapshot(vec![downloads.to_string_lossy().into_owned()]);

        assert_eq!(ApkDiscoveryStatus::Ready, snapshot.status);
        assert_eq!(1, snapshot.candidates.len());
    }

    #[test]
    fn manual_apk_inspection_requires_an_absolute_apk_path() {
        let result = inspect_manual_apk_path(ManualApkPathInput {
            path: "LuckyDice.apk".into(),
        });

        assert!(result.is_err());
    }

    #[test]
    fn manual_apk_inspection_returns_a_manual_candidate() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let apk_path = temp_directory.path().join("LuckyDice.apk");
        fs::write(&apk_path, "apk").expect("apk should exist");

        let candidate = inspect_manual_apk_path(ManualApkPathInput {
            path: apk_path.to_string_lossy().into_owned(),
        })
        .expect("manual apk inspection should succeed");

        assert_eq!(ApkCandidateSource::ManualSelection, candidate.discovery_source);
        assert_eq!("LuckyDice.apk", candidate.file_name);
        assert_eq!(None, candidate.discovered_from_path);
    }

    #[test]
    fn manual_apk_inspection_rejects_directories_named_like_apks() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let directory_path = temp_directory.path().join("LuckyDice.apk");
        fs::create_dir_all(&directory_path).expect("directory should exist");

        let result = inspect_manual_apk_path(ManualApkPathInput {
            path: directory_path.to_string_lossy().into_owned(),
        });

        assert!(result
            .expect_err("directory paths should be rejected")
            .contains("not a folder"));
    }

    #[test]
    fn scan_candidates_preserve_the_scan_folder_they_were_found_from() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let scan_folder = temp_directory.path().join("Downloads");
        let apk_path = scan_folder.join("LuckyDice.apk");
        fs::create_dir_all(&scan_folder).expect("downloads should exist");
        fs::write(&apk_path, "apk").expect("apk should exist");

        let candidate = build_apk_candidate(
            &PathBuf::from(&apk_path),
            ApkCandidateSource::ScanFolder,
            Some(scan_folder.to_string_lossy().into_owned()),
        )
        .expect("candidate should build");

        assert_eq!(
            Some(scan_folder.to_string_lossy().into_owned()),
            candidate.discovered_from_path
        );
    }
}
