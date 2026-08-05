# MusicTag — 设计语言（Design Language）

| 项 | 值 |
|---|---|
| 产品 | MusicTag |
| 版本 | V1 |
| 类型 | 桌面应用（Tauri 2 + Rust，WebView 前端） |
| 定位 | 工具线 · 自用 · 逐首补全 FLAC/MP3 元数据 |
| 日期 | 2026-08-01 |
| 配套 | 界面草图 `design/mockup.{html,css,js}` · 需求见 `V1-PRD.md` 第二部分 |

> 设计语言与草图保持同步：这里描述的全部 token / 组件 / 状态在 `mockup.css` 与 `mockup.js` 里有对应实现。

---

## 1. 设计原则

1. **工具线 > 展示线**：信息密度偏高但克制，一切视觉都为「快速补标签」服务，不讨好展示。
2. **安静的双主题**：深色为骨（默认，防启动闪白），浅色跟随系统；全界面只有**一个琥珀强调色**，其余全部用灰阶分层。
3. **数据用等宽字体**：路径、音轨号、歌词正文用 mono，强化「数据感」。
4. **少即是多**：无装饰、无渐变、无插画；状态用颜色 + 文字双重表达。

---

## 2. 色彩系统（语义 token）

### 2.1 深色（默认，`:root` 缺省值）

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#12161A` | 窗口底色 / 搜索框 |
| `--panel` | `#1A2026` | 顶栏、侧栏、输入框 |
| `--panel-2` | `#212830` | 编辑顶栏、封面区、badge 底 |
| `--border` | `#262D34` | 分隔线、描边、虚线 |
| `--text` | `#E8E9E4` | 主文字 |
| `--text-dim` | `#8A939C` | 副信息、占位、来源标签 |
| `--accent` | `#E8A33D` | 琥珀：保存 / 选中 / 焦点 / 强调 |
| `--accent-ink` | `#241A05` | 琥珀底上的文字 |
| `--danger` | `#C0553E` | 不保存 / 丢弃 |
| `--success` | `#3FA36B` | ✓ 已保存 |

### 2.2 浅色（跟随系统 `/` 手动）

| Token | 值 | 备注 |
|---|---|---|
| `--bg` | `#F4F4F1` | 暖灰底 |
| `--panel` | `#FFFFFF` | |
| `--panel-2` | `#F1F0EC` | |
| `--border` | `#DAD9D2` | |
| `--text` | `#1E2429` | |
| `--text-dim` | `#5F6A73` | |
| `--accent` | `#B4761D` | 加深以保证对比 |
| `--accent-ink` | `#FFFFFF` | |
| `--danger` | `#B3452E` | |

### 2.3 交互色

- `--hover`：深色 `rgba(255,255,255,0.05)` / 浅色 `rgba(0,0,0,0.045)` — 行、按钮 hover 底
- `--active`（选中行底）：琥珀 10–14% 透明

---

## 3. 字体排印

- **正文（sans）**：`-apple-system, BlinkMacSystemFont, PingFang SC, Segoe UI, Microsoft YaHei` — 中文优先
- **数据（mono）**：`SF Mono, ui-monospace, JetBrains Mono, Menlo, Consolas` — 路径、歌词、音轨号
- 字号阶梯：

| 字号 | 用途 |
|---|---|
| `9–10px` | 封面候选缩略图上的来源角标 |
| `11.5px` | 副信息 / badge / 状态 / 搜索触发按钮 |
| `12px` | 字段标签、按钮、候选条 meta |
| `12.5px` | 歌词正文（mono） |
| `13px` | 正文、列表行 |
| `14px` | 强调（「正在编辑」文件名） |
| `15px` | 空态标题 |

---

## 4. 间距 · 圆角 · 阴影 · 动效

