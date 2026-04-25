using System.Collections.Generic;
using System.Linq;
using BE.Home.Desktop.Domain;
using BE.Home.Desktop.Services;
using BE.Unity.Shared.UI;
using UnityEngine;
using UnityEngine.UIElements;

namespace BE.Home.Desktop.UI
{
    /// <summary>
    /// Boots and coordinates the BE Home for Desktop UI Toolkit app.
    /// </summary>
    internal sealed class DesktopAppController : MonoBehaviour
    {
        private readonly ApkDiscoveryService m_apkDiscoveryService = new();
        private readonly BdbProcessService m_bdbProcessService = new();
        private readonly DesktopSettingsStore m_settingsStore = new();
        private readonly NativeFilePickerService m_filePickerService = new();
        private DesktopSettingsData m_settings;
        private VisualElement m_root;
        private VisualElement m_setupView;
        private VisualElement m_workspaceView;
        private VisualElement m_settingsView;
        private VisualElement m_aboutModal;
        private Label m_statusLabel;
        private Label m_boardOsLabel;
        private Label m_apkListLabel;
        private TextField m_bdbPathField;
        private TextField m_libraryPathField;
        private TextField m_scanFoldersField;
        private TextField m_settingsBdbPathField;
        private TextField m_settingsLibraryPathField;
        private TextField m_settingsScanFoldersField;

        /// <summary>
        /// Creates the app controller before the first scene starts.
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        public static void Bootstrap()
        {
            GameObject host = new("BE Home for Desktop");
            DontDestroyOnLoad(host);
            host.AddComponent<DesktopAppController>();
        }

        private void Awake()
        {
            m_settings = m_settingsStore.Load();
            UIDocument document = gameObject.AddComponent<UIDocument>();
            PanelSettings panelSettings = ScriptableObject.CreateInstance<PanelSettings>();
            panelSettings.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            panelSettings.referenceResolution = new Vector2Int(1440, 960);
            panelSettings.clearColor = true;
            document.panelSettings = panelSettings;
            document.visualTreeAsset = Resources.Load<VisualTreeAsset>("DesktopApp");
        }

        private void OnEnable()
        {
            m_root = GetComponent<UIDocument>().rootVisualElement;
            BeSharedStyleLoader.ApplyTo(m_root);
            StyleSheet styleSheet = Resources.Load<StyleSheet>("DesktopApp");
            if (styleSheet != null)
            {
                m_root.styleSheets.Add(styleSheet);
            }

            BindElements();
            BindActions();
            RenderCurrentRoute();
        }

        private void BindElements()
        {
            m_setupView = m_root.Q<VisualElement>("setup-view");
            m_workspaceView = m_root.Q<VisualElement>("workspace-view");
            m_settingsView = m_root.Q<VisualElement>("settings-view");
            m_aboutModal = m_root.Q<VisualElement>("about-modal");
            m_statusLabel = m_root.Q<Label>("board-status-label");
            m_boardOsLabel = m_root.Q<Label>("board-os-label");
            m_apkListLabel = m_root.Q<Label>("apk-list-label");
            m_bdbPathField = m_root.Q<TextField>("bdb-path-field");
            m_libraryPathField = m_root.Q<TextField>("library-path-field");
            m_scanFoldersField = m_root.Q<TextField>("scan-folders-field");
            m_settingsBdbPathField = m_root.Q<TextField>("settings-bdb-path-field");
            m_settingsLibraryPathField = m_root.Q<TextField>("settings-library-path-field");
            m_settingsScanFoldersField = m_root.Q<TextField>("settings-scan-folders-field");
        }

        private void BindActions()
        {
            m_root.Q<Button>("finish-setup-button").clicked += CompleteSetup;
            m_root.Q<Button>("open-settings-button").clicked += ShowSettings;
            m_root.Q<Button>("close-settings-button").clicked += SaveSettingsAndShowWorkspace;
            m_root.Q<Button>("open-about-button").clicked += ShowAbout;
            m_root.Q<Button>("close-about-button").clicked += HideAbout;
            m_root.Q<Button>("refresh-status-button").clicked += () => _ = RefreshStatusAsync();
            m_root.Q<Button>("choose-apk-button").clicked += () => _ = ChooseApkAsync();
            m_root.Q<Button>("add-folder-button").clicked += () => _ = AddFolderAsync();
            m_root.Q<Button>("rescan-button").clicked += RefreshApkList;
        }

