# issue-166 设计（Architect 细化稿）

Issue: #166 ｜ Domain: **both**（Rust kugou → Vue EulaDialog，其余 docs/infra）｜ 交叉写入按 Rust → Vue 顺序。

> 初始稿 D1–D7 已逐条与代码事实核对，**全部成立，无 NEEDS_PARENT_DECISION**；本稿补充精确改动位置、测试方案、notices 脚本算法与文档增补小节编号。核对中发现初始稿未覆盖的一个代码事实：`src/styles/protocol-content.test.ts`（协议内容守卫测试）当前断言 README/LICENSE 含 "Business Source License 1.1"（L43-47、L57-60），LICENSE/README 重写必须同任务更新该守卫，否则 `npm run test` 直接红灯——已并入任务 1.1/1.2 的文件所有权。

## 1. 边界

- 只改协议与披露，不改搜索行为：候选打分、聚合、解析逻辑、超时/降级语义全部不动（`mod.rs:38` 单源 6s、`mod.rs:40` 封面 5s、`all_failed` 会话离线降级语义保持）。
- 许可重写只消除文本自相矛盾并明确要素，授权语义不放宽（现 `LICENSE:18` 授予「再分发 + 非生产性使用」与 `LICENSE:54-55`「禁止再分发」的矛盾消除，收窄为授权起即个人学习与研究）；不预设法律结论，法律审阅留作未决事项（记录在 `docs/compliance/search-sources.md`）。
- 不新增 npm/Cargo 运行时依赖；`scripts/generate-third-party-notices.mjs` 仅用 `node:fs`/`node:path`/`node:child_process` + `cargo metadata` + 读 `package.json`/`node_modules`。
- 既有防御逻辑不动：`kugou.rs:251-255` `strip_prefix("http://")`、`netease.rs:187` `replace("http://", "https://")`（spec 场景「响应内 URL 升级」明确保留）。

## 2. 决策（D1–D7，均已核对代码事实）

