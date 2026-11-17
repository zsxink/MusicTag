# rust-review-hardening 任务分解

GitHub Issue: #194
变更: `rust-review-hardening`
域: `backend`
设计依据: `openspec/changes/rust-review-hardening/design.md`
规格依据: `openspec/changes/rust-review-hardening/specs/` 下六份 delta spec
基线: `main` 之上、`rust-review-hardening` 分支；归档前完成全部任务与质量门。

## 完成状态（仅主会话维护）

- [x] 1.1 — 提交 8d8c097
- [x] 1.2 — 提交 3b5cb03
- [x] 2.1 — 提交 8d8c097
- [x] 2.2 — 提交 8ebe6d5
- [x] 3.1 — 提交 8d8c097
- [x] 3.2 — 提交 8d8c097
- [x] 3.3 — 提交 213fd73
- [x] 4.1 — 提交 61e95ea
- [x] 4.2 — 提交 9e73fd5
- [x] 5.1 — 提交 2a78316
- [x] 5.2 — 提交 a26ba1e
- [x] 6.1 — 提交 61e95ea
- [x] 7.1 — 提交 61e95ea、071caac（格式）
- [x] 8.1 — 提交 1245e49
- [ ] 9.1 — 待 Tester 全场景覆盖审计
- [ ] 9.2 — 待 CR 只读审查
- [ ] 9.3 — 待 Verify 全量门禁

## 执行约定

- 本文件由主会话（Leader）维护勾选；子 Agent 不修改本文件状态，不执行 `git add` / `git commit` / push / PR / merge。
- 每个任务只允许改“写入路径”列出的文件；未列出的源码、文档、OpenSpec 规格一律不碰。
- 生产代码 `src/` 内不得新增 `#[cfg(test)]`；所有新测试放 `src-tauri/tests/`，经 `app_lib::` 访问生产 API。
- 不新增依赖、不新增/重命名 Tauri command、不改前端 `src/`。
- 用户可见错误必须是中文；不得吞错假报成功。
- 任一任务失败时回报 `FAILED` + 实际命令与输出；规格冲突或需要产品裁决时回报 `NEEDS_PARENT_DECISION`，不自行扩范围。
- 任务按“依赖”列执行；无依赖且写入路径不重叠的任务可并行派发（建议批次见文末）。

## 1. 封面取图优先 `CoverFront`（must-fix）

### 1.1 读侧取图优先 front cover

- 归属: rust-backend
- 依赖: 无
- 写入: `src-tauri/src/service/reader.rs`
- 目标:
  - 修改 `first_embedded_picture(path, tag)`：先 `t.get_picture_type(PictureType::CoverFront)`，无则 `t.pictures().first()`，再走既有 APE `read_ape_cover` 回退。
  - 保持函数签名、APE 回退条件与“通用标签有任意图片就不走 APE”的既有优先级不变。
  - 更新模块/函数注释，说明预览与导出共用该选择。
- 验收:
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 退出码 0。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_cover --test open_song` 退出码 0（既有单图/APE 测试保持绿）。
  - 改动范围仅 `reader.rs`。

### 1.2 多图 front cover 回归测试与 fixture

- 归属: tester
- 依赖: 1.1
- 写入:
  - `src-tauri/tests/common/mod.rs`
  - `src-tauri/tests/export_cover.rs`
  - `src-tauri/tests/open_song.rs`
- 目标:
  - 在 `common` 增加 `pub fn add_pictures(path: &Path, pictures: &[(PictureType, Vec<u8>)])`（顺序写入，不额外追加 CoverFront）与第二种颜色 PNG helper，保证 front/back 字节不同。
  - `export_cover.rs` 增加 fixture 早检：构造“首图 BackCover、次图 CoverFront”的标签，读回断言 `pictures()` 顺序与类型；随后断言导出字节来自第二张。
  - 覆盖 FLAC 与 MP3 的导出；覆盖 `read_song_meta` 预览 data URL 解码后与 front 原始字节一致。
  - 覆盖“无 front cover → 第一张”的既有回退；APE 既有回退测试保持通过。
- 必须新增/命名的测试:
  - `fixture_early_check_multi_picture_order`
  - `export_prefers_front_cover_over_first_picture_flac`
  - `export_prefers_front_cover_over_first_picture_mp3`
  - `export_falls_back_to_first_picture_without_front_cover`
  - `open_song_preview_prefers_front_cover_over_first_picture`
  - `open_song_preview_falls_back_to_first_picture_without_front_cover`
- 验收:
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_cover --test open_song` 退出码 0。
  - 上述测试名全部出现在输出中且通过；不得删改既有 APE/无封面测试来凑绿。

