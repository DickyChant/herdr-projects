//! Boss may draft a Chief handoff and read reports; sending exists only in the authenticated board UI.
use crate::err::Res;
use crate::json::*;
use super::flags::Args;
pub fn run(a: &Args) -> Res<i32> {
    let pos = |n| a.pos.get(n).map(String::as_str).unwrap_or("");
    let value = match pos(1) {
        "reports" => crate::bot_handoff::reports(),
        "show" => crate::bot_handoff::view(pos(2))?,
        "draft" => {
            let socket = crate::util::env_val("HERDR_SOCKET_PATH").unwrap_or_default();
            let pane = crate::util::env_val("HERDR_PANE_ID").unwrap_or_default();
            let co = crate::coordinator::co::Co::top(&socket);
            let saved = crate::coordinator::state::get(&co).unwrap_or_default();
            let live = if socket.is_empty() || pane.is_empty() { None } else { crate::herdr::Herdr::new(Some(socket)).agent_get(&pane).ok().flatten() };
            if saved.s("pane") != pane || pane.is_empty() || !live.as_ref().map(|v| !saved.s("terminal").is_empty() && v.s("terminal_id") == saved.s("terminal")).unwrap_or(false) { crate::fail!("Only the current Boss pane may draft here. Use the board's Chief handoff controls for a direct user request."); }
            let end = a.flags.so("end").unwrap_or("report_once");
            crate::bot_handoff::draft(pos(2), a.flags.s("scope"), end, "boss", &crate::bots::snapshot())?
        }
        _ => crate::fail!("Use bot-handoff draft TASK --scope TEXT [--end report_once|task_closed], show TASK, or reports. The user sends from the board."),
    };
    println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default()); Ok(0)
}
