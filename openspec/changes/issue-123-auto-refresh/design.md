# Issue #123：目录监听与列表刷新设计

## 领域、范围与依赖

Domain: `both`。顺序为文档契约同步 → Rust → Vue → Tester → CR → Verify → Integrate。

规格依据为本变更 `specs/folder-list/spec.md` 的五个 scenario。自动刷新观察当前目录及全部后代；列表继续复用现有递归扫描与五种受支持格式，不增加目录树、批量编辑或自动写盘。Issue 复现提及右键「刷新」，当前源码未发现该入口；Leader 已确认补齐可执行的手动刷新在 Issue 范围内，并负责在 Dev 前修正规格中的「existing manual refresh」表述。

## 当前实现与问题边界

CodeGraph 调用路径：

- `SongList.openFolder` → `requestFolder` → `activateFolder` → 注入的 `api/songs.listSongs` → `api/client.invokeCommand` → `commands/folder.list_songs` → `WalkDir` → `meta.is_audio_file` / `reader.read_summary`。
- 启动为 `SongList.onMounted` → `getLastDir` → `initLastDir` → 相同 `activateFolder` 链路。
- dirty 换目录经 `resolvePending` 后才执行 `activateFolder`；取消不激活新目录。
- `activateFolder` 会清空选择、编辑快照、候选、改名草稿与查漏状态；适合换目录，不能作为自动或手动列表刷新的实现。
- `list_songs` 每次调用都直接递归读磁盘，未发现列表缓存；现有代码缺少持续目录监听与独立刷新入口，不能据此声称已复现 Issue 中所有历史缓存现象。
- 当前异步列表结果只用目录字符串守卫；A → B → A 时旧 A 结果可覆盖新 A。查漏扫描已有序号守卫，应继续复用。

## D1：后端监听与分层

新增 `notify` 8.x（官方当前版本 8.2.0），使用 `RecommendedWatcher` 的递归模式。默认平台实现覆盖 macOS、Windows、Linux 的本地目录；构造或注册失败时尝试 `PollWatcher`（约 1 秒间隔，元数据比较，不读取音频全文），仍失败则返回中文错误。网络盘等原生事件可能静默缺失的文件系统是平台限制；不引入无条件全库周期读标签。

`service/folder_watch.rs` 持有 watcher、当前原始目录字符串、单调 `watch_id` 和可释放的资源；接收线程安全的通知回调，不依赖 Tauri。`commands/folder.rs` 增加薄 command，负责接收 managed state / AppHandle，将 service 通知转为 Tauri 事件。`lib.rs` 注册 managed state 与 command，进程退出释放 watcher；业务 I/O 与事件分类放在 service。

只保留一个当前目标。每次切换或停止先作废旧 generation，再释放旧 watcher；新的建立失败也不能继续监听旧目录。状态更新在一个互斥区内串行完成，低于已见 `watch_id` 的迟到请求返回成功但不改变当前目标。回调只发其绑定 generation 的消息，前端进一步过滤。

递归观察包括新增子目录、整目录移入/移出、目录改名、音频新增/删除/改名和音频原子替换。事件只用于提示“重新读目录”，不根据增量拼接列表。忽略 Access / 纯读取事件，避免 `list_songs` 的读操作形成刷新循环；Create / Remove / Modify / Any / Other 类相关事件均使目录失效。不能用 `path.is_file()` 或只匹配音频后缀过滤删除/目录事件：路径可能已经消失，目录移动可能带入多首音频。若确有路径范围过滤，使用路径组件匹配根目录或其后代，不用字符串前缀。

运行中监听错误同样发带 generation 的通知，触发一次补读并显示非阻断提示；后续手动刷新尝试重新建立监听。根目录被移走/删除时可获得的事件触发补读为空列表，保留打开路径与编辑草稿；不存在的目录恢复后可经手动刷新重新建立监听。规格未要求自动追踪被移动根目录的新位置。

## D2：IPC 契约

新增一个 command，停止复用同一接口，避免独立 stop 请求晚到时误停新目录：

| 接口 | 参数 / 返回 | 语义 |
| --- | --- | --- |
| `watch_folder(dir, watch_id)` | `Option<String>, u64 → Result<(), String>` | `Some(dir)` 替换递归监听，`None` 停止；generation 单调递增，较旧请求不生效 |
| `folder-changed` event | `{ dir: string, watchId: number, error: string \| null }` | 普通变更 error 为 null；监听错误包含中文原因；只用于失效通知 |