        private void RenderCurrentRoute()
        {
            UpdateFieldsFromSettings();
            DesktopRouteView.ShowPrimaryRoute(m_setupView, m_workspaceView, m_settingsView, m_settings.setupCompleted);
            DesktopRouteView.SetAboutVisible(m_aboutModal, false);
            RefreshApkList();
            _ = RefreshStatusAsync();
        }

        private void CompleteSetup()
        {
            SaveSetupFields();
            m_settings.setupCompleted = true;
            m_settingsStore.Save(m_settings);
            RenderCurrentRoute();
        }

        private void ShowSettings()
        {
            UpdateFieldsFromSettings();
            DesktopRouteView.ShowSettings(m_workspaceView, m_settingsView);
        }

        private void SaveSettingsAndShowWorkspace()
        {
            SaveSettingsFields();
            m_settingsStore.Save(m_settings);
            DesktopRouteView.ShowWorkspace(m_workspaceView, m_settingsView);
            RefreshApkList();
        }

        private void ShowAbout()
        {
            DesktopRouteView.SetAboutVisible(m_aboutModal, true);
        }

        private void HideAbout()
        {
            DesktopRouteView.SetAboutVisible(m_aboutModal, false);
        }

        private async Awaitable RefreshStatusAsync()
        {
            m_statusLabel.text = "Checking Board...";
            if (string.IsNullOrWhiteSpace(m_settings.bdbPath))
            {
                m_statusLabel.text = "bdb not configured";
                m_boardOsLabel.text = "Board OS Unavailable";
                return;
            }

            BdbProcessResult result = await m_bdbProcessService.RunAsync(m_settings.bdbPath, new[] { "status" }, 3000);
            BoardStatusSnapshot status = BdbParsers.ParseStatus(result.StandardOutput, result.StandardError, result.ExitCode);
            m_statusLabel.text = status.Summary;
            m_boardOsLabel.text = $"Board OS {status.BoardOsVersion}";
        }

        private async Awaitable ChooseApkAsync()
        {
            string path = await m_filePickerService.PickApkAsync();
            if (!string.IsNullOrWhiteSpace(path))
            {
                m_apkListLabel.text = $"Selected APK:\n{path}";
            }
        }

        private async Awaitable AddFolderAsync()
        {
            string path = await m_filePickerService.PickFolderAsync();
            if (!string.IsNullOrWhiteSpace(path) && !m_settings.scanFolders.Contains(path))
            {
                m_settings.scanFolders.Add(path);
                UpdateFieldsFromSettings();
                m_settingsStore.Save(m_settings);
                RefreshApkList();
            }
        }

        private void RefreshApkList()
        {
            IReadOnlyList<ApkCandidate> candidates = m_apkDiscoveryService.Discover(m_settings.scanFolders);
            m_apkListLabel.text = candidates.Count == 0
                ? "No APKs found yet."
                : string.Join("\n", candidates.Select(candidate => $"{candidate.Confidence}: {candidate.Path}"));
        }

        private void SaveSetupFields()
        {
            SaveSettingsFromValues(m_bdbPathField.value, m_libraryPathField.value, m_scanFoldersField.value);
        }

        private void SaveSettingsFields()
        {
            SaveSettingsFromValues(m_settingsBdbPathField.value, m_settingsLibraryPathField.value, m_settingsScanFoldersField.value);
        }

        private void SaveSettingsFromValues(string bdbPath, string libraryPath, string scanFolders)
        {
            m_settings.bdbPath = bdbPath ?? string.Empty;
            m_settings.libraryPath = libraryPath ?? string.Empty;
            m_settings.scanFolders = (scanFolders ?? string.Empty)
                .Split(new[] { '\n', '\r' }, System.StringSplitOptions.RemoveEmptyEntries)
                .Select(value => value.Trim())
                .Where(value => value.Length > 0)
                .Distinct()
                .ToList();
        }

        private void UpdateFieldsFromSettings()
        {
            string folders = string.Join("\n", m_settings.scanFolders);
            m_bdbPathField.value = m_settings.bdbPath;
            m_libraryPathField.value = m_settings.libraryPath;
            m_scanFoldersField.value = folders;
            m_settingsBdbPathField.value = m_settings.bdbPath;
            m_settingsLibraryPathField.value = m_settings.libraryPath;
            m_settingsScanFoldersField.value = folders;
        }
    }
}
