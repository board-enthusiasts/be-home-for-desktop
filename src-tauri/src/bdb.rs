use crate::storage;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::process::Command;
use std::time::Duration;

const REMOTE_BDB_SOURCE_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/board-enthusiasts/be-home-for-desktop/main/config/bdb-sources.json";
const BUNDLED_BDB_SOURCE_MANIFEST_JSON: &str = include_str!("../../config/bdb-sources.json");
const LINUX_X86_64_PLATFORM_KEY: &str = "linux-x86_64";
const MACOS_UNIVERSAL_PLATFORM_KEY: &str = "macos-universal";
const WINDOWS_X86_64_PLATFORM_KEY: &str = "windows-x86_64";
const WINDOWS_11_MINIMUM_BUILD: u32 = 22000;
const MANIFEST_CACHE_DIRECTORY: &str = "cache";
const MANIFEST_CACHE_FILE_NAME: &str = "bdb-source-manifest.json";
const REMOTE_MANIFEST_TIMEOUT_SECONDS: u64 = 10;

/// Describes the supported source-map status for the current machine.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BdbSupportStatus {
    Supported,
    Unsupported,
}

/// Explains why the current machine could not be matched to a supported `bdb` source.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BdbUnsupportedReason {
    UnsupportedOperatingSystem,
    UnsupportedArchitecture,
    UnsupportedOperatingSystemVersion,
    PlatformProbeFailed,
    MissingManifestEntry,
}

/// Describes the normalized operating system being evaluated.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BdbOperatingSystem {
    Windows,
    Macos,
    Linux,
    Unknown,
}

/// Describes the normalized CPU architecture being evaluated.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) enum BdbArchitecture {
    #[serde(rename = "x86_64")]
    X86_64,
    #[serde(rename = "aarch64")]
    Aarch64,
    #[serde(rename = "x86")]
    X86,
    #[serde(rename = "arm")]
    Arm,
    #[serde(rename = "unknown")]
    Unknown,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BdbSourceManifest {
    schema_version: u32,
    platforms: BTreeMap<String, String>,
}

#[derive(Clone, Debug)]
struct LoadedManifest {
    manifest: BdbSourceManifest,
    source: &'static str,
    cache_path: Option<PathBuf>,
}

#[derive(Clone, Debug)]
struct DetectedPlatform {
    operating_system: BdbOperatingSystem,
    architecture: BdbArchitecture,
    windows_build: Option<u32>,
}

/// Describes the current machine's compatibility with the maintained `bdb` support matrix.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbPlatformSupport {
    pub(crate) status: BdbSupportStatus,
    pub(crate) operating_system: BdbOperatingSystem,
    pub(crate) architecture: BdbArchitecture,
    pub(crate) windows_build: Option<u32>,
    pub(crate) platform_key: Option<String>,
    pub(crate) reason: Option<BdbUnsupportedReason>,
    pub(crate) guidance: String,
}

/// Describes the Board-hosted `bdb` source chosen for the current machine.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbDownloadSource {
    pub(crate) platform_key: String,
    pub(crate) download_url: String,
}

/// Describes the maintained source-resolution plan for `bdb` on the current machine.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbSourcePlan {
    pub(crate) manifest_source: String,
    pub(crate) remote_manifest_url: String,
    pub(crate) manifest_cache_path: Option<String>,
    pub(crate) manifest_schema_version: u32,
    pub(crate) support: BdbPlatformSupport,
    pub(crate) source: Option<BdbDownloadSource>,
}

/// Resolve the maintained `bdb` source plan for the current machine.
pub(crate) fn resolve_current_bdb_source_plan() -> BdbSourcePlan {
    resolve_current_bdb_source_plan_with_remote_refresh(false)
}

/// Resolve the maintained `bdb` source plan and refresh its remote manifest when appropriate.
pub(crate) fn refresh_current_bdb_source_plan() -> BdbSourcePlan {
    resolve_current_bdb_source_plan_with_remote_refresh(true)
}

