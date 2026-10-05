// MusicTag — `service/searcher/simplified.rs` 繁→简折叠单测（fix-search-sources-locale D5/D6 外置）。
//
// 覆盖 spec「繁简归一化」的折叠算法 scenario：先词后字、最长优先、**取该条第一个候选**、
// 表内无映射原样保留、纯 ASCII / 空串幂等。
//
// **fixture 组与期望值必须与前端 `src/lib/simplified.test.ts` 完全相同**（design §5「两侧对称
// fixture」）——把「两条实现同规则」钉死，任何一侧漂移都会被对侧测试或本文件抓出。
//
// **每条 fixture 的判别力**（design §5 表，防「断言了但区分不出」的假覆盖）：
// - `乾`→`干`：字表 `乾 → 干 乾`，**取末位**得 `乾`、**取原字**得 `乾`、**只查词表**得原样 `乾`；
// - `乾紅`→`干红`：词表 `乾紅 → 干红 乾红`，**词表取末位**得 `乾红`。
//   ⚠️ 本条**只**钉「词表取首」：**「不查词表」区分不出**（字表有 `乾 → 干`、`紅 → 红`，
//   首候选已是 `干`/`红`，纯逐字亦得 `干红`）。区分「不查词表」请用 `一坏 → 一坯`；
// - `一坏`→`一坯`：**唯一能证明「词表优先于逐字」的干净结构断言**（纯逐字给 `一坏`，
//   先字后词也给 `一坏`）；
// - `沈陷`→`沉陷`：字表 `沈 → 沈 沉` 首候选是原字，逐字与词表在此字上相同，
//   区分点全在词表级映射（无词表则得 `沈陷`）；
// - `魔杰座`/`著作`：`杰`/`座`/`著` 两表皆无条目，任何多余替换都会改坏它（过度折叠守卫）。
//
// **不要**用 `乾隆` 证明「查了词表」：词表有恒等条目 `乾隆 → 乾隆`，纯逐字与先词后字**同结果**，
// 区分不出（能区分的只有纯逐字实现得 `干隆`）。本文件只把它当「词表恒等条目」的行为断言。

use app_lib::service::searcher::simplified::{TS_CHARACTERS, TS_PHRASES, to_simplified};

/// 两张表都被 `include_str!` 成功载入（非空、含注释行与正文行）——防表文件缺失/路径失效时
/// `to_simplified` 静默退化为「原样返回」而所有折叠断言假通过。
#[test]
fn tables_are_loaded_from_disk() {
    assert!(
        TS_CHARACTERS.len() > 100_000,
        "单字表应完整载入（实测 104520 字节），实际 {} 字节",
        TS_CHARACTERS.len()
    );
    assert!(
        TS_PHRASES.len() > 5_000,
        "词表应完整载入（实测 8835 字节），实际 {} 字节",
        TS_PHRASES.len()
    );
    assert!(
        TS_CHARACTERS.contains('\t') && TS_PHRASES.contains('\t'),
        "两表均应为上游 `key<TAB>候选` 格式"
    );
}

#[test]
fn folds_traditional_artist_and_album() {
    // 「不折叠」的判别用例：折叠后与简体本地标签逐字相等
    assert_eq!(to_simplified("周杰倫"), "周杰伦", "繁体艺人应折叠为简体");
    assert_eq!(to_simplified("葉惠美"), "叶惠美", "繁体专辑名应折叠为简体");
}

#[test]
fn multi_candidate_char_takes_first_candidate() {
    // 字表多候选取**首**：字表原文为 `乾 → 干 乾`、`劃 → 划 㓰`、`剋 → 克 剋`、
    // `儘 → 尽 侭`、`噁 → 恶 𫫇`。取末位/取原字/排序后取都会在这几条上错。
    assert_eq!(to_simplified("乾"), "干", "取该条第一个候选，非末位的 `乾`");
    assert_eq!(to_simplified("劃"), "划");
    assert_eq!(to_simplified("剋"), "克");
    assert_eq!(to_simplified("儘"), "尽");
    assert_eq!(to_simplified("噁"), "恶");
}

