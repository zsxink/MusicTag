# rust-review-hardening 设计

GitHub Issue: #194
变更类型: 既有实现纠偏 + 低风险健壮性收敛（无新产品能力）
域判定: `backend`

## 1. 背景与目标

Issue #194 对 `src-tauri/src` 做 rust-review，确认当前 `cargo fmt --check` 与全套 `cargo test` 通过，但存在两处与已批准规格不一致的正确性问题，以及三处低风险健壮性缺口：

1. 封面预览/导出取的是标签内第一张图片，而非优先 `CoverFront`，多图标签会取错图（must-fix）。
2. 改名撞名预检用 `Path::exists()`，悬空符号链接被判为“不存在”，改名可能替换链接（must-fix）。
3. 目录监听与菜单状态的毒化锁被 `into_inner()` / `unwrap_or_default()` 强行消费，异常被掩盖。
4. 搜索源 URL 构造与网易云 crypto helper 对调用方可控输入使用 `expect`，非法输入会 panic。
5. `pick_cover_file` 把读文件/解码失败吞成 `None`，用户看到的是“取消”而非错误；WAV RIFF INFO 写入阶段仍有一个 `expect`。

本变更只让实现回到既有规格并让错误如实抵达用户。目标：

- 六份 delta spec 的全部 scenario 有实现与可执行证据。
- 不引入新依赖、不改前端 `src/`、不新增/改名 Tauri command。
- 不改变一次一首、保存全量覆盖、直接写原盘、无备份/无撤销、候选手动点选、MP3 ID3v2.4 等 V1 约束。

## 2. 范围与边界

### 2.1 范围内

- `src-tauri/src/service/reader.rs`：封面读侧优先 `CoverFront`。
- `src-tauri/src/service/rename.rs`：撞名预检改用 `fs::symlink_metadata`，检查失败返回中文错误。
- `src-tauri/src/service/folder_watch.rs`：毒化锁安全降级，不再 `into_inner()`。
- `src-tauri/src/lib.rs`：菜单状态锁异常记录并恢复读取；提供测试构造入口。
- `src-tauri/src/service/searcher/{qqmusic,kugou,lrclib,itunes}.rs`：URL 构造失败改为该源 `Err`。
- `src-tauri/src/service/searcher/crypto.rs`：AES key 用类型约束，RSA/weapi 改为 `Result`，不再 `expect`。
- `src-tauri/src/service/writer.rs`：RIFF INFO 写入阶段不可访问返回中文错误。
- `src-tauri/src/commands/cover.rs`：`pick_cover_file` 改为 `Result<Option<CoverInput>, String>`。
- `src-tauri/tests/`：对应集成测试与 fixture 扩展。
- `docs/V1-PRD.md`、`docs/design/design.md`：仅同步封面取图优先级与 `pick_cover_file` 契约。

### 2.2 明确不做（Out of scope）

- 不改前端 `src/`（`CoverPanel.vue` 已有 `try/catch`，行为天然兼容）；不新增 UI 提示。
- 不新增、不重命名、不删除 Tauri command；command 总数保持 22，`pick_cover_file` 仍是无参调用形式。
- 不引入日志框架/新依赖；锁异常诊断沿用 `eprintln!`。
- 不改 `searcher::mod::client()` 的固定 HTTP Client 构建 `expect`：这是启动期固定配置，不是调用方可控输入，且不在 proposal Impact。
- 不改 `fetch_lyric` 内部 `.ok()?` 的降级语义（取词失败本就返回 `None`，无 panic）。
- 不改 `missing.rs` 的“有任意图片即视为有封面”判定；本变更只决定取哪张图。
- 不改 APE 写路径、封面候选下载/嵌入路径与 `save_song` 的封面写盘语义。
- 不为 `FolderWatch` 暴露测试后门或新增公开构造器；其毒化场景以代码审查 + 正常路径回归为证据（见 §7.3）。
- 不改变搜索源失败分类、离线降级、超时语义与聚合顺序。
- 不做批量、标签继承、撤销/备份等 V1 之外能力。