fn resolve_current_bdb_source_plan_with_remote_refresh(
    allow_remote_manifest_refresh: bool,
) -> BdbSourcePlan {
    let detected = detect_current_platform();
    let cache_path = resolve_manifest_cache_path();
    let manifest = load_manifest_with_fallbacks(
        cache_path.as_deref(),
        allow_remote_manifest_refresh,
        fetch_remote_manifest_text,
    );
    resolve_bdb_source_plan_for_platform(&manifest, detected)
}

fn resolve_manifest_cache_path() -> Option<PathBuf> {
    storage::resolve_app_data_root().ok().map(|root| {
        root.join(MANIFEST_CACHE_DIRECTORY)
            .join(MANIFEST_CACHE_FILE_NAME)
    })
}

fn resolve_bdb_source_plan_for_platform(
    loaded_manifest: &LoadedManifest,
    detected: DetectedPlatform,
) -> BdbSourcePlan {
    let support = match resolve_supported_platform_key(&detected) {
        Ok(platform_key) => match loaded_manifest.manifest.platforms.get(platform_key) {
            Some(_) => BdbPlatformSupport {
                status: BdbSupportStatus::Supported,
                operating_system: detected.operating_system,
                architecture: detected.architecture,
                windows_build: detected.windows_build,
                platform_key: Some(platform_key.to_string()),
                reason: None,
                guidance: "This machine matches a Board-published bdb target.".into(),
            },
            None => BdbPlatformSupport {
                status: BdbSupportStatus::Unsupported,
                operating_system: detected.operating_system,
                architecture: detected.architecture,
                windows_build: detected.windows_build,
                platform_key: Some(platform_key.to_string()),
                reason: Some(BdbUnsupportedReason::MissingManifestEntry),
                guidance: "This machine matched a supported platform key, but the maintained bdb manifest is missing its Board-hosted download URL.".into(),
            },
        },
        Err(reason) => BdbPlatformSupport {
            status: BdbSupportStatus::Unsupported,
            operating_system: detected.operating_system,
            architecture: detected.architecture,
            windows_build: detected.windows_build,
            platform_key: None,
            reason: Some(reason),
            guidance: build_guidance_for_unsupported_platform(&detected, reason),
        },
    };

    let source = support.platform_key.as_ref().and_then(|platform_key| {
        loaded_manifest
            .manifest
            .platforms
            .get(platform_key)
            .map(|download_url| BdbDownloadSource {
                platform_key: platform_key.clone(),
                download_url: download_url.clone(),
            })
    });

    BdbSourcePlan {
        manifest_source: loaded_manifest.source.into(),
        remote_manifest_url: REMOTE_BDB_SOURCE_MANIFEST_URL.into(),
        manifest_cache_path: loaded_manifest.cache_path.as_deref().map(path_to_string),
        manifest_schema_version: loaded_manifest.manifest.schema_version,
        support,
        source,
    }
}

fn build_guidance_for_unsupported_platform(
    detected: &DetectedPlatform,
    reason: BdbUnsupportedReason,
) -> String {
    match reason {
        BdbUnsupportedReason::UnsupportedOperatingSystem => {
            "Board currently publishes bdb only for macOS, Linux amd64, and Windows 11 x86_64."
                .into()
        }
        BdbUnsupportedReason::UnsupportedArchitecture => format!(
            "Board currently publishes bdb only for macOS universal, Linux x86_64, and Windows 11 x86_64. This machine reported architecture {:?}.",
            detected.architecture
        ),
        BdbUnsupportedReason::UnsupportedOperatingSystemVersion => {
            "Board currently advertises its Windows bdb build for Windows 11. This machine did not pass the Windows 11 compatibility check.".into()
        }
        BdbUnsupportedReason::PlatformProbeFailed => {
            "BE Home could not confirm whether this Windows PC matches Board's current bdb support. Try again, and if this keeps happening, make sure Windows is fully up to date.".into()
        }
        BdbUnsupportedReason::MissingManifestEntry => {
            "The maintained bdb source manifest is missing the Board-hosted URL for this supported platform key.".into()
        }
    }
}

