use crate::apk;
use crate::storage;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const LIBRARY_MANIFEST_DIRECTORY: &str = "settings";
const LIBRARY_MANIFEST_FILE_NAME: &str = "managed-apk-library.json";
const LIBRARY_MANIFEST_SCHEMA_VERSION: u32 = 1;

/// Describes whether the managed APK library currently has imported items to show.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ManagedApkLibraryStatus {
    Ready,
    Empty,
}

/// Describes one APK retained inside the managed library.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryItem {
    pub(crate) stable_id: String,
    pub(crate) file_name: String,
    pub(crate) original_source_path: String,
    pub(crate) managed_path: String,
    pub(crate) package_name: Option<String>,
    pub(crate) confidence: apk::ApkConfidence,
    pub(crate) confidence_summary: String,
    pub(crate) file_size_bytes: u64,
    pub(crate) imported_at_unix_ms: u64,
    pub(crate) source_modified_at_unix_ms: Option<u64>,
    pub(crate) managed_modified_at_unix_ms: Option<u64>,
}

/// Describes the current managed APK library inventory.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedApkLibrarySnapshot {
    pub(crate) status: ManagedApkLibraryStatus,
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) items: Vec<LibraryItem>,
}

/// Represents the managed-library import payload accepted by the desktop host.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedApkLibraryImportInput {
    source_path: String,
}