- **间距基数 4px**，常用 8 / 12 / 16 / 20。
- **圆角**：输入框与列表 **8px**、按钮 **6px**、候选格/候选条 **6px**、badge 胶囊 **10px**、弹窗 **12px**。
- **阴影**：**仅弹窗**使用 `0 18px 48px`；普通界面扁平无投影。封面候选缩略图上的来源角标用 `rgba(0,0,0,0.6)` 底提升可读性。
- **动效**：过渡统一 **120ms**；按钮按压位移 **1px**；搜索中转圈 `spin .8s linear infinite`（2px 边框，顶边琥珀）。
- 尊重 `prefers-reduced-motion`，减弱过渡与动画。

---

## 5. 布局结构

```
┌────────────────────────────────────────────────────────┐
│ appbar   ♪ MusicTag │ 路径: /Volumes/…      │ [☀️主题] │
├──────────────┬─────────────────────────────────────────┤
│ sidebar 300px │ editor                                │
│ [📁 打开文件夹] │ ┌────────────────────────────────────┐ │
│ [🔍 搜索……]   │ │ 正在编辑: 告白气球.mp3 周杰伦  [状态]│ │
│ ──────────── │ │                          [撤销][保存]│ │
│ 周杰伦        │ ├────────────────────────────────────┤ │
│  床边故事     │ │ 文件名  [      ]                      │ │
│  告白气球 ▸  │ │ 歌名    [      ]    ┌──────┐         │ │
│ 五月天        │ │ 作者    [      ]    │ 封面 │         │ │
│  知足        │ │ 专辑    [      ]    │ 🖼   │         │ │
│  …           │ │ 专辑作者[      ]    │      │         │ │
│              │ │ 音轨号  [01]/共[12] └──────┘         │ │
│              │ │ 年份    [      ]   JPEG/PNG·跟随文件  │ │
│              │ │ 流派    [      ]   [🔍 搜索封面]       │ │
│              │ ├────────────────────────────────────┤ │
│              │ │ 歌词 [来源: 内嵌标签] ☑同时保存为.lrc │ │
│              │ │ [🔍 搜索歌词]                         │ │
│              │ │ ┌──────────────────────────────────┐ │ │
│              │ │ │ [00:11.32] 你说你有点难追…         │ │ │
│              │ │ └──────────────────────────────────┘ │ │
└──────────────┴─────────────────────────────────────────┘
```

- **appbar**：品牌 + 路径（mono）+ 主题按钮（**最右**）。
- **sidebar 300px**：打开文件夹 → 搜索 → 展平歌曲列表。
- **editor**：编辑顶栏（状态 + 撤销/保存右上）→ 字段网格 `1fr 200px`（左字段列 + 右封面区，封面下方接「搜索封面」）→ 歌词区（head 行 → 搜索歌词 → textarea）。

---

## 6. 组件清单与状态

### 6.1 基础组件

| 组件 | 关键状态 |
|---|---|
| 打开文件夹按钮 | 全宽、ghost；hover 微亮 |
| 搜索框 | focus 琥珀描边 |
| 歌曲行 | hover 微亮；`selected` 琥珀底 + 歌名变琥珀 |
| 输入框 | focus 琥珀描边；占位符 `--text-dim` |
| 封面区 | 虚线框 + hover 边框变琥珀；点击 / 拖拽 |
| 歌词 badge | 胶囊，`--panel-2` 底 + 描边 + dim 文字（如「来源: 内嵌标签」） |
| 保存状态 | `dirty` 琥珀文字 / `saved` 绿 |
| 撤销（ghost） | hover 微亮 |
| 保存（primary） | 琥珀底 + `--accent-ink` 文字；disabled 40% 透明 |
| 主题按钮 | ghost 方形 30×30，图标 ☀️/🌙 |
| 弹窗 | 阴影 + 12px 圆角；主/危险/ghost 三按钮；`role="dialog" aria-modal` |
| 空状态 | 图标 40px 35% 透明 + 标题 + 副说明 |

### 6.2 搜索触发按钮（`.search-trigger`）

