// Tauri command 类型化封装（design.md §10 前端 api 层：组件零 invoke 直呼，IPC 全走此层）。
//
// 命令名、参数名、返回类型逐字对齐 Rust 契约（commands/folder.rs、commands/song.rs、
// model.rs）：pick_folder / list_songs / open_song / save_song。实现 = `invokeCommand` 透传，
// 组件与 store 一律经此层发 IPC（store 动作的 loader 注入 api/songs.ts 封装）。
import { invokeCommand } from './client'
import type { CoverInput, Song, SongSummary } from './types'

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

/** 保存当前编辑 = 表单全量覆盖写回原路径（语义在 Rust writer::save_song）。
 *  `exportLrc`（design.md D3）：复选框 opt-in 同步写同目录同名 `.lrc`（空歌词忽略）。 */
export function saveSong(song: Song, exportLrc: boolean): Promise<void> {
  return invokeCommand<void>('save_song', { song, exportLrc })
}

/** 改文件名（独立动作，FR-5.5）：音频 + 同名 `.lrc` 一并改名（语义在 Rust service::rename）。
 *  `newName` 经 Tauri camelCase↔snake_case 自动映射到 Rust 参数 `new_name`。
 *  撞名（音频/`.lrc` 目标已存在）→ reject「目标已存在」，原文件保留可重试。 */
export function renameSong(path: string, newName: string): Promise<void> {
  return invokeCommand<void>('rename_song', { path, newName })
}

/** 打开原生封面文件选择器（jpg/png/webp）。取消返回 null，否则返回压缩后 data URL + mime。 */
export function pickCoverFile(): Promise<CoverInput | null> {
  return invokeCommand<CoverInput | null>('pick_cover_file')
}

/** 读取拖拽路径的封面文件：读文件 → 压缩 → data URL。读失败/非图片 → reject（中文原因）。 */
export function readCoverPath(path: string): Promise<CoverInput> {
  return invokeCommand<CoverInput>('read_cover_path', { path })
}
