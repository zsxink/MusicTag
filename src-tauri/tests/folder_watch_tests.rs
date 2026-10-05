use app_lib::model::FolderChanged;
use app_lib::service::folder_watch::notification;
use notify::event::{AccessKind, AccessMode, CreateKind, ModifyKind, RemoveKind, RenameMode};
use notify::{Event, EventKind};

#[test]
fn reads_never_invalidate_the_folder() {
    for kind in [
        AccessKind::Any,
        AccessKind::Read,
        AccessKind::Open(AccessMode::Read),
        AccessKind::Close(AccessMode::Read),
        AccessKind::Other,
    ] {
        assert!(notification("/music", 7, Ok(Event::new(EventKind::Access(kind)))).is_none());
    }
}

#[test]
fn directories_missing_paths_and_atomic_replacements_invalidate() {
    for kind in [
        EventKind::Any,
        EventKind::Other,
        EventKind::Create(CreateKind::Folder),
        EventKind::Create(CreateKind::File),
        EventKind::Remove(RemoveKind::Folder),
        EventKind::Remove(RemoveKind::File),
        EventKind::Modify(ModifyKind::Any),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
    ] {
        // 没有 path、已消失的 path 或非音频目录均不能被后缀过滤掉。
        let event = notification("/music", 7, Ok(Event::new(kind))).unwrap();
        assert_eq!(event.dir, "/music");
        assert_eq!(event.watch_id, 7);
        assert_eq!(event.error, None);
    }
}

#[test]
fn runtime_error_notifies_with_the_bound_generation() {
    let event = notification("original directory", 9, Err(notify::Error::generic("test")))
        .expect("监听失败同样触发补读");
    assert_eq!(event.dir, "original directory");
    assert_eq!(event.watch_id, 9);
    assert!(event.error.unwrap().contains("目录监听失败"));
}

#[test]
fn event_serialization_matches_the_frontend_contract() {
    let event = FolderChanged {
        dir: "/music".into(),
        watch_id: 42,
        error: None,
    };
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        serde_json::json!({ "dir": "/music", "watchId": 42, "error": null })
    );
}

#[test]
fn main_window_can_subscribe_and_unsubscribe_from_folder_events() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json");
    let capability: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();

    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    let permissions = capability["permissions"].as_array().unwrap();
    let granted: std::collections::BTreeSet<_> = permissions
        .iter()
        .map(|permission| permission.as_str().unwrap())
        .collect();
    assert_eq!(permissions.len(), 2);
    assert_eq!(
        granted,
        std::collections::BTreeSet::from(["core:event:allow-listen", "core:event:allow-unlisten",])
    );
}
