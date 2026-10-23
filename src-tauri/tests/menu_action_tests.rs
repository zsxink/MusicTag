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
