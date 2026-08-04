# MusicTag 体验优化 + 分层重构增强 — 设计文档

> 日期：2026-08-05
> 范围：README 产品文案、UI 体验调整（字段顺序/歌词高度/候选折叠/左栏高度）、目录记忆（启动自动加载）、生产/测试代码彻底分离 + 代码规范强化
> 状态：设计稿（待用户审阅）

## 背景与目标

V1 功能已全部落地（一次一首编辑、自动搜索、保存写盘）。本次四项改动分属「体验打磨」与「工程规范加固」两类：

1. **README 产品文案** —— 从「内部约束口吻」转为「产品视角」，只讲功能与价值。
2. **UI 体验调整** —— 编辑表单布局更顺（文件名字段置顶、歌词框加高），搜索候选可折叠，修复左栏高度被右栏撑顶的问题。
3. **目录记忆** —— 记住上次打开的文件目录，重启自动加载（Rust 侧配置文件）。
4. **生产/测试代码彻底分离 + 代码规范强化** —— 将 Rust 生产文件内嵌的约 2200 行单测拆到 `tests/`，并在 spec 中显式补充前后端业界规范。

> ⚠️ 第 4 项是对既有 `v1-refactor-layering`（已归档）的**增强**：该变更定稿了「command 薄壳/service 分层/前端 api→store→lib→components」目录规范，但当时约定「Rust 纯逻辑单测内联在 service/model 文件内」。本次将其升级为「**单测一律拆出生产文件**」，并补强 §10.4 测试放置约定与代码规范。

---

## 一、README 产品文案

### 目标
站在产品角度介绍，简约、少 AI 味，只讲「是什么、能做什么」。

### 定稿文案（用户已批准）

```markdown
# MusicTag

MusicTag 是一个跨平台桌面应用，为本地音乐文件补全元数据。

- **支持格式**：FLAC / MP3
- **编辑音乐标签**：歌名、作者、专辑、专辑作者、音轨号、年份、流派
- **编辑封面**：点选或拖拽嵌入图片
- **编辑歌词**：内嵌歌词，可同时导出 .lrc
- **自动搜索**：选中歌曲后，对缺失的歌词与封面自动联网搜索（网易云、QQ 音乐、酷狗、LRCLIB、iTunes 多源并发），候选手动点选后写入
```

### 落位
- 替换 `README.md` 现有「项目简介」「核心特性」两节。
- 删除原文「目标播放器/无批量/无在线曲库/无账号」等对外的非功能约束措辞。
- **保留**：技术栈、常用命令、文档入口、协作流程四节（仓库文档属性，非产品文案）。

---

## 二、UI 体验调整

### 2.1 文件名字段移到最上

**现状**：`src/components/FieldList.vue:9-16` 字段顺序为 歌名→作者→专辑→专辑作者→音轨号→年份→流派→文件名（第 8 位）。

**改动**：`FieldRow label="文件名" kind="file"` 移到 `<FieldList>` 模板**最顶部**（歌名之前）。

```vue
<FieldRow label="文件名" kind="file" />
<FieldRow label="歌名" field="title" />
<FieldRow label="作者" field="artist" />
...
```

> 视觉上，文件名在表单最上方，作为「这首歌是谁」的第一信息。`kind="file"` 的 readonly/mono 样式不变。

### 2.2 歌词输入框高度 ×2

**现状**：`src/components/LyricPanel.vue:218` `.lyrics-box { min-height: 180px }`。

**改动**：`min-height: 180px → 360px`。

> 保留 `resize: vertical`（用户仍可手动拉高），只是默认高度翻倍。

### 2.3 搜索候选可折叠（歌词/封面各一个）

**现状**：歌词候选（`LyricPanel.vue:65-81`）与封面候选（`CoverPanel.vue:163-177`）搜索完成后常显。

**改动**：两个面板各加一个「隐藏/展开」小按钮，默认展开；收起后候选区整体隐藏。

