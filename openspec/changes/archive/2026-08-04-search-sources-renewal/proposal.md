## Why

三源搜索接口在 2026-08 前后**全部失效**（Issue #84 本机实测 + 外部调研交叉验证）：「搜索封面」「搜索歌词」均返回空结果、无任何提示。网易云 `weapi/cloudsearch/get/web` 被风控（`{"code":50000005}` / 空 body）；QQ `musicu.fcg` `DoSearchForQQMusicDesktop` 返回内层 `code:2001` 空列表；咪咕 `scr_search_tag` + `getLyric` 端点废弃（301 → SPA HTML）。参照库 music-tag-web 的 service 文件 2023 年后未维护，其 GitHub Issue #643/#644 同批症状。代码侧无 bug（网易云加密正确、searcher 51 个单测全绿），纯属外部接口漂移。

## What Changes

- **网易云搜索换活口**：`weapi/cloudsearch/get/web` → `/api/linux/forward` 转发 `/api/cloudsearch/pc`（复用既有 `crypto::linuxapi`，已实测可用，响应结构不变、解析代码不动）。
- **QQ 搜索换活口**：`musicu.fcg` `DoSearchForQQMusicDesktop` → `c.y.qq.com/soso/fcgi-bin/client_search_cp` GET（已实测可用；取词接口 `fcg_query_lyric_new.fcg` 仍正常，不动）。
- **咪咕替换为酷狗**：咪咕两个端点全死、无签名新接口；换酷狗 `complexsearch.kugou.com/v2/search/song`（MD5 签名，已实测可用；新增 `md5` 依赖，签名纯 Rust 实现无需 JS 引擎）。
- **新增公共源并发（混合兜底）**：LRCLIB（歌词，`lrclib.net/api/get|search`，零鉴权）+ iTunes Search（封面，`itunes.apple.com/search?country=CN`，零鉴权）作为第 4/5 个并发源，实现 `MusicSource` trait。中文源命中时打分优先，公共源自然补缺/兜底。
- **适配五源语义**：`source_stats`、`all_failed`（离线判定）、打分去重、`source_rank` 从三源扩展为五源。

## Capabilities

### New Capabilities
（无——公共源与酷狗均并入既有 `search-sources` 能力的源模型，不新增独立能力文件）

### Modified Capabilities
- `search-sources`: 源模型从「网易云 + QQ + 咪咕 三家」扩展为「网易云 + QQ + 酷狗 + LRCLIB + iTunes 五家」；网易云搜索改走 linuxapi 转发、QQ 搜索改走 `client_search_cp`、咪咕移除换酷狗、新增 LRCLIB（歌词）与 iTunes（封面）并发源；`all_failed`/`source_stats`/离线判定随之适配五源。

## 关联 Issue

GitHub Issue：`#84`（分支提交 `feat(84): ...`、PR `Closes #84`）

## Impact

- `src-tauri/src/service/searcher/`：`netease.rs`（搜索端点改 linuxapi 转发）、`qqmusic.rs`（搜索端点改 `client_search_cp` + 解析）、`migu.rs`（**删除**）、新增 `kugou.rs`（MD5 签名）、`lrclib.rs`、`itunes.rs`；`mod.rs`（源列表/顺序/`source_rank` 扩展为五源）。
- `src-tauri/Cargo.toml`：新增 `md5` 依赖（酷狗签名）。
- `src-tauri/src/model.rs`：`MusicSourceId` 枚举扩展（新增 `Kugou`/`Lrclib`/`Itunes`，移除 `Migu`）。
- 前端：`src/api/types.ts`（`MusicSourceId` 值域同步）、`src/store/selectors.ts`（`sourceLabel` 文案）。
- 契约：`search_song`/`search_source`/`fetch_lyric` 签名不变，仅 `MusicSourceId` 值域扩展。
- 文档同步：`docs/V1-PRD.md`（FR-8.5 搜索源）、`docs/design/design.md`（§7 多源搜索架构）、`openspec/specs/search-sources/spec.md` 主规格。
