// lib/simplified — 繁→简折叠单测（fix-search-sources-locale D5/D6 前端镜像）。
//
// 覆盖 spec「繁简归一化」的折叠算法 scenario：先词后字、最长优先、**取该条第一个候选**、
// 表内无映射原样保留、纯 ASCII / 空串幂等。
//
// **fixture 组与期望值必须与 Rust 侧 `src-tauri/tests/searcher_simplified_tests.rs` 完全相同**
// （design §5「两侧对称 fixture」）——把「两条实现同规则同表」钉死，任何一侧漂移都会被对侧的
// 对称测试或本文件抓出。任一侧改动 fixture 时必须同步另一侧，否则对称性即失效。
//
// **每条 fixture 的判别力**（design §5 表，防「断言了但区分不出」的假覆盖）：
// - `乾`→`干`：字表 `乾 → 干 乾`，**取末位**得 `乾`、**取原字**得 `乾`、**只查词表**得原样 `乾`；
// - `乾紅`→`干红`：词表 `乾紅 → 干红 乾红`，**词表取末位**得 `乾红`。
//   ⚠️ 本条**只**钉「词表多候选取首」：**「不查词表」区分不出**（字表有 `乾 → 干`、`紅 → 红`，
//   纯逐字同样得 `干红`）。
// - `龍鍾`→`龙钟`：同理**只钉「词表多候选取首」**（取末位得 `龙锺`；字表有 `龍 → 龙`、
//   `鍾 → 钟 锺` 且首候选已是 `钟`，故纯逐字亦得 `龙钟`，区分不出「不查词表」）。
// - `一坏`→`一坯`：**唯一能证明「词表优先于逐字」的干净结构断言**（字表 `坏 → 坏 坯` 首候选
//   是原字、`一` 两表皆无映射，故纯逐字与先字后词都得 `一坏`）；
// - `沈陷`→`沉陷`：字表 `沈 → 沈 沉` 首候选是原字，逐字与词表在此字上相同，
//   区分点全在词表级映射（无词表则得 `沈陷`）；
// - `魔杰座`/`著作`：`杰`/`座`/`著` 两表皆无条目，任何多余替换都会改坏它（过度折叠守卫）。
// - `乾隆`→`乾隆`：**只钉「词表恒等条目按词表整段处理」**。⚠️ **不要**用它证明「查了词表」或
//   区分「先词后字」与「只查词表」——两者**同结果**都是 `乾隆`（只有纯逐字取末位得 `干隆`
//   那种实现才会错）。证明「查了词表」请用 `一坏 → 一坯`。
import { describe, expect, it } from 'vitest'

import { toSimplified } from './simplified'
import tsCharactersRaw from '../../src-tauri/src/service/searcher/opencc/TSCharacters.txt?raw'
import tsPhrasesRaw from '../../src-tauri/src/service/searcher/opencc/TSPhrases.txt?raw'

describe('lib/simplified — 表文件载入（防折叠断言假通过）', () => {
  // 与 Rust 侧 `tables_are_loaded_from_disk` 对称：`?raw` 文本必须**完整**随模块进来。
  // 若表文件缺失或路径失效，`tsCharactersRaw` 为空串 → `toSimplified` 走
  // 「两表皆空 → 原样返回」分支 → 本文件其余全部折叠断言**假通过**（绿色但无意义）。
  it('两张表都被 ?raw 完整载入（非空、上游 key<TAB>候选 格式、字节量与 Rust 侧同档）', () => {
    // ⚠️ **量纲口径**：Rust `TS_CHARACTERS.len()` 是 `include_str!` 的 **UTF-8 字节**数（实测
    // 104520 / 8835），而 TS 侧 `raw.length` 是 **UTF-16 码元**数（实测 83830 / 3765）——字表含
    // `𫝈`（U+2B748）等超 BMP 单字与多字符候选，字节数 > 码元数。故此处用 `TextEncoder` 重算
    // UTF-8 字节数，才能与 Rust 阈值**同量纲**（直接拿 `.length` 比 100000 会假红）。
    const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length
    expect(utf8Bytes(tsCharactersRaw)).toBeGreaterThan(100_000)
    expect(utf8Bytes(tsPhrasesRaw)).toBeGreaterThan(5_000)
    // 两表均应为上游 `key<TAB>候选` 格式（且含注释行与正文行）
    expect(tsCharactersRaw).toContain('\t')
    expect(tsPhrasesRaw).toContain('\t')
    expect(tsCharactersRaw).toContain('#')
    expect(tsPhrasesRaw).toContain('#')
  })

  it('表被解析成可用结构（词表含已知条目、单字表含已知多候选条目）', () => {
    // 上一条只钉「文本进来」，本条钉「文本可被 entries() 正确解析成非空映射」：
    // 若解析口径漂移（如误用 `split(/\s+/)` 把 key 粘碎），折叠断言会静默退化为原样返回。
    const charKeys = tsCharactersRaw
      .split('\n')
      .filter((l) => !l.startsWith('#') && l.includes('\t'))
      .map((l) => l.slice(0, l.indexOf('\t')))
    expect(charKeys.length).toBeGreaterThan(2_000) // 单字表数千条
    // 判别性抽查：字表多候选行原文（`乾 → 干 乾`）——解析错位会直接看出来
    expect(tsCharactersRaw).toMatch(/^乾\t干 乾$/m)
    // 词表判别性抽查：结构断言所依赖的 `一坏 → 一坯`
    expect(tsPhrasesRaw).toMatch(/^一坏\t一坯$/m)
  })
})