**实现要点**：
- 每个面板新增一个 UI 态 `candidatesCollapsed: boolean`（组件局部 `ref` 即可，不进 store —— 它是纯展示偏好，无跨组件依赖）。
- 折叠按钮放在面板 head 行右侧（歌词 head / 封面搜索按钮上方）。
- 折叠态文案：「隐藏候选 ▲」/「展开候选 ▼」，按钮为轻量 text button，风格贴合现有 `.search-trigger`。
- 收起后候选区 `v-show` 隐藏（保留 DOM，不重算搜索状态；切歌/重搜时 resetSearchState 照旧）。
- 点击「搜索歌词/搜索封面」或切歌后，若候选重新出现，**保持当前折叠偏好**（不自动展开）——避免搜索结果又把编辑区顶高。

> 关键：折叠只影响右栏 `.editor-body` 内部滚动，不影响左栏（见 2.4）。

### 2.4 修复左栏高度被右栏撑顶

**现状**：`.workspace` 为 flex 行（`App.vue:39-43`），`SongList` 与 `.editor-slot` 为兄弟。左栏列表 `ul` 已 `flex:1 1 auto + overflow-y:auto`，理论互不挤压。但用户观察到搜索结果展开时左栏高度异常。

**根因**（需实跑 `npm run tauri dev` 复现确认，设计先给方向）：
- `.workspace` 是 `flex: 1 1 auto` 但无 `overflow`；`.editor-slot` 内 `.editor` → `.editor-body` 是 `overflow-y:auto`。若 `.editor` 或中间某层未守住 `min-height:0`，`.editor-body` 内容超高时会把 `.workspace` 撑高，进而把左栏 `SongList` 顶起来（flex 行内两项都跟着长高）。
- 候选区展开 → `.editor-body` 内容变高 → 触发撑高链路。

**改动方向**：
- 给 `.workspace` 加 `overflow: hidden`，锁定高度边界。
- 确保 `.editor-slot` → `.editor` → `.editor-body` 整条链 `min-height: 0`（`.editor` 已有，检查 `.editor-slot`）。
- 确认左栏 `SongList` 高度恒等于 `.workspace` 可用区，右栏超高时**仅右栏内部滚动**。

> 验收：打开含多搜索结果歌曲，左栏列表高度不变、右栏出现滚动条、窗口不整体变高。

---

## 三、目录记忆（启动自动加载）

### 3.1 需求
记住上次打开的文件目录；应用重启后自动加载该目录（等价自动点了「打开文件夹」）。

### 3.2 存储：Rust 侧配置文件

**位置**：平台配置目录（`dirs::config_dir()`）下 `musictag/config.json`。
- macOS: `~/Library/Application Support/musictag/config.json`
- Linux: `~/.config/musictag/config.json`
- Windows: `%APPDATA%\musictag\config.json`

**新增依赖**：`dirs` crate（跨平台配置目录定位，成熟轻量）。加入 `src-tauri/Cargo.toml`。

**配置结构**（`serde` 序列化）：
```json
{ "last_dir": "/path/to/music" }
```

### 3.3 后端改动

**新增 service 模块** `src-tauri/src/service/config.rs`（归属 service 层，符合 §10.0 分层）：
- `load_last_dir() -> Option<String>`：读 `config.json` 取 `last_dir`；文件不存在/损坏 → `None`（静默降级，不 panic）。
- `save_last_dir(dir: &str)`：写回 `config.json`（原子写：临时文件 + rename，复用 `fs_atomic` 语义）。

**新增 command** `commands/folder.rs`：
- `get_last_dir() -> Option<String>`：委托 `service::config::load_last_dir`。
- `save_last_dir(dir: String)`：委托 `service::config::save_last_dir`。
- 修改 `pick_folder()` → 先 `service::config::load_last_dir()`，有值则 `rfd::FileDialog::new().set_directory(last_dir)`（选择器默认定位到上次目录）；`None`（首次运行/无记忆）→ 不开 `set_directory`，保持系统默认位置。

