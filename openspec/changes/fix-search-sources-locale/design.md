# Design: 搜索源可用性修复与中英文语种适配

GitHub Issue: #152
规格：`specs/search-sources/spec.md`（MODIFIED ×3、ADDED ×2）+ `specs/search-ui/spec.md`（MODIFIED ×2）

## 1. 范围与领域判定

域 **`both`**，顺序固定 **Rust → Vue**：Rust 侧先落地端点替换、封面解析、双店面合并、繁简折叠与聚合确定性，Vue 侧再接 C2 归一化镜像。前端 C2 的镜像必须**在 Rust 归一化落地之后**改——两侧规则一旦不同，C2 换源会出现「后端认为同曲、前端认为不同曲」的撕裂，测试无从判定谁对。

本变更只改**「搜得到什么」与「排序是否可信」**，不改触发时机、不改写盘行为、不改 command 签名与 `MusicSourceId` 枚举。候选配额、离线判定、点选填入、保存覆盖等 V1 约束逐条不动。

## 2. 实测输入（设计依据）

| 事实 | 证据 |
|---|---|
| QQ 搜索端点 HTTP 500 | `client_search_cp` 4/4 HTTPError；`search_for_qq_cp` 4/4 HTTP 200 / `code:0` / 10 条 / `songmid` 10/10 / `albummid` 8/10 / 0.36–0.51s |
| 酷狗响应**本就有**封面 | 40 条中 39 条 `Image` 非空；`imge.kugou.com` 32 条（专辑封面可用）、`singerimg.kugou.com` 7 条（歌手头像，须弃）；`{size}` 是字面占位符 |
| iTunes `country=CN` 结构性空 | 同一店面 `media=podcast`/`software` 正常，`entity=song`/`album` 恒 0（4 中文 + 4 英文 × 2 轮）；参数变体一律无效 |
| 语种与店面双向错配 | HK：稻香/晴天 ✅（繁体），Blinding Lights →「Abel Tesfaye」、Take Five →「戴夫・布魯貝克」；US：中文歌罗马音（Pu Shu / G.E.M.）或纯垃圾（屋顶 / Landy Wen） |
| 前端有一份平行归一化 | `src/store/song.ts:851 normalizeForMatch`，注释明写「对齐 Rust `searcher::norm`」，被 `findSameSong`（C2 身份校验，`:866`）使用 |

**代码现状复核（Architect 独立核验，2026-10-05，与实现者原文逐条对齐）**：

| 事实 | 核验结论 |
|---|---|
| `norm()` 管线 | `src-tauri/src/service/searcher/mod.rs:280`：`trim → to_halfwidth → to_lowercase`，`pub fn norm(s: &str) -> String`（**已 `pub`**，集成测试可直接断言，惯例已定）。`to_halfwidth` 为**模块私有** `fn`（`:289`）。**注**：mod.rs 头注释 `:6-9` 把 `to_halfwidth` 列入「提 pub」清单，实际未提——本变更不动它。 |
| `norm()` 调用点 | 生产代码**仅 7 处，全在 `aggregate()` 内**（`:385-387` 查询三项、`:393/398/399` 打分、`:408` 去重 key、`:440-441` 排序 tie-break）。测试侧 6 处（`searcher_mod_tests.rs:59-63/489`）。**无其它模块调用** → 加折叠不会外溢。 |
| `aggregate()` 现状 | `:379`。去重 key = `(c.source, norm(&c.title), norm(&c.artist))`（`:408`），`if score > entry.0` 严格大于 → **同分保留先到者**。排序比较器 `:437-442` 每次比较**重算两遍 `norm()`**（`norm(&a.1.title).cmp(&norm(&b.1.title))`）——D7 所述「复用」属实。 |
| `search_song_with_sources` 展开顺序 | `:170-174` **确为 `raw.values().flatten()`**，`raw` 是 `HashMap`（`:148`）→ 顺序不确定。D7 成立。`order` 数组已在 `:124-130` 存在，可直接复用，无需新造。 |
| `Itunes` 结构 | `itunes.rs:15-18`：`pub struct Itunes { pub search_url: String }`，`Default` 手写（`:20-26`）。**`search()` 是完全串行的单请求**（`:56` 单次 `send().await`），**无 JoinSet、无定序回填槽位先例**——D3 所称「与 `search_song_with_sources` 同一惯用法」在本文件内**无先例**，是首次引入（`search_song_with_sources` 的 JoinSet 是**跨源**，不是跨店面）。 |
| 现有 mock 助手 | `tests/common/mod.rs:30` `mock_http_once` / `:53` `mock_http_capture`，两者 accept 循环末尾**均有 `break`（各只服务 1 个请求）**，且响应字节**单一固定**（无法按 query 分流）。D5 §5 所述限制成立。 |
| `Itunes { search_url }` 字面构造 | **3 处**，全在 `tests/searcher_itunes_tests.rs:87/106/125`（`Itunes::default()` 另有 `:55`）。加 `storefronts` 字段后这 3 处**必须补字段**（Rust 无 `..Default::default()` 惯用法在此文件）。 |
| `country=CN` 断言 | **仅 1 处**：`searcher_itunes_tests.rs:99`（`:116` 只断言 term，无 country）。 |
| 酷狗封面断言 | **仅 1 处**：`searcher_kugou_tests.rs:149` `assert_eq!(s.cover_url, None, "酷狗搜索响应无封面 URL")`。错误注释在 `kugou.rs:213-214`。 |
| `MusicSourceId` / command 数 | `model.rs:120-127` **5 变体**（Netease/QqMusic/Kugou/Lrclib/Itunes）；`lib.rs:29-47` `generate_handler!` **17 条**。D/契约「零变化」可守。 |
| `md5` 依赖 | `Cargo.toml:38` `md5 = "0.7"` **已在**（酷狗签名用）。**无任何 OpenCC/zhconv 类依赖** → 本变更零新增依赖成立。 |
| `src/lib/` 目录 | **已存在**，含 `cover.ts` / `path.ts` / `theme.ts` + 三个同名 `.test.ts`。co-located 测试约定（`design.md §10.4:393`）**已满足**，无需新建目录。 |
| `src-tauri/` 表文件未被 gitignore | `.gitignore` 只忽略 `src-tauri/target/`、`src-tauri/gen/schemas/` → `git check-ignore` 确认 `opencc/*.txt` **不被忽略**，可入库分发。 |
| Vite 跨目录 `?raw` | **实测通过**（见 D6），非推断。 |

