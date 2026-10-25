// The user reviews and sends one Chief handoff per board task; reports are rendered as plain text.
import { h } from "./dom.js";
const drafts = new Map();
export function handoffEl(snap, send) {
  const p = snap.panel;
  if (!p?.handoffLocal) return null;
  const record = p.handoff, drive = snap.role === "drive";
  const button = (label, action, fields = {}) => h("button.btn", { type: "button", disabled: !drive, onclick: () => send(p.id, action, fields) }, label);
  if (!record) {
    if (p.handoffClosed) return null;
    const draft = drafts.get(p.id) || { scope: "", end: "report_once" };
    const keep = () => { if (drafts.size >= 100) drafts.delete(drafts.keys().next().value); drafts.set(p.id, draft); };
    return h("section.sw-part.sw-handoff", h("h4.sw-part-head", "Chief handoff"),
      h("p.sw-text", "One handoff per task. Review the draft before sending. Approvals stay with you."),
      h("label", "Scope", h("input", { type: "text", value: draft.scope, maxlength: 500, disabled: !drive, oninput: e => { draft.scope = e.target.value; keep(); } })),
      h("label", "End condition", h("select", { value: draft.end, disabled: !drive, onchange: e => { draft.end = e.target.value; keep(); } },
        h("option", { value: "report_once", selected: draft.end === "report_once" }, "Chief reports once"), h("option", { value: "task_closed", selected: draft.end === "task_closed" }, "Task closes (at most one report)"))),
      h("button.btn", { type: "button", disabled: !drive, onclick: () => send(p.id, "draft", { ...draft }) }, "Prepare draft"));
  }
  const origin = record.origin === "boss" ? "Boss on your behalf" : "User directly";
  return h("section.sw-part.sw-handoff", h("h4.sw-part-head", `Chief handoff · ${record.state}`),
    h("p.sw-text", `Origin: ${origin} · Target: ${record.target || "Chief"}`),
    h("p.sw-text", record.scope),
    h("p.sw-text", `Ends: ${record.end === "task_closed" ? "task closure; at most one report" : "Chief reports once"}. Approvals remain yours.`),
    record.state === "draft" && !p.handoffClosed ? button("Send this handoff to Chief", "send", { handoffId: record.id }) : null,
    record.state !== "closed" ? button("Close handoff", "close") : null,
    record.path?.startsWith("/dsh?") ? h("a", { href: record.path }, "Open Chief") : null,
    record.error ? h("p.sw-text", record.error) : null,
    record.report ? h("div", h("h4.sw-part-head", "Chief report to Boss · Information only"), h("p.sw-text", { style: "white-space:pre-wrap" }, record.report.text)) : null);
}
