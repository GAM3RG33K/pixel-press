//! First-launch setup: download FFmpeg/FFprobe binaries and optional LLM weights
//! from a static manifest, verify SHA-256, unzip (binaries only), and mark the install ready.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::fs;

#[derive(Deserialize)]
struct ManifestRoot {
    artifacts: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    models: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize, Clone)]
struct Artifact {
    url: String,
    sha256: String,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
    #[serde(default)]
    includes: Option<Vec<String>>,
}

#[derive(Deserialize, Clone)]
struct ModelEntry {
    label: String,
    description: String,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
    #[serde(default)]
    quantization: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    license_url: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
    gguf: GgufInfo,
}

#[derive(Deserialize, Clone)]
struct GgufInfo {
    url: String,
    sha256: String,
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

#[derive(Serialize)]
pub struct ModelSpec {
    pub id: String,
    pub label: String,
    pub description: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    pub quantization: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub source_url: Option<String>,
    pub url: String,
    pub sha256: String,
}

/// What tools need to be downloaded for this platform?
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
        .is_some_and(|v| v.iter().any(|n| n == "ffprobe.exe" || n == "ffprobe"));

    let mut out = vec![ToolSpec {
        id: format!("ffmpeg_{key}"),
        label: "ffmpeg".to_string(),
        expected_bytes: ffmpeg.size_bytes,
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
            expected_bytes: ffprobe.size_bytes,
            sha256: ffprobe.sha256,
            url: ffprobe.url,
            includes_ffprobe: false,
        });
    }

    Ok(out)
}

/// List the LLM candidates we offer.
#[tauri::command]
pub fn available_models() -> Result<Vec<ModelSpec>, String> {
    let manifest = load_manifest()?;
    let mut out = Vec::new();
    for (id, value) in manifest.models {
        let model: ModelEntry =
            serde_json::from_value(value).map_err(|e| format!("model {id}: {e}"))?;
        out.push(ModelSpec {
            id: id.clone(),
            label: model.label,
            description: model.description,
            size_bytes: model.size_bytes,
            quantization: model.quantization,
            license: model.license,
            license_url: model.license_url,
            source_url: model.source_url,
            url: model.gguf.url,
            sha256: model.gguf.sha256,
        });
    }
    Ok(out)
}

/// Resolve the directory we install downloaded binaries into.
pub fn bin_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|p| p.join("bin"))
        .unwrap_or_else(|_| PathBuf::from("./bin"))
}

/// Resolve the directory we install LLM weights into.
pub fn models_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|p| p.join("models"))
        .unwrap_or_else(|_| PathBuf::from("./models"))
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
    if std::process::Command::new(name)
        .arg("-version")
        .output()
        .ok()
        .is_some_and(|o| o.status.success())
    {
        return Some(name.to_string());
    }
    None
}

#[tauri::command]
pub fn check_for_llm_at(app: AppHandle, model_id: String) -> serde_json::Value {
    let path = models_dir(&app).join(format!("{model_id}.gguf"));
    serde_json::json!({
        "ready": path.is_file(),
        "path": path.exists().then(|| path.to_string_lossy().into_owned()),
    })
}

/// Stream a download to a temp file, verify SHA-256, move to `dest`. Emits `download-progress` events.
#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    event_id: String,
    url: String,
    expected_sha256: String,
    dest: String,
) -> Result<(), String> {
    let tmp_path = std::env::temp_dir().join(format!("{event_id}.part"));
    {
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
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("write: {e}"))?;
            bytes_seen += chunk.len() as u64;
            let _ = app.emit("download-progress", (event_id.as_str(), bytes_seen));
        }
        file.flush().await.map_err(|e| format!("flush: {e}"))?;
    }

    // SHA-256 verification
    let mut hasher = Sha256::new();
    {
        use std::io::Read;
        let mut buf = vec![0u8; 64 * 1024];
        let mut file =
            std::fs::File::open(&tmp_path).map_err(|e| format!("open {tmp_path:?}: {e}"))?;
        loop {
            let n = file.read(&mut buf).map_err(|e| format!("read: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
    }
    let got = hex::encode(hasher.finalize());
    if got != expected_sha256 {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(format!("sha256 mismatch: got {got}"));
    }

    // Ensure the destination directory exists before moving the verified file.
    if let Some(parent) = Path::new(&dest).parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("create {}: {e}", parent.display()))?;
    }

    fs::rename(&tmp_path, &dest)
        .await
        .map_err(|e| format!("rename {tmp_path:?} → {dest}: {e}"))?;

    Ok(())
}

/// Download a ZIP artifact (binary tool), verify SHA-256, extract, and set exec bit.
#[tauri::command]
pub async fn download_tool(
    app: AppHandle,
    tool_id: String,
    url: String,
    expected_sha256: String,
) -> Result<String, String> {
    let dir = bin_dir(&app);
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create_dir_all {dir:?}: {e}"))?;

    let tmp_path = std::env::temp_dir().join(format!("{tool_id}.zip"));
    {
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
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("write: {e}"))?;
            bytes_seen += chunk.len() as u64;
            let _ = app.emit("setup-progress", (tool_id.as_str(), bytes_seen));
        }
        file.flush().await.map_err(|e| format!("flush: {e}"))?;
    }

    // SHA-256 verification
    let mut hasher = Sha256::new();
    {
        use std::io::Read;
        let mut buf = vec![0u8; 64 * 1024];
        let mut file =
            std::fs::File::open(&tmp_path).map_err(|e| format!("open {tmp_path:?}: {e}"))?;
        loop {
            let n = file.read(&mut buf).map_err(|e| format!("read: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
    }
    let got = hex::encode(hasher.finalize());
    if got != expected_sha256 {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(format!("sha256 mismatch: got {got}"));
    }

    let bin_dir = bin_dir(&app);
    let extracted = std::fs::File::open(&tmp_path).map_err(|e| format!("open zip: {e}"))?;
    let mut zip = zip::ZipArchive::new(extracted).map_err(|e| format!("zip archive open: {e}"))?;

    let mut installed: Vec<String> = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        let raw = entry
            .name()
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| String::new());
        let Some(name) = Path::new(&raw)
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
        else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        let want =
            name == "ffmpeg" || name == "ffprobe" || name == "ffmpeg.exe" || name == "ffprobe.exe";
        if !want {
            continue;
        }

        let dest = bin_dir.join(&name);
        let mut out = fs::File::create(&dest)
            .await
            .map_err(|e| format!("create {dest:?}: {e}"))?;
        use std::io::Read;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = entry.read(&mut buf).map_err(|e| format!("zip read: {e}"))?;
            if n == 0 {
                break;
            }
            use tokio::io::AsyncWriteExt;
            out.write_all(&buf[..n])
                .await
                .map_err(|e| format!("write {dest:?}: {e}"))?;
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

#[tauri::command]
pub fn resolve_tool(app: AppHandle, name: String) -> Option<String> {
    resolve_tool_with_app(&app, &name)
}
/// Remove a file by absolute path. Returns true if removed, false otherwise.
#[tauri::command]
pub fn remove_file(path: String) -> bool {
    std::fs::remove_file(&path).is_ok()
}