- **D1 LICENSE 采用自洽自定义文本，不采用标准 BSL 1.1 英文正文**：BSL 1.1 要求逐字采用标准文本且默认授权允许再分发/非生产使用，与作者既有「仅个人学习、禁止再分发」意图冲突（现文本即矛盾实例：`LICENSE:18` vs `LICENSE:54-55`）；自定义文本从授权起收窄（个人学习与研究：复制、修改、运行），保留 Change Date 2099-12-31 → GPL-2.0-or-later、禁商用/转卖/再分发/AI 转写、声明保留、无担保、终止/存续/可分割性、适用法域（中华人民共和国法律）、许可方（MusicTag 作者，GitHub @zsxink——现 `LICENSE:10` 未写 GitHub handle，重写时补上）。README（L12 徽章、L100-109 协议章节）与 EulaDialog 弹窗（L77 footnote）同步去掉 BUSL 1.1 表述。
- **D2 酷狗三端点默认 HTTPS**（`kugou.rs:36-38` 现为 `http://`，唯一明文生产端点；其余四源已是 https：`netease.rs:47/53`、`qqmusic.rs:29`、`lrclib.rs:26`、`itunes.rs:34`）。proposal 记载 2026-10-24 实测三端点 HTTPS 均 200。保留 `http://`→`https://` 升级逻辑（`kugou.rs:246-260` `kugou_cover_url`，升级在 L251-255；初始稿写「240-251」，实际函数体为 246-260）作为响应内 URL 防御。新增规格「生产请求传输加密」覆盖五源全局要求。
- **D3 数据披露以「文档与实际请求一致」为准**：发送字段=歌名/歌手/专辑名（`mod.rs:112-126` `search_song(title, artist, album)`；LRCLIB 走 `track_name`/`artist_name`/`album_name` 分参数，`mod.rs:375-377`）；接收方=五源域名（music.163.com、c.y.qq.com、complexsearch.kugou.com + lyrics.kugou.com、lrclib.net、itunes.apple.com；点选封面时另下载图片域 y.qq.com/imge.kugou.com/mzstatic）；触发时机=选中且缺歌词/封面才自动搜、点选才下载（`fetch_lyric`/`download_cover` 惰性拉取，`mod.rs:248-303`）；不发送音频内容与本地路径；失败行为=单源 6s 超时降级（`mod.rs:38`）、全源失败 `all_failed` → 会话离线降级（`mod.rs:186-188`）。README + EulaDialog 弹窗同步。
- **D4 合规记录**：`docs/compliance/search-sources.md` 逐源整理公开条款/接口文档链接与处理决定，标注核实状态；未决事项（发行地区、法律顾问审阅、平台接口授权、无授权来源的处置）单列，负责方=用户/法律顾问，与已完成事项可区分。
- **D5 归属清单**：Cargo **普通依赖闭包**（`cargo metadata` 从 `resolve.root` 起沿 `resolve.nodes[].deps[]` 中 `dep_kinds` 为空的普通依赖边 BFS——比初始稿「packages 全量」更精确：排除 `tauri-build` 等 build/dev-only 依赖，落实 spec「随二进制分发」；本 crate 无 `[dev-dependencies]`，实际差异仅构建依赖子树）；npm 运行时闭包（从 `package.json` `dependencies`——即 `vue`、`@tauri-apps/api`——起在 `node_modules` 按	Node 解析规则 BFS）；npm 构建工具链（`devDependencies` 同法 BFS，标注不随应用分发，与运行时节按 name@path 去重）；内嵌素材（OpenCC `TSCharacters.txt`/`TSPhrases.txt`，Apache-2.0，出处与 SHA-256 见 `src-tauri/src/service/searcher/opencc/README.md`，内嵌点 `simplified.rs:27/32` `include_str!` + `simplified.ts:24-25` `?raw`；`icon/musictag.png` 与 `src-tauri/icons/*` 来源状态标注「待确认」）。输出确定性排序，重跑幂等（算法见 §5）。
- **D6 随包分发**：`src-tauri/tauri.conf.json` `bundle`（L28-42，现无 `resources` 键）新增 `"resources": ["../THIRD-PARTY-NOTICES.md"]`。注意两点：`--no-bundle` 跳过打包阶段、可能不触发 resources 复制校验，验证优先用 `npx tauri build --bundles app`（见 §7 风险）；`../` 相对路径在 macOS .app 内可能落为 `Resources/_up_/THIRD-PARTY-NOTICES.md`，以实际落点为准记录，不强求路径形态。
- **D7 文档同步**（确切小节见 §6）：V1-PRD 新增 FR-10 + §4 非功能表补行 + §7 酷狗行明示 https + §8 追加验收 16；`docs/design/design.md` §10.3 增补「数据披露与传输加密」段；README 软件协议章节与 LICENSE 一致。

## 3. 文件改动点（精确位置）

