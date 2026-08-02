## 1. 前端：store 搜索状态与触发

- [ ] 1.1 store 增加：`searchState`、`lyricCandidates`、`coverCandidates`、`isOffline`（会话级）、`searchedThisSong`
- [ ] 1.2 选中即搜触发：仅一次、只补缺失（已有歌词/封面不搜；删除不重搜）
- [ ] 1.3 `search_song` 调用封装：调 Rust command，更新候选与 source_stats
- [ ] 1.4 离线降级（失败首响）：全源失败 → `isOffline=true`；后续选中不再自动搜、提示「离线：仅手动填写」
- [ ] 1.5 候选生命周期：切歌清空候选与 searchedThisSong（不保留、无弹窗）

## 2. 前端：候选区 UI

- [ ] 2.1 `LyricCandidate.vue`：来源标签 + 歌名—作者候选条，点选触发 fetch_lyric
- [ ] 2.2 `CoverCandidate.vue`：3×N 缩略图网格 + 左下角来源角标，点选触发 download_cover
- [ ] 2.3 `cand-status`：「搜索中…」+ 转圈（2px 边框顶边琥珀）；后台异步不阻塞编辑
- [ ] 2.4 `cand-empty`：无结果/断网空态（保留手动填写入口）
- [ ] 2.5 点选写入：歌词填 textarea（badge 更新来源）、封面填封面区预览；不自动覆盖

## 3. 前端：取词换源 + 手动按钮 + 失败静默

- [ ] 3.1 取词失败自动换源（C2）：None → 换另一家源重试同一首歌；全源失败空态
- [ ] 3.2 手动搜索按钮：歌词区/封面区各一个「搜索歌词 / 搜索封面」（虚线触发样式），随时可发起
- [ ] 3.3 封面候选失败静默：下载/解码/压缩失败 → 静默忽略该张，其余不受影响

## 4. 端到端验收

- [ ] 4.1 覆盖验收 #10–#12：选中即搜、只补缺失、点选正确填入、不自动覆盖、已有不搜、删除不重搜、离线降级
- [ ] 4.2 `npm run build` + `npm run test` 通过
- [ ] 4.3 `npm run tauri dev` 端到端确认（可联网）：搜出候选 → 点选歌词/封面 → 保存 → 第三方工具验证写回