| 属性 | 值 |
|---|---|
| 形态 | **虚线** 1px 描边，透明底，6px 圆角，全宽 |
| 文字 | `🔍 搜索歌词` / `🔍 搜索封面`，11.5px，`--text-dim` |
| hover | 描边 + 文字变琥珀 |
| 位置 | 封面区：封面框 + 元信息**下方**；歌词区：head 行与 textarea **之间**（上方） |

- 手动搜索的唯一入口；点击后进入「搜索中…」加载态。
- 真实产品中自动搜索只在选中歌曲那一刻触发一次，之后的主动搜索全部走此按钮。

### 6.3 搜索中状态（`.cand-status`）

- 居中的 11.5px dim 文字「搜索中…」，尾部跟一个 **10×10 圆形转圈**（2px 边框，顶边琥珀，`spin .8s infinite`）。
- 保证候选未就绪时用户看到明确进度，避免误判为无结果。

### 6.4 封面候选（`.cand-grid` / `.cand-cell`）

- **3 列网格**，间距 6px；每格 **1:1 方形**，6px 圆角，1px 描边，`object-fit: cover` 缩略图。
- hover 描边变琥珀；点击填入封面区预览。
- 来源角标（`.src-tag`）：缩略图**左下角**，9px 白字、`rgba(0,0,0,0.6)` 底、3px 圆角（如 网易云 / QQ音乐 / 酷狗 / LRCLIB / iTunes）。
- 网格下方一行 dim 提示（如「点选一张填入预览」）。

### 6.5 歌词候选（`.cand-row`）

- 横向条：**来源标签**（10px，`--panel-2` 底 + 描边 + dim 文字）+ **歌名 — 作者**（12px，超长省略）。
- 每条顶部间距 6px；hover 描边变琥珀 + 底 `--hover`。
- 点击一条 → 歌词填入 textarea（仍可继续编辑），badge 更新为对应来源平台。

### 6.6 候选空态（`.cand-empty`）

- 居中的 11px dim 文字（如「未找到匹配的歌词，可手动粘贴」），保留手动填写入口。

---

## 7. 交互细节

- 过渡统一 **120ms**；按钮按压位移 **1px**。
- 尊重 `prefers-reduced-motion`，减弱过渡与转圈动画。
- 键盘可操作：`⌘O` 打开、Tab 遍历字段、焦点琥珀描边。
- 弹窗标注 `role="dialog" aria-modal`，可 Esc 取消。
- 候选点选**不自动覆盖**已有内容；搜索中可重复点按钮重搜。

---

## 8. 无障碍

- 浅色强调色加深保证对比（琥珀 `#B4761D`）。
- 所有状态不只靠颜色（文字 + 颜色双重表达）。
- 最小目标字号 11.5px（封面角标 9px 仅为辅助标注），正文 13px。

---

## 9. 搜索候选区与触发模型（与 FR-8 对应）

- **自动触发（仅一次）**：选中歌曲那一刻，按「歌名 + 作者」对**缺失项**（无歌词 / 无封面）自动并发搜 5 家（网易云 + QQ + 酷狗 + LRCLIB + iTunes）；已有内容、或删除内容后**均不再自动触发**。
- **手动触发**：歌词区/封面区各有「搜索歌词 / 搜索封面」虚线按钮，随时可主动发起——删除内容后要重新搜就用它。
- **结果形态**：一律候选展示（封面缩略图网格 / 歌词候选条），用户**手动点选才填入**，不自动写盘、不自动覆盖。
- **无结果 / 断网**：候选区显示明确空态 + 保留手动填写入口。
- **候选区可折叠（candidate-collapse）**：歌词/封面候选区各一个「隐藏候选 ▲ / 展开候选 ▼」折叠按钮（默认展开），收起后候选区整体隐藏、再次点击恢复。折叠态为面板组件局部 `ref`（`candidatesCollapsed`，不进入 store），`v-show` 保留 DOM、不参与搜索生命周期（resetSearchState 语义不变）；面板常驻不销毁，故**跨切歌保持**折叠偏好，仅换目录清空编辑态（面板卸载）才重置为默认展开。**仅候选区有内容**（searching / 空态 / 离线 / done+候选）时按钮才显示（`candidatesVisible` computed，与候选区 v-if 分支逐条对齐）。

