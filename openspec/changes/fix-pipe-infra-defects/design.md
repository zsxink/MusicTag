## Context

本变更修复 Issue #147 汇总的四项 pipe 基建既有缺陷。四项均在最近一次完整跑通 `bootstrap → integrate` 时暴露，根因均已在本变更的 Architect 阶段于隔离克隆（`git clone` 到 `/tmp`，不在主仓做实验）中逐条实测复现。

### 实测结论（与 Issue 描述的偏差）

| # | Issue 描述 | 实测结论 |
|---|---|---|
| 1 | 归档因 PATH 上 openspec 1.13.2 与固定 1.5.0 不一致而 exit 1 | **归因不成立**：`Rules for 'all' must be an array of strings` 在 1.5.0 与 1.13.2 下**都出现**；PATH 的 1.13.2 实测能成功归档（wrapper 返回 `{"ok":true,...,"archived":true}`），exit 1 未复现。真实根因有两层：**其一**，`rules.all` 首条含 `feat(<issue>): <任务>`——冒号+空格使 YAML 将其解析为嵌套映射，该条被丢弃、整组 rules 失效；**其二**（Dev 阶段实测追加），`all` 根本不是合法 artifact ID——`instruction-loader.js:118` 按 artifactId 精确取值、无全局回退，而 `spec-driven` schema 只定义 `proposal`/`specs`/`design`/`tasks`，因此这两条规则自 `ae058b2` 引入以来**从未生效**。加引号只能把告警从「must be an array of strings」换成「Unknown artifact ID: all」，不修第二层则告警不会归零。**版本固定仍需做**（`archive-change.js:13` 是唯一裸调 PATH `openspec` 的位置），但它是独立的 hardening，不是该 warning 的成因。 |
| 2 | 指纹随「删除是否已提交」漂移 | **成立**：删除前 308 条含一条 `kind:"deleted"`，提交后 307 条无该条，指纹 `60af8b0c…` → `58c8aeff…`。 |
| 3 | `wait-ci.js` 瞬时网络错误不重试且与 CI 失败同码同形 | **成立**：伪造 `gh` 前两次 EOF、第三次成功，实测仅调用 1 次 `gh` 即 exit 1。 |
| 4 | CI 不跑原生测试套件 | **成立**：`ci.yml`/`release.yml` 中 `node --test` 出现 0 次；`package.json` 的 `test` 为 `vitest run`，`vitest.config.ts` 只收 `src/**/*.test.ts`，13 个原生套件（108 例）无人执行。 |

### 现状要点

- **openspec 调用点分散且版本固定不一致**：唯一固定 `@1.5.0` 的只有 `.github/workflows/ci.yml:21`。`.agents/commands/archive-change.js:13` 裸调 PATH `openspec`；`.agents/tools/pipe-core/verify.js:42/51/64/66` 与 `.agents/workflows/pipe-preflight.sh:38`、`pipe-epic-preflight.sh:79` 用不带版本的 `npx openspec`；`.agents/tools/pipe-core/integrate.js:304` 是缺 wrapper 时的裸调回退分支。
- **指纹算法被三方各自声明**：`source-fingerprint.js:12`（`VERSION`）、`progress.js:17`（`SOURCE_FINGERPRINT_VERSION`）、`progress.js:51`（kind 白名单 `['file','symlink','deleted']`），另 WORKFLOW.md:69 与 `openspec/specs/workflow-core/spec.md:239` 有散文表述。任一处需同步。
- **现有测试无法捕获这些缺陷**：`commands.test.js:34-41` 在 PATH 注入**假的** `openspec`/`gh`，因此结构上不可能发现版本漂移，也未覆盖 EOF 重试；`native-entry-contract.test.cjs:217-251` 是唯一的指纹测试，只覆盖 cwd 无关、归档移动稳定、内容敏感性，**没有**创建「已删除未提交」的文件。
- **`wait-ci.js:60` 的 15 秒等待是忙等**（`while (Date.now() < t)`），烧满 CPU。

### 原生 Agent 边界与 Markdown 恢复

