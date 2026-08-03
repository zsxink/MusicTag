# v1-search-ui 任务（纯前端 · 单角色 Vue-Dev · 测试驱动——新逻辑先写失败测试再实现到绿）

> 依赖顺序：v1-search-backend → v1-lyrics-lrc → v1-refactor-layering 均已完成（command 契约、sidecar 判定、分层/注入先例已就绪）。本变更只动 `src/`。

## 1. api + lib 层（IPC 透传 + bytes → CoverInput）

- [ ] 1.1 新增 `src/api/search.ts`：`searchSongs(title, artist) → SearchResult`、`fetchLyric(source, id) → string | null`、`downloadCover(url) → number[]`（`invokeCommand` 泛型透传，仿 `songs.ts`）
- [ ] 1.2 新增 `src/api/search.test.ts`：mock `@tauri-apps/api/core`，断言 command 名 / 参数 / 返回透传（仿 `songs.test.ts` 模式）
- [ ] 1.3 新增 `src/lib/cover.ts`：`bytesToCoverInput(bytes: number[]): Promise<CoverInput>`——魔数嗅探 mime（JPEG/PNG/WebP/GIF）→ data URL → `Image` 取自然尺寸 → 任一维 > 2048 时 canvas 等比缩至 ≤2048 → `data:<mime>;base64,...`；解码失败 / 画布异常 → reject（中文原因）
- [ ] 1.4 新增 `src/lib/cover.test.ts`：魔数嗅探各格式 + 小图直出（≤2048 不碰 canvas，jsdom 无 canvas 实现）；canvas 压缩路径留 `tauri dev` 人工确认

## 2. store 搜索状态与触发

- [ ] 2.1 `SongEditor` + `raw` reactive 新增：`lyricSearchState` / `coverSearchState`（'idle'|'searching'|'done'）、`lyricCandidates` / `coverCandidates`、`isOffline`、`searchedThisSong`、`lyricSourcePlatform`、`lyricFetchEmpty`、`searchSeq`（D2）
- [ ] 2.2 内部动作 `resetSearchState()`：清两类候选、两 searchState 归 'idle'、`searchedThisSong=false`、`lyricSourcePlatform=null`、`lyricFetchEmpty=false`、`searchSeq++`；`open()`（成功 + 失败分支）与 `activateFolder()` 调用（D5）
- [ ] 2.3 `autoSearchOnSelect(searchSongs = default)`（D1）：守卫 current 非空 / !readonly / !searchedThisSong / !isOffline → 判定只补缺失（`lyrics==='' && lyricsSource!=='sidecar'` 搜歌词；`cover===null` 搜封面）→ 有缺失才搜 → 捕获 `mySeq=++searchSeq` → searching → 分桶填充 → done；resolve 后 `allEmpty`（songs 空 && source_stats 全 0）→ `isOffline=true`（仅自动搜索，D3）
- [ ] 2.4 `selectSong` 尾部（`open` 成功后、current 非空且 !readonly）触发 `autoSearchOnSelect()`（D1；resolvePending 的保存后切歌路径天然收敛于此）
- [ ] 2.5 `manualSearch(kind: 'lyrics'|'cover', searchSongs = default)`（D7）：无视离线 / 缺失判定，刷新对应 kind 候选；searchState 各自 searching → done
- [ ] 2.6 并发守卫：每次搜索 `mySeq=++searchSeq`，resolve 时 `mySeq !== searchSeq` 丢弃结果（切歌 / 二次搜索后旧结果不覆盖，D2）
- [ ] 2.7 `undo()` 重置 `lyricSourcePlatform=null`、`lyricFetchEmpty=false`（候选保留，D5）
- [ ] 2.8 `store/song.test.ts`：新增搜索动作单测（触发 / 只补缺失 / 已有不搜 / 删除不重搜 / 离线首响 / 切歌清空 / 手动 / 过期丢弃 / C2 / 封面静默），注入 searchSongs / fetchLyric / downloadCover / bytesToCoverInput 桩；**顶部 `vi.mock('../api/search')` 兜底既有 selectSong-with-loader 用例**（选中行现在会触发 autoSearch）

