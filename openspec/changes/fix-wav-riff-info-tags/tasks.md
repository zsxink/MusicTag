# Tasks: 修复 WAV RIFF INFO 标签读写

## 领域

`backend`

## 任务顺序与文件所有权

以下任务按 Rust 实现 → 测试顺序执行。每项只由对应 Agent 修改列出的路径；主会话负责勾选完成状态、审计差异并记录 progress。

- [x] 1. **fixture 早检与 WAV 标签形态** — owner: Dev；paths: `src-tauri/tests/common/mod.rs`
  - 构造可被 lofty 读取的 RIFF INFO-only、ID3v2-only、双标签 WAV fixture；保留现有 tagless/既有格式 fixture。
  - 提供早检断言，确认文件类型和标签存在性，坏 WAV fixture 明确不可读。
- [x] 2. **RIFF INFO 字段级读取回退** — owner: Dev；paths: `src-tauri/src/service/reader.rs`, `src-tauri/src/service/meta.rs`
  - 对 WAV 按字段执行 ID3v2 非空优先、RIFF INFO 回退。
  - 仅支持标题、作者、专辑、音轨号、音轨总数、年份、流派的 RIFF INFO 映射；歌词、封面和专辑作者保持 ID3v2 路径。
  - 确保 FLAC/MP3/APE/M4A 读取行为不变。
- [x] 3. **保留原有 RIFF INFO 并镜像可表示字段** — owner: Dev；paths: `src-tauri/src/service/writer.rs`, `src-tauri/src/service/meta.rs`
  - ID3v2 始终全量清空重建并承载所有应用字段、歌词和封面。
  - 只有原文件已有 RIFF INFO 时才清空并镜像七个可表示字段；空值删除对应项；ID3v2-only 不创建 RIFF INFO。
  - 沿用现有原子写回和失败语义。
- [x] 4. **读取场景验证** — owner: Tester；paths: `src-tauri/tests/open_song.rs`
  - 覆盖 fixture 早检、RIFF INFO-only、ID3v2-only、双标签字段级优先级、坏 WAV。
- [x] 5. **保存场景与回归验证** — owner: Tester；paths: `src-tauri/tests/save_song.rs`
  - 覆盖 RIFF INFO 保留/镜像、ID3v2 完整字段、歌词/封面仍写 ID3v2、空值清理和不创建新 RIFF INFO。
  - 保留并运行既有 FLAC、MP3（含 ID3v2.4）、APE、M4A 保存回归。
- [ ] 6. **验证门禁** — owner: 主会话；paths: `openspec/changes/fix-wav-riff-info-tags/design.md`, `openspec/changes/fix-wav-riff-info-tags/tasks.md`
  - 按 design.md 顺序运行定向 Rust 测试、全量 Rust 测试、`cargo check` 和 OpenSpec strict 校验。
  - 若 fixture 早检失败、实现跨出上述文件所有权或出现规格冲突，停止扩展并回报主会话。