本变更只改 pipe 自身的工具、脚本与 workflow，不涉及任何子 Agent 派发语义：主会话仍是唯一 Leader，`progress-cli.js` 仍是唯一写入者，子 Agent 仍只在其授权路径内写入。因此 **Markdown 恢复协议不变**——`progress.md` 的阶段/checkpoint/证据结构、`takeover`/`init-recover` 语义均不受影响。唯一影响恢复的是：`source-fingerprint.js` 算法版本递增后，旧 `progress.md` 中按旧版本记录的 Verify 指纹将不再被 `progress.js` 接受（见「风险」）。

## Goals / Non-Goals

**Goals:**

1. 让 `openspec/config.yaml` 的 artifact 规则真正生效，消除 rules 解析告警。
2. 把所有 openspec 调用点统一固定到与 CI 同源的 `1.5.0`，并由静态自检守护，使版本漂移不可能静默复发。
3. 让源码指纹只由工作区内容决定，消除「删除是否已提交」造成的漂移。
4. 让 `wait-ci.js` 对瞬时网络错误有界自愈，并以可区分字段区分「取不到远端事实」与「CI 未通过」。
5. 让 pipe 原生测试套件进入 `ci.yml`、`release.yml` 与本地验证计划三处，消除单侧覆盖。

**Non-Goals:**

- 不升级 openspec 到 1.13.x，不迁移 `rules` 到新版 schema（实测新版归档已可用，升级收益低于回归成本）。
- 不重构 `.agents/commands/` 为共享模块体系——只做最小必要的版本固定，避免扩大 diff 与 CR 面。
- 不改变 MusicTag 任何产品行为，不改 `docs/V1-PRD.md` / `docs/design/design.md`。
- 不修复 Issue #147 之外的其他 pipe 问题（忙等是 wait-ci 修复的附带项，不单列）。

## Decisions

### D0: `config.yaml` 的全局规则移到全局 `context` 块，删除失效的 `rules.all`

**问题重述**：规格 Scenario 要求「CLI 不输出 rules 解析告警」，但 `rules.all` 是死 key——`instruction-loader.js:118` 为 `projectConfig?.rules?.[artifactId]` 的精确键取值，无全局回退；`spec-driven` schema 仅定义 `proposal`/`specs`/`design`/`tasks`。因此只加引号会把告警换成 `Unknown artifact ID: "all"`，而这两条规则在任何 openspec 版本下都从未注入过 artifact 指令。

**选择**：把这两条全局流程规则移入 `config.yaml` 顶层的 `context` 块（唯一真正全局的字段），并删除 `rules.all`。

**已实测验证**（四个 artifact 逐一取 instructions）：

| artifact | 自身 `rules` 是否仍正确 | context 含「Issue 驱动」 | context 含「Epic 拆分」 |
|---|---|---|---|
| `proposal` | ✅ | ✅ | ✅ |
| `specs` | ✅ | ✅ | ✅ |
| `tasks` | ✅ | ✅ | ✅ |
| `design` | ✅ | ✅ | ✅ |

rules 解析告警数：改前 1 → 改后 **0**。

**备选与否决**：
- *只加引号、保留 `all`*：告警变为「Unknown artifact ID」，规格 Scenario 字面未满足。
- *复制到 4 个合法 key*：告警同样归零，但同一段文字维护 4 份，改一处漏三处的漂移风险高于收益。
- *升级 openspec 以获得 `all` 语义*：范围最大，且 30 个 canonical spec 的 strict 校验会受影响（与既有否决理由相同）。

**全量审计（Dev 阶段实测追加）**：只修 `all[0]` 不足够。`rules.design[1]` 末尾的 `（Issue #46/#47）` 含 ` #`，同样被 YAML 当作注释起点截断——实解析长度 79 → 69，`#46/#47）。` 整段丢失。这是**同一机制的第二处实例**，故 1.1 要求全量审计 `rules` 下 9 条条目，而非只修报错的那一条。修复后全量审计结果：9/9 条均为完整字符串，无截断、无非字符串。

**测试策略**：新增测试**不引入 `yaml` 依赖**（根 `package.json` 无 `yaml`，CI `npm ci` 冷 cache 下会 fail-closed）。改为对 config.yaml 原文做定点形态断言：`rules` 下每个 key 的每个条目必须引号闭合、非空、以 `- ` 开头；含 `:`+空格或 ` #` 的条目若未加引号即判失败并报出**行号**；并断言这两条全局规则出现在 `context` 块内、且 `rules` 下不存在 `all`。**刻意不重建 YAML 结构**——自实现的兜底解析器曾实测产出空数组造成假通过，故形态断言优于「半吊子解析」。