## 2. 改名撞名改用 `symlink_metadata`（must-fix）

### 2.1 撞名预检 helper 与调用替换

- 归属: rust-backend
- 依赖: 无
- 写入: `src-tauri/src/service/rename.rs`
- 目标:
  - 新增 `pub fn target_exists(path: &Path) -> Result<bool, String>`：`fs::symlink_metadata` 返回 `Ok` → `Ok(true)`；`ErrorKind::NotFound` → `Ok(false)`；其他错误 → `Err("检查目标是否存在失败: {error}")`。
  - `rename_song` 的音频目标与 `.lrc` 目标检查改用 `target_exists(...)?`，不再用 `.exists()`。
  - 保留 `new_path == new_lrc` 特例（仍返回“目标已存在”）；所有检查仍在第一次 `fs::rename` 之前。
  - 更新模块/函数注释中的 `exists()` 描述。
- 验收:
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 退出码 0。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test rename_song --test service_rename_tests` 退出码 0。
  - 既有普通文件撞名/`.lrc` 撞名/成功改名测试全部保持通过。

### 2.2 悬空链接与元数据错误测试

- 归属: tester
- 依赖: 2.1
- 写入:
  - `src-tauri/tests/rename_song.rs`
  - `src-tauri/tests/service_rename_tests.rs`
- 目标:
  - 音频目标为悬空 symlink → `Err("目标已存在")`，链接与原音频保留（`#[cfg(unix)]`）。
  - `.lrc` 目标为悬空 symlink → 拒绝；原音频与旧 `.lrc` 均不动（`#[cfg(unix)]`）。
  - 音频目标是目录 → 拒绝（跨平台）。
  - `target_exists` 对普通文件、目录、符号链接（含悬空）均返回 `Ok(true)`（symlink 部分 `#[cfg(unix)]`）。
  - `target_exists` 对非 `NotFound` 的元数据错误返回 `Err`：在 Unix 下用“父组件是普通文件”构造 `ENOTDIR`，断言错误含“检查目标是否存在失败”，且不执行 rename。
- 必须新增/命名的测试:
  - `rename_rejects_dangling_symlink_audio_target`
  - `rename_rejects_dangling_symlink_lrc_target`
  - `rename_rejects_directory_audio_target`
  - `target_exists_treats_regular_file_and_directory_as_existing`
  - `target_exists_treats_symlink_as_existing`
  - `target_exists_propagates_non_not_found_metadata_error`
- 验收:
  - `cargo test --manifest-path src-tauri/Cargo.toml --test rename_song --test service_rename_tests` 退出码 0。
  - 悬空链接测试在 Unix CI 上实际执行；不得用 `#[ignore]` 或条件跳过普通文件/目录测试。

## 3. 毒化锁安全降级（should-fix）

### 3.1 FolderWatch 去除 `into_inner`

- 归属: rust-backend
- 依赖: 无
- 写入: `src-tauri/src/service/folder_watch.rs`
- 目标:
  - `shutdown()`：仅 `if let Ok(mut target) = self.target.lock()` 时设置 `closed = true` 并 `active.take()`；毒化时安全跳过，不 panic。
  - PollWatcher 注册错误回调：仅在 `result` 为 `Err` 时尝试加锁；`if let Ok(mut slot)` 才写入错误，毒化时丢弃本次记录。
  - 注册完成后的错误取出：`registration_error.lock().ok().and_then(|mut slot| slot.take())`；毒化时视为无错误记录，继续既有成功/失败语义。
  - 正常替换监听、停止监听与失效事件通知行为不变。
