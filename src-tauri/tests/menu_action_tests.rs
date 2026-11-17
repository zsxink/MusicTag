use app_lib::{
    action_for_menu_id,
    commands::menu::{known_action, MenuStateSnapshot, ACTION_IDS},
    help_menu_action_ids, menu_item_enabled,
};

#[test]
fn initial_menu_state_matches_constructed_menu_enabled_values() {
    let state = app_lib::MenuState::default();
    for id in [
        "open-folder",
        "close-window",
        "quit",
        "undo",
        "redo",
        "cut",
        "copy",
        "paste",
        "select-all",
        "toggle-theme",
        "reload",
        "toggle-devtools",
        "check-for-update",
    ] {
        assert!(state.is_enabled(id), "{id} should start enabled");
    }
    for id in ["save", "rescan-folder", "show-about"] {
        assert!(!state.is_enabled(id), "{id} should start disabled");
    }
}

#[test]
fn menu_actions_are_stable_and_allowlisted() {
    for id in [
        "open-folder",
        "save",
        "rescan-folder",
        "close-window",
        "quit",
        "toggle-theme",
        "reload",
        "toggle-devtools",
        "check-for-update",
        "show-about",
    ] {
        assert_eq!(action_for_menu_id(id), Some(id));
    }
    assert_eq!(action_for_menu_id("unknown"), None);
    assert!(known_action("show-about"));
    assert!(!known_action("unknown"));
    assert_eq!(ACTION_IDS.len(), 16);
    for id in ["about", "services", "hide", "macos-quit"] {
        assert!(!known_action(id));
        assert_eq!(action_for_menu_id(id), None);
    }
}

#[test]
fn default_state_snapshot_is_complete_and_detached() {
    let state = app_lib::MenuState::default();
    let mut snapshot = state.snapshot();
    let ids: std::collections::HashSet<_> = ACTION_IDS.iter().copied().collect();
    assert_eq!(ids.len(), ACTION_IDS.len(), "action IDs must be unique");
    assert_eq!(snapshot.len(), ids.len());
    for id in ids {
        assert!(snapshot.contains_key(id), "missing default state for {id}");
        assert_eq!(snapshot[id], state.is_enabled(id));
        assert!(known_action(id));
    }
    snapshot.insert("save".into(), true);
    snapshot.clear();
    assert!(!state.is_enabled("save"));
    assert!(state.is_enabled("open-folder"));
    assert_eq!(state.snapshot().len(), ACTION_IDS.len());
}

#[test]
fn unknown_and_native_only_menu_ids_fail_closed() {
    let state = app_lib::MenuState::default();
    for id in [
        "",
        "unknown",
        "SAVE",
        " save",
        "save ",
        "about",
        "services",
        "hide",
        "macos-quit",
    ] {
        assert!(!known_action(id), "{id:?}");
        assert_eq!(action_for_menu_id(id), None, "{id:?}");
        assert!(!state.is_enabled(id), "{id:?}");
    }
    for id in ["undo", "redo", "cut", "copy", "paste", "select-all"] {
        assert!(known_action(id));
        assert_eq!(
            action_for_menu_id(id),
            None,
            "native edit actions must not be dispatched twice"
        );
    }
}

#[test]
fn about_uses_custom_id_and_starts_eula_gated() {
    assert_eq!(action_for_menu_id("show-about"), Some("show-about"));
    assert_eq!(action_for_menu_id("macos-about"), Some("show-about"));
    assert_eq!(action_for_menu_id("about"), None);
    assert!(!app_lib::MenuState::default().is_enabled("show-about"));
}

#[test]
fn menu_layout_keeps_about_in_help_and_macos_app_menu() {
    assert_eq!(help_menu_action_ids(), ["check-for-update", "show-about"]);
}

#[test]
fn menu_item_enabled_requires_enabled_and_visible() {
    assert!(!menu_item_enabled(false, true));
    assert!(!menu_item_enabled(true, false));
    assert!(menu_item_enabled(true, true));
}

#[test]
fn poisoned_menu_lock_recovers_last_state_instead_of_defaulting() {
    use std::collections::HashMap;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::Mutex;

    // 与默认状态不同的 map：默认 open-folder=true/save=false，这里正好相反。
    let mut expected: HashMap<String, bool> = HashMap::new();
    for id in ACTION_IDS {
        expected.insert((*id).to_string(), true);
    }
    expected.insert("save".to_string(), true);
    expected.insert("open-folder".to_string(), false);
    assert_eq!(expected.len(), ACTION_IDS.len());

    let mutex = Mutex::new(expected.clone());
    let poisoned = catch_unwind(AssertUnwindSafe(|| {
        let _guard = mutex.lock().expect("fresh mutex must lock");
        panic!("poison menu state lock");
    }));
    assert!(poisoned.is_err(), "the poison panic must be caught");
    assert!(mutex.is_poisoned(), "holding a panic must poison the lock");

    let state = app_lib::MenuState::from_mutex(mutex);
    let (save_enabled, open_folder_enabled, snapshot) = catch_unwind(AssertUnwindSafe(|| {
        (
            state.is_enabled("save"),
            state.is_enabled("open-folder"),
            state.snapshot(),
        )
    }))
    .expect("reading a poisoned menu state must not panic");

    assert!(save_enabled, "poisoned lock must recover save=true");
    assert!(
        !open_folder_enabled,
        "poisoned lock must recover open-folder=false"
    );
    assert_eq!(snapshot.len(), ACTION_IDS.len());
    for id in ACTION_IDS {
        assert_eq!(
            snapshot.get(*id).copied(),
            Some(expected[*id]),
            "poisoned snapshot lost state for {id}"
        );
    }
    assert_eq!(
        snapshot, expected,
        "poisoned snapshot must equal the last visible map"
    );
    assert!(
        !snapshot.is_empty(),
        "poisoned lock must not fall back to an empty snapshot"
    );
    assert_ne!(
        snapshot,
        app_lib::MenuState::default().snapshot(),
        "poisoned lock must not fall back to the default state"
    );
}

#[test]
fn snapshot_ipc_requires_explicit_enabled_and_visible_fields() {
    for enabled in [false, true] {
        for visible in [false, true] {
            let snapshot: MenuStateSnapshot = serde_json::from_value(serde_json::json!({
                "items": [{ "id": "save", "enabled": enabled, "visible": visible }]
            }))
            .unwrap();
            assert_eq!(snapshot.items[0].id, "save");
            assert_eq!(snapshot.items[0].enabled, enabled);
            assert_eq!(snapshot.items[0].visible, visible);
        }
    }
    for value in [
        serde_json::json!({}),
        serde_json::json!({ "items": null }),
        serde_json::json!({ "items": [{ "id": "save", "enabled": true }] }),
        serde_json::json!({ "items": [{ "id": "save", "visible": true }] }),
        serde_json::json!({ "items": [{ "id": "save", "enabled": "true", "visible": true }] }),
    ] {
        assert!(
            serde_json::from_value::<MenuStateSnapshot>(value.clone()).is_err(),
            "{value}"
        );
    }
    let empty: MenuStateSnapshot =
        serde_json::from_value(serde_json::json!({ "items": [] })).unwrap();
    assert!(empty.items.is_empty());
}
