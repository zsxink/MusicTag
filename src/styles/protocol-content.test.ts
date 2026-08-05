// @vitest-environment node
// 发布前检测（pre-release-check）协议内容守卫：
// - README / LICENSE 协议声明（spec「README 含全部声明」「LICENSE 含附加限制」场景）——
//   直接扫描仓库根 README.md / LICENSE 源码，断言 spec 要求的声明齐全，
//   防止后续子变更把协议条款回归掉（与 design-layering.test.ts 扫描定稿文档同先例）。
// - EulaDialog 全窗口模态遮罩（spec「主界面不可交互」）——扫描组件 `.overlay` 的
//   position:fixed; inset:0 关键行（happy-dom 不计算 Vue scoped CSS，沿用 ui-editor-layout.test.ts 源码守卫先例）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readFromRoot = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8')
const readFromComponents = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../components/${name}`, import.meta.url)), 'utf8')

describe('README 协议声明（spec「README 含全部声明」场景）', () => {
  const readme = readFromRoot('README.md')

  it('个人学习用途 + 禁止商用（个人用途限制）', () => {
    expect(readme).toMatch(/个人学习用途/)
    expect(readme).toMatch(/禁止用于任何商业用途/)
    expect(readme).toMatch(/禁止任何商业/)
  })

  it('不提供任何音频文件 / 下载', () => {
    expect(readme).toMatch(/不提供任何音频文件/)
    expect(readme).toMatch(/下载|抓取或存储/)
  })

  it('外部 API 基于公开资料免责', () => {
    expect(readme).toMatch(/外部网络 API/)
    expect(readme).toMatch(/基于公开资料/)
    expect(readme).toMatch(/与本软件作者无关/)
  })

  it('禁止 AI 转写声明', () => {
    expect(readme).toMatch(/禁止使用 AI/)
    expect(readme).toMatch(/AI 转写|转写、重写或再创作/)
    expect(readme).toMatch(/该转写\/衍生作品与本软件无关/)
  })

  it('软件协议章节（BUSL 1.1 + 禁转卖）', () => {
    expect(readme).toMatch(/软件协议/)
    expect(readme).toMatch(/Business Source License 1\.1/)
    expect(readme).toMatch(/禁止私自销售、转卖、出租/)
  })

  it('顶部软件图标（icon/musictag.png）', () => {
    expect(readme).toMatch(/icon\/musictag\.png/)
  })
})

describe('LICENSE 附加使用限制（spec「LICENSE 含附加限制」场景）', () => {
  const license = readFromRoot('LICENSE')

  it('基于 BUSL 1.1 结构', () => {
    expect(license).toMatch(/Business Source License 1\.1/)
    expect(license).toMatch(/Additional Use Grant/)
  })

  it('Change Date 2099-12-31', () => {
    expect(license).toMatch(/Change Date:\s*2099-12-31/)
  })

  it('禁止私自销售 / 转卖条款', () => {
    expect(license).toMatch(/禁止私自销售\s*\/\s*转卖|禁止以任何形式私自销售、转卖/)
    expect(license).toMatch(/转卖/)
  })

  it('禁止 AI 转写条款', () => {
    expect(license).toMatch(/禁止 AI 转写\s*\/\s*再创作|不得使用 AI/)
    expect(license).toMatch(/AI 转写/)
  })
})

describe('EulaDialog 全窗口模态遮罩（spec「首次启动…主界面不可交互」场景的 CSS 守卫）', () => {
  const css = readFromComponents('EulaDialog.vue')

  it('.overlay 为 position:fixed + inset:0（盖满全窗口，主界面不可交互）', () => {
    const rule = css.match(/\.overlay\s*{([^}]*)}/)?.[1] ?? ''
    expect(rule).toMatch(/position:\s*fixed/)
    expect(rule).toMatch(/inset:\s*0/)
  })

  it('.overlay z-index 高于 SwitchDialog(50)——授权是启动门禁，最先覆盖', () => {
    const rule = css.match(/\.overlay\s*{([^}]*)}/)?.[1] ?? ''
    expect(rule).toMatch(/z-index:\s*60/)
  })
})
