## Context

动机见 proposal.md（Issue #128）。现状要点（代码调研结论）：

- 收集过滤：`src-tauri/src/service/meta.rs:15-19` `is_audio_file` 硬编码 `flac`/`mp3` 双值、`eq_ignore_ascii_case`；调用点 2 处生产——`commands/folder.rs:46`（`list_songs` 遍历）与 `service/missing.rs:65`（缺失扫描），改一处即两处生效。
- 写侧编排：`service/writer.rs` `save_song` = `Probe::open().read()` → `primary_tag_mut()` → `tag.clear()` → `apply_meta(tag, &song)` → `write_atomic`（同目录临时文件 + rename）。文本字段**无格式分支**，统一 `ItemKey` + `set_text`，年份统一 `RecordingDate`（`meta.rs:43-44`）；封面 `apply_cover` 无分支，`push_picture` 由 lofty 按 TagType 落帧。
- 唯一 TagType 分支在 `apply_lyrics`（`meta.rs:64-78`）：`Id3v2` → USLT `lang=eng`；`_ =>` 兜底写 `ItemKey::Lyrics`。理由：`Lyrics` 在 ID3v2 被 lofty 静默丢弃，`UnsyncLyrics` 在 Vorbis 多出 `UNSYNCEDLYRICS`。
- 读侧：`service/reader.rs` 两条路径均 `Probe::open().read()` + `primary_tag()`，无格式特判；歌词 `Lyrics`→`UnsyncLyrics`→侧载 `.lrc` 三级 fallback，年份 `RecordingDate`→`Year`；读失败 Err → 前端只读降级。
- 测试：全部外置 `src-tauri/tests/`，样例文件 = 手工最小壳字节（`tests/common/mod.rs`）+ lofty 回写标签，无外部二进制 fixture。
- lofty 0.24 原生支持 APE/WAV/MP4 标签；文档映射表在 PRD §5.1（FLAC）/§5.2（MP3），design.md 尚无格式分支章节（本变更待补）。

## Goals / Non-Goals

**Goals:**

- `.ape`/`.wav`/`.m4a`（扩展名是否含 `.mp4` 见 Decisions D3）进入收集、可读可写，歌词/封面/元数据（含年份）往返一致。
- 写侧映射按 lofty ItemKey 语义逐格式实测核对，缺口补齐、有歧义的 TagType 显式分支。
- MP3/FLAC 行为零回归；坏标签只读、全量覆盖、直接写盘等既有约束全部沿用。
- PRD / design 文档与实现同步。

**Non-Goals:**

- 不做批量（V2 边界）；不改搜索/选中即搜行为（格式无关）；不改 IPC 契约与前端。
- 不新增依赖（lofty 已具备）；不为 APE 实现只读 ID3v2 的写入。
- 不处理其他格式（OGG/Opus/AIFF 等）。

## Decisions

**D1 扩展名过滤：列表常量 + 逐格式判断**

`is_audio_file` 从双值 `||` 改为扩展名白名单数组（`["flac", "mp3", "ape", "wav", "m4a", (+mp4 见 D3)]`）+ `iter().any(|e| ext.eq_ignore_ascii_case(e))`，保持大小写不敏感、无扩展名拒绝。备选：保留 `||` 链——可读性随格式数劣化，弃。`list_songs` 与 `scan_missing` 共用同一函数，自动同步两处语义。

**D2 写侧：以「lofty ItemKey → 各 TagType 落帧」实测为准，缺臂补显式分支**

现有设计的最大红利是文本字段/封面无格式分支（ItemKey/push_picture 由 lofty 分派）。策略：