fn resolve_supported_platform_key(
    detected: &DetectedPlatform,
) -> Result<&'static str, BdbUnsupportedReason> {
    match detected.operating_system {
        BdbOperatingSystem::Macos => match detected.architecture {
            BdbArchitecture::X86_64 | BdbArchitecture::Aarch64 => Ok(MACOS_UNIVERSAL_PLATFORM_KEY),
            _ => Err(BdbUnsupportedReason::UnsupportedArchitecture),
        },
        BdbOperatingSystem::Linux => match detected.architecture {
            BdbArchitecture::X86_64 => Ok(LINUX_X86_64_PLATFORM_KEY),
            _ => Err(BdbUnsupportedReason::UnsupportedArchitecture),
        },
        BdbOperatingSystem::Windows => match detected.architecture {
            BdbArchitecture::X86_64 => match detected.windows_build {
                Some(build) if build >= WINDOWS_11_MINIMUM_BUILD => Ok(WINDOWS_X86_64_PLATFORM_KEY),
                Some(_) => Err(BdbUnsupportedReason::UnsupportedOperatingSystemVersion),
                None => Err(BdbUnsupportedReason::PlatformProbeFailed),
            },
            _ => Err(BdbUnsupportedReason::UnsupportedArchitecture),
        },
        BdbOperatingSystem::Unknown => Err(BdbUnsupportedReason::UnsupportedOperatingSystem),
    }
}

fn load_manifest_with_fallbacks<F>(
    cache_path: Option<&Path>,
    allow_remote_manifest_refresh: bool,
    fetch_remote_manifest: F,
) -> LoadedManifest
where
    F: Fn(&str) -> Result<String, String>,
{
    let cached_manifest = cache_path.and_then(|cache_path| {
        load_cached_manifest(cache_path)
            .ok()
            .map(|manifest| LoadedManifest {
                manifest,
                source: "cached",
                cache_path: Some(cache_path.to_path_buf()),
            })
    });

    if allow_remote_manifest_refresh {
        if let Ok(remote_text) = fetch_remote_manifest(REMOTE_BDB_SOURCE_MANIFEST_URL) {
            if let Ok(manifest) = parse_manifest(&remote_text) {
                if let Some(cache_path) = cache_path {
                    let _ = save_cached_manifest(cache_path, &remote_text);
                }

                return LoadedManifest {
                    manifest,
                    source: "remote",
                    cache_path: cache_path.map(|path| path.to_path_buf()),
                };
            }
        }
    } else if let Some(cached_manifest) = cached_manifest.clone() {
        return cached_manifest;
    }

    if let Some(cached_manifest) = cached_manifest {
        return cached_manifest;
    }

    LoadedManifest {
        manifest: bundled_manifest(),
        source: "bundled",
        cache_path: cache_path.map(|path| path.to_path_buf()),
    }
}

fn fetch_remote_manifest_text(url: &str) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(REMOTE_MANIFEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("The app could not prepare its bdb manifest client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("The app could not refresh the remote bdb manifest: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "The remote bdb manifest responded with HTTP status {status}."
        ));
    }

    response
        .text()
        .map_err(|error| format!("The app could not read the remote bdb manifest body: {error}"))
}

fn load_cached_manifest(cache_path: &Path) -> Result<BdbSourceManifest, String> {
    let content = fs::read_to_string(cache_path).map_err(|error| {
        format!(
            "The app could not read the cached bdb manifest at `{}`: {error}",
            cache_path.display()
        )
    })?;
    parse_manifest(&content)
}

fn save_cached_manifest(cache_path: &Path, manifest_text: &str) -> Result<(), String> {
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "The app could not create the cached bdb manifest directory at `{}`: {error}",
                parent.display()
            )
        })?;
    }

    fs::write(cache_path, manifest_text).map_err(|error| {
        format!(
            "The app could not save the cached bdb manifest at `{}`: {error}",
            cache_path.display()
        )
    })
}

