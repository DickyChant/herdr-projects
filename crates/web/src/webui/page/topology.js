// The home page's topology (home.js): every machine and what runs on it, drawn live as a graph, each node dragged where you like it. The Boss (the board's
// coordinator of every machine) in the middle, each machine on a ring around it, and on an outer ring each machine's
// agents (one per pane an agent runs in) and its tasks, in their status colours. A task that waits for another
// (`--after`, on this machine or another) is a dashed arrow from the one it waits for. The same graph always lands in
// the same places, so a redraw moves only what changed; a working node pulses. A node is a link, as its row is on the home page.
/* global document, window, localStorage, DOMPoint, setTimeout */
const NS = "http://www.w3.org/2000/svg";
const PANE_INK = { blocked: "red", working: "yellow", done: "teal", idle: "todo" };
const W = 900, H = 560, CX = W / 2, CY = H / 2;

const s = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); } el.append(...kids.filter(Boolean)); return el; };
const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// The graph as nodes and links, from what the home page read: the web UI's machines (their panes) and the board's
// tasks (each with its machine's name). Machines with nothing on them are drawn too: their state is worth seeing.
export function graphOf(machines, tasks, boss) {
  const nodes = [{ id: "boss", kind: "boss", label: "Boss", sub: boss.sub, color: boss.color }], links = [];
  (machines || []).forEach((m) => {
    const id = `m:${m.id}`;
    nodes.push({ id, kind: "machine", label: m.name, sub: m.state === "connected" ? "" : m.state, color: m.state === "connected" ? "green" : "red", machine: m });
    links.push({ from: "boss", to: id, kind: "own" });
    for (const p of (m.snapshot?.panes || []).filter((x) => x.agent)) {
      const st = p.agent_status || "unknown";
      nodes.push({ id: `p:${m.id}:${p.pane_id}`, kind: "agent", label: p.agent, sub: st, color: PANE_INK[st] || "overlay0", live: st === "working", parent: id, machine: m, pane: p });
      links.push({ from: id, to: `p:${m.id}:${p.pane_id}`, kind: "own" });
    }
  });
  // A task under its machine (the one the board names; this machine's are named as the web UI names this machine).
  const home = (machines || []).find((m) => m.kind === "local");
  for (const t of tasks || []) {
    const m = (machines || []).find((x) => x.name === t.machineName) || home;
    const parent = m ? `m:${m.id}` : "boss";
    nodes.push({ id: `t:${t.id}`, kind: "task", label: t.tag || t.id, sub: t.group, title: t.title, color: t.color, live: t.group === "working", parent, task: t });
    links.push({ from: parent, to: `t:${t.id}`, kind: "own" });
  }
  // What a task waits for: by its id, or `machine:KEY-3` / a short name for another machine's task.
  const byRef = new Map();
  for (const t of tasks || []) { byRef.set(t.id, t); if (t.tag) { byRef.set(t.tag, t); if (t.machineName) byRef.set(`${t.machineName}:${t.tag}`, t); } }
  for (const t of tasks || []) for (const ref of t.after || []) { const up = byRef.get(ref) || byRef.get(ref.split(":").pop()); if (up) links.push({ from: `t:${up.id}`, to: `t:${t.id}`, kind: "after" }); }
  return { nodes, links };
}

// Where each node stands: machines evenly on the inner ring, each one's agents and tasks fanned out on the outer ring
// in its own slice of it. The same graph always lands the same way, so a redraw only moves what changed.
function layout(g) {
  const at = new Map([["boss", { x: CX, y: CY }]]);
  const machines = g.nodes.filter((n) => n.kind === "machine"), R1 = Math.min(W, H) * 0.24, R2 = Math.min(W, H) * 0.44;
  machines.forEach((m, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, machines.length);
    at.set(m.id, { x: CX + R1 * Math.cos(a), y: CY + R1 * Math.sin(a), a });
    const kids = g.nodes.filter((n) => n.parent === m.id), span = Math.min(Math.PI * 0.9, (2 * Math.PI) / Math.max(1, machines.length) * 0.85);
    kids.forEach((k, j) => {
      const b = a + (kids.length === 1 ? 0 : -span / 2 + (j * span) / (kids.length - 1)), r = R2 - (j % 2) * 34;
      at.set(k.id, { x: CX + r * Math.cos(b), y: CY + r * 0.92 * Math.sin(b) });
    });
  });
  g.nodes.filter((n) => !at.has(n.id)).forEach((n, i) => at.set(n.id, { x: CX + (i - 1) * 70, y: CY + 90 }));
  return at;
}

// A node dragged somewhere else: how far from where the layout put it, kept over every redraw and reload (each
// browser's own). A machine dragged takes its agents and tasks with it; one of them dragged moves alone.
const MOVED = "sw-topo-moved";
const moved = (() => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(MOVED) || "{}"))); } catch { return new Map(); } })();
const keep = () => { try { localStorage.setItem(MOVED, JSON.stringify(Object.fromEntries(moved))); } catch {} };
let dragging = false;
export const isDragging = () => dragging;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function placed(g, base) {
  const off = (id) => moved.get(id) || { dx: 0, dy: 0 }, at = new Map();
  for (const n of g.nodes) {
    const b = base.get(n.id), o = off(n.id), up = n.parent && n.parent !== "boss" ? off(n.parent) : { dx: 0, dy: 0 };
    at.set(n.id, { x: clamp(b.x + o.dx + up.dx, 20, W - 20), y: clamp(b.y + o.dy + up.dy, 20, H - 20) });
  }
  return at;
}

