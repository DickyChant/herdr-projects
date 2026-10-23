// The home page over the web UI's page: mission control for every machine at once. What needs you (tasks that need
// you or wait for your OK, agents that wait in a pane), the board's count in each group, every machine with its
// agents, and what finished lately; each a link into the board or the web UI's own view of that pane. It reads the
// board (its own client, so the board's selection never moves) and the web UI's machines (`/api/machines`), and
// works nothing out the board does not say.
/* global document, window, location, history, sessionStorage, crypto */
import { h, icon, markEl, ink, post } from "./dom.js";
import { trapEscape } from "./sheets.js";
import { graphOf, topologyEl } from "./topology.js";

const API = "/herdr-projects/api", EVERY = 3000;
const GROUP_INK = { "needs you": "red", "ready to approve": "green", working: "yellow", "to do": "todo", done: "teal" };
const PANE_INK = { blocked: "red", working: "yellow", done: "teal", idle: "todo" };
// The home page's own board, a client of its own: reading all machines' tasks never moves the board's selection.
const me = (() => {
  try { let id = sessionStorage.getItem("sw-home"); if (!id) { id = `h${crypto.randomUUID().replace(/-/g, "").slice(0, 15)}`; sessionStorage.setItem("sw-home", id); } return id; }
  catch { return `h${Math.random().toString(36).slice(2, 15)}`; }
})();
async function ask(url, opts) {
  try { const r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...opts }); const j = await r.json().catch(() => ({})); return { ...j, ok: r.ok && j.ok !== false }; }
  catch { return { ok: false }; }
}
const board = (what, body) => ask(`${API}/${what}?${new URLSearchParams({ client: me, machine: "" })}`, body ? { method: "POST", headers: { "content-type": "application/json", "x-herdr-projects": "1" }, body: JSON.stringify(body) } : undefined);

let root = null, timer = null, untrap = null, closing = null, scoped = false, drawn = "";
let data = { boards: null, list: null, machines: null, at: 0 };
export const isHomeOpen = () => !!root;

async function refresh() {
  const [b, m] = await Promise.all([board("boards"), ask("/api/machines")]);
  if (b.ok) data.boards = b;
  // Every machine's tasks: the home page's board shows all of them once there is another machine.
  if (b.ok && !scoped && b.boards?.some((x) => x.scope === "*")) { scoped = (await board("scope", { to: "*" })).ok; }
  const s = await board("board");
  if (s.ok) data.list = s.list;
  if (m.ok || Array.isArray(m.machines)) data.machines = m.machines || [];
  data.at = Date.now();
  draw();
}

// A task picked here: the board opens on it (every machine's board when it is another machine's task).
async function openTask(id) {
  if (data.boards?.boards?.some((x) => x.scope === "*")) await post("scope", { to: "*" });
  await post("pick", { id, open: true });
  goBoard();
}
const goBoard = () => { location.hash = "#board"; };
// A pane picked here: the web UI's own view of it, on its machine (the address the web UI itself uses).
function openPane(machine, p) {
  const q = new URLSearchParams({ ws: p.workspace_id, pane: p.pane_id, view: p.agent ? "chat" : "terminal" });
  if (machine && machine !== "local") q.set("machine", machine);
  location.href = `/?${q}`;
}

