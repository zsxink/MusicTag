// @vitest-environment node
// ui-editor-layout 布局守卫测试（spec: 歌词框加高 360px / 左栏高度锁定窗口可用区）。
//
// 这两条是纯 CSS 布局约束，jsdom/happy-dom 不处理 Vue scoped CSS（无 stylesheet、
// getComputedStyle 恒空），无法用挂载断言真实布局。沿用 layering.test.ts 先例——
// 直接扫描 .vue 源码，守卫 CSS 关键行，防止后续子变更把 min-height/overflow
// 回归掉（spec「空态/正常态不受影响」的反向守卫）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')
const readFromRoot = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8')

describe('ui-editor-layout — 歌词框默认高度加倍（spec: .lyrics-box min-height 360px，保留 resize:vertical）', () => {
  const css = read('LyricPanel.vue')

  it('.lyrics-box min-height 为 360px（原 180px 的两倍）', () => {
    expect(css).toMatch(/\.lyrics-box\s*{[^}]*min-height:\s*360px/)
    expect(css).not.toMatch(/min-height:\s*180px/)
  })

  it('保留 resize: vertical（用户可手动拉高）', () => {
    const rule = css.match(/\.lyrics-box\s*{([^}]*)}/)?.[1] ?? ''
    expect(rule).toMatch(/resize:\s*vertical/)
  })
})

describe('ui-editor-layout — 左栏高度锁定窗口可用区（spec: 候选展开时左栏不顶起、右栏仅内部滚动）', () => {
  const app = readFromRoot('App.vue')

  it('.workspace 含 overflow:hidden（锁定行高度边界，右栏超高不撑高窗口）', () => {
    const rule = app.match(/\.workspace\s*{([^}]*)}/)?.[1] ?? ''
    expect(rule).toMatch(/overflow:\s*hidden/)
    // 锁高必须保留弹性撑满语义：flex:1 1 auto + min-height:0 不得被回归掉
    expect(rule).toMatch(/flex:\s*1 1 auto/)
    expect(rule).toMatch(/min-height:\s*0/)
  })

  it('.editor-slot 含 min-height:0（放行内部 .editor-body 的 overflow-y:auto 生效）', () => {
    const rule = app.match(/\.editor-slot\s*{([^}]*)}/)?.[1] ?? ''
    expect(rule).toMatch(/min-height:\s*0/)
  })

  it('.editor-body 保留 overflow-y:auto + min-height:0（右栏内部滚动通道不丢）', () => {
    const editor = read('Editor.vue')
    const rule = editor.match(/\.editor-body\s*{([^}]*)}/)?.[1] ?? ''
    expect(rule).toMatch(/overflow-y:\s*auto/)
    expect(rule).toMatch(/min-height:\s*0/)
  })
})
