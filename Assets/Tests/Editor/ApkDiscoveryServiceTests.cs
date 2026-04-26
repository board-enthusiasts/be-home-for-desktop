using System.IO;
using BE.Home.Desktop.Domain;
using NUnit.Framework;

namespace BE.Home.Desktop.Tests
{
    /// <summary>
    /// Covers local APK discovery behavior.
    /// </summary>
    public sealed class ApkDiscoveryServiceTests
    {
        /// <summary>
        /// Verifies APK candidates are returned from scan folders.
        /// </summary>
        [Test]
        public void DiscoverReturnsApkCandidates()
        {
            string root = Path.Combine(Path.GetTempPath(), Path.GetRandomFileName());
            Directory.CreateDirectory(root);
            string apkPath = Path.Combine(root, "board-game.apk");
            File.WriteAllText(apkPath, string.Empty);

            try
            {
                ApkDiscoveryService service = new();
                var candidates = service.Discover(new[] { root });

                Assert.AreEqual(1, candidates.Count);
                Assert.AreEqual(apkPath, candidates[0].Path);
                Assert.AreEqual("Strong match", candidates[0].Confidence);
            }
            finally
            {
                Directory.Delete(root, true);
            }
        }
    }
}