const card = (title, extra, ...body) => h("section.sw-hcard", h("header.sw-hcard-head", h("h3", title), extra || null), ...body);
const empty = (text) => h("p.sw-hempty", text);
const rows = (g) => (g?.rows || []).filter((r) => !r.automation);
// The list's groups by name, every machine's together, each row with its machine's name.
function byGroup(list) {
  const out = {}; let machine = "";
  for (const g of list?.groups || []) {
    if (g.machine) { machine = g.name; continue; }
    if (g.top || g.repo || g.automations) continue;
    (out[g.name] ||= []).push(...rows(g).map((r) => ({ ...r, machineName: machine })));
  }
  return out;
}
function taskEl(r) {
  return h("li.sw-hitem", { tabIndex: 0, role: "button", onclick: () => openTask(r.id), onkeydown: (e) => { if (e.key === "Enter") openTask(r.id); } },
    markEl(r.mark, r.color, r.markDim),
    h("span.sw-hmain", h("span.sw-hline1", r.tag ? h("span.sw-hid", r.tag) : null, h("span.sw-htitle", r.title)),
      r.says?.length ? h("span.sw-hsays", ink(r.says)) : null),
    h("span.sw-hside", r.machineName ? h("span.sw-hchip", r.machineName) : null, h("span.sw-htime", r.time)));
}
function paneEl(m, p) {
  const st = p.agent_status || "unknown";
  return h("li.sw-hitem", { tabIndex: 0, role: "button", title: `Open ${p.agent} on ${m.name}`, onclick: () => openPane(m.id, p), onkeydown: (e) => { if (e.key === "Enter") openPane(m.id, p); } },
    markEl(st === "working" ? "●" : st === "blocked" ? "!" : "○", PANE_INK[st] || "overlay0"),
    h("span.sw-hmain", h("span.sw-hline1", h("span.sw-hid", p.agent), h("span.sw-htitle", p.terminal_title_stripped || p.label || p.cwd || p.pane_id))),
    h("span.sw-hside", h("span.sw-hchip", m.name), h(`span.sw-hstate.sw-c-${PANE_INK[st] || "overlay0"}`, st)));
}
const agentsOf = (m) => (m.snapshot?.panes || []).filter((p) => p.agent);

function needsEl(groups) {
  const tasks = [...(groups["needs you"] || []), ...(groups["ready to approve"] || [])];
  const waiting = (data.machines || []).flatMap((m) => agentsOf(m).filter((p) => p.agent_status === "blocked").map((p) => paneEl(m, p)));
  const n = tasks.length + waiting.length;
  return card(`Needs you`, h(`span.sw-hcount${n ? ".is-hot" : ""}`, String(n)),
    n ? h("ul.sw-hlist", tasks.map(taskEl), waiting) : empty("Nothing needs you. Every agent is working or at rest."));
}
function countsEl() {
  const b = data.boards, all = b?.boards?.find((x) => x.scope === "*") || b?.boards?.[0];
  const names = b?.groups || Object.keys(GROUP_INK);
  return card("Board", h("button.btn.btn-ghost.sw-hlink", { type: "button", onclick: goBoard }, "Open board", icon("right")),
    h("div.sw-htiles", names.map((g, i) => h("button.sw-htile", { type: "button", onclick: goBoard },
      h(`span.sw-htile-n.sw-c-${GROUP_INK[g] || "todo"}`, String(all?.n?.[i] ?? "–")), h("span.sw-htile-name", g)))));
}
function machinesEl() {
  const ms = data.machines || [], lines = new Map((data.boards?.boards || []).map((b) => [b.name, b]));
  return card("Machines", h("span.sw-hcount", String(ms.length)), ms.length ? h("ul.sw-hlist", ms.map((m) => {
    const ag = agentsOf(m), on = m.state === "connected", by = (s) => ag.filter((p) => p.agent_status === s).length;
    const said = [by("working") && `${by("working")} working`, by("blocked") && `${by("blocked")} waiting`, by("idle") && `${by("idle")} idle`].filter(Boolean).join(" · ") || "no agents";
    const bl = lines.get(m.name);
    return h("li.sw-hitem", { tabIndex: 0, role: "button", title: `Open ${m.name}`, onclick: () => { location.href = m.id === "local" ? "/" : `/?machine=${encodeURIComponent(m.id)}`; } },
      h(`span.sw-hdot${on ? ".is-on" : ""}`, { role: "img", "aria-label": on ? "connected" : m.state }),
      h("span.sw-hmain", h("span.sw-hline1", h("span.sw-htitle.sw-b", m.name), h("span.sw-hsub", m.kind === "local" ? "this machine" : m.state)),
        h("span.sw-hsays", `${ag.length} agent${ag.length === 1 ? "" : "s"}: ${said}${bl ? ` · board: ${bl.line}` : ""}`)),
      m.error ? h("span.sw-hside", h("span.sw-hstate.sw-c-red", "error")) : null);
  })) : empty("Reading the machines…"));
}
function agentsEl() {
  const all = (data.machines || []).flatMap((m) => agentsOf(m).map((p) => [m, p]));
  const order = { blocked: 0, working: 1, done: 2, idle: 3 };
  all.sort((a, b) => (order[a[1].agent_status] ?? 4) - (order[b[1].agent_status] ?? 4));
  return card("Agents", h("span.sw-hcount", String(all.length)), all.length ? h("ul.sw-hlist", all.map(([m, p]) => paneEl(m, p))) : empty("No agent runs in any pane."));
}
// The live graph: the Boss, every machine, and each one's agents and tasks, with the tasks' waits as arrows.
function topoEl(groups) {
  const tasks = Object.entries(groups).flatMap(([group, rs]) => rs.map((r) => ({ ...r, group })));
  const need = (groups["needs you"] || []).length;
  const g = graphOf(data.machines, tasks, { sub: need ? `${need} need${need === 1 ? "s" : ""} you` : "all quiet", color: need ? "red" : "accent" });
  const on = (n) => { if (n.task) openTask(n.task.id); else if (n.pane) openPane(n.machine.id, n.pane); else if (n.machine) location.href = n.machine.id === "local" ? "/" : `/?machine=${encodeURIComponent(n.machine.id)}`; };
  const waits = g.links.filter((l) => l.kind === "after").length;
  return card("Topology", h("span.sw-hcount", `${g.nodes.length - 1} nodes${waits ? ` · ${waits} wait${waits === 1 ? "" : "s"}` : ""}`), topologyEl(g, on));
}
function recentEl(groups) {
  const done = (groups.done || []).slice(0, 6);
  return card("Recently done", null, done.length ? h("ul.sw-hlist", done.map(taskEl)) : empty("Nothing finished yet."));
}

