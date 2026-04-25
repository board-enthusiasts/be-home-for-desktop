use std::io;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub(crate) struct ProcessCommandOutput {
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProcessCommandFailureKind {
    PermissionDenied,
    NotFound,
    TimedOut,
    Other,
}

#[derive(Clone, Debug)]
pub(crate) struct ProcessCommandFailure {
    pub(crate) kind: ProcessCommandFailureKind,
    pub(crate) detail: String,
}

pub(crate) fn run_with_timeout(
    executable_path: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<ProcessCommandOutput, ProcessCommandFailure> {
    let mut child = Command::new(executable_path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(classify_process_failure)?;
    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let output = child.wait_with_output().map_err(classify_process_failure)?;
                return Ok(ProcessCommandOutput {
                    exit_code: output.status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                });
            }
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait_with_output();
                return Err(ProcessCommandFailure {
                    kind: ProcessCommandFailureKind::TimedOut,
                    detail: format!(
                        "`{}` did not finish within {} seconds.",
                        build_command_string(executable_path, args),
                        timeout.as_secs()
                    ),
                });
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait_with_output();
                return Err(classify_process_failure(error));
            }
        }
    }
}

fn classify_process_failure(error: io::Error) -> ProcessCommandFailure {
    let detail = error.to_string();
    let kind = match error.kind() {
        io::ErrorKind::PermissionDenied => ProcessCommandFailureKind::PermissionDenied,
        io::ErrorKind::NotFound => ProcessCommandFailureKind::NotFound,
        _ => ProcessCommandFailureKind::Other,
    };

    ProcessCommandFailure { kind, detail }
}

fn build_command_string(executable_path: &Path, args: &[&str]) -> String {
    let suffix = args.join(" ");
    if suffix.is_empty() {
        executable_path.display().to_string()
    } else {
        format!("{} {suffix}", executable_path.display())
    }
}