---

## 10. 前端架构（Vue 3 + Vite + TypeScript）

> 技术选型详见 `V1-PRD.md` §7。以下为组件结构、状态管理与 Tauri command 契约。
> **§10.0 目录分层规范与 §10.4 测试放置约定是 V1 全量架构约束（v1-refactor-layering 定稿，由结构守卫
> `src/styles/design-layering.test.ts` / `src/components/layering.test.ts` 校验）**——后续子变更的
> Architect 必须服从：新逻辑落位到已定目录，不得新建平级目录或把逻辑放错层；新增测试按 §10.4 放置。
> 改动本文件 §10 分层段落会触发守卫测试失败，须与代码一并提交。

### 10.0 目录分层规范（Rust + 前端）

**核心不变量**：生产代码按「薄 command 壳 → 纯业务 service → 数据模型」与「api → store → lib → components」两类分层；
IPC 在 Rust 只允许出现在 `commands/`，在前端只允许出现在 `api/client.ts`；新增子变更一律落位到下表目录。

**Rust 侧（`src-tauri/src/`）**：

| 目录/文件 | 职责 | 允许触碰的依赖 |
|---|---|---|
| `commands/` | Tauri command 薄壳：`#[tauri::command]`、参数接收、对 service 委托；lofty/IO/编解码逻辑**一律不出现** | `model`、`service` |
| `service/` | 纯业务层：`reader.rs`（标签读）、`writer.rs`（保存编排）、`meta.rs`（字段映射/格式分支）、`cover.rs`（封面 data URL 编解码）、`fs_atomic.rs`（原子写回） | `model`、lofty、`image` |
| `model.rs` | 数据类型：`Song` / `SongSummary` / `LyricsSource` / `MusicSourceId`（与前端 TS 类型对齐） | 无业务依赖 |
| `lib.rs` | `pub mod model/commands/service` + `generate_handler![...]` 注册 command；模块声明必须 `pub`，供 `src-tauri/tests/` 集成测试经 `app_lib::` 访问 | — |

**前端侧（`src/`）**：

| 目录 | 职责 | 允许触碰的依赖 | 禁止 |
|---|---|---|---|
| `api/` | Tauri IPC 类型化封装：`client.ts`（`invokeCommand` 泛型透传，**唯一 `import { invoke } from '@tauri-apps/api/core'` 处**）、`types.ts`（TS 类型）、`songs.ts`（逐 command 封装） | `@tauri-apps/api/core` | 组件直接调 invoke |
| `store/` | 单 store（非 Pinia）：`song.ts`（reactive 状态 + 动作 + dirty getter）、`selectors.ts`（纯展示派生） | `api/`、`lib/` | 组件直接改 store 对象 |
| `lib/` | 纯工具：`path.ts`（文件名/去扩展名）；无 Vue / IPC 依赖 | 无 | Vue / Tauri 依赖 |
| `components/` | `.vue` 组件树（见 §10.1）；**零 invoke 直呼**，IPC 一律经 `api/songs.ts` 注入 | `store/`、`api/` | `@tauri-apps/api/core` |

> 前端依赖方向单向：`components → store → api → client`、`store → lib`，不得反向或成环。
> `api/client.ts` 的 `import { invoke } from '@tauri-apps/api/core'` 是硬依赖——`vi.mock('@tauri-apps/api/core')`
> 依赖该 import 源，改源（直接裸 invoke / 改名）会静默失效 mock、测试跑真实 invoke 即崩溃。

### 10.1 组件树