fn parse_manifest(manifest_text: &str) -> Result<BdbSourceManifest, String> {
    let manifest: BdbSourceManifest = serde_json::from_str(manifest_text)
        .map_err(|error| format!("The bdb manifest JSON was invalid: {error}"))?;
    if manifest.schema_version != 1 {
        return Err(format!(
            "The bdb manifest used unsupported schema version {}.",
            manifest.schema_version
        ));
    }

    Ok(manifest)
}

fn bundled_manifest() -> BdbSourceManifest {
    parse_manifest(BUNDLED_BDB_SOURCE_MANIFEST_JSON)
        .expect("bundled bdb source manifest should deserialize")
}

fn detect_current_platform() -> DetectedPlatform {
    let operating_system = if cfg!(target_os = "windows") {
        BdbOperatingSystem::Windows
    } else if cfg!(target_os = "macos") {
        BdbOperatingSystem::Macos
    } else if cfg!(target_os = "linux") {
        BdbOperatingSystem::Linux
    } else {
        BdbOperatingSystem::Unknown
    };

    let architecture = match std::env::consts::ARCH {
        "x86_64" => BdbArchitecture::X86_64,
        "aarch64" => BdbArchitecture::Aarch64,
        "x86" | "i686" => BdbArchitecture::X86,
        "arm" | "armv7" => BdbArchitecture::Arm,
        _ => BdbArchitecture::Unknown,
    };

    #[cfg(target_os = "windows")]
    let windows_build = detect_windows_build_number();

    #[cfg(not(target_os = "windows"))]
    let windows_build = None;

    DetectedPlatform {
        operating_system,
        architecture,
        windows_build,
    }
}

#[cfg(target_os = "windows")]
fn detect_windows_build_number() -> Option<u32> {
    let output = Command::new("cmd")
        .args(["/C", "ver"])
        .output()
        .ok()?;

    let version_text = String::from_utf8_lossy(&output.stdout);
    parse_windows_build_number(&version_text)
}