/// Describes the outcome of importing one APK into the managed library.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedApkLibraryImportResult {
    pub(crate) summary: String,
    pub(crate) guidance: String,
    pub(crate) item: LibraryItem,
    pub(crate) snapshot: ManagedApkLibrarySnapshot,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedManagedApkLibraryManifest {
    #[serde(default = "library_manifest_schema_version")]
    schema_version: u32,
    #[serde(default)]
    items: Vec<PersistedLibraryItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedLibraryItem {
    stable_id: String,
    file_name: String,
    original_source_path: String,
    managed_path: String,
    package_name: Option<String>,
    confidence: apk::ApkConfidence,
    confidence_summary: String,
    file_size_bytes: u64,
    imported_at_unix_ms: u64,
    source_modified_at_unix_ms: Option<u64>,
    managed_modified_at_unix_ms: Option<u64>,
}

/// Load the current managed APK library snapshot from the desktop host.
pub(crate) fn load_current_managed_apk_library_snapshot(
) -> Result<ManagedApkLibrarySnapshot, String> {
    let manifest_path = resolve_library_manifest_path()?;
    let manifest = load_persisted_library_manifest(&manifest_path)?;
    Ok(build_library_snapshot(manifest))
}

/// Copy one APK into the managed library and return the updated inventory snapshot.
pub(crate) fn import_apk_to_managed_library(
    input: ManagedApkLibraryImportInput,
) -> Result<ManagedApkLibraryImportResult, String> {
    let settings = storage::load_desktop_settings()?;
    let source_path = apk::normalize_apk_path(&input.source_path)?;
    let source_candidate = apk::inspect_apk_file(&source_path)?;
    let library_root = PathBuf::from(&settings.apk_library.effective_path);
    let manifest_path = resolve_library_manifest_path()?;

    import_apk_to_managed_library_at(
        &manifest_path,
        &library_root,
        &source_path,
        source_candidate,
    )
}

fn import_apk_to_managed_library_at(
    manifest_path: &Path,
    library_root: &Path,
    source_path: &Path,
    source_candidate: apk::ApkCandidate,
) -> Result<ManagedApkLibraryImportResult, String> {
    let mut manifest = load_persisted_library_manifest(manifest_path)?;
    let source_key = path_identity_key(&source_candidate.source_path);
    let derived_stable_id = format!("library:{source_key}");
    let existing_item = manifest
        .items
        .iter()
        .find(|item| {
            item.stable_id == derived_stable_id
                || path_identity_key(&item.managed_path) == source_key
        })
        .cloned();
    let stable_id = existing_item
        .as_ref()
        .map(|item| item.stable_id.clone())
        .unwrap_or(derived_stable_id);
    let occupied_managed_paths = manifest
        .items
        .iter()
        .map(|item| item.managed_path.clone())
        .collect::<Vec<_>>();
    let managed_path = resolve_managed_copy_path(
        library_root,
        &source_candidate.file_name,
        source_path,
        existing_item
            .as_ref()
            .map(|item| item.managed_path.as_str()),
        &occupied_managed_paths,
    );
    let managed_path_string = path_to_string(&managed_path);
    let managed_path_key = path_identity_key(&managed_path_string);

    copy_into_library_if_needed(source_path, &managed_path)?;

    let source_metadata = fs::metadata(source_path).map_err(|error| {
        format!(
            "BE Home could not read the original APK at `{}` after import: {error}",
            source_path.display()
        )
    })?;
    let managed_metadata = fs::metadata(&managed_path).map_err(|error| {
        format!(
            "BE Home could not read the managed APK copy at `{}`: {error}",
            managed_path.display()
        )
    })?;
    let original_source_path = if source_key == managed_path_key {
        existing_item
            .as_ref()
            .map(|item| item.original_source_path.clone())
            .unwrap_or_else(|| source_candidate.source_path.clone())
    } else {
        source_candidate.source_path.clone()
    };
    let persisted_item = PersistedLibraryItem {
        stable_id: stable_id.clone(),
        file_name: source_candidate.file_name.clone(),
        original_source_path,
        managed_path: managed_path_string.clone(),
        package_name: source_candidate.package_name.clone(),
        confidence: source_candidate.confidence,
        confidence_summary: source_candidate.confidence_summary.clone(),
        file_size_bytes: managed_metadata.len(),
        imported_at_unix_ms: current_unix_ms(),
        source_modified_at_unix_ms: metadata_to_unix_ms(&source_metadata),
        managed_modified_at_unix_ms: metadata_to_unix_ms(&managed_metadata),
    };

    manifest.items.retain(|item| {
        item.stable_id != stable_id && path_identity_key(&item.managed_path) != managed_path_key
    });
    manifest.items.push(persisted_item.clone());
    save_persisted_library_manifest(manifest_path, &manifest)?;

    let snapshot = build_library_snapshot(manifest);
    let item = persisted_to_library_item(persisted_item);
    let source_and_destination_match = source_key == managed_path_key;

    Ok(ManagedApkLibraryImportResult {
        summary: if source_and_destination_match {
            format!(
                "BE Home added {} to the managed APK library.",
                item.file_name
            )
        } else {
            format!(
                "BE Home copied {} into the managed APK library.",
                item.file_name
            )
        },
        guidance: if source_and_destination_match {
            "The APK was already inside the managed library folder, so BE Home kept it in place and added it to the reusable inventory."
                .into()
        } else {
            "Your original APK stayed where it was, and this managed copy is ready for later reinstall steps.".into()
        },
        item,
        snapshot,
    })
}

fn build_library_snapshot(
    manifest: PersistedManagedApkLibraryManifest,
) -> ManagedApkLibrarySnapshot {
    let mut items = manifest
        .items
        .into_iter()
        .filter(|item| PathBuf::from(&item.managed_path).is_file())
        .map(persisted_to_library_item)
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        right
            .imported_at_unix_ms
            .cmp(&left.imported_at_unix_ms)
            .then_with(|| {
                left.file_name
                    .to_ascii_lowercase()
                    .cmp(&right.file_name.to_ascii_lowercase())
            })
            .then_with(|| left.managed_path.cmp(&right.managed_path))
    });

    if items.is_empty() {
        return ManagedApkLibrarySnapshot {
            status: ManagedApkLibraryStatus::Empty,
            summary: "The managed APK library is still empty.".into(),
            guidance:
                "Keep a copy from a scanned APK or a manual pick when you want later reinstalls to stay close by."
                    .into(),
            items,
        };
    }

    ManagedApkLibrarySnapshot {
        status: ManagedApkLibraryStatus::Ready,
        summary: format!(
            "BE Home is keeping {} APK file(s) in the managed library.",
            items.len()
        ),
        guidance:
            "These managed copies stay available for later installs even if the original downloads move somewhere else."
                .into(),
        items,
    }
}

