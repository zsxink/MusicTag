## Context

`v1-song-read` 已定义 `lyrics_source` 枚举与内嵌判定（Embedded / None），`v1-song-save` 已实现内嵌歌词写回。本变更补全 `.lrc` 侧载关联读、复选框同步写 `.lrc`、来源 badge UI。

## Goals / Non-Goals

**Goals:**
- 读取：内嵌优先 → 侧载 `.lrc` 关联 → None，badge 展示来源。
- 保存：复选框 opt-in 同步写同目录同名 `.lrc`；空歌词不写。
- 内嵌 + `.lrc` 并存时两边同步更新。

**Non-Goals:**
- 不做结构化歌词（SYLT/逐字时间轴）。
- 不做音频 + `.lrc` 改名同步（`v1-rename-sync`）。

## Decisions

- **侧载路径**：`Path::with_extension("lrc")` 同目录同名（音频去扩展名）。读取时：内嵌非空 → Embedded；否则若 `.lrc` 存在 → SidecarLrc 读其文本；否则 None。此判定增强 `v1-song-read` 的 `lyrics_source`。
- **`.lrc` 文件命名**：音频文件去扩展名同名、同目录（PRD §5.4）。
- **写 `.lrc`**：`save_song` 中歌词写回逻辑扩展——若勾选 `exportLrc` 且歌词非空 → 写 `.lrc`；歌词为空则忽略复选框不生成空文件（FR-4.4a）。复选框状态作为 `Song` 外的保存参数传入（不污染 tag 结构），或放 `Song.export_lrc` 标志。
- **并存同步**：内嵌与 `.lrc` 都写当前歌词文本（FR-4.5）。
- **badge 文案**：`来源: 内嵌标签` / `来源: 侧载 .lrc` / `来源: 无`（design.md §6.1 歌词 badge 胶囊样式）。
- **UI**：`LyricPanel` head 行 = 来源 badge + 「同时保存为 .lrc」复选框；下方 textarea 等宽 mono（12.5px）。

## Risks / Trade-offs

- `.lrc` 同步写盘是文件 I/O：写失败需并入保存失败处理（同 `save_song` 的 Err 语义），不能只写内嵌成功而 `.lrc` 失败却报成功。
- 侧载读取跨 IPC：`lyrics_source=SidecarLrc` 时 `lyrics` 字段直接放 `.lrc` 文本，保存时内嵌写回也用它——注意侧载来源保存后是否仍算侧载，需按「保存以当前编辑内容为准」覆盖两边。
