# Tasks — multi-source-candidates（Issue #115）

## 1. 文档同步（V1 拍板行为变更）

- [ ] 1.1 同步 `docs/V1-PRD.md` FR-8.6「聚合」：从「按歌曲相似度去重排序」改为「各家源内部聚合去重、跨源不折叠、候选多源展示」
- [ ] 1.2 同步 `docs/design/design.md` 搜索聚合段：去重语义改为同源折叠、跨源保留；排序改为按来源分组
- [ ] 1.3 同步记忆 `music-tag-v1-spec.md`：候选展示规则更新为「各家聚合、跨源不折叠」

## 2. 后端实现（Rust，TDD）

- [ ] 2.1 写失败测试：`tests/searcher_mod_tests.rs`（或既有 aggregate 测试文件）新增 `aggregate` 用例——同源同曲去重、跨源同曲保留、每源 TOP 3、来源分组排序
- [ ] 2.2 改 `aggregate()`：去重 key `(title, artist)` → `(source, title, artist)`；排序改「来源分组 + 组内分降序」；每源 TOP 3（上限 15）
- [ ] 2.3 更新受影响的既有 `aggregate` 断言（跨源折叠 → 同源折叠跨源保留）
- [ ] 2.4 `cargo check` + `cargo test` 全绿

## 3. 验证与契约守卫

- [ ] 3.1 前端零改动确认：`npm run test` + `npm run build` 通过（候选 shape/badge/点选逻辑已支持多源）
- [ ] 3.2 command-contract 契约守卫 `npm run test` 通过（`search_song` 签名未变，无需更新）

## 4. 最终验证

- [ ] 4.1 `cargo check` → `cargo test` → `npm run test` → `npm run build` → `openspec validate multi-source-candidates --strict --no-interactive` 全绿
- [ ] 4.2 复盘回归清单：单源换源不被聚合去重破坏（`search_source` 不受影响）、跨 kind 不串扰（歌词/封面候选互不作废）、离线判定不回归（`all_failed` 逻辑未动）
