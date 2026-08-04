# spec-review — 四源一致性复核报告

> 变更：`openspec/changes/spec-review`（Issue #52，Epic「项目基建初始化」#48）
> 复核基准：`src-tauri/src/lib.rs` 实际注册的 11 个 command 清单为唯一真值；`src/api/*.ts` 前端封装、`src-tauri/src/commands/cover.rs` 注释为旁证。
> 复核范围：`docs/V1-PRD.md`、`docs/design/design.md`、`openspec/config.yaml` + `openspec/specs/` 主规格、记忆 `music-tag-v1-spec.md`（仓库外）。
> 结论：发现 6 处真实不一致（design.md D1–D6），其中 5 处修订、1 处（D3 之外另有 §10.4 措辞）并入；另有 2 处新发现一并修订。无「仅报告、不修订」条目。
> 全部修订完成后，四源 command 清单与 `lib.rs` 注册完全一致（见 §6 diff 复核）。

## 差异清单

### D1 记忆 + openspec/config.yaml 仍列已废弃的 `embed_cover` command（陈旧）→ 修订

- `[openspec/config.yaml] context「Tauri command 契约」行 | 修订前 → 修订后`
  - 修订前：`Tauri command 契约（前端全走 invoke）：list_songs/open_song/save_song/rename_song/search_song/fetch_lyric/download_cover/embed_cover。`
  - 修订后：`Tauri command 契约（前端全走 invoke）：pick_folder/list_songs/open_song/save_song/rename_song/pick_cover_file/read_cover_path/search_song/search_source/fetch_lyric/download_cover（11 个，与 src-tauri/src/lib.rs 实际注册一致）；封面一律并入 save_song 写盘，无独立 embed_cover command。`
  - 理由：`embed_cover` 已废弃——PRD §7、design.md §10.3 已拍板「封面并入 save_song，无独立 embed_cover」；`lib.rs` 注册清单与 `commands/cover.rs` 注释均确认不存在该 command。同时补齐 config 遗漏的 `pick_folder`/`pick_cover_file`/`read_cover_path`/`search_source`（见 D5）。`src-tauri/src/lib.rs` 注册 11 个 command 为唯一真值。

- `[记忆 music-tag-v1-spec.md] 技术栈「Tauri command 契约」行 | 修订前 → 修订后`
  - 修订前：`**Tauri command 契约**（前端全走 invoke）：\`list_songs\`/\`open_song\`/\`save_song\`/\`rename_song\`/\`search_song\`/\`fetch_lyric\`/\`download_cover\`/\`embed_cover\`；封面跨 IPC 用 base64 data URL，写盘时 Rust 解码回原始字节。详见 \`design/design.md\` §10 与 \`V1-PRD.md\` §7。`
  - 修订后：`**Tauri command 契约**（前端全走 invoke）：\`list_songs\`/\`open_song\`/\`save_song(song, exportLrc)\`/\`rename_song\`/\`pick_cover_file\`/\`read_cover_path\`/\`search_song\`/\`search_source\`/\`fetch_lyric\`/\`download_cover\`（封面一律走 \`save_song\` 写盘，无独立 \`embed_cover\`）；封面跨 IPC 用 base64 data URL，写盘时 Rust 解码回原始字节。详见 \`design/design.md\` §10 与 \`V1-PRD.md\` §7。`
  - 理由：与 config.yaml 同源问题；记忆不随 PR/归档（仓库外），修订仅记录于此报告，后续会话以 docs/openspec 为准。

### D2 design.md §10.3 + PRD §7 遗漏 `pick_cover_file` / `read_cover_path`（遗漏）→ 修订

