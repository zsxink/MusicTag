// @vitest-environment node
// Tauri command 契约一致性守卫（spec: command-contract-sync，GATE #92 挂起修复）。
// 真值基准 = src-tauri/src/lib.rs `invoke_handler(tauri::generate_handler![...])`
// 实际注册的 13 个 command（代码是唯一事实来源，文档跟随代码）。
// 断言 docs/design/design.md §10.3、docs/V1-PRD.md §7、openspec/config.yaml
// 三处契约清单与 lib.rs 注册集一致——任一源缺 command（或 lib.rs 新增未同步）
// 即红，失败消息列出该源相对 lib.rs 的缺/多余 command 名。
// 结构断言：node:fs 读源码 + 逐源提取锚点，不触 Tauri 运行时、不编译 Rust。
// 记忆 music-tag-v1-spec.md 在 ~/.claude/ 仓库外（CI 无法读取），不纳入守卫。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// 锚点切片：startAnchor 缺失或 endAnchor 缺失时抛明确错误（防静默切到 EOF 误中正文）。
function sliceBetween(
  text: string,
  startAnchor: string,
  endAnchor: string,
  label: string,
): string {
  const start = text.indexOf(startAnchor)
  if (start < 0) throw new Error(`[command-contract] ${label} 起始锚点缺失: "${startAnchor}"`)
  const end = text.indexOf(endAnchor, start)
  if (end < 0) throw new Error(`[command-contract] ${label} 结束锚点缺失: "${endAnchor}"`)
  return text.slice(start, end)
}

const uniqSort = (cmds: string[]) => [...new Set(cmds)].sort()

// ---- 真值基准：lib.rs generate_handler! 注册集（group 2 = command 名） ----
// 注释 `tauri::generate_handler![...]` 无 `commands::` 前缀不误中。
const lib = read('../../src-tauri/src/lib.rs')
const libCommands = uniqSort([...lib.matchAll(/commands::([a-z_]+)::([a-z_]+)/g)].map((m) => m[2]))

// 真值签名：commands/*.rs 定义文件 `pub fn name(` / `pub async fn name(`。
// 13 个 command 中无参者恰为 pick_folder / pick_cover_file / get_last_dir。
// 从定义文件提取（lib.rs 只注册不定义 download_cover 等，签名不在 lib.rs）。
const sigSource = ['folder.rs', 'song.rs', 'cover.rs', 'search.rs']
  .map((f) => read(`../../src-tauri/src/commands/${f}`))
  .join('\n')
const libSignature = (name: string): string => {
  const m = sigSource.match(new RegExp(`pub (?:async )?fn ${name}\\(([^)]*)\\)`))
  if (!m) throw new Error(`[command-contract] commands/*.rs 未找到签名: pub fn ${name}(`)
  return m[1].trim()
}
const libParamless = libCommands.filter((c) => libSignature(c) === '').sort()
const assertParamless = (name: string, cmds: string[], cmdText: string) => {
  const wrong = libParamless.filter(
    (c) => !new RegExp(`\`${c}\\(\\)`).test(cmdText),
  )
  expect(
    wrong,
    `${name} 无参 command 签名错误（真值 lib.rs 无参）: [${wrong.join(', ')}]`,
  ).toEqual([])
}

// ---- design.md §10.3：切片「### 10.3」→「### 10.4」，表行 `name(` 形态 ----
// §10.3 前置 TS 类型表行（`source`/`lyrics_source`/`cover`…）无 `name(` 形态不误中。
const design = read('../../docs/design/design.md')
const designSlice = sliceBetween(design, '### 10.3 Tauri command 契约', '### 10.4', 'design §10.3')
const designCommands = uniqSort([...designSlice.matchAll(/^\| `([a-z_]+)\(/gm)].map((m) => m[1]))

// ---- V1-PRD.md §7：切片「**Tauri command 全量**」→「>   - 前端只管展示」 ----
// 必须切片——§308 正文另有 `search_song(title, artist)` 等、设计语言段有 `rgba(`，不切片会误中。
const prd = read('../../docs/V1-PRD.md')
const prdSlice = sliceBetween(prd, '**Tauri command 全量**', '>   - 前端只管展示', 'PRD §7')
const prdCommands = uniqSort([...prdSlice.matchAll(/`([a-z_]+)\(/g)].map((m) => m[1]))

// ---- openspec/config.yaml：含「Tauri command 契约」行的 `：` 后 slash 清单 ----
const config = read('../../openspec/config.yaml')
const configLine = config.split('\n').find((l) => l.includes('Tauri command 契约'))
if (!configLine) throw new Error('[command-contract] config.yaml 缺少 "Tauri command 契约" 行')
const slashMatch = configLine.match(/：([a-z_]+(?:\/[a-z_]+)+)/)
if (!slashMatch) throw new Error('[command-contract] config.yaml 契约行缺少 `：` 后 slash 清单')
const configCommands = uniqSort(slashMatch[1].split('/'))

const sources: Array<[string, string[]]> = [
  ['design.md §10.3', designCommands],
  ['V1-PRD.md §7', prdCommands],
  ['openspec/config.yaml', configCommands],
]

// 失败消息：列出该源相对 lib.rs 的缺/多余 command 名。
function diffMessage(name: string, cmds: string[]): string {
  const missing = libCommands.filter((c) => !cmds.includes(c))
  const extra = cmds.filter((c) => !libCommands.includes(c))
  return `${name} 与 lib.rs 注册集不一致：缺 [${missing.join(', ')}]，多余 [${extra.join(', ')}]`
}

describe('Tauri command 契约一致性守卫（真值 = lib.rs generate_handler! 注册集）', () => {
  it('lib.rs 实际注册恰为 13 个 command（防正则退化/漏匹配）', () => {
    expect(libCommands, `lib.rs 提取到 ${libCommands.length} 个: [${libCommands.join(', ')}]`).toHaveLength(13)
    expect(new Set(libCommands).size).toBe(13)
  })

  it.each(sources)('%s 与 lib.rs 注册集一致', (_name, cmds) => {
    expect(cmds, diffMessage(_name, cmds)).toEqual(libCommands)
  })

  it.each(sources)('%s 契约清单去重后恰为 13 个（防正则漏匹配）', (_name, cmds) => {
    expect(cmds, `${_name} 提取到 ${cmds.length} 个: [${cmds.join(', ')}]`).toHaveLength(13)
    expect(new Set(cmds).size).toBe(13)
  })

  // 签名层 spot-check：lib.rs 无参 command 在三源契约表中必须写成 `name()`（无参）。
  // 防「仅名称一致、签名漂移」漏检——tester 抓到的 PRD §7 get_last_dir(dir) 即此类。
  it('design §10.3 无参 command 签名一致（pick_folder/pick_cover_file/get_last_dir 为 `name()`）', () => {
    assertParamless('design §10.3', designCommands, designSlice)
  })

  it('PRD §7 无参 command 签名一致（pick_folder/pick_cover_file/get_last_dir 为 `name()`）', () => {
    assertParamless('PRD §7', prdCommands, prdSlice)
  })
})
