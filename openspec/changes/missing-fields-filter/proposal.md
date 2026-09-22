## Why

Issue #121：当前只有逐首打开歌曲后才能发现缺少哪些元数据，整理整个文件夹时无法快速定位待补全歌曲。需要一个只读的查漏入口，让用户按缺失维度筛出歌曲，再逐首进入现有编辑流程。

## What Changes

- 新增「筛选缺失」入口和五个缺失维度复选框：歌名、歌手、专辑、封面、歌词。
- 按 OR 语义筛选：歌曲缺少所选维度中的任一项即命中；命中行展示具体缺失 badge。
- 默认全选；全不勾选视为关闭缺失筛选；缺失筛选与顶部歌名/歌手搜索叠加。
- 新增按需只读扫描能力：首扫仍只读取轻量歌曲摘要，用户开启查漏后才读取所选维度；不读取封面 base64 或歌词全文，不写盘、不批量编辑、不批量自动搜索。
- 歌词仅在无内嵌 `Lyrics`/`UnsyncLyrics` 内容且无同名 `.lrc` sidecar 时判定为缺失。
- 筛选结果点选后继续复用现有 `open_song` 单曲编辑流程，切歌未保存确认和一次一首约束不变。

## Capabilities

### New Capabilities

- `missing-fields-filter`: 只读按缺失维度筛选歌曲。

### Modified Capabilities

- 无。

## 关联 Issue

GitHub Issue：`#121`（分支提交使用 `feat(121): ...`，PR 使用 `Closes #121`）。

## Impact

- Rust：新增按需缺失扫描 command 及标签/sidecar 缺失判定；保持 `list_songs` 首扫契约和只读语义。
- Vue：SongList 增加筛选入口、复选面板、缺失 badge、空态和扫描进度态；store/api 增加筛选状态与 IPC 封装。
- 文档：同步 `docs/V1-PRD.md`、`docs/design/design.md` 中的只读查漏边界和 command 契约。
- 测试：覆盖五个维度、歌词双来源判定、OR 组合、全不选、与顶部搜索叠加、切歌交互和扫描失败路径。

## 验证基线

按 pipe 统一执行 Rust check/test、前端 test/build、OpenSpec strict 校验；并针对按需扫描追加数百首量级不阻塞 UI、只读不写盘和跨目录/切歌状态复位回归。