- `[docs/design/design.md] §10.3 Tauri command 契约表 | 修订前 → 修订后`
  - 修订前：command 表无封面选择/拖拽行（只有歌曲/搜索 8 行）。
  - 修订后：表补两行 `pick_cover_file()`（`() → Option<CoverInput>`，rfd 文件对话框）与 `read_cover_path(path)`（`String → Result<CoverInput, String>`，拖拽路径读 bytes）。
  - 理由：`v1-cover-embed` 已实现并注册（`lib.rs`：`commands::cover::pick_cover_file`、`read_cover_path`；`src/api/songs.ts` 已封装）；§10.0 分层规范要求所有 command 记录在契约表。另将 `search_source` 行内注释由「v1-search-fixes，C2 换源用」改为稳定描述（不依赖变更名，见 3.2）。

- `[docs/V1-PRD.md] §7「Tauri command 全量」清单 | 修订前 → 修订后`
  - 修订前：`文件：list_songs/open_song/save_song(song, exportLrc)/rename_song` + 搜索 4 行；缺 `pick_folder`、`pick_cover_file`、`read_cover_path`。
  - 修订后：`文件：pick_folder()/list_songs(dir)/open_song(path)/save_song(song, exportLrc)/rename_song(path, new_name)/pick_cover_file()/read_cover_path(path)`，`搜索` 4 行保留。
  - 理由：`pick_folder` 是打开文件夹入口（`commands/folder.rs`、`src/api/songs.ts pickFolder` 均已实现），§7 command 全量清单应含；封面选择/拖拽两 command 同 D2 design 侧，一并补齐。`pick_cover_file`/`read_cover_path` 返回 `CoverInput`（data_url+mime），`read_cover_path(path) -> Result<CoverInput, String>`（读失败 → 中文 Err）。

### D3 记忆 `has_lyrics` / `has_cover` 字段为早期设计残留（陈旧）→ 修订

- `[记忆 music-tag-v1-spec.md] 技术栈「列表加载模型」行 | 修订前 → 修订后`
  - 修订前：`...放进编辑区；\`has_lyrics\`/\`has_cover\` 跟随读出的完整 \`Song\`（搜索判定用）。`
  - 修订后：`...放进编辑区；缺失判定 = \`lyrics_source === 'none'\`（无内嵌且无 .lrc）/ \`cover === null\`（无封面）。`
  - 理由：PRD §6 `Song` struct 与 design.md §10.3 TS `Song` 接口均无 `has_lyrics`/`has_cover` 字段；代码 `model.rs` 亦无。缺失判定由 `lyrics_source: 'embedded'|'sidecar'|'none'` 与 `cover: string | null` 承担。该行另「按需读取」描述正确（`list_songs` 只返回 `SongSummary{path,title,artist}`、选中才 `open_song` 读全量 + 封面 base64），保留。

### D4 PRD §7 多源搜索模块结构停留在重构前（陈旧）→ 修订

- `[docs/V1-PRD.md] §7「模块」行 | 修订前 → 修订后`
  - 修订前：`模块：\`search/{mod,netease,qqmusic,migu}.rs\` + \`commands.rs\`。`
  - 修订后：`模块：\`commands/\` 目录薄壳（folder/song/cover/search.rs）+ \`service/searcher/\` 子模块（mod/netease/qqmusic/migu/crypto.rs）；统一 Trait \`MusicSource\`：\`search(title, artist) -> Result<Vec<SongCandidate>, String>\` + \`fetch_lyric(song_id) -> Option<String>\`。`
  - 理由：v1-refactor-layering 已定稿并实施——`commands/` 目录薄壳 + `service/`（reader/writer/meta/cover/fs_atomic + searcher/ 子模块），design.md §10.0 有权威表格；代码即此结构（`src-tauri/src/commands/{folder,song,cover,search}.rs`、`src-tauri/src/service/searcher/{mod,netease,qqmusic,migu,crypto}.rs`）。

### D5 openspec/config.yaml context 遗漏 `search_source`（遗漏）→ 修订

