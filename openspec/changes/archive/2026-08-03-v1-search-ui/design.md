## Context

`v1-search-backend` 已提供 `search_song` / `fetch_lyric` / `download_cover`。本变更实现前端搜索联动（FR-8 + design.md §9、§6.2–6.6）：选中即搜（仅一次、只补缺失）、歌词/封面候选区、点选写入、取词换源、离线降级、候选生命周期、手动按钮。V1 最后一个功能变更，完成后即端到端验收（验收 #10–#12）。

## Goals / Non-Goals

**Goals:**
- 选中即搜（仅一次、只补缺失）的触发模型。
- 歌词/封面候选区展示、点选写入、取词换源。
- 离线降级、搜索中/空态、候选生命周期、手动按钮。

**Non-Goals:**
- 不改 Rust 搜索（已由 `v1-search-backend` 完成）。
- 不做搜索结果落盘（V1 点选才填）。
- 不做请求缓存 / 重试策略 / 更多搜索源 / 分页（V2）。

## 变更域判定

**纯 frontend**：全部改动在 `src/`（新增 `api/search.ts`、`lib/cover.ts`，扩展 `store/song.ts`、`components/LyricPanel.vue`、`components/CoverPanel.vue`，新增 `components/LyricCandidate.vue`、`components/CoverCandidate.vue`）。`src-tauri/` 零改动——`download_cover` 返回裸 `Vec<u8>`，mime 嗅探 / 压缩 / data URL 转换全部前端完成（契约 §10.3 冻结，不得新增 command）。

**依赖顺序**：前置 `v1-search-backend`（command 契约 + `source_stats` 离线判定事实）、`v1-lyrics-lrc`（sidecar 歌词存在性判定 `lyricsSource !== 'sidecar'`）、`v1-refactor-layering`（api/store/lib/components 分层 + 注入先例）。本变更单角色（Vue-Dev），无前后端并行，不需要 worktree。

## 模块结构与数据流

```
src/
├── api/search.ts            # 新增：search_song / fetch_lyric / download_cover IPC 透传（仿 songs.ts）
├── lib/cover.ts             # 新增：download_cover 裸 bytes → CoverInput（魔数嗅探 mime + data URL + ≤2048 压缩）
├── store/song.ts            # 扩展：搜索状态 + 动作（触发/手动/点选/换源/离线判定/生命周期）
├── components/
│   ├── LyricPanel.vue       # 扩展：候选区（status/rows/empty/离线提示）+ 激活「搜索歌词」按钮 + badge 平台来源
│   ├── LyricCandidate.vue   # 新增：来源标签 + 歌名—作者候选条（§6.5）
│   ├── CoverPanel.vue       # 扩展：候选区（status/grid/empty/离线提示）+ 激活「搜索封面」按钮
│   └── CoverCandidate.vue   # 新增：3×N 缩略图 + 来源角标（§6.4）
└── store/selectors.ts       # （可选）badge/来源文案派生（也可在组件内，见 D9）
```

数据流：

```
选中歌曲（SongRow.select → requestSwitch → selectSong）
  → open(path, loadSong) 读全量标签成功
  → selectSong 尾部 autoSearchOnSelect()
      → 守卫：current 非空 && !readonly && !searchedThisSong && !isOffline
      → 判定只补缺失：lyrics==='' && lyricsSource!=='sidecar' → 搜歌词；cover===null → 搜封面
      → invoke('search_song', { title, artist })  // 一次调用同时喂两类候选（惰性拉取）
      → 打分去重由后端完成；前端按 kind 分桶：lyricCandidates=result.songs、coverCandidates=result.songs.filter(cover_url)
      → 全源 0（source_stats 全 0 && songs 空）→ isOffline=true（仅自动搜索判定）

点选歌词候选（LyricPanel → pickLyricCandidate）
  → invoke('fetch_lyric', { source, id }) → 文本填入 current.lyrics + badge=平台
  → None → C2：invoke('search_song', { cand.title, cand.artist }) 重搜同一首歌
      → 依次取另一家源候选 fetch_lyric → 成功填 + badge=该源；全源失败 → lyricFetchEmpty 空态

点选封面候选（CoverPanel → pickCoverCandidate）
  → invoke('download_cover', { url }) → number[]（裸 bytes，IPC JSON 序列化）
  → lib/cover.ts: bytesToCoverInput → data URL + mime（>2048 经 canvas 压缩）
  → setCover(input)（复用 v1-cover-embed 既有动作，dirty 翻转）
  → 下载/解码/压缩失败 → 静默从 coverCandidates 移除该张（验收 #12）

手动搜索按钮（LyricPanel/CoverPanel → manualSearch(kind)）
  → 无视离线与缺失判定，随时 invoke('search_song') → 刷新对应 kind 候选
```

