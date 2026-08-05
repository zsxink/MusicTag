# ui-editor-layout Specification

## Purpose
TBD - created by archiving change ui-editor-layout. Update Purpose after archive.
## Requirements
### Requirement: 文件名字段置顶

编辑表单字段顺序 SHALL 将「文件名」行置于最上方（歌名之前）。

#### Scenario: 文件名在首位

- **WHEN** 渲染 `FieldGrid`/`FieldList`
- **THEN** 字段标签顺序为：文件名、歌名、作者、专辑、专辑作者、音轨号、年份、流派

#### Scenario: 文件名行样式不变

- **WHEN** 渲染文件名行
- **THEN** 仍为 `kind="file"`（只读 mono 或可编辑改名行）形态，样式与行为不因位置改变

### Requirement: 歌词输入框高度加倍

歌词 textarea SHALL 将默认高度从 180px 提升至 360px（保留用户可手动拉高的 `resize: vertical`）。

#### Scenario: 默认高度

- **WHEN** 打开编辑表单
- **THEN** `.lyrics-box` 的 `min-height` 为 360px（原 180px 的两倍）

### Requirement: 左栏高度锁定窗口可用区

左栏文件浏览器 SHALL 恒等于窗口可用区高度，右栏编辑区内容超高（如搜索候选展开）时仅右栏内部滚动，窗口不整体变高、左栏不被顶起。

#### Scenario: 候选展开左栏不变

- **WHEN** 右栏搜索候选区展开、内容超高
- **THEN** 左栏高度不变（= 窗口可用区）、右栏出现滚动条、窗口整体高度不增加

#### Scenario: 空态/正常态不受影响

- **WHEN** 未选中歌曲（右栏空态）或正常编辑
- **THEN** 左栏、右栏、窗口高度行为与现状一致（无回归）