### 2.5 OpenCC 表数据事实（Leader 实测 + Architect 独立复核，SHA-256 逐条重算一致）

两个镜像（raw.githubusercontent 与 cdn.jsdelivr）逐字节一致。Architect 已下载并**独立重算 SHA-256**，与 Leader 所给完全相同：

| 文件 | 字节 | 正文条目 | 注释行 | SHA-256 |
|---|---|---|---|---|
| `TSCharacters.txt` | 104520 | 4148（另有 1 行空行） | 913 | `9ff46a7d30e5765375eb13d33f2b03a34d298913caf2b120380679f33ae1642d` |
| `TSPhrases.txt` | 8835 | 480（另有 1 行空行） | 6 | `9a23666e95c97dbf8668b5d71ca19f09f33b4f3a3aa9e05677dab4b608cef102` |

> **计数口径**：Leader 报的 4149 / 481 含那 1 行**非注释空行**；真正带 `<TAB>` 的条目行是 4148 / 480（已核：无重复行、无无 TAB 正文行）。README 记「4148 条 / 480 条」为准，两种口径差异在实现时无影响（解析器跳过空行）。

**已核实的数据特征（Architect 独立复核）**：

| 事实 | 值 | 对实现的影响 |
|---|---|---|
| 正文格式 | `key<TAB>候选1 候选2 ...`（制表符分 key/value，多候选用**单个空格**分隔） | 解析器按 `\t` 切一次、再按 `' '` 切候选；注意**不能用 `split_whitespace`**（key 与 value 之间是 TAB，但候选之间是空格，两者混用会导致 key 粘连） |
| 字表多候选条目 | 997 条；其中**首候选 ≠ 原字 70 条**、首候选 == 原字 927 条 | 「取第一个候选」必须真实实现（见 D5） |
| 词表多候选条目 | 10 条；首候选 ≠ 原字 6 条（`乾紅/徵調/情有獨鍾/老態龍鍾/鍾繇/龍鍾`） | 词表侧同样可断言取首 |
| 词表 key 长度 | `[2,3,4,5,6,7,8,10]`，**无单字 key** | 扫描下界取 2 |
| ASCII key | 两表**均为 0**（纯 ASCII 输入必然原样返回） | 幂等断言可用 `Red Hot Chili Peppers` |
| `@tofu-risk` 注释 | 字表头部含 896 处 | 解析器按 `#` 跳过即可 |
| `TSCharactersExt.txt` | 上游注释（第 10 行）声称会生成该表，但上游该文件**当前 404 不存在** | **README 不得声称存在该扩展表**；实现只用 `TSCharacters` + `TSPhrases` |
| `著` | 两表**均无任何条目**（含作为词表 key） | 原 spec/设计的 `著 → 着 著` 示例**不成立**，已按用户裁决修正 spec Scenario 示例为 `乾 → 干 乾`（见 §5 折叠 fixture 表） |

