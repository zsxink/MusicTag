# missing-fields-filter 技术设计

## 1. 变更域与依赖顺序

- **变更域：`both`**。本变更同时新增 Rust 只读扫描能力和 Vue 筛选展示能力。
- **依赖顺序：Rust → Vue，单 worktree 串行**。前端必须先消费已经冻结的 IPC 类型和错误语义；不把后端和前端拆成并行写入任务。
- **既有契约保持不变**：`list_songs` 仍只返回 `SongSummary { path, title, artist }`；`open_song`、`save_song`、单曲自动搜索、dirty 切歌确认和一次一首约束均不改。

本设计只细化 proposal/specs 已批准的只读查漏能力，不增加批量编辑、批量搜索、自动写盘、结果自动填充或新的搜索源。

## 2. 技术方案总览

数据流如下：

```text
SongList 打开筛选面板 / 改变勾选
        │  checks: MissingField[] + folderPath
        ▼
api/songs.ts → invokeCommand('scan_missing')
        ▼
commands/missing.rs（薄壳）
        ▼
service/missing.rs（spawn_blocking 内执行 WalkDir + lofty 只读检查）
        │
        └─ MissingScanResult { songs, errors }
        ▲
store/song.ts：目录快照 + scanSeq 过期守卫
        ▲
selectors.ts：缺失命中集合 → 顶部歌名/歌手搜索 → 文件名排序
        ▲
SongList.vue / SongRow.vue：筛选面板、状态、空态、缺失 badge
```

按现有 §10 分层约束落位：

| 层 | 文件 | 职责 |
|---|---|---|
| Rust model | `src-tauri/src/model.rs` | `MissingField`、`MissingSong`、`MissingScanError`、`MissingScanResult` 的 serde IPC 契约 |
| Rust command | `src-tauri/src/commands/missing.rs` | 接收目录和维度，调用 service；不出现 lofty/WalkDir/文件 I/O 逻辑 |
| Rust service | `src-tauri/src/service/missing.rs` | 深度遍历、音频过滤、按选中维度读取标签/图片/歌词帧和 sidecar 存在性 |
| Rust registration | `src-tauri/src/commands/mod.rs`、`lib.rs` | 声明模块并注册 `scan_missing` |
| Frontend API | `src/api/types.ts`、`src/api/songs.ts` | 对齐 Rust 枚举/结果类型，唯一透传 IPC 参数 |
| Frontend store | `src/store/song.ts` | 筛选开关、选中维度、扫描状态、结果/错误、异步过期守卫 |
| Frontend selector | `src/store/selectors.ts` | 先缺失筛选，再顶部搜索，最后文件名升序；保持纯派生 |
| Components | `src/components/SongList.vue`、`SongRow.vue` | 面板、扫描态、空态、badge；点击仍走 `requestSwitch` |

## 3. IPC 与领域模型契约

### 3.1 Rust/TypeScript 类型

在 `model.rs` 增加以下类型，并在 `types.ts` 使用同名字面量：

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissingField {
    Title,
    Artist,
    Album,
    #[serde(rename = "cover")]
    Cover,
    Lyrics,
}

pub struct MissingSong {
    pub path: String,
    pub missing: Vec<MissingField>,
}

pub struct MissingScanError {
    pub path: String,
    pub reason: String,
}

pub struct MissingScanResult {
    pub songs: Vec<MissingSong>,
    pub errors: Vec<MissingScanError>,
}
```

前端对应：

```ts
export type MissingField = 'title' | 'artist' | 'album' | 'cover' | 'lyrics'

export interface MissingSong {
  path: string
  missing: MissingField[]
}

export interface MissingScanError {
  path: string
  reason: string
}

export interface MissingScanResult {
  songs: MissingSong[]
  errors: MissingScanError[]
}
```

`MissingField` 的业务顺序固定为 `title → artist → album → cover → lyrics`。后端不能按调用方数组顺序输出；先去重、再按固定顺序检查，保证 badge 和测试稳定。`checks=[]` 是未启用语义，前端不应为此发起扫描；command 仍需安全返回空的 `MissingScanResult`，避免空数组导致误筛选。

### 3.2 command 契约

新增：

```text
scan_missing(dir: String, checks: Vec<MissingField>)
  -> Result<MissingScanResult, String>
```

实现为 `#[tauri::command] pub async fn scan_missing(...)`。command 只负责参数接收和委托：将同步的 service 扫描放入 `tokio::task::spawn_blocking`，把 join/目录级失败转换为中文 `Err`。单文件读取失败不使整个 command 失败，而是追加到 `MissingScanResult.errors` 并继续下一文件；前端 IPC reject 对应整个扫描失败态。

