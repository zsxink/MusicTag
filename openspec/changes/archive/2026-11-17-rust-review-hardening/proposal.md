## Why

Issue #194：对 `src-tauri/src` 做 rust-review 后，发现两处与已批准规格不一致的正确性问题，以及三处低风险健壮性缺口。当前 `cargo fmt --check` 与全套 `cargo test` 通过，但封面导出可能取错图片类型、改名撞名预检漏判悬空符号链接；另有毒化锁被强行读取、调用方可控输入触发 panic、本地选封面失败被伪装成取消。这些问题不涉及新产品能力，只让实现回到既有规格，并让错误如实抵达用户。

GitHub Issue: #194

## What Changes

- 封面预览与导出统一优先取标签内 `CoverFront` 图片（`Tag::get_picture_type`），无 front cover 时保留既有“第一张图”回退；APE 原生封面回退不变。
- 改名撞名预检改用 `fs::symlink_metadata`，把普通文件、目录、符号链接（含悬空链接）统一视为“目标已存在”，检查本身失败时返回中文错误而不是放行。
- 目录监听的毒化锁不再被 `into_inner()` 消费；退出与注册错误回调路径改为安全降级，菜单状态锁异常如实记录。
- 搜索源 URL 构造、crypto helper 与 WAV RIFF INFO 写入不再对调用方输入使用 `expect` 触发 panic；所在函数已返回 `Result` 的改为传播错误。
- `pick_cover_file` 改为 `Result<Option<CoverInput>, String>`：取消仍为 `Ok(None)`，读文件/解码失败返回中文 `Err`；前端已有 `try/catch`，无需行为改动。
- 同步 `docs/V1-PRD.md`、`docs/design/design.md` 的封面 command 契约与封面取图描述；不开新 command，不改其他 command 签名。

## Capabilities

### New Capabilities

（无，仅修改现有能力）

### Modified Capabilities

- `cover-embed`：封面预览/导出优先 front cover；本地选封面失败返回可展示错误。
- `rename-sync`：撞名定义扩展到符号链接（含悬空链接），预检错误不静默放行。
- `folder-list`：目录监听锁毒化时安全降级，不读取不确定状态。
- `search-sources`：搜索源 URL 与加密 helper 遇到非法输入返回错误而非 panic。
- `song-save`：WAV RIFF INFO 写入阶段标签不可用时返回中文错误，不 panic。

## Impact

- `src-tauri/src/service/reader.rs`、`src-tauri/src/service/rename.rs`、`src-tauri/src/service/folder_watch.rs`、`src-tauri/src/lib.rs`。
- `src-tauri/src/service/searcher/{mod,crypto,qqmusic,kugou,lrclib,itunes}.rs`、`src-tauri/src/service/writer.rs`。
- `src-tauri/src/commands/cover.rs`、`docs/V1-PRD.md`、`docs/design/design.md`。
- `src-tauri/tests/`：多图 front cover 导出、悬空 symlink 撞名、选封面失败路径等回归测试。
- 不改变一次一首、保存全量覆盖、直接写回原文件、无备份/无撤销、搜索候选手动点选等 V1 约束；不引入新依赖；前端 `src/` 不改。
