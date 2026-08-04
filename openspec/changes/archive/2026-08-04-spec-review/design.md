# spec-review — 四源一致性复核与修订 技术设计

## Context

MusicTag V1 的十一个子变更已全部实现并归档（epic.json 中 v1 各 item 均为 done）。定稿信息分布在四份来源：

1. `docs/V1-PRD.md`（产品需求，含 §6 数据结构、§7 技术栈与多源搜索架构）
2. `docs/design/design.md`（技术设计，§10 前端架构与 Tauri command 契约、§10.0 分层规范）
3. `openspec/`（`config.yaml` context、`specs/` 主规格、`changes/archive/` 归档）
4. 记忆 `~/.claude/projects/-Users-xian-Project-music-MusicTag/memory/music-tag-v1-spec.md`

复核发现：文档/记忆的部分描述停留在早期拍板或重构之前的状态，与「已实现的代码现状」和「已定稿的 PRD/design」存在陈旧、矛盾与遗漏。本变更做一致性复核 + 修订，不引入任何产品行为变化。

**代码现状基准**（本变更修订的最终参照，均已核实）：

- `src-tauri/src/lib.rs` 实际注册 11 个 command：`pick_folder`、`list_songs`、`open_song`、`save_song`、`rename_song`、`pick_cover_file`、`read_cover_path`、`search_song`、`search_source`、`fetch_lyric`、`download_cover`。
- `save_song(song, export_lrc: bool)`：exportLrc 已扩参（v1-lyrics-lrc）。
- **无独立 `embed_cover`**：`src-tauri/src/commands/cover.rs` 注释明确「封面一律并入 save_song 写盘（design.md §10.3）」。
- 模块已分层为 `commands/` 目录（folder/song/cover/search.rs）+ `service/`（v1-refactor-layering 定稿），不再是早期「`commands.rs` 单文件 + `search/` 目录」。

## Goals / Non-Goals

**Goals:**
- 逐条复核四源，找出陈旧、矛盾、遗漏，产出**可追溯的复核报告**（每条差异记录「源文件 + 修订前 → 修订后 + 理由」）。
- 修订四源，使 Tauri command 契约清单、FR-8 搜索联动、FR-5/FR-4 保存歌词语义、离线降级规则在四源间一致，并与代码现状一致。
- 修订后 `openspec validate` 通过；归档时把修订同步回四源。

**Non-Goals:**
- 不新增/删除/改变任何产品行为（不新增 command、不改保存语义、不改搜索联动）。
- 不改应用代码（src-tauri/、src/ 零改动）。
- 不重构；不引入新的架构决策。
- 不做「规格基线自动化校验」（如 CI 校验 docs 与 specs 交叉引用）——本变更只做一次性复核 + 修订，并把「复核流程」规格化；自动化留待后续基建。

## 变更域判定

**docs**（纯文档/规格修订，无应用代码）。不涉及 Rust / Vue，无并发写风险，无 worktree 要求。修订动作按文件分组，任一组先行均不影响其他组，但建议按「先记复核报告 → 再逐文件修订 → 最后验证」的顺序。

## Decisions

以下 D1–D6 为本次复核发现的**真实不一致点**（调研时逐条核对过 PRD/design/config.yaml/记忆与 `src-tauri/src/lib.rs` 实际注册清单），每条给出修订方向。

### D1 记忆 music-tag-v1-spec.md 与 openspec/config.yaml 仍列已废弃的 `embed_cover` command（陈旧）

- **现状**：记忆第 31 行与 `openspec/config.yaml` context 的 command 契约行均写 `.../download_cover/embed_cover`。
- **矛盾**：PRD §7 第 309 行、design.md §10.3 均已拍板「封面并入 `save_song`，**无独立 `embed_cover`**」；`src-tauri/src/lib.rs` 注册清单与 `commands/cover.rs` 注释均确认不存在该 command。记忆/config 是唯一两处仍列 `embed_cover` 的源。
- **修订方向**：从记忆第 31 行与 `config.yaml` context 的 command 清单中删除 `embed_cover`；明确「封面一律走 `save_song`」。

### D2 design.md §10.3 command 契约表遗漏 `pick_cover_file` / `read_cover_path`（遗漏）

- **现状**：design.md §10.3 command 表只列 8 个歌曲/搜索相关 command，无封面选择/拖拽相关。
- **事实**：v1-cover-embed 已实现并注册 `pick_cover_file()`（rfd 文件对话框 → `CoverInput`）与 `read_cover_path(path)`（拖拽路径读 bytes），且 §10.0 分层规范要求所有 command 记录在契约表。PRD §7 command 全量清单同样缺这两个。
- **修订方向**：design.md §10.3 表补两行（`pick_cover_file`、`read_cover_path`）；PRD §7 一并补齐。另将 `search_source` 行内注释由「v1-search-fixes，C2 换源用」改为稳定描述（不依赖变更名）。

### D3 记忆 music-tag-v1-spec.md 的 `has_lyrics` / `has_cover` 字段为早期设计残留（陈旧）

- **现状**：记忆第 32 行写「`has_lyrics`/`has_cover` 跟随读出的完整 `Song`（搜索判定用）」。
- **矛盾**：PRD §6 `Song` struct 与 design.md §10.3 TS `Song` 接口均无这两个字段；缺失判定由 `lyrics_source: 'embedded'|'sidecar'|'none'` 与 `cover: string | null` 承担；代码中不存在 `has_lyrics`/`has_cover`。
- **修订方向**：从记忆删除/改写该描述，明确「缺失判定 = `lyrics_source === 'none'` / `cover === null`」。