## Decisions

### D1 触发模型：选中即搜（仅一次、只补缺失）

`selectSong` 成功 open 后调用 `autoSearchOnSelect()`（默认 `api/search.ts` 的 `searchSongs`，测试注入桩）。判定一次（`searchedThisSong` 置 true）：
- `needLyrics = current.lyrics === '' && lyricsSource !== 'sidecar'`（内嵌/侧载已有歌词均不搜）
- `needCover = current.cover === null`
- 两者都有 → 不搜（候选区保持 idle 不出现）；删除内容后 flag **不重算**（FR-8.4 删除不再触发），切歌才由 `resetSearchState` 清零。

**为什么**：`open()` 是选中唯一路径（`selectSong` / `requestSwitch` / `resolvePending` 全部收敛于此），触发点单点可控；默认注入保持「defaults=生产、注入=测试」既有模式（`saveFn`/`renameFn` 同款先例）。**注意**：裸文件（title 空）`search_song('', artist)` 被后端 D3 空 title 守卫过滤 → 空态；用户填歌名后走手动按钮（FR-8.13）。

### D2 store 搜索状态（按 kind 分离）

`store/song.ts` 新增（`SongEditor` + `raw` reactive 均声明）：

```ts
lyricSearchState: 'idle' | 'searching' | 'done'
coverSearchState: 'idle' | 'searching' | 'done'
lyricCandidates: SongCandidate[]      // result.songs（后端已去重排序）
coverCandidates: SongCandidate[]      // result.songs.filter(s => s.cover_url)
isOffline: boolean                     // 会话级
searchedThisSong: boolean              // 本首已判定过（仅一次）
lyricSourcePlatform: MusicSourceId | null   // 候选点选来源（badge）
lyricFetchEmpty: boolean               // C2 全源取词失败 → 空态
searchSeq: number                      // 搜索序号（过期结果守卫）
```

**为什么按 kind 分离状态**：自动搜索同时搜两类、手动搜索只搜一类——若 `searchState` 是全局单值，手动搜歌词会让封面面板误显「搜索中…」。两个独立小状态机各管各的候选区。`searchSeq` 自增序号做过期守卫：每次搜索（auto/manual）捕获 `mySeq = ++searchSeq`，resolve 时 `mySeq !== searchSeq` 即丢弃（用户切歌或二次搜索后，旧结果不得覆盖新状态）。

### D3 离线降级（失败首响）

自动搜索 resolve 后 `allEmpty(result) = result.songs.length === 0 && result.source_stats.every(([, n]) => n === 0)` → `isOffline = true`（会话级、sticky）。`invoke('search_song')` 本身不 Err（返回 `SearchResult`），但 IPC 层 reject 时按全源失败同样标记（防御）。**只对自动搜索判定**——手动搜索失败不标离线（FR-8.4a「第一次自动搜索全源失败」）。`isOffline` 只随应用重启清空（spec 未定义手动成功解除，不自行加需求）。

离线后：`autoSearchOnSelect` 直接 return（后续选中不再自动搜）；候选区不出现，改显「离线：仅手动填写」；手动按钮始终可用（用户主动重试可出候选，但不解除 isOffline）。

**为什么**：后端 D8 明确「三源全 0 → 前端判定离线」，`source_stats` 是可判定事实；「真无结果」与「断网」在数据面无法区分（都记 0），此代理是已批准契约。误判（罕见歌被标离线）有手动按钮兜底。

### D4 取词换源（C2）