## 4. Rust 扫描实现

### 4.1 遍历与按需读取

`service/missing.rs` 复用 `service::meta::is_audio_file` 和 `WalkDir` 的深度遍历规则，只处理 `.flac`/`.mp3`。每个音频文件单独 `Probe::open(path).and_then(|p| p.read())`，不调用 `reader::read_song_meta`，因为后者会读取封面 base64 和歌词全文。

对单个文件只执行被选中的检查：

- `title` / `artist` / `album`：读取对应 `ItemKey`，以 `trim().is_empty()` 判定缺失。
- `cover`：读取 `tag.pictures().is_empty()` 的存在性；不得调用 `encode_cover`，不得复制图片 bytes。
- `lyrics`：检查 `Lyrics` 与 `UnsyncLyrics` 的 item/frame 是否至少有一个非空内容；不构造或返回歌词全文。若两者均缺失/为空，再检查 `service::lyrics::sidecar_lrc_path(path).is_file()`；存在即视为不缺失。

无论选中哪些维度，都不调用 writer、`save_song`、封面压缩/编码函数或 sidecar 写入函数。扫描结果只包含路径、缺失维度和错误文字，不包含 `Song`、封面 data URL 或歌词文本。

### 4.2 OR 语义、错误与结果

一个文件只要选中的维度中任一项缺失，就追加一条 `MissingSong`；`missing` 只包含被选中且确实缺失的维度。只缺少未选维度的文件不追加。

标签读取失败、权限错误或单文件解析错误追加 `MissingScanError { path, reason }`，不把该文件伪造为命中或已补全；其余文件继续扫描。目录级 WalkDir 错误同样记录为 error；无法启动扫描或 worker join 失败才返回 command-level `Err`。

## 5. 前端状态与派生

### 5.1 store 状态

在 `store/song.ts` 增加与编辑态正交的字段：

- `missingFilterEnabled: boolean`：打开面板并至少选择一个维度时为 `true`。
- `missingChecks: MissingField[]`：面板首次打开默认为五项；展示和发送前按固定顺序归一化。
- `missingByPath: Record<string, MissingField[]>`：只保存命中的缺失维度，不改写 `songs` 中的 `SongSummary`。
- `missingScanErrors: MissingScanError[]`。
- `missingScanState: 'idle' | 'scanning' | 'done' | 'error'` 与 `missingScanError`（command-level 错误文案）。
- `missingScanSeq: number`：每次换目录、关闭筛选、改变维度、发起新扫描都递增。

`scanMissing` 动作在发起时捕获 `folderPath` 和当前 `missingScanSeq`；resolve 时同时确认目录仍相同、序号仍相同、筛选仍启用且至少有一个维度。任一条件不满足，丢弃响应，不覆盖结果或错误。旧任务可以继续完成，但不能影响当前 UI。

换目录时清空旧映射、错误和扫描态，并将筛选恢复为关闭/默认五维；关闭筛选只清理查漏派生状态，不清理 `selectedPath`、`current`、`original`、dirty 或候选搜索状态。全不勾选时不调用 IPC，直接恢复完整列表。

### 5.2 selector 与现有编辑流程

`filteredSongs` 保持纯 computed：

1. `missingFilterEnabled=true` 时，仅保留 `missingByPath[path]` 存在的 `SongSummary`。
2. 对上一步结果复用既有歌名/歌手模糊搜索（不扩大缺失结果集）。
3. 继续按 `fileName(path)` 升序。

`SongRow` 新增可选 `missing?: MissingField[]` 输入；缺失状态由 `SongList` 从映射传入，不把它塞进 `SongSummary`。行点击仍调用现有 `requestSwitch` → `selectSong` → `open_song`，因此切歌未保存确认、坏标签只读和选中即搜边界不变。

## 6. UI 方案

`SongList.vue` 在已有「打开文件夹」和顶部搜索区域增加「筛选缺失」入口。打开面板时五项默认全选；改变勾选即触发最新维度扫描。面板提供关闭动作；全不勾选等同关闭并恢复完整列表。

状态展示遵循现有空态/文字双重表达：

- `scanning`：保留列表结构，展示「正在扫描缺失字段…」和轻量 loading 状态，不显示虚假的百分比。
- `done + songs.length > 0`：展示筛选命中项；每行按稳定顺序展示「缺歌名」「缺歌手」「缺专辑」「缺封面」「缺歌词」badge。
- `done + songs.length === 0`：展示「没有缺失所选字段的歌曲」。
- `errors.length > 0`：同时展示可见的降级提示/错误数量，不能把失败歌曲当作已补全。
- command-level `error`：保留完整歌曲列表，展示可重试的扫描失败提示，不污染编辑表单。

