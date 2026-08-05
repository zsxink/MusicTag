# design — command-contract-sync（Tauri command 契约对齐）

> GATE #92 挂起修复变更（Issue #103）。纯规格同步 + 结构守卫，无生产代码改动、无 Tauri 契约运行时改动。

## 技术方案

### D1. command 契约真值基准

`src-tauri/src/lib.rs` `invoke_handler(tauri::generate_handler![...])` 实际注册 **13 个 command**（真值基准）：

```
pick_folder, list_songs, get_last_dir, save_last_dir, open_song,
save_song, rename_song, pick_cover_file, read_cover_path,
search_song, search_source, fetch_lyric, download_cover
```

`dir-memory`（#91）只同步了 `design.md §10.3`（13 个已齐全）；`V1-PRD.md §7`（11 个，缺 `get_last_dir`/`save_last_dir`）、记忆 spec（10 个，缺 `pick_folder`/`get_last_dir`/`save_last_dir`）、`openspec/config.yaml`（11 个，缺 `get_last_dir`/`save_last_dir`）三处契约表未同步。规格四源（PRD/design/openspec/记忆）要求一致，故 GATE #92 维度 1（规格一致性）不通过。

### D2. 三处同步内容（矩阵）

| 文档 | 现状 | 同步为 |
|---|---|---|
| `docs/V1-PRD.md §7`（「Tauri command 全量」） | 11 个：文件组 pick_folder/list_songs/open_song/save_song/rename_song，封面组 pick_cover_file/read_cover_path，搜索组 search_song/search_source/fetch_lyric/download_cover | 文件组补 `get_last_dir(dir) -> Option<String>`（config.json 读上次目录，启动自动加载）、`save_last_dir(dir) -> ()`（fire-and-forget 写 config.json）两行，13 个齐 |
| 记忆 `music-tag-v1-spec.md`（`~/.claude/projects/-Users-xian-Project-music-MusicTag/memory/`） | 10 个 command 契约清单 | 补 `pick_folder`/`get_last_dir`/`save_last_dir`，13 个齐 |
| `openspec/config.yaml` context | 11 个 slash 连接清单 + 自述「与 lib.rs 实际注册一致」 | slash 清单补 `get_last_dir`/`save_last_dir`；修正「一致」表述为真实状态（13 个，详见 lib.rs `generate_handler!`） |

同步口径：command 契约只写「前端 invoke 使用的入口名 + 签名用途」，不写实现细节；签名与 `design.md §10.3` 表对齐。

### D3. 结构守卫（提取锚点逐源规定）

新增 vitest 守卫（`src/styles/command-contract.test.ts`），`// @vitest-environment node` + `node:fs` `readFileSync`，与 `src/styles/design-layering.test.ts` 同哲学——结构断言，不触 Tauri 运行时、不编译 Rust。逐源提取锚点：