**注册**：`lib.rs` `generate_handler![...]` 追加 `get_last_dir` / `save_last_dir`。

### 3.4 前端改动

**API 层**（`src/api/songs.ts` 追加）：
```ts
export function getLastDir(): Promise<string | null> {
  return invokeCommand<string | null>('get_last_dir')
}
export function saveLastDir(dir: string): Promise<void> {
  return invokeCommand<void>('save_last_dir', { dir })
}
```

**store**（`src/store/song.ts`）：
- 新增动作 `rememberLastDir()`：`activateFolder` 成功设置 `folderPath` 后，调 `saveLastDir(dir)` 持久化（fire-and-forget，失败静默）。
- 新增 `initLastDir(loadSongs)`：启动时 `getLastDir()` → 非空 → `activateFolder(dir, loadSongs)`。**复用既有激活链路**（含 dirty 拦截、列表加载），不新造逻辑。

**挂载点**：`SongList.vue` 或 `App.vue` 的 `onMounted` 调用 `initLastDir((dir) => listSongs(dir))`。放在 `SongList.vue`（左栏持目录状态，先例一致）。

**目录不存在兜底**：`getLastDir` 返回的目录若已被删除，`list_songs` 返回空列表（walkdir 对不存在路径产出空迭代），`activateFolder` 照常设置 `folderPath`。**可选**：Rust `get_last_dir` 校验 `dir.is_dir()`，不存在返回 `None`，前端回退空态。→ 采用后者（更干净，避免打开一个不存在的目录）。

### 3.5 行为细节
- **首次运行**：无 config → `get_last_dir()` 返回 None → 不自动加载，保持「未打开文件夹」空态。
- **选择器默认定位**：`pick_folder` 用上次目录作 `set_directory`。
- **保存时机**：每次 `activateFolder` 成功即写盘（换目录也更新记忆）。
- **只存目录**：不存选中歌曲、不存编辑草稿（V1 无此需求，YAGNI）。

---

## 四、生产/测试代码彻底分离 + 代码规范强化

### 4.1 现状盘点（已量化）

**Rust 侧 13 个生产文件内嵌 `#[cfg(test)]` 单测（约 2200 行）**：

| 文件 | 总行数 | 内嵌测试块起始行 | 约测试行数 |
|---|---|---|---|
| `commands/cover.rs` | 73 | 29 | 45 |
| `model.rs` | 328 | 111 | 218 |
| `service/cover.rs` | 494 | 134 | 361 |
| `service/lyrics.rs` | 160 | 62 | 99 |
| `service/meta.rs` | 129 | 96 | 34 |
| `service/rename.rs` | 96 | 73 | 24 |
| `service/searcher/crypto.rs` | 281 | 126 | 156 |
| `service/searcher/itunes.rs` | 183 | 105 | 79 |
| `service/searcher/kugou.rs` | 473 | 251 | 223 |
| `service/searcher/lrclib.rs` | 196 | 109 | 88 |
| `service/searcher/mod.rs` | 994 | 381 | 614 |
| `service/searcher/netease.rs` | 344 | 187 | 158 |
| `service/searcher/qqmusic.rs` | 299 | 165 | 135 |
| **合计** | | | **≈2234** |

**前端**：已规范（独立 `*.test.ts` 与被测文件同目录，20 个测试文件），生产源码无夹测试。`src/store/song.ts` 的 `describe` 命中为误报（`path.basename` 子串），已核实无测试混入。**前端无需搬测试，只需把规范写死进 spec**。

**现状集成测试**：`src-tauri/tests/`（`list_songs.rs`/`open_song.rs`/`save_song.rs`/`rename_song.rs`/`lyrics_lrc.rs` + `common/`）。

### 4.2 拆分方案

