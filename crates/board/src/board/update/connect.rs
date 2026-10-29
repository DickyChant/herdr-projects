//! The stop-connecting key from the board's side (remote/paused.rs is the switch itself): on another machine's heading,
//! or with only that machine's board shown, it stops or resumes connecting to that machine; else every other machine. The change is a job (it writes
//! your settings and closes open connections); when it is done every machine shows what it is now, a paused one in red
//! where its tasks would be, one connected again as being asked.
use super::list::relist;
use super::Effect;
use crate::board::job::Job;
use crate::board::state::State;
use crate::json::*;
use crate::remote::paused::{names, why, ALL};
use crate::remote::Machine;

/// Whether the board shows this machine as paused (what it last heard, never a file read).
pub fn shown_paused(s: &State, host: &str) -> bool { s.remotes.get(host).and_then(|m| m.why.as_ref()).is_some_and(|w| w.s("kind") == "paused") }
fn any_paused(s: &State) -> bool { s.remotes.keys().any(|h| shown_paused(s, h)) }
/// The other machine whose heading is selected, or whose own board shows (a paused one has no heading: no tasks).
fn selected(s: &State) -> Option<Machine> {
    let host = s.sel.strip_prefix(&super::heads::machine_id("")).filter(|h| !h.is_empty()).or(Some(s.scope.as_str()).filter(|h| !h.is_empty() && *h != "*"))?;
    s.remotes.get(host).map(|m| m.machine.clone())
}
pub fn key(s: &mut State, fx: &mut Vec<Effect>) {
    if s.remotes.is_empty() { return s.flash("No other machines: there is nothing to stop connecting to.", crate::shown::ink::Ink::Muted); }
    fx.push(Effect::Run(Job::Connect { machine: selected(s) }));
}
/// Its line in the ? menu (and the web board's More).
pub fn label(s: &State) -> String {
    if s.remotes.is_empty() { return String::new(); }
    match selected(s) {
        Some(m) if shown_paused(s, &m.label) => format!("connect to {} again", m.label),
        Some(m) => format!("stop connecting to {} (no SSH to it at all)", m.label),
        None if any_paused(s) => "connect to every other machine again".into(),
        None => "stop connecting to every other machine (no SSH at all)".into(),
    }
}
/// What the setting says now (`paused`), taken in: each machine shown as it now is, and the others asked at once.
pub fn taken(s: &mut State, paused: &[String], fx: &mut Vec<Effect>) {
    for m in s.remotes.values_mut() {
        let off = paused.iter().any(|x| x.eq_ignore_ascii_case(ALL) || names(x, &m.machine));
        let was = m.why.as_ref().is_some_and(|w| w.s("kind") == "paused");
        if off { m.ok = false; m.items.clear(); m.autos.clear(); m.archived.clear(); m.fail_at = s.now; m.why = Some(why(&m.machine)); } else if was { m.why = None; m.fail_at = 0; }
    }
    relist(s);
    fx.push(Effect::Poll(true));
}
