# readme-product-copy Specification

## Purpose

README 以产品视角、简约地介绍 MusicTag，突出「是什么、能做什么」，去除非功能约束措辞与 AI 味。

## MODIFIED Requirements

### Requirement: README 产品视角介绍

README SHALL 以产品视角介绍 MusicTag：定位为「为本地音乐文件补全元数据的跨平台桌面应用」，功能特性用清单式枚举用户能做什么。

#### Scenario: 定位句

- **WHEN** 阅读 README 开头
- **THEN** 有一句产品定位（跨平台桌面应用 + 为本地音乐文件补全元数据），而非技术约束罗列

#### Scenario: 功能枚举

- **WHEN** 阅读「功能特性」节
- **THEN** 列出用户能做的能力：支持格式（FLAC/MP3）、编辑音乐标签、编辑封面、编辑歌词（含导出 .lrc）、自动搜索（选中即搜缺失项、多源并发、候选手动点选写入）

### Requirement: 去除非功能约束措辞

README SHALL NOT 出现「目标播放器」「无批量」「无在线曲库」「无账号」等对外的非功能约束措辞。

#### Scenario: 无约束措辞

- **WHEN** 全文检索 README
- **THEN** 不出现「目标播放器」「无批量」「无在线曲库」「无账号」

### Requirement: 保留仓库文档节

README SHALL 保留「技术栈」「常用命令」「文档入口」「协作流程」四节（仓库文档属性），不被产品文案覆盖。

#### Scenario: 仓库文档完整

- **WHEN** 阅读 README 后段
- **THEN** 技术栈/常用命令/文档入口/协作流程四节仍存在
