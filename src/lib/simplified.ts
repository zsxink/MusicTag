// lib/simplified — 繁→简折叠（fix-search-sources-locale D5/D6，零新增运行时依赖）。
//
// **数据单一来源**：`?raw` 加载 Rust 侧内嵌的**同一份** OpenCC 上游原文
// （`src-tauri/src/service/searcher/opencc/TSCharacters.txt` 单字表 + `TSPhrases.txt` 短语表，
// Apache-2.0，随仓库分发），**不在 `src/` 下复制副本**——副本会漂移。
// 另一侧权威实现是 `src-tauri/src/service/searcher/simplified.rs` 的 `to_simplified`，
// 两侧**逐条同规则**，来源/许可/SHA-256/解析格式见 `opencc/README.md`。
//
// 算法（spec「繁简归一化」requirement）：
// 1. **先词后字、最长优先**——在短语表上做最长匹配（长度 ≥ 2，词表无单字 key），命中即整段替换；
// 2. 逐字兜底——未命中短语的字符查单字表；
// 3. 表内无映射 → 原样保留（`杰`/`座`/`著` 两表皆无条目）。
// 命中时取该条**第一个候选**（字表 997 条多候选、其中 70 条首候选 ≠ 原字，如 `乾 → 干 乾`；
// 词表 10 条多候选，如 `乾紅 → 干红 乾红`）——取末位/取原字都会错。
//
// **只作用于比较侧**（本仓唯一调用点是 `lib/normalize.ts` 的 `normalizeForMatch` → C2 换源身份校验），
// **绝不改写**候选的展示、填入与写盘文本：用户点选 iTunes HK 的繁体候选后，表单与写盘的仍是
// 远端原文（如 `周杰倫`）。见 `lib/normalize.ts` 与后端 `norm()`。
//
// 解析（上游格式 `key<TAB>候选1 候选2 ...`）：跳过 `#` 注释行与空行；**先按单个 `\t` 切一次**
// 拿到 (key, value)，**再按单个空格 `' '` 切候选**——不可用 `split(/\s+/)` 或
// `split(' ').filter(Boolean)`（TAB 与空格混切会把 key 粘碎；filter(Boolean) 虽不粘碎 key 但
// 会让 Rust 侧 `split(' ').next()` 的「首候选」口径在含空候选的行上产生分歧，故照搬 Rust 写法）。
import tsCharactersRaw from '../../src-tauri/src/service/searcher/opencc/TSCharacters.txt?raw'
import tsPhrasesRaw from '../../src-tauri/src/service/searcher/opencc/TSPhrases.txt?raw'

/**
 * 两张表 + 词表最长 key 长度（模块级惰性解析一次，首次调用时构建并缓存）。
 * 惰性而非 import 期立即解析：`?raw` 文本已随模块静态进来，但没必要让没用折叠的场景
 * （如仅用 `lib/path.ts` 的组件单测）承担建 `Map` 的开销。
 */
interface Tables {
  /** 单字表：单字 key → 该条**第一个候选**。 */
  chars: Map<string, string>
  /** 短语表：整段 key → 该条**第一个候选**。 */
  phrases: Map<string, string>
  /** 短语表最长 key 的字符**长度**（`Array.from` 后的长度，非 UTF-16 码元数）。 */
  maxPhraseLen: number
}

let tables: Tables | null = null

/**
 * 逐行拆出 `(key, 候选串)`：跳过 `#` 注释行与空行；**先按单个 `\t` 切一次**，候选留在 value 侧。
 * 口径与 Rust `simplified.rs` 的 `entries()` 一致（含 `trim_end` 去 `\r` 的 CRLF 容忍）。
 */
function* entries(text: string): Generator<[string, string]> {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd() // Rust 侧 `trim_end_matches('\r')`
    if (line.trim() === '' || line.startsWith('#')) continue
    // 关键：**只按单个制表符切一次**（key 与 value 之间是 TAB，候选之间是空格）。
    const tab = line.indexOf('\t')
    if (tab < 0) continue // Rust 侧 `split_once('\t')` 对无 TAB 行返回 None
    yield [line.slice(0, tab), line.slice(tab + 1)]
  }
}

/** 解析两张表并补算词表最长 key 长度（扫描上界）。 */
function parseTables(): Tables {
  const chars = new Map<string, string>()
  for (const [key, candidates] of entries(tsCharactersRaw)) {
    // 单字表只处理单字 key（多字 key 属短语表职责，见 opencc/README.md）。
    // 按 Unicode 码点判断长度：字表含 `𫝈` 等超出 BMP 的单字。
    const cp = Array.from(key)
    if (cp.length !== 1) continue
    const first = candidates.split(' ')[0]
    if (first !== undefined && first !== '') chars.set(cp[0], first)
  }

  const phrases = new Map<string, string>()
  let maxPhraseLen = 0
  for (const [key, candidates] of entries(tsPhrasesRaw)) {
    const first = candidates.split(' ')[0]
    if (first === undefined || first === '') continue
    phrases.set(key, first)
    maxPhraseLen = Math.max(maxPhraseLen, Array.from(key).length)
  }

  return { chars, phrases, maxPhraseLen }
}

function getTables(): Tables {
  if (tables === null) tables = parseTables()
  return tables
}

/**
 * 繁→简折叠 `toSimplified(s)`：先词后字、最长优先、取该条第一个候选；无映射原样保留。
 *
 * 与 Rust `simplified::to_simplified` 同算法同表（两侧 fixture 对称断言，见 design §5）。
 * 表的候选可能是**多个字符**（如 `㓰`/`侭`/`𫫇`），故两表 value 都是 `string`；
 * 逐字兜底直接写出整个候选，**不得**取 `candidate[0]`（会静默丢掉多字符候选）。
 *
 * 只用于比较侧衍生值；不改写候选文本。纯 ASCII 与空串天然幂等（两表无 ASCII key）。
 * 遍历按**码点**（`Array.from`）而非 UTF-16 码元——字表含 `𫝈`（U+2B748）等超 BMP 单字，
 * 按码元走会把代理对切开、既查不到表也破坏拼接结果。
 */
export function toSimplified(s: string): string {
  const t = getTables()
  if (t.phrases.size === 0 && t.chars.size === 0) return s
  const chars = Array.from(s)
  let out = ''
  let i = 0
  while (i < chars.length) {
    // 1) 短语最长优先：从 `min(max_phrase_len, 剩余长度)` 递减试长度，命中即整段替换。
    const upper = Math.min(t.maxPhraseLen, chars.length - i)
    let matched = 0
    for (let len = upper; len >= 2; len--) {
      const candidate = chars.slice(i, i + len).join('')
      const replacement = t.phrases.get(candidate)
      if (replacement !== undefined) {
        out += replacement
        i += len
        matched = len
        break
      }
    }
    if (matched !== 0) continue
    // 2) 逐字兜底：查单字表，取该条第一个候选；无映射原样保留。
    out += t.chars.get(chars[i]) ?? chars[i]
    i += 1
  }
  return out
}
