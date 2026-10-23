## Why

Issue #166 要求开展发行前法律与合规审查，初步发现五类问题：`LICENSE` 文本内部冲突（第 1 条授予再分发、附加限制第 3 条禁止再分发）；歌词/封面的权利链无逐源可追溯记录；第三方数据披露不具体（未说明发送字段、接收方、触发时机）；酷狗搜索与歌词接口使用明文 HTTP；发行物缺第三方依赖与素材归属清单。

本 change 落地其中工程可执行的部分。需要用户或法律顾问完成的事项（发行地区确认、法律顾问审阅、平台接口授权确认）在合规记录中列为未决事项，不预设法律结论，不在本 change 内宣称完成。

GitHub Issue: #166

## What Changes

- 重写 `LICENSE` 为单一自洽的自定义许可文本（个人学习许可）：从授权起即收窄为个人学习与研究使用，消除「授予再分发 vs 禁止再分发」的矛盾；明确许可方、授权范围、禁止事项、担保免责、终止与存续、适用法域与 Change Date（2099-12-31 后按 GPL-2.0-or-later 提供）。既有禁止商用/转卖/再分发/AI 转写的意图全部保留，授权语义不放宽。
- 酷狗三端点默认改用 HTTPS（`complexsearch.kugou.com`、`lyrics.kugou.com`，已实测 HTTPS 可用），并新增规格要求：五源全部生产请求（搜索、取词、封面下载）SHALL 使用 HTTPS。
- README「外部 API 声明」扩充为具体数据披露：发送字段（歌名、歌手、专辑名）、接收方域名、触发时机（仅缺歌词/封面时自动搜、点选才下载）、不发送本地音频内容与文件路径、网络失败/离线降级行为；首次启动授权弹窗同步增加数据披露要点。
- 新增 `docs/compliance/search-sources.md`：五源逐源记录接口调用方式、发送字段、返回内容用途、公开条款/接口文档链接、处理决定与未决事项（可追溯）。
- 新增 `THIRD-PARTY-NOTICES.md` 生成脚本与生成物：覆盖 Cargo 全部依赖、npm 运行时依赖闭包、npm 构建工具链（标注不随应用分发）与仓库内嵌第三方素材（含 OpenCC 繁简字典，Apache-2.0）；清单随应用打包（tauri bundle resources）。
- 同步 `docs/V1-PRD.md`、`docs/design/design.md`、README 软件协议章节与授权弹窗文案，保持文档与实际请求、许可文本一致。

## Capabilities

### New Capabilities
- `compliance-disclosure`: 逐源合规记录与第三方依赖/素材归属清单的维护要求。

### Modified Capabilities
- `search-sources`: 酷狗端点改 HTTPS，新增「生产请求传输加密」要求。
- `pre-release-check`: LICENSE 要求改为自洽许可文本；README 协议声明增加数据披露；授权弹窗增加数据披露要点。

## Impact

- `LICENSE`、`README.md`、`src/components/EulaDialog.vue`（+前端测试）。
- `src-tauri/src/service/searcher/kugou.rs`（+Rust 测试）；不改搜索行为、解析逻辑与既有 http→https 升级防御。
- 新增 `docs/compliance/search-sources.md`、`scripts/generate-third-party-notices.mjs`、`THIRD-PARTY-NOTICES.md`；`src-tauri/tauri.conf.json` 增加 bundle resources 一项。
- `docs/V1-PRD.md`、`docs/design/design.md` 与 OpenSpec 权威规格同步。
- 不新增任何 npm/Cargo 运行时依赖；脚本仅用 Node 内置能力与 `cargo metadata`。