| 源 | 锚点 | 提取 |
|---|---|---|
| `src-tauri/src/lib.rs`（真值） | 全文件 | 正则 `/commands::([a-z_]+)::([a-z_]+)/g` → 取第 2 组 = command 名；注释 `tauri::generate_handler![...]` 无 `commands::` 前缀不误中；去重后应恰为 13 个 |
| `docs/design/design.md §10.3` | 切片 `### 10.3 Tauri command 契约` → 下一个 `### `（10.4） | 正则 `/^\| `([a-z_]+)\(/gm` 匹配表行；§10.3 前置的 TS 类型表行（`source`/`lyrics_source`/`cover`…）无 `name(` 形态不误中 |
| `docs/V1-PRD.md §7` | 切片 `**Tauri command 全量**` → 下一个 `>   - 前端只管展示`（实际文本是两空格 `>   - `，仅三条 command 明细 bullet） | 正则 ``/`([a-z_]+)\(/g`` 匹配行内代码 `name(`；必须切片——§308 正文另有 `search_song(title, artist)` 等、设计语言段有 `rgba(`，不切片会误中 |
| `openspec/config.yaml` | 含「Tauri command 契约」的 context 行 | 正则 `/：([a-z_]+(?:\/[a-z_]+)+)/` 捕获 `：` 后 slash 连接清单 → split(`/`) |

断言：归一化集合 `lib.rs === design === prd === config`；任一源缺 command（或 lib.rs 新增未同步）→ 测试红，失败消息列出该源相对 lib.rs 的缺/多余 command 名。各源另断言去重后 count === 13，防正则退化（漏匹配）。

记忆 `music-tag-v1-spec.md` 在仓库外（`~/.claude/.../memory/`），CI 无法读取，**不纳入守卫**；其同步靠本次手动完成 + GATE #92 复核兜底。

### D4. 守卫放置与环境

- 路径：`src/styles/command-contract.test.ts`——与既有结构守卫 `design-layering.test.ts` 同目录（§10.4 结构守卫约定）；vitest `include: ['src/**/*.test.ts']` 自动收集。
- 环境：`// @vitest-environment node`（覆盖默认 happy-dom），`node:fs`/`node:url` 读文件；`fileURLToPath(new URL(...))` 相对 `src/styles/` 解析：`../../src-tauri/src/lib.rs`、`../../docs/design/design.md`、`../../docs/V1-PRD.md`、`../../openspec/config.yaml`。
- 依赖：`@types/node` 已存在，`design-layering.test.ts` 已证此模式过 `vue-tsc --noEmit`（`npm run build`）与 `npm run test`，无新依赖。
- 守卫生效期：`npm run test`（vitest run）即 CI 可执行；不新增 npm script。

### D5. 变更域判定

**域 = frontend**：
- 唯一代码产物是前端 vitest 结构守卫（`src/styles/command-contract.test.ts`）——不触 Tauri 运行时、不编译 Rust，属前端测试基建。
- 三处文档同步（PRD §7 / 记忆 / config.yaml）是规格文档编辑，非 Rust 生产代码，不产生后端域工作。
- `lib.rs` 已正确注册 13 command，**不改**。无 Rust→Vue 依赖序问题，单 Vue-Dev 串行完成即可，无需并行/worktree。

## 关键技术决策

1. **真值基准 = lib.rs `generate_handler!` 实际注册**（代码是唯一事实来源；文档跟随代码，而非代码跟随文档）。为什么：command 契约是跨端 IPC 边界，实际可用性由注册决定；文档声称的 command 若未注册即运行时失败，故以注册集为准，缺文档就补文档。
2. **守卫只覆盖仓库内三源（design/PRD/config.yaml），记忆 spec 排除**。为什么：记忆文件在 `~/.claude/` 仓库外，CI 无法读取，无法结构化断言；纳入反而造成「守卫依赖不可见外部文件」的脆弱性。记忆同步靠本次手动 + GATE #92 复核兜底。
3. **守卫为结构 vitest（node 环境 + 正则提取），不编译 Rust**。为什么：结构断言秒级跑通、CI 可执行、与 `design-layering.test.ts`/`layering.test.ts` 既有哲学一致；若改为「编译 lib.rs + 枚举注册」则成本高且重复后端职责。
4. **提取锚点逐源规定 + count===13 防退化**。为什么：PRD/design/config 格式各异（bullet/表格/slash 清单），统一正则易误中正文；锚点切片 + 计数断言保证「正匹配」与「不漏匹配」双向可靠。
5. **不改 lib.rs / 不改生产代码**。为什么：注册本身正确，缺口只在文档侧；改代码超出本变更需求且引入回归面。
6. **`design.md §10.4` 结构守卫清单同步补 `command-contract.test.ts`**。为什么：§10.4 是测试放置约定文档，须如实列出现有结构守卫文件，保持设计文档内部一致（本变更守卫即覆盖设计文档，自身需先自洽）。

## 任务拆分建议

### G1 结构守卫（先写，红）——测试先行
- [ ] 1.1 新增 `src/styles/command-contract.test.ts`：lib.rs 注册集提取 + design §10.3/PRD §7/config.yaml 契约集提取（D3 锚点）+ 四集相等断言 + 缺口 diff 报错 + count===13 守卫
- [ ] 1.2 `npm run test` 跑守卫：**预期红**，报 PRD §7/config.yaml 缺 `get_last_dir`/`save_last_dir`（自证守卫能抓本缺陷类别）；design §10.3 应已绿

### G2 三处契约同步（守卫转绿）
- [ ] 2.1 `docs/V1-PRD.md §7`：文件组补 `get_last_dir(dir) -> Option<String>`、`save_last_dir(dir) -> ()` 两行（文件类 command 末尾）
- [ ] 2.2 记忆 `music-tag-v1-spec.md`：command 契约清单补 `pick_folder`/`get_last_dir`/`save_last_dir`（仓库外，守卫不覆盖，靠手动 + GATE 复核）
- [ ] 2.3 `openspec/config.yaml`：slash 清单补 `get_last_dir`/`save_last_dir`；修正「与 lib.rs 实际注册一致」表述为 13 个真实注册
- [ ] 2.4 `docs/design/design.md §10.4`：结构守卫清单补 `command-contract.test.ts`（设计文档内部一致，防 design-layering 守卫语义漂移）
- [ ] 2.5 `npm run test` 全绿（守卫绿 + 无回归）；`npm run build` 通过（vue-tsc 含新测试文件）

### G3 提交与收尾
- [ ] 3.1 `git commit -m "feat(103): command 契约对齐——PRD §7/记忆/config.yaml 补 get_last_dir/save_last_dir/pick_folder + 一致性守卫"`（分支 command-contract-sync，PR Closes #103）
- [ ] 3.2 合并后重跑 GATE #92 复核 → 关闭 Epic #86
