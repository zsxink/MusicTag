// @vitest-environment node
// 分层守卫测试（spec: 组件零 invoke 直呼）：
// 组件不得直接调用 `@tauri-apps/api/core` 的 invoke，IPC 一律经 `api/songs.ts`
// 类型化封装注入（design.md §10 前端 api 层）。本测试扫描 components/ 下全部
// .vue 源码，禁止出现 `@tauri-apps/api/core` import —— 防止后续子变更回归到
// 「组件裸调 invoke」的旧结构（v1-refactor-layering 的头条不变量）。
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = fileURLToPath(new URL('.', import.meta.url))
const vueFiles = readdirSync(dir).filter((f) => f.endsWith('.vue'))

describe('components 分层规范 — 组件零 invoke 直呼（spec: IPC 一律经 api/songs.ts）', () => {
  it('任何 .vue 组件不得直接 import @tauri-apps/api/core（invoke 透传只允许在 api/client.ts）', () => {
    const offenders = vueFiles.filter((f) =>
      readFileSync(`${dir}${f}`, 'utf8').includes('@tauri-apps/api/core'),
    )
    expect(offenders).toEqual([])
  })
})
