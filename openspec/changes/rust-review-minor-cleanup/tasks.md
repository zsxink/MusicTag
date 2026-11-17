# rust-review-minor-cleanup 任务分解

GitHub Issue: #196
变更: `rust-review-minor-cleanup`
域: `backend`
设计依据: `openspec/changes/rust-review-minor-cleanup/design.md`
规格依据: `openspec/changes/rust-review-minor-cleanup/specs/cover-embed/spec.md`（唯一 delta，MODIFIED）
基线: `main` 的 `b98db6c` 之上、`rust-review-minor-cleanup` 分支；归档前完成全部任务与质量门。

## 完成状态（仅主会话维护）

- [x] 1.1 — Rust 取图注释改写
- [x] 1.2 — command 契约守卫注释 19 → 22
- [x] 2.1 — 无 front cover 回退测试 fixture 早检
- [x] 2.2 — 多图 front-cover 导出默认扩展名断言
- [ ] 3.1 — Verify 全量门禁

## 执行约定

- 本文件由主会话（Leader）维护勾选；子 Agent 不修改本文件状态，不执行 `git add` / `git commit` / push / PR / merge。
- 每个任务只允许改「写入路径」列出的文件；未列出的源码、测试、文档、OpenSpec 规格一律不碰。
- 本变更零产品行为变更：不改函数体、不弱化/调整既有断言阈值、不新增依赖、不新增/重命名 Tauri command、不改前端生产代码、不改历史归档。
- 任一任务失败时回报 `FAILED` + 实际命令与输出；规格冲突或需要产品裁决时回报 `NEEDS_PARENT_DECISION`，不自行扩范围。
- 任务按「依赖」列执行；写入路径不重叠且无依赖的任务可并行派发。

## 1. 注释类改动

### 1.1 Rust 取图注释改写

- 归属: Dev
- 依赖: 无
- 写入:
  - `src-tauri/src/commands/cover.rs`（仅 `export_cover` 上方 doc comment，当前第 80 行）
  - `src-tauri/src/service/cover.rs`（仅 `export_cover_bytes` 上方 doc comment，当前第 144 行）
- 目标:
  - `commands/cover.rs:80` 现状「把标签内第一个 front cover 的**原始字节**写到 `dest_path`…」改为 design §4.1.1 的准确文案：优先第一个 `CoverFront`，无则第一张；通用标签完全无图时再回退 APE 原生 `Cover Art (Front)`。
  - `service/cover.rs:144` 现状「读单曲标签内**第一个 front cover 的原始字节** + 其声明 MIME…」改为 design §4.1.2 的准确文案（同一取图语义）。
  - 只替换上述两行 doc comment；不触碰函数体、相邻段落、`use`、模块头注释。
- 覆盖 scenario: 无直接 scenario（维护性注释修正，支撑 delta spec requirement 的可读性）；对应 proposal What Changes 第 1 条。
- 验收命令:
  - `rg -n "第一个 front cover" src-tauri/src/commands/cover.rs src-tauri/src/service/cover.rs` 无输出（exit 1 为预期）。
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 退出码 0。
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 退出码 0。

### 1.2 command 契约守卫注释 19 → 22

- 归属: Dev
- 依赖: 无
- 写入: `src/styles/command-contract.test.ts`（仅第 4 行、第 39 行两处注释）
- 目标:
  - `:4`「实际注册的 19 个 command」→「实际注册的 22 个 command」。
  - `:39`「19 个 command 中无参者包括…」→「22 个 command 中无参者包括…」。
  - 不改同文件断言（`:96`、`:105` 已是 `toHaveLength(22)`）、不改正则提取逻辑、不改任何运行时代码。
  - 依据：`src-tauri/src/lib.rs:22-43` 的 `generate_handler!` 实际注册 22 个 command。
- 覆盖 scenario: 无直接 scenario（测试守卫注释与 `lib.rs` 事实对齐）；对应 proposal What Changes 第 2 条。
- 验收命令:
  - `rg -n "19 个 command" src/styles/command-contract.test.ts` 无输出（exit 1 为预期）。
  - `npm run test -- src/styles/command-contract.test.ts` 退出码 0。
  - `npm run build` 退出码 0（`vue-tsc --noEmit` + Vite 构建）。

## 2. 测试强化

### 2.1 无 front cover 回退测试 fixture 早检

- 归属: Tester
- 依赖: 无（与 1.1、1.2 文件不重叠，可并行）
- 写入: `src-tauri/tests/export_cover.rs`（仅 `export_falls_back_to_first_picture_without_front_cover`，当前第 250-272 行）
- 目标:
  - 循环前断言 `first != second`，保证两张图字节可区分。
  - 在 `no-front.flac` / `no-front.mp3` 每个容器的业务断言之前回读标签，按 design §4.3.1 断言：
    - `tag.get_picture_type(PictureType::CoverFront).is_none()`（确实无 front cover，走回退分支）；
    - `tag.pictures().len() == 2`（不是「只有一张可挑」）；
    - `pictures[0].pic_type() == CoverBack`、`pictures[1].pic_type() == Other`（两张均非 front，顺序按构造落盘）；
    - `pictures[0].data() == first`、`pictures[1].data() == second`（首图即构造的第一张）。
  - 早检通过后保留既有业务断言：`bytes == first`、`bytes != second`；不删、不弱化、不改阈值。
  - 不新增 import（`Probe`、`TaggedFileExt`、`PictureType` 已导入），不改 `common/mod.rs`。
