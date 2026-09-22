## Why

GitHub Issue：`#129`（查漏筛选（#125）目前只在「打开面板/改勾选维度」时触发扫描）。用户手动补全了几首歌、或外部修改了文件夹内容后，希望**就地刷新**筛选结果，而不用关掉面板重开或来回改勾选。

## What Changes

- 缺失筛选面板头部增加**「刷新」按钮**（与「关闭」同行），点击后按当前目录/所选维度**重新发起扫描**，更新命中列表。
- 复用既有 `scanMissing` 状态机与过期守卫（进行中/失败/完成态保持不变，旧结果不覆盖新结果）。
- 扫描进行中点击刷新视为重新扫描（同现有重选维度语义）；面板关闭 / 未打开文件夹时不显示刷新入口。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `missing-fields-filter`: 在「性能与状态复位」requirement 增加「手动刷新重扫」行为——面板提供刷新入口，点击重新扫描当前目录/维度，旧结果不覆盖新结果。

## Impact

- Vue：`SongList.vue` missing 面板头部增加刷新按钮，复用已有 `retryMissingScan`/`scanMissing`；组件测试补刷新交互用例。
- 无 store / API / Rust / docs 语义变更（`scanMissing` 与 command 契约已存在）。
- 测试：`songlist.test.ts` 覆盖刷新重新触发扫描、扫描中/失败后刷新、旧结果被新结果替换。