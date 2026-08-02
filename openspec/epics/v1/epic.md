# Epic: v1 — MusicTag V1 全产品实施

> 本文件是人类可读的 Epic 状态；机器真相源为同目录 `epic.json`（受版本控制，可跨机器恢复）。

## 总 PRD

- **来源**：`docs/V1-PRD.md`（定稿规格）+ `docs/design/design.md`（技术设计）
- **定位**：工具线 · 自用 · 一次一首给本地裸 FLAC/MP3 补全元数据（歌名/作者/专辑/封面/歌词）
- **技术栈**：Tauri 2 + Rust（lofty 标签 / walkdir 遍历 / rfd 对话框 / reqwest 搜索 / aes+cbc+rsa 网易云加密）+ Vue 3 + Vite + TS
- **验收标准**：V1-PRD §8（1–13 条）
- **里程碑参考**：V1-PRD §9 M1–M7

## 拆分方案（用户批准于 2026-08-02，总 PRD 唯一确认点）

| # | name | 域 | dependsOn | slice 来源 |
|---|---|---|---|---|
| 1 | `v1-skeleton-tauri` | both | — | FR-1 前置 · §10.1/§7 |
| 2 | `v1-folder-list` | both | 1 | FR-1.1–5 / FR-2 / §10.3 |
| 3 | `v1-song-read` | both | 2 | FR-3 / FR-2a / FR-5.1/5.7 |
| 4 | `v1-song-save` | both | 3 | FR-5 / FR-3.2 / §5.1/.2 / §10.3 |
| 5 | `v1-cover-embed` | both | 4 | FR-3.5 / FR-5.2 / §5.3 / NFR |
| 6 | `v1-lyrics-lrc` | both | 4 | FR-4 / §5.4 / §6.5 |
| 7 | `v1-rename-sync` | both | 5+6 | FR-4.6/6a/7 · FR-5.5/6 · §7 |
| 8 | `v1-ux-settings` | both | 4 | FR-6 / FR-7 / §2-8 |
| 9 | `v1-search-backend` | backend | 3+5 | FR-8.5/6/8a · §7 |
| 10 | `v1-search-ui` | frontend | 9+6+5 | FR-8 / §9 / §6.3-6.6 |

**串行执行顺序**：1→2→3→4→(5/6)→7→8→9→10

**拆分要点**：
- 每子项 = 一个 openspec change = 一个分支 = 一个 PR，粒度 = 可独立 CR + 可独立验收 + 可独立合并的最小单元。
- 共同契约落依赖最前的子项：#1 落 Tauri 壳 + invoke 封装 seed；#2 落 `SongSummary{path,title,artist}` + `list_songs`；#3 落完整 `Song`（含 lyrics_source/cover base64）+ store `current/original/dirty`。后续只增补，无重复实现。
- #9 为纯 backend、#10 为纯 frontend，Rust→Vue 边界清晰可独立合并。
- 变更域判定：仅 #9 backend、#10 frontend，其余 both（Rust command 先行 → Vue 前端接入串行）。

## 确认记录

- **2026-08-02**：`/pipe:init` 展示 10 项子变更清单，用户选择「确认，按此拆分」。总 PRD 批准，`prdConfirmed=true`，`status=ready`。
- `sourceRevision` = 批准时 main 的 commit：`5b758b4`。

## Artifact 校验结果

全部 10 个子变更已生成完整 OpenSpec artifacts（proposal / specs / design / tasks）并通过 `openspec validate --all --strict`（10 passed, 0 failed）：

- `v1-skeleton-tauri`: specs/capability `app-shell`
- `v1-folder-list`: specs/capability `folder-list`
- `v1-song-read`: specs/capability `song-open`
- `v1-song-save`: specs/capability `song-save`
- `v1-cover-embed`: specs/capability `cover-embed`
- `v1-lyrics-lrc`: specs/capability `lyrics-lrc`
- `v1-rename-sync`: specs/capability `rename-sync`
- `v1-ux-settings`: specs/capability `ux-settings`
- `v1-search-backend`: specs/capability `search-sources`
- `v1-search-ui`: specs/capability `search-ui`

## 断点与续跑

- `cursor` 指向下一个待实施子变更索引（见 `epic.json`）。
- 每个子变更完成后，更新 `epic.json` 该 item 的 `status`/`implementationCommit` 并推进 `cursor`，提交后即可续跑。
- 中断可在任意子变更后恢复：`/pipe:epic v1` 从 `cursor` 继续。