## 3. 候选区 UI

- [ ] 3.1 新增 `components/LyricCandidate.vue`（§6.5）：来源标签（网易云/QQ音乐/咪咕）+ 歌名—作者（超长省略），hover 琥珀，点击 → `pickLyricCandidate`
- [ ] 3.2 新增 `components/CoverCandidate.vue`（§6.4）：`<img :src="cand.cover_url">` 1:1 缩略图 + 左下角来源角标；onerror 破图静默隐藏该格；点击 → `pickCoverCandidate`
- [ ] 3.3 `LyricPanel.vue` 扩展：激活「搜索歌词」`search-trigger`（head 与 textarea 之间，readonly / 无歌禁用）→ 候选区：searching → `.cand-status`（「搜索中…」+ 转圈）、done 有候选 → `.cand-row` 列表、done 无 → `.cand-empty`、`isOffline && idle` → 「离线：仅手动填写」；badge：`lyricSourcePlatform` 非 null → 「来源: 网易云/QQ音乐/咪咕」，否则沿用 `lyricsSource` 映射
- [ ] 3.4 `CoverPanel.vue` 扩展：激活「搜索封面」`search-trigger`（封面框 + 元信息下方，readonly / 无歌禁用）→ 候选区：searching → `.cand-status`、done 有 → 3×N `.cand-grid`、done 无 → `.cand-empty`、`isOffline && idle` → 离线提示
- [ ] 3.5 组件测试：`lyric-panel.test.ts` / `cover-panel.test.ts` 增候选区渲染 / 点选 / 离线提示 / badge 平台来源用例（组件内 `vi.mock('../api/search')` 兜底 store 默认注入）；`songrow.test.ts` 的 invoke mock 补 `search_song` 返回 `SearchResult`（选中行现在会触发 autoSearch）

## 4. 点选写入 + 取词换源 + 失败静默

- [ ] 4.1 `pickLyricCandidate(cand, fetchLyric = default, searchSongs = default)`（D4）：`fetchLyric(cand.source, cand.id)` 成功 → `current.lyrics` 填 + `lyricSourcePlatform = cand.source`（dirty 翻转）；None → C2：以 cand.title / cand.artist 重搜一次，按固定顺序（netease→qqmusic→migu）跳过失败源取该源第一个候选 `fetchLyric`，成功填 + badge=该源；全源失败 → `lyricFetchEmpty=true`（空态「未找到匹配的歌词，可手动粘贴」）
- [ ] 4.2 `pickCoverCandidate(cand, downloadCover = default, bytesToCoverInput = default)`（D6）：`cover_url` null 忽略 → 下载 → `bytesToCoverInput` → `setCover`（复用既有动作）；下载 / 解码 / 压缩失败 → 静默从 `coverCandidates` 移除该张（其余不受影响，不报错不标红）；已切歌（`selectedPath` 变化）→ 丢弃结果不应用
- [ ] 4.3 store 单测：C2 换源成功 / 全源失败空态、封面静默移除、切歌丢弃（桩注入）

## 5. 端到端验收

- [ ] 5.1 覆盖验收 #10–#12：选中即搜、只补缺失、点选正确填入、不自动覆盖、已有不搜、删除不重搜、离线降级（断网模拟 → 提示「离线：仅手动填写」）、候选切歌即弃
- [ ] 5.2 `npm run test`（含新增 api/lib/store/components 测试 + 结构守卫 layering.test / design-layering.test）+ `npm run build` 通过
- [ ] 5.3 `npm run tauri dev` 端到端（可联网）：搜出候选 → 点选歌词 / 封面 → 保存 → 第三方工具验证写回；封面破图 / 超限静默忽略；C2 换源；坏标签只读时按钮禁用、不触发搜索
