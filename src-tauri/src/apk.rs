use crate::storage;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

const BOARD_STRONG_MARKER: &str = "libnativeBoardSDK.so";

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

/// Describes the Board-confidence level detected for one APK candidate.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ApkConfidence {
    StrongMatch,
    PossibleMatch,
    Unknown,
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
    pub(crate) package_name: Option<String>,
    pub(crate) confidence: ApkConfidence,
    pub(crate) confidence_summary: String,
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

#[derive(Clone, Debug)]
struct ApkInspection {
    package_name: Option<String>,
    confidence: ApkConfidence,
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

/// Inspect an APK file directly so other host modules can reuse the shared heuristic model.
pub(crate) fn inspect_apk_file(path: &Path) -> Result<ApkCandidate, String> {
    build_apk_candidate(path, ApkCandidateSource::ManualSelection, None)
}

fn build_apk_discovery_snapshot(scan_folder_paths: Vec<String>) -> ApkDiscoverySnapshot {
    let mut candidates_by_key = BTreeMap::new();
    let mut scanned_apk_count = 0usize;

    for scan_folder_path in scan_folder_paths {
        let folder_path = PathBuf::from(&scan_folder_path);
        if !folder_path.exists() || !folder_path.is_dir() {
            continue;
        }

        for apk_path in walk_apk_files(&folder_path) {
            scanned_apk_count += 1;
            if let Ok(candidate) = build_apk_candidate(
                &apk_path,
                ApkCandidateSource::ScanFolder,
                Some(scan_folder_path.clone()),
            ) {
                if candidate.confidence == ApkConfidence::StrongMatch {
                    candidates_by_key.entry(candidate.stable_id.clone()).or_insert(candidate);
                }
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
            summary: if scanned_apk_count == 0 {
                "BE Home did not find any APK files in the current scan folders yet.".into()
            } else {
                "BE Home found APK files, but none of them showed the strongest Board marker yet."
                    .into()
            },
            guidance:
                "Choose a manual APK when you already know the file you want, or add another scan folder in settings."
                    .into(),
            candidates,
        };
    }

    ApkDiscoverySnapshot {
        status: ApkDiscoveryStatus::Ready,
        summary: format!(
            "BE Home found {} strong Board APK match(es) across the current scan folders.",
            candidates.len()
        ),
        guidance:
            "Use rescan after you add new downloads to a watched folder, or choose a file manually when you already know where it lives."
                .into(),
        candidates,
    }
}

fn walk_apk_files(root: &Path) -> Vec<PathBuf> {
    let mut directories = vec![root.to_path_buf()];
    let mut apk_paths = Vec::new();

    while let Some(directory) = directories.pop() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                directories.push(path);
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
            .map_err(|error| {
                format!("BE Home could not resolve the current working directory: {error}")
            })?
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
    let inspection = inspect_apk_contents(&absolute_path)?;

    Ok(ApkCandidate {
        stable_id: format!("apk:{}", path_identity_key(&source_path)),
        file_name,
        source_path,
        discovery_source,
        discovered_from_path,
        file_size_bytes: metadata.len(),
        package_name: inspection.package_name,
        confidence: inspection.confidence,
        confidence_summary: confidence_summary(inspection.confidence).into(),
    })
}

fn inspect_apk_contents(path: &Path) -> Result<ApkInspection, String> {
    let file = File::open(path).map_err(|error| {
        format!(
            "BE Home could not open the APK archive at `{}`: {error}",
            path.display()
        )
    })?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        format!(
            "BE Home could not read `{}` as an APK archive: {error}",
            path.display()
        )
    })?;

    let mut found_strong_marker = false;
    let mut found_possible_marker = false;
    for name in archive.file_names() {
        if name.ends_with(BOARD_STRONG_MARKER) {
            found_strong_marker = true;
        }

        if (name.starts_with("lib/") && name.ends_with(".so")) || name == "AndroidManifest.xml" {
            found_possible_marker = true;
        }
    }

    let package_name = extract_package_name(&mut archive);
    let confidence = if found_strong_marker {
        ApkConfidence::StrongMatch
    } else if found_possible_marker {
        ApkConfidence::PossibleMatch
    } else {
        ApkConfidence::Unknown
    };

    Ok(ApkInspection {
        package_name,
        confidence,
    })
}

fn extract_package_name(archive: &mut ZipArchive<File>) -> Option<String> {
    let mut manifest = archive.by_name("AndroidManifest.xml").ok()?;
    let mut bytes = Vec::new();
    manifest.read_to_end(&mut bytes).ok()?;

    let mut candidates = extract_ascii_strings(&bytes);
    candidates.extend(extract_utf16le_strings(&bytes));
    candidates
        .into_iter()
        .filter(|candidate| looks_like_package_name(candidate))
        .filter(|candidate| !is_common_non_app_package(candidate))
        .max_by_key(package_name_score)
}

fn extract_ascii_strings(bytes: &[u8]) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current = String::new();

    for byte in bytes {
        let character = *byte as char;
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
            current.push(character);
        } else {
            if current.len() >= 6 {
                strings.push(current.clone());
            }
            current.clear();
        }
    }

    if current.len() >= 6 {
        strings.push(current);
    }

    strings
}

