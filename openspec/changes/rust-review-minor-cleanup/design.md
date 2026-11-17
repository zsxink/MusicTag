# rust-review-minor-cleanup 设计

GitHub Issue: #196
变更类型: CR 遗留 minor 收敛（注释准确性 + 测试证据强度；零产品行为变更）
域判定: `backend`

## 1. 背景与目标

`rust-review-hardening`（Issue #194 / PR #195）的只读 CR 通过全部 blocker/major，但留下 4 条 minor。逐条核对代码后的结论：

| CR 条目 | 核对结论 | 本次处理 |
| --- | --- | --- |
| 两处取图注释仍写「第一个 front cover」 | 真实：`src-tauri/src/commands/cover.rs:80`、`src-tauri/src/service/cover.rs:144` 与 `src-tauri/src/service/reader.rs:54-65` 的实际实现不一致 | 改写注释 |
| command 契约守卫注释写 19 | 真实：`src/styles/command-contract.test.ts:4`、`:39` 写 19；同文件断言（`:96`、`:105`）与 `src-tauri/src/lib.rs:22-43` 的注册集均已是 22 | 注释改 22 |
| 封面回退测试未证明回退来自首图 | 真实：`src-tauri/tests/export_cover.rs:250-272` 的 `export_falls_back_to_first_picture_without_front_cover` 没有 fixture 早检，标签若退化成「只有一张可挑」仍会绿 | 增加早检 |
| CR 指向 `docs/design/design.md` 的取图描述 | 归因有误：该文档 `:225` 已是正确表述；陈旧文本位于已归档快照 `openspec/changes/archive/2026-11-17-rust-review-hardening/design.md:295`（RSA 文案）与主 spec `openspec/specs/cover-embed/spec.md:44`、`:54`（「第一个 front cover」绝对措辞，见下方说明），历史归档不应回改 | 不改（主 spec 措辞记为规格债务，见 §2.2） |

目标：

- 两处源码注释与 `reader.rs` 的实际取图语义逐字一致：优先第一个 `CoverFront`，无则第一张；通用标签完全无图时才回退 APE 原生 `Cover Art (Front)`。
- 契约守卫注释与 `lib.rs` 实际注册的 22 个 command 一致，断言与提取逻辑不动。
- 无 front cover 回退测试由 fixture 早检证明「标签确有两张非 front 图片，且首图就是构造的第一张」；多图 front-cover 导出测试断言按取到图片 MIME 推断的默认扩展名。
- 不改任何函数体、不弱化或调整既有断言阈值、不改生产行为、不新增依赖、不新增/重命名 Tauri command。

## 2. 范围与边界

### 2.1 范围内

- `src-tauri/src/commands/cover.rs:80`：`export_cover` 上方 doc comment 改写。
- `src-tauri/src/service/cover.rs:144`：`export_cover_bytes` 上方 doc comment 改写。
- `src/styles/command-contract.test.ts:4`、`:39`：注释数字 19 → 22。
- `src-tauri/tests/export_cover.rs`：
  - `export_falls_back_to_first_picture_without_front_cover` 增加 fixture 早检。
  - `export_prefers_front_cover_over_first_picture_flac` / `_mp3` 增加默认导出扩展名断言。

### 2.2 明确不做（Out of scope）

- 不改 `reader.rs`、`service/cover.rs`、`commands/cover.rs` 的任何函数体或类型签名；本变更只动注释。
- 不改 `command-contract.test.ts` 的断言（`:96`、`:105` 已是 `toHaveLength(22)`）与正则提取逻辑。
- 不改 `src-tauri/tests/open_song.rs`：预览侧既有测试已用不同字节区分 front 与首图；本次 proposal Impact 只列 `export_cover.rs`，且预览与导出共用 `first_embedded_picture`，共享路径的证据由导出侧早检 + 既有 `fixture_early_check_multi_picture_order` 提供。若要求预览测试也逐用例加早检，属范围扩张，需另行裁决。
- 不改 `src-tauri/tests/common/mod.rs`：既有 `add_pictures`、`tiny_png_bytes`、`tiny_png_bytes_blue` 已足够构造并区分两张非 front 图片。
- 不改已归档的 `openspec/changes/archive/2026-11-17-rust-review-hardening/design.md` 或其他历史归档。
- 不改 `openspec/specs/cover-embed/spec.md` 的「右键导出内嵌封面原图」requirement 及其 scenario（`:44`、`:54` 仍写「第一个 front cover 的原始字节」）。这是 `rust-review-hardening` 归档后遗留的既有规格债务：该 requirement 与本次 MODIFIED 的「封面预览与导出优先取 front cover」在主 spec 中并存，前者措辞偏绝对。修它需要新增一条 MODIFIED requirement 并重跑完整门禁，超出本变更「零行为变更的注释/测试收敛」范围；记为后续规格债务（CR minor #1），不在此处顺手改。
- 不改 `docs/V1-PRD.md`、`docs/design/design.md`：两份文档的取图描述已是正确表述（design `:225`、PRD `:287`）。
- 不新增依赖、不新增/重命名/删除 Tauri command、不改前端生产代码与 IPC 契约。
- 不改变 V1 约束（一次一首、保存全量覆盖、直接写盘、撞名拒绝、坏标签只读、离线降级）。