fn persisted_to_library_item(item: PersistedLibraryItem) -> LibraryItem {
    LibraryItem {
        stable_id: item.stable_id,
        file_name: item.file_name,
        original_source_path: item.original_source_path,
        managed_path: item.managed_path,
        package_name: item.package_name,
        confidence: item.confidence,
        confidence_summary: item.confidence_summary,
        file_size_bytes: item.file_size_bytes,
        imported_at_unix_ms: item.imported_at_unix_ms,
        source_modified_at_unix_ms: item.source_modified_at_unix_ms,
        managed_modified_at_unix_ms: item.managed_modified_at_unix_ms,
    }
}

fn resolve_library_manifest_path() -> Result<PathBuf, String> {
    Ok(storage::resolve_app_data_root()?
        .join(LIBRARY_MANIFEST_DIRECTORY)
        .join(LIBRARY_MANIFEST_FILE_NAME))
}

fn load_persisted_library_manifest(
    manifest_path: &Path,
) -> Result<PersistedManagedApkLibraryManifest, String> {
    if !manifest_path.exists() {
        return Ok(PersistedManagedApkLibraryManifest {
            schema_version: library_manifest_schema_version(),
            items: Vec::new(),
        });
    }

    let content = fs::read_to_string(manifest_path).map_err(|error| {
        format!(
            "BE Home could not read the managed APK library inventory at `{}`: {error}",
            manifest_path.display()
        )
    })?;
    let manifest: PersistedManagedApkLibraryManifest =
        serde_json::from_str(&content).map_err(|error| {
            format!(
                "BE Home could not parse the managed APK library inventory at `{}`: {error}",
                manifest_path.display()
            )
        })?;

    if manifest.schema_version != library_manifest_schema_version() {
        return Err(format!(
            "BE Home found an unsupported managed APK library schema version ({}) at `{}`.",
            manifest.schema_version,
            manifest_path.display()
        ));
    }

    Ok(manifest)
}

fn save_persisted_library_manifest(
    manifest_path: &Path,
    manifest: &PersistedManagedApkLibraryManifest,
) -> Result<(), String> {
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "BE Home could not create the managed APK library settings folder at `{}`: {error}",
                parent.display()
            )
        })?;
    }

    let content =
        serde_json::to_string_pretty(manifest).expect("managed library manifest should serialize");
    fs::write(manifest_path, content).map_err(|error| {
        format!(
            "BE Home could not save the managed APK library inventory at `{}`: {error}",
            manifest_path.display()
        )
    })
}

fn resolve_managed_copy_path(
    library_root: &Path,
    file_name: &str,
    source_path: &Path,
    existing_managed_path: Option<&str>,
    occupied_managed_paths: &[String],
) -> PathBuf {
    if let Some(existing_managed_path) = existing_managed_path {
        let existing_path = PathBuf::from(existing_managed_path);
        if existing_path.starts_with(library_root) {
            return existing_path;
        }
    }

    let base_name = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("managed-apk");
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_owned);

    let source_key = path_identity_key(&path_to_string(source_path));
    for index in 0.. {
        let candidate_name = if index == 0 {
            file_name.to_owned()
        } else if let Some(extension) = extension.as_deref() {
            format!("{base_name}-{index}.{extension}")
        } else {
            format!("{base_name}-{index}")
        };
        let candidate_path = library_root.join(candidate_name);
        let candidate_path_string = path_to_string(&candidate_path);
        let candidate_key = path_identity_key(&candidate_path_string);

        let occupied_elsewhere = occupied_managed_paths.iter().any(|path| {
            path_identity_key(path) == candidate_key && path_identity_key(path) != source_key
        });
        if occupied_elsewhere {
            continue;
        }

        if !candidate_path.exists() || candidate_key == source_key {
            return candidate_path;
        }
    }

    unreachable!("managed library path resolution should always return a destination")
}

