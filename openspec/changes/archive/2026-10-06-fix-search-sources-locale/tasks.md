# Issue #152 Tasks

Domain: `both`，顺序固定 **Rust → Vue**（前端 C2 归一化镜像依赖后端 `norm()` 先落地——两侧规则一旦不同，C2 换源会出现「后端认为同曲、前端认为不同曲」的撕裂，测试无从判定谁对）。只有 Leader 勾选任务、写 `progress.md`、提交与集成；子 Agent 一律不执行 `git add`/`commit`/push/PR/merge。

> **前置事实（Architect 已核，Dev 无需再问）**：
> - `norm()` 在 `src-tauri/src/service/searcher/mod.rs:280`，`pub`，**生产调用点只有 7 处且全在同文件 `aggregate()` 内** → 接折叠不外溢。
> - `search_song_with_sources:170-174` 确为 `raw.values().flatten()`（`raw` 是 `HashMap`，顺序不确定）；`order` 数组已在 `:124-130` 存在，直接复用。
> - `Itunes::search`（`itunes.rs:34-68`）当前是**完全串行单请求**，需新增 `use tokio::task::JoinSet;`（该文件尚未 import tokio）。
> - `tests/common/mod.rs` 的 `mock_http_once:30` / `mock_http_capture:53` 末端**均有 `break`，各只服务 1 个请求且响应字节固定** → 双店面必须新增 router mock。
> - OpenCC 表数据事实、跨目录 `?raw` 三链路实测结论见 design §2.5 / D6，**不必重复实测**。
> - 繁简折叠 fixture 一律取 design §5 的表，**不要**自行发挥（表已标注每条能钉死哪种错误实现）。

## 1. 规格与文档（Leader，Dev 前置）

- [x] **1.1** 核对 `openspec/changes/fix-search-sources-locale/{proposal,design}.md` 与两份 spec delta 一致，确认 `specs/search-sources/spec.md` 的「多候选字取首」Scenario 已改为 `乾 → 干 乾`（用户裁决；`著` 在两表均无条目，原示例不可实现），并把 GitHub Issue #152 描述更新为「可用性修复 + 语种适配 + 繁简归一化」范围（PR 以 `Closes #152` 收口）。Owner: Leader；无代码改动。
- [x] **1.2** 同步权威文档。`docs/V1-PRD.md`：`:342` QQ 端点 → `search_for_qq_cp`；`:345` iTunes → `country=HK+US 双店面`；`:351` 归一化定义补「繁→简（内嵌 OpenCC Apache-2.0 表）」并**删「V1 不做简繁转换」**。`docs/design/design.md`：`:204` 聚合语义（归一化含繁简、来源固定序、iTunes 双店面合并后仍 TOP 3）；`:374` `search_song` 契约行；`:341-345` 搜索源清单补酷狗封面与 QQ 端点事实。存量 `openspec/specs/search-ui/spec.md:42` 的 `migu` 与 `:53/:56/:60` 的「三源」**无需额外改动**：OpenSpec 的 MODIFIED 为整块替换（`core/specs-apply.js` 归档时 `nameToBlock.set(key, mod)`），本 change 的两个 `search-ui` MODIFIED requirement 已把四处全部覆盖（裁决与逐条核对见 design §6 末注）。Owner: Leader；依赖 1.1。
- [x] **1.3** 执行 spec-gate preflight 与 `npx openspec validate fix-search-sources-locale --strict --no-interactive`，确认 delta 格式（MODIFIED 全文替换、ADDED 全 requirement）与 scenario 覆盖；审计后提交 checkpoint。Owner: Leader；Dev 依赖 1.2/1.3。**结果**：preflight exit 0；`validate fix-search-sources-locale --strict` exit 0；`validate --all --strict` exit 0（30 passed / 0 failed）。

## 2. Rust 搜索源修复（rust-backend）

