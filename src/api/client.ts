// Tauri IPC 统一入口（design.md §10 分层规范：前端 api/client 唯一 invoke 透传层）。
//
// 后续所有 command（list_songs / open_song / save_song / search_song ...）一律
// 经由 invokeCommand<T>(cmd, args) 调用，保证类型安全透传。
//
// 硬约束：**必须保留 `import { invoke } from '@tauri-apps/api/core'`**——
// editor.test.ts / client.test.ts 的 `vi.mock('@tauri-apps/api/core')` 依赖该 import 源，
// 改源（直接裸 invoke / 改名）会静默失效 mock，测试跑真实 invoke 即崩溃。
import { invoke } from '@tauri-apps/api/core'

/** 泛型封装 Tauri invoke：透传 cmd 与 args，返回类型化结果。 */
export function invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args)
}
