// MusicTag — 搜索 command 薄壳（design.md §10 分层规范，v1-search-backend / v1-search-fixes）。
//
// 只做参数接收与对 `service::searcher` 委托，不含加密/HTTP/聚合逻辑：
// - `search_song(title, artist)` → 三源并发搜索 + 打分去重（候选秒出，歌词/封面惰性拉取）；
// - `search_source(source, title, artist)` → 单源搜索原始候选（C2 换源用，绕过聚合去重）；
// - `fetch_lyric(source, id)` → 点选歌词候选拉文本（None = 取词失败，前端换源 C2）；
// - `download_cover(url)` → 点选封面缩略图下载（5s 超时 + 12MB 限流）。
// 四个 command 均为 async：Tauri 在异步运行时执行，不阻塞 WebView 主线程（FR-8.12a）。

use crate::model::{MusicSourceId, SearchResult, SongCandidate};
use crate::service::searcher;

/// 三源并发搜索（`String, String → SearchResult`，契约 §10.3）。
#[tauri::command]
pub async fn search_song(title: String, artist: String) -> SearchResult {
    searcher::search_song(searcher::client(), &title, &artist).await
}

/// 单源搜索（`MusicSourceId, String, String → Vec<SongCandidate>`，契约 §10.3 v1-search-fixes）。
///
/// 不走跨源聚合去重：C2 换源需要「其他来源对同一首歌的候选」（聚合会把同曲多源折叠成一条，
/// 导致换源找不到其他源）；失败/超时 → 空列表，前端跳过该源。
#[tauri::command]
pub async fn search_source(source: MusicSourceId, title: String, artist: String) -> Vec<SongCandidate> {
    searcher::search_source(searcher::client(), source, &title, &artist).await
}

/// 点选歌词候选拉文本（`MusicSourceId, String → Option<String>`，契约 §10.3）。
#[tauri::command]
pub async fn fetch_lyric(source: MusicSourceId, id: String) -> Option<String> {
    searcher::fetch_lyric(searcher::client(), source, &id).await
}

/// 点选封面缩略图下载（`String → Vec<u8>`，契约 §10.3；mime 解析/压缩/转 data URL 在前端）。
#[tauri::command]
pub async fn download_cover(url: String) -> Result<Vec<u8>, String> {
    searcher::download_cover(searcher::client(), &url).await
}
