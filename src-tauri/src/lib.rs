mod bdb;

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopShellState {
    app_name: String,
    version: String,
    platform_label: String,
    intro_eyebrow: String,
    intro_summary: String,
    highlights: Vec<ShellBadge>,
    getting_started_title: String,
    getting_started_steps: Vec<String>,
    help_title: String,
    help_summary: String,
    help_bullets: Vec<String>,
    sections: Vec<ShellSection>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellSection {
    id: String,
    eyebrow: String,
    title: String,
    summary: String,
    tone: String,
    badges: Vec<ShellBadge>,
    bullets: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellBadge {
    label: String,
    value: String,
}

fn shell_state() -> DesktopShellState {
    DesktopShellState {
        app_name: "BE Home for Desktop".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        platform_label: current_platform_label().into(),
        intro_eyebrow: "Board installs made easier".into(),
        intro_summary: "Keep your Board install tool ready, choose an APK from your computer, and keep favorite installs close for later.".into(),
        highlights: vec![
            ShellBadge {
                label: "Works with".into(),
                value: "USB + APK".into(),
            },
            ShellBadge {
                label: "Manual choice".into(),
                value: "Always welcome".into(),
            },
            ShellBadge {
                label: "BE account".into(),
                value: "Optional".into(),
            },
        ],
        getting_started_title: "Keep your next install close and familiar.".into(),
        getting_started_steps: vec![
            "Connect your Board with USB when you are ready to install.".into(),
            "Choose a game or app APK from Downloads or another folder you already trust.".into(),
            "Keep favorite APKs together so reinstalling later takes fewer steps.".into(),
        ],
        help_title: "Built for real player routines".into(),
        help_summary: "BE Home keeps the most important install steps in one place so getting back to play feels less scattered.".into(),
        help_bullets: vec![
            "If you already know which download you want, you can still pick the APK yourself.".into(),
            "Once the Board install tool is ready, local checks and library browsing can stay useful without a network connection.".into(),
            "Your BE account can help with matching later, but it should never be the only way to finish a local install.".into(),
        ],
        sections: vec![
            ShellSection {
                id: "bdb-setup".into(),
                eyebrow: "Keep setup simple".into(),
                title: "Stay ready for the Board install tool".into(),
                summary: "BE Home keeps the required Board install tool easy to find so getting back to a game or app takes less guesswork.".into(),
                tone: "sunrise".into(),
                badges: vec![
                    ShellBadge {
                        label: "Needed once".into(),
                        value: "Set up bdb".into(),
                    },
                    ShellBadge {
                        label: "Stored for you".into(),
                        value: "App space".into(),
                    },
                ],
                bullets: vec![
                    "Keep the Board install tool nearby so you do not have to chase it down each time you want to install.".into(),
                    "Save it in a familiar app-owned location with room for a player-friendly override.".into(),
                    "Check it early so repair guidance is ready before you start an install.".into(),
                ],
            },
            ShellSection {
                id: "device-status".into(),
                eyebrow: "Know before you install".into(),
                title: "Check your Board connection at a glance".into(),
                summary: "See when your Board is ready, then move into install, reinstall, or launch steps with more confidence.".into(),
                tone: "ocean".into(),
                badges: vec![
                    ShellBadge {
                        label: "Connection".into(),
                        value: "USB".into(),
                    },
                    ShellBadge {
                        label: "Updates".into(),
                        value: "Clear guidance".into(),
                    },
                ],
                bullets: vec![
                    "Check whether your Board is connected without sending you into terminal troubleshooting.".into(),
                    "Keep install, uninstall, and launch steps tied to easy-to-follow readiness messages.".into(),
                    "Refresh the device picture while the app stays open so you do not have to keep starting over.".into(),
                ],
            },
            ShellSection {
                id: "apk-library".into(),
                eyebrow: "Choose what to install".into(),
                title: "Find downloads from familiar folders or your saved library".into(),
                summary: "Keep Board-ready APKs together, browse what you already downloaded, and pick an APK yourself whenever that is fastest.".into(),
                tone: "forest".into(),
                badges: vec![
                    ShellBadge {
                        label: "Manual choice".into(),
                        value: "Always welcome".into(),
                    },
                    ShellBadge {
                        label: "Saved library".into(),
                        value: "Ready for later".into(),
                    },
                ],
                bullets: vec![
                    "Start with familiar folders such as Downloads and let players add more when they want to.".into(),
                    "Keep a local library for titles you return to often or want ready for reinstall.".into(),
                    "Pick any APK yourself when that is the fastest way to move forward.".into(),
                ],
            },
            ShellSection {
                id: "account-enhancements".into(),
                eyebrow: "Optional extras".into(),
                title: "Bring your BE library with you when it helps".into(),
                summary: "Sign in for quicker library and wishlist matching, or stay local-only when you just want to install from your own computer.".into(),
                tone: "slate".into(),
                badges: vec![
                    ShellBadge {
                        label: "Sign-in".into(),
                        value: "Optional".into(),
                    },
                    ShellBadge {
                        label: "Local flow".into(),
                        value: "Works on its own".into(),
                    },
                ],
                bullets: vec![
                    "Bring in your BE wishlist and library only when they save time.".into(),
                    "Keep local device checks and installs useful even if you never sign in.".into(),
                    "Let account features feel like a convenience, not a requirement.".into(),
                ],
            },
        ],
    }
}

fn current_platform_label() -> &'static str {
    if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        "Unsupported desktop platform"
    }
}

