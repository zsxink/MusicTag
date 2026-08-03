// Tauri command 类型化封装（design.md §10 前端 api 层：组件零 invoke 直呼，IPC 全走此层）。
//
// 命令名、参数名、返回类型逐字对齐 Rust 契约（commands/folder.rs、commands/song.rs、
// model.rs）：pick_folder / list_songs / open_song / save_song。实现 = `invokeCommand` 透传，
// 组件与 store 一律经此层发 IPC（store 动作的 loader 注入 api/songs.ts 封装）。
import { invokeCommand } from './client'
import type { Song, SongSummary } from './types'

/** 打开原生文件夹选择器。取消返回 null，否则返回目录绝对路径。 */
export function pickFolder(): Promise<string | null> {
  return invokeCommand<string | null>('pick_folder')
}

/** 深度遍历 `dir` 收集全部 FLAC/MP3，返回只读列表项。 */
export function listSongs(dir: string): Promise<SongSummary[]> {
  return invokeCommand<SongSummary[]>('list_songs', { dir })
}

/** 读取单曲完整标签（选中歌曲即调；坏标签 → reject，前端只读）。 */
export function openSong(path: string): Promise<Song> {
  return invokeCommand<Song>('open_song', { path })
}

/** 保存当前编辑 = 表单全量覆盖写回原路径（语义在 Rust writer::save_song）。 */
export function saveSong(song: Song): Promise<void> {
  return invokeCommand<void>('save_song', { song })
}
