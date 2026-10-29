//! Stopped connecting (remote/paused.rs): `herdr-projects machines stop|resume [MACHINE…]` and the board's key pause
//! SSH to every other machine or to the ones named, nothing that would connect gets past it (the board's ask, an
//! action, a file sent, a terminal attached, herdr's list asked there), `herdr-projects machines` says paused without
//! asking, and both boards show a paused machine in red.
use crate::common;
use crate::far;
use common::board::{open, web_as};
use common::*;
use far::{theirs, Far};
use serde_json::json;
use sw::board::keys::{chord, K};
use sw::board::update::{update, Event};
use sw::json::*;
use sw::remote::{machines, paused, Machine};

fn cmd(a: &[&str]) -> Result<(serde_json::Value, String), String> { paused::command(&a.iter().map(|s| s.to_string()).collect::<Vec<_>>()).map_err(|e| e.msg) }
fn m(label: &str) -> Machine { machines().into_iter().find(|x| x.label == label).unwrap() }
fn asked_of(far: &Far, label: &str) -> usize { far.asked().iter().filter(|(h, _, _)| h == label).count() }

#[test]
fn stop_and_resume_by_name_or_all_and_nothing_connects_to_a_paused_machine() {
    let w = world_with(Opts { repo: true, settings: json!({ "board.machines": "me@vm-a, me@vm-b" }), ..Default::default() });
    let far = Far::new(&w.base);
    far.tasks("vm-a", "0.2.0", json!([theirs(1)]));
    far.tasks("vm-b", "0.2.0", json!([theirs(2)]));
    // one machine, by its name: kept in your settings, read again before every connection
    let (j, said) = cmd(&["stop", "vm-a"]).unwrap();
    assert_eq!(j.at("paused"), &json!(["vm-a"]));
    assert!(said.contains("Stopped connecting to vm-a"), "{said}");
    assert_eq!(sw::store::settings::lookup::setting("board.paused", None), json!(["vm-a"]));
    let why = sw::remote::ask_list(&m("vm-a"), 5000).unwrap_err();
    assert_eq!(why.s("kind"), "paused");
    assert!(sw::remote::attach_command(&m("vm-a"), "w1:p1").is_err());
    assert!(sw::remote::ssh_command(&m("vm-a"), "herdr-projects remote list", false).is_err());
    assert!(sw::remote::sidebar::asked(&m("vm-a")).is_none());
    assert!(sw::remote::carry::send_bytes(&m("vm-a"), "f.txt", "file", b"x", &sw::remote::carry::For::Task("far/1".into())).unwrap_err().contains("paused"));
    assert!(sw::remote::ask(&m("vm-a"), "do", Some(&json!({ "action": "pin", "id": "far/1" })), 5000).is_err());
    assert_eq!(asked_of(&far, "vm-a"), 0, "no SSH at all to a paused machine");
    assert!(sw::remote::ask_list(&m("vm-b"), 5000).is_ok());
    assert_eq!(asked_of(&far, "vm-b"), 1);
    // `herdr-projects machines`: paused, not asked
    let (r, text) = cmd(&[]).unwrap();
    assert!(text.lines().any(|l| l.starts_with("vm-a") && l.contains("paused: not connecting (herdr-projects machines resume vm-a)")), "{text}");
    assert!(text.lines().any(|l| l.starts_with("vm-b") && l.contains("answers")), "{text}");
    assert_eq!(r.at("paused"), &json!(["vm-a"]));
    assert_eq!(asked_of(&far, "vm-a"), 0);
    // a name no machine has is refused, and nothing changes
    assert!(cmd(&["stop", "vm-z"]).unwrap_err().contains("No machine \"vm-z\". Known: vm-a, vm-b."));
    assert!(cmd(&["pause"]).unwrap_err().contains("herdr-projects machines [stop|resume]"));
    // every machine, then one connected again while the rest stay stopped
    let (j, said) = cmd(&["stop"]).unwrap();
    assert_eq!(j.at("paused"), &json!(["all"]));
    assert!(said.contains("every other machine"), "{said}");
    assert!(paused::is_paused(&m("vm-b")) && paused::all_paused());
    assert!(cmd(&[]).unwrap().1.contains("Connecting to other machines is stopped"));
    let (j, _) = cmd(&["resume", "me@vm-a"]).unwrap();
    assert_eq!(j.at("paused"), &json!(["vm-b"]));
    assert!(sw::remote::ask_list(&m("vm-a"), 5000).is_ok());
    assert!(sw::remote::ask_list(&m("vm-b"), 5000).is_err());
    let (j, said) = cmd(&["resume"]).unwrap();
    assert_eq!((j.at("paused"), said.as_str()), (&json!([]), "Connecting to the other machines again."));
    assert_eq!(sw::store::settings::lookup::setting("board.paused", None), json!("none"));
    assert!(sw::remote::ask_list(&m("vm-b"), 5000).is_ok());
}