fn parse_windows_build_number(version_text: &str) -> Option<u32> {
    let numbers = version_text
        .split(|character: char| !character.is_ascii_digit())
        .filter(|segment| !segment.is_empty())
        .filter_map(|segment| segment.parse::<u32>().ok())
        .collect::<Vec<_>>();

    if numbers.len() >= 3 {
        numbers.get(2).copied()
    } else {
        None
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_manifest, load_manifest_with_fallbacks, parse_manifest, parse_windows_build_number,
        resolve_bdb_source_plan_for_platform, BdbArchitecture, BdbOperatingSystem,
        BdbSupportStatus, BdbUnsupportedReason, DetectedPlatform, LoadedManifest,
        LINUX_X86_64_PLATFORM_KEY, MACOS_UNIVERSAL_PLATFORM_KEY, WINDOWS_X86_64_PLATFORM_KEY,
    };
    use std::cell::Cell;
    use std::fs;

    #[test]
    fn bundled_manifest_tracks_current_board_download_urls() {
        let manifest = bundled_manifest();

        assert_eq!(1, manifest.schema_version);
        assert_eq!(
            Some(&"https://dev.board.fun/downloads/bdb/macos-universal/bdb".to_string()),
            manifest.platforms.get(MACOS_UNIVERSAL_PLATFORM_KEY)
        );
        assert_eq!(
            Some(&"https://dev.board.fun/downloads/bdb/linux/bdb".to_string()),
            manifest.platforms.get(LINUX_X86_64_PLATFORM_KEY)
        );
        assert_eq!(
            Some(&"https://dev.board.fun/downloads/bdb/windows/bdb.exe".to_string()),
            manifest.platforms.get(WINDOWS_X86_64_PLATFORM_KEY)
        );
    }

    #[test]
    fn remote_manifest_is_preferred_and_cached_when_it_is_valid() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let cache_path = temp_directory
            .path()
            .join("cache")
            .join("bdb-source-manifest.json");

        let loaded = load_manifest_with_fallbacks(Some(&cache_path), true, |_| {
            Ok(
                r#"{"schemaVersion":1,"platforms":{"linux-x86_64":"https://example.com/linux/bdb"}}"#
                    .into(),
            )
        });

        assert_eq!("remote", loaded.source);
        assert_eq!(
            Some(&"https://example.com/linux/bdb".to_string()),
            loaded.manifest.platforms.get(LINUX_X86_64_PLATFORM_KEY)
        );
        assert!(fs::read_to_string(cache_path)
            .expect("cache file should be written")
            .contains("example.com/linux/bdb"));
    }

    #[test]
    fn cached_manifest_is_used_when_the_remote_refresh_is_invalid() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let cache_path = temp_directory
            .path()
            .join("cache")
            .join("bdb-source-manifest.json");
        fs::create_dir_all(
            cache_path
                .parent()
                .expect("cache directory should have parent"),
        )
        .expect("cache directory should exist");
        fs::write(
            &cache_path,
            r#"{"schemaVersion":1,"platforms":{"linux-x86_64":"https://cached.example/bdb"}}"#,
        )
        .expect("cache manifest should be written");

        let loaded =
            load_manifest_with_fallbacks(Some(&cache_path), true, |_| Ok("{ invalid json".into()));

        assert_eq!("cached", loaded.source);
        assert_eq!(
            Some(&"https://cached.example/bdb".to_string()),
            loaded.manifest.platforms.get(LINUX_X86_64_PLATFORM_KEY)
        );
    }

    #[test]
    fn cached_manifest_is_used_without_remote_refreshing_on_state_reads() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let cache_path = temp_directory
            .path()
            .join("cache")
            .join("bdb-source-manifest.json");
        let remote_fetch_attempted = Cell::new(false);
        fs::create_dir_all(
            cache_path
                .parent()
                .expect("cache directory should have parent"),
        )
        .expect("cache directory should exist");
        fs::write(
            &cache_path,
            r#"{"schemaVersion":1,"platforms":{"linux-x86_64":"https://cached.example/bdb"}}"#,
        )
        .expect("cache manifest should be written");

        let loaded = load_manifest_with_fallbacks(Some(&cache_path), false, |_| {
            remote_fetch_attempted.set(true);
            Err("offline".into())
        });

        assert_eq!("cached", loaded.source);
        assert!(!remote_fetch_attempted.get());
        assert_eq!(
            Some(&"https://cached.example/bdb".to_string()),
            loaded.manifest.platforms.get(LINUX_X86_64_PLATFORM_KEY)
        );
    }

    #[test]
    fn bundled_manifest_is_used_when_remote_and_cache_are_unavailable() {
        let temp_directory = tempfile::tempdir().expect("temporary directory should exist");
        let cache_path = temp_directory
            .path()
            .join("cache")
            .join("bdb-source-manifest.json");

        let loaded =
            load_manifest_with_fallbacks(Some(&cache_path), true, |_| Err("offline".into()));

        assert_eq!("bundled", loaded.source);
        assert_eq!(
            Some(&"https://dev.board.fun/downloads/bdb/linux/bdb".to_string()),
            loaded.manifest.platforms.get(LINUX_X86_64_PLATFORM_KEY)
        );
    }

    #[test]
    fn manifest_parser_rejects_unknown_schema_versions() {
        let result = parse_manifest(r#"{"schemaVersion":2,"platforms":{}}"#);

        assert!(result.is_err());
    }

    #[test]
    fn macos_apple_silicon_maps_to_universal_download() {
        let loaded_manifest = LoadedManifest {
            manifest: bundled_manifest(),
            source: "bundled",
            cache_path: None,
        };
        let plan = resolve_bdb_source_plan_for_platform(
            &loaded_manifest,
            DetectedPlatform {
                operating_system: BdbOperatingSystem::Macos,
                architecture: BdbArchitecture::Aarch64,
                windows_build: None,
            },
        );

        assert_eq!(BdbSupportStatus::Supported, plan.support.status);
        assert_eq!(
            Some(MACOS_UNIVERSAL_PLATFORM_KEY),
            plan.support.platform_key.as_deref()
        );
        assert_eq!(
            Some("https://dev.board.fun/downloads/bdb/macos-universal/bdb"),
            plan.source
                .as_ref()
                .map(|source| source.download_url.as_str())
        );
    }

    #[test]
    fn linux_arm_is_reported_as_unsupported_architecture() {
        let loaded_manifest = LoadedManifest {
            manifest: bundled_manifest(),
            source: "bundled",
            cache_path: None,
        };
        let plan = resolve_bdb_source_plan_for_platform(
            &loaded_manifest,
            DetectedPlatform {
                operating_system: BdbOperatingSystem::Linux,
                architecture: BdbArchitecture::Arm,
                windows_build: None,
            },
        );

        assert_eq!(BdbSupportStatus::Unsupported, plan.support.status);
        assert_eq!(
            Some(BdbUnsupportedReason::UnsupportedArchitecture),
            plan.support.reason
        );
        assert!(plan.source.is_none());
    }

    #[test]
    fn windows_11_x86_64_maps_to_board_windows_download() {
        let loaded_manifest = LoadedManifest {
            manifest: bundled_manifest(),
            source: "bundled",
            cache_path: None,
        };
        let plan = resolve_bdb_source_plan_for_platform(
            &loaded_manifest,
            DetectedPlatform {
                operating_system: BdbOperatingSystem::Windows,
                architecture: BdbArchitecture::X86_64,
                windows_build: Some(26100),
            },
        );

        assert_eq!(BdbSupportStatus::Supported, plan.support.status);
        assert_eq!(
            Some(WINDOWS_X86_64_PLATFORM_KEY),
            plan.support.platform_key.as_deref()
        );
        assert_eq!(
            Some("https://dev.board.fun/downloads/bdb/windows/bdb.exe"),
            plan.source
                .as_ref()
                .map(|source| source.download_url.as_str())
        );
    }

    #[test]
    fn windows_10_is_rejected_by_the_windows_11_requirement() {
        let loaded_manifest = LoadedManifest {
            manifest: bundled_manifest(),
            source: "bundled",
            cache_path: None,
        };
        let plan = resolve_bdb_source_plan_for_platform(
            &loaded_manifest,
            DetectedPlatform {
                operating_system: BdbOperatingSystem::Windows,
                architecture: BdbArchitecture::X86_64,
                windows_build: Some(19045),
            },
        );

        assert_eq!(BdbSupportStatus::Unsupported, plan.support.status);
        assert_eq!(
            Some(BdbUnsupportedReason::UnsupportedOperatingSystemVersion),
            plan.support.reason
        );
        assert!(plan.source.is_none());
    }

    #[test]
    fn windows_probe_failures_use_player_friendly_guidance() {
        let loaded_manifest = LoadedManifest {
            manifest: bundled_manifest(),
            source: "bundled",
            cache_path: None,
        };
        let plan = resolve_bdb_source_plan_for_platform(
            &loaded_manifest,
            DetectedPlatform {
                operating_system: BdbOperatingSystem::Windows,
                architecture: BdbArchitecture::X86_64,
                windows_build: None,
            },
        );

        assert_eq!(BdbSupportStatus::Unsupported, plan.support.status);
        assert_eq!(
            Some(BdbUnsupportedReason::PlatformProbeFailed),
            plan.support.reason
        );
        assert_eq!(
            "BE Home could not confirm whether this Windows PC matches Board's current bdb support. Try again, and if this keeps happening, make sure Windows is fully up to date.",
            plan.support.guidance
        );
    }

    #[test]
    fn windows_build_parser_extracts_the_build_number() {
        let build_number = parse_windows_build_number("Microsoft Windows [Version 10.0.26100.1]");

        assert_eq!(Some(26100), build_number);
    }
}