## 3. 域判定

判定为 `backend`。理由：

- 所有生产改动都在 Rust 服务层/command 薄壳；前端无需修改。
- 验证以 Rust 集成测试 + `cargo check/test` 为主，配合既有前端测试与构建作为回归。
- 文档改动属于契约同步，不构成独立 docs 域变更。

执行顺序：后端实现与测试任务按 §5 依赖推进；文档任务在行为落定后同步；最后跑完整 CI 门禁。

## 4. 逐项技术设计

### 4.1 封面预览与导出优先 `CoverFront`（must-fix）

**现状**：`reader::first_embedded_picture` 取 `tag.pictures().first()`，仅当没有任何图片时才走 APE 原生回退。`read_song_meta`（预览）与 `cover::export_cover_bytes`（导出）共用该函数，因此问题同时影响预览和导出。

**设计**：

```rust
pub fn first_embedded_picture(path: &Path, tag: Option<&Tag>) -> Option<Picture> {
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
}
```

要点：

- `Tag::get_picture_type(PictureType::CoverFront)` 返回第一个 `CoverFront`；无 front cover 时回退 `pictures().first()`，保持既有行为。
- 仍保留“通用标签有任意图片就不走 APE 原生回退”的既有优先级；只有通用标签完全无图时才回退 `Cover Art (Front)`（spec 的 APE scenario）。
- 函数签名不变，预览/导出自动共享同一取图结果。
- 预览 `encode_cover` 与导出 `export_cover_bytes` 都直接使用 `Picture::data()` 原始字节（预览仅做 data URL 编码，导出完全不经压缩），满足“字节完全一致、非压缩预览图”。
- 默认扩展名继续按该 `Picture` 的 MIME 推断（`pick_cover_save_path` / `cover_extension_for` 已实现），无需额外改动。

**边界**：多图但无任何 `CoverFront` → 第一张（不新增空白封面）；APE 原生项 `read_ape_cover` 构造的 `Picture` 本身是 `CoverFront`，回退语义不变。

### 4.2 改名撞名改用 `symlink_metadata`（must-fix）

**现状**：`rename_song` 用 `new_path.exists()` / `new_lrc.exists()`；`exists()` 跟随符号链接，悬空链接返回 `false`，预检放行后 `fs::rename` 会替换该链接。

**设计**：新增可测试的公共 helper，两处撞名检查都走它：

```rust
pub fn target_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("检查目标是否存在失败: {error}")),
    }
}
```

调用：

```rust
if target_exists(&new_path)? {
    return Err("目标已存在".to_string());
}
if lrc_to_move && target_exists(&new_lrc)? {
    return Err("目标已存在".to_string());
}
```

要点：

- `symlink_metadata` 不跟随链接：普通文件、目录、指向存在目标的链接、悬空链接都返回 `Ok` → 统一视为“已存在”。
- 仅 `ErrorKind::NotFound` 视为不存在；权限错误、`ENOTDIR`（父路径组件是普通文件）等一律 `Err("检查目标是否存在失败: ...")`，不执行任何 rename。
- 所有预检仍在第一次 `fs::rename` 之前完成；`new_path == new_lrc` 的特例保持原样（任何 rename 前返回“目标已存在”）。
- 失败返回中文错误，原音频与 `.lrc` 均未被触碰。
- 正常普通文件撞名行为与错误文案不变；唯一行为变化是悬空链接/元数据错误不再放行。

### 4.3 毒化锁安全降级

#### 4.3.1 目录监听 `FolderWatch.target`

**现状**：`shutdown()` 与 PollWatcher 注册错误回调使用 `unwrap_or_else(|err| err.into_inner())`，读取毒化后的 `Target`。

**设计**：

- `shutdown()`：
  ```rust
  pub fn shutdown(&self) {
      if let Ok(mut target) = self.target.lock() {
          target.closed = true;
          target.active.take();
      }
  }
  ```
  锁毒化时安全跳过清理，不 panic、不读取可能不一致的 `Target`。
