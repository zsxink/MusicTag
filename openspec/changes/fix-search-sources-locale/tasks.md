# Issue #152 Tasks

Domain: `both`。必须 Rust → Vue（前端 C2 归一化镜像依赖后端 `norm()` 先落地）。只有 Leader 勾选任务、写 `progress.md`、提交与集成；子 Agent 一律不执行 `git add`/`commit`/push/PR/merge。

## 1. 规格与文档（Leader，Dev 前置）

- [ ] 1.1 核对 `openspec/changes/fix-search-sources-locale/{proposal,design}.md` 与两份 spec delta 一致，并更新 GitHub Issue #152 描述为「可用性修复 + 语种适配 + 繁简归一化」范围（PR 将以 `Closes #152` 收口）。Owner: Leader；无代码改动。
- [ ] 1.2 同步权威文档：`docs/V1-PRD.md`（`:342` QQ 端点、`:345` iTunes 店面、`:347-351` 归一化含繁简与去重/排序说明，删「V1 不做简繁转换」）与 `docs/design/design.md`（`:204` 聚合语义、`:374` `search_song` 契约、源清单补酷狗封面与 QQ 端点）。Owner: Leader；依赖 1.1。
- [ ] 1.3 执行 spec-gate preflight 与 `npx openspec validate fix-search-sources-locale --strict --no-interactive`，确认 delta 格式（MODIFIED 全文替换、ADDED 全 requirement）与 scenario 覆盖；审计后提交 checkpoint。Owner: Leader；Dev 依赖 1.2/1.3。

## 2. Rust 搜索源修复（rust-backend）