`pickLyricCandidate(cand)`：`fetchLyric(cand.source, cand.id)` 非 None → `current.lyrics = 文本` + `lyricSourcePlatform = cand.source`（badge 显示平台，仍可继续编辑）。None → C2：
- 以 **cand 自身的 title/artist**（点选那首歌的身份，而非可能已被编辑的 current）重搜 `search_song(cand.title, cand.artist)` 一次；
- 按固定顺序（netease → qqmusic → migu）跳过 `cand.source`，取该源第一个候选 `fetchLyric`；成功 → 填 + badge=该源；失败 → 下一家；
- 全源失败 → `lyricFetchEmpty = true`（候选区显示「未找到匹配的歌词，可手动粘贴」空态，不降级到低分候选）。

**为什么重搜而非遍历现有候选**：后端聚合按归一化 (title, artist) 去重，同曲跨源版本只留最高分一条——现有候选里没有另一家源的「同一首歌」，只能按歌名+作者重搜拿到该源 ID（纯前端无 per-source command）。代价是重复一次三源并发搜索（≤6s），但 C2 是点选触发的低频路径，可接受。**限制**：去重使重搜结果与原结果同构，另一家源的 exact 同曲通常仍不出现（标题/艺人略异如「Live」版、或各家词条归一化后不同才会出现）——故 C2 的实际效果是「同歌异词条」兜底；绝不填进「同名不同歌」的歌词（只取每家 top、全源失败空态兜底）。

### D5 候选生命周期 = 当前歌曲

`resetSearchState()`（内部动作，`open` 成功/失败、`activateFolder` 均调用）：清空 `lyricCandidates`/`coverCandidates`、两个 searchState 归 'idle'、`searchedThisSong=false`、`lyricSourcePlatform=null`、`lyricFetchEmpty=false`、`searchSeq++`（作废在途搜索）。`isOffline` 不清（会话级）。未点选候选切歌直接丢弃、无弹窗（FR-8.14）。

`undo()` 额外：`lyricSourcePlatform=null`（badge 回到 original 的来源）、`lyricFetchEmpty=false`；候选保留（仍是当前歌，可重选）。保存不重置 badge（内容来源未变）。

### D6 封面下载 → 压缩 → 静默失败

`pickCoverCandidate(cand)`：
- `cand.cover_url` 为 null → 忽略；`downloadCover(cand.cover_url)` → `number[]`（裸 bytes）；
- `lib/cover.ts: bytesToCoverInput(bytes)`：魔数嗅探 mime（JPEG `FF D8 FF` / PNG `89 50 4E 47` / WebP `RIFF..WEBP` / GIF `GIF8`）→ 构建 data URL → `Image` 解码取自然尺寸 → 任一维 > 2048（或体量过大）时 canvas 等比缩至 ≤2048 → `data:<mime>;base64,...`；解码失败/画布异常 → reject；
- `setCover({ data_url, mime })`（复用 v1-cover-embed 既有动作，`cover` 在 `DIRTY_FIELDS` → 自动翻转 dirty）；
- 下载 Err / 解码失败 / 压缩失败 → **静默从 `coverCandidates` 移除该张**，其余候选不受影响（验收 #12）；已切歌（`selectedPath` 变化）→ 丢弃结果不应用。

**为什么前端做压缩**：契约 §10.3 `download_cover -> Vec<u8>` 冻结（后端只做 5s 超时 + 12MB 限流），且 v1-search-ui 声明纯前端（§10.4 落位 Rust = —）。canvas 压缩是 WebView 原生能力，`save_song` 统一嵌入压缩图（PRD §5.3 统一路径）。**局限**：canvas 在 jsdom 无实现 → 单测只覆盖魔数嗅探 + 小图直出（≤2048 不碰 canvas），压缩路径用 `tauri dev` 人工确认。12MB 上限裸 bytes 过 IPC 序列化为 JSON `number[]` 约 5× 膨胀：单张点选、一次性，可接受（契约冻结不另做流式）。

### D7 手动搜索按钮

`manualSearch(kind: 'lyrics' | 'cover')`：无视离线、无视缺失判定（用户主动发起即可），`invoke('search_song')` 刷新对应 kind 候选。歌词区/封面区 `search-trigger` 按钮替换现 disabled 占位（LyricPanel head 与 textarea 之间、CoverPanel 封面框 + 元信息下方，design.md §6.2）。搜索中可重复点按钮重搜（design §7）。readonly（坏标签只读）与无歌时禁用。

