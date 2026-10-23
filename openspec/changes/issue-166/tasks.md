# issue-166 任务（Architect 细化稿）

> **执行顺序（依赖 DAG）**：1.1 → 1.2 → 2.1 → 2.2 → 1.3 → 3.1 → 3.2 → 3.3 → 4.1 → 4.2 → 5.1–5.5。
> **域判定：both**——Rust（2.1/2.2）先行，Vue（1.3）后行；1.1/1.2 为 docs+前端守卫测试（非 Vue 组件层，不受 Rust→Vue 约束，但受同文件顺序约束）；3.x/4.x 为 docs/infra。
> **文件所有权互不重叠**；唯一例外：`src/styles/protocol-content.test.ts` 由 1.1（LICENSE describe，L54-75）与 1.2（README describe，L17-52）**顺序编辑、同一 Dev、禁止并行派发**。

## 1. 许可与披露文本（docs + 前端守卫测试）

- [ ] 1.1 重写 `LICENSE` 为自洽自定义许可（docs）
  - **文件所有权**：`LICENSE`（全量重写）；`src/styles/protocol-content.test.ts` 仅 L54-75 LICENSE describe
  - **对应 spec**：pre-release-check ADDED「LICENSE 自洽许可文本」（REMOVED「LICENSE 基于 BUSL 1.1 结构」）
  - **要点**：许可方（MusicTag 作者，GitHub @zsxink——现文本缺 handle，须补）；授权范围=仅个人学习与研究的复制/修改/运行（授权起即收窄）；禁止事项（商用、私自销售/转卖、未经书面许可再分发、AI 转写）与授权零矛盾；版权声明保留；无担保；违约终止与存续、可分割性；适用法域=中华人民共和国法律；Change Date 2099-12-31 → GPL-2.0-or-later
  - **验收**：LICENSE 无「授予再分发（现 L18）vs 禁止再分发（现 L54-55）」矛盾；无 BUSL 1.1 表述；`npx vitest run src/styles/protocol-content.test.ts` LICENSE describe 全绿
  - **依赖**：无（首任务）

- [ ] 1.2 README 数据披露 + 软件协议章节同步（docs）
  - **文件所有权**：`README.md`（L12 徽章、L84-88 外部 API 声明、L100-109 软件协议章节）；`src/styles/protocol-content.test.ts` 仅 L17-52 README describe + 新增披露守卫用例
  - **对应 spec**：pre-release-check「README 协议声明」（场景「README 含数据披露」「README 与 LICENSE 一致」）
  - **要点**：L12 License 徽章去 BUSL；L84-88 扩充数据披露（发送字段=歌名/歌手/专辑名；接收方=五源域名；触发=选中且缺失才自动搜、点选才下载；不发送本地音频内容与文件路径；单源降级 + 全源失败会话离线降级）；L100-109 与新 LICENSE 口径一致（含 Change Date 2099-12-31）
  - **验收**：守卫测试断言 README 无 BUSL 且披露要点齐全；披露口径与 3.1 产出互校一致
  - **依赖**：1.1（同文件顺序编辑 + 口径对齐 LICENSE）

- [ ] 1.3 `EulaDialog.vue` 协议要点增加数据披露 + 前端测试（Vue，在 2.x 之后）
  - **文件所有权**：`src/components/EulaDialog.vue`（L71-76 协议要点 `ul`、L77 footnote）；`src/components/eula-dialog.test.ts`（L28-57 describe 内新增用例）
  - **对应 spec**：pre-release-check「首次打开授权确认弹窗」场景「弹窗含数据披露要点」
  - **要点**：外部 API `li`（L75）后新增一条：自动搜索仅向第三方搜索服务发送歌名、歌手、专辑文本，不发送音频内容与本地路径；footnote（L77）去掉「（Business Source License 1.1）」
  - **验收**：`npm run test` 全绿（新增 `it` 断言披露关键词；既有 L40-47 用例不动仍绿）；`npm run build`（vue-tsc）通过
  - **依赖**：1.1（footnote 口径）；**2.1/2.2（Rust → Vue 顺序约束）**

