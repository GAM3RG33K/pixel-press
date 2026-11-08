#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            ffprobe_json,
            ffprobe_bytes,
            generate_test_clip,
            fs_read_dir,
            read_file_text,
            pick_folder,
            get_app_config_dir,
            check_for_ffmpeg,
            platform_info,
        ])
        .setup(|app| {
            let path = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&path).expect("could not create app data dir");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct FsEntry {
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub last_modified: u64,
}

#[derive(serde::Serialize, Debug)]
pub struct FfmpegStatus {
    pub ffmpeg_present: bool,
    pub ffprobe_present: bool,
    pub ffmpeg_version: Option<String>,
    pub ffprobe_version: Option<String>,
}

#[tauri::command]
fn check_for_ffmpeg() -> FfmpegStatus {
    FfmpegStatus {
        ffmpeg_present: tool_present("ffmpeg").is_some(),
        ffprobe_present: tool_present("ffprobe").is_some(),
        ffmpeg_version: tool_version("ffmpeg"),
        ffprobe_version: tool_version("ffprobe"),
    }
}

#[tauri::command]
fn platform_info() -> serde_json::Value {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    serde_json::json!({
        "os": os,
        "arch": arch,
        "tauri": env!("CARGO_PKG_VERSION"),
    })
}

/// Returns `Some(version_str)` if the tool is on PATH; `None` otherwise.
fn tool_present(cmd: &str) -> Option<bool> {
    if std::process::Command::new(cmd)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        Some(true)
    } else {
        None
    }
}

/// Returns the full `ffmpeg -version` first line, or `None` if the tool is unavailable.
fn tool_version(cmd: &str) -> Option<String> {
    let output = std::process::Command::new(cmd).arg("-version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|l| l.trim().to_string())
}

#[tauri::command]
fn ffprobe_json(input_path: String) -> Result<String, String> {
    let output = std::process::Command::new("ffprobe")
        .args([
            "-hide_banner",
            "-v", "error",
            "-show_format",
            "-show_streams",
            "-of", "json",
            &input_path,
        ])
        .output()
        .map_err(|e| format!("ffprobe spawn failed (is ffmpeg/ffprobe installed?): {e}"))?;
    check(&output)?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[tauri::command]
fn ffprobe_bytes(bytes: Vec<u8>, file_name: String) -> Result<String, String> {
    let suffix = file_name
        .rsplit('.')
        .next()
        .filter(|s| s.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("tmp")
        .to_string();
    let tmp = std::env::temp_dir().join(format!("pixel-press-{}.{suffix}", std::process::id()));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("could not write temp file {tmp:?}: {e}"))?;
    let out = ffprobe_json(tmp.to_string_lossy().into_owned());
    let _ = std::fs::remove_file(&tmp);
    out
}

#[tauri::command]
fn generate_test_clip(app: AppHandle) -> Result<String, String> {
    let out_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("pixel-press-test-clip.mp4");
    let out_str = out_path.to_string_lossy().into_owned();
    let _ = std::fs::remove_file(&out_path);
    let status = std::process::Command::new("ffmpeg")
        .args([
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi",
            "-i", "testsrc2=size=320x240:rate=10",
            "-t", "1",
            "-pix_fmt", "yuv420p",
            "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast",
            &out_str,
        ])
        .status()
        .map_err(|e| format!("ffmpeg spawn failed (is ffmpeg installed?): {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg (lavfi testsrc2) failed with {status}"));
    }
    Ok(out_str)
}

#[tauri::command]
fn fs_read_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let mut out = Vec::new();
    walk(std::path::Path::new(&path), &mut out, 0)
        .map_err(|e| format!("fs_read_dir {path}: {e}"))?;
    Ok(out)
}

fn walk(dir: &std::path::Path, out: &mut Vec<FsEntry>, depth: usize) -> std::io::Result<()> {
    if depth > 16 || !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let e = entry?;
        let p = e.path();
        let md = e.metadata()?;
        let modified = md
            .modified()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
            .unwrap_or(0);
        if md.is_dir() {
            out.push(FsEntry {
                path: p.to_string_lossy().into_owned(),
                kind: "directory".into(),
                size: 0,
                last_modified: modified,
            });
            walk(&p, out, depth + 1)?;
        } else if md.is_file() {
            out.push(FsEntry {
                path: p.to_string_lossy().into_owned(),
                kind: "file".into(),
                size: md.len(),
                last_modified: modified,
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read_to_string {path}: {e}"))
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    match picked {
        Some(path) => match path.into_path() {
            Ok(p) => Ok(Some(p.to_string_lossy().into_owned())),
            Err(e) => Err(format!("picked folder conversion failed: {e}")),
        },
        None => Ok(None),
    }
}

#[tauri::command]
fn get_app_config_dir(app: AppHandle) -> Result<String, String> {
    let p = app.path().app_data_dir().map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(p.to_string_lossy().into_owned())
}

fn check(output: &std::process::Output) -> Result<(), String> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("exit {}: {}", output.status.code().unwrap_or(-1), stderr));
    }
    Ok(())
}
