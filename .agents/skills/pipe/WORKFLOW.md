# pipe 主会话执行协议

本文件是 Codex、Claude Code、OpenCode 的共同流程。当前与用户对话的主 Agent 是唯一 Leader，直接调度宿主原生子 Agent。宿主入口只是薄壳；不得启动独立 Agent CLI、另一个 Leader 会话或 `run.js` 子流水线。普通 `git`、`gh`、`openspec`、`cargo`、`npm` 与纯状态检查命令由主 Agent 的命令工具直接执行。

## 0. 不变量

1. 每个变更先有 GitHub Issue、同名 OpenSpec change、从 main 创建的同名分支与独立 worktree。用户明确要求绕开 pipe 时，按用户授权执行。
2. 权威规格是 `docs/V1-PRD.md`、`docs/design/design.md` 和 `openspec/changes/<change>/`。产品行为修改先同步文档，再改实现；Agent 不自行扩大规格。
3. 主 Agent 唯一负责阶段转换、`tasks.md` 完成标记、`progress.md`、Git 写入与集成。子 Agent 不运行 `git add/commit/push`，不改 index/HEAD，不建/合 PR；写入只限明示路径。CR 必须只读且独立于开发者。
4. 状态 `pending → running → succeeded | failed | suspended`。阶段结果须有文件、退出码、提交和远端事实支撑；文字 `DONE` 不构成完成证据。
5. 每次派发、答复、阶段完成及外部副作用前后都更新 `.agents/runs/<change>/progress.md`。它是 gitignore 的运行记录；`openspec/changes/<change>/tasks.md` 随 PR 提交。只有主 Agent 更新两者的状态。

## 1. 启动和恢复

先定位主仓根、change、Issue、branch、linked worktree；读取 proposal/specs/design/tasks、公共角色和已有进度。`progress-cli.js` 从 linked worktree 自动解析共享主仓根，将 `.agents/runs/<change>/progress.md` 保存在不会随子 worktree 删除的主仓中；`--worktree` 仍记录实际代码工作树。使用 `init <change> --issue <n> --branch <branch> --worktree <path> --owner <host:session>` 创建进度与唯一写入锁。若初始化在完整 lock 落盘后、progress 首写前崩溃，核实旧 owner 和无活动写入者后使用 `init-recover <change> --owner <new> --previous-owner <old> --confirmed-no-live-writer true --evidence <依据> --branch <branch> --worktree <path> --issue <n>`；Epic 需加 `--epic --source-revision <sha>`。恢复会审计隔离旧 lock 并写入决定，不能手工删除 lock。Epic 启动必须执行 `epic-init <epic> --owner <...> --worktree <主 worktree> --source-revision <当前 main SHA>`；Epic preflight 每轮查询所有子 Issue 的时间线，只把同仓库且明确关闭该 Issue 的已合并 PR 记为完成，把远端事实写入忽略目录，再刷新 `epic-progress.md` 并计算 `epic-ready`。单独调用 `epic-ready` 也必须提供本轮 `--facts` 和 `--owner`，不能依赖过期的 Markdown `done` 状态。不完整或失配的 branch/worktree/sourceRevision 阻断调度。后续写入都带相同 owner，完成或挂起时释放锁。若只有旧 `state.json`，调用 `migrate <change> --owner <...>` 只读导入为**待核实候选**，保留原件；旧 succeeded 不直接视为新流程通过。发现其他 owner 的锁时，或锁已释放但 progress.owner 仍属于旧会话时，先核实旧主会话和所有写入子 Agent 均已结束，再显式 takeover；未完成核实就停止写入，不并行派发相同范围。