| 文件 | 位置 | 改动 | 任务 |
|---|---|---|---|
| `LICENSE` | 全文（67 行） | 重写为自洽个人学习许可（D1 要素），消除 L18 vs L54-55 矛盾 | 1.1 |
| `src/styles/protocol-content.test.ts` | L54-75（LICENSE describe） | 删 BUSL/`Additional Use Grant` 断言，改为要素断言（许可方 @zsxink、无 BUSL、Change Date、四项禁止、无担保/终止/法域） | 1.1 |
| `README.md` | L12 | License 徽章 `BUSL%201.1` → 个人学习许可徽章 | 1.2 |
| `README.md` | L84-88「外部 API 声明」 | 扩充数据披露（字段/接收方/时机/不发送内容/降级行为，口径=D3） | 1.2 |
| `README.md` | L100-109「软件协议（License）」 | 去 BUSL 表述，与 LICENSE 一致（含 Change Date 2099-12-31） | 1.2 |
| `src/styles/protocol-content.test.ts` | L17-52（README describe） | L43-47 改「无 BUSL + 个人学习许可 + Change Date」断言；新增数据披露守卫用例 | 1.2 |
| `src-tauri/src/service/searcher/kugou.rs` | L36-38 | 三个默认端点 `http://` → `https://`；L5/L11 头注释同步措辞；**不动** L246-260 | 2.1 |
| `src-tauri/tests/searcher_https_tests.rs` | 新增 | 两用例结构守卫（见 §4.1） | 2.2 |
| `src/components/EulaDialog.vue` | L71-76 协议要点 `ul` | 外部 API `li`（L75）后新增数据披露 `li`（自动搜索仅发送歌名/歌手/专辑文本，不发送音频内容与本地路径） | 1.3 |
| `src/components/EulaDialog.vue` | L77 footnote | 去掉「（Business Source License 1.1）」 | 1.3 |
| `src/components/eula-dialog.test.ts` | L28-57 首次启动 describe | 新增 `it` 断言披露文案；既有 L40-47 用例保持通过 | 1.3 |
| `docs/compliance/search-sources.md` | 新增 | 五源记录 + 未决事项（D4） | 3.1 |
| `scripts/generate-third-party-notices.mjs`、`THIRD-PARTY-NOTICES.md` | 新增 | 脚本 + 生成物（算法见 §5） | 3.2 |
| `src-tauri/tauri.conf.json` | L28-42 `bundle` 对象 | 新增 `"resources": ["../THIRD-PARTY-NOTICES.md"]` | 3.3 |
| `docs/V1-PRD.md` | 见 §6 | FR-10、§4 表、§7 酷狗行、§8 验收 16 | 4.1 |
| `docs/design/design.md` | 见 §6 | §10.3 新段 | 4.2 |

## 4. 测试方案

### 4.1 酷狗三端点 HTTPS（放哪个文件、断言什么）

放 **`src-tauri/tests/searcher_https_tests.rs`（新增，Rust 集成测试，遵循 §10.4「单测一律外置 tests/」约定）**，不放进既有 `searcher_kugou_tests.rs`：后者按被测函数分域（签名/参数/解析/封面清洗），HTTPS 是跨五源的结构守卫，独立成文件避免单文件职责膨胀。两用例：

1. `kugou_default_endpoints_are_https`：断言 `Kugou::default().search_url` / `.lyric_search_url` / `.lyric_download_url` 均以 `"https://"` 开头（spec 场景「默认端点全为 HTTPS」）。字段本就是 `pub`（`kugou.rs:26-30`），直接断言即可。
2. `searcher_sources_have_no_plaintext_http_endpoints`：经 `env!("CARGO_MANIFEST_DIR")` 读 `src/service/searcher/` 目录全部 `.rs` 源码，收集含 `"http://` 字面量的行，断言每一处都属于防御性升级调用（行内含 `strip_prefix(` 或 `replace(`）——当前合法白名单即 `kugou.rs:251` 与 `netease.rs:187` 两处（spec 场景「全源端点加密」+「响应内 URL 升级」）。未来任何人新增明文端点或删掉升级防御都会红灯。

既有 `searcher_kugou_tests.rs` 现无用例锚定 http 默认端点（已核对：文件内无 `Kugou::default()` 引用，mock 测试均注入自定义 URL），改默认值不破坏既有用例。

### 4.2 协议内容守卫（前端）

- `src/styles/protocol-content.test.ts`（既有守卫，扫描仓库根 README/LICENSE 源码）：
  - LICENSE describe（L54-75）：`/Business Source License 1\.1/`、`/Additional Use Grant/` 断言删除，替换为 `expect(license).not.toMatch(/Business Source License/)` + 要素正则（许可方含 `@zsxink`、`2099-12-31`、`GPL-2.0-or-later`、个人学习与研究、禁止商用/转卖/再分发/AI 转写、无担保、中华人民共和国法律）。
  - README describe（L17-52）：L43-47 用例改为无 BUSL + 个人学习许可 + Change Date；新增「外部 API 数据披露」用例（正则断言歌名/歌手/专辑、接收方域名、缺失才自动搜/点选才下载、不发送音频内容与本地路径、离线降级）。