Rust event struct 在 `model.rs` 使用 camelCase serde，与 `api/types.ts` 一致。`api/client.ts` 是唯一 Tauri IPC 入口：保留原 `invoke` import，新增类型化 `listen` 透传和 `UnlistenFn` 类型；`api/songs.ts` 封装 watch command 和事件订阅。store/组件不直接 import Tauri。新增 `src-tauri/capabilities/default.json`，只给 `main` 窗口授予 `core:event:allow-listen` 与 `core:event:allow-unlisten`，使 Tauri ACL 允许订阅和清理事件监听；不授予 emit 权限。

新增 command 后注册数为 17。同步 PRD §7、design §10.3、`openspec/config.yaml` 的完整 command 清单，以及 `src/styles/command-contract.test.ts` 的明确数量断言；command 放在已有 `folder.rs`，不必增加守卫读取的命令文件清单。

## D3：前端生命周期与目录切换

在 `store/song.ts` 提供可注入 IPC 依赖的监听启动/停止动作，由 `SongList` 挂载与卸载调用。监听订阅只建立一次：先 await 事件订阅成功，再开始 watch，然后执行一次当前目录补读，消除首次扫描至 watcher 建立之间的漏报窗口。订阅未完成就卸载时，迟到的 unlisten 立即执行；停止时取消 timer、使 generation/在途结果失效，并以更大的 watch_id 调用 `watch_folder(null, id)`。

实际 `activateFolder` 每次激活（包括同路径重新打开）递增 `folderEpoch`，只有完成 dirty 门禁的激活才改变监听目标。取消目录选择或取消未保存弹窗不切换监听。切换时立即作废旧目录队列与 timer，改变 watch generation，开始新目标监听；旧目录回调、旧 watch command 响应、旧列表结果均不能作用于新目录。目录路径保持现有绝对路径文本，不因后端 canonicalize 改变展示或路径匹配。

启动目录恢复与用户手动打开共用此链路。`getLastDir` 迟到时，如果用户已激活其他目录或组件已卸载，不再恢复旧目录；启动失败清理必须使用 epoch 守卫，不能仅比较目录字符串。

手动刷新重新尝试监听并立即请求列表；监听建立失败不阻断目录读取。订阅/监听失败有独立、非模态的中文提示，刷新/再次打开可重试，不产生 unhandled rejection。普通列表读取失败保留上次列表和编辑态，展示可重试提示；现有 `list_songs` 对遍历坏条目继续跳过的兼容语义保留。

## D4：独立刷新、合并与竞态

新增 `refreshFolder` / 调度动作，复用 `listSongs`，每次调用都实际读取磁盘。自动事件使用尾沿约 250 ms debounce，持续事件设约 1 秒最长等待，避免同次复制/原子写产生重复全库扫描，也避免事件持续不断时永远不刷新。手动刷新绕过等待。

一个 folderEpoch 最多一个目录扫描在途。扫描过程中收到更新只记一个 pending reread；本次结束后按最新目录再读一次。扫描请求保存 `{dir, folderEpoch, requestSeq}`，只有仍当前的结果才落到 `songs`；收到更新并排入补读后，较旧结果不能回写覆盖新结果。旧 epoch 的任务即使完成也不能清除新 epoch 的 in-flight 标记或 pending 标记。禁止在每次 watcher 回调中无限并发 invoke。

换目录 initial load 也使用同一序号/调度约束，避免首次慢读覆盖监听触发的新读。目录成功加载才持久化 last_dir，保留现有规则；列表刷新不重复持久化、不清空编辑区。

刷新只更新 `songs` 和列表/监听错误态，保留搜索词、当前选择、`current` / `original` / dirty、save 状态、改名草稿、歌词/封面候选与会话离线标记。即使外部删除或改名了选中音频，也不静默丢弃其编辑草稿；列表反映磁盘结果，编辑区保留原路径，后续保存按现有 I/O 错误机制反馈。文件系统通知不会触发选歌、自动搜索或保存。

查漏筛选启用时，列表成功刷新后用当前维度重新执行 `scanMissing`；先作废旧 scan sequence，防旧查漏结果覆盖刷新后的目录快照。查漏筛选开关/维度与搜索词保留。仅当当前目录快照的缺失扫描状态为 `done` 时应用查漏命中筛选；处于 `idle`、`scanning` 或 `error` 时显示完整歌曲列表，避免刷新等待或读取失败时列表暂时/持续变空。保存或内部改名产生的事件同样经过合并；不改已有保存/改名业务流程。

## D5：手动入口

`SongList.vue` 为列表区域补齐右键菜单「刷新」，调用相同 `refreshFolder`。使用 HTML 按钮，支持键盘触发、Esc 关闭及外部点击关闭；无目录时禁用。菜单只提供本需求的刷新动作，刷新过程中允许请求再读但不启动并发扫描。提示使用中文，控件不遮挡既有打开目录、搜索或查漏入口。

## 文档同步点（Leader 在 Dev 前完成）

