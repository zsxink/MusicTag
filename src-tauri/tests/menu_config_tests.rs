use app_lib::service::config::{
    load_last_update_check_at, save_last_dir, save_last_update_check_at,
};
use std::fs;

#[test]
fn update_timestamp_missing_corrupt_future_and_valid_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    assert_eq!(
        load_last_update_check_at(&path, "2026-10-23T00:00:00Z"),
        None
    );
    fs::write(&path, "{").unwrap();
    assert_eq!(
        load_last_update_check_at(&path, "2026-10-23T00:00:00Z"),
        None
    );
    save_last_update_check_at(&path, "2026-10-24T00:00:00Z").unwrap();
    assert_eq!(
        load_last_update_check_at(&path, "2026-10-23T00:00:00Z"),
        None
    );
    assert_eq!(
        load_last_update_check_at(&path, "2026-10-24T00:00:00Z"),
        Some("2026-10-24T00:00:00Z".into())
    );
}

#[test]
fn timestamp_fraction_comparison_and_invalid_clock_fields() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    save_last_update_check_at(&path, "2026-10-23T12:00:00.000000001Z").unwrap();
    assert_eq!(
        load_last_update_check_at(&path, "2026-10-23T12:00:00Z"),
        None
    );
    assert_eq!(
        load_last_update_check_at(&path, "2026-10-23T12:00:00.000000001Z"),
        Some("2026-10-23T12:00:00.000000001Z".into())
    );
    for value in [
        "2026-10-23T-1:00:00Z",
        "2026-10-23T00:-1:00Z",
        "2026-10-23T00:00:-1Z",
        "2026-10-23T00:00:00.Z",
    ] {
        assert!(save_last_update_check_at(&path, value).is_err(), "{value}");
    }
}

#[test]
fn concurrent_config_field_writes_preserve_both_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let a = path.clone();
    let b = path.clone();
    let last_dir = std::thread::spawn(move || save_last_dir(&a, "/music"));
    let last_check =
        std::thread::spawn(move || save_last_update_check_at(&b, "2026-10-23T12:00:00Z"));
    last_dir.join().unwrap().unwrap();
    last_check.join().unwrap().unwrap();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(value["last_dir"], "/music");
    assert_eq!(value["last_update_check_at"], "2026-10-23T12:00:00Z");
}

#[test]
fn invalid_timestamp_does_not_change_existing_config() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    save_last_dir(&path, "/music").unwrap();
    save_last_update_check_at(&path, "2024-02-29T23:59:59.123456789Z").unwrap();
    let before = fs::read(&path).unwrap();
    for value in [
        "",
        "2023-02-29T00:00:00Z",
        "2026-04-31T00:00:00Z",
        "2026-10-23T24:00:00Z",
        "2026-10-23T00:60:00Z",
        "2026-10-23T00:00:60Z",
        "2026-10-23T00:00:00+00:00",
        "2026-10-23T00:00:00.1234567890Z",
    ] {
        assert!(
            save_last_update_check_at(&path, value).is_err(),
            "{value:?}"
        );
        assert_eq!(fs::read(&path).unwrap(), before, "{value:?}");
    }
    // A parent that is a regular file deterministically forces an IO error,
    // including under elevated permissions where read-only mode is unreliable.
    let blocker = dir.path().join("not-a-directory");
    fs::write(&blocker, b"unchanged").unwrap();
    assert!(
        save_last_update_check_at(&blocker.join("config.json"), "2026-10-23T00:00:00Z").is_err()
    );
    assert_eq!(fs::read(&blocker).unwrap(), b"unchanged");
}

#[test]
fn legacy_config_and_invalid_now_are_safe_to_load() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    fs::write(&path, r#"{"last_dir":"/music"}"#).unwrap();
    assert_eq!(
        load_last_update_check_at(&path, "2026-10-23T00:00:00Z"),
        None
    );
    save_last_update_check_at(&path, "2026-10-23T00:00:00Z").unwrap();
    assert_eq!(load_last_update_check_at(&path, "invalid-now"), None);
    save_last_dir(&path, "/other-music").unwrap();
    assert_eq!(
        load_last_update_check_at(&path, "2026-10-23T00:00:00Z"),
        Some("2026-10-23T00:00:00Z".into())
    );
}

#[test]
fn timestamp_writes_preserve_last_dir_and_failure_is_reported() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested/config.json");
    save_last_dir(&path, "/music").unwrap();
    save_last_update_check_at(&path, "2026-10-23T12:00:00Z").unwrap();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(value["last_dir"], "/music");
    assert_eq!(value["last_update_check_at"], "2026-10-23T12:00:00Z");
    assert!(
        save_last_update_check_at(&dir.path().join("missing-parent/config.json"), "bad").is_err()
    );
    assert!(save_last_update_check_at(&path, "2026-02-30T00:00:00Z").is_err());
}
