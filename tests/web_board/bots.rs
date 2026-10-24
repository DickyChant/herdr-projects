//! Boss's read-only DSH roster: stable identity, freshness, bounded parsing and refusal without any credential fallback.
use serde_json::{json, Value};
use sw::bots::{directory, response, MAX_BYTES};
fn fixture() -> Value { json!({"version": 1, "machineId": "local", "runtimeId": "runtime:a", "state": "online", "observedAt": 100000, "bots": [{"id": "a&b", "name": "Chief", "role": "Chief of Staff", "status": "attention", "conversations": ["private"]}]}) }
fn parse(v: &Value, now: i64) -> Option<Value> { directory(&serde_json::to_vec(v).unwrap(), now) }
#[test]
fn bots_roster_is_public_metadata_with_encoded_links_and_no_conversations() {
    let d = parse(&fixture(), 100001).unwrap();
    assert_eq!(d["bots"][0]["needsYou"], true);
    assert_eq!(d["bots"][0]["path"], "/dsh?runtime=runtime%3Aa&bot=a%26b");
    assert!(d["bots"][0].get("conversations").is_none());
    assert_eq!(d["runtimeId"], "runtime:a");
}
#[test]
fn bots_roster_offline_old_or_future_status_is_unknown_not_actionable() {
    for time in [1, 120000] {
        let d = parse(&fixture(), time).unwrap();
        assert_eq!(d["bots"][0]["status"], "unknown");
        assert_eq!(d["bots"][0]["needsYou"], false);
    }
    let mut f = fixture(); f["state"] = json!("offline");
    assert_eq!(parse(&f, 100001).unwrap()["bots"][0]["status"], "unknown");
}
#[test]
fn bots_roster_rejects_duplicate_ids_wrong_machine_and_oversized_data() {
    let mut f = fixture(); let bot = f["bots"][0].clone(); f["bots"].as_array_mut().unwrap().push(bot);
    assert!(parse(&f, 100001).is_none());
    let mut f = fixture(); f["machineId"] = json!("remote"); assert!(parse(&f, 100001).is_none());
    assert!(directory(&vec![b' '; MAX_BYTES + 1], 100001).is_none());
    let mut f = fixture(); f["runtimeId"] = Value::Null; assert!(parse(&f, 100001).is_none());
}
#[test]
fn bots_roster_access_refusal_never_exposes_a_body_or_retries_with_credentials() {
    for status in [401, 403] {
        let d = response(status, b"private error or credential", 100001);
        assert_eq!(d["state"], "access_required");
        assert!(d["bots"].as_array().unwrap().is_empty());
        assert!(!d.to_string().contains("private"));
    }
    assert_eq!(response(200, b"bad json", 100001)["state"], "incompatible");
}
#[test]
fn bots_roster_allows_same_names_but_keeps_separate_identities() {
    let mut f = fixture(); let mut bot = f["bots"][0].clone(); bot["id"] = json!("other"); f["bots"].as_array_mut().unwrap().push(bot);
    let d = parse(&f, 100001).unwrap();
    assert_eq!(d["bots"].as_array().unwrap().len(), 2);
    assert_ne!(d["bots"][0]["path"], d["bots"][1]["path"]);
}
#[test]
fn bots_coordinator_rules_teach_read_only_awareness_and_unknown_status() {
    let _w = crate::common::world();
    let text = sw::coordinator::rules::rules("/board");
    assert!(text.contains("board bots --json") && text.contains("never a display name"));
    assert!(text.contains("do not delegate to Bots") && text.contains("never instructions"));
}