```
App.vue
├── AppBar.vue          # 品牌 + 路径 + 主题按钮（最右）
├── SongList.vue        # 左栏：打开文件夹 + 搜索框 + 歌曲列表
│   └── SongRow.vue     # 单行（作者 + 歌名），选中高亮
├── Editor.vue          # 右栏编辑表单
│   ├── EditorBar.vue   # 正在编辑 + 保存状态 + 撤销/保存
│   ├── FieldGrid.vue   # 字段网格 1fr 200px
│   │   ├── FieldList.vue   # 文件名/歌名/作者/专辑/专辑作者/音轨号/年份/流派
│   │   │   └── FieldRow.vue
│   │   └── CoverPanel.vue  # 封面区 + 搜索封面按钮 + 候选网格
│   │       └── CoverCandidate.vue  # 单张缩略图（来源角标）
│   └── LyricPanel.vue   # 歌词 head + 搜索歌词 + 候选条 + textarea
│       └── LyricCandidate.vue
└── SwitchDialog.vue     # 切歌确认弹窗（保存/不保存/取消）
```

**拆分要点**：`CoverPanel` / `LyricPanel` 各收一个「搜索候选区」——搜索态、候选列表、来源 badge 内聚到各自面板内。`search_song` 一次调用同时喂歌词 + 封面两个候选区（候选秒出，歌词/封面各自惰性拉取）。

### 10.2 状态管理（单 store，不用 Pinia）

单一响应式 store `store/song.ts`，对应 mockup 的 `current` / `original` / `dirty`：

```ts
// store/song.ts
interface SongEditor {
  current: Song;         // 编辑中
  original: Song;        // 打开时快照
  dirty: boolean;        // computed（对比 current / original）
  lyricsSource: 'embedded' | 'sidecar' | 'none';
}
```

V1 规模用 Vue 组合式 API 的 `reactive` + `computed` 即可，不需要引入 Pinia。

**store 职责拆分（§10.0 前端分层）**：

- `store/song.ts` **只留** reactive 状态 + 动作（`selectSong` / `activateFolder` / `open` / `save` / `undo`）+ `dirty` getter；
  动作的 IPC 依赖（`loadSong` / `loadSongs` / `saveFn`）一律注入（默认 loader 为 `api/songs.ts` 封装），测试可注入桩不依赖 Tauri。
- `dirty` getter 是 **reactive 字面量内的 getter（Vue 3.5 转 live computed）**，**必须原位保留在 `reactive({...})` 内**——
  挪出即失去响应式追踪，dirty 不再随编辑更新。
- 纯工具（`fileName` / `fileNameStem`）在 `lib/path.ts`；纯展示派生（`titleText` / `artistText` / `filteredSongs`）在 `store/selectors.ts`；
  两者都不持有/修改状态，selectors 依赖方向 `selectors → songStore → api` 单向无环。

### 10.3 Tauri command 契约

TS 类型与 Rust struct 对齐（类型映射见下）：

```ts
// 与 Rust Song struct 对齐
// Rust enum 映射：LyricsSource Embedded/SidecarLrc/None ↔ 'embedded'|'sidecar'|'none'
//                MusicSourceId Netease/QqMusic/Kugou/Lrclib/Itunes ↔ 'netease'|'qqmusic'|'kugou'|'lrclib'|'itunes'
interface Song {
  path: string;
  title: string; artist: string; album: string;
  album_artist: string;
  track: string; track_total: string;
  year: string; genre: string;
  lyrics: string;
  lyrics_source: 'embedded' | 'sidecar' | 'none';
  cover: string | null;        // base64 data URL（data:image/jpeg;base64,...）
  cover_mime: string | null;
}

// 列表轻量项（list_songs 返回；详情选中后再 open_song 读）
interface SongSummary {
  path: string;
  title: string;
  artist: string;
}

// 封面选择/拖拽输入（pick_cover_file / read_cover_path 返回，与 Rust CoverInput 对齐）
interface CoverInput {
  data_url: string;  // base64 data URL（data:<mime>;base64,...，压缩后小图，直接进 Song.cover）
  mime: string;      // image/jpeg | image/png | image/webp（供 cover_mime 展示）
}

interface SongCandidate {
  source: 'netease' | 'qqmusic' | 'kugou' | 'lrclib' | 'itunes';   // MusicSourceId 字面量
  id: string;
  title: string; artist: string; album: string;
  cover_url: string | null;
}

interface SearchResult {
  songs: SongCandidate[];
  source_stats: Array<[MusicSourceId, number]>;  // 各家返回条数（失败/超时记 0）
  all_failed: boolean;  // 五源全部失败（网络错误/超时）→ true；至少一源成功（含正常空结果）→ false
}
```