### D8 UI 组件与落位（§6.2–6.6）

- `LyricCandidate.vue`：来源标签（网易云/QQ音乐/咪咕）+ 歌名—作者（§6.5，hover 琥珀），点击 → `pickLyricCandidate`。
- `CoverCandidate.vue`：`<img :src="cand.cover_url">`（远程缩略图直接展示）+ 左下角来源角标（§6.4）；onerror（缩略图破图）→ 静默隐藏该格。
- 候选区容器（各面板内）：`searchState==='searching'` → `.cand-status`（「搜索中…」+ 转圈，后台异步不阻塞编辑）；`'done'` 且有候选 → 列表/网格；`'done'` 且无 → `.cand-empty`；`isOffline && idle` → 「离线：仅手动填写」（候选区不出现）。
- badge：`lyricSourcePlatform` 非 null → 「来源: 网易云 / QQ音乐 / 咪咕」；否则沿用 `lyricsSource` 映射（内嵌标签 / 侧载 .lrc / 无）。

### D9 分层与测试放置（服从 §10.0 / §10.4）

`api/search.ts` 只做 IPC 透传（同 `songs.ts` 模式，`invokeCommand` 泛型）；候选生命周期（选中即搜、切歌即弃、离线、C2、静默忽略）逻辑全在 store，不在 api 层。`lib/cover.ts` 无 Vue/IPC 依赖（DOM 允许），复用既有 `lib/` 目录不新建平级目录。组件零 invoke 直呼（layering 守卫）。新增/扩展测试 co-located：

- `src/api/search.test.ts`（透传断言，mock `@tauri-apps/api/core`）
- `src/lib/cover.test.ts`（魔数嗅探各格式 + 小图直出）
- `src/store/song.test.ts`（触发/只补缺失/离线首响/切歌清空/手动/过期丢弃/C2/封面静默，注入 `searchSongs`/`fetchLyric`/`downloadCover`/`bytesToCoverInput` 桩；顶部 `vi.mock('../api/search')` 兜底既有 selectSong-with-loader 用例）
- `src/components/lyric-panel.test.ts`、`src/components/cover-panel.test.ts`（候选区渲染/点选/离线提示/badge 平台）
- `src/components/songrow.test.ts`：invoke mock 需补 `search_song` 返回 `SearchResult`（选中行现在会触发 autoSearch）

## 规格覆盖

| spec requirement | 设计落点 |
|---|---|
| 选中即搜（仅一次、只补缺失） | D1 + `autoSearchOnSelect` |
| 候选点选写入、不自动覆盖 | D2（候选分桶）+ `pickLyricCandidate`/`pickCoverCandidate` + `setCover` 复用 |
| 取词失败自动换源（C2） | D4 |
| 离线降级（失败首响） | D3 |
| 候选生命周期 = 当前歌曲 | D5 |
| 手动搜索按钮 | D7 |
| 搜索进度与后台异步 | D2（searchState）+ selectSong 尾部触发不阻塞编辑 |
| 封面候选失败静默 | D6 |

## Risks / Trade-offs

- 自动搜索每次选中都触发（缺失时）：依赖离线降级避免断网时反复等待 6s。
- 候选点选后歌词仍可编辑：`current.lyrics` 直填即用户可改，dirty 判定自然生效。
- 裸文件空 title → 自动搜索必空态（后端 D3 空 title 守卫），需手动补名后搜索（FR-8.13 兜底）。
- 离线判定「无结果」与「断网」数据面不可分：全源 0 即标离线，误判靠手动按钮兜底。
- C2 重搜一次三源（≤6s）低频可接受；同曲跨源 exact 去重后不出现，实际是「同歌异词条」兜底。
- `download_cover` 12MB 上限裸 bytes 过 IPC JSON 膨胀 ~5×：单张点选可接受，不做流式（契约冻结）。
- 封面 <img> 远程缩略图直出：缩略图破图静默隐藏，下载/解码失败静默移除，都不报错不标红（验收 #12）。