- 验收:
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 退出码 0。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test folder_watch --test folder_watch_tests` 退出码 0。
  - `grep -n "into_inner" src-tauri/src/service/folder_watch.rs` 无输出（grep 退出码 1 为预期），并在回报中附命令与输出。

### 3.2 MenuState 毒化记录并恢复读取

- 归属: rust-backend
- 依赖: 无
- 写入: `src-tauri/src/lib.rs`
- 目标:
  - 新增私有 `lock_state()`：`Ok(guard)` 直接返回；`Err(poisoned)` 先 `eprintln!("菜单状态锁异常（已恢复读取）: {poisoned}")`，再 `poisoned.into_inner()`。
  - `is_enabled` / `snapshot` 改走 `lock_state()`；毒化后返回最后一次可见 map 的内容，不返回空 map/默认 false 集合。
  - 新增 `pub fn from_mutex(inner: Mutex<HashMap<String, bool>>) -> Self`，作为集成测试构造毒化状态的入口；普通构造仍用 `Default`。
  - `commands::menu::apply_snapshot` 不改；`sync_menu_state` 正常路径不改。
- 验收:
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 退出码 0。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test menu_action_tests` 退出码 0（既有默认状态/快照/未知 ID 测试保持绿）。

### 3.3 毒化菜单锁测试

- 归属: tester
- 依赖: 3.2
- 写入: `src-tauri/tests/menu_action_tests.rs`
- 目标:
  - 构造与默认状态不同的 map（例如 `ACTION_IDS` 全量插入，`save=true`、`open-folder=false`），放入 `Mutex` 后通过 `catch_unwind(AssertUnwindSafe(...))` 持锁 panic，使锁毒化。
  - 用 `MenuState::from_mutex` 包装毒化锁，断言 `is_enabled("save") == true`、`is_enabled("open-folder") == false`，`snapshot()` 长度等于 `ACTION_IDS.len()` 且内容与写入 map 一致；证明既不是空快照也不是默认全量回落。
  - 断言读取不 panic。
- 必须新增/命名的测试:
  - `poisoned_menu_lock_recovers_last_state_instead_of_defaulting`
- 验收:
  - `cargo test --manifest-path src-tauri/Cargo.toml --test menu_action_tests` 退出码 0。
  - 测试在 `--test menu_action_tests` 输出中可见且通过。

## 4. 搜索源 URL 构造不 panic（should-fix）

### 4.1 四个搜索源改为返回该源错误

- 归属: rust-backend
- 依赖: 无
- 写入:
  - `src-tauri/src/service/searcher/qqmusic.rs`
  - `src-tauri/src/service/searcher/kugou.rs`
  - `src-tauri/src/service/searcher/lrclib.rs`
  - `src-tauri/src/service/searcher/itunes.rs`
- 目标:
  - 将 `reqwest::Url::parse_with_params(...).expect("构造 … 搜索 URL 失败")` 改为 `.map_err(|error| format!("<源名> 搜索 URL 构造失败: {error}"))?`。
  - 源名前缀分别使用 `QQ 音乐`、`酷狗`、`LRCLIB`、`iTunes`。
  - iTunes 店面循环中首个非法 URL 直接返回该源 `Err`；不吞掉、不继续请求。
  - 不改默认 URL、请求头、参数、解析逻辑与聚合代码。