- `docs/V1-PRD.md` §3 交互规则「保存后不跳转、不刷新列表焦点」：补充文件系统列表刷新保留选择与编辑态，避免把“焦点不刷新”误读为“不重读列表”。
- PRD §4 FR-1（当前行 66–75）：添加当前目录及后代递归监听、目录切换跟随、手动右键刷新及失败保留编辑态的行为；FR-2 的查漏/列表规则同步刷新后复扫语义。
- PRD §7 技术选型（当前行 330 附近）与「Tauri command 全量」文件类（当前行 349）：增加 notify、`watch_folder(dir, watch_id)` 与事件契约说明。
- PRD §8 验收清单（当前行 363 起）：添加五个 scenario 和 dirty 保持、过期结果、查漏复扫验证。
- `docs/design/design.md` §4 左侧栏（当前行 131）：增加手动刷新入口和非阻断错误提示；§10.0 api/client IPC 范围补充 event listen/unlisten、Rust service 增加无 Tauri 的目录观察职责。
- design §10.2 store 职责（当前行 290 起）：增加 list-only 刷新、epoch、合并调度与监听生命周期；§10.3 command 表（当前行 362 起）增加 watch command，表后记录事件字段；§10.4 落位说明增加 folder_watch service 与 api/watch 封装说明。
- `openspec/config.yaml` 当前行 25：加入 command，注册总数改为 17；同步列表刷新约束。

## 验证矩阵与落位

| Spec scenario / 边界 | 验证证据 |
| --- | --- |
| New audio file appears in the current folder | `src-tauri/tests/folder_watch.rs` TempDir 建监听后新增文件，等有界通知，再 `list_songs` 验证；Vue 注入事件后列表出现 |
| Audio file changes in a descendant folder | 新建深层目录与音频、删除、改名、目录整体移动，收到通知后真实重读验证路径集合 |
| Open folder changes | Rust watcher 切换后旧目录不再有效；Vue A → B、A → B → A、迟到事件/列表/watch command、dirty 取消保留旧目标 |
| Manual refresh | API 精确 command 参数；组件右键「刷新」进入相同 store 动作；不依赖 watcher 通知仍重读 |
| debounce / scan race | fake timers 验证重复事件合并、最长等待、在途更新最多排一个补读、旧 epoch 不回写 |
| editor compatibility | dirty/current/original/pendingRename/候选/搜索词/保存失败状态保留；选中项被移走仍保留草稿；刷新不触发联网或写盘 |
| watcher failure / lifecycle | 注册失败、通知错误、订阅迟到卸载、切换失败、卸载停止、旧 generation 过滤、手动重试 |
| missing filter | 刷新后复扫、维度保留、旧 scan 不覆盖、关闭筛选后不启动复扫；`idle`/`scanning`/`error` 时展示完整列表，`done` 时按命中筛选 |

Rust 测试外置 `tests/folder_watch.rs`；纯事件分类测试可外置 `tests/folder_watch_tests.rs`。测试使用 `tempfile`、已有 `tests/common` fixture，不新增外部生成程序依赖。业务断言前确认 fixture 存在并可被既有 reader 读取；异步观察使用通道/有界 deadline，禁止无限 sleep。本地平台验证真实 watcher；Linux CI 将运行相同测试，Windows 真机行为未实测时据实报告。

前端测试与被测文件同目录：`src/api/client.test.ts`、`src/api/songs.test.ts`、`src/store/song.test.ts`、`src/components/songlist.test.ts`，必要兼容回归在 `src/components/app.test.ts`。事件 mock 集中于 `@tauri-apps/api/event`，保留 invoke mock 源。

Verify 以当前 CI 为准执行 Node 24 / `npm ci` / `npm run build` / `npm run test` / OpenSpec 全量 strict validate / Rust stable `cargo check --all-targets` 与 `cargo test --all-targets`。Ubuntu CI 安装既有 Tauri 系统包和 ffmpeg，无新系统依赖。CR 独立只读，重点检查回调生命周期、所有序号边界、保存与查漏串扰及契约同步。完整 pipe 的预检、源码指纹与集成由 Leader 管理。

## 风险与恢复

原生事件在部分网络文件系统及极大目录不保证完整；构造失败的 PollWatcher 后备和手动刷新提供恢复路径，不宣称静默丢失事件已在所有文件系统验证。递归扫描成本随目录大小增加，因此必须合并与串行；不改变文件读写或数据格式，无迁移。Watcher 只读，可释放资源后恢复原有手动读取路径。

参考依据：[notify 8.2 官方说明](https://docs.rs/notify/8.2.0/notify/)（递归、平台限制与 PollWatcher 后备）、[Tauri event API](https://v2.tauri.app/reference/javascript/api/namespaceevent/)（订阅返回 unlisten）。
