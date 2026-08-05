<p align="center">
  <img src="icon/musictag.png" alt="MusicTag" width="96" />
</p>

# MusicTag

## 项目简介

MusicTag 是一个跨平台桌面应用，为本地音乐文件补全元数据（歌名、作者、专辑、封面、歌词）。

**这是一个个人学习用途的软件**，用于理解桌面应用开发（Tauri + Rust + Vue）、音频元数据读写与多源网络搜索的工程实践。**禁止用于任何商业用途**。

## 功能特性

- **支持格式**：FLAC / MP3
- **编辑音乐标签**：歌名、作者、专辑、专辑作者、音轨号、年份、流派
- **编辑封面**：点选或拖拽嵌入图片
- **编辑歌词**：内嵌歌词，可同时导出 .lrc
- **自动搜索**：选中歌曲后，对缺失的歌词与封面自动联网搜索（网易云、QQ 音乐、酷狗、LRCLIB、iTunes 多源并发），候选手动点选后写入

## 技术栈

- 外壳 **Tauri 2** + **Rust**
- 标签读写 **lofty**（MP3 写 ID3v2.4、FLAC Vorbis `LYRICS`/`PICTURE`、MP3 `USLT`/`APIC`）
- 前端 **Vue 3** + **Vite** + **TypeScript**（`<script setup>`，单 store 不用 Pinia）
- 其余：`image`（封面压缩）、`walkdir`（遍历）、`rfd`（对话框）、`reqwest` + `tokio`（搜索）、`aes`/`cbc`/`rsa`（网易云加密）

## 使用声明与免责条款

> **请在使用本软件前仔细阅读以下声明。使用即视为同意。**

### 音频内容声明

- 本软件**不提供任何音频文件**，也不提供任何音频文件的**下载、抓取或存储**功能。
- 本软件仅操作**你自己本地的音乐文件**，读取并补全其元数据标签。

### 外部 API 声明

- 本软件使用**外部网络 API**（网易云、QQ 音乐、酷狗、LRCLIB、iTunes）用于搜索歌词与封面元数据。
- 这些 API 的调用**基于公开资料**（接口文档、公开接口行为）实现，仅用于获取元数据，**不用于获取任何音频内容**。
- 对外部 API 的使用**仅供个人学习与研究**，请遵守各平台的服务条款与当地法律法规。因使用外部 API 产生的任何问题，与本软件作者无关。

### 个人用途声明

- 本软件**仅限个人学习与研究使用**，**禁止用于任何商业用途**，包括但不限于：商业运营、商业分发、商业性内容整理、批量抓取等。
- 使用本软件获取的任何元数据，仅供个人学习参考，**不得用于侵犯任何第三方权益**。

### AI 转写声明

- **禁止使用 AI 对本软件进行转写、重写或再创作**（包括但不限于：将本软件代码转译为其他语言、基于本软件生成衍生实现、用 AI 重写本软件逻辑后发布）。
- 若有人用 AI 转写、改编或衍生实现了本软件，**该转写/衍生作品与本软件无关**，其行为与后果由该转写者自行承担，本软件作者不承担任何责任。

## 软件协议（License）

- 本软件采用 **Business Source License 1.1** 结构（`LICENSE`），附加个人学习用途限制。
- **仅授权个人学习与研究使用**；**禁止任何商业使用**。
- **禁止私自销售、转卖、出租**本软件（含修改后版本）。
- **禁止再分发**（未经书面许可）。
- **禁止使用 AI 转写、重写或再创作**本软件；若有人 AI 转写，该转写/衍生作品与本软件无关。
- Change Date：**2099-12-31**（此前长期受本协议限制）。
- 本软件**不附带任何担保**，因使用本软件造成的任何直接或间接损失，作者不承担责任。
- 完整条款见 [LICENSE](LICENSE)。

## 常用命令

```sh
# 前端
npm run dev              # 启动 Vite（浏览器态）
npm run build            # 前端构建（vue-tsc 类型检查 + vite build）

# 外壳（Tauri）
npm run tauri dev        # 起 Tauri 开发窗口
npm run tauri build      # 打包

# 后端（Rust，manifest 路径 src-tauri/Cargo.toml）
cargo check --manifest-path src-tauri/Cargo.toml
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
```

## 文档入口

- [docs/V1-PRD.md](docs/V1-PRD.md) —— 产品需求文档（含验收标准，为定稿权威）
- [docs/design/design.md](docs/design/design.md) —— 技术设计（Tauri command 契约 §10、前端结构等）

新增/修改产品行为时，先同步这两份文档再动手改代码。

## 协作流程

- **Issue 驱动**：任何变更（新功能/规格/修复）动手前**必须先建 GitHub Issue** 作为锚点；PR 描述引用 `Closes #<issue>`，合并即自动关闭对应 Issue。
- **pipe 工作流**：`/pipe <name>` 一键全自动闭环——前置校验 → 设计 → 开发 → 测试 → CR → 最终验证 → 归档 → 提交 PR → 合并；唯一强制确认点是 PRD 批准。