- PollWatcher 注册回调：仅在收到 `Err` 时加锁；锁毒化则丢弃本次错误记录：
  ```rust
  if registering_for_callback.load(Ordering::Acquire) {
      if let Err(error) = &result {
          if let Ok(mut slot) = error_for_callback.lock() {
              *slot = Some(error.to_string());
          }
      }
  }
  handler(result);
  ```
- 注册完成后取错误：
  ```rust
  if let Some(error) = registration_error
      .lock()
      .ok()
      .and_then(|mut slot| slot.take())
  {
      return Err(notify::Error::generic(&error));
  }
  ```
  锁毒化时视为没有可用的注册错误记录，按既有成功/失败语义继续。
- `watch()` 原本已返回中文 `Err`，正常路径不变；不新增日志/不新增公开构造器。

#### 4.3.2 菜单 `MenuState`

**现状**：`is_enabled` 在锁毒化时 `unwrap_or(false)`，`snapshot` 返回空 map，异常被静默伪装成“全部禁用/空快照”。

**设计**：

- 新增私有 `lock_state()`：锁毒化时先 `eprintln!("菜单状态锁异常（已恢复读取）: {poisoned}")` 明确记录，再 `PoisonError::into_inner()` 恢复读取。
- `is_enabled` / `snapshot` 改走 `lock_state()`；毒化后仍返回最后一次可见的 map 内容，而不是空/默认值。
- 新增测试构造入口：
  ```rust
  impl MenuState {
      pub fn from_mutex(
          inner: std::sync::Mutex<std::collections::HashMap<String, bool>>,
      ) -> Self {
          Self(inner)
      }
  }
  ```
  仅用于 `src-tauri/tests/` 构造“已毒化的状态”，避免为测试在生产 API 外再开状态后门。
- `commands::menu::apply_snapshot` 原本已对锁异常返回 `Err`，不改；`sync_menu_state` 未毒化路径完全不变。
- 诊断走 `eprintln!`（项目无日志依赖），满足“明确记录锁异常”且不改变返回类型。

### 4.4 搜索 URL 与 crypto helper 不 panic

#### 4.4.1 搜索源 URL 构造

把四处 `.expect("构造 … 搜索 URL 失败")` 改为传播该源错误：

```rust
let url = reqwest::Url::parse_with_params(&self.search_url, &params)
    .map_err(|error| format!("QQ 音乐搜索 URL 构造失败: {error}"))?;
```

- QQ 音乐、酷狗、LRCLIB 各一处；iTunes 在店面循环内，首个非法 URL 即返回该源 `Err`。
- 错误文案前缀分别用“QQ 音乐 / 酷狗 / LRCLIB / iTunes”，保证中文可诊断。
- 聚合层 `search_song_with_sources` 已把 `Err` 作为该源失败：`source_stats` 记 0，`all_failed` 与网络失败一致，其他源不受影响；无需改聚合代码。
- 默认 URL 均为合法常量，固定合法输入行为不变。

`searcher::mod::client()` 的 `expect` 不在范围内（§2.2）。

#### 4.4.2 网易云加密 helper

按“能用类型排除的用类型，不能的在 `Result` 中返回”处理：

- AES 密钥类型收紧为 `&[u8; 16]`：
  ```rust
  fn aes_cbc_encrypt(data: &[u8], key: &[u8; 16]) -> Vec<u8> { ... }
  pub fn aes_ecb_encrypt(data: &[u8], key: &[u8; 16]) -> Vec<u8> { ... }
  ```
  内部改用 `GenericArray::from_slice(key)` / `Aes128::new(...)`，不再 `new_from_slices(...).expect(...)`；非 16 字节 key 在编译期被排除。
- `rsa_encrypt(secret: &str) -> Result<String, String>`：`BigUint::parse_bytes` 的 `Option` 用 `ok_or_else` 转为中文 `Err`（secret 的 hexlify 理论上总是合法，但不再使用 `expect`；`PUBKEY`/`MODULUS` 常量非法时同样返回错误而非崩溃）。
- `weapi_with_secret(text: &str, secret: &str) -> Result<WeapiParams, String>`：
  1. `secret.as_bytes().try_into()` 得到 `&[u8; 16]`；失败 → `Err("AES secret 须为 16 字节")`。
  2. `secret` 必须全部为 ASCII hex，否则 → `Err("AES secret 须为 16 位 hex 字符串")`（覆盖 spec「非 hex secret」）。
  3. `rsa_encrypt(secret)?`。
  4. 返回 `Ok(WeapiParams { ... })`。