恢复时先运行 `status` / `resume-plan` 并核对：当前分支/worktree、`git status`/HEAD、tasks 勾选项、文件与提交 SHA 是否仍存在且属于当前历史、验证是否针对当前 HEAD/源码快照、GitHub Issue/PR/required CI/合并状态。`resume-plan` 的 facts 必须来自本次真实命令与远端查询，不能从旧状态文件复制。若 `verify-remote` 和 `cleanup-local` 都由当前 GitHub 与本地事实证实，进入终态恢复：允许当前 checkout 已在 main、change worktree 已删除、HEAD 已包含 merge；核对原验证 HEAD 仍可从 main 到达并复核历史验证记录后，只补 integrate 最终状态或报告已完成。其他事实不符时，把该阶段及受影响下游标为待重做。被中断的写入子 Agent 先核对遗留差异、子 Agent 是否仍活跃及文件所有权，再续派；旧 Agent ID 仅供排查，不能作为跨会话恢复凭据。若 progress.owner 是旧 owner（锁仍由其持有或挂起时锁已释放），只有主 Agent确认旧会话和所有写入子 Agent 已结束，才用 `takeover <change> --owner <new> --previous-owner <old> --confirmed-no-live-writer true --evidence <核查依据>` 显式认领；运行时须在一个原子事务中核对 progress.owner、处理锁并记录接管决定，缺少确认或仍有活动写入者时拒绝。如果 takeover journal 记录中断的新 owner，则先确认该恢复会话和所有写入者均已结束，再运行 `takeover-recover <change> --owner <new> --previous-owner <old> --stale-takeover-owner <journal-owner> --confirmed-no-live-writer true --evidence <状态核查>`；运行时按 journal ID 与 lock/progress 的部分完成状态审计后接管，不手动删除状态文件。Epic 可用 `--epic` 接管。

每次启动运行静态自检；新变更先由主 Agent 审计并提交已批准的 OpenSpec 输入，然后在干净分支上运行 `.agents/workflows/pipe-preflight.sh <change> bootstrap`。已有未提交工作或中途恢复时，先审计并记录现场，不能简单以非空 `git status` 否决恢复或覆盖用户改动。Architect 后运行 `.agents/workflows/pipe-preflight.sh <change> spec-gate` 和 `openspec validate <change> --strict --no-interactive`。不满足门槛就记录 `failed`，停止写入。

## 2. 派发协议

主 Agent 使用当前宿主**原生**子 Agent：Codex 协作子 Agent、Claude Code Agent、OpenCode Task/subagent。子 Agent 不得继续派生 Agent；阶段和工作范围由当前主 Agent 统一调度。派发前核对角色所需读、写、shell、网络能力和宿主实际权限；缺能力或无法保证 CR 只读时停止。若宿主不能硬限制文件范围，主 Agent 必须在派发前后记录工作区快照并审计差异；无法排除越权写入时拒收结果。prompt 自我约束不能当作宿主权限批准。

每个派发请求包含 `change/Issue`、阶段/任务 ID、规格/设计路径、公共角色文件、允许修改路径或只读要求、起始 HEAD/工作区快照、验收检查、禁止 Git 写入和回报格式。并行写入角色的文件范围不得重叠；同一 worktree 的跨 Rust/Vue 写入按 Rust→Vue 顺序。派发前用 `progress-cli.js phase/task ... running` 落盘，并记录宿主 Agent ID、attempt 与所有权。

子 Agent 统一回报：

```text
STATUS: DONE | NEEDS_PARENT_DECISION | FAILED
TASK: <task-id>
FILES: <实际读写路径；只读角色写 none>
EVIDENCE: <命令/退出码、差异、规格场景或审查证据>
QUESTION: <仅 NEEDS_PARENT_DECISION 填写；说明依据、候选方案和影响>
NEXT: <建议的下一步>
```

收到结果，主 Agent 核对 HEAD、index、授权路径和起始工作区快照。CR/Verify 写入源码或规格使本轮失败。问题或缺失证据不能伪装为 `DONE`。Dev/Tester 的合规差异由主 Agent 按授权路径提交，并记录 SHA；工作区原有差异先区分用户改动，不覆盖或误提交。

## 3. 阶段与门禁

| 阶段 | 执行者 | 通过条件 |
|---|---|---|
| bootstrap | 主 Agent | Issue、分支、worktree、proposal/specs、自检及 Git 基线成立 |
| architect | 原生 Architect 子 Agent；主 Agent 核对 | design/tasks 完整，domain 属于 backend/frontend/both/docs/spec/infra，权限/验证计划明确 |
| spec-gate | 主 Agent | design/tasks/specs 存在，OpenSpec strict validate 成功 |
| dev | 原生开发/流程角色 | 按 tasks 与授权范围完成，实现和必要测试落地，主 Agent 审计并提交 |
| tester | 原生 Tester 子 Agent | 覆盖相关 scenario，必要测试和冒烟有真实退出码，主 Agent 审计并提交 |
| cr | 独立只读 CR 子 Agent | 对照规格/设计审查 diff；无 blocker/major，主 Agent 核对只读快照 |
| verify | 原生只读 Verify 子 Agent 或主 Agent 直接执行 | 全部适用命令在当前 HEAD/源码快照成功，逐项记录退出码 |
| integrate | 主 Agent | 归档、提交、同步、推送、PR、required CI、合并、远端核对、清理 checkpoint 逐项成立 |

