use std::net::{IpAddr, ToSocketAddrs};
use std::path::Path;
use url::Url;

pub const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Resolve filename from URL, explicit filename, or Content-Disposition header.
pub fn resolve_filename(url: &str, filename: Option<&str>, content_disposition: Option<&str>) -> String {
    // 1. Explicit filename wins
    if let Some(f) = filename {
        let f = f.trim();
        if !f.is_empty() {
            return sanitize_filename(f);
        }
    }

    // 2. Content-Disposition: filename="..." or filename*=UTF-8''...
    if let Some(cd) = content_disposition {
        if let Some(name) = parse_content_disposition(cd) {
            return sanitize_filename(&name);
        }
    }

    // 3. URL path last segment
    if let Ok(parsed) = Url::parse(url) {
        let path = parsed.path();
        if let Some(last) = path.rsplit('/').next() {
            let decoded = percent_decode(last);
            if !decoded.is_empty() && decoded != "/" {
                return sanitize_filename(&decoded);
            }
        }
    }

    "download".to_string()
}

fn parse_content_disposition(cd: &str) -> Option<String> {
    // Try filename*=UTF-8''encoded first
    for part in cd.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename*=") {
            if let Some(idx) = rest.find("''") {
                let encoded = &rest[idx + 2..];
                return Some(percent_decode(encoded.trim_matches('"')));
            }
        }
    }
    // Then filename="..."
    for part in cd.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename=") {
            return Some(rest.trim_matches('"').to_string());
        }
    }
    None
}

fn percent_decode(s: &str) -> String {
    let mut result = String::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                result.push(byte as char);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

fn sanitize_filename(name: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut result: String = name.chars().map(|c| if invalid.contains(&c) { '_' } else { c }).collect();
    // Trim trailing dots/spaces (Windows)
    while result.ends_with('.') || result.ends_with(' ') {
        result.pop();
    }
    if result.is_empty() {
        "download".to_string()
    } else {
        result
    }
}

/// Ensure unique filename in directory (append (1), (2), etc.).
pub fn ensure_unique_filename(dir: &str, filename: &str) -> String {
    let path = Path::new(dir).join(&filename);
    if !path.exists() {
        return filename.to_string();
    }
    let (stem, ext) = split_filename(filename);
    let mut counter = 1;
    loop {
        let candidate = if ext.is_empty() {
            format!("{} ({})", stem, counter)
        } else {
            format!("{} ({}).{}", stem, counter, ext)
        };
        if !Path::new(dir).join(&candidate).exists() {
            return candidate;
        }
        counter += 1;
        if counter > 9999 {
            return format!("{}_{}", stem, uuid::Uuid::new_v4());
        }
    }
}

fn split_filename(name: &str) -> (String, String) {
    if let Some(dot_idx) = name.rfind('.') {
        if dot_idx > 0 {
            return (name[..dot_idx].to_string(), name[dot_idx + 1..].to_string());
        }
    }
    (name.to_string(), String::new())
}

/// Detect MIME type from filename extension.
pub fn detect_mime(filename: &str) -> String {
    mime_guess::from_path(filename)
        .first_or_octet_stream()
        .to_string()
}

/// Resolve category from filename + content type (mirrors Node utils/mime.js).
pub fn resolve_category(filename: &str, content_type: Option<&str>) -> String {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let video_exts = ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "3gp", "ts"];
    let audio_exts = ["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus"];
    let archive_exts = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "cab"];
    let software_exts = ["exe", "msi", "apk", "dmg", "deb", "rpm", "appimage"];
    let doc_exts = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt"];

    if video_exts.contains(&ext.as_str()) {
        return "Videos".into();
    }
    if audio_exts.contains(&ext.as_str()) {
        return "Music".into();
    }
    if archive_exts.contains(&ext.as_str()) {
        return "Archives".into();
    }
    if software_exts.contains(&ext.as_str()) {
        return "Software".into();
    }
    if doc_exts.contains(&ext.as_str()) {
        return "Documents".into();
    }

    // Fallback: content-type based
    if let Some(ct) = content_type {
        let ct = ct.to_lowercase();
        if ct.starts_with("video/") {
            return "Videos".into();
        }
        if ct.starts_with("audio/") {
            return "Music".into();
        }
        if ct.contains("zip") || ct.contains("compressed") || ct.contains("archive") {
            return "Archives".into();
        }
        if ct.contains("pdf") || ct.contains("document") || ct.contains("text/") {
            return "Documents".into();
        }
    }

    "Others".into()
}

/// SSRF: check if hostname is blocked (localhost/private).
pub fn is_blocked_host(hostname: &str) -> bool {
    // In test or development environments, allow loopback if IDMM_ALLOW_LOOPBACK is set
    if std::env::var("IDMM_ALLOW_LOOPBACK").is_ok() {
        return false;
    }
    let h = hostname.to_lowercase();
    if h == "localhost" || h == "127.0.0.1" || h == "0.0.0.0" || h == "::1" || h == "[::1]" {
        return true;
    }
    if h.starts_with("192.168.") || h.starts_with("10.") {
        return true;
    }
    // 172.16.0.0 – 172.31.255.255
    if h.starts_with("172.") {
        if let Some(second) = h.split('.').nth(1).and_then(|s| s.parse::<u16>().ok()) {
            if (16..=31).contains(&second) {
                return true;
            }
        }
    }
    false
}

/// SSRF: validate DNS resolution doesn't point to private/loopback IPs.
pub fn validate_dns_resolution(hostname: &str) -> Result<(), String> {
    if std::env::var("IDMM_ALLOW_LOOPBACK").is_ok() {
        return Ok(());
    }
    if is_blocked_host(hostname) {
        return Err("Cannot download from localhost or private network".into());
    }
    // If it's already an IP literal, check directly
    if let Ok(ip) = hostname.parse::<IpAddr>() {
        if is_private_ip(&ip) {
            return Err("Cannot download from localhost or private network".into());
        }
        return Ok(());
    }
    // Resolve DNS
    let addrs: Vec<_> = format!("{}:80", hostname)
        .to_socket_addrs()
        .map_err(|e| format!("DNS resolution failed: {}", e))?
        .collect();
    if addrs.is_empty() {
        return Err("DNS resolution failed: no addresses".into());
    }
    for addr in &addrs {
        if is_private_ip(&addr.ip()) {
            return Err("Cannot download from localhost or private network".into());
        }
    }
    Ok(())
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
    }
}

/// Validate redirect target against SSRF.
pub fn validate_redirect(location: &str, base_url: &str) -> Result<String, String> {
    let new_url = Url::parse(location)
        .or_else(|_| Url::parse(base_url).and_then(|base| base.join(location)))
        .map_err(|_| "Invalid redirect URL".to_string())?;

    let scheme = new_url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("Redirect to non-HTTP scheme blocked: {}", scheme));
    }

    let host = new_url.host_str().unwrap_or("");
    if is_blocked_host(host) {
        return Err("Redirect to blocked host (SSRF protection)".into());
    }

    Ok(new_url.to_string())
}

/// SHA-256 hash of a file (streaming).
pub async fn hash_file(path: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 65536];
    loop {
        let n = file.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}