## 3. 域判定

判定为 `backend`。理由：

- 4 个被改文件中 3 个是 Rust（2 个源码注释 + 1 个 Rust 集成测试），本变更唯一影响验证强度的语义改动在 Rust 测试侧。
- 第 4 个文件 `src/styles/command-contract.test.ts` 虽位于前端目录，但只改两行注释里的数字，不改断言、不改提取逻辑、不改任何前端运行时代码；它是前端测试套件的一部分，因此 `npm run test` / `npm run build` 作为回归门禁执行。
- 不存在 Rust → Vue 的行为依赖或跨端顺序问题，不需要按 `both` 管理；若按 `both` 处理只会引入不存在的顺序约束。故 `backend` 更准确。

执行顺序：1.1 / 1.2 / 2.1 可并行（文件不重叠）；2.2 依赖 2.1（同一测试文件串行写入）；最后 3.1 全量验证。

## 4. 逐项技术设计

### 4.1 两处取图注释改写

**事实基准**：`reader::first_embedded_picture`（`src-tauri/src/service/reader.rs:54-65`）的实际语义是

```rust
tag.and_then(|t| {
    t.get_picture_type(PictureType::CoverFront)
        .or_else(|| t.pictures().first())
        .cloned()
})
.or_else(|| {
    path.extension()
        .filter(|ext| ext.eq_ignore_ascii_case("ape"))
        .and_then(|_| read_ape_cover(path))
})
```

即：优先第一个 `CoverFront`；无 front cover 时取第一张；只有通用标签完全无图（或没有 primary tag）时才回退 APE 原生 `Cover Art (Front)`。`reader.rs:45-53` 的注释已经是正确表述，本次不改。

**4.1.1 `src-tauri/src/commands/cover.rs:80`**

现状（唯一陈旧行）：

```rust
/// 把标签内第一个 front cover 的**原始字节**写到 `dest_path`（纯写盘，无 UI）。
```

改为：

```rust
/// 把标签内封面（优先第一个 `CoverFront`，无则第一张；通用标签完全无图时再回退
/// APE 原生 `Cover Art (Front)`）的**原始字节**写到 `dest_path`（纯写盘，无 UI）。
```

**4.1.2 `src-tauri/src/service/cover.rs:144`**

现状（唯一陈旧行）：

```rust
/// 读单曲标签内**第一个 front cover 的原始字节** + 其声明 MIME（export-embedded-cover）。
```

改为：

```rust
/// 读单曲标签内封面（优先第一个 `CoverFront`，无则第一张；通用标签完全无图时再回退
/// APE 原生 `Cover Art (Front)`）的**原始字节** + 其声明 MIME（export-embedded-cover）。
```

**要点**：

- 只替换上述 doc comment，不触碰相邻段落、函数体、`use` 与模块头注释。
- 新文案与 `docs/design/design.md:225`、`docs/V1-PRD.md:287` 的措辞保持一致，避免三处再次漂移。
- `rustfmt` 默认不重排 doc comment，换行位置不会引起 `cargo fmt --check` 差异。

### 4.2 `command-contract.test.ts` 注释计数 19 → 22

**事实基准**：

- `src-tauri/src/lib.rs:22-43` 的 `generate_handler!` 实际注册 22 个 command（去重后 22）。
- `src/styles/command-contract.test.ts:96` 断言 `toHaveLength(22)`；`:105` 对三个文档源同样断言 `toHaveLength(22)`。
- 同文件 `:4`、`:39` 两行注释仍写 19，是唯一陈旧字面量。

