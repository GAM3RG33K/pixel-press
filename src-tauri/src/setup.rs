//! First-launch setup: download FFmpeg/FFprobe binaries from a static manifest,
//! verify SHA-256, unzip, and mark the install ready.

use serde::{Deserialize, Serialize};
#[allow(unused_imports)]
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;
use tauri::Emitter;
use tokio::fs;

#[derive(Deserialize)]
struct ManifestRoot {
    artifacts: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize, Clone)]
struct Artifact {
    url: String,
    sha256: String,
    sizeBytes: u64,
    #[serde(default)]
    includes: Option<Vec<String>>,
}

fn load_manifest() -> Result<ManifestRoot, String> {
    serde_json::from_str(include_str!("../resources/setup-manifest.json"))
        .map_err(|e| format!("setup-manifest parse: {e}"))
}

/// Map host (os, arch) to the manifest key suffix.
fn platform_key(os: &str, arch: &str) -> Option<String> {
    match (os, arch) {
        ("linux", "x86_64") => Some("linux_amd64".into()),
        ("linux", "aarch64") => Some("linux_arm64".into()),
        ("macos", "x86_64") => Some("macos_amd64".into()),
        ("macos", "aarch64") => Some("macos_arm64".into()),
        ("windows", "x86_64") => Some("windows_amd64".into()),
        _ => None,
    }
}

#[derive(Serialize)]
pub struct ToolSpec {
    pub id: String,
    pub label: String,
    pub expected_bytes: u64,
    pub sha256: String,
    pub url: String,
    pub includes_ffprobe: bool,
}

#[tauri::command]
pub fn required_artifacts() -> Result<Vec<ToolSpec>, String> {
    let manifest = load_manifest()?;
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let key = platform_key(os, arch).ok_or_else(|| {
        format!("No predefined binaries for {os}/{arch}; please install ffmpeg manually.")
    })?;

    let ffmpeg = manifest
        .artifacts
        .get(&format!("ffmpeg_{key}"))
        .and_then(|v| serde_json::from_value::<Artifact>(v.clone()).ok())
        .ok_or_else(|| format!("setup-manifest missing ffmpeg for {key}"))?;

    let includes_ffprobe = ffmpeg
        .includes
        .as_deref()
        .is_some_and(|v| v.iter().any(|n| n == "ffprobe.exe"));

    let mut out = vec![ToolSpec {
        id: format!("ffmpeg_{key}"),
        label: "ffmpeg".to_string(),
        expected_bytes: ffmpeg.sizeBytes,
        sha256: ffmpeg.sha256,
        url: ffmpeg.url,
        includes_ffprobe,
    }];

    if !includes_ffprobe {
        let ffprobe = manifest
            .artifacts
            .get(&format!("ffprobe_{key}"))
            .and_then(|v| serde_json::from_value::<Artifact>(v.clone()).ok())
            .ok_or_else(|| format!("setup-manifest missing ffprobe for {key}"))?;
        out.push(ToolSpec {
            id: format!("ffprobe_{key}"),
            label: "ffprobe".to_string(),
            expected_bytes: ffprobe.sizeBytes,
            sha256: ffprobe.sha256,
            url: ffprobe.url,
            includes_ffprobe: false,
        });
    }

    Ok(out)
}

/// Resolve the directory we install downloaded binaries into.
pub fn bin_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|p| p.join("bin"))
        .unwrap_or_else(|_| std::path::PathBuf::from("./bin"))
}

fn resolve_tool_with_app(app: &AppHandle, name: &str) -> Option<String> {
    let bin = bin_dir(app);
    let candidates = if cfg!(windows) {
        vec![bin.join(format!("{name}.exe"))]
    } else {
        vec![bin.join(name)]
    };
    for c in candidates {
        if c.is_file() {
            return Some(c.to_string_lossy().into_owned());
        }
    }
    // fall back to PATH
    if std::process::Command::new(name).arg("-version").output().ok().is_some_and(|o| o.status.success()) {
        return Some(name.to_string());
    }
    None
}

