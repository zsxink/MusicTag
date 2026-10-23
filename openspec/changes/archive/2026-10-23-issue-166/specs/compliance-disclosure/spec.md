## ADDED Requirements

### Requirement: 逐源合规记录
仓库 SHALL 维护 `docs/compliance/search-sources.md`：对网易云、QQ 音乐、酷狗、LRCLIB、iTunes 逐一记录接口域名与调用方式、发送字段、返回内容的用途边界（候选展示、点选填入表单、嵌入本地文件、导出 `.lrc`；不下载音频）、公开条款或接口文档链接、已知限制与下架/联络途径（可得时）、以及当前处理决定。仅能依据公开资料整理，SHALL 标注记录的核实状态；需要用户或法律顾问决定的事项（发行地区确认、法律顾问审阅、平台接口授权确认、无明确授权来源的处理）SHALL 列入未决事项清单并注明负责方，SHALL NOT 被表述为已完成或已获授权。

#### Scenario: 五源记录齐全
- **WHEN** 阅读合规记录
- **THEN** 五个来源各有记录小节，含接口域名、发送字段、返回内容用途、条款/文档链接与当前处理决定

#### Scenario: 未决事项可追溯
- **WHEN** 阅读合规记录的未决事项清单
- **THEN** 发行地区确认、法律顾问审阅、平台接口授权确认等事项被记录为待用户/法律顾问完成，未决事项与已完成事项可区分

### Requirement: 第三方依赖与素材归属清单
仓库 SHALL 提供 `THIRD-PARTY-NOTICES.md` 及生成脚本 `scripts/generate-third-party-notices.mjs`（仅用 Node 内置能力与 `cargo metadata`，不新增依赖）。清单 SHALL 覆盖：Cargo 全部依赖（随二进制分发）；npm 运行时依赖及其传递闭包（随前端资源分发）；npm 构建工具链（标注不随应用分发）；仓库内嵌的第三方数据与素材（含繁简归一化 OpenCC 字典及其 Apache-2.0 许可、应用图标及来源状态）。依赖项 SHALL 含名称、版本、许可标识与来源链接；内嵌素材 SHALL 含文件路径、来源与许可。清单 SHALL 随应用打包（tauri bundle resources）。生成 SHALL 幂等：对同一依赖树重复运行输出不变。

#### Scenario: 清单覆盖运行时依赖
- **WHEN** 运行 `node scripts/generate-third-party-notices.mjs`
- **THEN** `THIRD-PARTY-NOTICES.md` 包含 Cargo 全部依赖与 npm 运行时依赖闭包（`@tauri-apps/api`、`vue` 及其传递依赖）的名称、版本与许可标识

#### Scenario: 内嵌素材有归属
- **WHEN** 阅读清单的内嵌素材章节
- **THEN** OpenCC 繁简字典（前后端两处内嵌）以 Apache-2.0 归属记录在案，应用图标来源状态有明确记录

#### Scenario: 生成幂等
- **WHEN** 连续两次运行生成脚本
- **THEN** 第二次运行后 `THIRD-PARTY-NOTICES.md` 内容无变化

#### Scenario: 清单随包分发
- **WHEN** 检查 `src-tauri/tauri.conf.json` 的 bundle 配置
- **THEN** `THIRD-PARTY-NOTICES.md` 在 bundle resources 中，随应用安装包分发