- 验收:
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 退出码 0。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test searcher_qqmusic_tests --test searcher_kugou_tests --test searcher_lrclib_tests --test searcher_itunes_tests` 退出码 0。
  - 四个文件中不再有“搜索 URL 失败”的 `expect`。

### 4.2 非法 URL 与聚合隔离测试

- 归属: tester
- 依赖: 4.1
- 写入: 新建 `src-tauri/tests/searcher_invalid_url_tests.rs`
- 目标:
  - 分别为 QQ 音乐、酷狗、LRCLIB、iTunes 注入非法 `search_url`（如 `"://bad"`），调用 `search()`，断言返回 `Err`、错误含对应源名与“搜索 URL 构造失败”、测试进程不 panic。
  - 用本地 `StubSource`（实现 `MusicSource`，返回一条固定候选）与一个非法 URL 真源组成 `search_song_with_sources`，断言非法源 `source_stats` 记 0、Stub 源候选保留、`all_failed == false`。
  - 四个真源全部注入非法 URL 时，断言 `source_stats` 全 0、`all_failed == true`，说明失败分类与网络失败一致。
- 必须新增/命名的测试:
  - `invalid_search_url_returns_err_without_panic_qqmusic`
  - `invalid_search_url_returns_err_without_panic_kugou`
  - `invalid_search_url_returns_err_without_panic_lrclib`
  - `invalid_search_url_returns_err_without_panic_itunes`
  - `invalid_source_is_isolated_in_aggregation`
  - `all_invalid_sources_set_all_failed`
- 验收:
  - `cargo test --manifest-path src-tauri/Cargo.toml --test searcher_invalid_url_tests` 退出码 0。
  - 聚合测试使用短超时（如 2s），不发真实网络请求（非法 URL 在请求前即失败；Stub 立即返回）。

## 5. crypto helper 不 panic（should-fix）

### 5.1 类型约束与 `Result` 化

- 归属: rust-backend
- 依赖: 无
- 写入:
  - `src-tauri/src/service/searcher/crypto.rs`
  - `src-tauri/tests/searcher_crypto_tests.rs`（仅机械更新既有调用的 `Result` 解包）
- 目标:
  - `aes_cbc_encrypt(data: &[u8], key: &[u8; 16]) -> Vec<u8>` 与 `aes_ecb_encrypt(data: &[u8], key: &[u8; 16]) -> Vec<u8>` 使用 `GenericArray::from_slice` / `Aes128::new`，移除“密钥须为 16 字节”的 `expect`；非 16 字节 key 在编译期排除。
  - `rsa_encrypt(secret: &str) -> Result<String, String>`：`BigUint::parse_bytes` 用 `ok_or_else` 转中文错误；不再 `expect`。
  - `weapi_with_secret(text, secret) -> Result<WeapiParams, String>`：先校验 `secret.as_bytes()` 为 16 字节（`try_into()`；失败 `Err("AES secret 须为 16 字节")`），再校验全部 ASCII hex（失败 `Err("AES secret 须为 16 位 hex 字符串")`），随后 `rsa_encrypt(secret)?`。
  - `weapi(text) -> Result<WeapiParams, String>`：调用 `weapi_with_secret(text, &random_hex_secret())` 并返回其结果。
  - `linuxapi` 与 `LINUXKEY` 不变；`netease.rs` 不改（只调用 `linuxapi`）。
  - 更新 `searcher_crypto_tests.rs` 既有 `weapi` / `weapi_with_secret` / `rsa_encrypt` 调用为 `.expect(...)` 解包，断言内容不改。
- 验收:
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 退出码 0。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test searcher_crypto_tests --test searcher_netease_tests` 退出码 0。
  - 既有已知向量 `weapi_matches_reference_vector`、`linuxapi_matches_reference_vector`、`rsa_encrypt_matches_reference_modpow` 输出逐字不变。

### 5.2 非法加密输入测试

- 归属: tester
- 依赖: 5.1（必须待 5.1 完成后再改同一测试文件）
- 写入: `src-tauri/tests/searcher_crypto_tests.rs`
- 目标:
  - 非 16 字节 secret（如 `"short"`、17 字节串）→ `weapi_with_secret` 返回 `Err`，消息含“16 字节”，不 panic。
  - 16 字节非 hex secret（如 `"zzzzzzzzzzzzzzzz"`）→ 返回 `Err`，消息含“hex”。
  - 合法既有向量仍通过；不弱化任何既有断言。
- 必须新增/命名的测试:
  - `weapi_with_secret_rejects_non_16_byte_key`
  - `weapi_with_secret_rejects_non_hex_secret`
- 验收:
  - `cargo test --manifest-path src-tauri/Cargo.toml --test searcher_crypto_tests` 退出码 0。
  - 两个新测试名在输出中可见且通过。

## 6. WAV RIFF INFO 写入阶段返回错误（should-fix）

### 6.1 抽取 `write_riff_info` 并覆盖错误分支

- 归属: rust-backend
- 依赖: 无
- 写入:
  - `src-tauri/src/service/writer.rs`
  - `src-tauri/tests/save_song.rs`
- 目标:
  - 新增 `pub fn write_riff_info(tagged_file: &mut lofty::file::TaggedFile, song: &Song) -> Result<(), String>`：`tag_mut(TagType::RiffInfo)` 为 `None` 时返回 `Err("保存失败: RIFF INFO 标签在写入阶段不可访问")`；存在时 `clear()` + `apply_riff_info_meta`。
  - `save_song` 的 `has_riff_info` 分支调用该 helper 并用 `?` 传播；错误发生在 `write_atomic_with` 之前。
  - 正常 RIFF INFO 存在路径行为逐字不变。
  - 测试用一个不含 RIFF INFO 的 `TaggedFile`（如已写好的 MP3 / ID3-only WAV fixture）直接调用 helper，断言中文错误；既有 WAV 保存测试不改断言。
- 必须新增/命名的测试:
  - `write_riff_info_without_riff_info_returns_chinese_error`
