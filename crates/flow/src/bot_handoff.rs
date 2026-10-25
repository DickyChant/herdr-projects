//! One board-to-Chief handoff per task: Boss drafts, the human sends, and reports stay inert.
pub mod transport;
use crate::err::{Error, Res};
use crate::json::*;
use crate::store::{files, tasks::{self, Change, ListOpts}};

fn task(reference: &str) -> Res<Obj> {
    if reference.contains("..") || reference.contains(':') || reference.starts_with('/') || reference.contains('\\') { crate::fail!("Use a local board task."); }
    tasks::find(reference)
}
pub fn closed(t: &Obj) -> bool { t.s("stage") == "done" || t.b("archivedAt") }
pub fn view(reference: &str) -> Res<Value> { Ok(task(reference)?.at("botHandoff").clone()) }
fn board_id() -> Res<String> {
    files::with_lock("bot-handoff-board", || {
        let p = files::data_dir().join("bot-handoff-board.json");
        if p.exists() { return files::read_obj(&p).filter(|v| !v.s("id").is_empty()).map(|v| v.t("id")).ok_or_else(|| Error::new("The handoff board identity cannot be read.")); }
        let id = crate::util::uuid(); files::write_json(&p, &json!({"id": id}))?; Ok(id)
    })
}
/// The caller determines origin: the authenticated web UI says user; only the saved Boss pane says boss.
pub fn draft(reference: &str, scope: &str, end: &str, origin: &str, directory: &Value) -> Res<Value> {
    let t = task(reference)?;
    if scope.trim().is_empty() || scope.len() > 500 || scope.chars().any(char::is_control) || !["report_once", "task_closed"].contains(&end) || !["user", "boss"].contains(&origin) { crate::fail!("Give a one-line scope (up to 500 bytes) and report_once or task_closed."); }
    if directory.s("state") != "online" || directory.b("stale") { crate::fail!("The local DSH roster is unavailable or stale."); }
    let chiefs: Vec<&Value> = directory.arr("bots").iter().filter(|b| b.s("name").eq_ignore_ascii_case("chief")).collect();
    if chiefs.len() != 1 { crate::fail!("A single Chief must be present in the local DSH roster."); }
    let chief = chiefs[0];
    let handoff = json!({"id": crate::util::uuid(), "boardId": board_id()?, "taskId": t.s("id"), "runtimeId": directory.s("runtimeId"), "botId": chief.s("id"), "target": chief.s("name"), "path": chief.s("path"), "scope": scope.trim(), "origin": origin, "end": end, "state": "draft", "hop": 1});
    let t = tasks::update(t.s("id"), |t| {
        if closed(t) { crate::fail!("This task is closed."); }
        if !t.at("botHandoff").is_null() { crate::fail!("This task already has its one handoff."); }
        t.put("botHandoff", handoff); Ok(Change::Write)
    })?;
    Ok(t.at("botHandoff").clone())
}
/// Atomically claim a reviewed draft before any I/O. A second click cannot submit it again.
pub fn send_with(reference: &str, expected: &str, ask: &dyn Fn(&Value, &str) -> Res<Value>) -> Res<Value> {
    let t = task(reference)?;
    let t = tasks::update(t.s("id"), |t| {
        if closed(t) { crate::fail!("This task is closed."); }
        let mut h = obj(t.at("botHandoff").clone());
        if h.s("state") != "draft" || h.s("id") != expected { crate::fail!("This draft changed or was already sent. Refresh its status; do not resend."); }
        h.put("state", "sending"); t.put("botHandoff", h); Ok(Change::Write)
    })?;
    let h = t.at("botHandoff");
    let result = ask(h, "create");
    settle(t.s("id"), h.s("id"), result)?;
    // Closing while a send was in flight always gets another remote close after admission.
    let current = task(t.s("id"))?;
    if closed(&current) || current.at("botHandoff").s("state") == "closed" { close(t.s("id"))?; let _ = refresh_with(t.s("id"), ask); }
    view(t.s("id"))
}
fn settle(id: &str, expected: &str, answer: Res<Value>) -> Res<()> {
    tasks::update(id, |t| {
        let mut h = obj(t.at("botHandoff").clone());
        if h.s("id") != expected || h.s("state") == "closed" || closed(t) { return Ok(Change::Keep); }
        match answer {
            Ok(a) if a.s("id") == expected && a.at("boardId") == h.at("boardId") && a.at("taskId") == h.at("taskId") && a.at("runtimeId") == h.at("runtimeId") && a.at("botId") == h.at("botId") && ["sent", "sending", "working", "uncertain", "reported", "closed"].contains(&a.s("state")) && (1..=2).contains(&a.i("hop")) => {
                h.put("state", a.s("state")); h.put("hop", a.i("hop"));
                let report = a.at("report");
                if a.s("state") == "reported" && report.s("origin") == "chief" && report.i("hop") == 2 && report.s("text").len() <= 48000 { h.put("report", report.clone()); }
                h.remove("error");
            }
            _ => { if h.s("state") == "sending" { h.put("state", "uncertain"); } h.put("error", "DSH did not confirm the outcome. Inspect Chief; this request will not be resent."); }
        }
        if t.at("botHandoff") == &Value::Object(h.clone()) { return Ok(Change::Keep); }
        t.put("botHandoff", h); Ok(Change::Write)
    })?; Ok(())
}
pub fn close(reference: &str) -> Res<Value> {
    let t = task(reference)?;
    let t = tasks::update(t.s("id"), |t| {
        let mut h = obj(t.at("botHandoff").clone());
        if h.is_empty() { crate::fail!("No handoff on this task."); }
        h.put("state", "closed"); h.put("needsClose", true); t.put("botHandoff", h); Ok(Change::Write)
    })?; Ok(t.at("botHandoff").clone())
}
/// Polling stores a report only; it never wakes Boss or changes the board task's stage.
pub fn refresh_with(reference: &str, ask: &dyn Fn(&Value, &str) -> Res<Value>) -> Res<()> {
    let t = task(reference)?;
    let h = t.at("botHandoff");
    if h.is_null() { return Ok(()); }
    if closed(&t) || h.s("state") == "closed" {
        if h.s("state") != "closed" { close(t.s("id"))?; }
        if h.b("needsClose") || h.s("state") != "closed" {
            if let Ok(a) = ask(h, "close") { if a.s("state") == "closed" && a.s("id") == h.s("id") { tasks::update(t.s("id"), |t| { let mut h = obj(t.at("botHandoff").clone()); h.put("needsClose", false); t.put("botHandoff", h); Ok(Change::Write) })?; } }
        }
    } else if !["draft", "reported"].contains(&h.s("state")) { settle(t.s("id"), h.s("id"), ask(h, "status"))?; }
    Ok(())
}
pub fn reports() -> Value {
    json!(tasks::list(ListOpts { include_archived: true, ..Default::default() }).iter().filter_map(|t| {
        let h = t.at("botHandoff"); (!h.at("report").is_null()).then(|| json!({"taskId": t.s("id"), "handoff": h}))
    }).collect::<Vec<_>>())
}
/// One pending item per tick, round-robin; a slow service cannot monopolize the keeper.
pub fn tick() {
    if !crate::store::marks::due("bot-handoff-poll", 3000) { return; }
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let pending: Vec<Obj> = tasks::list(ListOpts { include_archived: true, ..Default::default() }).into_iter().filter(|t| {
        let h = t.at("botHandoff"); !h.is_null() && (h.b("needsClose") || (h.s("state") != "closed" && (closed(t) || !["draft", "reported"].contains(&h.s("state")))))
    }).collect();
    if !pending.is_empty() { let t = &pending[NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % pending.len()]; let _ = refresh_with(t.s("id"), &transport::ask); }
}
