# spec-review 任务清单

> 依赖顺序：先出复核报告 → 再逐源修订 → 最后验证。纯 docs 变更域，无 Rust/Vue 串行约束。每组内按序勾选。

## 1. 复核报告（design.md D7）

- [ ] 1.1 按 D1–D6 与四源（docs/V1-PRD.md、docs/design/design.md、openspec/config.yaml + specs/、记忆 music-tag-v1-spec.md）逐条比对，确认每处不一致的现状、来源行/章节
- [ ] 1.2 产出 `review-report.md`（变更目录内）：每条差异 = `[源文件] 章节 | 修订前 → 修订后 | 理由/依据`，覆盖 D1–D6
- [ ] 1.3 复核过程中新发现的不一致并入报告（区分「修订」与「仅报告、不修订」）

## 2. 修订 openspec（design.md D1/D5）

- [ ] 2.1 `openspec/config.yaml` context 的 Tauri command 契约行：删 `embed_cover`，补 `search_source` / `pick_cover_file` / `read_cover_path`，与 `src-tauri/src/lib.rs` 实际注册一致
- [ ] 2.2 检查 `openspec/specs/` 主规格是否有陈旧 command 引用（如 `embed_cover`），若有则对齐修订
- [ ] 2.3 修订后跑 `openspec validate` 校验 openspec 侧结构

## 3. 修订 docs/design/design.md（design.md D2/D6）

- [ ] 3.1 §10.3 command 表补 `pick_cover_file`、`read_cover_path` 两行（封面选择/拖拽语义对齐 v1-cover-embed 已实现）
- [ ] 3.2 §10.3 `search_source` 行注释改写为稳定描述（去除「v1-search-fixes」变更名引用），保留「C2 换源用、绕过跨源聚合去重」语义
- [ ] 3.3 §10.4「未来子变更落位说明」表格更新为「已落位（已归档）」，去除「未来/后续」措辞，保留落位记录
- [ ] 3.4 复核改动不触碰 §10 分层规范段落本体（不触发 `design-layering.test.ts` 结构守卫断言）

## 4. 修订 docs/V1-PRD.md（design.md D2/D4）

- [ ] 4.1 §7 command 全量清单补齐 `pick_folder`、`pick_cover_file`、`read_cover_path`（现清单缺这三个已实现 command）
- [ ] 4.2 §7 多源搜索架构模块结构描述更新：`search/{mod,netease,qqmusic,migu}.rs + commands.rs` → `commands/` 目录薄壳 + `service/searcher/` 子模块（对齐 v1-refactor-layering 定稿与 design.md §10.0）
- [ ] 4.3 §6 Song struct 注释与 §7 行文核对，无 `embed_cover`/`has_lyrics` 残留

## 5. 修订记忆 music-tag-v1-spec.md（design.md D1/D3，仓库外）

- [ ] 5.1 第 31 行 command 契约清单删 `embed_cover`，明确「封面一律走 `save_song`，无独立 `embed_cover`」
- [ ] 5.2 第 32 行删/改 `has_lyrics`/`has_cover` 字段描述，改为「缺失判定 = `lyrics_source === 'none'` / `cover === null`」
- [ ] 5.3 记忆修订不提交进 PR；改动记录完整写入 `review-report.md`

## 6. 验证

- [ ] 6.1 `openspec validate` 通过（无结构错误）
- [ ] 6.2 `npm run test` 通过（design.md 结构守卫 `design-layering.test.ts` / `layering.test.ts` 不因本变更失败）
- [ ] 6.3 diff 人工复核：四源（PRD / design / config / 记忆）的 command 清单与 `src-tauri/src/lib.rs` 实际注册一致，无 `embed_cover` 残留
