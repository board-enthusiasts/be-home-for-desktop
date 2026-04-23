use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[cfg(target_os = "windows")]
use std::process::Command;

const REMOTE_BDB_SOURCE_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/board-enthusiasts/be-home-for-desktop/main/config/bdb-sources.json";
const BUNDLED_BDB_SOURCE_MANIFEST_JSON: &str = include_str!("../../config/bdb-sources.json");
const LINUX_X86_64_PLATFORM_KEY: &str = "linux-x86_64";
const MACOS_UNIVERSAL_PLATFORM_KEY: &str = "macos-universal";
const WINDOWS_X86_64_PLATFORM_KEY: &str = "windows-x86_64";
const WINDOWS_11_MINIMUM_BUILD: u32 = 22000;

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
struct DetectedPlatform {
    operating_system: BdbOperatingSystem,
    architecture: BdbArchitecture,
    windows_build: Option<u32>,
}

/// Describes the current machine's compatibility with the maintained `bdb` support matrix.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbPlatformSupport {
    status: BdbSupportStatus,
    operating_system: BdbOperatingSystem,
    architecture: BdbArchitecture,
    windows_build: Option<u32>,
    platform_key: Option<String>,
    reason: Option<BdbUnsupportedReason>,
    guidance: String,
}

/// Describes the Board-hosted `bdb` source chosen for the current machine.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbDownloadSource {
    platform_key: String,
    download_url: String,
}

/// Describes the maintained source-resolution plan for `bdb` on the current machine.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BdbSourcePlan {
    manifest_source: String,
    remote_manifest_url: String,
    manifest_schema_version: u32,
    support: BdbPlatformSupport,
    source: Option<BdbDownloadSource>,
}

/// Resolve the bundled `bdb` source plan for the current machine.
pub(crate) fn resolve_current_bdb_source_plan() -> BdbSourcePlan {
    let manifest = bundled_manifest();
    resolve_bdb_source_plan_for_platform(&manifest, detect_current_platform())
}

fn resolve_bdb_source_plan_for_platform(
    manifest: &BdbSourceManifest,
    detected: DetectedPlatform,
) -> BdbSourcePlan {
    let support = match resolve_supported_platform_key(&detected) {
        Ok(platform_key) => match manifest.platforms.get(platform_key) {
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

    let source = support
        .platform_key
        .as_ref()
        .and_then(|platform_key| manifest.platforms.get(platform_key).map(|download_url| {
            BdbDownloadSource {
                platform_key: platform_key.clone(),
                download_url: download_url.clone(),
            }
        }));

    BdbSourcePlan {
        manifest_source: "bundled".into(),
        remote_manifest_url: REMOTE_BDB_SOURCE_MANIFEST_URL.into(),
        manifest_schema_version: manifest.schema_version,
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
            "Board currently publishes bdb only for macOS, Linux amd64, and Windows 11 x86_64.".into()
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

fn bundled_manifest() -> BdbSourceManifest {
    serde_json::from_str(BUNDLED_BDB_SOURCE_MANIFEST_JSON)
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

#[cfg(test)]
mod tests {
    use super::{
        bundled_manifest, parse_windows_build_number, resolve_bdb_source_plan_for_platform,
        BdbArchitecture, BdbOperatingSystem, BdbSupportStatus, BdbUnsupportedReason,
        DetectedPlatform, LINUX_X86_64_PLATFORM_KEY, MACOS_UNIVERSAL_PLATFORM_KEY,
        WINDOWS_X86_64_PLATFORM_KEY,
    };

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
    fn macos_apple_silicon_maps_to_universal_download() {
        let manifest = bundled_manifest();
        let plan = resolve_bdb_source_plan_for_platform(
            &manifest,
            DetectedPlatform {
                operating_system: BdbOperatingSystem::Macos,
                architecture: BdbArchitecture::Aarch64,
                windows_build: None,
            },
        );

        assert_eq!(BdbSupportStatus::Supported, plan.support.status);
        assert_eq!(Some(MACOS_UNIVERSAL_PLATFORM_KEY), plan.support.platform_key.as_deref());
        assert_eq!(
            Some("https://dev.board.fun/downloads/bdb/macos-universal/bdb"),
            plan.source.as_ref().map(|source| source.download_url.as_str())
        );
    }

    #[test]
    fn linux_arm_is_reported_as_unsupported_architecture() {
        let manifest = bundled_manifest();
        let plan = resolve_bdb_source_plan_for_platform(
            &manifest,
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
        let manifest = bundled_manifest();
        let plan = resolve_bdb_source_plan_for_platform(
            &manifest,
            DetectedPlatform {
                operating_system: BdbOperatingSystem::Windows,
                architecture: BdbArchitecture::X86_64,
                windows_build: Some(26100),
            },
        );

        assert_eq!(BdbSupportStatus::Supported, plan.support.status);
        assert_eq!(Some(WINDOWS_X86_64_PLATFORM_KEY), plan.support.platform_key.as_deref());
        assert_eq!(
            Some("https://dev.board.fun/downloads/bdb/windows/bdb.exe"),
            plan.source.as_ref().map(|source| source.download_url.as_str())
        );
    }

    #[test]
    fn windows_10_is_rejected_by_the_windows_11_requirement() {
        let manifest = bundled_manifest();
        let plan = resolve_bdb_source_plan_for_platform(
            &manifest,
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
        let manifest = bundled_manifest();
        let plan = resolve_bdb_source_plan_for_platform(
            &manifest,
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
        let build_number =
            parse_windows_build_number("Microsoft Windows [Version 10.0.26100.1]");

        assert_eq!(Some(26100), build_number);
    }
}
