## Context

动机见 proposal.md（Issue #128）。现状要点（代码调研结论）：

- 收集过滤：`src-tauri/src/service/meta.rs:15-19` `is_audio_file` 硬编码 `flac`/`mp3` 双值、`eq_ignore_ascii_case`；调用点 2 处生产——`commands/folder.rs:46`（`list_songs` 遍历）与 `service/missing.rs:65`（缺失扫描），改一处即两处生效。
- 写侧编排：`service/writer.rs` `save_song` = `Probe::open().read()` → `primary_tag_mut()` → `tag.clear()` → `apply_meta(tag, &song)` → `write_atomic`（同目录临时文件 + rename）。文本字段**无格式分支**，统一 `ItemKey` + `set_text`，年份统一 `RecordingDate`（`meta.rs:43-44`）；封面 `apply_cover` 无分支，`push_picture` 由 lofty 按 TagType 落帧。
- 唯一 TagType 分支在 `apply_lyrics`（`meta.rs:64-78`）：`Id3v2` → USLT `lang=eng`；`_ =>` 兜底写 `ItemKey::Lyrics`。理由：`Lyrics` 在 ID3v2 被 lofty 静默丢弃，`UnsyncLyrics` 在 Vorbis 多出 `UNSYNCEDLYRICS`。
- 读侧：`service/reader.rs` 两条路径均 `Probe::open().read()` + `primary_tag()`，无格式特判；歌词 `Lyrics`→`UnsyncLyrics`→侧载 `.lrc` 三级 fallback，年份 `RecordingDate`→`Year`；读失败 Err → 前端只读降级。
- 测试：全部外置 `src-tauri/tests/`，样例文件 = 手工最小壳字节（`tests/common/mod.rs`）+ lofty 回写标签，无外部二进制 fixture。
- lofty 0.24 原生支持 APE/WAV/MP4 标签；文档映射表在 PRD §5.1（FLAC）/§5.2（MP3），格式分支矢区见本文「技术方案」章节。

## 技术方案

### 模块边界与数据流（改动全部收敛在 `service/` 层，commands 薄壳与 IPC 契约零改动）

```
commands/   folder.rs  list_songs ── WalkDir + meta::is_audio_file（白名单过滤，改）── reader::read_summary
            song.rs    open_song  ── reader::read_song_meta（新格式兼容核对 + WAV 双标签预案 A1，改）
                       save_song  ── service::writer::save_song（编排不变，APE 保护断言 A6，改）
service/    meta.rs    is_audio_file（白名单数组，改）；apply_meta / apply_lyrics / apply_cover（TagType 分派核对，改）
            reader.rs  read_summary / read_song_meta（读侧 fallback 核对，改）
            writer.rs  save_song 编排（Probe → primary_tag_mut → clear → apply_meta → write_atomic，结构不变）
            missing.rs scan_missing（复用 is_audio_file，自动同步，零改动）
```

三条数据流全部复用既有服务，三格式只是「过滤放行 + 读写分派正确」，无新 command、无新模块：

- **收集**：`pick_folder → list_songs(dir)` → walkdir 逐文件 `is_audio_file`（白名单）→ `read_summary`（title/artist，读失败空串保列表）。`scan_missing` 同函数过滤，自动同步。
- **读**：`open_song(path) → read_song_meta` → `Probe::open().read()` + `primary_tag()` → 9 文本字段（ItemKey 统一）+ 歌词（`Lyrics`→`UnsyncLyrics`→侧载 `.lrc`）+ 封面（`pictures().first()` → base64 data URL）。坏标签 `Err` → 前端只读，行为不变。
- **保存**：`save_song(song, exportLrc)` → `Probe::open().read()` → `primary_tag_mut().clear()` → `apply_meta`（文本字段 ItemKey 统一、年份统一 `RecordingDate`，歌词/封面按 TagType 分派）→ `write_atomic`（同目录临时文件 + rename 原子替换）。

### 逐格式分支矢区（三格式在现有架构上的落点）

| 维度 | FLAC / MP3（现状） | WAV | M4A（含 `.mp4`） | APE |
|---|---|---|---|---|
| 收集 `is_audio_file` | `flac`/`mp3` | `wav` | `m4a`/`mp4` | `ape` |
| 读侧 primary tag | Vorbis / Id3v2 | 内嵌 ID3v2（A1 实测） | `Mp4Ilst` | `ApeTag` |
| 文本字段 | ItemKey 统一 | ItemKey 统一 | ItemKey 统一 | ItemKey 统一 |
| 年份 | `RecordingDate` | `TDRC`（Id3v2 臂） | `©day`（A5 实测） | `RecordingDate`（A5 实测） |
| 歌词 | `LYRICS` / USLT | USLT（既有 `Id3v2` 臂） | `©lyr`（兜底 `ItemKey::Lyrics`，A2） | `ItemKey::Lyrics`（兜底 A3） |
| 封面 | PICTURE / APIC | APIC（`push_picture`） | `covr`（`push_picture`） | APE Cover Art（`push_picture` 实测，A4） |

> 规律：**文本字段零改动**（ItemKey 统一分派是现状架构最大红利）；**歌词/封面/年份只需核对三格式的 TagType 锚点**；WAV=Id3v2、M4A=Mp4Ilst、APE=ApeTag 三类 TagType 若实测不落现有臂/兜底，按 D2 加显式 match 臂，均对齐 `meta.rs:62-63` 既有注释风格。

