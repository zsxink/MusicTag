## Why

歌词是 V1 的核心字段之一。除内嵌（FLAC→LYRICS / MP3→USLT lang=eng）读写外，还需支持：读取时内嵌优先、无内嵌自动关联同目录同名 `.lrc`（侧载）；保存时复选框 opt-in 同步写 `.lrc`（空歌词不写）；内嵌 + `.lrc` 并存时两边一起更新。这些是纯应用层逻辑，从 `v1-song-save` 的字段写回解耦。

## What Changes

- 读取（增强 `v1-song-read` 的 `lyrics_source` 判定）：内嵌优先 → Embedded；无内嵌时检测同目录同名 `.lrc` → SidecarLrc；两者都无 → None。歌词文本取对应来源内容。
- 保存：勾选「同时保存为 .lrc」复选框 → 保存歌词时**同步写同目录同名 `.lrc`** 文件；复选框默认不勾选（`.lrc` 导出是显式 opt-in）；**歌词为空时忽略复选框，不生成空 `.lrc`**。
- 内嵌 + `.lrc` 并存时：保存以当前编辑内容为准，两边一起更新。
- 歌词区 UI：来源 badge（「来源: 内嵌标签 / 侧载 .lrc / 无」）+ 复选框 + 等宽 mono textarea。

## Capabilities

### New Capabilities
- `lyrics-lrc`: 歌词内嵌读写 + 侧载 `.lrc` 关联 + 复选框 opt-in 同步写 `.lrc` + 来源 badge

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#11`（变更前已建，作为本变更锚点；分支提交 `feat(11): ...`、PR `Closes #11`）

## Impact

- 复用 `v1-song-save` 的内嵌歌词写回通道（FLAC LYRICS / MP3 USLT）。
- `.lrc` 侧载关联、内嵌 vs 侧载来源判定、同步写 `.lrc` 均由应用层处理（lofty 只报内嵌字段、无 rename API）。
- 音频 + `.lrc` 一并改名属 `v1-rename-sync`，本变更只建立 `.lrc` 文件读写语义与命名约定（去扩展名同名同目录）。