- [x] **2.1** QQ 搜索端点：`qqmusic.rs:27` 默认值 `client_search_cp` → `search_for_qq_cp`；同步改 5 处提及旧端点名的注释（`:1` 文件头、`:3` 说明、`:18` 字段 Doc、`:50` `search()` 内联注释、`:109` `parse_search_response` Doc）——spec scenario「端点失效不留旧路径」要求代码与文档中不再有旧端点表述。`parse_search_response` / `is_error_response` / `fetch_lyric` 逐字不动。Owner: Rust Dev；文件 `src-tauri/src/service/searcher/qqmusic.rs`；依赖 1.3；映射 spec「QQ 音乐搜索端点」全部 3 scenario。
- [x] **2.2** 酷狗封面：新增 `pub fn kugou_cover_url(raw: &str) -> Option<String>`（`pub` 是硬要求，集成测试是独立 crate 只看得到 `pub`），规则依次为 `{size}` 字面占位符 → `480`、`http://` → `https://`、host 为 `singerimg.kugou.com` → `None`、其余保留；`parse_search_response:228` 的 `cover_url: None` 改为调用之；删除 `:213-214`「酷狗搜索响应无封面 URL」的错误注释。Owner: 同一 Rust Dev；文件 `src-tauri/src/service/searcher/kugou.rs`；依赖 1.3；映射 spec「酷狗签名搜索」的封面派生 / 歌手头像丢弃 / 无封面三 scenario。
- [x] **2.3** iTunes 双店面：`Itunes` 增 `pub storefronts: Vec<String>`，`Default`（`:20-26` 手写 impl）给 `["HK","US"]`；`search()` 用 `JoinSet` 并发两店面、**按下标回填 `Vec<Option<_>>` 后按店面序拼接**（完成顺序不确定，直接 join 会让 HK/US 顺序随机、破坏同分去重可复现），任一成功即 `Ok`（含成功但空）、两店面全失败才 `Err`；删 `:49` 硬编码 `("country","CN")` 改由店面序参数化；`fetch_lyric` 仍恒 `None`。Owner: 同一 Rust Dev；文件 `src-tauri/src/service/searcher/itunes.rs`；依赖 1.3；映射 spec「iTunes 封面源」全部 6 scenario。
- [x] **2.4** 繁简表落地：新增 `src-tauri/src/service/searcher/opencc/{TSCharacters.txt,TSPhrases.txt,README.md}`（上游原文 + 来源 URL + **两个 SHA-256**（design §2.5）+ Apache-2.0 声明 + 「`TSCharactersExt.txt` 上游 404、不存在」的如实说明）与 `simplified.rs`：`pub const` 表文本用 `include_str!`，`OnceLock` 惰性解析成 `HashMap<char,&'static str>`（字）+ `HashMap<&'static str,&'static str>`（词）+ `max_phrase_len`，`pub fn to_simplified(s: &str) -> String` 实现「先词后字、最长优先、**取该条第一个候选**」。解析器：跳过 `#` 注释行与空行（`TSCharacters` 另有 1 行非注释空行）、按 `\t` 切 key/value、按**单个空格**切候选（**不能用 `split_whitespace`**）。在 `mod.rs` 加 `pub mod simplified;`。Owner: 同一 Rust Dev；文件 `src-tauri/src/service/searcher/{simplified.rs,opencc/*}`、`mod.rs`；依赖 1.3；映射 spec「繁简归一化」的字/词折叠 scenario。
- [x] **2.5** 归一化与聚合：`norm()`（`:280`）接入 `to_simplified`（`trim → 繁→简 → 全角半角 → 小写`）并更新其 Doc（删「V1 不做简繁」）；`search_song_with_sources:170-174` 候选展开由 `raw.values()` 改为按既有 `order`（`:124-130`）固定来源序；`aggregate()`（`:379`）把打分阶段已算的 `norm(title)`/`norm(artist)` **复用于去重 key（`:408`）与排序 tie-break（`:437-442`，现每次比较重算两遍）**，去重 key 仍为 `(source, norm_title, norm_artist)`。Owner: 同一 Rust Dev；文件 `src-tauri/src/service/searcher/mod.rs`；依赖 2.4；映射 spec「打分去重排序」的繁简折叠 / 固定来源序 scenario。运行 `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`；Leader 审计授权路径并提交 checkpoint。

