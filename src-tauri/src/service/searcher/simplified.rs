// MusicTag — 繁→简折叠（fix-search-sources-locale D5/D6，零新增运行时依赖）。
//
// 数据单一来源：`opencc/TSCharacters.txt`（单字表）+ `opencc/TSPhrases.txt`（短语表），
// OpenCC 上游原文（Apache-2.0），随仓库分发；来源、许可、SHA-256 与解析格式见 `opencc/README.md`。
// 前端 `src/lib/simplified.ts` 用 `?raw` 加载**同一份** .txt，两侧算法必须逐条同规则。
//
// 算法（spec「繁简归一化」requirement）：
// 1. **先词后字、最长优先**——在短语表上做最长匹配（长度 ≥ 2，词表无单字 key），命中即整段替换；
// 2. 逐字兜底——未命中短语的字符查单字表；
// 3. 表内无映射 → 原样保留（`著`/`杰`/`座` 两表皆无条目）。
// 命中时取该条**第一个候选**（字表 997 条多候选、其中 70 条首候选 ≠ 原字，如 `乾 → 干 乾`；
// 词表 10 条多候选，如 `乾紅 → 干红 乾红`）——取末位/取原字都会错。
//
// **只作用于比较侧**（打分 / 同源去重 key / 组内排序），**绝不改写**候选的展示、填入与写盘文本：
// 用户点选 iTunes HK 的繁体候选后，表单与写盘的仍是远端原文（如 `周杰倫`）。见 `norm()`。
//
// 解析（上游格式 `key<TAB>候选1 候选2 ...`）：跳过 `#` 注释行与空行；**先按单个 `\t` 切一次**
// 拿到 (key, value)，**再按单个空格 `' '` 切候选**——不可用 `split_whitespace()`（TAB 与空格
// 混切会把 key 粘碎）。

use std::collections::HashMap;
use std::sync::OnceLock;

/// 单字表原文（OpenCC `TSCharacters.txt`，Apache-2.0）。
///
/// `pub`：供前端镜像与集成测试核对表内容/常量。
pub const TS_CHARACTERS: &str = include_str!("opencc/TSCharacters.txt");

/// 短语表原文（OpenCC `TSPhrases.txt`，Apache-2.0）。
///
/// `pub`：同上。
pub const TS_PHRASES: &str = include_str!("opencc/TSPhrases.txt");

/// 解析后的两张表 + 词表最长 key 长度（`OnceLock` 惰性解析一次，进程内复用）。
struct Tables {
    /// 单字表：`char` → 该条**第一个候选**（`'static` 借用表文本，零拷贝）。
    chars: HashMap<char, &'static str>,
    /// 短语表：整段 key → 该条**第一个候选**（key 借用静态表文本，零拷贝）。
    phrases: HashMap<&'static str, &'static str>,
    /// 短语表最长 key 的**字符**数（扫描下界；无词条时为 0）。
    max_phrase_len: usize,
}

/// 惰性解析并缓存两张表（`OnceLock`：首次调用解析，其后零解析开销）。
fn tables() -> &'static Tables {
    static TABLES: OnceLock<Tables> = OnceLock::new();
    TABLES.get_or_init(Tables::parse)
}

impl Tables {
    /// 解析两张表并补算词表最长 key 长度（扫描上界）。
    fn parse() -> Self {
        let phrases = parse_phrase_table(TS_PHRASES);
        let max_phrase_len = phrases.keys().map(|k| k.chars().count()).max().unwrap_or(0);
        Self {
            chars: parse_char_table(TS_CHARACTERS),
            phrases,
            max_phrase_len,
        }
    }
}

/// 繁→简折叠 `to_simplified(s)`：先词后字、最长优先、取该条第一个候选；无映射原样保留。
///
/// 表的候选可能是**多个字符**（如 `㓰`/`侭`/`𫫇`），故两表的 value 类型都是 `&'static str`
/// 而非 `char`；逐字兜底用 `push_str` 写出，**不得**用 `char::from_u32(..).unwrap()` 强转（会静默
/// 丢掉多字符候选）。
///
/// **只用于比较侧衍生值**（`norm()` → 打分 / 同源去重 key / 组内排序）；不改写候选文本。
/// 纯 ASCII 与空串天然幂等（两表无 ASCII key）。
///
/// `pub`：供 `src-tauri/tests/searcher_simplified_tests.rs` 直接断言结构用例（同 `norm` 惯例；
/// 集成测试是独立 crate，仅 `pub` 可见）。
pub fn to_simplified(s: &str) -> String {
    let t = tables();
    if t.phrases.is_empty() && t.chars.is_empty() {
        return s.to_string();
    }
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < chars.len() {
        // 1) 短语最长优先：从 `min(max_phrase_len, 剩余长度)` 递减试长度，命中即整段替换。
        let upper = t.max_phrase_len.min(chars.len() - i);
        let mut matched = 0usize;
        for len in (2..=upper).rev() {
            let candidate: String = chars[i..i + len].iter().collect();
            if let Some(replacement) = t.phrases.get(candidate.as_str()) {
                out.push_str(replacement);
                i += len;
                matched = len;
                break;
            }
        }
        if matched != 0 {
            continue;
        }
        // 2) 逐字兜底：查单字表，取该条第一个候选；无映射原样保留。
        match t.chars.get(&chars[i]) {
            Some(replacement) => out.push_str(replacement),
            None => out.push(chars[i]),
        }
        i += 1;
    }
    out
}

/// 解析单字表：每条正文行 `key<TAB>候选...` → `HashMap<char, 第一个候选>`。
fn parse_char_table(text: &'static str) -> HashMap<char, &'static str> {
    let mut map = HashMap::new();
    for (key, candidates) in entries(text) {
        // 单字表只处理单字 key（多字 key 属短语表职责，见 opencc/README.md）。
        let mut it = key.chars();
        if let (Some(c), None) = (it.next(), it.next()) {
            if let Some(first) = candidates.split(' ').next() {
                if !first.is_empty() {
                    map.insert(c, first);
                }
            }
        }
    }
    map
}

/// 解析短语表：每条正文行 `key<TAB>候选...` → `HashMap<&'static str, 第一个候选>`。
fn parse_phrase_table(text: &'static str) -> HashMap<&'static str, &'static str> {
    let mut map = HashMap::new();
    for (key, candidates) in entries(text) {
        if let Some(first) = candidates.split(' ').next() {
            if !first.is_empty() {
                map.insert(key, first);
            }
        }
    }
    map
}

/// 逐行拆出 `(key, 候选串)`：跳过 `#` 注释行与空行；**先按单个 `\t` 切一次**，候选留在 value 侧。
///
/// 返回的 `key` 与 `candidates` 都**借用**入参（表文本是 `'static`，故下游 `HashMap` 零拷贝）。
fn entries(text: &'static str) -> impl Iterator<Item = (&'static str, &'static str)> {
    text.lines().filter_map(|line| {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() || line.starts_with('#') {
            return None;
        }
        // 关键：**只按单个制表符切一次**（key 与 value 之间是 TAB，候选之间是空格）。
        line.split_once('\t')
    })
}
