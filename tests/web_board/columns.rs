//! The web board's columns, read as text (no browser runs here): a switch in the header that each browser keeps, the
//! list's own rows as cards and its own headings over the columns, one column per group gathered by name across
//! machines, and the list again where the screen is narrow.
const COLS: &str = include_str!("../../crates/web/src/webui/page/columns.js");
const CSS: &str = include_str!("../../crates/web/src/webui/page/columns.css");
const BOARD: &str = include_str!("../../crates/web/src/webui/page/board.js");
const LIST: &str = include_str!("../../crates/web/src/webui/page/list.js");
const PAGE: &str = include_str!("../../crates/web/src/webui/page.rs");

#[test]
fn the_columns_draw_the_lists_own_rows_and_headings_and_the_switch_is_each_browsers() {
    // The board's own rows and headings, never drawn again: the list hands them over.
    assert!(COLS.contains(r#"import { rowEl, headEl, jobEl, unreadEl } from "./list.js";"#));
    for f in ["export function headEl(g,", "export const jobEl = (j,", "export function unreadEl(list)", "export function rowEl(r,"] { assert!(LIST.contains(f), "list.js has {f}"); }
    // One column per group, by name in the order a name first comes, each machine's part under its name.
    assert!(COLS.contains("if (!cols.has(name)) cols.set(name, { name, color: g.color, kind, parts: [] });"));
    assert!(COLS.contains(r#"where: [machine, kind === "project" ? "" : project].filter(Boolean).join(" · ")"#));
    // Kept per browser, a reload too, and only where the screen is wide: narrower, the list.
    assert!(COLS.contains(r#"const KEY = "sw-columns";"#) && COLS.contains(r#"matchMedia?.("(min-width: 900px)")"#));
    assert!(BOARD.contains("const cols = columnsOn() && columnsFit();") && BOARD.contains("(cols ? columnsEl : listEl)(snap.list, {"));
    assert!(BOARD.contains(r#"h("button.icon-button.sw-cols-toggle", { type: "button", "aria-label": "Show as columns""#));
    assert!(CSS.contains(r#"@media (max-width: 899px) { .sw-cols-toggle { display: none; } }"#));
    // Served as the page's other files are.
    assert!(PAGE.contains(r#"("columns.css", include_str!("page/columns.css")),"#) && PAGE.contains(r#"("columns.js", include_str!("page/columns.js")),"#));
}
