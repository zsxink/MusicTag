// @vitest-environment node
// 发布前检测（pre-release-check）协议内容守卫：
// - README / LICENSE 协议声明（spec「README 含全部声明」「LICENSE 自洽许可文本」场景）——
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

  it('软件协议章节（个人学习许可 + Change Date，无 BUSL 表述）', () => {
    expect(readme).toMatch(/软件协议/)
    expect(readme).toMatch(/个人学习许可/)
    expect(readme).toMatch(/2099-12-31/)
    expect(readme).toMatch(/GPL-2\.0-or-later/)
    expect(readme).toMatch(/禁止私自销售、转卖、出租/)
    expect(readme).not.toMatch(/Business Source License/i)
    expect(readme).not.toMatch(/BUSL/)
  })

  it('外部 API 数据披露（发送字段 / 接收方域名 / 触发时机 / 不发送内容 / 降级行为）', () => {
    // 口径与 docs/compliance/search-sources.md 逐源记录一致（spec「README 含数据披露」场景）。
    expect(readme).toMatch(/歌曲标题、歌手、专辑/)
    expect(readme).toMatch(/music\.163\.com/)
    expect(readme).toMatch(/c\.y\.qq\.com/)
    expect(readme).toMatch(/complexsearch\.kugou\.com/)
    expect(readme).toMatch(/lyrics\.kugou\.com/)
    expect(readme).toMatch(/lrclib\.net/)
    expect(readme).toMatch(/itunes\.apple\.com/)
    expect(readme).toMatch(/HTTPS/)
    expect(readme).toMatch(/缺失歌词或封面时才自动搜索/)
    expect(readme).toMatch(/手动点选时才会下载/)
    expect(readme).toMatch(/不发送本地音频内容/)
    expect(readme).toMatch(/本地文件路径/)
    expect(readme).toMatch(/离线降级/)
    expect(readme).toMatch(/不再自动联网/)
  })

  it('顶部软件图标（icon/musictag.png）', () => {
    expect(readme).toMatch(/icon\/musictag\.png/)
  })
})

describe('LICENSE 自洽许可文本（spec「LICENSE 自洽许可文本」场景）', () => {
  const license = readFromRoot('LICENSE')

  it('许可方身份（MusicTag 作者，GitHub @zsxink）', () => {
    expect(license).toMatch(/MusicTag 作者/)
    expect(license).toMatch(/@zsxink/)
  })

  it('授权自授予起即限定为个人学习与研究（无「授予再分发」矛盾）', () => {
    expect(license).toMatch(/仅限个人学习与研究/)
    // 矛盾守卫：任何「授予…再分发」的授权句式都不允许出现（spec「无矛盾授予」场景）。
    expect(license).not.toMatch(/授予[^。\n]*再分发/)
  })

  it('不再包含 Business Source License（BUSL）表述', () => {
    expect(license).not.toMatch(/Business Source License/i)
    expect(license).not.toMatch(/BUSL/)
  })

  it('禁止商用 / 转卖 / 再分发 / AI 转写条款齐全', () => {
    expect(license).toMatch(/商业用途/)
    expect(license).toMatch(/私自销售、转卖、出租/)
    expect(license).toMatch(/再分发/)
    expect(license).toMatch(/AI 转写/)
  })

  it('Change Date 2099-12-31 → 届后 GPL-2.0-or-later', () => {
    expect(license).toMatch(/2099-12-31/)
    expect(license).toMatch(/GPL-2\.0-or-later/)
  })

  it('无担保 / 终止与存续 / 适用法域（中华人民共和国法律）', () => {
    expect(license).toMatch(/「现状」（AS IS）/)
    expect(license).toMatch(/终止/)
    expect(license).toMatch(/存续/)
    expect(license).toMatch(/中华人民共和国法律/)
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