- `src/components/eula-dialog.test.ts`：L28-57 describe 内新增 `it('数据披露要点（仅发送歌名/歌手/专辑文本，不发送音频内容与本地路径）')`，`w.text()` 断言关键词；不动既有五个 describe。

### 4.3 notices 幂等

`node scripts/generate-third-party-notices.mjs` 连跑两次 → `git diff --exit-code THIRD-PARTY-NOTICES.md`。幂等由 §5 算法的确定性保证（无时间戳、无绝对路径、固定节序、字节序排序、固定结尾换行）。

## 5. notices 脚本算法（`scripts/generate-third-party-notices.mjs`）

仅用 Node 内置模块（`node:fs`、`node:path`、`node:child_process`），无新依赖。

1. **Cargo 普通依赖闭包**：`execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", "src-tauri/Cargo.toml"])`。解析 JSON：
   - 起点：`resolve.root`（即 `music-tag` 包 id；缺失时兜底在 `packages[]` 中找 `name === "music-tag"`）。
   - BFS：对 `resolve.nodes[]` 按 `id` 建索引，从 root 出发，只沿 `deps[].dep_kinds` 为空数组（普通依赖边）的边前进；`dev`/`build` 边不入队。
   - 记录字段（映射到 `packages[]`）：`name`、`version`、`license ?? license-file ?? "UNKNOWN"`、来源链接 `repository ?? homepage ?? "https://crates.io/crates/<name>"`。
   - `tauri-build`（root 的 `[build-dependencies]`，`Cargo.toml:13-14`）因其边 `dep_kinds=[{kind:"build"}]` 天然被排除，与「随二进制分发」口径一致。
2. **npm 运行时闭包**：读根 `package.json` `dependencies`（现仅 `vue`、`@tauri-apps/api`）。`resolve(fromDir, name)` 沿祖先目录找 `node_modules/<name>`（scoped 包路径 `node_modules/@scope/name`）；BFS 只跟各包 `package.json` 的 `dependencies`（不跟 peer/optional/dev）。记录 `name`、`version`、`license`、`repository.url ?? homepage`。
3. **npm 构建工具链**：同法但起点为 `devDependencies`（`@tauri-apps/cli`、`@vitejs/plugin-vue`、`@vue/test-utils`、`happy-dom`、`typescript`、`vite`、`vitest`、`vue-tsc`），独立成节并标注「构建工具链，不随应用分发」；已在运行时闭包出现的 `name@version` 不重复收录（去重键 = `name@resolved 绝对路径`）。
4. **内嵌素材**：脚本内静态常量数组（不走自动扫描），每条含 路径/来源/许可/核实状态：
   - `src-tauri/src/service/searcher/opencc/TSCharacters.txt`、`TSPhrases.txt`：OpenCC（https://github.com/BYVoid/OpenCC），Apache-2.0，SHA-256 与上游出处见同目录 `README.md`；内嵌点 `simplified.rs:27/32`、`simplified.ts:24-25`。
   - `icon/musictag.png`（README 顶部图标）、`src-tauri/icons/*`（bundle 图标，`tauri.conf.json:31-37`）：来源状态「待确认」（未决，负责方=作者）。
5. **去重与排序**：Cargo 节按 `name` 升序、同 name 按 `version` 升序；npm 两节按 `name` 升序——均用默认字符串比较（UTF-8 码元序，确定性等价于字节序）。节顺序固定：Cargo 依赖 → npm 运行时依赖 → npm 构建工具链 → 内嵌素材 → 页脚（含「UNKNOWN 许可标识为未决项」说明）。
6. **幂等保证**：输出不含时间戳/机器路径/计数噪声；文件以固定 UTF-8 + 单个结尾换行写入 `THIRD-PARTY-NOTICES.md`（仓库根）。同一 `Cargo.lock` + `node_modules` 树下重复运行逐字节一致。