fn extract_utf16le_strings(bytes: &[u8]) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current = String::new();

    for chunk in bytes.chunks_exact(2) {
        let low = chunk[0] as char;
        let high = chunk[1];
        if high == 0
            && (low.is_ascii_alphanumeric() || matches!(low, '.' | '_' | '-'))
        {
            current.push(low);
        } else {
            if current.len() >= 6 {
                strings.push(current.clone());
            }
            current.clear();
        }
    }

    if current.len() >= 6 {
        strings.push(current);
    }

    strings
}

fn package_name_score(value: &String) -> usize {
    value.split('.').count() * 10 + value.len()
}

fn is_common_non_app_package(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    matches!(
        lowered.as_str(),
        value if value.starts_with("android.")
            || value.starts_with("com.unity3d")
            || value.starts_with("com.google.")
            || value.starts_with("org.apache.")
            || value.starts_with("kotlin.")
    )
}

fn confidence_summary(confidence: ApkConfidence) -> &'static str {
    match confidence {
        ApkConfidence::StrongMatch => {
            "BE Home found a strong Board SDK marker in this APK."
        }
        ApkConfidence::PossibleMatch => {
            "BE Home found some Android packaging signals, but not the strongest Board marker yet."
        }
        ApkConfidence::Unknown => {
            "BE Home did not find a clear Board marker in this APK yet."
        }
    }
}

pub(crate) fn normalize_apk_path(value: &str) -> Result<PathBuf, String> {
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
        ApkCandidateSource, ApkConfidence, ApkDiscoveryStatus, ManualApkPathInput,
    };
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    #[test]
    fn discovery_snapshot_walks_nested_scan_folders_and_deduplicates_results() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let root = temp_directory.path();
        let downloads = root.join("Downloads");
        let nested = downloads.join("nested");
        fs::create_dir_all(&nested).expect("nested folder should exist");
        write_apk(
            &downloads.join("LuckyDice.apk"),
            true,
            "fun.board.luckydice",
        );
        write_apk(
            &nested.join("FamilyMatch.apk"),
            false,
            "fun.board.familymatch",
        );

        let snapshot = build_apk_discovery_snapshot(vec![
            downloads.to_string_lossy().into_owned(),
            nested.to_string_lossy().into_owned(),
        ]);

        assert_eq!(ApkDiscoveryStatus::Ready, snapshot.status);
        assert_eq!(1, snapshot.candidates.len());
        assert_eq!(ApkConfidence::StrongMatch, snapshot.candidates[0].confidence);
    }

    #[test]
    fn discovery_snapshot_reports_empty_when_no_strong_board_matches_are_found() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let downloads = temp_directory.path().join("Downloads");
        fs::create_dir_all(&downloads).expect("downloads should exist");
        write_apk(&downloads.join("notes.apk"), false, "fun.board.notes");

        let snapshot = build_apk_discovery_snapshot(vec![downloads.to_string_lossy().into_owned()]);

        assert_eq!(ApkDiscoveryStatus::Empty, snapshot.status);
        assert!(snapshot.candidates.is_empty());
    }

    #[test]
    fn manual_apk_inspection_requires_an_absolute_apk_path() {
        let result = inspect_manual_apk_path(ManualApkPathInput {
            path: "LuckyDice.apk".into(),
        });

        assert!(result.is_err());
    }

    #[test]
    fn manual_apk_inspection_returns_a_manual_candidate_with_strong_confidence() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let apk_path = temp_directory.path().join("LuckyDice.apk");
        write_apk(&apk_path, true, "fun.board.luckydice");

        let candidate = inspect_manual_apk_path(ManualApkPathInput {
            path: apk_path.to_string_lossy().into_owned(),
        })
        .expect("manual apk inspection should succeed");

        assert_eq!(ApkCandidateSource::ManualSelection, candidate.discovery_source);
        assert_eq!(ApkConfidence::StrongMatch, candidate.confidence);
        assert_eq!(Some("fun.board.luckydice"), candidate.package_name.as_deref());
    }

    #[test]
    fn manual_apk_inspection_can_surface_possible_matches() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let apk_path = temp_directory.path().join("PossibleMatch.apk");
        write_apk(&apk_path, false, "fun.board.possible");

        let candidate = inspect_manual_apk_path(ManualApkPathInput {
            path: apk_path.to_string_lossy().into_owned(),
        })
        .expect("manual apk inspection should succeed");

        assert_eq!(ApkConfidence::PossibleMatch, candidate.confidence);
    }

    #[test]
    fn scan_candidates_preserve_the_scan_folder_they_were_found_from() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let scan_folder = temp_directory.path().join("Downloads");
        let apk_path = scan_folder.join("LuckyDice.apk");
        fs::create_dir_all(&scan_folder).expect("downloads should exist");
        write_apk(&apk_path, true, "fun.board.luckydice");

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

    fn write_apk(path: &Path, include_strong_marker: bool, package_name: &str) {
        let file = File::create(path).expect("apk file should create");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored);

        writer
            .start_file("AndroidManifest.xml", options)
            .expect("manifest should start");
        writer
            .write_all(format!(r#"<manifest package="{package_name}"></manifest>"#).as_bytes())
            .expect("manifest should write");

        if include_strong_marker {
            writer
                .start_file("lib/arm64-v8a/libnativeBoardSDK.so", options)
                .expect("strong marker should start");
            writer.write_all(b"board-sdk").expect("strong marker should write");
        } else {
            writer
                .start_file("lib/arm64-v8a/libunity.so", options)
                .expect("possible marker should start");
            writer.write_all(b"unity").expect("possible marker should write");
        }

        writer.finish().expect("apk archive should finish");
    }
}