- 验收:
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 退出码 0。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test save_song` 退出码 0（含既有 RIFF-only/dual/ID3-only WAV 测试）。
  - 运行环境需有 ffmpeg（CI 已安装）；缺 ffmpeg 导致 fixture 失败时如实回报，不跳过。

## 7. `pick_cover_file` 失败如实报错（should-fix）

### 7.1 command 返回 `Result` + 可测选择 helper

- 归属: rust-backend
- 依赖: 无
- 写入:
  - `src-tauri/src/commands/cover.rs`
  - `src-tauri/tests/commands_cover_tests.rs`
- 目标:
  - `pick_cover_file` 改为 `Result<Option<CoverInput>, String>`：对话框选择结果交给 `cover_input_for_selection`；取消 `Ok(None)`；选中后读取/识别/压缩失败原样返回中文 `Err`，不再 `.ok()` 吞成 `None`。
  - 新增 `pub fn cover_input_for_selection(selection: Option<PathBuf>) -> Result<Option<CoverInput>, String>`（`selection.map(cover_from_path).transpose()`），供无头测试直接覆盖取消/失败/成功。
  - 更新模块注释；`read_cover_path`、`pick_cover_save_path`、`export_cover` 行为不变。
  - 测试覆盖 `None → Ok(None)`、非图片文件 → `Err`（含“封面格式无法识别”）、合法 PNG → `Ok(Some(...))`（mime/data URL 正确）。
- 必须新增/命名的测试:
  - `cover_input_for_selection_none_returns_ok_none`
  - `cover_input_for_selection_non_image_returns_chinese_err`
  - `cover_input_for_selection_valid_png_returns_cover_input`
- 验收:
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 退出码 0。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test commands_cover_tests` 退出码 0。
  - `pick_cover_file` 仍名为 `pick_cover_file` 且无参数（供前端契约守卫识别）。

## 8. 文档契约同步

### 8.1 PRD 与设计文档同步

- 归属: rust-backend（文档）
- 依赖: 1.1、7.1
- 写入:
  - `docs/V1-PRD.md`
  - `docs/design/design.md`
- 目标:
  - PRD §5.3“导出内嵌封面原图”bullet：明确预览与导出共用取图路径，优先第一个 `CoverFront`，无则第一张，APE 原生回退不变；导出仍是原始字节。
  - PRD §7 command 清单：`pick_cover_file() -> Result<Option<CoverInput>, String>`，取消 `Ok(None)`、读取/识别/压缩失败中文 `Err`；`export_cover` 描述同步取图优先级。
  - design §9.1：写侧“封面统一使用 `CoverFront`”补充读侧优先级（预览/导出）与 APE 回退不变。
  - design §10.3：更新 `open_song`、`pick_cover_file`、`export_cover` 三行的签名/描述。
  - 不新增、不重命名 command；保持 `pick_cover_file()` 无参形式；command 总数仍为 22。
- 验收:
  - `npm run test` 退出码 0（含 `src/styles/command-contract.test.ts` 与设计文档守卫）。
  - `grep -n "Result<Option<CoverInput>, String>" docs/V1-PRD.md docs/design/design.md` 两文件均命中。
  - `npx --yes @fission-ai/openspec@1.5.0 validate rust-review-hardening --strict --no-interactive` 退出码 0。

## 9. 质量门

### 9.1 Tester 全场景覆盖审计

- 归属: tester
- 依赖: 1.2、2.2、3.1、3.3、4.2、5.2、6.1、7.1、8.1
- 写入: 默认只读；若发现规格 scenario 缺测试，仅在 `src-tauri/tests/` 增补并重跑对应 crate（不得改生产代码）
- 目标:
  - 对照六份 delta spec 的每一条 requirement/scenario，给出“实现位置 → 测试名/命令”映射。
  - 确认无 `#[ignore]`、无网络真实请求、无新增 `#[cfg(test)]` 于 `src/`。
  - 确认 `folder_watch.rs` 毒化证据为“无 `into_inner` + 正常路径测试通过 + CR 审查”；确认 `MenuState` 毒化测试使用非默认状态。
  - 发现缺口时先回报 Leader；经授权后仅在测试路径补齐。
- 验收:
  - 回报中包含完整映射表；每条 scenario 至少一个具体测试名或明确的只读审查证据。
  - 若补测试，相关 `cargo test --test <crate>` 退出码 0。
  - 无未解释的覆盖空洞。