1. **先写往返测试（TDD 红）**：对 APE/WAV/M4A 各构造样例（沿用 `common/mod.rs` 模式：手工最小壳或 lofty 直接 `write_to_path` 造出可解析容器），断言全字段 + 歌词 + 封面写→读回一致。
2. **预期零改动路径**：文本字段、`RecordingDate`、`push_picture` 若实测通过则不动代码。
3. **显式分支点——`apply_lyrics` 的 `_ =>` 兜底**：新格式的 TagType 落入兜底写 `ItemKey::Lyrics`。逐格式实测：
   - WAV（内嵌 ID3v2 → `TagType::Id3v2`）：自然走既有 USLT 臂，预期零改动。
   - M4A（`Mp4Ilst`）：`©lyr` 映射 `Lyrics|UnsyncLyrics`，预期兜底可写，实测读回。
   - APE（`TagType::ApeTag`）：Vorbis 风格 item，`ItemKey::Lyrics` 预期可用；若兜底路径异常则加显式臂。
   若某格式兜底行为不符，按 TagType 加显式 match 臂并注释理由（对齐 `meta.rs:62-63` 现有注释风格）。
4. **APE 写保护**：`save_song` 对 APE 只经 `primary_tag_mut()`（lofty 对 APE 默认 primary 即 APE 标签），不触碰只读 ID3v2——加断言测试防回归。
5. **读侧 WAV 双标签**：RIFF INFO 与 ID3v2 并存时 `primary_tag()` 应取内嵌 ID3v2；加测试固化该优先级，若 lofty 实际取 RIFF INFO 则在 `read_song_meta` 加读侧 fallback 链（与现有 `Lyrics`/`Year` fallback 同模式）。

备选「为每种格式建立独立 apply 分支表」——与现状架构（ItemKey 统一分派）相悖、维护成本高，弃。

**D3 `.mp4` 扩展名：纳入**

`.mp4` 与 `.m4a` 同为 MP4 容器、lofty 同路径处理，收集白名单一并纳入，成本为零、避免同类文件被漏收。备选：不纳入——用户需改名才能编辑，体验不一致，弃。此为 Issue #128 留给实现评估的点，本设计拍板纳入。

**D4 测试样例构造：lofty 造容器 + 应用层往返**

`common/mod.rs` 新增 `write_tagged_ape/wav/m4a` 辅助：APE/WAV/M4A 的最小合法壳比 FLAC/MP3 手工拼字节更繁琐，优先用 lofty 对空文件/最小 RIFF·MP4 头直接 `write_to_path` 产出可解析容器（lofty 支持写出这三种格式）；若 lofty 无法凭空产出某格式最小壳，再评估手工拼最小头。不引入外部二进制 fixture（沿用仓库既有约定）。

**D5 文档同步：先文档后代码**

实现第一步先改 `docs/V1-PRD.md`（FR-1 行 `.flac`/`.mp3` 扩展名、§5.1/§5.2 增补三格式映射、§7 技术栈「统一处理 FLAC/MP3」句、§非功能兼容行）与 `docs/design/design.md`（§10.0 `meta.rs` 行补三种格式分支说明；格式映射细节以 PRD 为权威）。与「拍板决策变更须同步两份文档」的项目约束一致。

## Risks / Trade-offs

- [APE/WAV/M4A 某字段 lofty 实测不可写（如 APE 封面或年份映射缺口）] → TDD 先行会尽早暴露；缺口处按 TagType 显式分支补齐；若 lofty 层面确实不支持，回 Issue #128 沟通缩小该格式断言范围，不假报全绿。
- [WAV 的 RIFF INFO / ID3v2 并存时 primary 选择不符合预期] → 测试固化实际行为；不符则读侧加 fallback 链（既有模式），写侧固定写 ID3v2。
- [APE 写入改动牵连只读 ID3v2 导致写坏文件] → 断言测试锁定 primary tag 为 APE；`write_atomic` 同目录 rename 兜底保证失败不动原文件。
- [手工最小壳构造成本（尤其 APE/M4A）] → D4 优先 lofty 产出；测试仅断言标签层往返，不追求音频帧可播放。
- [扩展名白名单放开后扫描到无法解析的坏文件] → 读侧既有语义兜底：`read_summary` 返回空串不崩、`open_song` 失败走只读降级，与 FLAC/MP3 一致。

## Migration Plan

单机自用、无数据迁移。分支 `support-ape-wav-m4a-formats` 从 main 开，PR 合并即生效；回滚 = revert PR。

## Open Questions

（无——D2 的逐格式实测属实现期 TDD 步骤，不改变本设计的架构与任务拆分；D3 已拍板。）