## 2. 传输加密（Rust → Vue 顺序）

- [ ] 2.1 `kugou.rs` 三默认端点改 HTTPS（Rust）
  - **文件所有权**：`src-tauri/src/service/searcher/kugou.rs`（仅 L36-38 三个默认端点字符串；L5/L11 头注释同步措辞）
  - **对应 spec**：search-sources MODIFIED「酷狗签名搜索」场景「默认端点全为 HTTPS」
  - **要点**：`search_url`/`lyric_search_url`/`lyric_download_url` → `https://`；**不动** L246-260 `kugou_cover_url`（含 L251-255 http→https 升级防御）与搜索/解析/超时逻辑
  - **验收**：`cargo check --manifest-path src-tauri/Cargo.toml` 通过；既有 `tests/searcher_kugou_tests.rs` 全绿（已核对：现无用例锚定 http 默认值）
  - **依赖**：无

- [ ] 2.2 全源端点加密结构守卫测试（Rust）
  - **文件所有权**：`src-tauri/tests/searcher_https_tests.rs`（新增；不得改动 `searcher_kugou_tests.rs` 等既有测试文件）
  - **对应 spec**：search-sources ADDED「生产请求传输加密」（场景「全源端点加密」「响应内 URL 升级」）
  - **要点**：用例 A `kugou_default_endpoints_are_https`——`Kugou::default()` 三字段均以 `https://` 开头；用例 B `searcher_sources_have_no_plaintext_http_endpoints`——经 `env!("CARGO_MANIFEST_DIR")` 扫描 `src/service/searcher/*.rs`，含 `"http://` 字面量的行只允许为防御性升级调用（`strip_prefix(`/`replace(`，现白名单 `kugou.rs:251`、`netease.rs:187`）
  - **验收**：`cargo test --all-targets` 两用例通过；人工把任一默认端点临时改回 http 能红灯（自查后还原）
  - **依赖**：2.1（先改默认值再上守卫，否则守卫红灯）

## 3. 合规与归属（docs / infra）

- [ ] 3.1 新增 `docs/compliance/search-sources.md`：五源记录 + 未决事项（docs）
  - **文件所有权**：`docs/compliance/search-sources.md`（新增，唯一写入者）
  - **对应 spec**：compliance-disclosure「逐源合规记录」（场景「五源记录齐全」「未决事项可追溯」）
  - **要点**：网易云/QQ/酷狗/LRCLIB/iTunes 各一节——接口域名与调用方式、发送字段、返回内容用途边界（候选展示/点选填入/嵌入本地文件/导出 .lrc；不下载音频）、公开条款或接口文档链接、核实状态标注、当前处理决定；末节「未决事项」单列（发行地区确认、法律顾问审阅、平台接口授权确认、无明确授权来源的处理；负责方=用户/法律顾问），与已完成事项可区分；酷狗端点记录为 https 后事实
  - **验收**：五源小节齐全；未决事项注明负责方且未被表述为已完成/已获授权
  - **依赖**：2.1（记录 https 端点须为事实后）

- [ ] 3.2 新增 `scripts/generate-third-party-notices.mjs` + 生成 `THIRD-PARTY-NOTICES.md`（infra）
  - **文件所有权**：`scripts/generate-third-party-notices.mjs`（新增）、`THIRD-PARTY-NOTICES.md`（脚本生成物，不手改）
  - **对应 spec**：compliance-disclosure「第三方依赖与素材归属清单」（场景「清单覆盖运行时依赖」「内嵌素材有归属」「生成幂等」）
  - **要点**：算法按 design.md §5——Cargo 普通依赖闭包（`cargo metadata --format-version 1`，`resolve.root` 起 `dep_kinds` 为空的边 BFS）、npm 运行时闭包（`package.json` `dependencies` 起 node_modules BFS）、npm 构建工具链（devDependencies 同法，标注不随应用分发）、内嵌素材静态数组（OpenCC 两表 Apache-2.0 + 图标待确认）；仅 Node 内置模块 + `cargo metadata`；名称/版本/许可标识/来源链接齐全；UTF-8 码元序排序、固定节序、无时间戳，重跑幂等
  - **验收**：连续两次运行零 diff；清单含 `@tauri-apps/api`、`vue` 及传递依赖；OpenCC 以 Apache-2.0 归属（出处 `src-tauri/src/service/searcher/opencc/README.md`）
  - **依赖**：无（建议排在 3.1 后便于交叉引用）

