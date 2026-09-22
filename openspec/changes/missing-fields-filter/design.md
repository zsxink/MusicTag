# missing-fields-filter 技术设计

## Context

`list_songs` 当前只读取 `path/title/artist`，这是首扫快速和坏标签可展示的既有契约，不能为了查漏把封面 base64 或歌词全文带入首扫。Issue #121 需要在用户主动开启查漏后，按选中的维度读取更多只读元数据，并把结果叠加到现有列表搜索和单曲编辑流程。

## Goals / Non-Goals

**Goals:**

- 新增按需、只读的缺失扫描 command，返回每首命中的具体缺失维度。
- 保持 `list_songs` 首扫契约不变；不读封面编码数据和歌词全文。
- 前端提供五维度复选面板、OR 筛选、缺失 badge、空态和扫描状态。
- 扫描结果与文件夹、筛选条件绑定，旧异步结果不能覆盖新状态。
- 点选筛选结果仍走 `open_song`，不改变一次一首、dirty 拦截和自动搜索边界。

**Non-Goals:**

- 不批量编辑、写标签、写封面、写 `.lrc` 或批量自动搜索。
- 不改变 `SongSummary` 与 `list_songs` 的 IPC 形状。
- 不在本变更加入新的搜索源或改动保存语义。

## Decisions

### 1. 后端契约与判定

在 `model.rs` 增加可序列化的 `MissingField`（`title`、`artist`、`album`、`cover`、`lyrics`）、`MissingSong`（`path`、`missing`）和扫描结果（命中项及可见错误）。新增 `scan_missing(dir, checks)` command；`checks` 为空时返回未启用语义，前端通常直接恢复完整列表。

扫描 service 按 `WalkDir` 复用现有音频过滤，逐文件 `Probe::open(...).read()` 后只读取：文本字段、`pictures().is_empty()`、`Lyrics`/`UnsyncLyrics` 帧的非空状态，以及 `sidecar_lrc_path(path).is_file()`。文本字段使用 `trim().is_empty()`；歌词只有内嵌两帧均空且同名 `.lrc` 不存在才缺失。扫描不调用 `encode_cover`，不读取歌词文本，不调用 writer。

单文件读取失败记录为扫描错误并跳过命中判定，避免把坏标签误报成已补全；其他文件继续扫描。扫描输出中的 `missing` 保持稳定的维度顺序，便于 badge 和测试断言。

### 2. 前端状态与派生

`api/songs.ts` 新增 `scanMissing(dir, checks)`，`api/types.ts` 对齐 Rust 枚举和返回类型。store 增加：

- `missingFilterEnabled`、`missingChecks`（默认五项）、`missingByPath`；
- `missingScanState`（idle/scanning/done/error）和错误信息；
- `scanMissing` 动作，捕获当次 `folderPath` 与 checks 版本号，响应回来时不匹配即丢弃；
- 换文件夹、关闭筛选、重置或重选 checks 时清理旧结果。

`selectors.ts` 先按缺失结果取命中歌曲，再按既有顶部搜索框过滤，最后按文件名排序。无筛选时继续返回全部 `SongSummary`。为保持 `SongRow` 接口清晰，列表行通过可选的 `missing` 字段接收 badge 数据，不把缺失状态写入音频摘要。

### 3. UI 交互

`SongList.vue` 在打开文件夹后显示「筛选缺失」入口和五个中文复选框。首次打开默认全选；勾选变化触发扫描，全部取消则关闭筛选并恢复完整列表。扫描期间保留列表结构并显示轻量进度/状态，扫描完成无命中时显示「没有缺失所选字段的歌曲」。关闭筛选只清理派生筛选，不清除当前单曲编辑状态。

`SongRow.vue` 展示「缺歌名」「缺歌手」「缺专辑」「缺封面」「缺歌词」badge。行点击仍由既有 `requestSwitch` / `selectSong` 路径处理，筛选只影响可见集合。

### 4. 竞态与错误

以递增扫描序号加 `folderPath` 快照作为双重过期守卫。旧目录扫描晚返回、快速改变复选框、关闭筛选和扫描失败都不能覆盖当前列表。扫描错误展示可见但不阻塞其他歌曲；IPC 失败保留当前完整列表并显示可重试状态，不触碰编辑表单。

### 5. 文档与变更域

变更域为 `both`，依赖顺序 Rust → Vue：先冻结 command/model/service 和集成测试，再实现 API/store/selector/UI。同步 `docs/design/design.md` §10 的 command/model/service 契约，并在 `docs/V1-PRD.md` 明确这是 V1 只读查漏、批量补全仍属 V2。

## Risks

- lofty 不同容器对歌词 ItemKey 的映射不同：测试需分别覆盖 FLAC `Lyrics` 与 MP3 `UnsyncLyrics`，并验证空帧不会遮蔽 `.lrc` fallback。
- 大目录扫描期间用户可能切换目录或修改筛选：必须保留序号和路径守卫，不能只依赖 Promise 顺序。
- `SongRow` 的列表类型扩展可能影响既有组件测试；应保持无 `missing` 时原有渲染完全不变。
