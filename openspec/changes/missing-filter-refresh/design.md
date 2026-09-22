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

## Decisions

**D1：按钮放面板头部、「关闭」同行。**
`SongList.vue` 的 `.missing-panel-head` 现为「缺失字段 … 关闭」，在「关闭」左侧插入「刷新」按钮，复用 `.missing-close-btn` 视觉类。理由：面板头部是与扫描状态最接近的常驻位置，不被 checkbox 九宫格挤占。

**D2：点击调用既有 `retryMissingScan()`（→ `scanMissing()`），不再新建动作。**
`scanMissing` 读取当前 `folderPath` + 当前 `missingChecks`，内部 `++missingScanSeq` 作废在途旧扫描，天然满足「扫描中点击 → 作废旧结果、只反映最新」。无需新增 store 方法。备选「先清 missingByPath 再扫」被否——会产生结果间隙空态，且无益于竞态正确性（seq 守卫已够）。

**D3：刷新按钮与面板同生命周期（无需单独禁用逻辑）。**
按钮渲染在 `.missing-panel` 内，面板仅在 `missingFilterEnabled` 时显示（对应 spec「面板关闭/未打开文件夹时不提供刷新入口」）。扫描中点击刷新复用 scanned 置 `scanning` 状态流转，按钮不加 loading 态（与现有「关闭」「重试」按钮一致的最小 UI 改动）。

**D4：TDD。**
组件测试先行（`songlist.test.ts`）：刷新触发 `scan_missing` 重调、扫描中刷新后列表只反映最新结果、失败后点刷新即重试。断言复用 mockInvoke 计数与 resolve 控制，不新增 spec 测试以外的场景。

## Risks / Trade-offs

- [刷新期间用户改勾选维度] → `scanMissing` 内 `missingScanSeq` + `sameMissingChecks` 双重校验：改维度后新一轮 seq 变化，旧刷新响应作废，最终列表只反映最新勾选（既有 D 语义，spec 场景已覆盖）。
- [刷新按钮与「重试」按钮职责重叠] → 「重试」仅错误态出现、视觉标红强调恢复；「刷新」常驻做主动更新的通用入口。二者都指向 `scanMissing`，无状态分歧。

## Migration Plan

不适用——纯前端 UI 增量，无部署/回滚语义。

## Open Questions

无。