## Why

MusicTag 的 V1 定稿信息分散在四份来源：`docs/V1-PRD.md`、`docs/design/design.md`（含 §10 Tauri command 契约）、`openspec/specs/`（含 archive）与记忆 `music-tag-v1-spec.md`。随着 V1 十一个子变更全部落地归档（song-save → cover-embed → lyrics-lrc → rename-sync → ux-settings → search-backend → search-ui），部分契约在实现中演进（新增 `search_source`/`pick_cover_file`/`read_cover_path`、`save_song` 扩参 `exportLrc`、取消独立 `embed_cover`、按需读取模型），但几份文档/记忆仍停留在早期拍板状态，出现陈旧描述（如已废弃的 `embed_cover` command 仍被列出）、矛盾与遗漏。本变更对四源做一致性复核，产出复核报告并修订，把文档对齐到实现后的真实状态，并规格化「复核 → 修订 → 验收」的可复用流程。不引入任何新的产品行为。

## What Changes

- 复核四源（docs/V1-PRD.md、docs/design/design.md、openspec/specs/、记忆 music-tag-v1-spec.md），逐条比对 Tauri command 契约、搜索联动（FR-8）、保存/封面/歌词语义与离线降级规则，找出陈旧、矛盾、遗漏点。
- 产出复核报告（修订前后的差异记录，作为本变更的验收依据）。
- 逐处修订：docs/design/design.md §10.3 command 契约表与 §7 多源架构、docs/V1-PRD.md 相关行、openspec/config.yaml 的 context（command 清单）、openspec/specs/* 主规格中陈旧 command 引用、记忆 music-tag-v1-spec.md。
- 修订后跑 openspec validate，保证 spec 仍通过校验。
- 归档时把修订同步回四源，保持「docs 权威、openspec 落地、记忆摘要」三者一致。

## Capabilities

### New Capabilities
- `spec-review`: 四源一致性复核 + 修订。验收以「复核报告 + 修订落地 + validate 通过」为准。

### Modified Capabilities
（无）

## 关联 Issue

GitHub Issue：`#52`（子变更 spec-review，Epic「项目基建初始化」总 Issue #48；分支提交 `feat(52): ...`、PR `Closes #52`）

## Impact

- 不引入新的产品行为；只修一致性/陈旧点。
- 修改范围：docs/V1-PRD.md、docs/design/design.md、openspec/config.yaml、openspec/specs/ 相关主规格、记忆 music-tag-v1-spec.md。
- 不涉及应用代码（src-tauri/、src/）改动。
- 本变更产出的复核报告与修订记录可作为后续子变更的「规格一致性基线」，防止再次漂移。