**模块归属**：该测试置于 `.agents/tools/pipe-native/test/`（CJS，最近的 `package.json` 为 `{"type":"commonjs"}`），故用 `require`/`__dirname`，由最近的 package.json 覆盖根的 `{"type":"module"}`。实测在 `/`、`/tmp`、`src-tauri/`、`openspec/` 四个 cwd 及其余清空 `NODE_PATH` 的冷 cache 场景下均 exit 0。

### D1: 用共享常量固定 openspec 版本，自检强制校验

**选择**：新增单一版本常量（`.agents/tools/pipe-native/openspec-version.cjs` 导出 `OPENSPEC_CLI_SPEC = '@fission-ai/openspec@1.5.0'` 与派生的 npx 参数数组；扩展名必须是 `.cjs`——根 `package.json` 为 `type: module`，CJS 侧 `require` 与 ESM 侧具名导入都要能加载它），`archive-change.js` / `verify.js` 从该常量派生命令；`pipe-preflight.sh` / `pipe-epic-preflight.sh` 因是 shell，改为显式写 `npx --yes @fission-ai/openspec@1.5.0`；`integrate.js:304` 的回退分支同步。在 `self-check.js` 增加一项检查：扫描上述调用点，任一处在固定版本缺失时 fail-closed。

**散文指令面与权限白名单扩展（Dev 阶段用户裁决「全修」）**：除可执行调用点外，教 Agent「怎么跑 openspec」的散文同样会造成实际漂移——PATH 实测 1.13.2、CI/自检固定 1.5.0。全量盘点后把 17 个指令文件一并固定：管道面（`AGENTS.md`、`.claude/CLAUDE.md`、`WORKFLOW.md` 两处、`roles/verify-agent.md`、`.opencode/agents/verify-agent.md` 权限白名单）+ legacy 面（`.claude/commands/verify.md`、6 个 `opsx/*`、5 个 `openspec-*` skill）。散文行写死完整版本；权限白名单一行用 `npx --yes @fission-ai/openspec@* validate *`（版本通配，bump 不 churn 权限表）。`self-check.js` 新增 `OPENSPEC_PROSE_CALL_SITES` 清单与裸散文判据（`openspec` 后直接跟空白 + 子命令，或 `npx openspec`；固定形态 `openspec@<ver|*> …` 天然不命中，`OpenSpec validate` 大写叙述与目录路径 `openspec/changes` 不误报），红测覆盖 WORKFLOW/AGENTS/白名单三处回退。不入清单的同类文字：`pipeline.js` / `epic-preflight.js` 的报错与叙述串（退役驱动或回调注入，非调用点）、历史 `progress.md` 与归档记录（只读证据）。

**备选与否决**：
- *仅固定已批准的 5 处管道面文件*：被用户否决——`/verify` 与 opsx/skills 的 `openspec validate` 门仍会用 PATH 1.13.2，与 CI 1.5.0 漂移，属同类缺陷；且 spec Scenario 要求「全部调用点」。
- *只固定 validate/archive 门、放任 `list/status/new/instructions`*：同文件混合形态且 guard 需按子命令区分；实测 1.5.0 支持 legacy 所需全部子命令、`status --json` 关键字段与 1.13.2 一致，全固定无技术障碍。

**备选与否决**：
- *只修 config.yaml 不动版本*：被用户否决——`archive-change.js` 裸调 PATH 仍是真实漂移入口。
- *升级到 1.13.2 统一版本*：被用户否决——范围最大，且新版配置 schema 迁移会触及全部 30 个 canonical spec 的 strict 校验。
- *在 `archive-change.js` 内部硬编码版本字面量*：否决——会复制字面量到 6 处，正是当前 `ci.yml`/WORKFLOW/spec 三处硬编码的现状。

**为什么自检必要**：现有 `self-check.js:157` 已经用正则断言 `pipe-epic-preflight.sh` 含 `openspec validate ...--strict`，证明「断言调用点内容」是既有模式；扩展为「断言调用点固定了版本」是同一手法，且该文件自述为纯文件读取、不启动子进程，符合 fail-closed 自检的定位。

