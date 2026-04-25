using System.IO;
using BE.Home.Desktop.Domain;
using UnityEngine;

namespace BE.Home.Desktop.Services
{
    /// <summary>
    /// Loads and saves desktop settings in Unity's persistent data path.
    /// </summary>
    internal sealed class DesktopSettingsStore
    {
        private const string SettingsFileName = "desktop-settings.json";
        private readonly string m_settingsDirectory;

        /// <summary>
        /// Initializes a new settings store.
        /// </summary>
        /// <param name="settingsDirectory">Optional settings directory override for tests.</param>
        public DesktopSettingsStore(string settingsDirectory = null)
        {
            m_settingsDirectory = string.IsNullOrWhiteSpace(settingsDirectory)
                ? Application.persistentDataPath
                : settingsDirectory;
        }

        /// <summary>
        /// Loads the saved desktop settings.
        /// </summary>
        /// <returns>The saved settings, or defaults when no file exists.</returns>
        public DesktopSettingsData Load()
        {
            string path = GetSettingsPath();
            if (!File.Exists(path))
            {
                return CreateDefault();
            }

            string json = File.ReadAllText(path);
            DesktopSettingsData settings = JsonUtility.FromJson<DesktopSettingsData>(json);
            return settings ?? CreateDefault();
        }

        /// <summary>
        /// Saves desktop settings.
        /// </summary>
        /// <param name="settings">The settings to save.</param>
        public void Save(DesktopSettingsData settings)
        {
            Directory.CreateDirectory(m_settingsDirectory);
            string json = JsonUtility.ToJson(settings ?? CreateDefault(), true);
            File.WriteAllText(GetSettingsPath(), json);
        }

        private DesktopSettingsData CreateDefault()
        {
            return new DesktopSettingsData
            {
                setupCompleted = false,
                libraryPath = Path.Combine(m_settingsDirectory, "Library")
            };
        }

        private string GetSettingsPath()
        {
            return Path.Combine(m_settingsDirectory, SettingsFileName);
        }
    }
}