**改动**：

- `:4`：`// 实际注册的 19 个 command（代码是唯一事实来源，文档跟随代码）。`
  → `// 实际注册的 22 个 command（代码是唯一事实来源，文档跟随代码）。`
- `:39`：`// 19 个 command 中无参者包括 pick_folder / pick_cover_file / get_last_dir / check_for_update。`
  → `// 22 个 command 中无参者包括 pick_folder / pick_cover_file / get_last_dir / check_for_update。`

**为什么只改注释、不动断言与提取逻辑**：

- 断言 `toHaveLength(22)` 已是正确值，改它反而制造错误；`libCommands` 由 `lib.matchAll(/commands::([a-z_]+)::([a-z_]+)/g)` 从 `lib.rs` 动态提取，三个文档源由锚点切片 + 正则提取，均无硬编码计数。
- 该守卫自身包含「lib.rs 实际注册恰为 22 个」的自检（`:95-98`）。未来新增 command 时守卫会先红，再同步文档与注释；本次只修正既有注释的事实错误。

### 4.3 强化封面回退测试

#### 4.3.1 无 front cover 回退测试增加 fixture 早检

**现状**（`src-tauri/tests/export_cover.rs:250-272`）：`export_falls_back_to_first_picture_without_front_cover` 用 `[CoverBack(first), Other(second)]` 构造 FLAC/MP3，随后只断言 `bytes == first`、`bytes != second`。若 fixture 退化（例如 lofty 行为变化导致只有一张图落盘，或第二张被丢弃），`bytes == first` 仍会通过，无法证明「多图标签中取第一张」。

**设计**：在业务断言之前、每个容器（`no-front.flac`、`no-front.mp3`）的循环内回读标签并断言：

1. `tag.get_picture_type(PictureType::CoverFront).is_none()`：证明标签确实没有 front cover，导出走的是回退分支。
2. `tag.pictures().len() == 2`：证明不是「只有一张可挑」。
3. `pictures[0].pic_type() == CoverBack`、`pictures[1].pic_type() == Other`：证明两张都是非 front，且顺序按构造落盘。
4. `pictures[0].data() == first`、`pictures[1].data() == second`：证明首图就是构造的第一张、次图就是构造的第二张（两图字节不同，来源可判定）。

早检通过后再执行既有业务断言（`bytes == first`、`bytes != second`），既有断言保持原样，不弱化、不改阈值。

代码形态（实现细节，Tester 按此落地）：

```rust
let tagged = Probe::open(&path)
    .and_then(|probed| probed.read())
    .unwrap_or_else(|e| panic!("{name} fixture 应可被 lofty 读取: {e}"));
let tag = tagged
    .primary_tag()
    .unwrap_or_else(|| panic!("{name} 应有 primary tag"));
assert!(
    tag.get_picture_type(PictureType::CoverFront).is_none(),
    "{name} fixture 不应含任何 CoverFront（否则不会走回退分支）"
);
let pictures = tag.pictures();
assert_eq!(pictures.len(), 2, "{name} 应含两张非 front 图片");
assert_eq!(pictures[0].pic_type(), PictureType::CoverBack, "{name} 首图应为 CoverBack");
assert_eq!(pictures[1].pic_type(), PictureType::Other, "{name} 次图应为 Other");
assert_eq!(pictures[0].data(), first.as_slice(), "{name} 首图字节应来自构造的第一张");
assert_eq!(pictures[1].data(), second.as_slice(), "{name} 次图字节应来自构造的第二张");
```

所需符号（`Probe`、`TaggedFileExt`、`PictureType`）已在 `export_cover.rs:27-29` 导入，无需新增依赖或 import。循环前补充一次 `assert_ne!(first, second, ...)`，保证字节可区分。

#### 4.3.2 多图 front-cover 用例补默认导出扩展名断言

**现状**：`export_prefers_front_cover_over_first_picture_flac`（`:204-225`）与 `_mp3`（`:227-248`）已断言导出字节等于第二张 front、且 `mime == Some("image/png")`，但没有断言存盘对话框的默认扩展名。

**设计**：在两个用例的 `mime` 断言之后追加：

```rust
assert_eq!(
    default_cover_file_name(&flac, mime.as_deref(), &bytes),
    "multi.png",
    "默认导出名应使用取到图片的 MIME 推断扩展名"
);
```

