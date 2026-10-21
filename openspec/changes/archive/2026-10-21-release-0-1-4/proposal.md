# 发布 v0.1.4

## 背景

`v0.1.3` 发布后，项目新增了基于 GitHub Releases 的稳定版更新检查、Echo 播放器推荐，并修复了 PostCSS 间接依赖 nanoid 的安全版本。现需复核这些变更，整理发布说明并准备 `v0.1.4`。

GitHub Issue：#165

## 范围

- 复核 `v0.1.3` 之后的用户可见更新检查变更（PR #160），检查其实现与测试是否满足已批准规格。
- 汇总自 `v0.1.3` 起的用户可见变化，更新 README 发布说明和版本徽章。
- 将应用版本元数据统一更新至 `0.1.4`。
- 使用现有 tag-triggered release workflow 创建 `v0.1.4` draft Release，并核对 CI 构建结果。

## 非目标

- 不增加新的产品功能。
- 不扩展自动下载或安装更新能力。
- 不调整与发布无关的功能或开发流程。

## 验收

- Tauri、Cargo、npm 与 README 的版本均为 `0.1.4`。
- README 发布说明准确概括更新检查等自 `v0.1.3` 以来的用户可见变化。
- 对更新检查完成独立复核；确认的问题在规格内修复并复审，或记录无 blocker/major。
- OpenSpec 全量校验与 CI 对齐验证通过。
- 合并后 `v0.1.4` tag-triggered workflow 成功，draft Release 与构建产物可核对。