- `weapi(text: &str) -> Result<WeapiParams, String>`：内部 secret 来自 `random_hex_secret()`（16 位 hex），正常不会失败，但签名随 helper 统一为 `Result`。
- `linuxapi(text: &str) -> String` 不变：`LINUXKEY` 是 `&[u8; 16]` 常量，输入只有文本，无非法 key 路径；生产调用点 `netease.rs` 只使用 `linuxapi`，无需改动。
- 既有已知向量、往返与形状测试必须更新为 `Result` 解包后断言；固定合法输入输出逐字不变。

### 4.5 `pick_cover_file` 失败如实报错

**设计**：

```rust
#[tauri::command]
pub fn pick_cover_file() -> Result<Option<CoverInput>, String> {
    cover_input_for_selection(
        rfd::FileDialog::new()
            .add_filter("图片", &["jpg", "jpeg", "png", "webp"])
            .pick_file(),
    )
}

/// rfd 对话框无头不可测：把「选择结果 → command 结果」映射提成可测 helper。
pub fn cover_input_for_selection(
    selection: Option<std::path::PathBuf>,
) -> Result<Option<CoverInput>, String> {
    selection.map(|path| cover_from_path(&path)).transpose()
}
```

要点：

- 取消 → `selection = None` → `Ok(None)`；选中 → `cover_from_path` 的 `Result` 原样传播（读失败/格式无法识别/压缩失败均为既有中文 `Err`）。
- 不再用 `.ok()` 把失败伪装成取消。
- 前端 `CoverPanel.vue` 已有 `try/catch`：`Err` 显示错误并保留原封面，`null` 视为取消；无需改前端。
- Tauri command 名与无参形式不变，`command-contract.test.ts` 不受影响。

### 4.6 WAV RIFF INFO 写入阶段返回错误

**现状**：`save_song` 在 `has_riff_info` 分支对 `tag_mut(TagType::RiffInfo)` 使用 `expect`。

**设计**：抽取公共 helper，并在 `save_song` 中传播：

```rust
pub fn write_riff_info(
    tagged_file: &mut lofty::file::TaggedFile,
    song: &Song,
) -> Result<(), String> {
    let riff_info = tagged_file
        .tag_mut(TagType::RiffInfo)
        .ok_or_else(|| "保存失败: RIFF INFO 标签在写入阶段不可访问".to_string())?;
    riff_info.clear();
    apply_riff_info_meta(riff_info, song);
    Ok(())
}
```

`save_song` 的 `if has_riff_info { ... }` 改为 `write_riff_info(&mut tagged_file, &song)?;`。

要点：

- 错误发生在 `write_atomic_with` 之前，原子写回语义保持“失败时原文件零触碰”；错误文案为中文。
- 正常可达路径（RIFF INFO 存在）行为不变：`clear()` + `apply_riff_info_meta` 逐字保留。
- 集成测试用不含 RIFF INFO 的 `TaggedFile` 直接调用 helper，覆盖 `None` 分支；正常 WAV 保存由既有 `save_song` 测试覆盖。

## 5. 中文错误消息策略

- 所有新增/变更的用户可见错误均为中文，格式为“操作/对象 + 原因”，必要处保留底层 `io`/URL 错误细节以便诊断。
- 新增文案：
  - `检查目标是否存在失败: {io error}`
  - `QQ 音乐搜索 URL 构造失败: {url error}` / `酷狗搜索 URL 构造失败: {url error}` / `LRCLIB 搜索 URL 构造失败: {url error}` / `iTunes 搜索 URL 构造失败: {url error}`
  - `AES secret 须为 16 字节` / `AES secret 须为 16 位 hex 字符串`
  - `RSA secret hex 编码失败` / `RSA PUBKEY 非法` / `RSA MODULUS 非法`
  - `保存失败: RIFF INFO 标签在写入阶段不可访问`
