using BE.Home.Desktop.UI;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UIElements;

namespace BE.Home.Desktop.Tests
{
    /// <summary>
    /// Covers UI Toolkit route visibility used by in-app navigation.
    /// </summary>
    public sealed class DesktopRouteViewPlayModeTests
    {
        /// <summary>
        /// Verifies setup completion moves the app to the workspace route.
        /// </summary>
        [Test]
        public void ShowPrimaryRouteMovesCompletedSetupToWorkspace()
        {
            VisualElement setup = new();
            VisualElement workspace = new();
            VisualElement settings = new();

            DesktopRouteView.ShowPrimaryRoute(setup, workspace, settings, setupCompleted: true);

            Assert.AreEqual(DisplayStyle.None, setup.style.display.value);
            Assert.AreEqual(DisplayStyle.Flex, workspace.style.display.value);
            Assert.AreEqual(DisplayStyle.None, settings.style.display.value);
        }

        /// <summary>
        /// Verifies About can be opened and closed without replacing the host route.
        /// </summary>
        [Test]
        public void SetAboutVisibleTogglesAboutModal()
        {
            VisualElement about = new();

            DesktopRouteView.SetAboutVisible(about, true);
            Assert.AreEqual(DisplayStyle.Flex, about.style.display.value);

            DesktopRouteView.SetAboutVisible(about, false);
            Assert.AreEqual(DisplayStyle.None, about.style.display.value);
        }

        /// <summary>
        /// Verifies runtime styles are applied to both the document root and the cloned app root.
        /// </summary>
        [Test]
        public void ApplyRuntimeStyleSheetsAddsDesktopSheetToDocumentAndAppRoot()
        {
            VisualElement documentRoot = new();
            VisualElement appRoot = new() { name = "app-root" };
            StyleSheet desktopStyleSheet = ScriptableObject.CreateInstance<StyleSheet>();
            documentRoot.Add(appRoot);

            try
            {
                bool applied = DesktopAppController.ApplyRuntimeStyleSheets(documentRoot, desktopStyleSheet);

                Assert.IsTrue(applied);
                Assert.IsTrue(documentRoot.styleSheets.Contains(desktopStyleSheet));
                Assert.IsTrue(appRoot.styleSheets.Contains(desktopStyleSheet));
            }
            finally
            {
                Object.DestroyImmediate(desktopStyleSheet);
            }
        }

        /// <summary>
        /// Verifies the desktop bootstrap creates a camera when the scene has none.
        /// </summary>
        [Test]
        public void EnsureRenderCameraCreatesFallbackCamera()
        {
            DestroyAllCameras();

            Camera renderCamera = DesktopAppController.EnsureRenderCamera();

            Assert.IsNotNull(renderCamera);
            Assert.AreEqual(CameraClearFlags.SolidColor, renderCamera.clearFlags);
            Assert.AreEqual(Color.black, renderCamera.backgroundColor);
            Assert.AreEqual(0, renderCamera.cullingMask);
            Assert.IsTrue(renderCamera.orthographic);

            Object.DestroyImmediate(renderCamera.gameObject);
        }

        /// <summary>
        /// Verifies the desktop bootstrap reuses an existing scene camera.
        /// </summary>
        [Test]
        public void EnsureRenderCameraReusesExistingCamera()
        {
            DestroyAllCameras();
            GameObject cameraHost = new("Existing Camera");
            Camera existingCamera = cameraHost.AddComponent<Camera>();

            Camera renderCamera = DesktopAppController.EnsureRenderCamera();

            Assert.AreSame(existingCamera, renderCamera);

            Object.DestroyImmediate(cameraHost);
        }

        private static void DestroyAllCameras()
        {
            foreach (Camera camera in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include))
            {
                Object.DestroyImmediate(camera.gameObject);
            }
        }
    }
}
