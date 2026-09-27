# Tasks: support-ape-wav-m4a-tags

## 实现任务

- [ ] T1（backend，所有权：`src-tauri/src/service/meta.rs`、`src-tauri/src/commands/folder.rs`）：扩展音频扩展名过滤为 `.ape`、`.wav`、`.m4a`，保持大小写不敏感；明确拒绝 `.mp4`，并保持 FLAC/MP3 行为。
- [ ] T2（backend，所有权：`src-tauri/src/service/meta.rs`、`src-tauri/src/service/reader.rs`、`src-tauri/src/service/writer.rs`）：按设计中的 lofty primary tag 和 `ItemKey` 映射核对字段、年份、歌词、封面读写；仅 ID3v2 使用 USLT/`lang=eng`，确保 APE 不写 ID3v2，保留全量覆盖、空字段删除和 MP3 ID3v2.4。
- [ ] T3（backend/test，所有权：`src-tauri/tests/list_songs.rs`、`src-tauri/tests/open_song.rs`、`src-tauri/tests/save_song.rs`、`src-tauri/tests/common/mod.rs`；如需新格式专用集成测试，新增文件必须位于 `src-tauri/tests/`）：补充 APE/WAV/M4A fixture、列表收集、摘要、读写往返、歌词/封面/年份和 `.mp4` 排除测试；保留既有 FLAC/MP3 回归断言。

## 文档与验证任务

- [ ] T4（docs，所有权：`docs/V1-PRD.md`、`docs/design/design.md`）：同步支持格式、扩展名边界、lofty 标签映射和 primary tag 选择；记录 `.mp4` 不纳入的产品理由，并保持 command 契约与分层约束一致。
- [ ] T5（主会话验证）：运行 Rust check/test、适用前端 test/build 和 OpenSpec strict 校验；逐项记录真实退出码，失败时停止后续集成。

## 任务依赖

`T1` 与 `T2` 可先后由同一 backend 开发者完成；`T3` 依赖 T1/T2 的实现接口；`T4` 可与 T1/T2 并行但必须反映最终设计；`T5` 依赖 T1–T4 完成。主会话负责勾选任务、审计文件所有权和提交状态。
