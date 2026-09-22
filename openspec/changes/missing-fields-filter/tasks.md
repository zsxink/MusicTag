# missing-fields-filter 任务清单

> 变更域：**both**。依赖顺序：**G1 Rust 契约/扫描 → G2 Vue 数据层 → G3 Vue UI → G4 文档与验证**。Rust 完成并冻结 IPC 后才能开始 Vue 接入；各组内先写失败测试再实现。

## G1 Rust：模型、只读扫描与 command

- [ ] 1.1 **先补失败测试**：新增 `src-tauri/tests/missing_scan.rs`，覆盖五个维度的 `trim()` 判定、封面无图片、FLAC `Lyrics`、MP3 ID3v2.4 `UnsyncLyrics`、空歌词帧、同名 `.lrc` fallback、OR 并集、未选维度忽略、固定 missing 顺序。
- [ ] 1.2 补充坏文件、权限/遍历错误和「单文件失败后其他歌曲继续」测试；断言错误进入 `errors`，失败文件不进入命中列表。
- [ ] 1.3 补充只读回归：扫描前后音频文件字节、同名 `.lrc` 字节和文件列表不变；断言实现未调用 writer、封面编码或歌词全文返回路径。
- [ ] 1.4 在 `src-tauri/src/model.rs` 增加 `MissingField`、`MissingSong`、`MissingScanError`、`MissingScanResult`；显式 serde 名称对齐 `title/artist/album/cover/lyrics`，结果字段固定为 `songs/errors`。
- [ ] 1.5 新增 `src-tauri/src/service/missing.rs`：复用 `meta::is_audio_file`、`WalkDir` 和 `lyrics::sidecar_lrc_path`；按 `checks` 只读对应字段/图片/歌词帧；固定结果顺序；单文件错误收集后继续。
- [ ] 1.6 新增 `src-tauri/src/commands/missing.rs` 与 `commands/mod.rs` 导出；实现 `async scan_missing(dir, checks)`，将同步扫描放入 `tokio::task::spawn_blocking`，区分单文件 `errors` 与 command-level `Err`。
- [ ] 1.7 在 `src-tauri/src/lib.rs` 注册 `commands::missing::scan_missing`；同步 command 契约清单所需的结构守卫输入，保持 command 壳无 lofty/文件 I/O 逻辑。
- [ ] 1.8 运行缺失扫描集成测试、`cargo check --manifest-path src-tauri/Cargo.toml` 和后端全量测试，确认 Rust 序列化结果可供前端消费。

## G2 Vue：API、store 与 selectors

- [ ] 2.1 **先补失败测试**：在 `src/api/songs.test.ts`、`src/store/song.test.ts`、`src/store/selectors.test.ts` 覆盖参数透传、默认全选/全不选、OR 命中、顶部搜索叠加、关闭/换目录复位、旧扫描结果丢弃、错误可见且不污染编辑状态。
- [ ] 2.2 在 `src/api/types.ts` 增加 `MissingField`、`MissingSong`、`MissingScanError`、`MissingScanResult`，与 Rust serde 字面量逐项对齐。
- [ ] 2.3 在 `src/api/songs.ts` 增加 `scanMissing(dir, checks)`，仅经 `invokeCommand<MissingScanResult>('scan_missing', { dir, checks })` 透传，不在 API 层实现筛选或错误解释。
- [ ] 2.4 在 `src/store/song.ts` 增加缺失筛选状态、默认五维、扫描状态/错误/结果映射和 `scanMissing` 动作；在换目录、关闭筛选、全不选、重选维度、新扫描时清理或递增序号。
- [ ] 2.5 为 `scanMissing` 实现目录快照 + `missingScanSeq` 双重过期守卫；旧目录、旧 checks、关闭筛选或失败的响应不得覆盖当前结果，也不得重置 `current/original/dirty` 或候选搜索状态。
- [ ] 2.6 在 `src/store/selectors.ts` 先按 `missingByPath` 取命中项，再沿用歌名/歌手模糊搜索和文件名排序；无筛选时断言既有结果完全不变，并为 SongRow 提供缺失映射读取方式。
- [ ] 2.7 运行 API/store/selectors 测试并修复 TypeScript 类型、响应式和契约问题。

## G3 Vue：筛选面板、列表状态与 badge

- [ ] 3.1 `SongList.vue` 增加「筛选缺失」入口、歌名/歌手/专辑/封面/歌词五个中文复选框、关闭动作和扫描状态；首次打开默认全选，全不选恢复完整列表。
- [ ] 3.2 `SongList.vue` 实现扫描完成无命中空态「没有缺失所选字段的歌曲」、扫描失败可见重试提示和单文件错误降级提示；扫描期间保留列表结构，不显示虚假进度百分比。
- [ ] 3.3 `SongRow.vue` 接收可选 `missing` 字段并渲染「缺歌名」「缺歌手」「缺专辑」「缺封面」「缺歌词」badge；无 `missing` 时保持既有视觉和文案。
- [ ] 3.4 保持行点击继续调用 `requestSwitch`/`open_song`，回归 dirty 切歌确认、坏标签只读、选中即搜、关闭查漏保留当前编辑态。
- [ ] 3.5 补组件测试：入口与默认状态、维度切换、OR 命中 badge、无命中、顶部搜索叠加、扫描中/失败、关闭恢复完整列表、点选仍调用单曲打开流程。

## G4 文档同步、验证与交付

- [ ] 4.1 同步 `docs/design/design.md` §10 的 model/command/service/API 契约和 command 注册清单；同步 `docs/V1-PRD.md` 的 V1 只读查漏边界，明确批量补全仍是 V2。（本 change 只编辑本目录 design/tasks，文档同步在实现交付阶段执行。）
- [ ] 4.2 执行 `cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test`、`npm run build` 和 `npx openspec validate missing-fields-filter --strict --no-interactive`。
- [ ] 4.3 执行专项回归：数百首扫描不阻塞 UI；扫描不写音频标签、封面或 `.lrc`；切换目录/维度/关闭筛选时旧结果不串入；顶部搜索只缩小缺失结果；既有单曲编辑和自动搜索行为不变。
- [ ] 4.4 按 pipe 规范增量提交（`feat(121): ...`），完成归档、PR 与 CI；PR 使用 `Closes #121`。Architect 阶段不提前执行实现、归档或合并。