### TDD 实测锚点（实现期按表逐个「红 → 实现 → 绿」，A 编号与 tasks 组 3 对应）

| # | 锚点 | 预期 | 实测不符时预案 |
|---|---|---|---|
| A1 | WAV 在 RIFF INFO + 内嵌 ID3v2 并存时 `primary_tag()` 取 ID3v2 | 取 ID3v2 | `reader.rs` 加读侧 fallback 链（同现有 `Lyrics`/`Year` 模式）；写侧固定写 ID3v2 |
| A2 | M4A 兜底 `ItemKey::Lyrics` 可写 `©lyr` | 是 | `apply_lyrics` 加 `Mp4Ilst` 显式臂 |
| A3 | APE 兜底 `ItemKey::Lyrics` 可写（Vorbis 风格 item） | 是 | `apply_lyrics` 加 `ApeTag` 显式臂 |
| A4 | APE `push_picture` 落 Cover Art front | 是 | `apply_cover` 加 `ApeTag` 显式臂（构造 APE 封面条目） |
| A5 | APE/M4A 年份 `RecordingDate` 写读一致（M4A→`©day`） | 是 | 写侧按 TagType 改用该格式年份键 + 读侧对称 fallback（对齐现有 `RecordingDate`→`Year`） |
| A6 | APE `primary_tag_mut()` 仅触碰 APE 标签、不产生只读 ID3v2 写入 | 是 | 断言测试锁定 primary=APE；若 lofty 对 APE 暴露 ID3v2 primary 则显式选 `ApeTag` tag，不写 ID3v2 |

### 不变行为护栏（写入测试断言）

- MP3 仍写 ID3v2.4（lofty 默认，不用 `use_id3v23`）。
- 全量覆盖（`clear()` 重建）、坏标签只读、写回原路径、`write_atomic` 原子替换——三格式全部沿用。
- 封面跨 IPC 仍 base64 data URL、磁盘落盘原始字节；**IPC 契约与 TS 类型零改动 → 前端零文件改动**。
- 样例构造保持无外部二进制 fixture：lofty 0.24 对 `FileType::Ape` / `FileType::Wav` / `FileType::Mp4` 均支持 `write_to_path` 产出最小可解析容器，故 D4 优先用 lofty 产壳。

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

## 关键技术决策

- **D3 `.mp4` 纳入收集白名单**（本变更新增拍板）：`.mp4` 与 `.m4a` 同为 MP4 容器、lofty 走同一 `FileType::Mp4` 路径，纳入成本为零；漏收会让用户需改名才能编辑，体验不一致。proposal 原留实现期评估，本设计拍板。
- **写侧零结构改动、仅实测补臂**：现状 ItemKey 统一分派比「每格式独立 apply 分支表」维护成本低、与既有架构相悖最小；三格式只核对落点、实测不符才加显式 match 臂。
- **先文档（PRD/design）后代码**：改产品行为必先同步 `docs/V1-PRD.md` 与 `docs/design/design.md`（D5，项目硬约束），tasks 组 1 即此。
- **样例构造走 lofty `write_to_path`**：lofty 0.24 对三种新格式均支持写出最小可解析容器，比 FLAC/MP3 手工拼字节省成本且无外部二进制 fixture（D4）。
- **WAV 写 ID3v2、APE 绝不写 ID3v2**：WAV 主流标签为内嵌 ID3v2，与 MP3 同臂复用；APE 的 ID3v2 用于只读（foobar 兼容），写侧经 `primary_tag_mut()` 只置 APE 标签，断言测试防回归（D2.4、A6）。

## 变更域判定

**domain = `both`（backend 为主、附带 docs）**：

- **backend**：`is_audio_file` 白名单、`apply_lyrics`/`apply_cover`（可能）TagType 分支、WAV 双标签读侧 fallback（可能）、三格式往返/坏标签/回归测试——全部 Rust。
- **docs**：FR-1 扩展名、§5 映射表、PRD §7 技术栈「统一处理 FLAC/MP3」句与 §4 兼容行、design.md §10.0 `meta.rs` 行同步。
- **frontend**：明确零改动——格式差异收敛在 Rust 侧，IPC 契约（含 `Song.cover` base64 data URL）不变。

**依赖顺序**：纯 backend + 文档同步，无 Rust→Vue 跨端串行（前端无工作项）。唯一依赖约束为「先文档后代码」（tasks 组 1 → 组 2–4），驱动顺序即依赖序。

## 任务拆分建议（对应 tasks.md 组 1–5）

1. **组 1 文档同步**（唯一前置，无代码依赖）：PRD + design 先改，`openspec validate` 兜底通过。
2. **组 2 收集过滤**（纯逻辑，最小改动）：`is_audio_file` 白名单 + list_songs/missing 测试，校验两处调用点语义自动同步。
3. **组 3 写侧往返实测**（本变更主体，TDD 红→绿）：common 三格式样壳 → `save_song` 全字段+歌词+封面往返（按 A1–A6 锚点补臂）→ WAV 双标签读侧 → `open_song` 三格式读侧。
4. **组 4 缺失扫描与回归**：`scan_missing` 范围 + MP3 ID3v2.4 版本断言。
5. **组 5 全量验证**：cargo check/test + openspec validate。

## Migration Plan

单机自用、无数据迁移。分支 `support-ape-wav-m4a-formats` 从 main 开，PR 合并即生效；回滚 = revert PR。

## Open Questions

（无——D2 的逐格式实测属实现期 TDD 步骤，不改变本设计的架构与任务拆分；D3 已拍板。）
