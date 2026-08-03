// Tauri command 契约类型（design.md §10，与 Rust model.rs struct 对齐）。
// Rust enum 映射：LyricsSource Embedded/SidecarLrc/None ↔ 'embedded'|'sidecar'|'none'
//                MusicSourceId Netease/QqMusic/Migu ↔ 'netease'|'qqmusic'|'migu'

/** 音乐来源 ID：网易云 / QQ / 咪咕 */
export type MusicSourceId = 'netease' | 'qqmusic' | 'migu'

/** 歌词来源：内嵌 / 同名单曲 lrc / 无 */
export type LyricsSource = 'embedded' | 'sidecar' | 'none'

/** 与 Rust Song struct 对齐（open_song 返回 / save_song 提交）。 */
export interface Song {
  path: string
  title: string
  artist: string
  album: string
  album_artist: string
  track: string
  track_total: string
  year: string
  genre: string
  lyrics: string
  lyrics_source: LyricsSource
  cover: string | null // base64 data URL（data:image/jpeg;base64,...）
  cover_mime: string | null
}

/** 列表轻量项（list_songs 返回；详情选中后再 open_song 读）。 */
export interface SongSummary {
  path: string
  title: string
  artist: string
}

/** 搜索候选（search_song 返回）。 */
export interface SongCandidate {
  source: MusicSourceId
  id: string
  title: string
  artist: string
  album: string
  cover_url: string | null
}

/** 三家聚合搜索结果。 */
export interface SearchResult {
  songs: SongCandidate[]
  source_stats: Array<[MusicSourceId, number]> // 各家返回条数
}
