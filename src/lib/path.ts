// 纯路径工具（design.md §10 前端 lib 层）。组件 / store/selectors 共用，无 Vue 依赖。
/** 取路径最后一段（跨平台兼容 `/` 与 `\` 分隔）。 */
export function fileName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(i + 1) : path
}

/** 去扩展名的文件名（空标签回退展示用）。 */
export function fileNameStem(path: string): string {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