- 沿用既有文案：`目标已存在`、`该歌曲没有内嵌封面`、`读取封面文件失败: ...`、`封面格式无法识别` 等，不改写、不翻译。
- 锁异常诊断 `菜单状态锁异常（已恢复读取）: {poisoned}` 写 stderr，不进入 IPC/UI，不泄露用户数据。
- 不把英文 panic 文本暴露给用户；不吞错后假报成功。

## 6. API / 契约变化与文档同步

### 6.1 Tauri command

| command | 变更前 | 变更后 |
| --- | --- | --- |
| `pick_cover_file()` | `() -> Option<CoverInput>` | `() -> Result<Option<CoverInput>, String>`；取消 `Ok(None)`，失败中文 `Err` |

其余 command 签名不变；无新增 command；command 总数 22；`pick_cover_file` 仍为无参 `pick_cover_file()`。

### 6.2 内部函数契约

- `reader::first_embedded_picture`：签名不变，选择语义变为“`CoverFront` 优先，随后第一张，再 APE 回退”。
- `rename::target_exists`：新增 `pub fn(&Path) -> Result<bool, String>`（供集成测试）。
- `writer::write_riff_info`：新增 `pub fn(&mut TaggedFile, &Song) -> Result<(), String>`（供集成测试）。
- `commands::cover::cover_input_for_selection`：新增 `pub fn(Option<PathBuf>) -> Result<Option<CoverInput>, String>`（供集成测试）。
- `MenuState::from_mutex`：新增 `pub fn(Mutex<HashMap<String, bool>>) -> Self`（测试构造入口）。
- crypto：`weapi` / `weapi_with_secret` / `rsa_encrypt` 返回 `Result`；`aes_ecb_encrypt` 的 key 类型为 `&[u8; 16]`；`linuxapi` 不变。均为 service 内部 API，不是 IPC 契约。

### 6.3 文档同步

- `docs/V1-PRD.md` §5.3 导出封面 bullet：把“第一个 front cover”明确为“优先第一个 `CoverFront`，无则第一张；APE 原生回退不变”，并说明预览与导出共用该路径、字节为原图。
- `docs/V1-PRD.md` §7 command 清单：`pick_cover_file() -> Result<Option<CoverInput>, String>`，取消 `Ok(None)`、失败中文 `Err`；`export_cover` 描述同步取图优先级。
- `docs/design/design.md` §9.1：写侧“封面统一使用 `CoverFront`”补充读侧“预览/导出优先第一个 `CoverFront`，无则第一张；APE 原生回退不变”。
- `docs/design/design.md` §10.3：更新 `open_song`、`pick_cover_file`、`export_cover` 三行签名/描述。
- 不改 `.openspec.yaml`、`openspec/config.yaml`；command 名与参数个数不变，前端契约守卫继续通过。

## 7. 测试与 fixture 策略

### 7.1 分层原则

- 生产代码 `src/` 内不新增 `#[cfg(test)]`；所有新测试放 `src-tauri/tests/`，经 `app_lib::` 访问生产 API。
- 需要跨 crate 可见的 helper（`target_exists`、`write_riff_info`、`cover_input_for_selection`、`MenuState::from_mutex`）按既有惯例提升为 `pub`，并在 doc comment 标注测试用途。
- fixture 统一放 `src-tauri/tests/common/mod.rs`；每个测试 crate 自带 `mod common;`。
- 涉及真实文件 I/O 的测试用 `tempfile::TempDir`；网络一律 mock 或注入非法 URL，不发真实请求。

### 7.2 新增 fixture