## 3. Rust 测试（tester）

- [x] **3.1** `tests/common/mod.rs` 新增 `mock_http_router(routes: impl Fn(&str) -> Vec<u8> + Send + 'static, expected: usize) -> (String, Arc<Mutex<Vec<String>>>)`：按请求目标（含 query）分流响应、应答 `expected` 次后关闭、返回全部捕获目标。**不得**复用现有两个助手（`mock_http_once:30` / `mock_http_capture:53` 末端 `break`，各只服务一个请求且响应固定）——它们被其它测试共用，**保持不动**。Owner: Tester；文件 `src-tauri/tests/common/mod.rs`；依赖 2.3。
- [x] **3.2** 补足断言。**结果**：新增 26 个测试（itunes +6、kugou +2、mod +7、qqmusic +1、simplified +10 新建文件），`cargo test` exit 0（267 passed / 0 failed / 0 ignored，27 个 test binary）、`cargo check --all-targets` exit 0 零 warning；3 处 E0063 改 `..Default::default()`；`http_error_status_returns_err` 假通过已消除（两店面都真收到 404 + 断言捕获数 == 2）。Leader 独立核验：fixture 判别力逐条对上上游表（`沈→沈 沉` 首候选为原字故测试推理成立；`乾隆→乾隆` 为恒等条目、确实无法证明查词表，判别用例是 `一坏→一坯`）；写边界仅 5 个授权文件；`aggregate` 生产唯一调用点 `mod.rs:183` 入参来自 `order` 固定序，「输入须按固定来源序」前提在生产成立。
  - **双店面**（`searcher_itunes_tests.rs`）：HK→繁体 JSON、US→简体 JSON → 断言请求 **2 次**、`country` 分别 `HK`/`US`、**返回序 HK 在前**；一路 500 一路 200 → `Ok` 且只含成功店面；两路 500 → `Err`，**并断言该情形下 `search_song_with_sources` 的 `all_failed` 才为 true、且 `source_stats` 记 0**（映射 `search-ui` delta「离线降级」：iTunes 仅两店面全失败才计为失败）；经 `aggregate` 后 HK/US 同曲（繁/简）折叠为一条。
  - **更新既有 3 处 `Itunes { search_url }` 字面构造**（`:87/:106/:125`，加字段后缺字段编译不过，建议 `..Default::default()`）与 **1 处 `country=CN` 断言**（`:99`）。
  - **酷狗封面**（`searcher_kugou_tests.rs`）：`kugou_cover_url` 四类输入（正常 `imge` / `{size}` 替换 / `singerimg` 丢弃 / 空或缺失）；更新 `:149` 的 `cover_url: None` 断言**及其断言消息**。
  - **繁简折叠**（新增 `tests/searcher_simplified_tests.rs`）：用 design §5 表中的 fixture，**至少**含 `周杰倫→周杰伦`、`乾→干`、`乾紅→干红`、`一坏→一坯`（结构断言）、`魔杰座`/`著作` 原样、纯 ASCII 与空串幂等；**不要**用 `乾隆` 当「词表优先于逐字」的判别用例（词表恒等条目导致两种实现同结果）。
  - **`norm` 与打分**（`searcher_mod_tests.rs`）：补 `artist_match("周杰伦","周杰倫") == 0.4`（现状 0）与固定来源序的确定性回归；补一条**只折叠比较侧、不改写候选文本**的断言（`aggregate` 返回的 `SongCandidate.title` 仍是 `周杰倫` 原文）——映射 spec「只折叠比较侧」scenario；跨源不折叠（两家源同曲繁体/简体各保留一条、各带 badge）沿用既有 `aggregate_keeps_each_source_on_same_song`（`:147`）回归即可。
  Owner: Tester；文件 `src-tauri/tests/searcher_{itunes,kugou,qqmusic,mod,simplified}_tests.rs`、`src-tauri/tests/common/mod.rs`；依赖 2.5（3.1 可并行）。报告 fixture 早检、命令退出码与未实测范围；Leader 审计并提交 checkpoint。

