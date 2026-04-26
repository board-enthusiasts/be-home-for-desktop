using System.IO;
using System.Threading;
using System.Threading.Tasks;
using BE.Home.Desktop.Services;
using NUnit.Framework;

namespace BE.Home.Desktop.Tests
{
    /// <summary>
    /// Covers bdb process execution behavior.
    /// </summary>
    public sealed class BdbProcessServiceTests
    {
        /// <summary>
        /// Verifies output capture from a fake bdb command.
        /// </summary>
        [Test]
        public async Task RunAsyncCapturesProcessOutput()
        {
            string executable = CreateFakeBdb("echo Board connected");
            BdbProcessService service = new();

            var result = await service.RunAsync(executable, new[] { "status" }, 3000);

            Assert.AreEqual(0, result.ExitCode);
            Assert.That(result.StandardOutput, Does.Contain("Board connected"));
        }

        /// <summary>
        /// Verifies slow commands are stopped after the supplied timeout.
        /// </summary>
        [Test]
        public async Task RunAsyncReturnsTerminatedResultWhenProcessTimesOut()
        {
            string executable = CreateFakeBdb("ping -n 6 127.0.0.1 > nul");
            BdbProcessService service = new();

            var result = await service.RunAsync(executable, new[] { "status" }, 100);

            Assert.AreEqual(1, result.ExitCode);
            Assert.IsTrue(result.WasTerminated);
        }

        /// <summary>
        /// Verifies cancellation stops an in-flight command without blocking the test runner.
        /// </summary>
        [Test]
        public async Task RunAsyncReturnsTerminatedResultWhenProcessIsCancelled()
        {
            string executable = CreateFakeBdb("ping -n 6 127.0.0.1 > nul");
            using CancellationTokenSource cancellation = new();
            BdbProcessService service = new();

            cancellation.CancelAfter(100);
            var result = await service.RunAsync(executable, new[] { "status" }, 3000, cancellation.Token);

            Assert.AreEqual(1, result.ExitCode);
            Assert.IsTrue(result.WasTerminated);
        }

        private static string CreateFakeBdb(string command)
        {
            string path = Path.Combine(Path.GetTempPath(), $"{Path.GetRandomFileName()}.cmd");
            File.WriteAllText(path, $"@echo off\r\n{command}\r\n");
            return path;
        }
    }
}
