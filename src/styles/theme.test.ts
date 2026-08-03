// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 结构测试：设计语言 token 地基的「深色缺省 + 浅色跟随系统」不变量。
// 纯 CSS 主题（theme.css）在 node 环境无法做像素渲染断言，本测试直接
// 校验 CSS 源码结构，保证 spec 两个场景（深色默认渲染 / 浅色跟随系统）
// 的关键不变量不回归：
//   1. `:root`（无媒体查询保护）中的默认 token 必须是深色（防启动闪白）。
//   2. 浅色 token 只允许出现在 `@media (prefers-color-scheme: light)` 内，
//      即浅色必须跟随系统偏好。
const css = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8')

/** 提取 `:root` 顶层声明块（排除媒体查询内的块）。 */
function topLevelRootBlock(source: string): string {
  // 从首个 `:root {` 到其匹配的闭括号；按字符扫描处理嵌套（media 块位于其内）。
  const start = source.indexOf(':root')
  expect(start).toBeGreaterThanOrEqual(0)
  let depth = 0
  let i = source.indexOf('{', start)
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return source.slice(start, i + 1)
}

function mediaLightBlock(source: string): string {
  const start = source.indexOf('@media (prefers-color-scheme: light)')
  expect(start).toBeGreaterThanOrEqual(0)
  let depth = 0
  let i = source.indexOf('{', start)
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return source.slice(start, i + 1)
}

/** 提取属性选择器声明块（如 `html[data-theme="light"] { ... }`）。 */
function attrThemeBlock(source: string, selector: string): string {
  const start = source.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  let depth = 0
  let i = source.indexOf('{', start)
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return source.slice(start, i + 1)
}

const root = topLevelRootBlock(css)
const media = mediaLightBlock(css)

describe('theme.css — 深色默认渲染（spec: 系统无浅色偏好时应用启动 → 深色 token，无闪白）', () => {
  it(':root 缺省即深色 token（--bg 等），不依赖媒体查询', () => {
    expect(root).toMatch(/--bg:\s*#12161A/)
    expect(root).toMatch(/--panel:\s*#1A2026/)
    expect(root).toMatch(/--panel-2:\s*#212830/)
    expect(root).toMatch(/--border:\s*#262D34/)
    expect(root).toMatch(/--text:\s*#E8E9E4/)
    expect(root).toMatch(/--text-dim:\s*#8A939C/)
    expect(root).toMatch(/--accent:\s*#E8A33D/)
  })

  it('深色 token 在 :root 顶层声明，浅色值不得混入默认层', () => {
    // 浅色 token 值是浅色的专属值（#F4F4F1 / #FFFFFF / #1E2429），
    // 出现在顶层 :root 意味着「浅色被当成默认」→ 闪白回归。
    expect(root).not.toMatch(/--bg:\s*#F4F4F1/)
    expect(root).not.toMatch(/--panel:\s*#FFFFFF/)
    expect(root).not.toMatch(/--text:\s*#1E2429/)
  })
})

describe('theme.css — 浅色跟随系统（spec: 系统偏好浅色 → 界面用浅色 token）', () => {
  it('存在 prefers-color-scheme: light 媒体查询，浅色 token 只在该块内', () => {
    expect(media).toMatch(/--bg:\s*#F4F4F1/)
    expect(media).toMatch(/--panel:\s*#FFFFFF/)
    expect(media).toMatch(/--panel-2:\s*#F1F0EC/)
    expect(media).toMatch(/--border:\s*#DAD9D2/)
    expect(media).toMatch(/--text:\s*#1E2429/)
    expect(media).toMatch(/--text-dim:\s*#5F6A73/)
    expect(media).toMatch(/--accent:\s*#B4761D/)
    // 媒体查询位于 :root 声明之后，保证覆盖优先级（后者胜）。
    expect(css.indexOf('@media (prefers-color-scheme: light)')).toBeGreaterThan(
      css.indexOf(':root'),
    )
  })
})

describe('theme.css — 手动主题覆盖（v1-ux-settings D5: 手动优先于系统，锁不回归）', () => {
  const lightBlock = attrThemeBlock(css, 'html[data-theme="light"]')
  const darkBlock = attrThemeBlock(css, 'html[data-theme="dark"]')
  const mediaPos = css.indexOf('@media (prefers-color-scheme: light)')

  it('存在 html[data-theme="light"]/html[data-theme="dark"] 覆盖块，置于 media 之后（源码顺序后胜）', () => {
    expect(css.indexOf('html[data-theme="light"]')).toBeGreaterThan(mediaPos)
    expect(css.indexOf('html[data-theme="dark"]')).toBeGreaterThan(mediaPos)
  })

  it('浅色覆盖块 = 浅色 token（手动浅色与跟随系统同值，互不漂移）', () => {
    expect(lightBlock).toMatch(/--bg:\s*#F4F4F1/)
    expect(lightBlock).toMatch(/--panel:\s*#FFFFFF/)
    expect(lightBlock).toMatch(/--panel-2:\s*#F1F0EC/)
    expect(lightBlock).toMatch(/--border:\s*#DAD9D2/)
    expect(lightBlock).toMatch(/--text:\s*#1E2429/)
    expect(lightBlock).toMatch(/--text-dim:\s*#5F6A73/)
    expect(lightBlock).toMatch(/--accent:\s*#B4761D/)
  })

  it('深色覆盖块 = 深色 token（手动深色在系统浅色时仍显深）', () => {
    expect(darkBlock).toMatch(/--bg:\s*#12161A/)
    expect(darkBlock).toMatch(/--panel:\s*#1A2026/)
    expect(darkBlock).toMatch(/--panel-2:\s*#212830/)
    expect(darkBlock).toMatch(/--border:\s*#262D34/)
    expect(darkBlock).toMatch(/--text:\s*#E8E9E4/)
    expect(darkBlock).toMatch(/--text-dim:\s*#8A939C/)
    expect(darkBlock).toMatch(/--accent:\s*#E8A33D/)
  })
})