- `common::add_pictures(path, &[(PictureType, Vec<u8>)])`：在已写好的音频上按传入顺序 `push_picture`，用于构造“第一张 BackCover、第二张 CoverFront”等顺序敏感标签。
- `common` 增加第二种颜色的 PNG 生成 helper（或测试局部 `png_of_size`），确保 front/back 字节不同、可断言来源。
- 既有 `add_tags` 保持“单张 CoverFront”行为，不改变现有测试；多图测试用 `add_tags(..., None, None)` + `add_pictures`。

### 7.3 各场景测试

| 场景 | 测试位置 | 关键断言 |
| --- | --- | --- |
| 多图 FLAC/MP3，首图 BackCover、次图 CoverFront | `tests/export_cover.rs`、`tests/open_song.rs` | 导出字节/预览 base64 解码等于第二张 front 字节；首图字节不出现 |
| 无 front cover | `tests/export_cover.rs` | 取第一张，不返回空 |
| APE 原生回退 | 既有 `tests/export_cover.rs` | 保持通过 |
| 悬空 symlink 音频目标 | `tests/rename_song.rs`（`#[cfg(unix)]`） | `Err("目标已存在")`；链接与原音频保留 |
| 悬空 symlink `.lrc` 目标 | `tests/rename_song.rs`（`#[cfg(unix)]`） | 同上，音频/歌词均不动 |
| 目标是目录 | `tests/rename_song.rs` | `Err("目标已存在")` |
| `symlink_metadata` 非 NotFound 错误 | `tests/service_rename_tests.rs`（`#[cfg(unix)]`，父组件为普通文件 → `ENOTDIR`） | `Err` 含“检查目标是否存在失败”；无 rename |
| 毒化菜单锁 | `tests/menu_action_tests.rs` | 用非默认 map 毒化后 `is_enabled`/`snapshot` 返回该 map 内容，非空/非默认、不 panic |
| 注入非法搜索 URL | 新 `tests/searcher_invalid_url_tests.rs` | 四源各自 `Err`、消息含源名；聚合时该源 0、其他源正常、全失败时 `all_failed=true` |
| 非法 AES secret | `tests/searcher_crypto_tests.rs` | 非 16 字节 / 非 hex 均中文 `Err`，不 panic |
| 合法加密向量 | `tests/searcher_crypto_tests.rs` | 既有已知向量逐字不变 |
| RIFF INFO 写入阶段不可访问 | `tests/save_song.rs` | helper 返回中文 `Err`；正常保存测试不变 |
| 选封面取消/失败/成功 | `tests/commands_cover_tests.rs` | `None → Ok(None)`；非图片 `Err`；合法 PNG `Ok(Some(...))` |
| FolderWatch 毒化 | 无生产测试后门 | `grep into_inner src-tauri/src/service/folder_watch.rs` 无输出 + 既有 `tests/folder_watch.rs`/`folder_watch_tests.rs` 正常路径通过 + CR 逐行审查 |

### 7.4 fixture 早检

- 多图测试的第一个用例先构造 fixture 并读回 `first_embedded_picture`，断言 `pictures()` 顺序与类型符合预期；只有早检通过后才做字节比对，避免 fixture 退化造成假绿。
- 既有 `export_cover` 的 fixture 早检保留。

## 8. 风险与回退

| 风险 | 影响 | 缓解/回退 |
| --- | --- | --- |
| 多图标签取图变化 | 预览/导出从“第一张”变为“第一个 front cover” | 规格要求的行为变化；单图/无 front cover 测试保证兼容；回退只需还原 `first_embedded_picture` 与对应测试 |
| 悬空 symlink 由放行改为拒绝 | 极少数用户的目标名是悬空链接时改名被拒 | 规格要求“拒绝覆盖”；错误文案明确，用户可换名；回退还原 `target_exists` 调用 |
| `symlink_metadata` 在 Windows/macOS 的平台差异 | 悬空链接/元数据错误表现不同 | 代码用 `ErrorKind::NotFound` 语义判定；symlink 测试 `#[cfg(unix)]`，Windows 仅保留编译与普通路径回归 |
| 菜单毒化后恢复读取 | 读到 panic 前最后一次可见 map（可能有一个键处于中间状态） | 仅读操作、无写回；stderr 明确记录异常；正常路径不变；回退还原 `lock_state` |
| crypto 签名变化波及测试 | 编译失败或向量漂移 | 仅测试调用点需解包；已知向量测试锁定输出；`linuxapi` 与生产 `netease.rs` 不动 |
| `pick_cover_file` 返回类型变化 | 前端若未捕获 rejection 会报未处理 Promise | 前端已有 `try/catch`；取消映射 `null`；command 名不变；回退还原 command + 测试 |
| 搜索 URL 失败分类变化 | 注入非法 URL 时该源由 panic 变为失败 | 生产 URL 是合法常量，正常路径不变；聚合已按 `Err` 记失败 |
| WAV RIFF 错误分支实际不可达 | 测试需直接调 helper | 抽取 helper 保证可测；正常保存路径逐字保留；回退还原内联块 |
| 无头环境无 ffmpeg | WAV fixture 无法生成 | CI Ubuntu 安装 ffmpeg；本地缺 ffmpeg 时相关测试按既有方式失败，不作为跳过理由 |

