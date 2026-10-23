#!/usr/bin/env node
// MusicTag — 第三方依赖与素材归属清单生成器（Issue #166，compliance-disclosure）。
//
// 仅用 Node 内置模块（node:fs / node:path / node:child_process）+ `cargo metadata`，零新增依赖。
// 生成 `THIRD-PARTY-NOTICES.md`（仓库根），覆盖：
//   1. Cargo 普通依赖闭包（随二进制分发）——`cargo metadata` 从 resolve.root 起沿「普通依赖边」BFS，
//      不入队 dev/build 边（tauri-build 等构建依赖因此天然排除）。注意：真实 cargo metadata 中
//      普通边的 dep_kinds 为 [{kind:null}] 而非空数组，故判据实现为「不含 dev/build kind 的边」，
//      与 design.md「dep_kinds 为空数组（普通依赖边）」的意图一致。
//   2. npm 运行时依赖闭包（随前端资源分发）——package.json `dependencies` 起在 node_modules 按
//      Node 解析规则 BFS（只跟 dependencies，不跟 peer/optional/dev）。
//   3. npm 构建工具链（不随应用分发）——devDependencies 同法 BFS，独立成节；已在运行时闭包出现的
//      name@resolved 路径不重复收录。
//   4. 内嵌素材——静态常量数组（OpenCC 繁简字典 Apache-2.0、应用图标来源待确认）。
// 确定性：UTF-8 码元序排序（name 升序、同 name 按 version 升序）、固定节序、无时间戳/机器路径，
// 同一依赖树下重复运行逐字节一致（幂等）。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 按 Node 解析规则沿祖先目录找 `node_modules/<name>`（scoped 包路径 node_modules/@scope/name）。 */
function resolvePkgDir(fromDir, name) {
  let dir = path.resolve(fromDir)
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readPkgJson(pkgDir) {
  return JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
}

/** 依赖表对象 → BFS 收集闭包；`seenPaths` 跨调用共享（运行时/构建两节按 resolved 路径去重）。 */
function collectNpmClosure(startDeps, seenPaths) {
  const queue = []
  for (const name of Object.keys(startDeps)) {
    const dir = resolvePkgDir(repoRoot, name)
    if (dir === null) throw new Error(`无法在 node_modules 中解析依赖 ${name}`)
    queue.push(dir)
  }
  const items = []
  while (queue.length > 0) {
    const dir = queue.shift()
    if (seenPaths.has(dir)) continue
    seenPaths.add(dir)
    const manifest = readPkgJson(dir)
    const repository = manifest.repository
    items.push({
      name: manifest.name,
      version: manifest.version,
      license:
        typeof manifest.license === 'string'
          ? manifest.license
          : (manifest.license?.type ?? 'UNKNOWN'),
      source:
        (typeof repository === 'string' ? repository : repository?.url) ??
        manifest.homepage ??
        '',
    })
    for (const depName of Object.keys(manifest.dependencies ?? {})) {
      const depDir = resolvePkgDir(dir, depName)
      if (depDir === null) throw new Error(`无法在 node_modules 中解析传递依赖 ${depName}（自 ${manifest.name}）`)
      queue.push(depDir)
    }
  }
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return items
}

/** Cargo 普通依赖闭包：resolve.root 起沿普通依赖边（dep_kinds 不含 dev/build）BFS。 */
function collectCargoClosure() {
  const stdout = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'],
    // 全量依赖图 JSON 约 1MB+，超出 spawnSync 默认 1MB maxBuffer（ENOBUFS），放宽到 64MB。
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const meta = JSON.parse(stdout)
  const pkgById = new Map(meta.packages.map((p) => [p.id, p]))
  const nodeById = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
  const rootId =
    meta.resolve.root ?? meta.packages.find((p) => p.name === 'music-tag')?.id
  if (!rootId) throw new Error('cargo metadata 中未找到 resolve.root（music-tag）')
  const seen = new Set([rootId])
  const queue = [rootId]
  const items = []
  while (queue.length > 0) {
    const node = nodeById.get(queue.shift())
    if (!node) continue
    for (const dep of node.deps) {
      // 普通依赖边：dep_kinds 不含 dev/build（kind 为 null 或空数组皆视为普通边）。
      if (!dep.dep_kinds.every((k) => k.kind == null)) continue
      if (seen.has(dep.pkg)) continue
      seen.add(dep.pkg)
      queue.push(dep.pkg)
      const pkg = pkgById.get(dep.pkg)
      if (!pkg) continue
      items.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? pkg.license_file ?? 'UNKNOWN',
        source: pkg.repository ?? pkg.homepage ?? `https://crates.io/crates/${pkg.name}`,
      })
    }
  }
  items.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0,
  )
  return items
}

