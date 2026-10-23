// The task list as columns, a kanban: one column per group the list has (needs you, ready to approve, working, to do,
// done; a repo's name when grouped by repo), side by side on a wide screen, each task a card. The groups, rows, words
// and colours are the board's own (webui/model/list.rs), exactly as the list draws them (list.js): this file only
// lays them out another way. The same group on several machines is one column, each machine's part of it under its name.
/* global localStorage, window */
import { h } from "./dom.js";
import { rowEl, headEl, jobEl, unreadEl } from "./list.js";

// Columns or the list: each browser's own choice, kept over a reload. Columns need a wide screen: narrower, the list.
const KEY = "sw-columns";
export const columnsOn = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export const setColumns = (on) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {} };
export const columnsFit = () => !!window.matchMedia?.("(min-width: 900px)").matches;

const kindOf = (g) => g.top ? "top" : g.machine ? "machine" : g.repo ? "project" : g.automations ? "autos" : "group";
const holds = (g) => g.rows.length > 0 || g.more > 0 || (g.folded && kindOf(g) !== "machine" && kindOf(g) !== "top");

// The list's headings, in its order, split in two: the ones that hold tasks become the columns' parts (gathered by
// name, in the order a name first comes), and the ones over them (all machines, a machine, a project with its
// coordinator) stand in a strip above the columns, so a coordinator is still picked and opened from there.
export function columnsOf(list) {
  const cols = new Map(), over = [];
  let machine = "", project = "";
  for (const g of list.groups) {
    const kind = kindOf(g);
    if (kind === "top") { machine = ""; project = ""; }
    if (kind === "machine") { machine = g.name; project = ""; }
    if (kind === "project" && !holds(g)) project = g.name;
    if (!holds(g)) { if (g.id) over.push(g); continue; }
    const name = kind === "autos" ? "automations" : g.name;
    if (!cols.has(name)) cols.set(name, { name, color: g.color, kind, parts: [] });
    cols.get(name).parts.push({ g, where: [machine, kind === "project" ? "" : project].filter(Boolean).join(" · ") });
  }
  return { over, cols: [...cols.values()] };
}

// How many tasks a column holds, as its heading says it: the rows it shows, those behind Show more, and a folded
// part's own count.
const countOf = (col) => col.parts.reduce((n, { g }) => n + (g.folded ? (typeof g.count === "number" ? g.count : 0) : g.rows.length + g.more), 0);

function partEl(p, many, list, { opened, onPick, onOpen, onMore, onFold }) {
  const { g } = p;
  // A part's own line, where the column has several (one per machine) or its machine is not the only one: its name
  // and a caret that folds it, as the status group's heading does in the list.
  const line = many || p.where ? h("button.sw-col-part", { type: "button", "aria-expanded": g.folded ? "false" : "true", title: g.folded ? "Unfold" : "Fold", onclick: () => onFold(g.id) },
    h("span.sw-col-caret", g.folded ? "▸" : "▾"), h("span.sw-col-where", p.where || g.name), g.folded ? h("span.sw-count", ` ${typeof g.count === "number" ? `${g.count} tasks` : g.count}`) : null) : null;
  if (g.folded) return h("div.sw-col-seg.is-folded", line || h("button.sw-col-part", { type: "button", onclick: () => onFold(g.id) }, h("span.sw-col-caret", "▸"), h("span.sw-count", typeof g.count === "number" ? `${g.count} tasks` : g.count)));
  return h("div.sw-col-seg", line,
    g.rows.length ? h("ul.sw-rows.sw-cards", g.rows.map((r) => rowEl(r, { selected: r.id === list.selected, opened: r.id === opened, onPick, onOpen }))) : null,
    g.more ? h("button.btn.btn-ghost.sw-more", { type: "button", onclick: () => onMore(g) }, `Show ${g.more} more`) : null);
}

function columnEl(col, list, opts) {
  const many = col.parts.length > 1, n = countOf(col);
  // A column with one part folds from its heading, as the list's status group does; with several, each part folds.
  const one = !many ? col.parts[0].g : null;
  const head = h(`div.sw-col-head${one ? ".is-fold" : ""}`, one ? { onclick: () => opts.onFold(one.id), title: one.folded ? "Unfold" : "Fold" } : {},
    h(`span.sw-col-name.sw-c-${col.color}`, col.name), h("span.sw-col-n", String(n)));
  return h(`section.sw-col.is-${col.kind}`, { "aria-label": `${col.name}, ${n}` }, head,
    h("div.sw-col-body", col.parts.map((p) => partEl(p, many, list, opts))));
}

export function columnsEl(list, opts) {
  const unread = unreadEl(list);
  if (!list.groups.length && !list.jobs.length) return unread.length ? h("div.sw-list.sw-cols-list", unread, list.empty ? h("p.sw-empty", list.empty) : null) : h("p.sw-empty", list.empty);
  const { over, cols } = columnsOf(list);
  const jobs = list.jobs.length ? h("section.sw-col.is-jobs", h("div.sw-col-head", h("span.sw-col-name.sw-c-overlay0", "on their way"), h("span.sw-col-n", String(list.jobs.length))),
    h("div.sw-col-body", h("ul.sw-rows.sw-cards", list.jobs.map((j) => jobEl(j, { selected: j.id === list.selected, onPick: opts.onPick }))))) : null;
  const strip = over.length ? h("div.sw-col-over", over.map((g) => headEl(g, g.id === list.selected, opts))) : null;
  return h("div.sw-list.sw-cols-list", { role: "listbox", "aria-label": "Tasks" }, unread, strip,
    h("div.sw-cols", jobs, cols.map((c) => columnEl(c, list, opts))),
    !cols.length && !jobs ? h("p.sw-empty", list.empty || "No tasks") : null);
}