- [ ] 2.1 QQ 搜索端点默认值 `client_search_cp` → `search_for_qq_cp`，更新文件头注释（旧端点 HTTP 500 事实）；`parse_search_response`/`is_error_response`/取词路径逐字不动。Owner: Rust Dev；文件 `src-tauri/src/service/searcher/qqmusic.rs`；依赖 1.3；映射搜索源可用性。
- [ ] 2.2 酷狗封面：新增 `pub fn kugou_cover_url(raw: &str) -> Option<String>`（`{size}`→480、`http://`→`https://`、host `singerimg.kugou.com` → `None`），`parse_search_response` 用之并修正「响应无封面」的错误注释。Owner: 同一 Rust Dev；文件 `src-tauri/src/service/searcher/kugou.rs`；依赖 1.3；映射酷狗封面候选。
- [ ] 2.3 iTunes 双店面：`Itunes` 增 `pub storefronts: Vec<String>`（默认 `["HK","US"]`），`search()` 用 `JoinSet` + 定序回填槽位并发请求两店面、按店面序（HK→US）拼接；两店面全失败才 `Err`；删硬编码 `country=CN`；`fetch_lyric` 仍恒 `None`。Owner: 同一 Rust Dev；文件 `src-tauri/src/service/searcher/itunes.rs`；依赖 1.3；映射 iTunes 封面源与部分成功语义。
- [ ] 2.4 繁简表落地：新增 `src-tauri/src/service/searcher/opencc/{TSCharacters.txt,TSPhrases.txt,README.md}`（OpenCC 上游原文 + 来源/许可声明）与 `simplified.rs`（`include_str!` + `OnceLock` 惰性解析 + `pub fn to_simplified`，先词后字、最长优先、多候选取首）。Owner: 同一 Rust Dev；文件 `src-tauri/src/service/searcher/{simplified.rs,opencc/*}`、`src-tauri/src/service/searcher/mod.rs`（模块声明）；依赖 1.3；映射繁简归一化。
- [ ] 2.5 归一化与聚合：`norm()` 接入 `to_simplified`（trim → 繁→简 → 全角半角 → 小写）；`search_song_with_sources` 的候选展开由 `raw.values()` 改为固定来源序；`aggregate()` 复用打分阶段已算的归一化 title/artist 作去重 key 与排序键。Owner: 同一 Rust Dev；文件 `src-tauri/src/service/searcher/mod.rs`；依赖 2.4；映射打分去重排序与确定性。运行 `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 与相关 Rust 测试；Leader 审计授权路径并提交 checkpoint。

## 3. Rust 测试（tester）

- [ ] 3.1 `tests/common/mod.rs` 新增 `mock_http_router(routes, expected)`（按请求目标分流响应、应答 N 次后关闭、返回全部捕获目标）。Owner: Tester；文件 `src-tauri/tests/common/mod.rs`；依赖 2.3。
- [ ] 3.2 补足断言：双店面并发与 `country=HK`/`US` 两次请求且 HK 在前、部分成功不判失败、双失败才 `Err`、合并后同曲（繁/简）经 `aggregate` 折叠为一条；酷狗封面四类输入；繁简折叠 fixture（两侧同组用例，词表优先不被逐字误伤）；`artist_match("周杰伦","周杰倫") == 0.4`；固定来源序的确定性回归；更新既有 `Itunes { search_url }` 字面构造、`country=CN` 与酷狗 `cover_url: None` 断言。Owner: Tester；文件 `src-tauri/tests/searcher_{itunes,kugou,qqmusic,mod,simplified}_tests.rs`、`src-tauri/tests/common/mod.rs`；依赖 2.5。报告 fixture 早检、命令退出码与未实测范围；Leader 审计并提交 checkpoint。

## 4. Vue 归一化镜像（vue-frontend，Rust 完成后）

- [ ] 4.1 新增 `src/lib/simplified.ts`（`?raw` 加载同一份 `opencc/*.txt` + `toSimplified`，算法与 Rust 同规则）与 `src/lib/normalize.ts`（由 `src/store/song.ts:851` 迁出的 `normalizeForMatch`，接入 `toSimplified`，保持全角半角 + 小写）。Owner: Vue Dev；文件 `src/lib/{simplified.ts,normalize.ts}`；依赖 2.5；映射繁简归一化前端侧。若构建链拒绝跨目录 `?raw`，按 design D6 兜底改 codegen + 漂移断言并在 progress 记录。
- [ ] 4.2 `src/store/song.ts` 改为从 `src/lib/normalize.ts` 引入并删除本地实现；`findSameSong`（C2 身份校验）语义不变（仍拒同名不同歌）。Owner: 同一 Vue Dev；文件 `src/store/song.ts`；依赖 4.1。运行 `npm run test` 与 `npm run build`；Leader 审计并提交 checkpoint。

## 5. Vue 测试（tester）

- [ ] 5.1 `src/lib/simplified.test.ts` 与 `src/lib/normalize.test.ts` 用与 Rust 相同的 fixture 组断言折叠与归一化；`src/store/song.test.ts` 补「繁体候选 → 简体换源结果命中同一首」与「Live 版/翻唱仍被拒」。Owner: Tester；文件 `src/lib/simplified.test.ts`、`src/lib/normalize.test.ts`、`src/store/song.test.ts`；依赖 4.2；映射 C2 换源 requirement。Leader 审计并提交 checkpoint。

## 6. CR、Verify 与 Integrate（Leader）

- [ ] 6.1 CR 只读核对全部 diff 与两份 delta：归一化前后端同规则、展示/写盘文本未被改写、双店面失败与 `source_stats`/`all_failed` 语义、固定来源序确定性、酷狗 host 过滤、许可声明齐全、契约零变化（command 数仍 17、`MusicSourceId` 仍五变体、每源 TOP 3）。无 blocker/major 才进入 Verify。Owner: 独立 reviewer；写 none；依赖 3.2/5.1。
- [ ] 6.2 Verify：`cargo check --manifest-path src-tauri/Cargo.toml --all-targets` → `cargo test --manifest-path src-tauri/Cargo.toml` → `npm run test` → `npm run build` → `npx openspec validate fix-search-sources-locale --strict --no-interactive`，记录相同 HEAD 与逐条退出码。Owner: Verify 只读或 Leader；依赖 6.1。
- [ ] 6.3 归档 → 提交 → 推送 → 创建 `Closes #152` PR → 核对 required CI → 合并 → 核对远端 Issue/PR/merge SHA → 清理；写 progress 与完整 typed checkpoint 证据。Owner: Leader；依赖 6.2。
