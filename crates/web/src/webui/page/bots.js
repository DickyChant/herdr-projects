// DSH roster reads for Home: public status only, stable identities and links into Ovis's native Bot workspace.
import { h, markEl } from "./dom.js";
export const BOT_INK = { available: "teal", working: "yellow", attention: "red", waiting: "red", unknown: "overlay0" };
export const BOT_WORDS = { available: "Available", working: "Working", attention: "Needs attention", waiting: "Waiting", unknown: "Unknown" };
const valid = (v, max = 256) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
export const botPath = (d, b) => `/dsh?${new URLSearchParams({ runtime: d.runtimeId, bot: b.id })}`;
export const runtimeId = (d) => `r:${encodeURIComponent(d.machineId)}:${encodeURIComponent(d.runtimeId)}`;
export const botId = (d, b) => `b:${encodeURIComponent(d.machineId)}:${encodeURIComponent(d.runtimeId)}:${encodeURIComponent(b.id)}`;
export function roster(value, now = Date.now()) {
  if (value?.version !== 1 || value.machineId !== "local" || !["online", "offline", "incompatible", "not_configured"].includes(value.state) || !Array.isArray(value.bots) || value.bots.length > 500) return null;
  if (!valid(value.runtimeId) && (value.bots.length || value.state === "online")) return null;
  const stale = value.state !== "online" || !Number.isSafeInteger(value.observedAt) || value.observedAt <= 0 || value.observedAt > now + 15000 || now - value.observedAt > 15000;
  const ids = new Set(), bots = [];
  for (const b of value.bots) {
    if (!valid(b.id) || ids.has(b.id) || !valid(b.name) || typeof b.role !== "string" || b.role.length > 1024) return null;
    ids.add(b.id);
    bots.push({ id: b.id, name: b.name, role: b.role, status: !stale && Object.hasOwn(BOT_INK, b.status) ? b.status : "unknown" });
  }
  return { machineId: "local", runtimeId: valid(value.runtimeId) ? value.runtimeId : null, state: stale && value.state === "online" ? "stale" : value.state, observedAt: value.observedAt, bots };
}
export function missed(previous) { return previous ? { ...previous, state: "unavailable", bots: previous.bots.map((b) => ({ ...b, status: "unknown" })) } : null; }
export async function readBots(previous, signal) {
  try {
    const r = await fetch("/api/bots", { credentials: "same-origin", cache: "no-store", signal });
    if (r.status === 401 || r.status === 403 || r.status === 404) return null;
    if (!r.ok) return missed(previous);
    // The existing server bounds this directory; cap the parsed client payload too.
    const text = await r.text();
    if (text.length > 1048576) return missed(previous);
    return roster(JSON.parse(text)) || missed(previous);
  } catch { return missed(previous); }
}
export const needsBots = (d) => d?.state === "online" ? d.bots.filter((b) => ["attention", "waiting"].includes(b.status)) : [];
export function botEl(d, b) {
  return h("li.sw-hitem", h("a.sw-hbotlink", { href: botPath(d, b), title: `Open ${b.name} in DSH` },
    markEl(b.status === "working" ? "●" : ["attention", "waiting"].includes(b.status) ? "!" : "○", BOT_INK[b.status]),
    h("span.sw-hmain", h("span.sw-hline1", h("span.sw-htitle.sw-b", b.name)), h("span.sw-hsays", b.role)),
    h("span.sw-hside", h("span.sw-hchip", "DSH"), h(`span.sw-hstate.sw-c-${BOT_INK[b.status]}`, BOT_WORDS[b.status]))));
}
export function botsEl(d) {
  if (!d || d.state === "not_configured") return null;
  const state = { online: "Connected", offline: "Offline · last known Bots", stale: "Status is stale", unavailable: "Unavailable · last known Bots", incompatible: "Integration unavailable" }[d.state] || "Unavailable";
  return h("section.sw-hcard", h("header.sw-hcard-head", h("h3", "DSH Bots"), h("a.btn.btn-ghost.sw-hlink", { href: "/dsh" }, "Open workspace")),
    h("p.sw-hbotstatus", { role: "status" }, state), d.bots.length ? h("ul.sw-hlist", d.bots.map((b) => botEl(d, b))) : h("p.sw-hempty", "No Bots to show."));
}
