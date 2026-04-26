using System;
using System.IO;
using BE.Home.Desktop.Domain;
using BE.Home.Desktop.Services;
using NUnit.Framework;

namespace BE.Home.Desktop.Tests
{
    /// <summary>
    /// Covers setup completion state persistence.
    /// </summary>
    public sealed class DesktopSettingsStoreTests
    {
        /// <summary>
        /// Verifies fresh settings represent an incomplete setup flow.
        /// </summary>
        [Test]
        public void LoadReturnsIncompleteSetupByDefault()
        {
            string directory = CreateTempDirectory();
            DesktopSettingsStore store = new(directory);

            DesktopSettingsData settings = store.Load();

            Assert.IsFalse(settings.setupCompleted);
            Assert.That(settings.libraryPath, Does.Contain(directory));
        }

        /// <summary>
        /// Verifies setup completion survives save and load.
        /// </summary>
        [Test]
        public void SavePersistsSetupCompletionState()
        {
            string directory = CreateTempDirectory();
            DesktopSettingsStore store = new(directory);
            DesktopSettingsData settings = store.Load();
            settings.setupCompleted = true;
            settings.bdbPath = "C:/tools/bdb.exe";

            store.Save(settings);

            DesktopSettingsData loaded = store.Load();
            Assert.IsTrue(loaded.setupCompleted);
            Assert.AreEqual("C:/tools/bdb.exe", loaded.bdbPath);
        }

        /// <summary>
        /// Verifies a settings store cannot be created without an explicit directory.
        /// </summary>
        [Test]
        public void ConstructorRequiresSettingsDirectory()
        {
            Assert.Throws<ArgumentException>(() => new DesktopSettingsStore(string.Empty));
        }

        private static string CreateTempDirectory()
        {
            string directory = Path.Combine(Path.GetTempPath(), Path.GetRandomFileName());
            Directory.CreateDirectory(directory);
            return directory;
        }
    }
}