## 3. 决策记录

### D1 —— QQ 搜索端点换 `search_for_qq_cp`（同族、零签名、解析零改动）

`search_url` 默认值由 `https://c.y.qq.com/soso/fcgi-bin/client_search_cp`（`qqmusic.rs:27`）改为 `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp`。两接口同族、同 `data.song.list[]` 响应结构、同 `code` 顶层字段，`parse_search_response` / `is_error_response` / 取词路径**逐字不动**，只改默认字符串与文件头注释（`qqmusic.rs:1/3/18/50/109` 共 5 处提及旧端点名的注释/Doc 文本，含 `search()` 内联注释 `:50` 与 `parse_search_response` Doc `:109`——这些注释若不改会成为 spec scenario「端点失效不留旧路径」所述「代码中不再存在 `client_search_cp` 作为可用端点的表述」的漏网处）。

**否决**：迁 `musicu.fcg`（内层 `code:2001` 空响应的老问题）、自行签名（无必要，`search_for_qq_cp` 不签名）。

**保留**：`pub search_url` 注入点语义不变，Tester 的 HTTP 状态分支 mock 照旧。

### D2 —— 酷狗解析 `Image` 封面（并按 host 丢弃歌手头像）

`parse_search_response`（`kugou.rs:215`）的 `cover_url: None`（`:228`）改为从 `Image` 派生：

1. 取 `it["Image"]` 字符串；空/缺失 → `None`；
2. `{size}` **字面占位符** → `480`；
3. `http://` → `https://`（Issue #113 混合内容惯例：WKWebView 拦 http）；
4. host 为 `singerimg.kugou.com` → **`None`**（歌手头像不是专辑封面，混进封面网格会误导点选）；其余 host（`imge.kugou.com`）保留。

同时删掉 `kugou.rs:213-214` 里「酷狗搜索响应无封面 URL，点选走 download_cover 需另行构造，V1 封面搜索由其他源/前端兜底」的**事实错误陈述**（`searcher_kugou_tests.rs:149` 的断言消息同样要改）。

抽 `pub fn kugou_cover_url(raw: &str) -> Option<String>`（`pub` 是硬要求：`tests/searcher_kugou_tests.rs` 经 `app_lib::service::searcher::kugou::` 访问，集成测试是独立 crate 只看得到 `pub`——同 `parse_search_response` 惯例），供外置单测直接断言四类输入，避免把 URL 清洗逻辑埋进 map 闭包。

### D3 —— iTunes 改为 HK + US 双店面并发合并，**不做语种猜测**

取消 `country=CN`。固定店面序 **`["HK", "US"]`**，两店面**并发**请求，结果按店面序拼接（HK 在前），合并在 `Itunes` 源内部完成：

- `MusicSourceId` 仍是五变体，**不新增枚举值**；前端 badge 仍是「iTunes」，不显示店面；
- 两店面候选同属 `MusicSourceId::Itunes`，交由既有 `aggregate()` 的同源去重（D5 后繁简折叠参与 key）与每源 TOP 3 决定展示——**用户已拍板合并后仍截 TOP 3**；
- **失败语义**：两个店面都失败 → `Err`；任一成功 → `Ok(合并结果)`（含成功但空）；
- `source_stats` 记**合并后条数**（可能 >10，即 `limit=10` × 2 店面去重前）。

**为何不猜语种**：HK/US 的错配是双向的（中文歌只有 HK 有真货、西文歌只有 US 有规范艺名），任何单店面或标题启发式都会丢一半；「周杰伦 / Mojito」这种中文艺人 + 拉丁歌名的组合会让标题启发式直接猜错。两个都查、让打分决定，消除一整类猜错风险。

**店面并发用 `JoinSet` + 定序回填槽位**：`JoinSet` 的完成顺序不确定，必须按下标回填 `Vec<Option<_>>` 后再按店面序拼接，否则 HK/US 顺序随机 → 同分去重结果不可复现（同 D7）。

> **实现提示**：`JoinSet` 本身在本工程已有用例（`mod.rs:131` `search_song_with_sources` 跨五源并发），但那是**跨源**；`Itunes::search` 内的**跨店面定序回填是本次首次引入，无同文件先例**。可参照的既有形状是 `mod.rs:148-149` 的「先按固定序占位、再回填」，本处改为按店面序占位。
>
> **依赖已核**：`tokio` 的 `sync`/`rt` features（`Cargo.toml:31` 已含）足以用 `JoinSet`；`itunes.rs` 需新增 `use tokio::task::JoinSet;`（当前未 import）。

