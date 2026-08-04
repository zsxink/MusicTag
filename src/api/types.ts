// Tauri command 契约类型（design.md §10，与 Rust model.rs struct 对齐）。
// Rust enum 映射：LyricsSource Embedded/SidecarLrc/None ↔ 'embedded'|'sidecar'|'none'
//                MusicSourceId Netease/QqMusic/Kugou/Lrclib/Itunes ↔ 'netease'|'qqmusic'|'kugou'|'lrclib'|'itunes'

/** 音乐来源 ID：网易云 / QQ / 酷狗 / LRCLIB / iTunes */
export type MusicSourceId = 'netease' | 'qqmusic' | 'kugou' | 'lrclib' | 'itunes'

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

/** 封面选择/拖拽输入（pick_cover_file / read_cover_path 返回，与 Rust CoverInput 对齐）。
 *  data_url 直接进 `Song.cover`（`<img :src>` 同形状，前端零转换）；mime 供 cover_mime 展示。 */
export interface CoverInput {
  data_url: string // base64 data URL（data:<mime>;base64,...，压缩后小图）
  mime: string // image/jpeg | image/png | image/webp
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

/** 五源聚合搜索结果。 */
export interface SearchResult {
  songs: SongCandidate[]
  source_stats: Array<[MusicSourceId, number]> // 各家返回条数
  /** 五源全部失败（网络错误/超时）→ true；至少一源成功（含正常空结果）→ false。前端仅在 true 时判定会话离线（FR-8.4a）。 */
  all_failed: boolean
}