### D2: 指纹改为遍历工作区文件系统，路径集合不再经过 Git index

**问题重述**：漂移的成因是路径集合来自 `git ls-files --cached`，而该集合随「删除是否已提交」变化——删除未提交时路径仍在 `--cached`（产出 `kind:"deleted"` 条目），删除提交后路径离开 index（条目消失）。只要路径集合经过 index，就无法与提交状态解耦。

**选择**：改为**直接遍历工作区文件系统**构建路径集合，用 `git check-ignore` 排除被忽略路径（替代 `--exclude-standard`）。路径集合由此只由工作区实际内容决定，与 index/HEAD 状态完全无关，漂移从结构上消失。

**已实测验证**（隔离克隆，Node v24）：

| 场景 | 条目数 | 指纹前 12 位 | 判定 |
|---|---|---|---|
| 删除 tracked 文件，**未**提交 | 307 | `08aba87a7b40` | 基准 |
| 同一删除，**已**提交 | 307 | `08aba87a7b40` | ✅ 与基准一致，漂移消除 |
| 修改 `package.json` 内容 | 307 | `34953fedef34` | ✅ 变化，内容敏感 |
| 还原该修改 | 307 | `08aba87a7b40` | ✅ 回到基准 |
| 新增未跟踪文件 | 308 | `8ec258a602cd` | ✅ 变化，条目 +1 |
| 再删除该新文件 | 307 | `08aba87a7b40` | ✅ 回到基准 |

关于「删除是否可见」：删除一个文件本身就体现为 manifest 中该条目消失（308 → 307），指纹随之改变，因此**删除仍被完整捕获**，不损失安全性。

**备选与否决**：
- *`git ls-files --cached --others --exclude-standard --deleted`*：**已实测否决**。删除未提交时该路径被列出**两次**（`--cached` 与 `--deleted` 各一次），产生重复条目；删除提交后路径彻底离开 git 视野、条目仍然消失——漂移**依然存在**，且额外引入重复路径缺陷。
- *跳过 index 中不存在的文件（删除后直接不产出条目）*：**已实测否决**。确实稳定（提交前后条目数一致），但删除一个 tracked 文件将完全不改变指纹，安全门形同虚设。
- *把 `deleted` 换成 `absent` 常量编码*：否决——常量编码不解决路径集合漂移，提交后条目仍然消失。

**版本递增**：`fingerprintVersion` SHALL 递增为 `pipe-source-fingerprint/v2`（路径枚举方式与排除语义均改变，属破坏性变更）。同步更新 `progress.js:17`（版本常量）、`progress.js:51`（kind 白名单）、WORKFLOW.md:69 与 `workflow-core/spec.md:239` 的散文表述。

**保留的不变量**：路径排序仍为 UTF-8 字节升序；每项仍记录 `{path, kind, sha256}`；排除集合仍含 `openspec` / `.agents/runs` / `.worktrees` / `node_modules` / `target` / `dist` / `coverage`（另需排除 `.git`）。kind 收敛为 `file` / `symlink`，符号链接仍记录 link target 的摘要。

### D3: `wait-ci.js` 用「可重试错误分类 + 有上限退避」

**选择**：新增错误分类，对 `gh` 的失败区分可重试（EOF、connection reset、timeout、5xx、`ETIMEDOUT`、`ECONNRESET`）与不可重试（认证失败、无 required checks、参数错误）；可重试错误做有上限的退避重试（如最多 5 次、指数退避、上限 30s，且不超出总 timeout 预算）；输出增加 `errorKind` 字段，取值区分 `network`（取不到远端事实）与 `checks-failed`（远端事实表明未通过）。同时把忙等换成定时器等待。

**备选与否决**：
- *只加 `errorKind` 不加重试*：不能自愈，Issue 验收第 3 条要求「能自愈**或**明确区分」，两者都做更稳。
- *复用 `error-classifier.js` / `command-runner.js` 的既有词表*：其 `TRANSIENT` 已含 `network`/`protocol`，词表可借鉴；但 `.agents/commands/` 下 5 个 wrapper 全是零共享依赖的独立 ESM，引入跨目录 import 会超出本变更范围，故在 `wait-ci.js` 内聚实现并对齐词表。

