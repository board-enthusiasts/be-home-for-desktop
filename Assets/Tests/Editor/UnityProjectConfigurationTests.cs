using System.IO;
using NUnit.Framework;

namespace BE.Home.Desktop.Tests
{
    /// <summary>
    /// Verifies Unity project-level package and player settings that protect desktop runtime behavior.
    /// </summary>
    public sealed class UnityProjectConfigurationTests
    {
        /// <summary>
        /// Verifies the maintained project uses Unity's newer Input System backend instead of the legacy Input Manager.
        /// </summary>
        [Test]
        public void ProjectUsesInputSystemBackend()
        {
            string manifest = File.ReadAllText("Packages/manifest.json");
            string playerSettings = File.ReadAllText("ProjectSettings/ProjectSettings.asset");

            StringAssert.Contains("\"com.unity.inputsystem\": \"1.19.0\"", manifest);
            StringAssert.Contains("activeInputHandler: 1", playerSettings);
        }

        /// <summary>
        /// Verifies the maintained project targets the Unity 6.4 built-in Test Framework package.
        /// </summary>
        [Test]
        public void ProjectUsesUnitySixTestFrameworkPackage()
        {
            string manifest = File.ReadAllText("Packages/manifest.json");

            StringAssert.Contains("\"com.unity.test-framework\": \"1.6.0\"", manifest);
        }

        /// <summary>
        /// Verifies runtime UI has the default Unity theme resource required by PanelSettings.
        /// </summary>
        [Test]
        public void ProjectProvidesRuntimeThemeResource()
        {
            string theme = File.ReadAllText("Assets/Runtime/Resources/UnityDefaultRuntimeTheme.tss");

            StringAssert.Contains("unity-theme://default", theme);
        }

        /// <summary>
        /// Verifies the desktop runtime stylesheet has a unique Resources path and expected root selector.
        /// </summary>
        [Test]
        public void ProjectProvidesRuntimeDesktopStyleSheetResource()
        {
            string styleSheet = File.ReadAllText("Assets/Runtime/Resources/DesktopAppStyles.uss");

            Assert.IsFalse(File.Exists("Assets/Runtime/Resources/DesktopApp.uss"));
            StringAssert.Contains(".desktop-root", styleSheet);
        }

        /// <summary>
        /// Verifies the Unity desktop shell keeps the expected Tauri-port setup and workspace copy.
        /// </summary>
        [Test]
        public void DesktopAppKeepsExpectedTauriPortCopy()
        {
            string uxml = File.ReadAllText("Assets/Runtime/Resources/DesktopApp.uxml");

            StringAssert.Contains("Set up BE Home for Desktop", uxml);
            StringAssert.Contains("Setup gets BE Home ready to find games and apps on this computer and install them on Board without command-line steps.", uxml);
            StringAssert.Contains("Board's formal name for this helper is Board Developer Bridge (bdb).", uxml);
            StringAssert.Contains("Choose a game or app from this computer.", uxml);
            StringAssert.Contains("Open a game that is ready to launch, or remove something you no longer want on the device.", uxml);
        }
    }
}
