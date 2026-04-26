using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BE.Home.Desktop.Domain
{
    /// <summary>
    /// Discovers local APK files from user-selected folders.
    /// </summary>
    internal sealed class ApkDiscoveryService
    {
        /// <summary>
        /// Finds APK candidates under the supplied scan folders.
        /// </summary>
        /// <param name="scanFolders">The folders to scan.</param>
        /// <returns>The discovered APK candidates.</returns>
        public IReadOnlyList<ApkCandidate> Discover(IEnumerable<string> scanFolders)
        {
            if (scanFolders == null)
            {
                return Array.Empty<ApkCandidate>();
            }

            return scanFolders
                .Where(folder => !string.IsNullOrWhiteSpace(folder) && Directory.Exists(folder))
                .SelectMany(folder => Directory.EnumerateFiles(folder, "*.apk", SearchOption.AllDirectories))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .Select(path => new ApkCandidate(path, GuessConfidence(path)))
                .ToArray();
        }

        private static string GuessConfidence(string path)
        {
            string fileName = Path.GetFileNameWithoutExtension(path).ToLowerInvariant();
            return fileName.Contains("board") || fileName.Contains("be_home") || fileName.Contains("be-home")
                ? "Strong match"
                : "Manual review";
        }
    }
}

