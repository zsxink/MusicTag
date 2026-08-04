# infra-codegraph Specification

## Purpose
TBD - created by archiving change infra-codegraph. Update Purpose after archive.
## Requirements
### Requirement: 仓库根存在 `.codegraph/` 索引
`codegraph init` 执行后 SHALL 在仓库根（`/Users/xian/Project/music/MusicTag/`）生成 `.codegraph/` 索引目录，索引覆盖仓库源码符号、文件结构与符号间调用关系。

#### Scenario: 初始化生成索引
- **WHEN** 在仓库根执行 `codegraph init`
- **THEN** 仓库根出现 `.codegraph/` 目录，且 `codegraph status` 显示已初始化（非 "Not initialized"）

#### Scenario: 索引覆盖源码
- **WHEN** 查询一个 V1 既有符号（如 Rust 侧 `save_song` 或前端 store 的 `save`）
- **THEN** 索引能返回该符号的源码位置与调用路径（命中符号，非空结果）

#### Scenario: 重建索引可恢复
- **WHEN** 索引过期或损坏，重新执行 `codegraph index`（或 `sync`）
- **THEN** 索引被重建/增量更新，`codegraph status` 恢复为有效状态

### Requirement: `codegraph explore` 查询可命中符号
接入后定位/理解代码 SHALL 优先走 `codegraph explore`（MCP `codegraph_explore` 或 shell `codegraph explore`），其查询结果可命中仓库符号并给出源码与调用路径。

#### Scenario: explore 命中符号
- **WHEN** 运行 `codegraph explore "save_song"`（或经 MCP `codegraph_explore` 同名查询）
- **THEN** 返回 `save_song` 相关符号的源码与调用路径（含命令注册、前端 invoke 落点）

#### Scenario: 未命中时回退
- **WHEN** explore 查询未命中或索引不可用
- **THEN** 回退 grep/find 定位代码，不阻断开发（与既有工作流约定一致，grep/find 仍是兜底手段）

### Requirement: codegraph 索引不影响现有构建/验证
`.codegraph/` 索引目录 SHALL 不影响本仓库既有构建与验证流程：Rust 编译、前端构建、OpenSpec 规格校验均不受其存在影响。

#### Scenario: cargo check 不受影响
- **WHEN** 索引已建立后运行 `cargo check --manifest-path src-tauri/Cargo.toml`
- **THEN** 结果与索引建立前一致（无新增错误/警告），索引目录不进入 Rust 编译目标

#### Scenario: npm run build 不受影响
- **WHEN** 索引已建立后运行 `npm run build`
- **THEN** 前端构建正常完成，`.codegraph/` 不被 Vite 当作源码打包

#### Scenario: openspec validate 不受影响
- **WHEN** 索引已建立后运行 OpenSpec 校验
- **THEN** 校验结果与索引建立前一致（`.codegraph/` 不干扰 `openspec/` 变更/规格生命周期）

### Requirement: `.codegraph/` 的 git 归属决策（可验收决策点）
本变更 SHALL 对「`.codegraph/` 是否纳入 git」做出明确决策并落地。**决策：忽略 `.codegraph/` 目录**——它是本地生成的索引产物（SQLite 二进制，随代码变更持续重建），非源码；纳入 git 会造成二进制大文件 diff 与合并噪音。PR 说明中需写明该决策及其理由。

#### Scenario: 忽略生效
- **WHEN** 在 `.gitignore` 追加 `.codegraph/` 并执行 `git status`
- **THEN** `.codegraph/` 目录不再出现在未跟踪文件列表中

#### Scenario: 忽略不影响工具可用性
- **WHEN** `.codegraph/` 被 git 忽略后运行 `codegraph explore`
- **THEN** 查询仍正常命中（git 忽略只影响版本控制，不影响文件系统上的工具读取）

