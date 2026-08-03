# refactor-layering Specification

## Purpose
TBD - created by archiving change v1-refactor-layering. Update Purpose after archive.
## Requirements
### Requirement: Rust command 薄层
Rust SHALL 将 `#[tauri::command]` 函数收敛为薄壳，按功能模块拆分文件，且 Tauri command 字符串契约不变。

#### Scenario: 命令名不变
- **WHEN** 重构完成
- **THEN** `pick_folder`/`list_songs`/`open_song`/`save_song` 四个 command 字符串名与参数/返回序列化形状均与重构前完全一致

#### Scenario: command 无业务逻辑
- **WHEN** 审查 `commands/` 下任意 `#[tauri::command]` 函数
- **THEN** 函数只做参数接收与对 service 层委托，不含 lofty/IO/编解码业务逻辑

### Requirement: Rust 业务分层
Rust SHALL 将业务逻辑按职责拆入 `service/`（reader/writer/meta/cover/fs_atomic）与 `model.rs` 领域模型，高内聚低耦合。

#### Scenario: 按功能模块落位
- **WHEN** 后续子变更（cover-embed / lyrics-lrc / search）新增逻辑
- **THEN** 有明确的 service 模块落位（cover.rs / lyrics.rs / searcher/*），不落入 command 薄层或 model.rs

### Requirement: 前端 api 层唯一 IPC 入口
前端 SHALL 提供集中 `api/` 层（client + types + 类型化命令封装），组件不直接调用 `invokeCommand`。

#### Scenario: 组件零 invoke 直呼
- **WHEN** 审查 `components/` 下任意 `.vue`
- **THEN** 不直接调用 `@tauri-apps/api/core` 的 invoke，IPC 一律经 `api/songs.ts`（组件通过 store 动作的 loader 注入）

#### Scenario: 类型契约独立
- **WHEN** 新增 IPC 命令（如 search/cover/lyrics）
- **THEN** 契约类型放 `api/types.ts`，类型化封装放 `api/<domain>.ts`，client 只保留 invoke 透传

### Requirement: store 单例与职责拆分
前端 SHALL 保持 design.md §10.2 单 store（不引入 Pinia/多 store），但 `store/song.ts` 只保留响应式状态与动作，纯工具与展示派生拆入 `lib/` 与 `store/selectors.ts`。

#### Scenario: dirty 响应式保持
- **WHEN** 编辑表单字段触发保存状态
- **THEN** dirty 由 reactive 实例内的 getter 实时翻转（原位保留），行为与重构前一致

#### Scenario: 纯展示派生独立
- **WHEN** 需要 `filteredSongs`/`titleText`/`artistText`
- **THEN** 由 `store/selectors.ts` 纯函数从 store 派生，不落在组件或动作内重复实现

### Requirement: 生产/测试代码分离
Rust 与前端 SHALL 将生产代码与测试代码隔离：Rust 文件 I/O 集成测试入 `src-tauri/tests/`（fixture 收 `tests/common/`），纯逻辑单测留 service 内 inline；前端约定 co-located `*.test.ts`，生产文件不夹测试逻辑。

#### Scenario: Rust 集成测试外置
- **WHEN** 运行 `cargo test`
- **THEN** 文件 I/O 集成测试在 `src-tauri/tests/` 下按命令域（list_songs/open_song/save_song）组织并全绿，`commands.rs` 不再内嵌大型测试块

#### Scenario: 前端测试卫生
- **WHEN** 运行 `npm run test`
- **THEN** 无重复 import 缺陷；`songlist-repro.test.ts` 已规范化；生产源码文件中不含测试断言逻辑

### Requirement: 纯重构零行为变更
本变更 SHALL 是纯重构：Tauri command 契约、前端 invoke 调用、UI 文案与交互全部不变。

#### Scenario: 回归全绿
- **WHEN** 重构完成
- **THEN** `cargo test`、`cargo clippy`、`npm run test`、`npm run build` 全绿，且 `npm run tauri dev` 人工走通打开文件夹→选中歌曲→读取→保存

#### Scenario: 契约形状不变
- **WHEN** 审查 `model.rs` 与 `api/types.ts`
- **THEN** serde 序列化形状（LyricsSource rename_all、Song snake_case、cover data URL base64）与重构前逐字一致

### Requirement: 分层规范入定稿文档
重构方案 SHALL 同步进 `docs/design/design.md` §10，使分层与测试放置成为后续子变更的架构约束。

#### Scenario: 文档与落地一致
- **WHEN** 后续子变更的 Architect 读取 design.md
- **THEN** 能看到 Rust commands/service/model 与前端 api/store/lib/components 的目录分层规范、测试放置约定，及未来子变更的落位说明