#[tauri::command]
fn load_shell_state() -> DesktopShellState {
    shell_state()
}

#[tauri::command]
fn load_bdb_source_plan() -> bdb::BdbSourcePlan {
    bdb::resolve_current_bdb_source_plan()
}

/// Starts the Tauri desktop host for BE Home for Desktop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_shell_state,
            load_bdb_source_plan
        ])
        .run(tauri::generate_context!())
        .expect("error while running BE Home for Desktop");
}

#[cfg(test)]
mod tests {
    use super::shell_state;

    #[test]
    fn shell_state_describes_player_install_workflow() {
        let state = shell_state();

        assert_eq!(state.app_name, "BE Home for Desktop");
        assert_eq!(state.sections.len(), 4);
        assert_eq!(state.getting_started_steps.len(), 3);
        assert_eq!(state.help_bullets.len(), 3);
        assert!(state.sections.iter().any(|section| section
            .bullets
            .iter()
            .any(|bullet| bullet.contains("Pick any APK yourself"))));
    }

    #[test]
    fn shell_state_avoids_internal_placeholder_language() {
        let state = shell_state();
        let banned_terms = [
            "scaffold",
            "placeholder",
            "planned",
            "next wave",
            "foundation shell",
        ];
        let mut copy = vec![
            state.app_name.clone(),
            state.intro_eyebrow.clone(),
            state.intro_summary.clone(),
            state.getting_started_title.clone(),
            state.help_title.clone(),
            state.help_summary.clone(),
        ];

        assert!(!state.platform_label.is_empty());

        for highlight in state.highlights {
            copy.push(highlight.label);
            copy.push(highlight.value);
        }
        for item in state.getting_started_steps {
            copy.push(item);
        }
        for item in state.help_bullets {
            copy.push(item);
        }
        for section in state.sections {
            copy.push(section.eyebrow);
            copy.push(section.title);
            copy.push(section.summary);
            for badge in section.badges {
                copy.push(badge.label);
                copy.push(badge.value);
            }
            for bullet in section.bullets {
                copy.push(bullet);
            }
        }

        assert!(copy.iter().all(|entry| {
            let normalized = entry.to_lowercase();
            banned_terms.iter().all(|term| !normalized.contains(term))
        }));
    }

    #[test]
    fn bdb_source_plan_uses_the_bundled_manifest_contract() {
        let plan = super::load_bdb_source_plan();
        let serialized = serde_json::to_value(plan).expect("bdb source plan should serialize");

        assert_eq!(Some("bundled"), serialized.get("manifestSource").and_then(|value| value.as_str()));
        assert_eq!(Some(1), serialized.get("manifestSchemaVersion").and_then(|value| value.as_u64()));
        assert!(serialized
            .get("remoteManifestUrl")
            .and_then(|value| value.as_str())
            .is_some_and(|value| value.contains("raw.githubusercontent.com/board-enthusiasts/be-home-for-desktop/main/config/bdb-sources.json")));
    }
}