#[tauri::command]
pub fn check_for_ffmpeg_at(app: AppHandle, name: String) -> serde_json::Value {
    let resolved = resolve_tool_with_app(&app, &name);
    let present = resolved.is_some();
    let version = resolved.as_deref().and_then(|p| {
        std::process::Command::new(p).arg("-version").output().ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").trim().to_string())
    });
    serde_json::json!({
        "present": present,
        "version": version,
        "path": resolved,
    })
}

#[tauri::command]
pub fn resolve_tool(app: AppHandle, name: String) -> Option<String> {
    resolve_tool_with_app(&app, &name)
}

/// Download & install one artifact (tool). Emits `setup-progress` events with `(tool_id, bytes_done)`.
#[tauri::command]
pub async fn download_tool(
    app: AppHandle,
    tool_id: String,
    url: String,
    expected_sha256: String,
    _expected_size: u64,
) -> Result<String, String> {
    let bin_dir = bin_dir(&app);
    fs::create_dir_all(&bin_dir)
        .await
        .map_err(|e| format!("create_dir_all {bin_dir:?}: {e}"))?;

    let tmp_path = std::env::temp_dir().join(format!("{tool_id}.zip"));
    let client = reqwest::Client::builder()
        .user_agent("pixel-press-setup/0.1.0")
        .build()
        .map_err(|e| format!("reqwest build: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} for {url}", response.status()));
    }

    let mut file = fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("create {tmp_path:?}: {e}"))?;

    use futures_util::stream::StreamExt;
    use tokio::io::AsyncWriteExt;
    let mut bytes_seen: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("chunk error: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| format!("write: {e}"))?;
        bytes_seen += chunk.len() as u64;
        let _ = app.emit("setup-progress", (tool_id.as_str(), bytes_seen));
    }
    file.flush().await.map_err(|e| format!("flush: {e}"))?;
    drop(file);

    // Verify SHA-256
    let mut hasher = Sha256::new();
    use sha2::Digest;
    use std::io::Read;
    let mut file_read = std::fs::File::open(&tmp_path).map_err(|e| format!("open {tmp_path:?}: {e}"))?;
    let mut buf = vec![0u8; 64 * 1024];
    use std::io::Read as _;
    loop {
        let n = file_read.read(&mut buf).map_err(|e| format!("read: {e}"))?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    let got = hex::encode(hasher.finalize());
    if got != expected_sha256 {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(format!("sha256 mismatch: got {got}, expected {expected_sha256}"));
    }

    // Extract
    let extracted = std::fs::File::open(&tmp_path).map_err(|e| format!("open zip: {e}"))?;
    let mut zip = zip::ZipArchive::new(extracted)
        .map_err(|e| format!("zip archive open: {e}"))?;

    let mut installed: Vec<String> = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        let raw = entry.name().map(|c| c.into_owned()).unwrap_or_else(|_| String::new());
        let Some(name) = Path::new(&raw).file_name().and_then(|s| s.to_str()).map(|s| s.to_string()) else { continue };
        if entry.is_dir() { continue; }
        let want = name == "ffmpeg" || name == "ffprobe"
            || name == "ffmpeg.exe" || name == "ffprobe.exe";
        if !want { continue; }

        let dest = bin_dir.join(&name);
        let mut out = fs::File::create(&dest).await.map_err(|e| format!("create {dest:?}: {e}"))?;
        use std::io::Read;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = entry.read(&mut buf).map_err(|e| format!("zip read: {e}"))?;
            if n == 0 { break; }
            use tokio::io::AsyncWriteExt;
            out.write_all(&buf[..n]).await.map_err(|e| format!("write {dest:?}: {e}"))?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
        }
        installed.push(dest.to_string_lossy().into_owned());
    }

    let _ = fs::remove_file(&tmp_path).await;
    if installed.is_empty() {
        return Err(format!("no ffmpeg/ffprobe binary found inside {url}"));
    }

    Ok(installed.join(","))
}