# 任务（变更域 both；依赖序 Rust → Vue 串行）

## G1 Rust 模型与缺失扫描（后端）

- [ ] 1.1 先补失败测试：覆盖五个维度的 trim 判定、封面为空、FLAC/MP3 内嵌歌词、同名 `.lrc` fallback、OR 并集、坏标签/单文件错误继续扫描和只读不写盘。
- [ ] 1.2 `src-tauri/src/model.rs` 增加 `MissingField`、`MissingSong`、扫描结果契约，显式 serde 名称与前端对齐。
- [ ] 1.3 新增 service 缺失检查模块：复用音频过滤和 `.lrc` 路径规则；只读取文本、图片存在性、歌词帧存在性，不编码封面、不读取歌词全文、不写盘。
- [ ] 1.4 新增 `scan_missing` command 并注册到 `lib.rs`；command 层保持薄壳，业务放 service。
- [ ] 1.5 运行缺失扫描集成测试、`cargo check` 和后端全量测试，形成可供前端消费的稳定契约。

## G2 前端 API、store 与派生（前端）

- [ ] 2.1 先补失败测试：API 参数透传、默认全选/全不选、OR 命中、顶部搜索叠加、关闭/换目录复位、旧扫描结果丢弃、IPC 错误可见且不污染编辑状态。
- [ ] 2.2 `src/api/types.ts`、`src/api/songs.ts` 增加缺失枚举、结果类型和 `scanMissing` 封装。
- [ ] 2.3 `src/store/song.ts` 增加缺失筛选状态、扫描动作、序号+目录过期守卫，并在换目录/关闭筛选/重选条件时清理旧结果。
- [ ] 2.4 `src/store/selectors.ts` 将缺失筛选与既有顶部搜索叠加，保持无筛选时既有排序和结果不变。
- [ ] 2.5 运行 API/store/selectors 测试并修复类型契约问题。

## G3 列表 UI（前端）

- [ ] 3.1 `SongList.vue` 增加入口、五个复选框、扫描状态、无命中空态和关闭筛选动作；全部取消恢复完整列表。
- [ ] 3.2 `SongRow.vue` 增加具体缺失 badge，保留既有选中、dirty 切歌确认和单曲编辑路径。
- [ ] 3.3 补组件测试：默认全选、维度切换、badge、无命中、顶部搜索叠加、扫描中/失败、点选仍调用 `open_song`。

## G4 文档、回归与验证

- [ ] 4.1 同步 `docs/design/design.md` §10 command/model/service 契约。
- [ ] 4.2 同步 `docs/V1-PRD.md`：增加 V1 只读查漏能力，明确一次一首和批量补全 V2 边界。
- [ ] 4.3 执行 `cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test`、`npm run build` 和 `npx openspec validate missing-fields-filter --strict --no-interactive`。
- [ ] 4.4 回归检查：数百首扫描不阻塞 UI；不产生标签/封面/歌词写入；切换目录和复选条件时旧结果不会串入；既有单曲编辑和自动搜索行为不变。
- [ ] 4.5 按 pipe 规范增量提交，归档 change，创建并等待 CI，通过后合并 PR（`Closes #121`）。