#[test]
fn multi_candidate_phrase_takes_first_candidate() {
    // 词表多候选取**首**：词表原文为 `乾紅 → 干红 乾红`、`龍鍾 → 龙钟 龙锺`。
    // 取末位会得 `乾红`/`龙锺`。
    // ⚠️ 本组**不能**区分「完全不查词表」：字表有 `乾 → 干`、`紅 → 红`、`龍 → 龙`、
    // `鍾 → 钟 锺` 且首候选已是 `干`/`红`/`龙`/`钟`，纯逐字亦得 `干红`/`龙钟`。
    // 区分「不查词表」请用 `一坏 → 一坯`。
    assert_eq!(to_simplified("乾紅"), "干红", "词表取首，非末位的 `乾红`");
    assert_eq!(to_simplified("龍鍾"), "龙钟", "词表取首，非末位的 `龙锺`");
}

#[test]
fn phrase_table_wins_over_per_character_folding() {
    // **结构断言**：词表优先于逐字的唯一干净判别用例。
    // 词表有 `一坏 → 一坯`；「先字后词」或「完全不查词表」都得 `一坏`（纯逐字查 `一`/`坏`，
    // 两表对这两字的首候选均非其自身映射）。故本断言**只能**由「先词后字」实现满足。
    assert_eq!(
        to_simplified("一坏"),
        "一坯",
        "词表 `一坏 → 一坯` 须整段命中，逐字路径得 `一坏`"
    );

    // 同族：字表 `沈 → 沈 沉` 首候选是原字（逐字与词表在此字上相同），
    // 区分点全在词表级映射 `沈陷 → 沉陷`（无词表则得 `沈陷`）。
    assert_eq!(to_simplified("沈陷"), "沉陷", "词表级映射须生效");
}

#[test]
fn unmapped_text_is_preserved() {
    // 表内无映射的字保持原样（spec「无映射保持原样」/ 过度折叠守卫）。
    // `杰`/`座`/`著` 在两表中**均无任何条目**（含作为词表 key），任何多余替换都会改坏它们。
    assert_eq!(to_simplified("魔杰座"), "魔杰座", "`杰`/`座` 两表皆无映射，须原样");
    assert_eq!(to_simplified("著作"), "著作", "`著` 两表皆无映射，是「无映射原样」的干净用例");
    assert_eq!(to_simplified("稻香"), "稻香");
    assert_eq!(to_simplified("晴天"), "晴天");
}

#[test]
fn ascii_and_empty_are_idempotent() {
    // 两表均无 ASCII key（design §2.5 实测）→ 纯 ASCII 恒原样、幂等。
    assert_eq!(to_simplified("Red Hot Chili Peppers"), "Red Hot Chili Peppers");
    assert_eq!(to_simplified("abc"), "abc");
    assert_eq!(to_simplified("Hello World"), "Hello World");
    // 空串边界：不 panic、不产生新字符
    assert_eq!(to_simplified(""), "");
    // 纯标点/数字（表内无映射）
    assert_eq!(to_simplified("0123456789"), "0123456789");
    assert_eq!(to_simplified("-_.,!?"), "-_.,!?");
}

#[test]
fn folding_is_idempotent() {
    // 折叠两次与折叠一次同结果（规范化的幂等性：比较侧反复 norm 不得漂移）
    for raw in [
        "周杰倫",
        "葉惠美",
        "乾紅",
        "龍鍾",
        "一坏",
        "沈陷",
        "魔杰座",
        "著作",
        "Red Hot Chili Peppers",
        "",
    ] {
        let once = to_simplified(raw);
        let twice = to_simplified(&once);
        assert_eq!(
            once, twice,
            "`{raw}` 折叠应幂等：一次得 `{once}`、二次得 `{twice}`"
        );
    }
}

#[test]
fn phrase_identity_entry_is_preserved() {
    // 词表恒等条目：`乾隆 → 乾隆`（词表原文如此）。按「先词后字」整段命中后逐字兜底不触发，
    // 故结果恒为 `乾隆`。
    //
    // ⚠️ 本断言**只**钉「词表恒等条目按词表整段处理」，**不**能区分「先词后字」与「只查词表」
    // （两者同结果）。证明「查了词表」请用 `一坏 → 一坯`。
    assert_eq!(to_simplified("乾隆"), "乾隆", "词表恒等条目应原样保留");
}

#[test]
fn mixed_text_folds_only_mapped_chars() {
    // 混合文本：逐字折叠不误伤未映射部分，且一次调用内多处命中
    assert_eq!(to_simplified("周杰倫 - 葉惠美 (Live)"), "周杰伦 - 叶惠美 (Live)");
    assert_eq!(
        to_simplified("稻香(周杰倫)"),
        "稻香(周杰伦)",
        "括号等 ASCII 部分须原样保留"
    );
    // 繁体全文串（不含 ASCII）同样逐字折叠
    assert_eq!(to_simplified("魔傑座"), "魔杰座");
}