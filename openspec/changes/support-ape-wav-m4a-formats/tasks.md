## 1. 文档同步（先文档后代码）

- [ ] 1.1 更新 `docs/V1-PRD.md`：FR-1 行收集范围加 `.ape`/`.wav`/`.m4a`/`.mp4`，§5.1/§5.2 映射表增补三格式（歌词/封面/年份），§7 技术栈与非功能「兼容」行同步；验证：`openspec validate support-ape-wav-m4a-formats --strict --no-interactive` 仍通过且文档 diff 只涉格式描述
- [ ] 1.2 更新 `docs/design/design.md`：§10.0 `meta.rs` 行补「多格式分支（FLAC/MP3/APE/WAV/M4A）」说明；验证：文档中不再有「仅 FLAC/MP3」的排他表述

## 2. 收集过滤（TDD）

- [ ] 2.1 先写失败测试：`tests/service_meta_tests.rs` 断言 `.ape`/`.wav`/`.m4a`/`.mp4` 及其大写变体被 `is_audio_file` 接受、`.txt`/`.jpg`/无扩展名仍拒绝（红）；实现 `meta.rs` `is_audio_file` 改白名单数组后转绿；验证：`cargo test --manifest-path src-tauri/Cargo.toml is_audio_file`
- [ ] 2.2 扩展 `tests/list_songs.rs`：文件夹含三格式（含大小写）时全部进入列表、非音频仍忽略；验证：`cargo test --manifest-path src-tauri/Cargo.toml list_songs`

## 3. 写侧往返实测（TDD 红 → 实现）

- [ ] 3.1 `tests/common/mod.rs` 新增三格式样例构造辅助（D4：优先 lofty `write_to_path` 产出可解析容器，失败再评估手工最小壳）+ `full_song` 数据；验证：辅助函数能被后续测试调用且 `cargo test` 编译通过
- [ ] 3.2 先写失败测试：`tests/save_song.rs` 三格式各一条全字段+歌词+封面写→读回往返断言（含年份 `RecordingDate`、清空字段即删除、APE 不产生 ID3v2 写入）（红）；按 D2 实测结果补齐 `apply_lyrics` 等 TagType 显式分支至绿；验证：`cargo test --manifest-path src-tauri/Cargo.toml save_song`
- [ ] 3.3 WAV 双标签读侧：测试固化 RIFF INFO 与 ID3v2 并存时 `primary_tag()` 取内嵌 ID3v2；不符则 `reader.rs` 加 fallback 链后转绿；验证：`cargo test --manifest-path src-tauri/Cargo.toml`（reader 相关用例）
- [ ] 3.4 `tests/open_song.rs` 三格式读侧全字段+歌词+封面断言；坏标签三格式文件仍返回 Err（走只读降级）；验证：`cargo test --manifest-path src-tauri/Cargo.toml open_song`

## 4. 缺失扫描与回归

- [ ] 4.1 `tests/missing_scan.rs`：三格式文件纳入 `scan_missing` 扫描范围；验证：`cargo test --manifest-path src-tauri/Cargo.toml missing`
- [ ] 4.2 MP3/FLAC 回归：既有用例全绿 + MP3 仍写 ID3v2.4（版本字节断言）、FLAC/MP3 既有往返不回归；验证：`cargo test --manifest-path src-tauri/Cargo.toml` 全量通过

## 5. 全量验证

- [ ] 5.1 `cargo check` + `cargo test`（src-tauri）全绿；验证：命令退出码 0
- [ ] 5.2 `openspec validate support-ape-wav-m4a-formats --strict --no-interactive` 通过；验证：命令退出码 0