const RADIUS = { boss: 26, machine: 18, agent: 11, task: 9 };
function nodeEl(n, on, grab) {
  const r = RADIUS[n.kind];
  const shape = n.kind === "task" ? s("rect", { x: -r, y: -r, width: 2 * r, height: 2 * r, rx: 3, class: `sw-tnode sw-f-${n.color}` })
    : s("circle", { r, class: `sw-tnode sw-f-${n.color}${n.kind === "boss" ? " is-boss" : ""}` });
  const below = n.kind === "boss" || n.kind === "machine";
  return s("g", { class: `sw-tn is-${n.kind}${n.live ? " is-live" : ""}`, tabindex: n.kind === "boss" ? null : 0, role: n.kind === "boss" ? null : "button", onpointerdown: (e) => grab(e, n), onclick: () => { if (!grab.swallow) on(n); }, onkeydown: (e) => { if (e.key === "Enter") on(n); } },
    s("title", {}, [n.label, n.title, n.sub].filter(Boolean).join(" · ")),
    n.live ? s("circle", { r: r + 4, class: `sw-tpulse sw-s-${n.color}` }) : null, shape,
    s("text", { y: below ? r + 15 : -r - 6, class: `sw-tlabel${below ? " is-strong" : ""}` }, cut(n.label, 16)),
    n.sub && below ? s("text", { y: r + 29, class: "sw-tsub" }, cut(n.sub, 22)) : null);
}
// A link's line, between where its two nodes stand now. A wait between tasks: a curve, so two on one line are told
// apart, ending short of the task's box.
function lineTo(el, l, a, b) {
  if (l.kind === "own") { el.setAttribute("x1", a.x); el.setAttribute("y1", a.y); el.setAttribute("x2", b.x); el.setAttribute("y2", b.y); return; }
  const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.25, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.25, d = Math.hypot(b.x - mx, b.y - my) || 1, k = (RADIUS.task + 4) / d;
  el.setAttribute("d", `M${a.x} ${a.y} Q${mx} ${my} ${b.x - (b.x - mx) * k} ${b.y - (b.y - my) * k}`);
}

// The panel's picture, drawn again whole when the graph changed. A node is dragged with the mouse or a finger (a
// press that moves more than a few pixels is a drag, not a click); Reset layout puts every node back.
export function topologyEl(g, on) {
  const base = layout(g);
  const arrow = s("marker", { id: "sw-tarrow", viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, s("path", { d: "M0 0 10 5 0 10z", class: "sw-tarrow" }));
  const lines = g.links.filter((l) => base.has(l.from) && base.has(l.to)).map((l) => [l, l.kind === "own" ? s("line", { class: "sw-tlink" }) : s("path", { class: "sw-tafter", "marker-end": "url(#sw-tarrow)" })]);
  const reset = document.createElement("button");
  reset.type = "button"; reset.className = "btn btn-ghost sw-treset"; reset.textContent = "Reset layout";
  reset.addEventListener("click", () => { moved.clear(); keep(); place(); });
  const grab = (e, n) => {
    if (e.button !== 0) return;
    const m = svg.getScreenCTM(); if (!m) return;
    const to = (ev) => new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()), from = to(e), was = moved.get(n.id) || { dx: 0, dy: 0 };
    let went = false;
    const move = (ev) => {
      const p = to(ev), dx = p.x - from.x, dy = p.y - from.y;
      if (!went && Math.hypot(dx, dy) < 4) return;
      went = true; dragging = true; svg.classList.add("is-dragging");
      moved.set(n.id, { dx: was.dx + dx, dy: was.dy + dy }); place();
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      svg.classList.remove("is-dragging");
      if (went) { keep(); grab.swallow = true; setTimeout(() => { grab.swallow = false; }, 0); }
      dragging = false;
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };
  const nodes = g.nodes.map((n) => [n, nodeEl(n, on, grab)]);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "sw-topo", role: "img", "aria-label": `Topology: ${g.nodes.filter((n) => n.kind === "machine").length} machines` },
    s("defs", {}, arrow), s("g", {}, ...lines.map(([, el]) => el)), s("g", {}, ...nodes.map(([, el]) => el)));
  function place() {
    const at = placed(g, base);
    for (const [n, el] of nodes) { const p = at.get(n.id); el.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`); }
    for (const [l, el] of lines) lineTo(el, l, at.get(l.from), at.get(l.to));
    reset.hidden = !g.nodes.some((n) => moved.has(n.id));
  }
  place();
  const legend = document.createElement("div");
  legend.className = "sw-tlegend";
  legend.innerHTML = '<span><i class="sw-tk is-c"></i>machine / agent</span><span><i class="sw-tk is-s"></i>task</span><span><i class="sw-tk is-d"></i>waits for</span><span><i class="sw-tk is-p"></i>working</span><span class="sw-tlegend-space"></span>';
  legend.append(reset);
  const box = document.createElement("div"); box.className = "sw-topo-box"; box.append(svg, legend);
  return box;
}
