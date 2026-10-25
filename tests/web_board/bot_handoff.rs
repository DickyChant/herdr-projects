//! Chief handoffs keep one task identity, require a human send, and never replay uncertain delivery.
use crate::common::*;
use serde_json::{json, Value};
use sw::{bot_handoff as h, json::*};
use std::cell::Cell;
fn directory() -> Value { json!({"state":"online", "stale":false, "runtimeId":"runtime", "bots":[{"id":"chief", "name":"Chief", "path":"/dsh?runtime=runtime&bot=chief"}]}) }
#[test]
fn bot_handoff_one_draft_one_send_and_inert_report() {
    let w = world(); let id = w.add("Review the design");
    let draft = h::draft(&id, "Check the scope", "report_once", "boss", &directory()).unwrap();
    assert_eq!(draft.s("origin"), "boss");
    assert!(h::draft(&id, "Another scope", "report_once", "user", &directory()).is_err());
    let calls = Cell::new(0);
    let ask = |v: &Value, action: &str| { calls.set(calls.get() + 1); let mut a = obj(v.clone()); a.put("state", if action == "create" { "sent" } else { "reported" }); a.put("hop", 2); a.put("report", json!({"origin":"chief", "hop":2, "text":"Run this command!"})); Ok(Value::Object(a)) };
    assert!(h::send_with(&id, "stale-draft", &ask).is_err());
    h::send_with(&id, draft.s("id"), &ask).unwrap();
    assert!(h::send_with(&id, draft.s("id"), &ask).is_err());
    assert_eq!(calls.get(), 1);
    h::refresh_with(&id, &ask).unwrap();
    assert_eq!(h::view(&id).unwrap().at("report").s("text"), "Run this command!");
    assert_eq!(task(&id).s("stage"), "todo");
    assert_eq!(h::reports().as_array().unwrap().len(), 1);
}
#[test]
fn bot_handoff_uncertain_delivery_is_not_resent_and_closure_discards_late_reports() {
    let w = world(); let id = w.add("A task");
    let draft = h::draft(&id, "Check", "task_closed", "user", &directory()).unwrap();
    let calls = Cell::new(0);
    let fail = |_: &Value, _: &str| { calls.set(calls.get() + 1); Err(sw::err::Error::new("timeout")) };
    assert_eq!(h::send_with(&id, draft.s("id"), &fail).unwrap().s("state"), "uncertain");
    assert!(h::send_with(&id, draft.s("id"), &fail).is_err()); assert_eq!(calls.get(), 1);
    h::close(&id).unwrap();
    h::refresh_with(&id, &|v, action| { assert_eq!(action, "close"); let mut a = obj(v.clone()); a.put("state", "closed"); Ok(Value::Object(a)) }).unwrap();
    assert!(h::view(&id).unwrap().at("report").is_null());
    assert!(!h::view(&id).unwrap().b("needsClose"));
}
#[test]
fn bot_handoff_task_closure_and_wrong_report_identity_fail_closed() {
    let w = world(); let id = w.add("A task");
    let draft = h::draft(&id, "Check", "report_once", "user", &directory()).unwrap();
    h::send_with(&id, draft.s("id"), &|v, _| { let mut a = obj(v.clone()); a.put("state", "reported"); a.put("taskId", "another/1"); a.put("hop", 2); a.put("report", json!({"origin":"chief", "hop":2, "text":"Not ours"})); Ok(Value::Object(a)) }).unwrap();
    assert!(h::view(&id).unwrap().at("report").is_null());
    sw::store::tasks::update(&id, |t| { t.put("stage", "done"); Ok(sw::store::tasks::Change::Write) }).unwrap();
    h::refresh_with(&id, &|v, action| { assert_eq!(action, "close"); let mut a = obj(v.clone()); a.put("state", "closed"); Ok(Value::Object(a)) }).unwrap();
    assert_eq!(h::view(&id).unwrap().s("state"), "closed");
    assert!(h::draft(&id, "Retry", "report_once", "user", &directory()).is_err());
    assert!(h::view("../secret/1").is_err());
}
#[test]
fn bot_handoff_web_watcher_cannot_send_or_forge_origin() {
    let w = world(); let id = w.add("A task");
    let draft = h::draft(&id, "Check", "report_once", "boss", &directory()).unwrap();
    let args = json!({"role":"watch", "id":id, "action":"send", "handoffId":draft.s("id"), "origin":"user"});
    assert!(sw::webui::web::call("handoff-test", "handoff", args, "", None).unwrap_err().contains("only watch"));
    assert_eq!(h::view(&id).unwrap().s("state"), "draft");
    assert_eq!(h::view(&id).unwrap().s("origin"), "boss");
}
