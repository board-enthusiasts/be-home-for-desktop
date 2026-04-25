using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace BE.Home.Desktop.Domain
{
    /// <summary>
    /// Parses text returned by bdb commands.
    /// </summary>
    internal static class BdbParsers
    {
        private static readonly Regex VersionRegex = new(@"(?<version>\d+\.\d+(?:\.\d+)?)", RegexOptions.Compiled);
        private static readonly Regex PackageRegex = new(@"(?<package>[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)", RegexOptions.Compiled);

        /// <summary>
        /// Parses bdb status output into a Board status snapshot.
        /// </summary>
        /// <param name="output">The standard output to parse.</param>
        /// <param name="error">The standard error to consider.</param>
        /// <param name="exitCode">The process exit code.</param>
        /// <returns>The parsed Board status snapshot.</returns>
        public static BoardStatusSnapshot ParseStatus(string output, string error, int exitCode)
        {
            string combined = $"{output}\n{error}".Trim();
            string lowered = combined.ToLowerInvariant();
            if (exitCode != 0 && combined.Length == 0)
            {
                return new BoardStatusSnapshot(BoardConnectionKind.Unavailable, "Board status is unavailable.", "Unavailable");
            }

            if (lowered.Contains("no devices") || lowered.Contains("not connected") || lowered.Contains("disconnected") || lowered.Contains("offline"))
            {
                return new BoardStatusSnapshot(BoardConnectionKind.Disconnected, "Board disconnected", "Unavailable");
            }

            if (lowered.Contains("connected") || lowered.Contains("ready") || lowered.Contains("device"))
            {
                return new BoardStatusSnapshot(BoardConnectionKind.Connected, "Board connected", ParseVersion(combined) ?? "Unavailable");
            }

            return new BoardStatusSnapshot(BoardConnectionKind.Unavailable, "Board status is unavailable.", "Unavailable");
        }

        /// <summary>
        /// Parses the first semantic version from bdb output.
        /// </summary>
        /// <param name="output">The output to parse.</param>
        /// <returns>The parsed version, or <see langword="null" /> when no version is present.</returns>
        public static string ParseVersion(string output)
        {
            if (string.IsNullOrWhiteSpace(output))
            {
                return null;
            }

            Match match = VersionRegex.Match(output);
            return match.Success ? match.Groups["version"].Value : null;
        }

        /// <summary>
        /// Parses installed title rows from bdb list output.
        /// </summary>
        /// <param name="output">The bdb list output.</param>
        /// <returns>The parsed installed titles.</returns>
        public static IReadOnlyList<InstalledTitle> ParseInstalledTitles(string output)
        {
            if (string.IsNullOrWhiteSpace(output))
            {
                return Array.Empty<InstalledTitle>();
            }

            return output
                .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(ParseInstalledTitleLine)
                .Where(title => title != null)
                .ToArray();
        }

        private static InstalledTitle ParseInstalledTitleLine(string line)
        {
            Match packageMatch = PackageRegex.Match(line);
            if (!packageMatch.Success)
            {
                return null;
            }

            string packageName = packageMatch.Groups["package"].Value;
            string displayName = line.Replace(packageName, string.Empty).Trim(' ', '-', ':', '(', ')');
            return new InstalledTitle(packageName, string.IsNullOrWhiteSpace(displayName) ? packageName : displayName);
        }
    }
}

