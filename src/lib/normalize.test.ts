// lib/normalize — 比较侧归一化单测（fix-search-sources-locale D10 前端镜像）。
//
// 管线口径：`trim` → 繁→简折叠 → 全角转半角 → 小写，与 Rust `searcher::norm` **逐条同规则同顺序**。
// 这组是**前端独有**断言（Rust 侧没有同组的 `norm()` 单测，故此处不承担「两侧对称 fixture」
// 义务，但每条期望值都以 Rust `norm()` 的口径为准）。
//
// **每条 fixture 的判别力**（防「断言了但区分不出」的假覆盖）：
// - `周杰倫`→`周杰伦` / `乾紅`→`干红`：钉**折叠步真的在管线里**。若把 `toSimplified` 调用删掉
//   （或折叠步位置放错到全角半角之后），这两条会原样输出繁体而红——这是「后端认为同曲、前端
//   认为不同曲」撕裂（C2 换源失败）的直接回归网。
// - `乾紅！`→`干红!`：钉**折叠与全角半角两步的组合**（繁体 + 全角标点同现）。任何一步漏掉都会
//   得 `乾紅!` 或 `干紅！` 之类的半折叠结果。
// - `Ａ　Ｂ`→`a b`：钉 U+3000 全角空格走的是**专用分支**（→ 半角空格 `' '`）而不是被
//   0xFEE0 区间偏移误算（若走错分支会得 `` `ab` `` 或 `a+b` 之类）。
// - `　乾紅　`→`干红`：钉 **trim + 折叠两步的组合**（U+3000 是 JS `trim()` 认定的空白，首尾
//   全角空格被去掉、繁体照常折叠）。⚠️ 本条**不能单独区分步骤先后**：若折叠先于 trim 执行，
//   全角空格先被换成半角空格再被 trim，结果同样是 `干红`。
// - `　`→`` / ` `→``：**空输入与全空白边界**（不得产出不可见残留字符，否则 C2 身份校验会把
//   「两个空标题」判为同曲）。
import { describe, expect, it } from 'vitest'

import { normalizeForMatch } from './normalize'

describe('lib/normalize — 繁简归一化（比较侧：折叠步在管线内）', () => {
  it('繁体折叠为简体（C2 换源身份校验能跨繁简命中同一首）', () => {
    expect(normalizeForMatch('周杰倫')).toBe('周杰伦')
    expect(normalizeForMatch('乾紅')).toBe('干红')
  })
})

describe('lib/normalize — 全角转半角 + 小写（既有口径，不得被折叠步破坏）', () => {
  it('全角字母 → 半角 + 小写', () => {
    expect(normalizeForMatch('ＡＢＣ')).toBe('abc')
  })

  it('全角标点 → 半角标点', () => {
    expect(normalizeForMatch('！＠＃')).toBe('!@#')
  })

  it('全角空格 U+3000 → 半角空格（专用分支，不走 0xFEE0 偏移）', () => {
    expect(normalizeForMatch('Ａ　Ｂ')).toBe('a b')
  })
})

describe('lib/normalize — 各步组合（折叠 × 全角半角 × 小写 同现）', () => {
  it('繁体 + 全角标点 → 简体 + 半角标点', () => {
    expect(normalizeForMatch('周杰倫！')).toBe('周杰伦!')
    expect(normalizeForMatch('乾紅！')).toBe('干红!')
  })

  it('首尾全角空格被 trim 且繁体照常折叠', () => {
    expect(normalizeForMatch('　乾紅　')).toBe('干红')
  })

  it('繁体 + 全角字母混合', () => {
    expect(normalizeForMatch('乾紅Ａ')).toBe('干红a')
  })
})

describe('lib/normalize — 空输入与全空白边界（不得残留不可见字符）', () => {
  it('空串与全空白串归一化为空串', () => {
    expect(normalizeForMatch('　')).toBe('') // 全角空格
    expect(normalizeForMatch(' ')).toBe('') // 半角空格
    expect(normalizeForMatch('')).toBe('')
  })
})

describe('lib/normalize — 幂等性（比较侧反复归一化不得漂移）', () => {
  it('归一化两次与一次同结果', () => {
    for (const raw of ['周杰倫', '乾紅', 'ＡＢＣ', 'Ａ　Ｂ', '！＠＃', '周杰倫！', '乾紅Ａ', '　乾紅　', '']) {
      const once = normalizeForMatch(raw)
      expect(once, `\`${raw}\` 归一化应幂等：一次得 \`${once}\`、二次得 \`${normalizeForMatch(once)}\``).toBe(
        normalizeForMatch(once),
      )
    }
  })
})
