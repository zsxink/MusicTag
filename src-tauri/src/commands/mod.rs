// MusicTag — Tauri command 薄层（design.md §10 分层规范）。
//
// 薄壳只做参数接收与对 service 层委托；lofty/IO/编解码业务逻辑一律在
// `service/` 层。模块声明 `pub` 供 `src-tauri/tests/` 集成测试经 `app_lib::commands::` 访问。

pub mod cover;
pub mod folder;
pub mod search;
pub mod song;