#[test]
fn the_board_key_stops_one_machine_on_its_heading_or_every_machine_and_shows_it_paused_in_red() {
    let w = world_with(Opts { repo: true, settings: json!({ "board.machines": "vm-a, vm-b" }), ..Default::default() });
    let _far = Far::new(&w.base);
    w.add("Mine");
    let mut b = open(&w.root, 34);
    update(&mut b.s, Event::Machines(machines()));
    for l in ["vm-a", "vm-b"] { update(&mut b.s, Event::Remote { label: l.into(), answer: Ok(json!({ "host": l, "version": "0.2.0", "tasks": [theirs(1)] })) }); }
    while b.s.scope != "*" { b.press(&[&chord(K::Scope)]); }
    // anywhere but another machine's heading: every machine
    b.press(&[&chord(K::Connect)]);
    assert_eq!(paused::said(), vec!["all".to_string()]);
    let text = b.screen(140).join("\n");
    assert!(text.contains("vm-a: paused, not connecting (no SSH)") && text.contains("vm-b: paused, not connecting"), "{text}");
    assert!(!text.contains("Theirs 1"), "{text}");
    let red = b.inked(140).iter().any(|l| l.0.iter().any(|p| p.c == sw::shown::ink::Ink::Red && p.t.contains("paused")));
    assert!(red, "paused is said in red");
    // again: every machine connected again
    b.press(&[&chord(K::Connect)]);
    assert!(paused::said().is_empty());
    assert!(b.s.remotes.values().all(|r| r.why.is_none()));
    // on vm-b's heading: vm-b only
    b.s.sel = sw::board::update::heads::machine_id("vm-b");
    let label = sw::board::update::connect::label(&b.s);
    assert_eq!(label, "stop connecting to vm-b (no SSH to it at all)");
    b.press(&[&chord(K::Connect)]);
    assert_eq!(paused::said(), vec!["vm-b".to_string()]);
    assert!(sw::board::update::connect::shown_paused(&b.s, "vm-b") && !sw::board::update::connect::shown_paused(&b.s, "vm-a"));
    // a paused machine has no heading (no tasks): with only its board shown, the key is that machine's
    assert_eq!(sw::board::update::connect::label(&b.s), "connect to every other machine again");
    while b.s.scope != "vm-b" { b.press(&[&chord(K::Scope)]); }
    assert_eq!(sw::board::update::connect::label(&b.s), "connect to vm-b again");
    b.press(&[&chord(K::Connect)]);
    assert!(paused::said().is_empty());
}

#[test]
fn the_web_board_says_paused_and_its_more_menu_has_the_switch() {
    let w = world_with(Opts { repo: true, settings: json!({ "board.machines": "vm-a, vm-b", "board.paused": "vm-a" }), ..Default::default() });
    let far = Far::new(&w.base);
    far.tasks("vm-a", "0.2.0", json!([theirs(1)]));
    far.tasks("vm-b", "0.2.0", json!([theirs(2)]));
    web_as(&w, "p", "press", json!({ "id": "scope", "role": "watch" })).unwrap();
    far::answered("p", 2);
    let s = web_as(&w, "p", "board", json!({ "role": "watch" })).unwrap();
    let unread = s.at("list").arr("unread").to_vec();
    assert_eq!(unread.iter().map(|u| (u.t("machine"), u.b("paused"))).collect::<Vec<_>>(), vec![("vm-a".to_string(), true)]);
    assert!(unread[0].s("line").contains("paused"), "{}", unread[0]);
    assert!(s.arr("menu").iter().any(|i| i.s("id") == "stopConnecting"), "{}", s.at("menu"));
    let boards = web_as(&w, "p", "boards", json!({ "role": "watch" })).unwrap();
    let a = boards.arr("boards").iter().find(|b| b.s("scope") == "vm-a").cloned().unwrap();
    assert_eq!((a.s("line"), a.s("dot"), a.b("paused")), ("paused: not connecting", "red", true));
    assert_eq!(asked_of(&far, "vm-a"), 0);
    let page = include_str!("../../crates/web/src/webui/page/list.js");
    assert!(page.contains(".is-paused") && page.contains("is stopped (paused)"));
}