**目标形态**：
```
src-tauri/
├── src/            # 生产代码（零 #[cfg(test)]）
│   ├── lib.rs
│   ├── main.rs
│   ├── commands/...
│   ├── model.rs
│   └── service/...
└── tests/          # 全部测试（单测 + 集成）
    ├── common/mod.rs           # 共享 fixture（已存在）
    ├── list_songs.rs           # 集成（已存在）
    ├── open_song.rs            # 集成（已存在）
    ├── save_song.rs            # 集成（已存在）
    ├── rename_song.rs          # 集成（已存在）
    ├── lyrics_lrc.rs           # 集成（已存在）
    ├── model_tests.rs          # ← 从 model.rs 拆出
    ├── service_cover_tests.rs  # ← 从 service/cover.rs 拆出
    ├── service_lyrics_tests.rs # ← 从 service/lyrics.rs 拆出
    ├── service_meta_tests.rs   # ← 从 service/meta.rs 拆出
    ├── service_rename_tests.rs # ← 从 service/rename.rs 拆出
    ├── service_commands_cover_tests.rs # ← 从 commands/cover.rs 拆出
    ├── searcher_crypto_tests.rs # ← 从 service/searcher/crypto.rs 拆出
    ├── searcher_itunes_tests.rs # ← ...
    ├── searcher_kugou_tests.rs
    ├── searcher_lrclib_tests.rs
    ├── searcher_mod_tests.rs    # ← 从 service/searcher/mod.rs 拆出（最大，614 行）
    ├── searcher_netease_tests.rs
    └── searcher_qqmusic_tests.rs
```

**关键工程点**：

1. **可见性提升**：`tests/` 目录的测试属于**独立 crate**，只能访问 `app_lib::` 下的 `pub` 项。内嵌单测里访问的私有函数/类型需提升为 `pub(crate)`（crate 内可见，不暴露外部 API）。
   - 生产代码改动：被测试的私有函数加 `pub(crate)` 或 `pub`。
   - `lib.rs` 需 `pub use` / `pub mod` 暴露被测模块路径（现状模块已 `pub mod`，命令注册在 `lib.rs`）。

2. **模块路径**：`app_lib::model`、`app_lib::service::searcher::...` 已可访问（`lib.rs` 已 `pub mod`）。拆出文件只需 `use app_lib::...` 或 `use music_tag::...`（crate 名 `app_lib`）。

3. **夹具复用**：测试构造音频/标签/封面 data URL 的逻辑，若拆出的单测也需要，收进 `tests/common/mod.rs`（已存在，扩展）。

4. **无行为变更**：纯搬运 + 可见性提升，**不改任何业务逻辑、不改 command 契约、不改前端**。拆完 `cargo test` 必须全绿。

### 4.3 代码规范强化（写进 spec）

在 `design.md §10.4` 与 openspec 变更 spec 中显式补充前后端**业内好的实践规范**，作为后续子变更的架构约束：

**Rust 侧规范**：
- **分层**：`commands/` 薄壳（参数接收 + service 委托，无业务逻辑）；`service/` 纯业务（lofty/IO/编解码）；`model.rs` 纯数据类型。单向依赖 `commands → service → model`。
- **生产/测试分离**：`src/` 生产代码**零 `#[cfg(test)]`**；所有测试（单元 + 集成）放 `src-tauri/tests/`。
- **可见性最小化**：尽量 `pub(crate)` 而非 `pub`，不把内部实现泄漏为公开 API。
- **错误处理**：业务错误返回中文 `Result<_, String>`（Tauri 边界可序列化），不用 panic。
- **异步**：网络/IO 用 `async fn` + `tokio`，并发聚合用 `futures`/`tokio::join!` 模式（沿用 searcher 现状）。
- **命名**：函数动词开头、模块语义化；`snake_case`。
- **无 unwrap/expect in production**（测试除外）。

