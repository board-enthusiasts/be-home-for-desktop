using System;
using System.Collections.Generic;

namespace BE.Home.Desktop.Domain
{
    /// <summary>
    /// Describes the current Board connection state.
    /// </summary>
    internal enum BoardConnectionKind
    {
        /// <summary>The app has not checked the Board connection yet.</summary>
        Unknown,

        /// <summary>A Board device is connected and responding.</summary>
        Connected,

        /// <summary>No Board device is currently visible to bdb.</summary>
        Disconnected,

        /// <summary>bdb returned output that BE Home could not classify.</summary>
        Unavailable
    }

    /// <summary>
    /// Captures the parsed result of a bdb status check.
    /// </summary>
    internal sealed class BoardStatusSnapshot
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="BoardStatusSnapshot" /> class.
        /// </summary>
        /// <param name="kind">The connection kind.</param>
        /// <param name="summary">A player-facing status summary.</param>
        /// <param name="boardOsVersion">The Board OS version, when known.</param>
        public BoardStatusSnapshot(BoardConnectionKind kind, string summary, string boardOsVersion)
        {
            Kind = kind;
            Summary = summary;
            BoardOsVersion = boardOsVersion;
        }

        /// <summary>Gets the connection kind.</summary>
        public BoardConnectionKind Kind { get; }

        /// <summary>Gets a player-facing status summary.</summary>
        public string Summary { get; }

        /// <summary>Gets the Board OS version, when known.</summary>
        public string BoardOsVersion { get; }
    }

    /// <summary>
    /// Describes the result of a bdb process invocation.
    /// </summary>
    internal sealed class BdbProcessResult
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="BdbProcessResult" /> class.
        /// </summary>
        /// <param name="exitCode">The process exit code.</param>
        /// <param name="standardOutput">The captured standard output.</param>
        /// <param name="standardError">The captured standard error.</param>
        /// <param name="wasTerminated">Whether the process was stopped due to timeout or cancellation.</param>
        public BdbProcessResult(int exitCode, string standardOutput, string standardError, bool wasTerminated)
        {
            ExitCode = exitCode;
            StandardOutput = standardOutput;
            StandardError = standardError;
            WasTerminated = wasTerminated;
        }

        /// <summary>Gets the process exit code.</summary>
        public int ExitCode { get; }

        /// <summary>Gets the captured standard output.</summary>
        public string StandardOutput { get; }

        /// <summary>Gets the captured standard error.</summary>
        public string StandardError { get; }

        /// <summary>Gets a value indicating whether the process was stopped due to timeout or cancellation.</summary>
        public bool WasTerminated { get; }

        /// <summary>Gets a value indicating whether the process was stopped before natural exit.</summary>
        public bool TimedOut => WasTerminated;
    }

    /// <summary>
    /// Describes a title reported by bdb.
    /// </summary>
    internal sealed class InstalledTitle
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="InstalledTitle" /> class.
        /// </summary>
        /// <param name="packageName">The Android package name.</param>
        /// <param name="displayName">The best display name known for the package.</param>
        public InstalledTitle(string packageName, string displayName)
        {
            PackageName = packageName;
            DisplayName = displayName;
        }

        /// <summary>Gets the Android package name.</summary>
        public string PackageName { get; }

        /// <summary>Gets the best display name known for the package.</summary>
        public string DisplayName { get; }
    }

    /// <summary>
    /// Describes an APK candidate discovered on this computer.
    /// </summary>
    internal sealed class ApkCandidate
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="ApkCandidate" /> class.
        /// </summary>
        /// <param name="path">The APK file path.</param>
        /// <param name="confidence">The simple discovery confidence label.</param>
        public ApkCandidate(string path, string confidence)
        {
            Path = path;
            Confidence = confidence;
        }

        /// <summary>Gets the APK file path.</summary>
        public string Path { get; }

        /// <summary>Gets the simple discovery confidence label.</summary>
        public string Confidence { get; }
    }

    /// <summary>
    /// Persists setup and user-selected desktop paths.
    /// </summary>
    [Serializable]
    internal sealed class DesktopSettingsData
    {
        /// <summary>Whether the setup flow has been completed.</summary>
        public bool setupCompleted;

        /// <summary>The saved bdb executable path.</summary>
        public string bdbPath = string.Empty;

        /// <summary>The saved managed library path.</summary>
        public string libraryPath = string.Empty;

        /// <summary>The saved scan folders.</summary>
        public List<string> scanFolders = new();
    }
}
