# Tasks — multi-source-candidates（Issue #115）

> 变更域：**纯后端**（design.md「变更域判断」）。实施由 Rust-Dev 单角色完成；前端零代码改动，仅回归验证。
> 依赖顺序：文档同步 → Rust TDD（先改失败测试再实现）→ 前端/契约回归 → 最终验证。无跨前后端串行、不并行。

## 1. 文档同步（V1 拍板行为变更）

- [ ] 1.1 同步 `docs/V1-PRD.md` FR-8.6「聚合」（表格第 6 行）：从「多源结果合并、按歌曲相似度去重排序」改为「各家源内部聚合去重、跨源不折叠、候选多源展示」
- [ ] 1.2 同步 `docs/design/design.md` 搜索聚合段（§9 结果形态 / §10.3 `search_song` 契约注释的「打分去重」、§搜索流程的「按归一化 (title, artist) 去重保留最高分」）：去重语义改为同源折叠、跨源保留；排序改为按来源分组
- [ ] 1.3 同步记忆 `music-tag-v1-spec.md`：候选展示规则更新为「各家聚合、跨源不折叠」
- [ ] 1.4 同步主规格 `openspec/specs/search-sources/spec.md` 的「打分去重排序」Requirement：去重语义从「跨源折叠」改为「同源折叠、跨源全保留」（与变更内 specs delta 一致），随 PR 一并归档（`/opsx:archive` 时回写）

## 2. 后端实现（Rust，TDD：先改失败测试再实现）

- [ ] 2.1 新增 `aggregate` 失败测试（`src-tauri/tests/searcher_mod_tests.rs`）：
  - 跨源保留：Netease/QqMusic/Kugou/Lrclib/Itunes 五源同曲同分 → 返回 5 条、按来源分组序（不再折叠成 Netease 1 条）
  - 同源去重：同一来源同归一化 title/artist 多版本 → 只留该源得分最高一条
  - 每源 TOP 3：单源 15 个不同 title 候选 → 只返回 3 条（`PER_SOURCE_TOP`）
  - 来源分组排序：组序 Netease→QqMusic→Kugou→Lrclib→Itunes，组内分降序；同分组内按归一化 title/artist 稳定
- [ ] 2.2 改 `aggregate()`（`service/searcher/mod.rs:365`）：去重 key `(norm(title), norm(artist))` → `(MusicSourceId, norm(title), norm(artist))`；按源分组、组内分降序、每源截 `PER_SOURCE_TOP=3`；按 `source_rank` 分组拼接；**删除 `aggregate` 内的 `truncate(TOP_N)`**
- [ ] 2.3 新增 `pub const PER_SOURCE_TOP: usize = 3`；`TOP_N=10` 保留仅服务 `search_source_with`（line 204），同步改写 `TOP_N` 注释（勿把全局截断加回 `aggregate`）
- [ ] 2.4 更新受影响的既有断言（跨源折叠 → 同源折叠跨源保留）：
  - `aggregate_dedup_keeps_earliest_source_on_tie`（line 146）：3 源同曲 → 3 条按源序
  - `aggregate_tie_keeps_full_five_source_rank_order`（line 164）：5 源同曲 → 5 条全保留
  - `aggregate_limits_to_top_ten`（line 192）：单源 15 个 → 每源 TOP 3 → 3 条（改名/改断言）
  - `search_aggregates_five_sources_and_stats`（line 363 / 430）：五源同曲断言「只留 Netease」→「各源保留」
  - 文件头注释（line 6-8）「归一化去重 → score 降序 → 前 10 条」同步改写
  - **防误伤确认（应保持通过）**：`aggregate_scores_and_sorts_desc`、`aggregate_album_*`、`aggregate_normalizes_fullwidth_query`（均单源 fixture，验证不误伤）
- [ ] 2.5 `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo test --manifest-path src-tauri/Cargo.toml` 全绿

## 3. 验证与契约守卫（前端零改动确认）

- [ ] 3.1 前端零改动确认：`npm run test` + `npm run build` 通过（store 过滤 `cover_url !== null` 逐条、候选 shape/badge/点选逻辑已支持多源；可选：`store/song.ts` line 95「已打分去重排序」注释澄清为「同源去重、跨源保留」——非必须）
- [ ] 3.2 command-contract 契约守卫 `npm run test` 通过（`search_song` 签名未变，四源契约表无需更新）

## 4. 最终验证

- [ ] 4.1 `cargo check` → `cargo test` → `npm run test` → `npm run build` → `openspec validate multi-source-candidates --strict --no-interactive` 全绿
- [ ] 4.2 复盘回归清单：单源换源不被聚合去重破坏（`search_source` 不受影响，TOP_N 载荷上限保留）、跨 kind 不串扰（歌词/封面候选互不作废）、离线判定不回归（`all_failed` 逻辑未动）、`source_stats` 计数语义未变
