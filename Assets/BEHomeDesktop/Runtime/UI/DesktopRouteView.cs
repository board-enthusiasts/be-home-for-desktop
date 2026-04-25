using UnityEngine.UIElements;

namespace BE.Home.Desktop.UI
{
    /// <summary>
    /// Applies UI Toolkit route visibility for the desktop app.
    /// </summary>
    internal static class DesktopRouteView
    {
        /// <summary>
        /// Shows either setup or workspace as the main route.
        /// </summary>
        /// <param name="setupView">The setup route element.</param>
        /// <param name="workspaceView">The workspace route element.</param>
        /// <param name="settingsView">The settings route element.</param>
        /// <param name="setupCompleted">Whether setup has completed.</param>
        public static void ShowPrimaryRoute(
            VisualElement setupView,
            VisualElement workspaceView,
            VisualElement settingsView,
            bool setupCompleted)
        {
            setupView.style.display = setupCompleted ? DisplayStyle.None : DisplayStyle.Flex;
            workspaceView.style.display = setupCompleted ? DisplayStyle.Flex : DisplayStyle.None;
            settingsView.style.display = DisplayStyle.None;
        }

        /// <summary>
        /// Shows the settings route over the workspace route.
        /// </summary>
        /// <param name="workspaceView">The workspace route element.</param>
        /// <param name="settingsView">The settings route element.</param>
        public static void ShowSettings(VisualElement workspaceView, VisualElement settingsView)
        {
            workspaceView.style.display = DisplayStyle.None;
            settingsView.style.display = DisplayStyle.Flex;
        }

        /// <summary>
        /// Shows the workspace route over the settings route.
        /// </summary>
        /// <param name="workspaceView">The workspace route element.</param>
        /// <param name="settingsView">The settings route element.</param>
        public static void ShowWorkspace(VisualElement workspaceView, VisualElement settingsView)
        {
            settingsView.style.display = DisplayStyle.None;
            workspaceView.style.display = DisplayStyle.Flex;
        }

        /// <summary>
        /// Shows or hides the About modal.
        /// </summary>
        /// <param name="aboutModal">The About modal element.</param>
        /// <param name="visible">Whether the modal is visible.</param>
        public static void SetAboutVisible(VisualElement aboutModal, bool visible)
        {
            aboutModal.style.display = visible ? DisplayStyle.Flex : DisplayStyle.None;
        }
    }
}
