# MusicTag — 项目总览

> 本文件是仓库根的**总索引/总览**：回答「这是什么项目、权威文档在哪、关键约束是什么、完整规则去哪看」。
> **详细规则**（常用命令、OpenSpec/pipe 变更管理、GitHub/Git 约定、工作流约定、语言、7 角色协作）全部在 `.claude/CLAUDE.md`，本文件不重复全量。

## 项目是什么

一次**一首**地给本地裸 FLAC/MP3 补全元数据（歌名、作者、专辑、封面、歌词）的跨平台桌面工具。
工具线 · 自用 · 纯本地取向。目标播放器：自研播放器 + Slat Player。无批量（批量是 V2）、无在线曲库、无账号。

## 文档入口（权威）

- `docs/V1-PRD.md` —— 产品需求文档（含验收标准），产品行为以此为最终权威
- `docs/design/design.md` —— 技术设计（Tauri command 契约 §10、前端结构等）
- 记忆 `music-tag-v1-spec.md` —— V1 定稿规格摘要

改产品行为：**先同步上面两份文档，再改代码**。

## V1 关键约束（精要）

详细每条见 `.claude/CLAUDE.md`「V1 关键约束」。

- 一次一首：无批量编辑
- 选中即搜：选中那一刻仅对**缺失**的歌词/封面自动联网搜索（网易云+QQ+咪咕并发聚合）；已有则不搜，删除后不自动再触发
- 结果不自动写盘：候选一律列表展示、**手动点选**才填入；切歌即弃
- 保存 = 表单全量覆盖：填了就存、不填即清空删除；无空字段保护、无自动继承/补全
- 直接写盘：无备份、无撤销；标签始终写回原路径；改名是独立动作；撞名拒绝覆盖
- MP3 统一写 **ID3v2.4**（lofty 默认，勿用 `use_id3v23`）
- 坏标签只读：`open_song` 读标签失败 → 表单只读禁用，提示「标签损坏，只读」
- 保存失败：表单内容保留可重试，顶栏标「✕ 保存失败：原因」，dirty 保持 true，绝不假报已保存
- 离线降级：会话内首次自动搜索全源失败 → 标记离线，后续选中不再自动搜，只留手动搜索按钮

## 技术栈（精要）

- 外壳 **Tauri 2 + Rust**；前端 **Vue 3 + Vite + TypeScript**（`<script setup>`，单 store 不用 Pinia）
- 标签读写 **lofty**：MP3 写 ID3v2.4（USLT/APIC 全支持）、FLAC Vorbis（`LYRICS`/PICTURE 全支持）
- 其余：`image`（封面压缩）、`walkdir`（遍历）、`rfd`（对话框）、`reqwest`+`serde_json`（搜索）、`tokio`（并发）、`aes`+`cbc`+`rsa`+`rand`（网易云加密）
- 封面跨 IPC 用 base64 data URL，写盘时 Rust 解码回原始字节

## 规则详情入口

常用命令、OpenSpec/pipe 变更管理、GitHub/Git 约定、工作流约定、语言与沟通、7 角色多 Agent 协作的**全量细节都在 `.claude/CLAUDE.md`** —— 实现前必读、实现时必服从。

## 快速上手

```sh
npm run tauri dev    # 起 Tauri 开发窗口（外壳）
cargo test --manifest-path src-tauri/Cargo.toml   # 后端单元/集成测试
npm run build        # 前端构建
```

文档入口：`docs/V1-PRD.md`（产品需求）、`docs/design/design.md`（技术设计）。