**busy-wait**：改为 `await new Promise(r => setTimeout(r, ms))`；`wait-ci.js` 目前是同步 ESM 脚本，需局部改为 async 入口，保持 CLI 输出与退出码契约不变。

### D4: CI 与本地验证计划用同一份「套件清单」表述

**选择**：在 `ci.yml` 与 `release.yml` 各加一个步骤，运行与 `verify.js:38` 相同 glob 形式的三组 `node --test` 加 `self-check.js`；同时把 `verify.js` infra 计划**补上遗漏的** `.agents/tools/pipe-native/test/*.test.js`（46 例，此前只在 Issue 里被记录为缺口）。在 `tests/workflow-core/native-entry-contract.test.cjs` 增加断言：两个 workflow 都含三组套件与自检、且 `verify.js` 的计划包含同样的三组，防止单侧覆盖复发。

**Node 24 注意**：必须用 glob 形式；直接传目录会 `MODULE_NOT_FOUND`（该陷阱已记录在 `verify.js:36-37` 注释中）。

**为什么不加 npm script**：CI 用 `node --test` 直接调用更少一层间接，且 `package.json` 的 `test` 语义是 vitest 前端测试，混入 pipe 原生套件会改变其既有含义。

## Risks / Trade-offs

- **指纹算法升版使旧 progress 失效** → `progress.js` 会对旧版本的 checkpoint 证据 fail-closed。影响面仅限「正在运行中的 pipe 会话」，本变更在 main 上完成后无活跃 run 受影响；progressive 恢复时按「输入已变 → 相关阶段待重做」处理，符合既有恢复语义。
- **FS 遍历的成本与边界** → 已实测真实仓库 308 条目、单次指纹耗时 0.04s、manifest 41.7KB（JSON 化 52.4KB），量级完全可接受。红测已先行（删除提交前后指纹不同 → 修复后相同）。忽略路径未混入已三重复核：临时仓造 `ignored/`、`node_modules/` 验证测试层；真实仓正则扫 308 条路径命中排除词 **0 条**，其中 `.codegraph/`（约 11M）与 `.opencode/node_modules/`（约 61M / 3645 文件）均未出现——307 的条目量级本身即为证据。
- **`check-ignore` 调用开销** → 已采用一次性批量查询 `git check-ignore -z --stdin --no-index`。真实仓 320 条候选路径实测：批量 **8ms** vs 逐路径 spawn **1726ms**（**215.8x**），且两者忽略集合**逐条完全一致**（onlyBatch=0 / onlyPer=0）。退出码语义已固化：0=至少一条被忽略、1=无一条被忽略（非错误）、其他码才抛错。`--no-index` 保留了 v1 `--exclude-standard` 对 force-add 文件的判定语义（实测 `node_modules/tracked.js` 由 exit 1 变 exit 0）。
- **自检新增检查可能误伤** → 新检查只匹配已知调用点文件与固定版本字符串，不做通用 YAML/JS 解析，避免误报；测试须覆盖「版本被移除时自检确实失败」。
- **`wait-ci.js` 改 async 影响退出码契约** → 现有 `commands.test.js:130-159` 断言 exit 0/1 与 JSON 形状，是回归护栏；改造须保持这两者不变，并新增 EOF 重试用例。
- **CI 增加约 108 个用例的耗时** → 三个套件均为纯 Node 单测、无外部依赖，耗时可接受；不引入新依赖。
- **`config.yaml` 的规则注入方式变更** → 按 D0 把两条全局规则从死 key 移到 `context`。对 Agent 而言仍是同一份提示文本，只是不再依赖 `rules` 的 per-artifact 结构；已实测 4 个 artifact 全部照常收到，且 rules 告警归零。需在 CR 中确认两条规则文本本身写错。

## Migration Plan

1. 依次完成 D1–D4，每项独立提交并可独立验证。
2. 指纹升版与自检新增检查是唯一的兼容性断点，均在同一次合并内完成，避免中间态被他人使用。
3. 无数据迁移、无用户可见变更。回滚方式为 revert 对应提交；回滚 D2 会使已记录的 v2 指纹失效，需重跑 Verify。

