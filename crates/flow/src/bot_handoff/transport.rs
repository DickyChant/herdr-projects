//! The handoff-only DSH credential and loopback transport; no general Bot mutation credential is read.
use crate::err::{Error, Res};
use crate::json::*;
use crate::store::files::user_home;

pub fn ask(h: &Value, action: &str) -> Res<Value> {
    let dir = user_home().join(".config/ovis-dsh");
    let token = std::fs::read_to_string(dir.join("handoff-token")).map_err(|_| Error::new("The DSH handoff connection is not configured."))?;
    let token = token.trim();
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) { crate::fail!("The DSH handoff credential is invalid."); }
    let config = crate::store::files::read_obj(&dir.join("handoff.json")).unwrap_or_default();
    let port = if config.has("port") { u16::try_from(config.i("port")).ok().filter(|p| *p > 0).ok_or_else(|| Error::new("Invalid DSH handoff port."))? } else { 3080 };
    let mut body = obj(h.clone()); body.put("action", action); body.remove("report"); body.remove("error");
    let bytes = serde_json::to_vec(&body)?;
    let headers = vec![("Authorization".into(), format!("Bearer {token}")), ("Content-Type".into(), "application/json".into())];
    let a = crate::webui::proxy::ask_with("127.0.0.1", port, "POST", "/herdr-bots/handoff", &headers, &bytes, 128000, if action == "create" { 35000 } else { 1500 }).ok_or_else(|| Error::new("DSH handoff unavailable."))?;
    if a.status != 200 { crate::fail!("DSH refused the handoff request (HTTP {}).", a.status); }
    serde_json::from_slice(&a.body).map_err(|_| Error::new("DSH handoff response could not be read."))
}