**已知边界（接受）**：`Itunes::search` 内部不设独立超时，整体受外层每源 6s 包裹。若**一个**店面挂起 6s，则整个 iTunes 源被丢弃（另一个店面的成功结果一并丢失）——这与现状单店面挂起即失败**同级**，非回归；iTunes 只是五源之一，其余四源正常出候选。
**否决**：顺序请求 + 分段预算（HK 3s、US 3s）——引入新的硬编码常量、正常路径延迟翻倍（0.4+0.4s）、且真·慢响应（4s）会被切成失败；**否决**：首个成功即返回（放弃另一店面）——需要 `select!` + 提前 abort 的复杂度，换来的只是极端网络下的边际收益。

### D4 —— `Itunes` 注入面扩一维（`storefronts: Vec<String>`）

```rust
pub struct Itunes {
    pub search_url: String,          // 两店面共用的 base（Tester 注入点，语义不变）
    pub storefronts: Vec<String>,    // 默认 ["HK", "US"]，按序并发、按序拼接
}
```

保持单一 `search_url`：店面靠 `country` 查询参数区分，mock 服务器按 query 分流即可（见 §5），无需按店面注入 URL。`Default`（`itunes.rs:20-26` 手写 impl）给 `vec!["HK".to_string(), "US".to_string()]`；外置测试可直接构造 `Itunes { search_url, storefronts }`。

**连带影响（须一并改，否则编译不过）**：`tests/searcher_itunes_tests.rs:87/106/125` 三处 `Itunes { search_url: url }` 字面构造在加字段后**缺字段报错**，必须补 `storefronts`（或改用 `Itunes { search_url: url, ..Default::default() }`）。测试侧建议用 `..Default::default()` 保持韧性与短断言。

### D5 —— 繁→简折叠进 `norm()`，**只作用于匹配与去重，不改展示文本**

`norm()` 新管线：`trim` → **繁→简折叠** → 全角转半角 → `to_lowercase`。

用途（三处，全部是「比较用」衍生值）：打分、同源去重 key、组内排序 tie-break。

**不改**：候选结构体字段、返回给前端的展示文本、点选后填入表单的文本。用户从 HK 候选点选到的仍是远端原文（如 `周杰倫` / `魔杰座`）——把远端文本改写成简体属于**写盘内容**决策，不在本变更（见 §7）。

折叠算法（两侧同规则，先词后字、最长优先）：

1. **短语优先**：在 `TSPhrases` 表上做最长匹配（长度 ≥2），命中即整段替换（取该条候选第 0 个）；
2. **逐字兜底**：未命中短语的单个字符查 `TSCharacters`，取该条的**第一个候选**；
3. 表内无此字/词 → 原样保留。

**算法按数据事实校准（Architect 已核，详见 §2.5）**：

- **词表 key 长度实测分布 = `[2,3,4,5,6,7,8,10]`，无单字 key**（480 条全为多字）→ 实现无需防「单字词条」，扫描下界取 2 安全。
- **字表 4148 条中 997 条为多候选，其中 70 条首候选 ≠ 原字**（`乾 → 干 乾`、`劃 → 划 㓰`、`剋 → 克 剋`、`儘 → 尽 侭`、`噁 → 恶 𫫇`）→ **「取第一个候选」是必须真实实现的规则**：取原字、取末位、或排序后再取，都会在这 70 条上错，而 `乾` 是最干净的一条。
- **词表侧亦有真实多候选取首**：`乾紅 → 干红 乾红`、`龍鍾 → 龙钟 龙锺`、`想像 → 想像 想象`（字表无 `紅/鍾/像` 的繁体键，逐字路径给不出这些结果）。
- **原设计的 `乾隆 → 干隆` 例子已作废**：词表实有恒等条目 `乾隆 → 乾隆`，按「先词后字」整段命中后逐字兜底不触发，正确结果恒为 `乾隆`。**不要**在 design/tasks 里再让 Dev 围绕它实现任何额外保护。

字表只处理**单字 key**，词表处理**多字 key**，避免逐字路径越权覆盖词表级映射（判别用例见 §5.2）。两侧都对同一组 fixture 断言，把「两条实现同规则」钉死。

### D6 —— 表数据**单一来源**，Rust 与 TS 各自原生加载

不生成两份语言各自的数据副本（会漂移），而是**一份上游原文件、两处加载**：

