// 纯主题逻辑（design.md §10 lib 层）：无 Vue / Tauri / DOM 依赖。
// parseTheme：校验 localStorage 持久化值 → 'dark' | 'light' | null（非法/缺失 → null = 跟随系统）。
// resolveTheme：合成当前生效主题——手动选择优先，否则跟随系统 prefers-color-scheme。

/** 手动主题选择（null = 未手动选择 → 跟随系统）。 */
export type ThemeChoice = 'dark' | 'light' | null

/** 当前生效主题（AppBar 图标 / 组件消费）。 */
export type ThemeEffective = 'dark' | 'light'

/** 解析持久化值：仅接受精确的 'dark' / 'light'，其余（缺失 / 空串 / 乱码）→ null = 跟随系统。 */
export function parseTheme(raw: string | null | undefined): ThemeChoice {
  if (raw === 'dark' || raw === 'light') return raw
  return null
}

/** 合成当前生效主题：manual 非空 → 手动主题（覆盖系统偏好）；null → 跟随系统 prefers-color-scheme。 */
export function resolveTheme(
  manual: ThemeChoice,
  systemPrefersLight: boolean,
): ThemeEffective {
  if (manual === 'dark') return 'dark'
  if (manual === 'light') return 'light'
  return systemPrefersLight ? 'light' : 'dark'
}
