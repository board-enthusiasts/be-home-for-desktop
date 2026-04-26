using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Threading;
using BE.Home.Desktop.Domain;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace BE.Home.Desktop.Services
{
    /// <summary>
    /// Runs bdb commands away from the Unity main thread.
    /// </summary>
    internal sealed class BdbProcessService
    {
        /// <summary>
        /// Runs a process and captures its result.
        /// </summary>
        /// <param name="executablePath">The executable path.</param>
        /// <param name="arguments">The command arguments.</param>
        /// <param name="timeoutMilliseconds">The timeout in milliseconds.</param>
        /// <param name="cancellationToken">A cancellation token.</param>
        /// <returns>The captured process result.</returns>
        public async Awaitable<BdbProcessResult> RunAsync(
            string executablePath,
            IEnumerable<string> arguments,
            int timeoutMilliseconds,
            CancellationToken cancellationToken = default)
        {
            await Awaitable.BackgroundThreadAsync();
            try
            {
                return RunBlocking(executablePath, arguments, timeoutMilliseconds, cancellationToken);
            }
            finally
            {
                await Awaitable.MainThreadAsync();
            }
        }

        private static BdbProcessResult RunBlocking(
            string executablePath,
            IEnumerable<string> arguments,
            int timeoutMilliseconds,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(executablePath))
            {
                return new BdbProcessResult(1, string.Empty, "bdb executable path is not configured.", false);
            }

            ProcessStartInfo startInfo = new()
            {
                FileName = executablePath,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            foreach (string argument in arguments ?? Enumerable.Empty<string>())
            {
                startInfo.ArgumentList.Add(argument);
            }

            using Process process = new() { StartInfo = startInfo };
            StringBuilder output = new();
            StringBuilder error = new();
            process.OutputDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data != null)
                {
                    output.AppendLine(eventArgs.Data);
                }
            };
            process.ErrorDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data != null)
                {
                    error.AppendLine(eventArgs.Data);
                }
            };

            try
            {
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                int elapsed = 0;
                while (!process.HasExited)
                {
                    if (cancellationToken.IsCancellationRequested || elapsed >= timeoutMilliseconds)
                    {
                        KillProcess(process);
                        return new BdbProcessResult(1, output.ToString(), error.ToString(), true);
                    }

                    Thread.Sleep(50);
                    elapsed += 50;
                }

                process.WaitForExit();
                return new BdbProcessResult(process.ExitCode, output.ToString(), error.ToString(), false);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"bdb process failed: {exception.Message}");
                return new BdbProcessResult(1, output.ToString(), exception.Message, false);
            }
        }

        private static void KillProcess(Process process)
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill();
                }
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"Failed to stop bdb process: {exception.Message}");
            }
        }
    }
}