fn copy_into_library_if_needed(source_path: &Path, managed_path: &Path) -> Result<(), String> {
    if let Some(parent) = managed_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "BE Home could not create the managed APK library folder at `{}`: {error}",
                parent.display()
            )
        })?;
    }

    let source_key = path_identity_key(&path_to_string(source_path));
    let managed_key = path_identity_key(&path_to_string(managed_path));
    if source_key == managed_key {
        return Ok(());
    }

    fs::copy(source_path, managed_path).map_err(|error| {
        format!(
            "BE Home could not copy `{}` into the managed APK library at `{}`: {error}",
            source_path.display(),
            managed_path.display()
        )
    })?;
    Ok(())
}

fn metadata_to_unix_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata.modified().ok().and_then(system_time_to_unix_ms)
}

fn system_time_to_unix_ms(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn current_unix_ms() -> u64 {
    system_time_to_unix_ms(SystemTime::now()).unwrap_or(0)
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

const fn library_manifest_schema_version() -> u32 {
    LIBRARY_MANIFEST_SCHEMA_VERSION
}

#[cfg(test)]
mod tests {
    use super::{
        build_library_snapshot, import_apk_to_managed_library_at, load_persisted_library_manifest,
        ManagedApkLibraryImportResult, ManagedApkLibraryStatus, PersistedManagedApkLibraryManifest,
    };
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::Path;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    #[test]
    fn import_copies_the_apk_into_the_managed_library_and_keeps_the_source_file() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let manifest_path = temp_directory
            .path()
            .join("settings")
            .join("managed-apk-library.json");
        let library_root = temp_directory.path().join("apk-library");
        let source_root = temp_directory.path().join("downloads");
        fs::create_dir_all(&source_root).expect("source root should exist");
        let source_path = source_root.join("LuckyDice.apk");
        write_apk(&source_path, true, "fun.board.luckydice");
        let source_candidate =
            crate::apk::inspect_apk_file(&source_path).expect("candidate should inspect");

        let result = import_apk_to_managed_library_at(
            &manifest_path,
            &library_root,
            &source_path,
            source_candidate,
        )
        .expect("managed library import should succeed");

        assert!(source_path.is_file());
        assert!(Path::new(&result.item.managed_path).is_file());
        assert_ne!(result.item.original_source_path, result.item.managed_path);
        assert_eq!(ManagedApkLibraryStatus::Ready, result.snapshot.status);
    }

    #[test]
    fn import_reuses_the_existing_manifest_entry_for_the_same_source_path() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let manifest_path = temp_directory
            .path()
            .join("settings")
            .join("managed-apk-library.json");
        let library_root = temp_directory.path().join("apk-library");
        let source_root = temp_directory.path().join("downloads");
        fs::create_dir_all(&source_root).expect("source root should exist");
        let source_path = source_root.join("LuckyDice.apk");
        write_apk(&source_path, true, "fun.board.luckydice");

        let first_result = import_candidate(&manifest_path, &library_root, &source_path);
        let second_result = import_candidate(&manifest_path, &library_root, &source_path);

        assert_eq!(first_result.item.stable_id, second_result.item.stable_id);
        assert_eq!(
            first_result.item.managed_path,
            second_result.item.managed_path
        );

        let manifest =
            load_persisted_library_manifest(&manifest_path).expect("manifest should load");
        assert_eq!(1, manifest.items.len());
    }

    #[test]
    fn import_reusing_a_managed_copy_keeps_one_library_entry() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let manifest_path = temp_directory
            .path()
            .join("settings")
            .join("managed-apk-library.json");
        let library_root = temp_directory.path().join("apk-library");
        let source_root = temp_directory.path().join("downloads");
        fs::create_dir_all(&source_root).expect("source root should exist");
        let source_path = source_root.join("LuckyDice.apk");
        write_apk(&source_path, true, "fun.board.luckydice");

        let first_result = import_candidate(&manifest_path, &library_root, &source_path);
        let managed_copy_path = Path::new(&first_result.item.managed_path).to_path_buf();
        let second_result = import_candidate(&manifest_path, &library_root, &managed_copy_path);

        assert_eq!(first_result.item.stable_id, second_result.item.stable_id);
        assert_eq!(
            first_result.item.managed_path,
            second_result.item.managed_path
        );
        assert_eq!(
            first_result.item.original_source_path,
            second_result.item.original_source_path
        );
        assert!(second_result.summary.contains("added"));

        let manifest =
            load_persisted_library_manifest(&manifest_path).expect("manifest should load");
        assert_eq!(1, manifest.items.len());
        assert_eq!(
            first_result.item.original_source_path,
            manifest.items[0].original_source_path
        );
        assert_eq!(
            first_result.item.managed_path,
            manifest.items[0].managed_path
        );
    }

    #[test]
    fn snapshot_filters_out_missing_managed_files() {
        let snapshot = build_library_snapshot(PersistedManagedApkLibraryManifest {
            schema_version: 1,
            items: vec![super::PersistedLibraryItem {
                stable_id: "library:test".into(),
                file_name: "Missing.apk".into(),
                original_source_path: "/tmp/Missing.apk".into(),
                managed_path: "/tmp/not-here.apk".into(),
                package_name: Some("fun.board.missing".into()),
                confidence: crate::apk::ApkConfidence::StrongMatch,
                confidence_summary: "BE Home found a strong Board SDK marker in this APK.".into(),
                file_size_bytes: 42,
                imported_at_unix_ms: 1,
                source_modified_at_unix_ms: Some(1),
                managed_modified_at_unix_ms: Some(1),
            }],
        });

        assert_eq!(ManagedApkLibraryStatus::Empty, snapshot.status);
        assert!(snapshot.items.is_empty());
    }

    #[test]
    fn import_tracks_confidence_package_and_timestamps() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let manifest_path = temp_directory
            .path()
            .join("settings")
            .join("managed-apk-library.json");
        let library_root = temp_directory.path().join("apk-library");
        let source_root = temp_directory.path().join("downloads");
        fs::create_dir_all(&source_root).expect("source root should exist");
        let source_path = source_root.join("FamilyMatch.apk");
        write_apk(&source_path, false, "fun.board.familymatch");

        let result = import_candidate(&manifest_path, &library_root, &source_path);

        assert_eq!(
            Some("fun.board.familymatch"),
            result.item.package_name.as_deref()
        );
        assert_eq!(
            crate::apk::ApkConfidence::PossibleMatch,
            result.item.confidence
        );
        assert!(result.item.imported_at_unix_ms > 0);
        assert!(result.item.source_modified_at_unix_ms.is_some());
        assert!(result.item.managed_modified_at_unix_ms.is_some());
    }

    fn import_candidate(
        manifest_path: &Path,
        library_root: &Path,
        source_path: &Path,
    ) -> ManagedApkLibraryImportResult {
        let source_candidate =
            crate::apk::inspect_apk_file(source_path).expect("candidate should inspect");
        import_apk_to_managed_library_at(manifest_path, library_root, source_path, source_candidate)
            .expect("managed library import should succeed")
    }

    fn write_apk(path: &Path, include_strong_marker: bool, package_name: &str) {
        let file = File::create(path).expect("apk file should create");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

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
            writer
                .write_all(b"board-sdk")
                .expect("strong marker should write");
        } else {
            writer
                .start_file("lib/arm64-v8a/libunity.so", options)
                .expect("possible marker should start");
            writer
                .write_all(b"unity")
                .expect("possible marker should write");
        }

        writer.finish().expect("apk archive should finish");
    }
}
