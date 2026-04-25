using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace BE.Home.Desktop.Editor
{
    /// <summary>
    /// Provides batchmode project setup for the desktop Unity project.
    /// </summary>
    public static class BeHomeDesktopProjectBuilder
    {
        private const string MainScenePath = "Assets/BEHomeDesktop/Scenes/Main.unity";
        private const string DefaultWindowsBuildPath = "Build/Windows/BE Home for Desktop.exe";

        /// <summary>
        /// Ensures the desktop Unity project has a main scene and build settings.
        /// </summary>
        public static void ConfigureProject()
        {
            Directory.CreateDirectory("Assets/BEHomeDesktop/Scenes");
            if (!File.Exists(MainScenePath))
            {
                Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, MainScenePath);
            }

            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene(MainScenePath, true)
            };

            PlayerSettings.companyName = "Board Enthusiasts";
            PlayerSettings.productName = "BE Home for Desktop";
            PlayerSettings.bundleVersion = "0.1.0";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Standalone, "com.be.home.desktop");
            AssetDatabase.SaveAssets();
        }

        /// <summary>
        /// Builds the Windows desktop player for local validation and CI.
        /// </summary>
        public static void BuildWindows()
        {
            ConfigureProject();
            string outputPath = System.Environment.GetEnvironmentVariable("BE_HOME_DESKTOP_BUILD_PATH");
            if (string.IsNullOrWhiteSpace(outputPath))
            {
                outputPath = DefaultWindowsBuildPath;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(outputPath) ?? "Build/Windows");
            BuildPlayerOptions options = new()
            {
                scenes = new[] { MainScenePath },
                locationPathName = outputPath,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None
            };

            var report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
            {
                throw new System.InvalidOperationException($"Windows build failed: {report.summary.result}");
            }
        }
    }
}