本变更无数据迁移、无新依赖、无破坏性 IPC 参数变化；回退以文件为单位还原，互不依赖。

## 9. 验证计划（对照 `.github/workflows/ci.yml`）

CI 关键环境：Node 24、`npm ci`、Rust stable、Ubuntu 安装 Tauri 依赖与 ffmpeg。命令工作目录：Rust 命令在 `src-tauri/`。

### 9.1 变更级快速门禁

```sh
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --test <受影响测试 crate>
npx --yes @fission-ai/openspec@1.5.0 validate rust-review-hardening --strict --no-interactive
```

### 9.2 全量门禁（与 CI 一致）

```sh
npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive
node --test '.agents/tools/pipe-core/test/*.test.js' 'tests/workflow-core/*.test.cjs' '.agents/tools/pipe-native/test/*.test.js'
node --test tests/homebrew/publish.test.mjs
node .agents/tools/pipe-native/self-check.js
npm ci
npm run build
npm run test
cd src-tauri && cargo check --all-targets
cd src-tauri && cargo test --all-targets
```

### 9.3 完成判定

- 六份 delta spec 的每个 scenario 在 §10 追溯表中都有实现位置与测试/审查证据。
- `cargo check --all-targets`、`cargo test --all-targets`、`npm run build`、`npm run test`、OpenSpec `validate --all --strict` 全部退出码 0。
- 代码审查确认 `folder_watch.rs` 无 `into_inner`，且没有为测试新增生产状态后门（`MenuState::from_mutex` 是唯一新增的测试构造入口，已在 §4.3.2 说明）。
- CR 只读审查无阻断问题；Verify 报告与实际命令输出一致。

## 10. 规格追溯矩阵

| delta spec requirement | 设计 | 任务 | 测试/证据 |
| --- | --- | --- | --- |
| `cover-embed` / 封面预览与导出优先取 front cover | §4.1 | 1.1、1.2 | `export_cover` / `open_song` 多图测试 + APE 既有测试 |
| `cover-embed` / 本地选封面失败如实报错 | §4.5、§6.1 | 7.1 | `commands_cover_tests` 取消/失败/成功 |
| `rename-sync` / 撞名拒绝覆盖（MODIFIED） | §4.2 | 2.1、2.2 | 普通文件/目录/悬空 symlink/ENOTDIR 测试 |
| `folder-list` / 目录监听锁异常安全降级 | §4.3.1 | 3.1 | `grep into_inner` + 既有 `folder_watch` 正常路径测试 + CR |
| `app-menu` / 菜单状态锁异常不静默清空 | §4.3.2 | 3.2、3.3 | `menu_action_tests` 毒化恢复测试 |
| `search-sources` / 搜索源与加密 helper 对非法输入不 panic | §4.4 | 4.1、4.2、5.1、5.2 | `searcher_invalid_url_tests`、`searcher_crypto_tests` 非法输入测试 |
| `song-save` / 标签写入阶段异常返回错误 | §4.6 | 6.1 | `save_song` RIFF helper 测试 + 既有正常保存测试 |