阶段成功必须满足运行时为该阶段定义的证据字段：bootstrap 记录门禁命令；architect 记录 `design.md` 与 `tasks.md`；spec-gate/Tester 记录成功命令；Dev 记录提交 SHA；CR 记录 `crResult=pass` 和源码指纹；Verify 成功时把 `node .agents/tools/pipe-native/source-fingerprint.js` 的 JSON 完整写入主仓 `.agents/runs/<change>/source-manifest.json`，并用 `phase ... verify succeeded --source-manifest <该文件> --command-evidence <verify-commands.json>` 传入版本、SHA 与排序 manifest；命令证据 JSON 对每条 `expected-command-id` 记录 `exitCode: 0`、相同验证 HEAD、源码指纹和规格指纹。另记录完整验证基线。不能用普通说明文字替代字段或退出码。

Architect 可细化设计和任务，不扩大已批准范围。开发/测试按 `tasks.md` 依赖推进，每项完成才由主 Agent 勾选。CR 的 blocker/major 必须含 `file + issue + specReference + suggestion`；另查跨模块状态语义、竞态与串扰、网络与离线判定三项，不适用注明。CR 有问题就按文件所有权派 Dev 修复并复审；最多三轮，仍不通过则挂起交用户。Tester/CR 后的源码变化使旧 Verify 失效。

Verify：代码域按适用范围依序运行 `cargo check`、`cargo test`、`npm run test`、`npm run build`、`openspec validate <change> --strict --no-interactive`；`docs/spec` 核对文档一致性和 OpenSpec；`infra` 运行涉及的 Node `--check`、shell `bash -n`、原生入口自检、适用工作流回归与 OpenSpec，跳过无关业务编译。搜索联动改动还须逐项覆盖单源换源、跨 kind 隔离、网络错误与空结果的离线判定。每步记录命令、退出码、HEAD 与输出摘要；失败即停，不能集成。验证前后比较 HEAD、源码和规格快照，只允许白名单构建产物变化。

## 4. 主 Agent 决断

`NEEDS_PARENT_DECISION` 先由主 Agent 判断。已批准 PRD/OpenSpec 或用户授权内的实现选择、重试、重派、CR 修复和验证修复，可直接答复并用 `progress-cli.js decision` 记录依据，不要求用户重复确认。失败采用有界 `retry / reroute / escalate / abort`，记录 attempt 和 CR 轮次。通过宿主消息或续派工具答复原 Agent；失活时重新派发并附决定。

产品行为歧义、规格冲突、范围变化、无法可靠判断、三轮 CR 未过或反复验证失败时，写挂起原因、候选方案与影响，向用户询问；得到答复后先更新权威规格，再恢复受影响阶段。子 Agent 的宿主文件/命令/网络权限提示仍由宿主机制处理，主 Agent 的技术答复不是用户的宿主权限批准。

## 5. 集成 checkpoint

Verify 与每次集成检查都运行 `node .agents/tools/pipe-native/source-fingerprint.js`，并记录输出中的 `fingerprintVersion`、`fingerprint`、`manifestSha256` 与 `manifest`。通过 `--source-manifest` 载入时 CLI 将输出的 `fingerprint` 映射到进度证据字段 `sourceFingerprint`；checkpoint 的 typed evidence 同样包含完整四字段组。v1 对 Git worktree 的 `git ls-files --cached --others --exclude-standard -z` 路径集合按 UTF-8 字节升序排序，逐项记录规范 `/` 相对路径、类型（普通文件/符号链接/已删除）和内容 SHA-256；指纹为 `SHA256("pipe-source-fingerprint/v1\\0" + JSON.stringify(manifest))`。排除任一路径组件为 `openspec`、`.agents/runs`、`.worktrees`、`node_modules`、`target`、`dist`、`coverage` 的条目，因 OpenSpec 有独立规格指纹，构建输出和进度记录不属于源码。路径及内容都来自仓库顶层，因此从不同 cwd 或 linked worktree 调用结果一致；归档只能搬动 OpenSpec 文件，不改变源码指纹。跨宿主恢复必须用该命令复算，不得自行实现近似算法。