describe('lib/simplified — 折叠 fixture（与 Rust 侧 searcher_simplified_tests.rs 逐条对称）', () => {
  it('folds_traditional_artist_and_album：繁体艺人/专辑折叠为简体', () => {
    // 「不折叠」的判别用例：折叠后与简体本地标签逐字相等
    expect(toSimplified('周杰倫')).toBe('周杰伦')
    expect(toSimplified('葉惠美')).toBe('叶惠美')
  })

  it('multi_candidate_char_takes_first_candidate：字表多候选取首（非末位/非原字/非只查词表）', () => {
    // 字表多候选取**首**：字表原文为 `乾 → 干 乾`、`劃 → 划 㓰`、`剋 → 克 剋`、
    // `儘 → 尽 侭`、`噁 → 恶 𫫇`。取末位/取原字/排序后取都会在这几条上错。
    expect(toSimplified('乾')).toBe('干')
    expect(toSimplified('劃')).toBe('划')
    expect(toSimplified('剋')).toBe('克')
    expect(toSimplified('儘')).toBe('尽')
    expect(toSimplified('噁')).toBe('恶')
  })

  it('multi_candidate_phrase_takes_first_candidate：词表多候选取首（非末位）', () => {
    // 词表多候选取**首**：词表原文为 `乾紅 → 干红 乾红`、`龍鍾 → 龙钟 龙锺`。
    // 取末位/排序后取会得 `乾红`/`龙锺`。
    // ⚠️ **不**能区分「完全不查词表」：字表有 `乾 → 干`、`紅 → 红`、`龍 → 龙`、`鍾 → 钟 锺`，
    // 纯逐字也得 `干红`/`龙钟`。区分「不查词表」请用 `一坏 → 一坯`。
    expect(toSimplified('乾紅')).toBe('干红')
    expect(toSimplified('龍鍾')).toBe('龙钟')
  })

  it('phrase_table_wins_over_per_character_folding：词表优先于逐字（结构断言）', () => {
    // **结构断言**：词表优先于逐字的唯一干净判别用例。
    // 词表有 `一坏 → 一坯`；「先字后词」或「完全不查词表」都得 `一坏`（纯逐字查 `一`（两表皆无
    // 映射）与 `坏`（字表 `坏 → 坏 坯`，**首候选是原字**），两表对这两字的首候选均非其自身
    // 映射的替换结果）。故本断言**只能**由「先词后字」实现满足。
    expect(toSimplified('一坏')).toBe('一坯')

    // 同族：字表 `沈 → 沈 沉` 首候选是原字（逐字与词表在此字上相同），
    // 区分点全在词表级映射 `沈陷 → 沉陷`（无词表则得 `沈陷`）。
    expect(toSimplified('沈陷')).toBe('沉陷')
  })

  it('unmapped_text_is_preserved：表内无映射的字保持原样（过度折叠守卫）', () => {
    // 表内无映射的字保持原样（spec「无映射保持原样」）。`杰`/`座`/`著` 在两表中**均无任何条目**
    // （含作为词表 key），任何多余替换都会改坏它们。
    expect(toSimplified('魔杰座')).toBe('魔杰座')
    expect(toSimplified('著作')).toBe('著作')
    expect(toSimplified('稻香')).toBe('稻香')
    expect(toSimplified('晴天')).toBe('晴天')
  })

  it('ascii_and_empty_are_idempotent：两表无 ASCII key → ASCII 与空串恒原样', () => {
    // 两表均无 ASCII key（design §2.5 实测）→ 纯 ASCII 恒原样、幂等
    expect(toSimplified('Red Hot Chili Peppers')).toBe('Red Hot Chili Peppers')
    expect(toSimplified('abc')).toBe('abc')
    expect(toSimplified('Hello World')).toBe('Hello World')
    // 空串边界：不 panic、不产生新字符
    expect(toSimplified('')).toBe('')
    // 纯标点/数字（表内无映射）
    expect(toSimplified('0123456789')).toBe('0123456789')
    expect(toSimplified('-_.,!?')).toBe('-_.,!?')
  })

  it('folding_is_idempotent：折叠两次与折叠一次同结果（比较侧反复 norm 不得漂移）', () => {
    for (const raw of [
      '周杰倫',
      '葉惠美',
      '乾紅',
      '龍鍾',
      '一坏',
      '沈陷',
      '魔杰座',
      '著作',
      'Red Hot Chili Peppers',
      '',
    ]) {
      const once = toSimplified(raw)
      const twice = toSimplified(once)
      expect(once, `\`${raw}\` 折叠应幂等：一次得 \`${once}\`、二次得 \`${twice}\``).toBe(twice)
    }
  })

  it('phrase_identity_entry_is_preserved：词表恒等条目 `乾隆 → 乾隆` 原样保留', () => {
    // 词表恒等条目：`乾隆 → 乾隆`（词表原文如此）。按「先词后字」整段命中后逐字兜底不触发，
    // 故结果恒为 `乾隆`。
    //
    // ⚠️ 本断言**只**钉「词表恒等条目按词表整段处理」，**不**能区分「先词后字」与「只查词表」
    // （两者同结果）。证明「查了词表」请用 `一坏 → 一坯`。
    expect(toSimplified('乾隆')).toBe('乾隆')
  })

  it('mixed_text_folds_only_mapped_chars：混合文本只折叠有映射的部分', () => {
    // 混合文本：逐字折叠不误伤未映射部分，且一次调用内多处命中
    expect(toSimplified('周杰倫 - 葉惠美 (Live)')).toBe('周杰伦 - 叶惠美 (Live)')
    expect(toSimplified('稻香(周杰倫)')).toBe('稻香(周杰伦)')
    // 繁体全文串（不含 ASCII）同样逐字折叠
    expect(toSimplified('魔傑座')).toBe('魔杰座')
  })
})
