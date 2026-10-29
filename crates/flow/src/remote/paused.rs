//! Stopped connecting: the switch that keeps every herdr-projects process here (the board, the keeper, the call
//! helper, the web board, `herdr-projects machines`, an action on another machine's task) from opening SSH to other
//! machines: all of them, or the ones named. It is the `board.paused` setting (`all`, machine names, or `none`), read
//! again before every connection (ssh_command asks `gate` first), so a running process follows it at once. This
//! machine is never touched. `herdr-projects machines stop|resume [MACHINE…]` and the board's key change it.
use super::{machines, short_label, Machine};
use crate::err::Res;
use crate::json::*;
use crate::store::settings::{change::{set_value, unset_value}, lookup::{setting, Scope}};

pub const SETTING: &str = "board.paused";
/// The word for every machine.
pub const ALL: &str = "all";

/// What the setting says now: `all`, names, or nothing.
pub fn said() -> Vec<String> { match setting(SETTING, None) { Value::Array(a) => a.iter().map(text).filter(|x| !x.trim().is_empty()).collect(), _ => vec![] } }
fn every(said: &[String]) -> bool { said.iter().any(|x| x.eq_ignore_ascii_case(ALL)) }
/// Connecting to every other machine is stopped.
pub fn all_paused() -> bool { every(&said()) }
/// Whether `name` (as typed, or as the setting holds it) names the machine: its board name, its SSH target, its host,
/// or herdr's id for it.
pub fn names(name: &str, m: &Machine) -> bool {
    let n = name.trim().to_lowercase();
    if n.is_empty() { return false; }
    let label = m.label.to_lowercase();
    n == label || n == m.target.to_lowercase() || (!m.id.is_empty() && n == m.id.to_lowercase()) || short_label(&n) == label
}
/// Connecting to this machine is stopped.
pub fn is_paused(m: &Machine) -> bool { let s = said(); every(&s) || s.iter().any(|x| names(x, m)) }
/// Why there is no answer from a paused machine, as remote/why.rs says why for one that did not answer.
pub fn why(m: &Machine) -> Value {
    let name = if m.label.is_empty() { "that machine" } else { &m.label };
    json!({ "kind": "paused", "line": "paused: the board does not connect to it", "said": "", "code": null,
        "detail": [format!("Connecting to {name} is stopped ({SETTING}): no herdr-projects process here opens SSH to it."), format!("To connect again: herdr-projects machines resume {}  (or {} on the board)", m.label, crate::board::keys::key_name("stopConnecting"))] })
}
/// The one check before every SSH connection to another machine: Err with why when it is paused.
pub fn gate(m: &Machine) -> Result<(), Value> { if is_paused(m) { Err(why(m)) } else { Ok(()) } }

/// The machines the names stand for, by their board names; a name no machine has is refused with the known ones.
fn resolve(typed: &[String], known: &[Machine]) -> Res<Vec<String>> {
    let mut out = vec![];
    for t in typed.iter().filter(|t| !t.eq_ignore_ascii_case(ALL)) {
        let Some(m) = known.iter().find(|m| names(t, m)) else {
            let list: Vec<&str> = known.iter().map(|m| m.label.as_str()).collect();
            crate::fail!("No machine \"{t}\". Known: {}.", if list.is_empty() { "none".to_string() } else { list.join(", ") });
        };
        if !out.contains(&m.label) { out.push(m.label.clone()); }
    }
    Ok(out)
}
fn save(list: Vec<String>) -> Res<()> {
    if list.is_empty() { unset_value(SETTING, &Scope::you())?; } else { set_value(SETTING, &json!(list), &Scope::you())?; }
    Ok(())
}
fn want_all(typed: &[String]) -> bool { typed.is_empty() || every(typed) }
/// Stop connecting: to every machine (no names, or `all`), or to the ones named, beside those stopped already. The
/// shared connections already open to them are closed, so nothing goes on over them.
pub fn stop(typed: &[String]) -> Res<(Value, String)> {
    let known = machines();
    let now = said();
    let list = if want_all(typed) || every(&now) { vec![ALL.to_string()] } else {
        let mut l = now.clone();
        for n in resolve(typed, &known)? { if !l.iter().any(|x| x.eq_ignore_ascii_case(&n)) { l.push(n); } }
        l
    };
    save(list.clone())?;
    for m in known.iter().filter(|m| is_paused(m)) { close_shared(m); }
    let words = if every(&list) { "Stopped connecting to every other machine. Nothing here opens SSH to them until: herdr-projects machines resume".to_string() } else { format!("Stopped connecting to {}. To connect again: herdr-projects machines resume {}", list.join(", "), list.join(" ")) };
    Ok((json!({ "paused": list }), words))
}
/// Connect again: to every machine (no names, or `all`), or to the ones named while the rest stay stopped.
pub fn resume(typed: &[String]) -> Res<(Value, String)> {
    let known = machines();
    let now = said();
    let list: Vec<String> = if want_all(typed) { vec![] } else {
        let back = resolve(typed, &known)?;
        let from: Vec<String> = if every(&now) { known.iter().map(|m| m.label.clone()).collect() } else { now.clone() };
        let gone = |x: &String| back.iter().any(|b| b.eq_ignore_ascii_case(x) || known.iter().any(|m| m.label == *b && names(x, m)));
        from.into_iter().filter(|x| !gone(x)).collect()
    };
    save(list.clone())?;
    let words = if list.is_empty() { "Connecting to the other machines again.".to_string() } else { format!("Connecting again, but not to {} (stopped).", list.join(", ")) };
    Ok((json!({ "paused": list }), words))
}
/// The board's key: one machine stopped or connected again, or with none, every machine.
pub fn toggle(m: Option<&Machine>) -> Res<String> {
    Ok(match m {
        Some(m) if is_paused(m) => resume(std::slice::from_ref(&m.label))?.1,
        Some(m) => stop(std::slice::from_ref(&m.label))?.1,
        None if said().is_empty() => stop(&[])?.1,
        None => resume(&[])?.1,
    })
}
/// The connection ssh keeps open to a machine (`ControlMaster`), closed: `ssh -O exit` only talks to that local socket
/// and never connects anywhere. Not with the tests' stand-in for ssh.
fn close_shared(m: &Machine) {
    if std::env::var_os("HERDR_PROJECTS_SSH").is_some() || m.target.is_empty() || m.target.starts_with('-') { return; }
    let mut c = std::process::Command::new("ssh");
    c.args(["-O", "exit", "-o", &format!("ControlPath={}", crate::store::files::data_dir().join("ssh-%C").display()), &m.target]);
    let _ = super::run_ended(c, 3000);
}
/// `herdr-projects machines [stop|resume] [MACHINE…]`.
pub fn command(args: &[String]) -> Res<(Value, String)> {
    let rest = args.get(1..).unwrap_or(&[]).to_vec();
    match args.first().map(|s| s.as_str()).unwrap_or("") {
        "" => { let r = super::check::check(20000); let s = super::check::say(&r); Ok((r, s)) }
        "stop" => stop(&rest),
        "resume" => resume(&rest),
        other => crate::fail!("Unknown: herdr-projects machines {other}. Try: herdr-projects machines [stop|resume] [MACHINE…]"),
    }
}
