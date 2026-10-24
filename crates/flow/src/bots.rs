//! Read-only DSH Bot awareness for the Coordinator: a bounded local Ovis directory, never chat, credentials or actions.
use crate::json::*;
use crate::util::url_encode;

pub const MAX_BYTES: usize = 1 << 20;
pub const FRESH_MS: i64 = 15000;
fn word(v: &Value, max: usize) -> Option<&str> { v.as_str().filter(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control)) }
pub fn unavailable(state: &str) -> Value { json!({"version": 1, "machineId": "local", "runtimeId": null, "state": state, "observedAt": null, "stale": true, "bots": []}) }
/// Keep only public roster fields. Identical names are allowed; identities must be unique within the runtime.
pub fn directory(bytes: &[u8], now: i64) -> Option<Value> {
    if bytes.len() > MAX_BYTES { return None; }
    let j: Value = serde_json::from_slice(bytes).ok()?;
    if j.at("version") != &json!(1) || j.s("machineId") != "local" { return None; }
    let state = j.s("state");
    if !["online", "offline", "not_configured", "incompatible"].contains(&state) { return None; }
    let list = j.at("bots").as_array()?;
    if list.len() > 500 { return None; }
    let runtime = word(j.at("runtimeId"), 256);
    if runtime.is_none() && (!list.is_empty() || state == "online") { return None; }
    let observed = j.at("observedAt").as_i64();
    let stale = state != "online" || !observed.is_some_and(|at| at > 0 && at <= now + FRESH_MS && now - at <= FRESH_MS);
    let mut ids = std::collections::HashSet::new();
    let mut bots = vec![];
    for b in list {
        let id = word(b.at("id"), 256)?;
        if !ids.insert(id) { return None; }
        let name = word(b.at("name"), 256)?;
        let role = b.at("role").as_str().filter(|s| s.len() <= 1024 && !s.chars().any(char::is_control))?;
        let status = if stale || !["available", "working", "attention", "waiting"].contains(&b.s("status")) { "unknown" } else { b.s("status") };
        let path = format!("/dsh?runtime={}&bot={}", url_encode(runtime?), url_encode(id));
        bots.push(json!({"id": id, "name": name, "role": role, "status": status, "needsYou": (["attention", "waiting"].contains(&status)), "path": path}));
    }
    Some(json!({"version": 1, "machineId": "local", "runtimeId": runtime, "state": if stale && state == "online" { "stale" } else { state }, "observedAt": observed, "stale": stale, "bots": bots}))
}
/// A failed/forbidden response drops the roster. No fallback credential or broader endpoint is tried.
pub fn response(status: u16, bytes: &[u8], now: i64) -> Value {
    match status {
        200 => directory(bytes, now).unwrap_or_else(|| unavailable("incompatible")),
        401 | 403 => unavailable("access_required"),
        404 => unavailable("not_supported"),
        _ => unavailable("unavailable"),
    }
}
pub fn snapshot() -> Value {
    let Some(ui) = crate::webui::find::web_ui(false) else { return unavailable("not_configured") };
    if !["127.0.0.1", "localhost", "::1", "[::1]"].contains(&ui.host.as_str()) { return unavailable("local_only"); }
    match crate::webui::proxy::ask(&ui.host, ui.port, "GET", "/api/bots", &[], MAX_BYTES, 4000) {
        Some(a) => response(a.status, &a.body, crate::clock::now()),
        None => unavailable("unavailable"),
    }
}
pub fn text(j: &Value) -> String {
    let mut lines = vec![format!("DSH Bots: {} (read-only; local machine)", j.s("state"))];
    for b in j.arr("bots") {
        lines.push(format!("{} · {} · {}\n  {}\n  identity: local / {} / {}", b.s("name"), b.s("role"), b.s("status"), b.s("path"), j.s("runtimeId"), b.s("id")));
    }
    lines.join("\n")
}