MP3 用例把 `&flac` 换成 `&mp3`。`default_cover_file_name` 已在 `export_cover.rs:20` 导入，无新增 import。

**为什么用 `default_cover_file_name` 而不是 `cover_extension_for`**：

- `default_cover_file_name` 是生产路径 `commands::cover::pick_cover_save_path` 实际调用的函数（`src-tauri/src/commands/cover.rs:61`），断言它等价于验证「导出字节 + MIME → 存盘框预填名」的完整链路，而不只是扩展名映射。
- 它内部调用 `cover_extension_for`，扩展名推断仍被覆盖；`cover_extension_for` 的映射表已在 `service_cover_tests.rs` 由 `cover_extension_for_known_mime_types_map_to_single_extension`、`cover_extension_for_unknown_mime_falls_back_to_byte_sniffing`、`cover_extension_for_undetectable_format_falls_back_to_jpg` 直接覆盖，重复断言低层映射不增加证据。
- 该断言直接对应 delta spec「导出场景 SHALL 断言按取到图片的 MIME 推断出的默认扩展名」：MIME 取自 `export_cover_bytes` 的返回值，音频 stem 为 `multi`，结果必须是 `multi.png`。

**边界**：两张 fixture 图都是 PNG，扩展名本身不能区分 front/back；区分取图来源仍由既有的字节断言（`bytes == front`、`bytes != back`）承担，本断言只锁定「默认名按 MIME 推断」这一条。

#### 4.3.3 为什么不动 `open_song.rs`

- proposal 的 Impact 明确只列 `src-tauri/tests/export_cover.rs`。
- 预览（`read_song_meta`）与导出（`export_cover_bytes`）共用 `reader::first_embedded_picture`；导出侧早检 + 既有 `fixture_early_check_multi_picture_order` 已为共享取图路径提供「顺序与类型可区分」的证据。
- `open_song_preview_prefers_front_cover_over_first_picture` 与 `open_song_preview_falls_back_to_first_picture_without_front_cover` 已用不同字节断言 front/首图来源，本次不改其断言。
- 如后续要求预览测试也逐用例加早检，属新的测试强度范围，需主会话/用户另行批准。

### 4.4 规格行为不变声明

本变更不改变任何产品行为：

- 取图优先级仍由 `reader::first_embedded_picture` 决定，代码零改动。
- 导出字节、默认文件名、错误文案、只读语义均不变。
- command 数量、名称、签名与前端契约不变。
- 测试改动只增加前置证据与一个默认名断言，不改变被测实现的期望结果。

## 5. 风险与回退

| 风险 | 影响 | 缓解/回退 |
| --- | --- | --- |
| 注释换行被 rustfmt 重排 | `cargo fmt --check` 失败 | doc comment 不受 rustfmt 重排；任务验收包含 fmt 检查 |
| fixture 早检暴露 loft/ID3v2 顺序差异 | 测试红，但可能是真实 fixture 问题 | 早检失败信息直接指出顺序/类型/字节不符；不得删早检或改断言凑绿，如实回报 Leader |
| `default_cover_file_name` 断言依赖 MIME | MIME 若为空会退化为字节嗅探，仍为 png，断言仍成立 | 用例已先断言 `mime == Some("image/png")`；若 MIME 行为变化，先红的是既有断言 |
| 注释改动被误扩大 | 触碰函数体/其他注释，改变审查面 | 任务限定单行替换；主会话按 diff 审计 |
| 前端测试文件被误改逻辑 | 契约守卫失效 | 任务只允许改两行注释；验收含 `npm run test` 与 diff 审计 |

本变更无数据迁移、无新依赖、无 IPC 变化；回退以文件为单位还原，互不依赖。

## 6. 测试与验证计划

