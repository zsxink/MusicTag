import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock @tauri-apps/api/core.invoke，验证 invokeCommand 透传
// （client.ts 保留 `import { invoke } from '@tauri-apps/api/core'`，改源会静默失效 mock）。
const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { invokeCommand, listenEvent } from './client'

describe('invokeCommand — invoke 类型安全封装', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('无参数时透传 cmd（args 为空由 invoke 默认 {}）', async () => {
    mockInvoke.mockResolvedValue('ok')
    await expect(invokeCommand<string>('ping')).resolves.toBe('ok')
    expect(mockInvoke).toHaveBeenCalledWith('ping', undefined)
  })

  it('透传 cmd 与 args，返回类型化结果', async () => {
    const payload = { songs: [], source_stats: [] }
    mockInvoke.mockResolvedValue(payload)
    const result = await invokeCommand<{ songs: unknown[]; source_stats: unknown[] }>(
      'search_song',
      { title: 'x', artist: 'y' },
    )
    expect(mockInvoke).toHaveBeenCalledWith('search_song', { title: 'x', artist: 'y' })
    expect(result).toEqual(payload)
  })
})

const mockListen = vi.fn()
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => mockListen(...args) }))

it('事件订阅透传 handler 并返回相同 unlisten', async () => {
  const unlisten = vi.fn()
  const handler = vi.fn()
  mockListen.mockResolvedValue(unlisten)
  const result = await listenEvent('folder-changed', handler)
  expect(mockListen).toHaveBeenCalledWith('folder-changed', handler)
  expect(result).toBe(unlisten)
  result()
  expect(unlisten).toHaveBeenCalledOnce()
})
