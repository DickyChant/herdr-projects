//! The web board's home page and its topology, read as text (no browser runs here): an entry over the Boards section
//! and a `#home` address, a client of its own so the board's selection never moves, the web UI's machines and the
//! board's counts per group, and a graph of the Boss, the machines, their agents and tasks with the tasks' waits.
const HOME: &str = include_str!("../../crates/web/src/webui/page/home.js");
const TOPO: &str = include_str!("../../crates/web/src/webui/page/topology.js");
const START: &str = include_str!("../../crates/web/src/webui/page/start.js");
const PAGE: &str = include_str!("../../crates/web/src/webui/page.rs");
const BOARDS: &str = include_str!("../../crates/web/src/webui/boards.rs");
const LIST: &str = include_str!("../../crates/web/src/webui/model/list.rs");

#[test]
fn the_home_page_reads_every_machine_with_a_client_of_its_own_and_draws_their_topology() {
    assert!(START.contains(r##"const HOME = "#home";"##) && START.contains("if (home.nextElementSibling !== boards) boards.before(home);"));
    assert!(HOME.contains(r#"sessionStorage.getItem("sw-home")"#) && HOME.contains(r#"ask("/api/machines")"#));
    assert!(HOME.contains(r#"board("scope", { to: "*" })"#), "every machine's tasks once there is another machine");
    // The counts per group, and the tasks' waits, come from the board.
    assert!(BOARDS.contains(r#""title": title, "n": n })"#) && BOARDS.contains(r#""groups": GROUPS"#));
    assert!(LIST.contains(r#""after": crate::after::after_of(r),"#));
    // The graph: the Boss in the middle, each machine owning its agents and tasks, a wait an arrow between two tasks.
    assert!(TOPO.contains(r#"const nodes = [{ id: "boss", kind: "boss""#) && TOPO.contains(r#"links.push({ from: "boss", to: id, kind: "own" });"#));
    assert!(TOPO.contains(r#"links.push({ from: `t:${up.id}`, to: `t:${t.id}`, kind: "after" })"#));
    for f in ["home.css", "home.js", "topology.js"] { assert!(PAGE.contains(&format!(r#"("{f}", include_str!("page/{f}")),"#)), "{f} is served"); }
}
