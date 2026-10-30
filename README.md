<p align="center">
  <img src="icon/musictag.png" alt="MusicTag" width="96" />
</p>

# MusicTag

<p align="center">
  <img src="https://img.shields.io/badge/版本-v0.2.2-blue.svg" alt="version" />
  <img src="https://img.shields.io/badge/Tauri-2-green.svg" alt="tauri" />
  <img src="https://img.shields.io/badge/Rust-orange.svg" alt="rust" />
  <img src="https://img.shields.io/badge/Vue%203-green.svg" alt="vue" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-个人学习许可-red.svg" alt="license" /></a>
  <a href="https://github.com/zsxink/MusicTag/releases"><img src="https://img.shields.io/badge/Downloads-Releases-blue.svg" alt="releases" /></a>
</p>

## v0.2.2 更新

- 修复保存后原文件权限丢失：保存音频或覆盖已有 `.lrc` 时保留原文件权限位（Linux/macOS）；新建 `.lrc` 与 Windows 行为不变。

## v0.2.1 更新

- 将可用更新提示标记调整为紧凑的红点。

## v0.2.0 更新

- 改进 Homebrew Cask 维护：增加基于 GitHub 最新正式版的 `livecheck` 检查；普通卸载会先退出 MusicTag，用户可选择运行 `brew uninstall --zap --cask musictag` 清理应用数据目录。
- 将「打开文件夹」入口调整为全局顶栏文件夹图标；保留无障碍名称、悬停提示和 ⌘O/Ctrl+O 快捷键。

## v0.1.5 更新

- 新增 macOS Homebrew 安装渠道：可通过 `brew install zsxink/tap/musictag` 安装；Release 发布且 tap 同步成功后，可使用 `brew upgrade --cask musictag` 升级。
- 三端新增原生应用菜单（文件/编辑/视图/帮助），更新检查等操作可从「帮助」菜单使用。
- 更新检查新增节流：启动时距上次成功检查至少 7×24 小时才会自动检查；「帮助」菜单手动检查不受限。
- 发行前合规整改：许可统一为个人学习许可并与 EULA 一致，README 增加「外部 API 声明」数据披露，新增第三方归属清单 `THIRD-PARTY-NOTICES.md`，搜索与封面请求全部使用 HTTPS。

## v0.1.4 更新

