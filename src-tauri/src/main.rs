#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager, Emitter};
use tauri_plugin_fs::FsExt;
use tauri_plugin_dialog::DialogExt;

mod setup;
mod llm;
mod encode;

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
            setup::required_artifacts,
            setup::available_models,
            setup::download_tool,
            setup::download_file,
            setup::check_for_llm_at,
            setup::resolve_tool,
            setup::remove_file,
            plan_intent,
            encode::encode_paths,
            encode::encode_video,
            encode::abort_encode,
            encode::ffmpeg_encoders,
            encode::cleanup_encode_dir,
            reveal_path,
            allow_file_path,
            next_available_path,
            latest_release,
            download_asset,
            cache_stats,
            clear_cache,
        ])
        .setup(|app| {
            let path = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(path.join("bin")).expect("could not create bin dir");
            std::fs::create_dir_all(path.join("models")).expect("could not create models dir");
            // Best-effort sweep: delete cache entries older than 24h.
            let cache = path.join("cache");
            let cutoff = std::time::SystemTime::now()
                .checked_sub(std::time::Duration::from_secs(24 * 3600));
            if let (Ok(entries), Some(cutoff)) = (std::fs::read_dir(&cache), cutoff) {
                for entry in entries.flatten() {
                    let stale = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .map(|mtime| mtime < cutoff)
                        .unwrap_or(false);
                    if stale {
                        let p = entry.path();
                        if p.is_dir() {
                            let _ = std::fs::remove_dir_all(&p);
                        } else {
                            let _ = std::fs::remove_file(&p);
                        }
                    }
                }
            }
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

#[derive(serde::Serialize, Debug, Clone)]
pub struct FfmpegStatus {
    pub ffmpeg_present: bool,
    pub ffprobe_present: bool,
    pub ffmpeg_version: Option<String>,
    pub ffprobe_version: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub app_data_dir: Option<String>,
    pub platform_os: String,
    pub platform_arch: String,
}

#[tauri::command]
fn check_for_ffmpeg(app: AppHandle) -> FfmpegStatus {
    use std::process::Command;
    
    let resolve = |name: &str| -> Option<(String, String)> {
        let bin = setup::bin_dir(&app);
        let downloaded = bin.join(name);
        let downloaded_exe = bin.join(format!("{name}.exe"));
        if downloaded.is_file() {
            let v = Command::new(&downloaded).arg("-version").output().ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").trim().to_string());
            return v.map(|ver| (downloaded.to_string_lossy().into_owned(), ver));
        }
        if downloaded_exe.is_file() {
            let v = Command::new(&downloaded_exe).arg("-version").output().ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").trim().to_string());
            return v.map(|ver| (downloaded_exe.to_string_lossy().into_owned(), ver));
        }
        if let Some(found) = which(name) {
            let v = Command::new(&found).arg("-version").output().ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").trim().to_string());
            return v.map(|ver| (found, ver));
        }
        None
    };

    let ffmpeg = resolve("ffmpeg");
    let ffprobe = resolve("ffprobe");

    FfmpegStatus {
        ffmpeg_present: ffmpeg.is_some(),
        ffprobe_present: ffprobe.is_some(),
        ffmpeg_version: ffmpeg.as_ref().map(|(_, v)| v.clone()),
        ffprobe_version: ffprobe.as_ref().map(|(_, v)| v.clone()),
        ffmpeg_path: ffmpeg.map(|(p, _)| p),
        ffprobe_path: ffprobe.map(|(p, _)| p),
        app_data_dir: app.path().app_data_dir().ok().map(|p| p.to_string_lossy().into_owned()),
        platform_os: std::env::consts::OS.to_string(),
        platform_arch: std::env::consts::ARCH.to_string(),
    }
}

fn which(cmd: &str) -> Option<String> {
    if let Ok(p) = std::env::var("PATH") {
        for dir in std::env::split_paths(&p) {
            let candidate = dir.join(cmd);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
            let candidate_exe = dir.join(format!("{cmd}.exe"));
            if candidate_exe.is_file() {
                return Some(candidate_exe.to_string_lossy().into_owned());
            }
        }
    }
    None
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

#[tauri::command]
fn ffprobe_json(app: AppHandle, input_path: String) -> Result<String, String> {
    let ffprobe = resolve_exe(&app, "ffprobe")
        .ok_or_else(|| "ffprobe not found (downloaded bin dir or PATH). Run setup first.".to_string())?;
    let output = std::process::Command::new(&ffprobe)
        .args([
            "-hide_banner",
            "-v", "error",
            "-show_format",
            "-show_streams",
            "-of", "json",
            &input_path,
        ])
        .output()
        .map_err(|e| format!("ffprobe spawn failed ({e}) — path: {ffprobe}"))?;
    check(&output)?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[tauri::command]
fn ffprobe_bytes(app: AppHandle, bytes: Vec<u8>, file_name: String) -> Result<String, String> {
    let suffix = file_name
        .rsplit('.')
        .next()
        .filter(|s| s.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("tmp")
        .to_string();
    let cache = app.path().app_data_dir().map_err(|e| e.to_string())?.join("cache");
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let tmp = cache.join(format!("ffprobe-{}-{:?}.{suffix}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("could not write temp file {tmp:?}: {e}"))?;
    let out = ffprobe_json(app, tmp.to_string_lossy().into_owned());
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
    let ffmpeg = resolve_exe(&app, "ffmpeg")
        .ok_or_else(|| "ffmpeg not found (downloaded bin dir or PATH). Run setup first.".to_string())?;
    let status = std::process::Command::new(&ffmpeg)
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

/// Grant the frontend fs scope read access to a single user-dropped file.
/// Used by native drag-and-drop: the user picks a file outside $APPDATA, so we
/// explicitly allow that one path for this session instead of widening the scope.
#[tauri::command]
fn allow_file_path(app: AppHandle, path: String) -> Result<bool, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("file does not exist: {path}"));
    }
    app.fs_scope()
        .allow_file(p)
        .map_err(|e| format!("fs scope grant failed for {path}: {e}"))?;
    Ok(true)
}

/// If `path` exists, return a sibling with `_2`/`_3`/… appended before the
/// extension. Otherwise return `path` unchanged. Used to never overwrite a
/// user's previous optimize output.
#[tauri::command]
fn next_available_path(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Ok(path);
    }
    let parent = p.parent().map(|x| x.to_string_lossy().into_owned()).unwrap_or_else(|| ".".into());
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "out".into());
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for i in 2..1000 {
        let candidate = std::path::Path::new(&parent).join(format!("{stem}_{i}{ext}"));
        if !candidate.exists() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }
    Err(format!("could not find a free filename for {path}"))
}

#[tauri::command]
fn reveal_path(path: String) -> Result<bool, String> {
    let p = std::path::Path::new(&path);
    let args: Vec<String> = if cfg!(target_os = "macos") {
        if p.is_dir() { vec!["-R".to_string()] } else { vec!["-R".to_string()] }
    } else if cfg!(target_os = "windows") {
        if p.is_dir() { vec![path.clone()] } else { vec![format!("/select,{path}")] }
    } else {
        vec![p.parent().unwrap_or(p).to_string_lossy().into_owned()]
    };
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer.exe"
    } else {
        "xdg-open"
    };
    let mut cmd = std::process::Command::new(program);
    if cfg!(target_os = "windows") {
        cmd.args(&args);
    } else if cfg!(target_os = "macos") {
        cmd.arg(args[0].clone()).arg(&path);
    } else {
        cmd.arg(&args[0]);
    }
    let status = cmd.status().map_err(|e| format!("reveal failed: {e}"))?;
    Ok(status.success())
}

#[tauri::command]
async fn plan_intent(app: AppHandle, metadata: llm::VideoMetadata, intent: Option<String>, request_id: Option<String>) -> Result<CompressionPlanJson, String> {
    let app_clone = app.clone();
    let plan = tokio::task::spawn_blocking(move || llm::plan_intent(&app_clone, metadata, intent, request_id))
        .await
        .map_err(|e| format!("inference task failed to join: {e}"))??;
    Ok(CompressionPlanJson {
        target_codec: plan.target_codec,
        crf: plan.crf,
        two_pass: plan.two_pass,
        preserve_keyframes: plan.preserve_keyframes,
        audio_handling: plan.audio_handling,
        preserve_fps: plan.preserve_fps,
        rule_source: plan.rule_source,
    })
}

#[derive(serde::Serialize)]
struct CachePart {
    label: String,
    bytes: u64,
}

#[derive(serde::Serialize)]
struct CacheStats {
    total_bytes: u64,
    parts: Vec<CachePart>,
}

#[tauri::command]
fn cache_stats(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let cache = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("cache");
    let mut buckets: std::collections::BTreeMap<String, u64> = Default::default();
    let mut total: u64 = 0;
    if cache.is_dir() {
        for entry in walkdir::WalkDir::new(&cache) {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().is_file() {
                continue;
            }
            let size = entry.metadata().map_err(|e| e.to_string())?.len();
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let bucket = if name.contains("ffprobe") || name.contains("tmp-") || name.contains(".") && name.len() < 12 {
                "probes"
            } else if name.contains("h264") || name.contains("webm") || name.contains("optimized") || name.contains("x264") || name.contains("vp9") {
                "variants"
            } else {
                "staged"
            };
            *buckets.entry(bucket.into()).or_default() += size;
            total += size;
        }
    }
    let mut parts: Vec<CachePart> = buckets
        .into_iter()
        .map(|(label, bytes)| CachePart { label, bytes })
        .collect();
    parts.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    Ok(CacheStats { total_bytes: total, parts })
}

#[tauri::command]
fn clear_cache(app: tauri::AppHandle) -> Result<u64, String> {
    let cache = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("cache");
    let mut freed: u64 = 0;
    if !cache.is_dir() {
        return Ok(0);
    }
    for entry in std::fs::read_dir(&cache).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_file() {
            freed += meta.len();
            std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        } else if meta.is_dir() {
            let dir_bytes: u64 = walkdir::WalkDir::new(entry.path())
                .into_iter()
                .filter_map(|e| e.ok())
                .filter_map(|e| e.metadata().ok())
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .sum();
            std::fs::remove_dir_all(entry.path()).map_err(|e| e.to_string())?;
            freed += dir_bytes;
        }
    }
    Ok(freed)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseAsset {
    name: String,
    download_url: String,
    size: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LatestRelease {
    tag: String,
    name: String,
    body: String,
    html_url: String,
    published_at: String,
    assets: Vec<ReleaseAsset>,
}

const REPO: &str = "GAM3RG33K/pixel-press";

fn parse_release_value(v: &serde_json::Value) -> Result<LatestRelease, String> {
    let unparseable = || "could not parse GitHub release".to_string();
    let tag = v.get("tag_name").and_then(|t| t.as_str()).ok_or_else(|| "release has no tag/name".to_string())?.to_string();
    let name = v.get("name").and_then(|n| n.as_str()).ok_or_else(|| "release has no tag/name".to_string())?.to_string();
    let body = v.get("body").and_then(|b| b.as_str()).unwrap_or("").to_string();
    let html_url = v.get("html_url").and_then(|u| u.as_str()).unwrap_or("").to_string();
    let published_at = v.get("published_at").and_then(|p| p.as_str()).unwrap_or("").to_string();
    let assets = v
        .get("assets")
        .and_then(|a| a.as_array())
        .ok_or_else(unparseable)?
        .iter()
        .map(|a| {
            Ok(ReleaseAsset {
                name: a.get("name").and_then(|x| x.as_str()).ok_or_else(unparseable)?.to_string(),
                download_url: a.get("browser_download_url").and_then(|x| x.as_str()).ok_or_else(unparseable)?.to_string(),
                size: a.get("size").and_then(|x| x.as_u64()).ok_or_else(unparseable)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(LatestRelease { tag, name, body, html_url, published_at, assets })
}

#[tauri::command]
async fn latest_release(flavor: &str) -> Result<LatestRelease, String> {
    if flavor != "dev" && flavor != "prod" {
        return Err("unknown flavor".into());
    }
    let url = if flavor == "prod" {
        format!("https://api.github.com/repos/{REPO}/releases/latest")
    } else {
        format!("https://api.github.com/repos/{REPO}/releases?per_page=20")
    };
    let resp = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "pixel-press-update-check")
        .send()
        .await
        .map_err(|e| format!("network ({e})"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("network (status {})", status.as_u16()));
    }
    let value: serde_json::Value = resp.json().await.map_err(|_| "could not parse GitHub release".to_string())?;
    if flavor == "prod" {
        parse_release_value(&value)
    } else {
        let arr = value.as_array().ok_or_else(|| "could not parse GitHub release".to_string())?;
        let found = arr.iter().find(|r| {
            r.get("prerelease").and_then(|p| p.as_bool()) == Some(true)
                && r.get("tag_name").and_then(|t| t.as_str()).map(|t| t.contains("-dev")).unwrap_or(false)
        });
        match found {
            Some(r) => parse_release_value(r),
            None => Err("no dev releases found".into()),
        }
    }
}

fn sanitize_asset_name(name: &str) -> String {
    name.rsplit('/')
        .next()
        .and_then(|s| s.split('\\').next())
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .unwrap_or("update.bin")
        .to_string()
}

#[tauri::command]
async fn download_asset(app: tauri::AppHandle, url: String, asset_name: String) -> Result<String, String> {
    let downloads = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
    let resp = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "pixel-press-update-check")
        .send()
        .await
        .map_err(|e| format!("network ({e})"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("network (status {})", status.as_u16()));
    }
    let total = resp.content_length().unwrap_or(0);
    // Buffer in memory (assets are ~15-25 MB); frontend treats (0, total) as indeterminate.
    let bytes = resp.bytes().await.map_err(|e| format!("network ({e})"))?;
    let dest = downloads.join(sanitize_asset_name(&asset_name));
    std::fs::write(&dest, &bytes).map_err(|e| format!("could not write {}: {e}", dest.display()))?;
    let _ = app.emit("update-download-progress", (total, total));
    Ok(dest.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
pub struct CompressionPlanJson {
    pub target_codec: String,
    pub crf: u32,
    pub two_pass: Option<bool>,
    pub preserve_keyframes: Option<bool>,
    pub audio_handling: Option<String>,
    pub preserve_fps: Option<bool>,
    pub rule_source: Option<String>,
}

pub(crate) fn resolve_exe(app: &AppHandle, name: &str) -> Option<String> {
        let bin = setup::bin_dir(app);
    let candidates = if cfg!(windows) {
        vec![bin.join(format!("{name}.exe")), bin.join(name)]
    } else {
        vec![bin.join(name)]
    };
    for c in candidates {
        if c.is_file() {
            return Some(c.to_string_lossy().into_owned());
        }
    }
    // fall back to PATH
    if let Ok(p) = std::env::var("PATH") {
        for dir in std::env::split_paths(&p) {
            let cand = dir.join(name);
            if cand.is_file() {
                return Some(cand.to_string_lossy().into_owned());
            }
            let cand_exe = dir.join(format!("{name}.exe"));
            if cand_exe.is_file() {
                return Some(cand_exe.to_string_lossy().into_owned());
            }
        }
    }
    None
}

fn check(output: &std::process::Output) -> Result<(), String> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("exit {}: {}", output.status.code().unwrap_or(-1), stderr));
    }
    Ok(())
}