### 9.2 CR 只读审查

- 归属: CR
- 依赖: 9.1
- 写入: 无（严格只读）
- 目标:
  - 对照 design、六份 delta spec 与 V1 约束逐项审查 diff。
  - 重点检查：`CoverFront` 优先级与 APE 回退、`symlink_metadata` 的 `NotFound` 分支、无 `into_inner`、无新增 panic/`expect` 于调用方可控输入、中文错误、`pick_cover_file` 契约、WAV 错误发生在原子写之前、文件改动是否越界。
  - 确认无新增依赖、前端 `src/` 未改、command 名/数量未变。
- 验收:
  - 回报逐项结论（通过/阻断），阻断项附文件与行号。
  - 无阻断项时给出可进入 Verify 的明确结论；有阻断项时回报 Leader，由 Leader 另派修复任务，CR 不直接改代码。

### 9.3 Verify 全量门禁

- 归属: Verify / Leader
- 依赖: 9.2
- 写入: 无
- 目标: 按 CI 实际命令全量验证，记录每条命令退出码与关键输出。
- 命令（仓库根目录执行）:
  - `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`
  - `node --test '.agents/tools/pipe-core/test/*.test.js' 'tests/workflow-core/*.test.cjs' '.agents/tools/pipe-native/test/*.test.js'`
  - `node --test tests/homebrew/publish.test.mjs`
  - `node .agents/tools/pipe-native/self-check.js`
  - `npm ci`
  - `npm run build`
  - `npm run test`
  - `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
  - `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`
  - `npx --yes @fission-ai/openspec@1.5.0 validate rust-review-hardening --strict --no-interactive`
- 验收:
  - 全部命令退出码 0；不得跳过、不得用 `|| true` 吞失败。
  - `cargo test --all-targets` 输出中可见 §1–§7 新增测试名且全部通过。
  - 如实回报任何环境型失败（如缺 ffmpeg、Node 版本不符），由 Leader 裁决，不假报通过。

## 派发批次建议（Leader 参考）

- **批次 A（无依赖、生产文件互不重叠，可并行）**: 1.1、2.1、3.1、3.2、4.1、5.1、6.1、7.1。
  - 注意：5.1 会机械更新 `searcher_crypto_tests.rs`，确保 5.2 未同时派发。
- **批次 B（等待各自依赖）**: 1.2、2.2、3.3、4.2、5.2、8.1。
  - 5.2 必须在 5.1 完成后独占 `searcher_crypto_tests.rs`。
  - 8.1 等待 1.1 与 7.1。
- **批次 C（串行）**: 9.1 → 9.2 → 9.3。

## 文件所有权速查

| 路径 | 任务 |
| --- | --- |
| `src-tauri/src/service/reader.rs` | 1.1 |
| `src-tauri/tests/common/mod.rs` | 1.2 |
| `src-tauri/tests/export_cover.rs` | 1.2 |
| `src-tauri/tests/open_song.rs` | 1.2 |
| `src-tauri/src/service/rename.rs` | 2.1 |
| `src-tauri/tests/rename_song.rs` | 2.2 |
| `src-tauri/tests/service_rename_tests.rs` | 2.2 |
| `src-tauri/src/service/folder_watch.rs` | 3.1 |
| `src-tauri/src/lib.rs` | 3.2 |
| `src-tauri/tests/menu_action_tests.rs` | 3.3 |
| `src-tauri/src/service/searcher/qqmusic.rs` | 4.1 |
| `src-tauri/src/service/searcher/kugou.rs` | 4.1 |
| `src-tauri/src/service/searcher/lrclib.rs` | 4.1 |
| `src-tauri/src/service/searcher/itunes.rs` | 4.1 |
| `src-tauri/tests/searcher_invalid_url_tests.rs`（新建） | 4.2 |
| `src-tauri/src/service/searcher/crypto.rs` | 5.1 |
| `src-tauri/tests/searcher_crypto_tests.rs` | 5.1（机械解包）→ 5.2（新增用例，串行） |
| `src-tauri/src/service/writer.rs` | 6.1 |
| `src-tauri/tests/save_song.rs` | 6.1 |
| `src-tauri/src/commands/cover.rs` | 7.1 |
| `src-tauri/tests/commands_cover_tests.rs` | 7.1 |
| `docs/V1-PRD.md` | 8.1 |
| `docs/design/design.md` | 8.1 |