// 内嵌素材（静态记录，不走自动扫描；OpenCC 条目已按 opencc/README.md 核实）。
const embeddedAssets = [
  {
    file: 'src-tauri/src/service/searcher/opencc/TSCharacters.txt',
    origin: 'OpenCC（https://github.com/BYVoid/OpenCC）上游原文',
    license: 'Apache-2.0',
    note: '出处与 SHA-256 见 src-tauri/src/service/searcher/opencc/README.md；内嵌点 src-tauri/src/service/searcher/simplified.rs（include_str!）与 src/lib/simplified.ts（?raw），前后端两处内嵌',
  },
  {
    file: 'src-tauri/src/service/searcher/opencc/TSPhrases.txt',
    origin: 'OpenCC（https://github.com/BYVoid/OpenCC）上游原文',
    license: 'Apache-2.0',
    note: '出处与 SHA-256 见 src-tauri/src/service/searcher/opencc/README.md；内嵌点同上',
  },
  {
    file: 'icon/musictag.png',
    origin: '作者自有（待确认）',
    license: 'MusicTag 个人学习许可（随本仓库分发）',
    note: 'README 顶部应用图标；来源状态待作者确认',
  },
  {
    file: 'src-tauri/icons/*',
    origin: '作者自有（待确认）',
    license: 'MusicTag 个人学习许可（随本仓库分发）',
    note: 'bundle 图标（tauri.conf.json bundle.icon 引用）；来源状态待作者确认',
  },
]

const cargoDeps = collectCargoClosure()
const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const seenNpmPaths = new Set()
const runtimeDeps = collectNpmClosure(rootManifest.dependencies ?? {}, seenNpmPaths)
const devDeps = collectNpmClosure(rootManifest.devDependencies ?? {}, seenNpmPaths)

const renderItems = (items) => items.map((d) => `- ${d.name} ${d.version} — ${d.license}${d.source ? ` — ${d.source}` : ''}`).join('\n')

const lines = [
  '# 第三方依赖与素材归属清单（THIRD-PARTY-NOTICES）',
  '',
  '本清单由 `scripts/generate-third-party-notices.mjs` 生成（勿手改），覆盖：',
  '',
  '1. **Cargo 依赖闭包**（随二进制分发）——从应用 crate 起沿普通依赖边可达的全部包；',
  '2. **npm 运行时依赖闭包**（随前端资源分发）——`package.json` `dependencies` 及其传递依赖；',
  '3. **npm 构建工具链**（仅构建期使用，**不随应用分发**）——`devDependencies` 及其传递依赖；',
  '4. **仓库内嵌第三方素材**（OpenCC 繁简字典与应用图标等）。',
  '',
  '各条目许可文本全文以对应上游项目发布为准；「UNKNOWN」许可标识为未决项，见文末说明。',
  '',
  '## Cargo 依赖（随二进制分发）',
  '',
  renderItems(cargoDeps),
  '',
  '## npm 运行时依赖（随前端资源分发）',
  '',
  renderItems(runtimeDeps),
  '',
  '## npm 构建工具链（不随应用分发）',
  '',
  renderItems(devDeps),
  '',
  '## 内嵌素材',
  '',
  ...embeddedAssets.map((a) => `- \`${a.file}\` — ${a.origin} — ${a.license} — ${a.note}`),
  '',
  '---',
  '',
  '说明：',
  '',
  '- 「UNKNOWN」许可标识表示该依赖元数据中未声明 license/license-file，属未决项，待逐项核实补充。',
  '- 本清单按固定节序与 UTF-8 码元序排序生成，无时间戳；同一依赖树下重复运行输出逐字节一致。',
]

const content = `${lines.join('\n')}\n`
writeFileSync(path.join(repoRoot, 'THIRD-PARTY-NOTICES.md'), content, 'utf8')
console.log(`THIRD-PARTY-NOTICES.md 生成完毕：Cargo ${cargoDeps.length} 项 / npm 运行时 ${runtimeDeps.length} 项 / npm 构建 ${devDeps.length} 项`)
