using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;

namespace BE.Home.Desktop.Services
{
    /// <summary>
    /// Provides desktop file and folder picker integration without rendering WebView UI.
    /// </summary>
    internal sealed class NativeFilePickerService
    {
        /// <summary>
        /// Opens a platform file picker for APK files.
        /// </summary>
        /// <returns>The selected path, or an empty string when no path is selected.</returns>
        public async Awaitable<string> PickApkAsync()
        {
            return await RunPickerAsync(BuildFilePickerCommand());
        }

        /// <summary>
        /// Opens a platform folder picker.
        /// </summary>
        /// <returns>The selected path, or an empty string when no path is selected.</returns>
        public async Awaitable<string> PickFolderAsync()
        {
            return await RunPickerAsync(BuildFolderPickerCommand());
        }

        private static async Awaitable<string> RunPickerAsync((string executable, string arguments) command)
        {
            await Awaitable.BackgroundThreadAsync();
            try
            {
                ProcessStartInfo startInfo = new()
                {
                    FileName = command.executable,
                    Arguments = command.arguments,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8
                };

                using Process process = Process.Start(startInfo);
                if (process == null)
                {
                    return string.Empty;
                }

                string output = process.StandardOutput.ReadToEnd().Trim();
                process.WaitForExit(60000);
                return process.ExitCode == 0 ? output : string.Empty;
            }
            catch (Exception exception)
            {
                UnityEngine.Debug.LogWarning($"Native picker failed: {exception.Message}");
                return string.Empty;
            }
            finally
            {
                await Awaitable.MainThreadAsync();
            }
        }

        private static (string executable, string arguments) BuildFilePickerCommand()
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                return (
                    "powershell",
                    "-NoProfile -ExecutionPolicy Bypass -Command \"Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Android packages (*.apk)|*.apk|All files (*.*)|*.*'; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $d.FileName }\"");
            }

            if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            {
                return ("osascript", "-e \"POSIX path of (choose file with prompt \\\"Choose a Board APK\\\")\"");
            }

            return ("zenity", "--file-selection --title=\"Choose a Board APK\" --file-filter=\"Android packages | *.apk\"");
        }

        private static (string executable, string arguments) BuildFolderPickerCommand()
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                return (
                    "powershell",
                    "-NoProfile -ExecutionPolicy Bypass -Command \"Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $d.SelectedPath }\"");
            }

            if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            {
                return ("osascript", "-e \"POSIX path of (choose folder with prompt \\\"Choose a folder\\\")\"");
            }

            return ("zenity", "--file-selection --directory --title=\"Choose a folder\"");
        }
    }
}
