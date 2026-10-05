// MusicTag — 单目录递归监听；仅产生失效通知，不读取标签或修改列表。

use crate::model::FolderChanged;
use notify::{Config, EventKind, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

type NotifySink = Arc<dyn Fn(FolderChanged) + Send + Sync>;

struct ActiveWatch {
    alive: Arc<AtomicBool>,
    _watcher: Box<dyn Watcher + Send>,
}

impl Drop for ActiveWatch {
    fn drop(&mut self) {
        // watcher 的析构可能等待回调线程；回调不得锁住目标状态。
        self.alive.store(false, Ordering::Release);
    }
}

#[derive(Default)]
struct Target {
    watch_id: Option<u64>,
    active: Option<ActiveWatch>,
    closed: bool,
}

/// Tauri managed state；服务自身不依赖 Tauri。
#[derive(Default)]
pub struct FolderWatch {
    target: Mutex<Target>,
}

impl FolderWatch {
    pub fn watch<F>(&self, dir: Option<String>, watch_id: u64, notify: F) -> Result<(), String>
    where
        F: Fn(FolderChanged) + Send + Sync + 'static,
    {
        let mut target = self
            .target
            .lock()
            .map_err(|_| "目录监听状态不可用，请重新打开应用".to_string())?;
        if target.closed || target.watch_id.is_some_and(|latest| watch_id < latest) {
            return Ok(());
        }
        target.watch_id = Some(watch_id);
        // 失败也不保留旧目录；drop 首先禁用旧回调，然后释放平台资源。
        target.active.take();
        let Some(dir) = dir else { return Ok(()) };
        let sink: NotifySink = Arc::new(notify);
        target.active = Some(start_watch(&dir, watch_id, sink)?);
        Ok(())
    }

    /// 应用退出显式释放 AppHandle emitter、平台监听线程及所有旧回调。
    pub fn shutdown(&self) {
        let mut target = self.target.lock().unwrap_or_else(|err| err.into_inner());
        target.closed = true;
        target.active.take();
    }
}

/// Access（含读打开/关闭）不能触发列表补读，避免读取标签造成刷新循环。
pub fn notification(
    dir: &str,
    watch_id: u64,
    result: notify::Result<notify::Event>,
) -> Option<FolderChanged> {
    let error = match result {
        Ok(event) if matches!(event.kind, EventKind::Access(_)) => return None,
        Ok(_) => None,
        Err(error) => Some(format!("目录监听失败，请尝试刷新：{error}")),
    };
    Some(FolderChanged {
        dir: dir.to_owned(),
        watch_id,
        error,
    })
}

fn callback(
    dir: String,
    watch_id: u64,
    alive: Arc<AtomicBool>,
    sink: NotifySink,
) -> impl FnMut(notify::Result<notify::Event>) + Send + 'static {
    move |result| {
        if alive.load(Ordering::Acquire) {
            if let Some(event) = notification(&dir, watch_id, result) {
                sink(event);
            }
        }
    }
}

fn start_watch(dir: &str, watch_id: u64, sink: NotifySink) -> Result<ActiveWatch, String> {
    // PollWatcher 注册不存在的根目录也可能返回成功；提前拒绝这种伪成功。
    if !Path::new(dir).is_dir() {
        return Err("无法监听目录：目录不存在或不是文件夹，请尝试刷新".to_string());
    }
    let alive = Arc::new(AtomicBool::new(true));
    let native = RecommendedWatcher::new(
        callback(dir.to_owned(), watch_id, alive.clone(), sink.clone()),
        Config::default(),
    )
    .and_then(|mut watcher| {
        watcher.watch(Path::new(dir), RecursiveMode::Recursive)?;
        Ok(watcher)
    });
    match native {
        Ok(watcher) => Ok(ActiveWatch {
            alive,
            _watcher: Box::new(watcher),
        }),
        Err(native_error) => {
            // 原生注册失败可能留下在途回调；后备使用独立的活跃标记。
            alive.store(false, Ordering::Release);
            let alive = Arc::new(AtomicBool::new(true));
            // notify 8 的 PollWatcher::watch 即使初始遍历失败也返回 Ok，
            // 错误通过同步回调报告；将这些注册错误还原为 command 的 Err。
            let registering = Arc::new(AtomicBool::new(true));
            let registration_error = Arc::new(Mutex::new(None));
            let registering_for_callback = registering.clone();
            let error_for_callback = registration_error.clone();
            let mut handler = callback(dir.to_owned(), watch_id, alive.clone(), sink);
            let poll = PollWatcher::new(
                move |result: notify::Result<notify::Event>| {
                    if registering_for_callback.load(Ordering::Acquire) {
                        if let Err(error) = &result {
                            *error_for_callback
                                .lock()
                                .unwrap_or_else(|err| err.into_inner()) = Some(error.to_string());
                        }
                    }
                    handler(result);
                },
                Config::default()
                    .with_poll_interval(Duration::from_secs(1))
                    .with_compare_contents(false),
            )
            .and_then(|mut watcher| {
                watcher.watch(Path::new(dir), RecursiveMode::Recursive)?;
                registering.store(false, Ordering::Release);
                if let Some(error) = registration_error
                    .lock()
                    .unwrap_or_else(|err| err.into_inner())
                    .take()
                {
                    return Err(notify::Error::generic(&error));
                }
                Ok(watcher)
            });
            match poll {
                Ok(watcher) => Ok(ActiveWatch {
                    alive,
                    _watcher: Box::new(watcher),
                }),
                Err(poll_error) => {
                    alive.store(false, Ordering::Release);
                    Err(format!(
                        "无法监听目录，请尝试刷新：{native_error}；后备监听失败：{poll_error}"
                    ))
                }
            }
        }
    }
}
