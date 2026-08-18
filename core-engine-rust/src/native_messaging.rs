use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{self, Read, Write};

#[derive(Debug, Deserialize)]
pub struct NativeMessage {
    pub action: Option<String>,
    pub url: Option<String>,
    pub filename: Option<String>,
    pub cookies: Option<String>,
    pub referrer: Option<String>,
    pub threads: Option<i64>,
    pub save_to: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NativeResponse {
    pub success: bool,
    pub status: Option<String>,
    pub id: Option<String>,
    pub error: Option<String>,
    pub version: Option<String>,
}

/// Runs the Native Messaging loop communicating over stdio using 32-bit LE length-prefixed JSON.
pub fn run_native_messaging_host() {
    let stdin = io::stdin();
    let mut stdin_lock = stdin.lock();
    let stdout = io::stdout();
    let mut stdout_lock = stdout.lock();

    loop {
        // Read 4-byte message length (Little Endian)
        let mut len_bytes = [0u8; 4];
        if stdin_lock.read_exact(&mut len_bytes).is_err() {
            break; // EOF or pipe closed
        }

        let msg_len = u32::from_le_bytes(len_bytes) as usize;
        if msg_len == 0 || msg_len > 10 * 1024 * 1024 {
            // Invalid length or message too big (>10MB)
            break;
        }

        let mut buffer = vec![0u8; msg_len];
        if stdin_lock.read_exact(&mut buffer).is_err() {
            break;
        }

        let message: Result<NativeMessage, _> = serde_json::from_slice(&buffer);
        let response = match message {
            Ok(msg) => handle_native_message(msg),
            Err(e) => NativeResponse {
                success: false,
                status: None,
                id: None,
                error: Some(format!("Invalid JSON payload: {}", e)),
                version: Some(env!("CARGO_PKG_VERSION").into()),
            },
        };

        let resp_bytes = serde_json::to_vec(&response).unwrap_or_default();
        let resp_len = (resp_bytes.len() as u32).to_le_bytes();

        if stdout_lock.write_all(&resp_len).is_err() {
            break;
        }
        if stdout_lock.write_all(&resp_bytes).is_err() {
            break;
        }
        let _ = stdout_lock.flush();
    }
}

fn handle_native_message(msg: NativeMessage) -> NativeResponse {
    let action = msg.action.unwrap_or_else(|| "download".into());

    match action.as_str() {
        "ping" | "health" => NativeResponse {
            success: true,
            status: Some("ok".into()),
            id: None,
            error: None,
            version: Some(env!("CARGO_PKG_VERSION").into()),
        },
        "download" => {
            let url = match msg.url {
                Some(u) if !u.trim().is_empty() => u,
                _ => {
                    return NativeResponse {
                        success: false,
                        status: None,
                        id: None,
                        error: Some("URL is required".into()),
                        version: Some(env!("CARGO_PKG_VERSION").into()),
                    };
                }
            };

            // Post to IDMM REST API at 127.0.0.1:9977 via standard HTTP or direct spawn
            let mut headers = std::collections::HashMap::new();
            if let Some(ua) = msg.user_agent {
                headers.insert("User-Agent".to_string(), ua);
            }

            let payload = json!({
                "url": url,
                "filename": msg.filename,
                "cookies": msg.cookies,
                "referrer": msg.referrer,
                "threads": msg.threads,
                "save_to": msg.save_to,
                "headers": headers,
            });

            // Use reqwest blocking client or fallback
            // In async tokio or blocking, since run_native_messaging_host is blocking:
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();

            if let Ok(rt) = rt {
                let res = rt.block_on(async {
                    let client = reqwest::Client::builder()
                        .timeout(std::time::Duration::from_secs(5))
                        .build()
                        .map_err(|e| e.to_string())?;

                    let body_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
                    let resp = client.post("http://127.0.0.1:9977/api/downloads")
                        .header("Content-Type", "application/json")
                        .body(body_str)
                        .send()
                        .await
                        .map_err(|e| e.to_string())?;

                    if resp.status().is_success() {
                        let text = resp.text().await.map_err(|e| e.to_string())?;
                        let body: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                        let id = body.get("id").and_then(|v| v.as_str()).map(String::from);
                        Ok(id)
                    } else {
                        let text = resp.text().await.unwrap_or_default();
                        let err_body: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                        let err_msg = err_body.get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Server error")
                            .to_string();
                        Err(err_msg)
                    }
                });

                match res {
                    Ok(id) => NativeResponse {
                        success: true,
                        status: Some("queued".into()),
                        id,
                        error: None,
                        version: Some(env!("CARGO_PKG_VERSION").into()),
                    },
                    Err(e) => NativeResponse {
                        success: false,
                        status: None,
                        id: None,
                        error: Some(format!("Error submitting download: {}", e)),
                        version: Some(env!("CARGO_PKG_VERSION").into()),
                    },
                }
            } else {
                NativeResponse {
                    success: false,
                    status: None,
                    id: None,
                    error: Some("Runtime initialization failure".into()),
                    version: Some(env!("CARGO_PKG_VERSION").into()),
                }
            }
        }
        other => NativeResponse {
            success: false,
            status: None,
            id: None,
            error: Some(format!("Unknown action: {}", other)),
            version: Some(env!("CARGO_PKG_VERSION").into()),
        },
    }
}
