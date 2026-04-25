using BE.Home.Desktop.UI;
using NUnit.Framework;
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
    }
}
