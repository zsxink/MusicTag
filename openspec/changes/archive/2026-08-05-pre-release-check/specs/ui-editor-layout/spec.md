# ui-editor-layout Specification

## Purpose

编辑界面滚动修复：`.editor-slot` 补 `display: flex`，让编辑区超高时右栏内部可滚动。

## ADDED Requirements

### Requirement: 编辑界面滚动修复

`src/App.vue` `.editor-slot` SHALL 补 `display: flex`，让 `.editor` 的 `flex: 1 1 auto` + `.editor-body` 的 `overflow-y: auto` 生效，歌词框在窗口高度不足时可滚动查看。

#### Scenario: 编辑界面可滚动

- **WHEN** 窗口高度不足、编辑表单（字段 + 歌词框）超高
- **THEN** 编辑区出现滚动条，可滚动看到歌词框