**前端（Vue 3 + TS）侧规范**：
- **分层**：`api/`（IPC 封装）→ `store/`（状态+动作）→ `lib/`（纯工具）→ `components/`（展示）。单向依赖，组件零 invoke 直呼。
- **组合式 API**：`<script setup lang="ts">`；单 store（非 Pinia）。
- **测试**：co-located `*.test.ts` 与被测文件同目录；生产源码文件不含测试断言。
- **类型**：IPC 契约类型集中 `api/types.ts`，与 Rust struct 对齐（`camelCase` 字面量枚举映射）。
- **组件边界**：展示组件不直接改 store 对象，经 store 动作。
- **模板**：勿在模板写 ref/computed 的 `.value`（vue-template-unwrap 陷阱，已有教训）。

**通用规范**：
- 测试驱动：新逻辑先写失败测试再实现到绿（项目已约定）。
- 回归门禁：`cargo test`、`cargo clippy`、`npm run test`、`npm run build` 全绿。
- 结构守卫测试（`design-layering.test.ts`）随 §10 改动同步更新。

### 4.4 与现有 §10.4 的冲突处理

现有 `design.md:367`：「Rust 纯逻辑单测 `#[cfg(test)] mod tests` **内联**在 service / model 对应文件内」。

**改动**：该行改为「Rust 所有测试（含纯逻辑单测）一律外置 `src-tauri/tests/`，`src/` 生产代码零 `#[cfg(test)]`」。
- 结构守卫测试 `design-layering.test.ts` 会断言 §10 分层段落——需同步更新守卫断言（若它检查「内联」字样）与代码一并提交。
- `src/components/layering.test.ts`（零 invoke 直呼）不受影响。

---

## 五、测试与验证计划

### Rust
- 拆分后 `cargo test --manifest-path src-tauri/Cargo.toml` 全绿（原内嵌单测 + 集成测试全部通过）。
- `cargo clippy` 无新增警告。
- 新增 `service::config` 单测（config 读写、原子写、损坏文件降级）。

### 前端
- `npm run test` 全绿。
- `npm run build` 通过（vue-tsc 类型检查）。

### 人工验证（npm run tauri dev）
1. 文件名字段在表单最顶部。
2. 歌词框默认高度明显增高（~2 倍）。
3. 搜索歌词/封面后，候选区有「隐藏/展开」按钮，收起后编辑区变矮。
4. 多结果歌曲：展开候选时左栏高度不变、右栏滚动、窗口不整体变高。
5. 打开目录 → 重启 → 自动加载上次目录；选择器默认定位到上次目录。
6. 首页不打开目录时无异常（首次运行空态）。

---

## 六、文档同步

按项目规则「改产品行为先同步 V1-PRD / design.md」：

| 文档 | 同步内容 |
|---|---|
| `README.md` | 产品文案 v2（已批准） |
| `docs/design/design.md` | §10.4 测试放置约定升级（内联→外置）；新增 `service/config.rs` 落位；§10.3 新增 `get_last_dir`/`save_last_dir` command 契约 |
| `docs/V1-PRD.md` | 若 UI 行为（字段顺序/歌词高度/候选折叠/目录记忆）属产品行为，补对应 FR 描述 |

---

## 七、风险与边界

- **拆分工作量**：约 2234 行测试搬运 + 可见性提升，机械但量大。按模块分步搬、每步 `cargo test` 保绿。
- **可见性提升污染**：`pub(crate)` 适量（被测才提），避免大面积 `pub` 暴露。
- **目录记忆与 dirty 拦截交互**：`initLastDir` 走 `activateFolder` 而非 `requestFolder`——启动时无 dirty（fresh state），直接激活无需弹窗。
- **折叠偏好生命周期（已拍板：跨切歌保持）**：组件局部 ref，切歌/换目录**保持**用户折叠偏好，不随内容重置。纯展示态、无跨组件依赖，不随 `resetSearchState` 清理。