- 新增稳定版更新检查，可在启动时检查，也可从“帮助”菜单手动检查；“关于 MusicTag”展示当前版本和最近检查结果。发现新版后，用户可主动打开对应的 GitHub Release 页面查看详情。
- 推荐本地优先的跨平台音乐播放器 [Echo](https://github.com/zsxink/Echo)，其发行版可在 [Echo Releases](https://github.com/zsxink/Echo/releases) 获取。
- 修复 PostCSS 间接依赖中的 nanoid 版本问题。

## 项目简介

MusicTag 是一个跨平台桌面工具，**逐首**为本地音乐文件补全元数据（歌名、作者、专辑、封面、歌词）：选中歌曲自动联网搜索候选，点选填入，直接写回原文件。

**这是一个个人学习用途的软件**，用于理解桌面应用开发（Tauri + Rust + Vue）、音频元数据读写与多源网络搜索的工程实践。**禁止用于任何商业用途**。

## 功能特性

- **支持格式**：FLAC / MP3 / APE / WAV / M4A
- **编辑音乐标签**：歌名、作者、专辑、专辑作者、音轨号、年份、流派
- **编辑封面**：点选或拖拽嵌入图片
- **编辑歌词**：内嵌歌词，可同时导出 .lrc
- **自动搜索**：选中歌曲后，对缺失的歌词与封面自动联网搜索（网易云、QQ 音乐、酷狗、LRCLIB、iTunes 多源并发），候选手动点选后写入

## 推荐：Echo 音乐播放器

[Echo](https://github.com/zsxink/Echo) 是一款本地优先的跨平台音乐播放器，用于管理和聆听本地曲库；MusicTag 则用于补全本地音乐文件的元数据。可前往 [Echo 发行版页面](https://github.com/zsxink/Echo/releases) 获取版本。

## macOS Homebrew 安装

通过公开的 [zsxink/homebrew-tap](https://github.com/zsxink/homebrew-tap) 安装 MusicTag，无需登录 GitHub：

```sh
brew install zsxink/tap/musictag
```

发布新版本并完成 tap 同步后，可更新 Homebrew 信息并升级：

```sh
brew update && brew upgrade --cask musictag
```

新版本会在 MusicTag Release 发布且 tap 同步成功后提供。

### 维护者：Homebrew 发布

- 在 MusicTag 仓库配置 `HOMEBREW_TAP_TOKEN` Actions Secret。令牌只需对 `zsxink/homebrew-tap` 有 **Contents: read and write** 权限（以及 GitHub 要求的 Metadata 读取权限）；不要授予 MusicTag 仓库写权限。
- 发布 `v*` tag 后，Release 先以 draft 承载三端安装包；Windows、macOS（aarch64 / x86_64 双架构）与 Linux 构建上传全部成功后，release 工作流自动把该 draft 转为已发布，并自动触发 tap 同步——常规路径无需任何人工操作。资产名称必须分别为 `MusicTag_<版本>_aarch64.dmg` 和 `MusicTag_<版本>_x64.dmg`，例如 `MusicTag_0.1.4_aarch64.dmg` 与 `MusicTag_0.1.4_x64.dmg`。
- 失败兜底：任一平台构建或上传失败时，自动发布不执行，Release 保留 draft；自动发布步骤自身失败（如 GitHub API 瞬时故障重试耗尽）同样保留 draft。修复后可重跑发布工作流，或由维护者在 GitHub 上手动 publish 该 draft，发布事件照常触发 tap 同步。若转正已成功而 tap 派发失败（Release 已发布），直接在 Actions 手动运行 **Homebrew Tap** 工作流并输入该 tag 重试。
- 若 tap 同步失败，已发布的 Release 和 DMG 不受影响；检查 Secret 权限、资产是否齐全及 tap 写入策略，修复后在 Actions 中手动运行 **Homebrew Tap** 工作流，并将 tag（如 `v0.1.4`）作为输入重试。工作流不会把缺少资产或无权限的状态当作成功。

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

### 外部 API 声明与数据披露

- 本软件使用**外部网络 API**（网易云、QQ 音乐、酷狗、LRCLIB、iTunes）用于搜索歌词与封面元数据。
- 这些 API 的调用**基于公开资料**（接口文档、公开接口行为）实现，仅用于获取元数据，**不用于获取任何音频内容**。
- 对外部 API 的使用**仅供个人学习与研究**，请遵守各平台的服务条款与当地法律法规。因使用外部 API 产生的任何问题，与本软件作者无关。
- **发送字段**：自动搜索仅向上述服务发送歌曲标题、歌手、专辑名的文本查询词；**不发送本地音频内容**，也不发送**本地文件路径**。
- **接收方域名**：`music.163.com`、`c.y.qq.com`、`complexsearch.kugou.com`、`lyrics.kugou.com`、`lrclib.net`、`itunes.apple.com`；点选下载封面时另会请求图片域 `music.126.net`（网易云）、`y.qq.com`、`imge.kugou.com` 与 `mzstatic.com`。生产请求全部使用 HTTPS。
- **触发时机**：选中歌曲且缺失歌词或封面时才自动搜索；歌词/封面候选只有你手动点选时才会下载，切歌即弃。
- **失败行为**：单个来源请求失败或超时（搜索 6 秒、封面下载 5 秒）仅该源降级为空结果，不影响其他来源；全部来源失败后会话进入离线降级，不再自动联网（手动搜索按钮仍可随时主动发起）。

### 个人用途声明

- 本软件**仅限个人学习与研究使用**，**禁止用于任何商业用途**，包括但不限于：商业运营、商业分发、商业性内容整理、批量抓取等。
- 使用本软件获取的任何元数据，仅供个人学习参考，**不得用于侵犯任何第三方权益**。

### AI 转写声明

- **禁止使用 AI 对本软件进行转写、重写或再创作**（包括但不限于：将本软件代码转译为其他语言、基于本软件生成衍生实现、用 AI 重写本软件逻辑后发布）。
- 若有人用 AI 转写、改编或衍生实现了本软件，**该转写/衍生作品与本软件无关**，其行为与后果由该转写者自行承担，本软件作者不承担任何责任。

## 软件协议（License）

- 本软件采用自洽的**个人学习许可**（`LICENSE`，MusicTag Personal Learning License）。
- **仅授权个人学习与研究用途**的复制、修改、运行；**禁止任何商业用途**。
- **禁止私自销售、转卖、出租**本软件（含修改后版本）。
- **禁止再分发**（未经书面许可）。
- **禁止使用 AI 转写、重写或再创作**本软件；若有人 AI 转写，该转写/衍生作品与本软件无关。
- Change Date：**2099-12-31**，届时起本软件按 **GPL-2.0-or-later** 提供。
- 本软件按「现状」提供，**不附带任何担保**，因使用本软件造成的任何直接或间接损失，作者不承担责任。
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