## 6. V1-PRD / docs/design 增补章节建议（实际存在的小节编号，已核对目录结构）

- `docs/V1-PRD.md`（任务 4.1）：
  - **L178 之后**（FR-9 表末行后、「## 4. 非功能需求」L180 之前）：新增 `### FR-10 发行前合规与数据披露（Issue #166）`，行表列：LICENSE 自洽文本要素、README 数据披露、EULA 弹窗披露点、`docs/compliance/search-sources.md` 逐源记录与未决事项、`THIRD-PARTY-NOTICES.md` 清单与随包分发、五源生产请求全 HTTPS。编号沿用 FR-9 序列，不重排既有章节（与 5.1a/5.1b 的「后插不重排」先例一致）。
  - **§4 非功能需求表（L182-191）**：「联网」行（L186）补「生产请求全部 HTTPS」；表尾新增「合规」行（许可/披露/归属清单随包分发）。
  - **§7 技术栈与架构表酷狗行（L357）**：端点明示 `https://complexsearch.kugou.com` 与 `https://lyrics.kugou.com`。
  - **§8 验收标准（L380-396）**：追加第 16 条——LICENSE 无矛盾授权、README/LICENSE/弹窗三者口径一致且无 BUSL 表述、清单覆盖运行时依赖与内嵌素材且重跑幂等、五源默认端点无明文 HTTP。
- `docs/design/design.md`（任务 4.2）：**§10.3 内 L403「惰性拉取」段之后、L405「更新检查（Issue #158）」段之前**插入「数据披露与传输加密（Issue #166）」段：五源默认端点全 HTTPS 清单、发送字段（title/artist/album）、触发与降级语义（6s 单源超时、`all_failed` 会话离线）、响应内 URL 升级防御保留。该文档现无端点 URL 记载（已核对），本段为首次落档，不与既有行文冲突。

## 7. 风险

- 酷狗 HTTPS 在个别网络环境可能不可用 → 单源降级语义兜底（既有）；Tester 实测连通（任务 5.1 附加 curl 检查，失败如实记录，不算业务回归）。
- 许可文本不构成法律意见 → 合规记录未决事项明示；PR 不宣称完成 issue 的法律审查验收项。
- `bundle.resources` 配置错误仅在打包阶段暴露 → `--no-bundle` 跳过打包、可能测不出（初始稿方案在此点不足）：任务 5.4 优先 `npx tauri build --bundles app` 验证 resources 实际复制（检查 .app 内文件存在），时间受限才降级 `--no-bundle` 并把局限记入 progress。
- `../` 相对资源在 .app 内可能落为 `_up_/` 前缀路径 → 验收以「文件存在于包内」为准，不强求路径形态；实际落点记入 3.1 文档。
- 守卫测试先行红灯（LICENSE/README 重写期间）→ 1.1/1.2 与守卫更新同任务原子提交，checkpoint 不落在半改状态。

## 8. 验证计划

- Rust：`cargo check --all-targets`、`cargo test --all-targets`（含新增 `searcher_https_tests.rs` 两用例）；附加 curl 实测酷狗三 https 端点。
- 前端：`npm run build`（vue-tsc）、`npm run test`（protocol-content 守卫 + eula-dialog 用例）。
- 脚本：连续两次运行 notices 脚本零 diff。
- 打包：`npx tauri build --bundles app`（验证 bundle.resources；降级方案 `--no-bundle` 见 §7）。
- 规格：`npx --yes @fission-ai/openspec@1.5.0 validate issue-166 --strict --no-interactive`（AGENTS.md 口径）。
- 传输加密：由 2.2 结构守卫测试自动化覆盖（初始稿的「Tester 手工扫描」降为可选复核）。
