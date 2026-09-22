## Context

现有查漏筛选（missing-fields-filter，见 `openspec/specs/missing-fields-filter/spec.md`）已实现：`SongList.vue` 的缺失面板按勾选维度扫描并展示命中列表。扫描触发点目前只有「打开面板 `/openMissingFilter`」和「改勾选维度 `/setMissingChecks`」；store 已提供可复用的 `scanMissing()`（带 `missingScanSeq` 过期守卫，新扫描作废旧结果）。需求见 proposal.md——给面板增加常驻「刷新」按钮。

## Goals / Non-Goals

**Goals:**
- 用户不关面板即可按当前目录/维度俯时重扫，命中列表即时更新。
- 完全复用既有 `scanMissing` 状态机与过期守卫，不新增扫描语义。

**Non-Goals:**
- 不做自动定时刷新、不做「检测到外部改动自动重扫」。
- 不新增后端 command（`scan_missing` 契约已存在，见 design.md §10）。
- 不改 store / API / selectors。

## 变更域

**frontend**。纯 Vue UI 增量：只改 `SongList.vue` 模板 + `songlist.test.ts`，不做任何 Rust、store、API、docs 变更。依赖序上**无 Rust 前置**——`scanMissing` store 方法与 `scan_missing` command 契约均已存在（store/song.ts:388、api/songs.ts:30），可直接接入；因此本变更无需 backend 前置，可独立成立。

## 技术方案

### 数据流（复用现有，零新增状态）

```
[点击「刷新」] → retryMissingScan()            （SongList.vue，已有函数，见 :57）
              → scanMissing()                   （store，见 store/song.ts:388，默认 scanFn = Tauri 'scan_missing'）
                    读取当前 raw.folderPath + normalizeMissingChecks(raw.missingChecks)
                    ++missingScanSeq（作废在途旧扫描）
                    raw.missingScanState = 'scanning'（结果立即清空、显示扫描中）
                    → await invoke('scan_missing', { dir, checks })
                    → 响应落地前四重校验（D4 过期守卫）：
                       stillCurrent = folderPath===dir && missingScanSeq===mySeq
                                      && missingFilterEnabled && sameMissingChecks(checks)
                    → 满足则写 missingByPath/errors/state='done'；否则静默丢弃
```

刷新按钮只新增**一个渲染入口**，不新增任何 store 动作、字段或 selector。

## Decisions

**D1：按钮放面板头部、「关闭」左侧（修正）。**
`.missing-panel-head` 现为「缺失字段 … 关闭」（标签 + flex 头），在「关闭」左侧插入「刷新」按钮（`data-testid="missing-refresh-btn"`）。
⚠️ **不要复用 `.missing-close-btn` class**——`songlist.test.ts:341` 的 `w.get('button.missing-close-btn')` 要求该选择器唯一匹配，再给刷新按钮挂同名 class 会让既有断言因「multiple elements」直接挂掉。改为复用三按钮共享的统一样式块：给刷新按钮 class 加入 `.missing-filter-btn` 或连同 `.missing-close-btn/.missing-retry-btn` 一起并入现行的共享选择器（`SongList.vue:239` 三按钮共用同一段 padding/border/radius）。若不并入，则单独加一段等同的样式，另加 hover 态到 :251 的共享 hover 规则。理由：面板头部是与扫描状态最接近的常驻位置，不被 checkbox 九宫格挤占。

**D2：点击调用既有 `retryMissingScan()`（→ `scanMissing()`），不再新建动作。**
`scanMissing` 读取当前 `folderPath` + 当前 `missingChecks`，内部 `++missingScanSeq` 作废在途旧扫描，天然满足「扫描中点击 → 作废旧结果、只反映最新」。无需新增 store 方法。备选「先清 missingByPath 再扫」被否——会产生结果间隙空态，且无益于竞态正确性（seq 守卫已够）。

**D3：刷新按钮与面板同生命周期（无需单独禁用逻辑）。**
按钮渲染在 `.missing-panel` 内，面板仅在 `missingFilterEnabled` 时显示（对应 spec「面板关闭/未打开文件夹时不提供刷新入口」）。扫描中点击刷新复用 scanned 置 `scanning` 状态流转，按钮不加 loading 态（与现有「关闭」「重试」按钮一致的最小 UI 改动）。

**D4：竞态正确性 = 既有 `scanMissing` 过期守卫，零新语义。**
扫描落地前的四重校验（`folderPath===dir`、`missingScanSeq===mySeq`、`missingFilterEnabled`、`sameMissingChecks`，见 store/song.ts:404-408）同时覆盖三种竞态：
- 刷新进行中用户改勾选维度 → `setMissingChecks` 先 `++missingScanSeq` 再启动新扫描，旧刷新响应因 seq 不匹配被丢弃（spec「重新选择维度」场景）。
- 刷新进行中用户关闭面板 → `closeMissingFilter` 清态 + `++missingScanSeq`，旧响应不落地。
- 响应乱序（快速连点刷新）→ 每次点击都 `++missingScanSeq`，只有最新一次（seq 最大）能落地（spec「扫描中点击刷新」场景）。
刷新按钮即 `retryMissingScan`，与服务重试按钮调用同一入口，二者无状态分歧。

**D5：TDD，沿用既有 promise-resolve mock 模式。**
`songlist.test.ts` 已有四种可复用的测试基建（详见任务 1.1）：`mockInvoke.mockImplementation(async (cmd) => …)` 分派 `scan_missing` 并按 attempts 计数返回不同结果 / `new Promise((resolve) => { resolveScan = resolve })` 手动控制 resolve 时序 / 逐项取消维度测试 / `missing-*` 状态 beforeEach 复位。新增用例全部复用，不新增 mock 基建。断言以「点击后 `scan_missing` 被再次调用（attempts 计数）+ 命中列表只含最新结果」为准。

## Risks / Trade-offs

- [刷新期间用户改勾选维度] → `scanMissing` 内 `missingScanSeq` + `sameMissingChecks` 双重校验：改维度后新一轮 seq 变化，旧刷新响应作废，最终列表只反映最新勾选（既有 D 语义，spec 场景已覆盖）。
- [刷新按钮与「重试」按钮职责重叠] → 「重试」仅错误态出现、视觉标红强调恢复；「刷新」常驻做主动更新的通用入口。二者都指向 `scanMissing`，无状态分歧。
- [按钮 class 与既有测试选择器冲突]（**D1 修正点**）→ 若不处理，`get('button.missing-close-btn')` 因多元素匹配抛错，既有测试全挂。已列为 D1 硬约束，测试 1.1-④ 断言不归属刷新按钮。

## Migration Plan

不适用——纯前端 UI 增量，无部署/回滚语义。

## Open Questions

无。