在启动 integrate 时以 `phase ... integrate running --source-fingerprint <verify-fingerprint>` 记录基线；每个集成 checkpoint 前重新计算源码指纹并与 Verify 指纹比对。源码有变化就拒绝 checkpoint 并使 Verify/Integrate 失效，重新验证后才继续。OpenSpec 归档可以更新规格指纹，但不能改变源码指纹。Verify 成功且 integrate 已进入 running 后，才允许写入集成 checkpoint。依次执行 `archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local`。每一步**先查事实、再执行、完成后立刻记录**，恢复时复用已证实结果。进度始终保存在主仓共享 `.agents/runs/`，即使 linked worktree 已删除，仍可落盘 cleanup 证据。完成时必须用 `checkpoint ... succeeded --evidence-json '<JSON>'` 提交类型化证据，源码指纹字段组为 `fingerprintVersion/fingerprint/sourceFingerprint/manifestSha256/manifest`，所有 checkpoint 绑定同一组值：archive 另含 `archivePath`；commit 含 `commitSha`；sync-main 含 `mainHead`；push 含 `remote/branch/head`；get-or-create-pr 含 `prNumber/prUrl/head`；wait-required-ci 含 `prNumber/head/requiredChecks/conclusion=success`；merge 含 `prNumber/mergeSha`；verify-remote 含 `prNumber/mergeSha/merged=true`；cleanup-local 含 `worktreeRemoved=true`。归档在 PR 之前；核对 active change 已消失且归档内容和 canonical spec 在 PR diff。PR 正文引用 `Closes #<issue>`。已有 PR 复用，required checks 未通过不能合并；远端已合并时只做远端核对和清理。冲突、CI 失败或状态不明时停下，保留现场，不能报告成功。

## 6. Epic

主 Agent 显式传入当前会话 owner，运行 `.agents/workflows/pipe-epic-preflight.sh <epic> <current-owner>`；脚本要求这个 owner 同时匹配共享主仓 `.agents/runs/<epic>/epic-progress.md` 与 lock，绝不从旧进度自动取得写入凭据。若属于旧会话，主 Agent 先核实写入子 Agent 已退出并显式 takeover。preflight 校验 dependsOn 无环与 sourceRevision，并从每个 Issue 的 GitHub 时间线重新读取关联 PR；只有同仓库且 `closingIssuesReferences` 明确包含该 Issue 的已合并 PR 才能提供完成事实。当前远端事实会刷新 Markdown 的 `done/remoteMerged` 状态，过期完成记录会回到 pending；仍为 `running` 的项保留该状态，不能自动重置或重复派发。被当前事实确认合并的项可跳过 OpenSpec 检查，其余活动项必须通过 `gh issue view`、完整 OpenSpec 文件检查和 `npx openspec validate <item> --strict --no-interactive`。调度器要求本轮生成且未过期的全量远端 facts，并以刷新后的 Markdown 依赖状态计算就绪集。Epic 记录 `.agents/runs/<epic>/epic-progress.md`，子变更各用自己的 `progress.md`。每批只挑依赖已满足的就绪项，最多三个且不超过宿主剩余 Agent 配额；每项独立分支和 worktree。主 Agent可并行派发互不重叠的子任务，不能运行 `run.js --epic` 或启动完整子 pipe 进程。

子变更完成须核对其 PR 已合并到 main，才解锁后继项；合并顺序符合 DAG。失败/挂起在进度中保留，恢复时核对远端事实，不重跑已合并项。两个 Epic 会话不能同时持有相同调度锁。`/pipe:epic:status` 仅读取 Markdown 与 GitHub 事实，不启动流水线。

## 7. 结果报告

向用户报告 change/Issue、已完成阶段与提交/PR、验证结果、当前 `success / failed / suspended`、剩余任务或需要用户判断的具体问题。不得把子 Agent 自报、旧状态文件、已排队 CI 或尚未核对的合并写成成功。
