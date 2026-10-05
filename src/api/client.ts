// Tauri IPC 统一入口：保留 core 的 invoke 源，现有测试依赖该 mock 入口。
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { EventCallback, UnlistenFn } from '@tauri-apps/api/event'

export type { UnlistenFn } from '@tauri-apps/api/event'

/** 泛型封装 Tauri invoke：透传 cmd 与 args，返回类型化结果。 */
export function invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args)
}

/** 类型化事件订阅；调用方持有并释放返回的 unlisten。 */
export function listenEvent<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  return listen<T>(event, handler)
}
