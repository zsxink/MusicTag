// MusicTag — service 业务层（标签读写、封面编解码、原子写盘、侧载 .lrc、文件名改名、配置持久化）。
//
// 模块声明 `pub` 供 `src-tauri/tests/` 集成测试经 `app_lib::service::` 访问
// （design.md §10 分层规范：reader/writer/meta/cover/fs_atomic/lyrics/rename/config）。

pub mod config;
pub mod cover;
pub mod fs_atomic;
pub mod lyrics;
pub mod meta;
pub mod reader;
pub mod rename;
pub mod searcher;
pub mod writer;