**TS ↔ Rust 类型映射**：

| TS | Rust | 说明 |
|---|---|---|
| `source`/`MusicSourceId` | `'netease' \| 'qqmusic' \| 'kugou' \| 'lrclib' \| 'itunes'` | `enum MusicSourceId { Netease, QqMusic, Kugou, Lrclib, Itunes }` → camelCase 字面量 |
| `lyrics_source` | `'embedded' \| 'sidecar' \| 'none'` | `enum LyricsSource { Embedded, SidecarLrc, None }` → 字面量 |
| `cover` | `string \| null` | Rust `Option<Vec<u8>>` → **base64 data URL**（IPC 边界序列化） |
| `cover_mime` | `string \| null` | `Option<String>` |

| command | 参数 → 返回 | 用途 |
|---|---|---|
| `pick_folder()` | `() → Option<String>` | 打开原生文件夹选择器（rfd）；有上次目录 → 默认定位到该目录；取消返回 `None`，否则返回目录绝对路径 |
| `get_last_dir()` | `() → Option<String>` | 读取持久化的上次打开目录（config.json `last_dir`）；无记忆/目录已删 → `None`（启动自动加载用） |
| `save_last_dir(dir)` | `String → ()` | 记住本次打开目录（config.json 原子写）；fire-and-forget，失败静默 |
| `list_songs(dir)` | `String → Vec<SongSummary>` | 打开文件夹，深度遍历；**只读列表项**（`path`/`title`/`artist`，歌名/作者空时前端回退显示文件名） |
| `open_song(path)` | `String → Result<Song, String>` | 读取一首的**完整**标签 + 封面 base64，放进编辑区（按需读取；坏标签 → `Err`，表单只读） |
| `save_song(song, exportLrc)` | `Song, bool → Result<(), String>` | 写回原文件（cover 为 base64，Rust 侧解码）；`exportLrc` 勾选时同步写同目录同名 `.lrc`（空歌词忽略） |
| `rename_song(path, new_name)` | `String, String → Result<(), String>` | 音频 + `.lrc` 改名 |
| `pick_cover_file()` | `() → Option<CoverInput>` | 原生封面文件选择器（jpg/png/webp）；取消返回 `None`，选中 → 压缩后 data URL + mime |
| `read_cover_path(path)` | `String → Result<CoverInput, String>` | 拖拽封面路径 → 读文件 + 压缩 + data URL；读失败/非图片 → `Err(中文原因)` |
| `search_song(title, artist)` | `String, String → SearchResult` | 五源并发搜索 + 打分去重（含 `all_failed`：五源全失败才 true，冷门歌空结果 false） |
| `search_source(source, title, artist)` | `MusicSourceId, String, String → Vec<SongCandidate>` | **单源搜索原始候选**（C2 换源用，绕过跨源聚合去重）：聚合会把同曲多源候选折叠成一条导致换源失效，换源时逐源各自拿原始候选；失败/超时 → 空列表，前端跳过该源 |
| `fetch_lyric(source, id)` | `MusicSourceId, String → Option<String>` | 点选歌词候选拉文本（None = 取词失败/无词，供 C2 换源） |
| `download_cover(url)` | `String → Result<Vec<u8>, String>` | 点选封面缩略图下载（**统一封面路径**：网络/本地都归为「获得 bytes → 封面区」，`save_song` 统一嵌入；无独立 `embed_cover`；失败 → `Err` 前端静默忽略该张） |