```
src-tauri/src/service/searcher/opencc/
  TSCharacters.txt     # OpenCC 上游原文（含 # 注释行），Apache-2.0
  TSPhrases.txt        # OpenCC 上游原文，Apache-2.0
  README.md            # 来源 URL + 版本/commit + 许可声明 + 校验方法
```

- **Rust**：`src-tauri/src/service/searcher/simplified.rs`
  `pub const TS_CHARACTERS: &str = include_str!("opencc/TSCharacters.txt");`（短语同理），
  `pub fn to_simplified(s: &str) -> String`，表用 `OnceLock` 惰性解析一次成
  `HashMap<char, &'static str>`（字）+ `HashMap<&'static str, &'static str>`（词，key 借用静态文本零拷贝）+ `max_phrase_len`。
  解析沿用上游 `#` 注释行约定：跳过空行与 `#` 开头行，按制表符/空白切 key 与候选。
- **TS**：`src/lib/simplified.ts`
  `import tsCharacters from '../../src-tauri/src/service/searcher/opencc/TSCharacters.txt?raw'`（短语同理），
  模块初始化时解析成同样两张 `Map`，导出 `toSimplified(s: string): string`。

路径可行性**已实测通过**（非推断，Architect 亲测后已清理探针）：`vite.config.ts` 无 `root` 覆盖 → `root = /Users/xian/Project/music/MusicTag`；Vite 5.4.21 `resolveServerOptions` 的 `fs.allow` 默认取 `searchForWorkspaceRoot(root)`，实测解析为 `["/Users/xian/Project/music/MusicTag"]`（该函数只认 `pnpm-workspace.yaml`/`lerna.json`/`package.json` 的 `workspaces` 字段，本工程及各级父目录**均无**，故回落到 repo 根）→ `src-tauri/` 在放行范围内。三条链路均实测通过：`npx vitest run`（解析成功）、`npx vue-tsc --noEmit`（`declare module '*?raw'` 由 `vite/client` 提供，`tsconfig.app.json:13` 已列 `types: ["vite/client"]`，**不改 tsconfig**）、`npx vite build`（探针文本逐字内联进 `dist/assets/*.js`，rollup 正常内联）。探针文件已全部删除，工作区干净。

**代价**：一份约 113KB 的 CJK 文本进前端 bundle（本地桌面应用，无感知；解析 ~5000 行用一次 `Map` 构建，毫秒级）。
**兜底（若未来构建链变更导致跨目录 `?raw` 不再放行）**：改为脚本 codegen 生成 `src/lib/simplifiedTables.ts`，并以一条 vitest 断言「生成物 == 上游 `.txt` 解析结果」守住漂移——仍是单一来源，只是加一层生成。

**许可**：已取上游 `LICENSE` 原文核对，OpenCC 字典为 **Apache-2.0**。与工程 `LICENSE`（BSL-1.1 衍生 + 「仅个人学习与研究用途、禁止再分发」附加限制）**同构相容**（Apache-2.0 允许再分发，故不触发 BSL 附加限制里「禁止再分发」的冲突面），但 `opencc/README.md` 必须保留来源与许可声明。
**否决**：引 `zhconv` crate / npm 包——其默认 feature 捆绑 **MediaWiki GPLv2+** 词表，与工程许可冲突；只开 `opencc-hans` 也仍为新增依赖，而本方案**零新增依赖**（用户已拍板）。

### D7 —— 聚合输入固定来源序（顺带修确定性缺陷）

`search_song_with_sources` 现用 `raw.values().flatten()` 遍历 `HashMap`——**迭代顺序不确定**，导致同分同 key 的候选（`if score > entry.0` 首插获胜）在不同运行间胜者不同，展示文本（album/cover_url）随之抖动；双店面合并后同类抖动会更多。改为按固定 `order` 数组 `[Netease, QqMusic, Kugou, Lrclib, Itunes]` 展开，iTunes 内部再按店面序（HK→US），全链路可复现。

`aggregate()` 内部同步做两件小事（都在同一函数、同一轮改动内）：

- 打分阶段已算出的 `norm(title)`/`norm(artist)` **复用于去重 key 与排序**，不再重复调用（现排序比较器里 `norm()` 每比较一次算一遍）；
- 去重 key 用 `(source, norm_title, norm_artist)`，**D5 之后繁简同曲会自然折叠**（如 HK 繁体条目与 US 简体条目在 iTunes 源内折叠为一条，保留最高分、同分首插即 HK）。