## 4. Vue 归一化镜像（vue-frontend，Rust 完成后）

- [x] **4.1** 新增 `src/lib/simplified.ts`（`?raw` 加载 `../../src-tauri/src/service/searcher/opencc/*.txt` + `toSimplified`，**与 Rust 同规则同表**：先词后字、最长优先、取第一个候选、同样按 `\t`/单空格解析、同样跳过 `#` 与空行）与 `src/lib/normalize.ts`（由 `src/store/song.ts:851 normalizeForMatch` 迁出，接入 `toSimplified` + 全角半角 + 小写）。落位遵守 `design.md §10.0`：`lib/` 纯工具层，**无 Vue / IPC 依赖**，`src/lib/` 目录已存在（含 `cover.ts`/`path.ts`/`theme.ts`）。跨目录 `?raw` 已实测在 vitest / vue-tsc / vite build 三链路通过（design D6），**若失败**按 D6 兜底改 codegen + 漂移断言并在 progress 记录。Owner: Vue Dev；文件 `src/lib/{simplified.ts,normalize.ts}`；依赖 2.5；映射 spec「繁简归一化」前后端同规则 scenario。
- [x] **4.2** `src/store/song.ts` 改为从 `src/lib/normalize.ts` 引入并删除本地实现（`:851-863`）；`findSameSong`（`:866`）语义不变（仍拒同名不同歌）。Owner: 同一 Vue Dev；文件 `src/store/song.ts`；依赖 4.1。运行 `npm run test` 与 `npm run build`；Leader 审计并提交 checkpoint。

## 5. Vue 测试（tester）

- [x] **5.1** `src/lib/simplified.test.ts` 与 `src/lib/normalize.test.ts` 用与 Rust **完全相同**的 fixture 组与期望值（design §5 表）；`src/store/song.test.ts` 补「繁体候选 → 简体换源结果命中同一首（不再被判同名不同歌）」与「Live 版/翻唱仍被拒」两条（参照既有 C2 归一化用例 `song.test.ts:1678` 的写法，**旧行为不许被折叠放宽**）。Owner: Tester；文件 `src/lib/simplified.test.ts`、`src/lib/normalize.test.ts`、`src/store/song.test.ts`；依赖 4.2；映射 spec「取词失败自动换源（C2）」的繁体匹配 / 同名不同歌两 scenario。Leader 审计并提交 checkpoint。

## 6. CR、Verify 与 Integrate（Leader）

- [x] **6.1** CR 只读核对全部 diff 与两份 delta：归一化前后端同规则同表、展示/写盘文本未被改写（折叠只作用于比较侧）、双店面失败与 `source_stats`/`all_failed` 语义（iTunes 仅两店面全失败才算失败；`source_stats` 记合并后条数）、固定来源序确定性、酷狗 host 过滤、`opencc/README.md` 许可与 SHA-256 齐全、契约零变化（command 数仍 17、`MusicSourceId` 仍 5 变体、每源 TOP 3 × 5 = 15）。无 blocker/major 才进入 Verify。Owner: 独立 reviewer；写 none；依赖 3.2/5.1。
- [x] **6.2** Verify：`cargo check --manifest-path src-tauri/Cargo.toml --all-targets` → `cargo test --manifest-path src-tauri/Cargo.toml` → `npm run test` → `npm run build` → `npx openspec validate fix-search-sources-locale --strict --no-interactive`，记录相同 HEAD 与逐条退出码。Owner: Verify 只读或 Leader；依赖 6.1。
- [x] **6.3** 归档 → 提交 → 推送 → 创建 `Closes #152` PR → 核对 required CI → 合并 → 核对远端 Issue/PR/merge SHA → 清理；写 progress 与完整 typed checkpoint 证据。Owner: Leader；依赖 6.2。