**封面传递**：`Song.cover` 用 **base64 data URL**（`data:image/jpeg;base64,...`），`<img :src="song.cover">` 直接用；一次只编辑一首、图不大，不必配置 asset 协议。写盘时 `save_song` 收到 base64，Rust 侧解码回 `Vec<u8>` 再写原文件（磁盘落盘形式仍是原始字节，见 PRD §5.3）。

**惰性拉取**：`search_song` 一次返回候选（封面 URL + 歌词 id），点选封面才 `download_cover`、点选歌词行才 `fetch_lyric`。

### 10.4 测试放置约定与子变更落位

**测试放置约定（Rust / 前端统一）**：

- **Rust 集成测试（文件 I/O）**：外置到 `src-tauri/tests/`（当前 `list_songs.rs` / `open_song.rs` / `save_song.rs`），经 `app_lib::` 访问生产代码，**不落 src/ 内**；共享 fixture（构造最小合法 FLAC/MP3、全字段标签、封面 data URL、`mock_http_once`）收 `tests/common/mod.rs`，各测试 crate 按需引用子集。
- **Rust 单测（纯逻辑）**：**一律外置** `src-tauri/tests/`（与集成测试同目录，`*_tests.rs`），`src/` 生产代码**零 `#[cfg(test)]`**；共用测试工具收 `tests/common/`；被测试直接引用的私有项提 `pub`（集成测试是独立 crate，仅 `pub` 可见），测试专用 helper（fake 源、`png_of_size` 等）复制进测试文件。
- **前端测试**：co-located `*.test.ts` 与被测文件同目录（`src/api/*.test.ts`、`src/store/*.test.ts`、`src/lib/*.test.ts`、`src/components/*.test.ts`）；`@tauri-apps/api/core` 的 mock 只依赖 `api/client.ts` 的 import 源。
- **结构守卫测试**：`src/styles/design-layering.test.ts`（扫描本文件 §10 断言分层/测试放置/落位说明齐全）+ `src/components/layering.test.ts`（扫描 components/ 断言零 invoke 直呼）——分层规范改代码时须同步本文件，否则守卫失败。

**子变更落位记录（service/api 落位，v1-cover-embed → v1-search-ui 均已实现并归档；本表为历史落位记录，供后续 Architect 参照分层惯例）**：

| 子变更（epic 项，已归档） | Rust 落位 | 前端落位 |
|---|---|---|
| v1-cover-embed（封面嵌入） | `service/cover.rs` 扩展（data URL 编解码已在此） | `api/songs.ts` 既有封装 + 组件 |
| v1-lyrics-lrc（歌词 LRC 读写） | 新增 `service/lyrics.rs` | `api/songs.ts` |
| v1-rename-sync（文件名改名 + `.lrc` 同步） | 新增 `service/rename.rs`（`.lrc` 路径复用 `service::lyrics::sidecar_lrc_path`） | `api/songs.ts`（`rename_song` 封装） |
| v1-search-backend（三家并发搜索 + 网易云加密） | 新增 `service/searcher/`（子模块） | — |
| v1-search-ui（歌词/封面候选 UI） | — | 新增 `api/search.ts`（`search_song` / `fetch_lyric` / `download_cover` 封装） |

> 以上 5 个子变更均已实现并归档（`openspec/changes/archive/` 齐全），本表保留为架构落位参照，不再有「未来/后续」含义。

- 新 command 一律：Rust `commands/` 加薄壳 → `service/` 落业务 → `lib.rs` `generate_handler!` 注册；前端 `api/` 加封装 → store 注入 → 组件消费。
- `searcher` 的加密（aes/cbc/rsa）与五家 HTTP 聚合是纯逻辑，无 Tauri 依赖，放 service 层（单测外置 `tests/searcher_*_tests.rs`）。
- `api/search.ts` 只做 IPC 透传（同 `songs.ts` 模式），候选生命周期（选中即搜、切歌即弃）逻辑在 store，不在 api 层。