改完的排序仍是「来源分组 → 组内分降序 → 归一化 title → 归一化 artist」；组内 key 唯一（同源同 key 已去重），故排序结果唯一。

### D8 —— 失败与统计语义不变，只有 iTunes 内部多了「部分成功」

- `all_failed` 判定不变：iTunes **两店面全失败**才算该源失败（`None`）；任一成功（含空）即 `Ok`。
- `source_stats` 仍按固定来源顺序记条数；iTunes 记合并后条数。
- 单源 `search_source('itunes', …)` 同样走双店面（`Itunes::default()` 一处默认值，两条路径共享），返回合并后候选、仍截 `TOP_N`。
- 离线降级、6s 超时、失败降级空列表语义逐条不变。

### D9 —— **不折叠查询关键词**，只折叠比较侧

`join_query_terms` 输出保持原文（繁体标签 → 繁体关键词）。理由：各源自身的检索引擎已处理简繁，折叠关键词会改变召回集（如 `葉惠美` → `叶惠美` 在某些源是不同索引），属未实测的行为面。C2 换源真正的断点不在查询、而在**身份校验**——用繁体关键词查 mainland 源能拿回简体结果，只要比较侧折叠就能命中（D10）。

### D10 —— 前端 C2 归一化同步折叠（`search-ui` MODIFIED）

`src/store/song.ts:851 normalizeForMatch` 搬进 `src/lib/normalize.ts`（可单测），改为调用 `toSimplified()` 后再做全角半角 + 小写，与 Rust `norm()` 逐条对齐；`findSameSong`（`song.ts:866`）语义不变（防「同名不同歌」）。落位遵守 `design.md §10.0` 前端分层：`lib/` 是纯工具层、**无 Vue / IPC 依赖**（表里已有 `cover.ts` 等先例），`store → lib` 单向依赖已允许，`lib` 不得反向 import `store`/`api`。

**为何必须同步**：双语合并后，中文歌会长出 HK 的**繁体**候选。用户点选繁体候选 → 该候选无歌词（iTunes 恒 None）→ C2 按 `cand.title`/`cand.artist`（繁体）对 netease/qqmusic/kugou/lrclib 换源 → 这些源返回**简体**条目 → `findSameSong` 用旧归一化比较 `周杰倫 ≠ 周杰伦` → 判为「同名不同歌」→ 换源静默失败。不修，本变更就随手上线一个**新的可见失败模式**。

顺带把该 requirement 里陈旧的来源序 `netease→qqmusic→migu`（存量 spec `search-ui/spec.md:42`）修正为代码事实 `netease→qqmusic→kugou→lrclib`（iTunes 无歌词不入链）。

## 4. 落位清单

| 文件 | 动作 |
|---|---|
| `src-tauri/src/service/searcher/qqmusic.rs` | `search_url` 默认值 + 注释 |
| `src-tauri/src/service/searcher/kugou.rs` | 新增 `pub fn kugou_cover_url`，`parse_search_response` 用之，修正错误注释 |
| `src-tauri/src/service/searcher/itunes.rs` | `storefronts` 字段、双店面并发合并、删除硬编码 `country=CN` |
| `src-tauri/src/service/searcher/simplified.rs` | **新增**：`include_str!` 表 + `to_simplified` |
| `src-tauri/src/service/searcher/opencc/{TSCharacters.txt,TSPhrases.txt,README.md}` | **新增**：上游表 + 来源/许可说明 |
| `src-tauri/src/service/searcher/mod.rs` | 新增 `pub mod simplified;` 模块声明；`norm()` 接折叠；`search_song_with_sources` 固定序展开；`aggregate()` 复用归一化 + 去重/排序 |
| `src/lib/normalize.ts` | **新增**：前端归一化（含折叠），自 `song.ts` 迁出 |
| `src/lib/simplified.ts` | **新增**：`?raw` 加载同一份表 + `toSimplified` |
| `src/store/song.ts` | 改 import，删本地 `normalizeForMatch` |

不改：`model.rs`（`SongCandidate`/`MusicSourceId`/`SearchResult` 结构不变）、`commands/search.rs`（签名不变）、`lib.rs`（command 数仍 17）、`src/api/*`、任何组件、`src/lib/{cover,path,theme}.ts`。

## 5. 测试策略

**新增 Rust fixture（`tests/common/mod.rs`）**：现有一对 mock 助手（`mock_http_once`/`mock_http_capture`）**只服务一个请求**（写完即 `break`），双店面并发需要一次能应答多次、并**按 query 分流响应**的 mock：