## 原生 Agent 边界与恢复说明

- 主会话仍是唯一 Leader 与唯一写入者；不新增、不修改任何角色文件或子 Agent 派发语义。
- `.agents/skills/pipe/WORKFLOW.md` 仅更新与本变更直接相关的表述（openspec 版本固定、指纹 kind 语义、CI 门禁），阶段、checkpoint 与恢复协议不变。
- 恢复语义不变：`progress.md` 结构、attempt、CR 轮次与 takeover 流程均不受影响。

## 验证计划

按 `.claude/CLAUDE.md`「验证」与 design 规则，infra 域执行：

| 检查 | 命令 | 说明 |
|---|---|---|
| 静态自检 | `node .agents/tools/pipe-native/self-check.js` | 必检，含新增版本固定点检查 |
| JS 语法 | `node --check` | 覆盖所有改动 JS：`archive-change.js`、`wait-ci.js`、`source-fingerprint.js`、`progress.js`、`self-check.js`、`verify.js`、新增版本常量模块 |
| Shell 语法 | `bash -n .agents/workflows/pipe-preflight.sh .agents/workflows/pipe-epic-preflight.sh` | 两个 preflight 脚本 |
| 原生套件 | `node --test .agents/tools/pipe-core/test/*.test.js tests/workflow-core/*.test.cjs` | 含既有 `commands.test.js` 契约 |
| 原生套件 | `node --test .agents/tools/pipe-native/test/*.test.js` | 本次补入 `verify.js` 计划的一组 |
| 指纹 | `node .agents/tools/pipe-native/source-fingerprint.js` | 在「删除未提交/已提交」两时点比对指纹相同 |
| OpenSpec 全量 | `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive` | 不能只校验当前 change |
| 业务域基线 | `cargo check` / `cargo test` / `npm run test` / `npm run build` | 本变更不触碰产品代码，但仍按 CI 的 `if` 条件确认适用性并如实记录 |
| CI 一致性 | 比较 `ci.yml`、`release.yml`、`verify.js` 三处套件集合 | 由新增的 `native-entry-contract` 用例断言，不靠人工比对 |

新增测试用例（对应 spec scenario）：

1. `config.yaml` 解析后 `rules.all` 为字符串数组（含冒号条目不被拆成对象）。
2. 自检在版本固定被移除时 fail-closed。
3. 归档 wrapper 使用固定版本（断言 spawn 的可执行/参数来自常量，或在固定版本缺失时测试失败）。
4. 指纹：删除 tracked 文件 → 提交 → 指纹不变（红测先行）。
5. `progress.js` 接受新版 kind 且拒绝旧版本指纹。
6. `wait-ci.js`：前 N 次 EOF 后成功 → exit 0 且 `errorKind` 表明已自愈；持续 EOF → exit 1 且 `errorKind` 为网络类，与真实 CI 失败的 `errorKind` 不同。
7. `native-entry-contract`：`ci.yml`、`release.yml` 与 `verify.js` 三处套件集合一致且含 `self-check.js`。

## Open Questions

- ~~`progress.js:51` 的 kind 白名单在 v2 下是否保留 `deleted`~~ → **已裁决：保留接受**。隔离职责由 `progress.js:45` 的 `fingerprintVersion` 闸门承担，它在**任何** manifest 内容检查之前执行：v1 证据无论自身多自洽都会被拒；随后 `:62` 又用**当前版本前缀**重算指纹，`manifestSha256`/`sourceFingerprint` 对不上同样被拒。删掉 `deleted` 不增加任何拒绝能力，只会让历史 run 的证据形状更难读。
- canonical spec 是否需要 delta → **已裁决：不需要**。`openspec/specs/workflow-core/spec.md:239` 的 Scenario 只说「`source-fingerprint.js` 的版本化 UTF-8 路径清单算法」，不含版本号、kind 枚举或 `ls-files`/`check-ignore` 等算法细节（全文 grep 零命中），算法细节只活在 WORKFLOW.md（已同步）。
- 是否把版本常量同时用于 `openspec/specs/*.md` 与 WORKFLOW.md 的散文表述（当前是硬编码 `@1.5.0` 文本）：本次按既有做法保留硬编码散文，由自检保证调用点一致，不引入文档生成。