- [ ] 3.3 `src-tauri/tauri.conf.json` bundle resources 增加清单文件（infra）
  - **文件所有权**：`src-tauri/tauri.conf.json`（`bundle` 对象内新增 `"resources": ["../THIRD-PARTY-NOTICES.md"]`，唯一改动）
  - **对应 spec**：compliance-disclosure「第三方依赖与素材归属清单」场景「清单随包分发」
  - **验收**：5.4 打包校验时文件实际进入 .app Resources（`../` 可能落为 `_up_/` 前缀，以实际落点为准，回记到 3.1 文档）
  - **依赖**：3.2（清单文件先存在）

## 4. 文档同步（docs）

- [ ] 4.1 `docs/V1-PRD.md` 增补合规与数据披露（docs）
  - **文件所有权**：`docs/V1-PRD.md`（四个位置，见 design.md §6）
  - **对应 spec**：proposal「What Changes」末条 + AGENTS.md 权威文档同步约定（无独立 spec requirement）
  - **要点**：L178 后新增 `### FR-10 发行前合规与数据披露（Issue #166）`；§4 非功能表（L182-191）「联网」行（L186）补 HTTPS、表尾新增「合规」行；§7 表酷狗行（L357）端点明示 `https://`；§8（L380-396）追加验收第 16 条
  - **验收**：四位置落档，与 LICENSE/README/实际端点口径一致
  - **依赖**：2.1（https 端点为事实后）

- [ ] 4.2 `docs/design/design.md` 披露契约与传输加密段落（docs）
  - **文件所有权**：`docs/design/design.md`（§10.3 L403「惰性拉取」段后、L405「更新检查」段前插入一段，唯一改动）
  - **对应 spec**：proposal「What Changes」末条（无独立 spec requirement）
  - **要点**：「数据披露与传输加密（Issue #166）」段——五源默认端点全 HTTPS 清单、发送字段（title/artist/album）、触发与降级语义（6s 单源超时、`all_failed` 会话离线）、响应内 URL 升级防御保留
  - **验收**：`npm run test` 全绿（`design-layering.test.ts` 扫描本文件 §10 的守卫不受影响）
  - **依赖**：2.1

## 5. 验证（tester / leader）

- [ ] 5.1 Rust 验证（tester）：`cargo check --all-targets`、`cargo test --all-targets` 全绿；附加 `curl -sI` 实测酷狗三 https 端点连通（失败如实记录——单源降级兜底，不算业务回归）；（可选）grep 复核五源无明文 HTTP 端点（2.2 已自动化覆盖）
  - **依赖**：2.1、2.2
- [ ] 5.2 前端验证（tester）：`npm run build`、`npm run test` 全绿（含 protocol-content 守卫与 eula-dialog 用例）
  - **依赖**：1.1、1.2、1.3
- [ ] 5.3 notices 脚本幂等（tester）：连续两次运行 `node scripts/generate-third-party-notices.mjs` → `git diff --exit-code THIRD-PARTY-NOTICES.md`
  - **依赖**：3.2
- [ ] 5.4 bundle 校验（tester）：`npx tauri build --bundles app`，确认 `THIRD-PARTY-NOTICES.md` 进入 .app Resources（记录实际落点）；时间受限才降级 `npx tauri build --no-bundle`（仅编译 + 配置 schema 校验，resources 复制不覆盖）并把局限记入 progress
  - **依赖**：3.3
- [ ] 5.5 规格验证（leader/spec-gate）：`npx --yes @fission-ai/openspec@1.5.0 validate issue-166 --strict --no-interactive`
  - **依赖**：以上全部完成后