### 6.1 变更级门禁

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --test export_cover
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
npm run test -- src/styles/command-contract.test.ts
npm run test
npm run build
npx --yes @fission-ai/openspec@1.5.0 validate rust-review-minor-cleanup --strict --no-interactive
```

说明：

- `cargo fmt --check` 当前基线已通过（exit 0），本次只加注释与测试断言，不应引入格式差异。
- `cargo test --test export_cover` 先做快速回归；`--all-targets` 覆盖全量 Rust 测试。
- `npm run test -- src/styles/command-contract.test.ts` 单独跑契约守卫；`npm run test` 跑全量前端测试。
- `npm run build` 含 `vue-tsc --noEmit`，验证 TS 注释改动不影响类型检查与构建。

### 6.2 CI 对齐（Verify 按 WORKFLOW §3 执行）

`.github/workflows/ci.yml` 当前实际启用：OpenSpec `validate --all --strict`、pipe 原生套件、Homebrew publisher 测试、pipe self-check、`npm ci`、`npm run build`、`npm run test`、`cargo check --all-targets`、`cargo test --all-targets`。Verify 须逐条执行并记录退出码：

```sh
npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive
node --test '.agents/tools/pipe-core/test/*.test.js' 'tests/workflow-core/*.test.cjs' '.agents/tools/pipe-native/test/*.test.js'
node --test tests/homebrew/publish.test.mjs
node .agents/tools/pipe-native/self-check.js
npm ci
npm run build
npm run test
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

### 6.3 完成判定

- `rg -n "第一个 front cover" src-tauri/src/commands/cover.rs src-tauri/src/service/cover.rs` 无输出（exit 1 为预期）。
- `rg -n "19 个 command" src/styles/command-contract.test.ts` 无输出（exit 1 为预期）。
- `cargo test --all-targets` 输出中 `export_falls_back_to_first_picture_without_front_cover`、`export_prefers_front_cover_over_first_picture_flac`、`export_prefers_front_cover_over_first_picture_mp3` 均通过。
- 所有门禁命令退出码 0；不得跳过或用 `|| true` 吞失败。
- **实现文件** diff 只包含 §2.1 列出的四个文件（两处 Rust 注释、一处 TS 注释、一个 Rust 测试文件），且源码改动只有注释行；`openspec/changes/rust-review-minor-cleanup/` 下的 5 个变更文档（proposal/design/tasks/spec/.openspec.yaml）是本变更自身的规格产物，属预期文件。

## 7. 规格追溯矩阵

delta spec：`openspec/changes/rust-review-minor-cleanup/specs/cover-embed/spec.md`（MODIFIED requirement「封面预览与导出优先取 front cover」，行为不变，证据强度提升）。

| delta spec 条目 | 实现/证据位置 | 测试/命令 |
| --- | --- | --- |
| Requirement：预览与导出共用取图路径，优先第一个 `CoverFront`，随后第一张，APE 回退不变 | `src-tauri/src/service/reader.rs:54-65`（本次不改）；注释同步于 `commands/cover.rs:80`、`service/cover.rs:144` | `fixture_early_check_multi_picture_order`、`export_prefers_front_cover_over_first_picture_flac`、`_mp3`、`export_cover_bytes_ape_returns_embedded_original_bytes_via_fallback`、`open_song_preview_prefers_front_cover_over_first_picture` |
| Requirement 证据句：多图 fixture 先回读并断言顺序与类型 | `src-tauri/tests/export_cover.rs` 的 `fixture_early_check_multi_picture_order`（既有）；回退场景新增于 `export_falls_back_to_first_picture_without_front_cover` 函数内早检 | `fixture_early_check_multi_picture_order`、强化后的 `export_falls_back_to_first_picture_without_front_cover` |
| Scenario：首图不是 front cover 的多图标签 | 多图 front-cover 导出/预览用例；新增默认扩展名断言 | `export_prefers_front_cover_over_first_picture_flac`、`export_prefers_front_cover_over_first_picture_mp3`（含 `default_cover_file_name == "multi.png"`）、`open_song_preview_prefers_front_cover_over_first_picture` |
| Scenario：无 front cover 的既有标签 | 回退用例新增早检（无 CoverFront、2 张非 front、首图字节 = 构造首图） | `export_falls_back_to_first_picture_without_front_cover`、`open_song_preview_falls_back_to_first_picture_without_front_cover` |
| Scenario：APE 回退仍可用 | `reader.rs:60-64` 不变；APE fixture 早检既有 | `fixture_early_check_flac_and_ape_embedded_pictures_are_readable`、`export_cover_bytes_ape_returns_embedded_original_bytes_via_fallback` |

补充说明：

- 两处取图注释与 `command-contract.test.ts` 注释修正不属于 delta spec 的产品行为要求，是 proposal 明确列出的维护性收敛；对应任务 1.1、1.2，验收为 grep 无陈旧文案 + 编译/测试/构建通过。
- 本次不新增 spec scenario；delta spec 的三条 scenario 均由既有或强化后的测试覆盖。
