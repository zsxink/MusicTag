// Tauri command 类型化封装（design.md §10 前端 api 层：组件零 invoke 直呼，IPC 全走此层）。
//
// v1-search-backend 搜索契约（commands/search.rs、model.rs）：search_song / fetch_lyric /
// download_cover。实现 = `invokeCommand` 透传（同 songs.ts 模式），候选生命周期
// （选中即搜、切歌即弃、离线、C2、静默忽略）逻辑在 store/song.ts，不在 api 层。
import { invokeCommand } from './client'
import type { MusicSourceId, SearchResult } from './types'

/** 三源并发搜索（标题 + 作者 → 打分去重候选；空 title 由后端守卫过滤 → 空态）。 */
export function searchSongs(title: string, artist: string): Promise<SearchResult> {
  return invokeCommand<SearchResult>('search_song', { title, artist })
}

/** 点选歌词候选拉文本（`MusicSourceId, String → Option<String>`；None = 取词失败，供 C2 换源）。 */
export function fetchLyric(source: MusicSourceId, id: string): Promise<string | null> {
  return invokeCommand<string | null>('fetch_lyric', { source, id })
}

/** 点选封面候选下载缩略图（`String → Vec<u8>`；返回裸 bytes，mime 嗅探/压缩/转 data URL 在前端 lib/cover.ts）。 */
export function downloadCover(url: string): Promise<number[]> {
  return invokeCommand<number[]>('download_cover', { url })
}
