# issue-166 设计（初始稿，Architect 细化）

Issue: #166 ｜ Domain: **both**（Rust kugou → Vue EulaDialog，其余 docs/infra）｜ 交叉写入按 Rust → Vue 顺序。

## 1. 边界

- 只改协议与披露，不改搜索行为：候选打分、聚合、解析逻辑、超时/降级语义全部不动。
- 许可重写只消除文本自相矛盾并明确要素，授权语义不放宽；不预设法律结论，法律审阅留作未决事项。
- 不新增 npm/Cargo 运行时依赖；`scripts/generate-third-party-notices.mjs` 仅用 Node 内置模块 + `cargo metadata`。

## 2. 决策

- **D1 LICENSE 采用自洽自定义文本，不采用标准 BSL 1.1 英文正文**：BSL 1.1 要求逐字采用标准文本且默认授权允许再分发/非生产使用，与作者既有「仅个人学习、禁止再分发」意图冲突；自定义文本从授权起收窄（个人学习与研究：复制、修改、运行），保留 Change Date 2099-12-31 → GPL-2.0-or-later、禁商用/转卖/再分发/AI 转写、声明保留、无担保、终止/存续/可分割性、适用法域（中华人民共和国法律）、许可方（MusicTag 作者，GitHub @zsxink）。README/EULA 弹窗同步去掉 BUSL 1.1 表述。注：这是 issue 给出的两个候选方向之一（「采用合适的自定义许可文本」）。
- **D2 酷狗三端点默认 HTTPS**（`kugou.rs:36-38`）：2026-10-24 实测三端点 HTTPS 均 200。保留 `http://`→`https://` 升级逻辑（kugou.rs:240-251，Issue #113 引入）作为响应内 URL 防御。新增规格「生产请求传输加密」覆盖五源全局要求。
- **D3 数据披露以「文档与实际请求一致」为准**：发送字段=歌名/歌手/专辑名（`mod.rs` `search_song(title, artist, album)`，LRCLIB 走 track/artist/album 参数）；接收方=五源域名（music.163.com、c.y.qq.com、complexsearch.kugou.com + lyrics.kugou.com、lrclib.net、itunes.apple.com；点选封面时另下载 y.qq.com/imge.kugou.com/mzstatic 图片）；触发时机=选中且缺歌词/封面才自动搜、点选才下载；不发送音频内容与本地路径；失败行为=单源 6s 超时降级、全源失败 `all_failed` → 会话离线降级。README + EulaDialog 弹窗同步。
- **D4 合规记录**：`docs/compliance/search-sources.md` 逐源整理公开条款/接口文档链接与处理决定；未决事项（发行地区、法律顾问审阅、平台接口授权、无授权来源的处置）单列，负责方=用户/法律顾问。
- **D5 归属清单**：Cargo 全量（`cargo metadata --format-version 1` 的 packages，全部随二进制分发）；npm 运行时闭包（从 package.json `dependencies` 起在 node_modules BFS）；npm 构建工具链（devDependencies 闭包，标注不随应用分发）；内嵌素材（`src/lib/simplified.ts`、`src-tauri/src/service/searcher/simplified.rs` 的 OpenCC TSCharacters/TSPhrases，Apache-2.0；`icon/musictag.png` 来源状态标注「待确认」）。输出确定性排序（UTF-8 字节序），重跑幂等。
- **D6 随包分发**：`src-tauri/tauri.conf.json` `bundle.resources` 增加 `THIRD-PARTY-NOTICES.md`；验证用 `npx tauri build --no-bundle`（配置校验 + 编译，不产 DMG）。
- **D7 文档同步**：V1-PRD 增补「合规与数据披露」章节；design.md 更新酷狗端点为 https 并记录披露契约；README 软件协议章节与 LICENSE 一致。

## 3. 风险

- 酷狗 HTTPS 在个别网络环境可能不可用 → 单源降级语义兜底（既有）；Tester 实测 HTTPS 连通。
- 许可文本不构成法律意见 → 合规记录未决事项明示；PR 不宣称完成 issue 的法律审查验收项。
- `bundle.resources` 配置错误仅在 tauri build 暴露 → Tester 执行 `tauri build --no-bundle` 验证。

## 4. 验证计划

- Rust：`cargo check --all-targets`、`cargo test --all-targets`（含酷狗端点断言）。
- 前端：`npm run build`（vue-tsc）、`npm run test`（EulaDialog 用例）。
- 脚本：连续两次运行 notices 脚本零 diff。
- 规格：`npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`。
- 传输加密：仓库扫描五源默认端点无明文 HTTP（Tester 执行）。