- 覆盖 scenario: delta spec「无 front cover 的既有标签」。
- 验收命令:
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_cover export_falls_back_to_first_picture_without_front_cover` 退出码 0。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_cover` 退出码 0（既有 APE/多图/单图用例保持绿）。
  - 失败时如实回报，不得删除早检或放宽断言凑绿。

### 2.2 多图 front-cover 导出默认扩展名断言

- 归属: Tester
- 依赖: 2.1（同一测试文件，串行写入）
- 写入: `src-tauri/tests/export_cover.rs`（`export_prefers_front_cover_over_first_picture_flac`、`export_prefers_front_cover_over_first_picture_mp3`）
- 目标:
  - 两个用例在既有 `mime == Some("image/png")` 断言之后追加 `default_cover_file_name(&<path>, mime.as_deref(), &bytes) == "multi.png"`（FLAC 用 `&flac`，MP3 用 `&mp3`），消息说明「默认导出名应使用取到图片的 MIME 推断扩展名」。
  - 使用 `default_cover_file_name` 而非 `cover_extension_for`：前者是 `pick_cover_save_path` 实际调用的生产函数，覆盖「导出字节 + MIME → 存盘框预填名」完整链路；低层扩展名映射已由 `service_cover_tests.rs` 覆盖（理由见 design §4.3.2）。
  - `default_cover_file_name` 已在 `export_cover.rs:20` 导入，不新增 import；不改既有字节/MIME 断言。
- 覆盖 scenario: delta spec「首图不是 front cover 的多图标签」。
- 验收命令:
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_cover export_prefers_front_cover_over_first_picture` 退出码 0（FLAC/MP3 两个用例均命中）。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_cover` 退出码 0。

## 3. 验证

### 3.1 Verify 全量门禁

- 归属: Verify
- 依赖: 1.1、1.2、2.1、2.2
- 写入: 无（严格只读；不得改源码、测试、文档或 OpenSpec）
- 目标: 按 design §6 与 WORKFLOW §3 逐条执行，记录命令、退出码、HEAD 与关键输出；覆盖 delta spec 全部 scenario 的测试与两条 grep 事实。
- 验收命令（仓库根目录执行）:
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
  - `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`
  - `npm run test`
  - `npm run build`
  - `npx --yes @fission-ai/openspec@1.5.0 validate rust-review-minor-cleanup --strict --no-interactive`
  - CI 对齐（WORKFLOW §3 要求，全部实际启用）:
    - `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`
    - `node --test '.agents/tools/pipe-core/test/*.test.js' 'tests/workflow-core/*.test.cjs' '.agents/tools/pipe-native/test/*.test.js'`
    - `node --test tests/homebrew/publish.test.mjs`
    - `node .agents/tools/pipe-native/self-check.js`
    - `npm ci`
    - `npm run build`
    - `npm run test`
    - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
    - `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`
- 完成判定:
  - 全部命令退出码 0；不得跳过、不得用 `|| true` 吞失败。
  - `cargo test --all-targets` 输出中可见 `export_falls_back_to_first_picture_without_front_cover`、`export_prefers_front_cover_over_first_picture_flac`、`export_prefers_front_cover_over_first_picture_mp3` 且通过。
  - `rg -n "第一个 front cover" src-tauri/src/commands/cover.rs src-tauri/src/service/cover.rs` 无输出；`rg -n "19 个 command" src/styles/command-contract.test.ts` 无输出。
  - **实现文件** diff 仅包含四个授权文件（两处 Rust 注释、一处 TS 注释、一个 Rust 测试文件），无函数体/断言阈值/依赖/command 变化；`openspec/changes/rust-review-minor-cleanup/` 下的 5 个变更文档为预期产物。
  - 环境型失败（缺 ffmpeg、Node/Rust 版本不符等）如实回报 Leader，不假报通过。

## 派发批次建议（Leader 参考）

- **批次 A（无依赖、文件不重叠，可并行）**: 1.1、1.2、2.1。
- **批次 B（串行，独占同一测试文件）**: 2.2（等待 2.1 完成）。
- **批次 C（串行）**: 3.1（等待 1.1、1.2、2.1、2.2）。

## 文件所有权速查

| 路径 | 任务 | 改动性质 |
| --- | --- | --- |
| `src-tauri/src/commands/cover.rs` | 1.1 | 仅 `export_cover` doc comment |
| `src-tauri/src/service/cover.rs` | 1.1 | 仅 `export_cover_bytes` doc comment |
| `src/styles/command-contract.test.ts` | 1.2 | 仅两行注释（19 → 22） |
| `src-tauri/tests/export_cover.rs` | 2.1 → 2.2（串行） | 仅测试断言强化 |
| 验证只读 | 3.1 | 无写入 |