```
pub fn mock_http_router(
    routes: impl Fn(&str) -> Vec<u8> + Send + 'static,   // 入参 = 请求目标（含 query）
    expected: usize,                                     // 应答次数后关闭
) -> (String, Arc<Mutex<Vec<String>>>)                   // 返回 base URL 与全部捕获请求目标
```

单线程 accept 循环顺序应答即可（并发连接落 backlog，不会死锁）。据此可写四类断言：

1. **双店面并发且按序拼接**：HK → 繁体 JSON、US → 简体 JSON，断言请求 **2 次**、`country` 分别命中 `HK`/`US`、返回序为 HK 在前；
2. **部分成功不判失败**：一路 500、一路 200 → `Ok`，只含成功店面候选；
3. **双失败才 `Err`**：两路 500 → `Err`，且 `search_song_with_sources` 侧 `all_failed` 语义不被误触；
4. **合并后同曲折叠**：HK/US 返回同一首歌（繁体/简体）→ 经 `aggregate` 后 iTunes 组内只剩一条。

**繁简折叠（两侧对称 fixture）**：Rust `tests/searcher_simplified_tests.rs` 与 `src/lib/simplified.test.ts` **必须用同一组用例与同一组期望值**（把「两条实现同规则」钉死）。按下表选用例——每条都标明它究竟能区分哪种错误实现，避免「断言了但区分不出」的假覆盖：

| 输入 | 期望输出 | 能钉死的错误实现 |
|---|---|---|
| `周杰倫` | `周杰伦` | 不折叠折叠（`artist_match` 会是 0 而非 0.4） |
| `葉惠美` | `叶惠美` | 不折叠 |
| `乾` | `干` | **取末位**（得 `乾`）、**取原字**（得 `乾`）、**只查词表不查字表**（词表无 `乾` → 原样） |
| `劃` / `剋` / `儘` / `噁` | `划` / `克` / `尽` / `恶` | 同上（多候选取首） |
| `乾紅` | `干红` | 词表多候选取**末位**（得 `乾红`）、不查词表 |
| `龍鍾` | `龙钟` | 同上 |
| **`一坏`** | **`一坯`** | **先字后词**、或**完全不查词表**（两者都得 `一坏`）——**这是唯一能证明「词表优先于逐字」的干净结构断言** |
| `沈陷` | `沉陷` | 同上（`沈` 字表首候选为原字 `沈 沉`，逐字与词表在此字上相同，区分点全在词表级映射） |
| `魔杰座` | `魔杰座` | 过度折叠（`杰`/`座` 两表均无映射，任何多余替换都会改坏它） |
| `著作` | `著作` | 同上（`著` 两表皆无，是「无映射原样」的干净用例） |
| `Red Hot Chili Peppers` | 原样 | ASCII 被误折叠 |
| `""` | `""` | 空串崩溃 / 边界 |

> **`乾隆` 不要用作「词表优先于逐字」的判别用例**：词表有恒等条目 `乾隆 → 乾隆`，故「只查词表」与「先词后字」**都得 `乾隆`**，区分不出两者（能区分的只有纯逐字实现得 `干隆`）。原设计 §5/§3 的相关表述已按实测删除。

`tests/searcher_mod_tests.rs` 补 `norm` 繁简折叠后 `artist_match("周杰伦", "周杰倫") == 0.4`（现状为 0）。

**确定性**：`search_song_with_sources` 同分同 key 候选在不同输入顺序下结果一致（固定序展开的回归断言）。

**前端 C2**：`src/lib/normalize.test.ts` 断言与 Rust 同 fixture；`src/store/song.test.ts` 补「繁体候选 → 简体换源结果命中同一首（不再被判同名不同歌）」与「Live 版/翻唱仍被拒」两条（旧行为不许被折叠放宽）。

**酷狗封面**：四类输入（正常 `imge` / `{size}` 替换 / `singerimg` 丢弃 / 空）单测。

**回归**：既有 `searcher_*_tests.rs` 中 3 处 `Itunes { search_url }` 字面构造（`searcher_itunes_tests.rs:87/106/125`）、1 处 `country=CN` 断言（`:99`）、1 处酷狗 `cover_url: None` 断言（`searcher_kugou_tests.rs:149`，含其断言消息）按新契约更新；每源 TOP 3 × 5 = 15 不变。`source_stats` 语义回归：iTunes 记**合并后条数**（spec「双店面全部失败」scenario 要求失败时记 0）。

## 6. 文档同步点（实现前先改）