## 7. 规格到设计的覆盖

| 规格 requirement | 设计落点 |
|---|---|
| 缺失维度选择 | §3.1、§5.1、§6：五个显式值、默认全选、全不选关闭 |
| 缺失判定与 OR 语义 | §4.1–§4.2：trim、图片存在性、选中项任一缺失命中 |
| 歌词双来源判定 | §4.1：Lyrics/UnsyncLyrics 非空优先，否则同名 `.lrc` 存在性 |
| 只读按需扫描 | §2、§3.2、§4.1：保留 `list_songs`，blocking worker，无 writer/大字段返回 |
| 列表展示与现有编辑流程 | §5.2、§6：映射/badge/空态，继续 `requestSwitch`/`open_song` |
| 与顶部搜索叠加 | §5.2：缺失集合先于既有搜索 |
| 性能与状态复位 | §3.2、§5.1：`spawn_blocking`、目录快照、递增序号、旧结果丢弃 |

## 8. 关键技术决策

### D1 保持首扫 `list_songs` 轻量

**选择**：查漏另设 `scan_missing`，不扩展 `SongSummary`。

**原因**：首扫只需快速展示作者/歌名；封面 base64 和歌词全文属于单曲详情，不应在打开目录时放大 IPC payload 或内存占用，也不改变现有列表契约。

### D2 使用显式 MissingField IPC 枚举

**选择**：Rust enum + 显式 serde 字符串，TypeScript 用联合类型。

**原因**：避免前端依赖中文文案或字段名推断；同一契约覆盖请求 checks、结果 missing 和 badge 映射，新增维度时能在编译/测试阶段暴露不一致。

### D3 扫描任务用 `spawn_blocking`，结果用序号作废

**选择**：异步 command 承载同步文件/lofty 工作；不引入复杂取消 token，使用目录快照和递增序号丢弃旧结果。

**原因**：数百首扫描不能阻塞 WebView；切换目录/维度时，取消底层读取并不可靠且没有业务收益，结果守卫即可保证不会串入当前列表，代码更容易测试。

### D4 错误与命中分离

**选择**：单文件错误放 `errors`，不把错误文件加入 `songs`。

**原因**：无法确认字段是否缺失时不应误报「已补全」或「缺失」；同时错误文件可见、其他文件继续展示，符合扫描失败的降级要求。

### D5 前端先缺失筛选、再顶部搜索

**选择**：selector 采用固定的集合收缩顺序。

**原因**：顶部搜索只能缩小查漏结果，不能把完整列表重新带回；把两种过滤集中在纯 selector 中，也能保持组件只负责交互和渲染。

## 9. 测试与验证策略

- Rust 集成测试放 `src-tauri/tests/missing_scan.rs`，复用 `tests/common` 的 FLAC/MP3 fixture；必要时补充空专辑/空标签、FLAC `Lyrics`、MP3 ID3v2.4 `UnsyncLyrics`、空歌词帧、图片和 sidecar fixture。
- Rust 测试覆盖固定顺序、五维 trim/图片判定、歌词双来源、OR 并集、未选维度忽略、坏文件继续扫描、结果序列化，以及扫描前后音频/`.lrc` 字节不变。
- 前端 API 测试断言 `scan_missing` 的参数和返回类型透传；store/selectors 测试覆盖默认全选、全不选、目录/维度竞态、错误可见且不改编辑态、缺失筛选与顶部搜索叠加。
- 组件测试覆盖筛选入口、五个复选框、扫描中/失败/无命中、具体 badge、关闭恢复完整列表，以及点选仍走 `open_song`/dirty 拦截。
- 最终按 pipe 基线执行：`cargo check` → `cargo test` → `npm run test` → `npm run build` → `npx openspec validate missing-fields-filter --strict --no-interactive`；另做数百首目录扫描不阻塞 UI、只读不写盘和跨目录/切歌回归。

## 10. 风险与边界

- lofty 对 FLAC/MP3 歌词 item 的映射不同，必须分别锁定 `Lyrics` 与 `UnsyncLyrics`；空帧不能遮蔽有效 `.lrc`。
- 文件扫描是 blocking worker，旧任务可能继续占用 I/O；这是可接受的实现边界，前端序号守卫保证正确性，后续不应把旧结果写回当前目录。
- `SongRow` 的 `missing` 是可选输入；无筛选时必须保持既有行文案、选中态和点击链路完全不变。
