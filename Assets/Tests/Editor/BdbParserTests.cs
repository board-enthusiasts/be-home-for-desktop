using BE.Home.Desktop.Domain;
using NUnit.Framework;

namespace BE.Home.Desktop.Tests
{
    /// <summary>
    /// Covers bdb parser behavior.
    /// </summary>
    public sealed class BdbParserTests
    {
        /// <summary>
        /// Verifies connected status parsing and Board OS version extraction.
        /// </summary>
        [Test]
        public void ParseStatusDetectsConnectedBoardAndVersion()
        {
            BoardStatusSnapshot status = BdbParsers.ParseStatus("Board connected\nBoard OS Version: 1.8.1", string.Empty, 0);

            Assert.AreEqual(BoardConnectionKind.Connected, status.Kind);
            Assert.AreEqual("1.8.1", status.BoardOsVersion);
        }

        /// <summary>
        /// Verifies disconnected Board output parsing.
        /// </summary>
        [Test]
        public void ParseStatusDetectsDisconnectedBoard()
        {
            BoardStatusSnapshot status = BdbParsers.ParseStatus("no devices found", string.Empty, 1);

            Assert.AreEqual(BoardConnectionKind.Disconnected, status.Kind);
            Assert.AreEqual("Unavailable", status.BoardOsVersion);
        }

        /// <summary>
        /// Verifies installed title row parsing.
        /// </summary>
        [Test]
        public void ParseInstalledTitlesHandlesLabelledRows()
        {
            var titles = BdbParsers.ParseInstalledTitles("Tile Runner: com.example.tilerunner\ncom.example.rawpackage");

            Assert.AreEqual(2, titles.Count);
            Assert.AreEqual("com.example.tilerunner", titles[0].PackageName);
            Assert.AreEqual("Tile Runner", titles[0].DisplayName);
        }
    }
}

