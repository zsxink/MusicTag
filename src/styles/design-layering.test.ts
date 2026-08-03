// @vitest-environment node
// 分层规范入定稿文档守卫（spec: 分层规范 SHALL 同步进 docs/design/design.md §10，
// 使分层与测试放置成为后续子变更的架构约束）。
// 结构测试：直接扫描 docs/design/design.md 源码，断言 §10 包含
// Rust commands/service/model、前端 api/store/lib/components 的目录分层规范、
// 测试放置约定与未来子变更落位说明（v1-cover-embed / v1-lyrics-lrc /
// v1-search-backend / v1-search-ui）。防止「文档与落地不一致」回归——
// 后续子变更的 Architect 读取 design.md 时必须能看到这些约束。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const design = readFileSync(
  fileURLToPath(new URL('../../docs/design/design.md', import.meta.url)),
  'utf8',
)

describe('design.md §10 — 分层规范入定稿文档（spec: 目录分层 + 测试放置 + 未来子变更落位）', () => {
  it('包含 Rust 侧分层目录（commands/service/model 与 tests 外置）', () => {
    expect(design).toMatch(/commands\//)
    expect(design).toMatch(/service\//)
    expect(design).toMatch(/model\.rs/)
    expect(design).toMatch(/src-tauri\/tests\//)
  })

  it('包含前端侧分层目录（api/store/lib/components）', () => {
    expect(design).toMatch(/api\//)
    expect(design).toMatch(/store\//)
    expect(design).toMatch(/lib\//)
    expect(design).toMatch(/components\//)
  })

  it('包含测试放置约定（文件 I/O 集成测试外置 + 纯逻辑单测 inline）', () => {
    expect(design).toMatch(/集成测试/)
    expect(design).toMatch(/tests\/common\//)
    expect(design).toMatch(/inline|内联/)
  })

  it('包含未来子变更的 service/api 落位说明', () => {
    expect(design).toMatch(/cover\.rs|lyrics\.rs|searcher/)
    expect(design).toMatch(/api\/search\.ts/)
  })
})
