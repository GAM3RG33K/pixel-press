//! Native ffmpeg encode — runs the downloaded/PATH `ffmpeg` as a subprocess.
//!
//! The frontend builds the argument list (single source of truth:
//! `src/lib/ffmpeg/command-builder.ts`) and passes it along with the absolute
//! input/output paths. This module only: creates scoped temp paths under
//! `$APPDATA/tmp`, spawns ffmpeg, streams `encode-progress` events parsed from
//! its `-progress pipe:1` output, enforces cancellation, and cleans up the
//! input file when done.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
pub struct EncodePaths {
    pub input_path: String,
    pub output_path: String,
}

#[derive(Deserialize)]
pub struct EncodeRequest {
    pub input_path: String,
    pub output_path: String,
    /// Full argument list including input and output paths.
    pub args: Vec<String>,
    /// Input duration in seconds, used for percent progress.
    pub duration_seconds: f64,
    /// Correlation id for progress events and cancellation.
    pub request_id: String,
    /// Defaults to true (temp input flow). Set false when the input is a user's real file.
    #[serde(default = "default_delete_input")]
    pub delete_input: Option<bool>,
}

fn default_delete_input() -> Option<bool> {
    Some(true)
}

#[derive(Serialize)]
pub struct EncodeResultJson {
    pub duration_ms: u64,
    pub exit_code: i32,
    pub size_bytes: u64,
    pub log_tail: Vec<String>,
}

fn children() -> &'static Mutex<HashMap<String, std::process::Child>> {
    static CHILDREN: OnceLock<Mutex<HashMap<String, std::process::Child>>> = OnceLock::new();
    CHILDREN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let trimmed = cleaned.chars().rev().take(120).collect::<String>().chars().rev().collect::<String>();
    trimmed
}

/// Creates a unique temp directory under `$APPDATA/tmp` and returns the
/// input/output absolute paths inside it.
#[tauri::command]
pub fn encode_paths(app: AppHandle, input_name: String, output_name: String) -> Result<EncodePaths, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("tmp");
    let unique = format!(
        "job-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let dir = base.join(unique);
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(EncodePaths {
        input_path: dir.join(sanitize(&input_name)).to_string_lossy().into_owned(),
        output_path: dir.join(sanitize(&output_name)).to_string_lossy().into_owned(),
    })
}

/// Runs ffmpeg with the given argument list, streaming `encode-progress`
/// events (`{ requestId, progress }`, progress 0-100) parsed from stdout.
#[tauri::command]
pub async fn encode_video(app: AppHandle, request: EncodeRequest) -> Result<EncodeResultJson, String> {
    if let Some(parent) = std::path::Path::new(&request.output_path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
    }

    let ffmpeg = crate::resolve_exe(&app, "ffmpeg")
        .ok_or_else(|| "ffmpeg not found (download via setup, or install it on PATH)".to_string())?;

    // stdout carries the `-progress` key=value stream; stderr carries the log.
    let mut args = request.args.clone();
    args.splice(0..0, ["-hide_banner".to_string(), "-progress".to_string(), "pipe:1".to_string(), "-y".to_string()]);

    let started = std::time::Instant::now();
    let mut child = Command::new(&ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg spawn failed ({e}) — path: {ffmpeg}"))?;

    let stdout = child.stdout.take().ok_or_else(|| "ffmpeg stdout unavailable".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "ffmpeg stderr unavailable".to_string())?;
    let request_id = request.request_id.clone();
    let duration = request.duration_seconds;

    {
        let mut guard = children().lock().map_err(|_| "encode registry poisoned".to_string())?;
        guard.insert(request_id.clone(), child);
    }

    // Drain stderr into a bounded ring buffer for diagnostics.
    let log_handle = std::thread::spawn(move || {
        let mut tail: Vec<String> = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if tail.len() >= 160 {
                tail.remove(0);
            }
            tail.push(line);
        }
        tail
    });

    let app_for_progress = app.clone();
    let progress_request_id = request_id.clone();
    let progress_handle = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms=")) {
                if let Ok(micros) = value.trim().parse::<i64>() {
                    if duration > 0.0 {
                        let seconds = micros as f64 / 1_000_000.0;
                        let progress = ((seconds / duration) * 100.0).clamp(0.0, 100.0);
                        let _ = app_for_progress.emit(
                            "encode-progress",
                            serde_json::json!({ "requestId": progress_request_id, "progress": progress }),
                        );
                    }
                }
            }
        }
    });

    // Wait for the child while holding it out of the registry when finished.
    let mut status: Option<std::process::ExitStatus> = None;
    {
        loop {
            let mut guard = children().lock().map_err(|_| "encode registry poisoned".to_string())?;
            match guard.get_mut(&request_id) {
                Some(child) => match child.try_wait() {
                    Ok(Some(s)) => {
                        status = Some(s);
                        let _ = guard.remove(&request_id);
                        break;
                    }
                    Ok(None) => {
                        drop(guard);
                        std::thread::sleep(std::time::Duration::from_millis(60));
                    }
                    Err(e) => {
                        let _ = guard.remove(&request_id);
                        return Err(format!("ffmpeg wait failed: {e}"));
                    }
                },
                None => {
                    // Child was killed via abort_encode (which reaped it) — we
                    // report abort instead of pretending the encode succeeded.
                    drop(guard);
                    break;
                }
            }
        }
    }

    let _ = progress_handle.join();
    let log_tail = log_handle.join().unwrap_or_default();

    // Best-effort cleanup of the input temp file; the output is left for the frontend.
    if request.delete_input.unwrap_or(true) {
        let _ = std::fs::remove_file(&request.input_path);
    }

    let size_bytes = std::fs::metadata(&request.output_path).map(|m| m.len()).unwrap_or(0);
    Ok(EncodeResultJson {
        duration_ms: started.elapsed().as_millis() as u64,
        exit_code: status.and_then(|s| s.code()).unwrap_or(-1),
        size_bytes,
        log_tail,
    })
}

/// Kills the ffmpeg child registered under `request_id`, if any.
#[tauri::command]
pub fn abort_encode(request_id: String) -> Result<bool, String> {
    let mut guard = children().lock().map_err(|_| "encode registry poisoned".to_string())?;
    if let Some(mut child) = guard.remove(&request_id) {
        let _ = child.kill();
        let _ = child.wait();
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Returns the `-encoders` listing from the native ffmpeg, for capability detection.
#[tauri::command]
pub fn ffmpeg_encoders(app: AppHandle) -> Result<String, String> {
    let ffmpeg = crate::resolve_exe(&app, "ffmpeg")
        .ok_or_else(|| "ffmpeg not found (download via setup, or install it on PATH)".to_string())?;
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| format!("ffmpeg -encoders spawn failed: {e}"))?;
    // ffmpeg prints the encoder table on stdout; keep stdout only.
    let mut buf = Vec::new();
    let _ = output.stdout.take(1 << 22).read_to_end(&mut buf);
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Removes a temp directory created by `encode_paths` (best effort).
#[tauri::command]
pub fn cleanup_encode_dir(path: String) -> Result<bool, String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() && p.to_string_lossy().contains("tmp") {
        std::fs::remove_dir_all(p).map_err(|e| format!("cleanup {path}: {e}"))?;
        return Ok(true);
    }
    Ok(false)
}