### D4 PRD §7 多源搜索模块结构描述停留在重构前（陈旧）

- **现状**：PRD §7 第 303 行写「模块：`search/{mod,netease,qqmusic,migu}.rs` + `commands.rs`」。
- **矛盾**：v1-refactor-layering 已定稿并实施分层——`commands/` 目录薄壳 + `service/`（reader/writer/meta/cover/fs_atomic + searcher/ 子模块），design.md §10.0 有权威表格；代码即此结构。
- **修订方向**：PRD §7 同步为「`commands/` 目录薄壳 + `service/searcher/` 子模块」，与 design.md §10.0 对齐。

### D5 openspec/config.yaml context 的 command 契约行缺 `search_source`（遗漏）

- **现状**：`config.yaml` context 写 `list_songs/open_song/save_song/rename_song/search_song/fetch_lyric/download_cover/embed_cover`。
- **事实**：`search_source` 是 C2 取词失败换源的核心 command（design.md §10.3、specs/search-sources 均已含，`src/api/search.ts` 已封装 `searchSource`），但 config context 遗漏；同时含 D1 的 `embed_cover` 残留。
- **修订方向**：config context 的 command 行重写为与 `lib.rs` 实际注册一致（含 `search_source`、`pick_cover_file`、`read_cover_path`，删 `embed_cover`）。此条与 D1/D2 落在同一处行文，一并修订。

### D6 design.md §10.4「未来子变更落位表」所列子变更均已归档完成（陈旧状态）

- **现状**：design.md §10.4 末尾「未来子变更落位说明」表格列出 cover-embed/lyrics-lrc/rename-sync/search-backend/search-ui 的落位规划，并称「后续子变更的 Architect 按此规划」。
- **事实**：这五个子变更均已实现并归档（epic.json done；archive/ 目录齐全），「未来落位」已变成「历史落位」。
- **修订方向**：表头/说明更新为「已落位（归档）」；保留表格内容作为架构落位记录，去除「未来/后续」措辞，避免误导后续 Architect。

### D7 复核报告的产出形式（流程规约）

- 复核报告落盘为变更目录下 `review-report.md`（本变更新增，随变更归档）。
- 格式：每条差异一个条目 = `[源文件] 章节位置 | 修订前 → 修订后 | 理由/依据`。
- 报告须覆盖本 design.md D1–D6 全部条目，以及复核过程中新发现的其它差异（如有）。
- 报告作为 spec「复核报告有记录」验收的交付物。

## Risks / Trade-offs

- **文档修订引发新的不一致**：修订是逐处文本编辑，多处协同改（如 command 清单同时出现在 PRD/design/config/记忆）可能漏改。**缓解**：以 `lib.rs` 注册清单为唯一真值基准，逐源核对到行；修订后跑 `openspec validate` + 人工 diff 复核。
- **记忆文件的特殊性**：`~/.claude/.../memory/` 不在仓库内，改动不进 PR、不随归档；跨机器/会话可能被自动记忆覆盖。**缓解**：记忆修订单独记录在复核报告中（作为变更记录），并提示后续会话以 docs/openspec 为准。
- **design.md 结构守卫**：design.md §10 有结构守卫测试（`src/styles/design-layering.test.ts` 等）扫描 §10 断言分层描述。本变更只增补 §10.3 command 表行与 §10.4 措辞，**不**改分层规范段落本体，守卫不受影响；但须确认改动不触碰守卫断言的锚点文本。
- **「只修一致性」的边界**：复核可能发现某处「文档描述合理但实现偏离」——本变更按 Non-Goals 只修文档，不追代码；实现偏离记为「仅报告、不修订」条目。
- **validate 风险**：specs/ 主规格行文修订若破坏格式（如表格、front-matter）会导致 openspec validate 失败。**缓解**：修订以行内文本替换为主，改后必跑 validate。

## 任务拆分建议

依赖顺序：先出复核报告，再逐源修订，最后验证。纯 docs，无 Rust/Vue 串行约束，可按文件分组并行（未创建 worktree 时按序执行亦可）。

1. **复核报告（D7）**：按 D1–D6 与四源逐条比对，产出 `review-report.md`（含每处修订前/后/理由）。
2. **修订 openspec/config.yaml（D1/D5）**：command 契约行删 `embed_cover`、补 `search_source`/`pick_cover_file`/`read_cover_path`。
3. **修订 docs/design/design.md（D2/D6）**：§10.3 补 `pick_cover_file`/`read_cover_path` 两行 + 稳定化 `search_source` 注释；§10.4 未来落位表更新为已落位。
4. **修订 docs/V1-PRD.md（D2/D4）**：§7 command 全量清单补 `pick_cover_file`/`read_cover_path`/`pick_folder`；§7 模块结构同步为 `commands/` 目录 + `service/searcher/`。
5. **修订记忆 music-tag-v1-spec.md（D1/D3）**：删 `embed_cover`、删/改 `has_lyrics`/`has_cover`；此步在仓库外，改动记录进复核报告。
6. **验证**：`openspec validate` 通过；`npm run test`（结构守卫不因本变更失败）；diff 人工复核四源 command 清单一致。
