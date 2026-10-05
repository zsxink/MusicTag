mod common;

use app_lib::commands::folder::list_songs;
use app_lib::model::FolderChanged;
use app_lib::service::folder_watch::FolderWatch;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};
use tempfile::TempDir;

fn fixture() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    common::write_tagged_flac(dir.path(), "fixture.flac", "Fixture", "Artist");
    let path = dir.path().join("fixture.flac");
    assert!(path.is_file(), "fixture 早检：音频必须存在");
    let song = app_lib::service::reader::read_song_meta(&path)
        .expect("fixture 早检：既有 reader 必须能读取音频");
    assert_eq!(song.title, "Fixture", "fixture 早检：标题必须可读");
    (dir, path)
}

fn watch(service: &FolderWatch, dir: Option<&Path>, id: u64, tx: &Sender<FolderChanged>) {
    let tx = tx.clone();
    service
        .watch(
            dir.map(|path| path.to_string_lossy().into_owned()),
            id,
            move |event| {
                let _ = tx.send(event);
            },
        )
        .unwrap();
}

fn wait_changed(rx: &Receiver<FolderChanged>, dir: &Path, id: u64) {
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("有界等待目录变动通知失败");
        if event.watch_id == id && event.dir == dir.to_string_lossy() {
            assert_eq!(event.error, None, "真实目录监听不应报错");
            return;
        }
        assert!(Instant::now() < deadline, "通知 generation 不匹配");
    }
}

fn drain(rx: &Receiver<FolderChanged>) {
    // 平台可能把一个写操作拆成多个事件；有限窗口内排空旧操作的通知。
    let deadline = Instant::now() + Duration::from_secs(1);
    while Instant::now() < deadline {
        if rx.recv_timeout(Duration::from_millis(200)).is_err() {
            break;
        }
    }
}

fn paths(dir: &Path) -> BTreeSet<String> {
    list_songs(dir.to_string_lossy().into_owned())
        .into_iter()
        .map(|song| song.path)
        .collect()
}

#[test]
fn real_recursive_changes_trigger_real_list_rereads() {
    let (_fixture_dir, audio) = fixture();
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let service = FolderWatch::default();
    let (tx, rx) = mpsc::channel();
    watch(&service, Some(root.path()), 1, &tx);

    let first = root.path().join("new.flac");
    fs::copy(&audio, &first).unwrap();
    wait_changed(&rx, root.path(), 1);
    assert_eq!(
        paths(root.path()),
        BTreeSet::from([first.to_string_lossy().into_owned()])
    );

    drain(&rx);
    let deep = root.path().join("new/deep");
    fs::create_dir_all(&deep).unwrap();
    let descendant = deep.join("child.flac");
    fs::copy(&audio, &descendant).unwrap();
    wait_changed(&rx, root.path(), 1);
    assert!(paths(root.path()).contains(&descendant.to_string_lossy().into_owned()));

    drain(&rx);
    let renamed = deep.join("renamed.flac");
    fs::rename(&descendant, &renamed).unwrap();
    wait_changed(&rx, root.path(), 1);
    let listed = paths(root.path());
    assert!(listed.contains(&renamed.to_string_lossy().into_owned()));
    assert!(!listed.contains(&descendant.to_string_lossy().into_owned()));

    drain(&rx);
    fs::remove_file(&renamed).unwrap();
    wait_changed(&rx, root.path(), 1);
    assert!(!paths(root.path()).contains(&renamed.to_string_lossy().into_owned()));

    let incoming = outside.path().join("album");
    fs::create_dir(&incoming).unwrap();
    fs::copy(&audio, incoming.join("moved.flac")).unwrap();
    drain(&rx);
    let moved = root.path().join("album");
    fs::rename(&incoming, &moved).unwrap();
    wait_changed(&rx, root.path(), 1);
    assert!(paths(root.path()).contains(&moved.join("moved.flac").to_string_lossy().into_owned()));

    drain(&rx);
    let relocated = root.path().join("renamed-album");
    fs::rename(&moved, &relocated).unwrap();
    wait_changed(&rx, root.path(), 1);
    assert!(
        paths(root.path()).contains(&relocated.join("moved.flac").to_string_lossy().into_owned())
    );

    drain(&rx);
    fs::rename(&relocated, outside.path().join("outgoing")).unwrap();
    wait_changed(&rx, root.path(), 1);
    assert_eq!(
        paths(root.path()),
        BTreeSet::from([first.to_string_lossy().into_owned()])
    );
}

#[test]
fn switching_and_stopping_reject_late_requests_and_release_the_old_target() {
    let (_fixture_dir, audio) = fixture();
    let a = TempDir::new().unwrap();
    let b = TempDir::new().unwrap();
    let service = FolderWatch::default();
    let (tx, rx) = mpsc::channel();
    watch(&service, Some(a.path()), 10, &tx);
    watch(&service, Some(b.path()), 11, &tx);
    watch(&service, Some(a.path()), 10, &tx);
    watch(&service, None, 9, &tx);
    drain(&rx);
    fs::copy(&audio, a.path().join("old.flac")).unwrap();
    assert!(
        rx.recv_timeout(Duration::from_millis(400)).is_err(),
        "旧目录已释放"
    );
    fs::copy(&audio, b.path().join("current.flac")).unwrap();
    wait_changed(&rx, b.path(), 11);

    watch(&service, None, 12, &tx);
    watch(&service, Some(a.path()), 11, &tx);
    drain(&rx);
    fs::copy(&audio, b.path().join("stopped.flac")).unwrap();
    fs::copy(&audio, a.path().join("late.flac")).unwrap();
    assert!(
        rx.recv_timeout(Duration::from_millis(400)).is_err(),
        "停止后迟到请求不能重建监听"
    );
}

#[test]
fn failed_replacement_invalidates_old_target_and_allows_newer_retry() {
    let (_fixture_dir, audio) = fixture();
    let root = TempDir::new().unwrap();
    let service = FolderWatch::default();
    let (tx, rx) = mpsc::channel();
    watch(&service, Some(root.path()), 1, &tx);
    let missing = root.path().join("missing");
    let error = service
        .watch(Some(missing.to_string_lossy().into_owned()), 2, |_| {})
        .unwrap_err();
    assert!(error.contains("目录不存在"));
    watch(&service, Some(root.path()), 1, &tx);
    drain(&rx);
    fs::copy(&audio, root.path().join("unwatched.flac")).unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(400)).is_err());

    watch(&service, Some(root.path()), 3, &tx);
    fs::copy(&audio, root.path().join("retried.flac")).unwrap();
    wait_changed(&rx, root.path(), 3);
    service.shutdown();
    watch(&service, Some(root.path()), 4, &tx);
    drain(&rx);
    fs::copy(&audio, root.path().join("after-exit.flac")).unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(400)).is_err());
}
