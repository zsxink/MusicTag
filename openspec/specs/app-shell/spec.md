# app-shell Specification

## Purpose
TBD - created by archiving change v1-skeleton-tauri. Update Purpose after archive.
## Requirements
### Requirement: Tauri 2 应用可启动
应用 SHALL 以 Tauri 2 + Rust 为外壳，前端采用 Vue 3 + Vite + TypeScript，支持 `npm run tauri dev` 启动显示窗口。

#### Scenario: 启动开发窗口
- **WHEN** 执行 `npm run tauri dev`
- **THEN** 打开一个可显示的桌面窗口，前端壳正常渲染

#### Scenario: 工程构建通过
- **WHEN** 执行 `cargo check`（src-tauri）与 `npm run build`（前端）
- **THEN** 两者均无错误，空壳可正常编译打包

### Requirement: 前端 invoke IPC 封装入口
前端 SHALL 提供 Tauri `invoke` 的统一封装模块，作为后续所有 command（list_songs/open_song/save_song 等）的类型安全调用入口。

#### Scenario: invoke 封装可导入
- **WHEN** 前端代码导入该封装模块
- **THEN** 能调用 `invoke` 且类型安全地透传参数与返回

### Requirement: 深色为默认主题的地基
设计语言 token SHALL 以深色为默认（`:root` 缺省），浅色跟随系统 `prefers-color-scheme`，语义变量（`--bg`/`--panel`/`--text`/`--accent` 等）在全局样式定义。

#### Scenario: 深色默认渲染
- **WHEN** 系统未声明浅色偏好时应用启动
- **THEN** 界面使用深色 token（`--bg:#12161A` 等），无启动闪白

#### Scenario: 浅色跟随系统
- **WHEN** 系统偏好为浅色且用户未手动选择主题
- **THEN** 界面使用浅色 token（`--bg:#F4F4F1` 等）

### Requirement: Open folder from the app bar
The application SHALL expose a single compact folder-icon button in the global app bar for “打开文件夹”. The button SHALL provide “打开文件夹” as its accessible name and hover title. Activating it SHALL use the existing native folder picker, route the selected directory through the existing unsaved-change guard, and load the selected folder's songs. Cancelling the picker SHALL leave the current folder unchanged.

#### Scenario: Choose a folder
- **WHEN** the user activates the app-bar folder button and chooses a directory
- **THEN** the app loads that directory through the existing folder transition flow

#### Scenario: Cancel folder selection
- **WHEN** the user cancels the native folder picker
- **THEN** the current directory and song list remain unchanged

### Requirement: Do not display the current path in the app bar
The application SHALL NOT display the current folder path in the global app bar.

#### Scenario: Folder is open
- **WHEN** a folder is currently loaded
- **THEN** the app bar shows the folder-open action without a path label or path value

### Requirement: Keep the sidebar focused on browsing
The sidebar SHALL NOT contain a duplicate folder-open button; its search and missing-field controls remain available.

#### Scenario: Browse songs
- **WHEN** the user views the sidebar
- **THEN** search and missing-field controls remain available without a folder-open button