- `docs/V1-PRD.md`：`:342` QQ 端点 → `search_for_qq_cp`；`:345` iTunes → `country=HK+US 双店面`；`:351` 归一化定义（trim + 全局半角 + 小写 **+ 繁→简（内嵌 OpenCC Apache-2.0 表）**）与去重/排序说明，**删「V1 不做简繁转换」**。
- `docs/design/design.md`：`:204` 聚合语义段落（归一化含繁简、来源固定序、iTunes 双店面合并后仍 TOP 3）；`:374` `search_song` 契约行；搜索源清单处（`:341-345`）补酷狗封面与 QQ 端点事实。
- `openspec/specs/search-sources/spec.md`、`openspec/specs/search-ui/spec.md`：由本变更 delta 承载（归档时生效）。

> **额外同步点（Architect 新发现）**：`openspec/specs/search-ui/spec.md` 存量正文有两处陈旧表述：
> - `:42` C2 场景写 `netease→qqmusic→**migu**`（咪咕已在 `search-sources-renewal` 下线，代码事实为 `netease→qqmusic→kugou→lrclib`）；
> - `:53/:56/:60` 离线降级写「**三源**全部网络失败 / 三源全失败 / 三源均成功」（现为五源，代码 `search_song_with_sources` 的 `all_failed` 口径即五源）。
>
> **Leader 裁决（2026-10-05）：无需任何额外改动。** OpenSpec 的 `MODIFIED` 是**整块替换**（`@fission-ai/openspec` 的 `core/specs-apply.js` 归档时执行 `nameToBlock.set(key, mod)`，用 delta 的 raw 覆盖同名 requirement 的全部正文与 scenario）。本 change 的 `search-ui` delta 恰有两个 MODIFIED requirement，把上述四处**全部**覆盖：
> - `:42` → 「取词失败自动换源（C2）」的「换源重试」scenario 已写 `netease→qqmusic→kugou→lrclib`；
> - `:53` → 「离线降级」Requirement 正文已写「五源全部网络失败」；
> - `:56`/`:60` → 「标记离线」「无结果不标离线」两 scenario 已写「五源全失败 / 五源均成功」，且额外补了 iTunes 仅两店面全失败才计失败的边界。
>
> 故归档后 canonical 文本即新文本，**不另开 change、不在本 change 的 `search-ui` delta 中追加 requirement**。

## 7. 风险、非目标与已知边界

**非目标（明确不做）**：

- **不改写盘内容**：不把繁体候选的展示/填入文本转成简体。真正「繁体唱片填繁体、简体标签填简体」是产品决策（用户可另择），本变更只让**匹配**跨简繁成立；填入的仍是用户点选的那条原文。
- 不新增店面角标、不做店面优先级配置、不加 `GB`/`JP` 等更多店面（HK/US 是实测覆盖中英文的最优二元组）。
- 不动 QQ 取词路径、不动 LRCLIB、不动 `download_cover` 限流、不动离线降级触发、不动候选配额与 UI。
- 不修 `search-ui` 里其它陈旧措辞（如候选区来源序以外的历史描述），只修本变更 requirement 波及处（C2 来源序、离线降级「三源」→「五源」与 `all_failed` 口径一致的笔误）。

**风险**：

| 风险 | 缓解 |
|---|---|
| 跨目录 `?raw` 被构建链拒绝 | **已实测通过**（vitest / vue-tsc / vite build 三链路，含 rollup 内联），非推断；D6 仍留 codegen 兜底以防未来构建链变更 |
| 繁简折叠把「本是两首不同的歌」折成同一条 | 折叠是逐字/词映射，只有繁简对应关系才折叠（非音译、非同义）；title 打分仍有包含/相等双重门槛，artist/album 继续加信号 |
| 多候选字**取首**可能取到非预期变体 | 「取首」是 OpenCC 自身语义（首个候选即最常用写法）；残留歧义（如 `沈 → 沈 沉` 取首为原字）只影响**打分与去重**，不影响写盘文本 |
| 双店面使 iTunes 组内同曲占位 | 合并后仍 TOP 3，重复项由繁简折叠（同文本）收敛；不同文本（`Abel Tesfaye` vs `The Weeknd`）保留两条，排前者为得分高者（US 规范艺名），属可接受信息冗余 |
| QQ 新端点再失效 | 与旧端点同族、同结构；`search_url` 仍是注入点，再换只改一行默认值（端点易碎是既有事实，见 `music-tag-search-sources` 记忆） |
| 表文件随仓库分发（约 113KB） | 已核**未被 `.gitignore` 排除**（只忽略 `src-tauri/target/`、`src-tauri/gen/schemas/`）；README 记录来源 + SHA-256 + Apache-2.0，供日后核验未被篡改/漂移 |