function draw() {
  if (!root) return;
  const now = JSON.stringify([data.boards, data.list?.groups, data.machines]);
  const when = part("when"); if (when) when.textContent = data.at ? `updated ${new Date(data.at).toLocaleTimeString()}` : "reading…";
  if (now === drawn) return;
  drawn = now;
  const groups = byGroup(data.list);
  part("grid").replaceChildren(h("div.sw-hwide", needsEl(groups)), h("div.sw-hwide", topoEl(groups)), countsEl(), machinesEl(), agentsEl(), recentEl(groups));
}
const part = (name) => root?.querySelector(`.sw-home-${name}`);

// Beside the web UI's sidebar where it stands open on a wide screen, as the board is; the whole screen on a phone.
function fit() {
  if (!root) return;
  const side = document.querySelector(".sidebar") || document.querySelector(".sidebar-shell"), box = side?.getBoundingClientRect();
  const beside = box && box.width > 0 && box.left >= 0 && box.right < window.innerWidth - 400 && window.innerWidth > 768;
  root.style.left = beside ? `${Math.round(box.right)}px` : "0";
}
export function openHome({ onClose }) {
  if (root) return;
  closing = onClose; drawn = "";
  root = h("section.sw-board.sw-home", { role: "region", "aria-label": "Home" },
    h("header.sw-head",
      h("button.icon-button.sw-back", { type: "button", "aria-label": "Close home", title: "Close home", onclick: () => closing?.() }, icon("back")),
      h("h2.sw-name", "Home"), h("span.sw-where.sw-home-when", "reading…"), h("span.sw-head-space"),
      h("button.btn.btn-ghost.sw-hlink", { type: "button", onclick: goBoard }, icon("board"), "Board")),
    h("div.sw-home-body", h("div.sw-home-grid")));
  document.body.append(root);
  try { document.querySelector(".scrim.is-open")?.click(); } catch {}
  untrap = trapEscape(() => closing?.(), (e) => !!e.target?.closest && !e.target.closest(".sw-home") && e.target !== document.body);
  fit(); window.addEventListener("resize", fit);
  refresh();
  timer = setInterval(() => { fit(); if (!document.hidden) refresh(); }, EVERY);
}
export function closeHome() {
  if (!root) return;
  const was = root; root = null;
  clearInterval(timer); timer = null; untrap?.(); untrap = null;
  window.removeEventListener("resize", fit);
  was.remove();
}
// Its entry in the web UI's sidebar, over the Boards section, built of the web UI's own sidebar classes.
let entryEl = null;
export function homeEntryEl(onOpen) {
  if (entryEl) return entryEl;
  entryEl = h("section.sw-home-entry", { "aria-label": "Home", "data-sw-entry": true }, h("ul.agent-list", h("li.agent-item",
    h("button.agent-select.agent-row", { type: "button", title: "Home: every machine at a glance", onclick: onOpen },
      h("span.sidebar-mark", { "aria-hidden": "true" }, icon("all")), h("span.agent-copy", h("span.agent-title", "Home"), h("span.agent-context", "every machine at a glance"))))));
  return entryEl;
}