- `[openspec/config.yaml] context「Tauri command 契约」行 | 修订前 → 修订后`（与 D1 同一行，见上 D1 config 条目）
  - 修订前：`...search_song/fetch_lyric/download_cover/embed_cover`（无 `search_source`）。
  - 修订后：清单含 `search_source`，删 `embed_cover`。
  - 理由：`search_source` 是 C2 取词失败换源的核心 command——design.md §10.3、specs/search-sources 均已含，`src/api/search.ts` 已封装 `searchSource`；config context 遗漏。与 D1 落在同一处行文，一并修订。

### D6 design.md §10.4「未来子变更落位表」所列子变更均已归档（陈旧状态）→ 修订

- `[docs/design/design.md] §10.4 标题行 + 落位表 | 修订前 → 修订后`
  - 修订前：标题 `### 10.4 测试放置约定与未来子变更落位`；引导句 `**未来子变更落位说明（service/api 落位，读 design.md §10 的 Architect 按此规划）**`；表头 `| 后续子变更（epic 项） | Rust 落位 | 前端落位 |`。
  - 修订后：标题 `### 10.4 测试放置约定与子变更落位`；引导句 `**子变更落位记录（service/api 落位，v1-cover-embed → v1-search-ui 已实现归档，记录保留作架构落位参照）**`；表头 `| 子变更（epic 项，已归档） | Rust 落位 | 前端落位 |`；表尾补注 `（以上 5 个子变更均已实现并归档，本表为历史落位记录，供后续 Architect 参照分层惯例）`。
  - 理由：v1-cover-embed / v1-lyrics-lrc / v1-rename-sync / v1-search-backend / v1-search-ui 五个子变更均已实现并归档（epic.json done；`openspec/changes/archive/` 齐全），「未来落位」已变「历史落位」；去除「未来/后续」措辞避免误导后续 Architect。

## 复核过程中新发现的不一致（修订）

### N1 design.md §10.3 command 表无 `pick_folder`（遗漏）→ 修订

- `[docs/design/design.md] §10.3 Tauri command 契约表 | 修订前 → 修订后`
  - 修订前：command 表无 `pick_folder` 行。
  - 修订后：表首行补 `pick_folder()`（`() → Option<String>`，rfd 原生文件夹选择器，取消返回 `None`）。
  - 理由：`pick_folder` 是打开文件夹的唯一入口（`lib.rs` 注册、`src/api/songs.ts` 封装），契约表须记录全部已注册 command（§10.0 分层规范要求）。

### N2 design.md §10.3 `search_source` 行注释引用变更名（脆弱）→ 修订

- `[docs/design/design.md] §10.3 command 表 `search_source` 行 | 修订前 → 修订后`
  - 修订前：`（v1-search-fixes，C2 换源用）`
  - 修订后：`（单源搜索，C2 换源用：绕过跨源聚合去重——聚合会把同曲多源候选折叠成一条导致换源失效）`
  - 理由：变更名 v1-search-fixes 已归档，属过程性名称；契约表注释应描述稳定语义，不依赖变更名（tasks 3.2 要求）。

### N3 复核通过项（一致，无需修订）

- 四源对 `save_song(song, exportLrc)` 签名、`SearchResult.all_failed` 离线判定、FR-8 搜索联动、FR-5/FR-4 保存/歌词语义、离线降级「失败首响」的描述一致，无冲突。
- `openspec/specs/` 主规格（search-sources/search-ui/cover-embed/refactor-layering 等）无 `embed_cover` 陈旧引用；`embed_cover` 仅出现在 archive 历史记录（v1-cover-embed 归档文档），属历史记录，不修订。
- 记忆「封面统一路径 + 预览时压缩」行已写「无独立 embed_cover command」，正确，无需重复修订。

## 记忆修订说明（仓库外，不随 PR/归档）

- 记忆 `~/.claude/projects/-Users-xian-Project-music-MusicTag/memory/music-tag-v1-spec.md` 的修订（D1 command 清单、D3 缺失判定）不在仓库内，改动不进 PR、不随归档；跨机器/会话可能被自动记忆覆盖。**后续会话以 docs/V1-PRD.md + docs/design/design.md + openspec/specs/ 为准。**
