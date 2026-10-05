# OpenCC 繁简折叠字典（随仓库分发）

本目录两份 `.txt` 是 **OpenCC 上游原文**（未做任何本地修改），供
`src-tauri/src/service/searcher/simplified.rs` 用 `include_str!` 内嵌、供前端
`src/lib/simplified.ts` 用 `?raw` 加载同一份数据。**零新增运行时依赖**。

## 来源

| 项 | 值 |
|---|---|
| 上游项目 | Open Chinese Convert (OpenCC) |
| 仓库 | https://github.com/BYVoid/OpenCC |
| 文件目录 | `data/dictionary/` |
| 本目录文件 | `TSCharacters.txt`、`TSPhrases.txt` |
| 许可 | **Apache-2.0**（`License: Apache-2.0 (see LICENSE)`，见上游仓库根 `LICENSE`） |
| 抓取方式 | 上游原文直取（`raw.githubusercontent` / `cdn.jsdelivr` 两镜像逐字节一致） |

Apache-2.0 允许再分发，故可随本仓库分发；本 README 保留来源与许可声明以满足
上游 license 头部与再分发告知义务。**本目录文件不含本工程代码**，其著作权归 OpenCC 项目及其贡献者。

## 校验（SHA-256 与字节数）

```sh
shasum -a 256 src-tauri/src/service/searcher/opencc/TSCharacters.txt \
                src-tauri/src/service/searcher/opencc/TSPhrases.txt
wc -c    src-tauri/src/service/searcher/opencc/TSCharacters.txt \
                src-tauri/src/service/searcher/opencc/TSPhrases.txt
```

| 文件 | 字节数 | SHA-256 |
|---|---|---|
| `TSCharacters.txt` | 104520 | `9ff46a7d30e5765375eb13d33f2b03a34d298913caf2b120380679f33ae1642d` |
| `TSPhrases.txt` | 8835 | `9a23666e95c97dbf8668b5d71ca19f09f33b4f3a3aa9e05677dab4b608cef102` |

日后升级/替换表文件时**必须**同步更新上表并重跑两侧折叠断言。

## 解析格式（务必按此实现，勿用 `split_whitespace`）

正文行格式为 **`key<TAB>候选1 候选2 ...`**：

- `#` 开头的行是注释（字表头部含大量 `@tofu-risk` 注释行），**跳过**；
- 空行**跳过**（`TSCharacters.txt` 有 1 行非注释空行，`TSPhrases.txt` 同）；
- key 与候选列表之间是**单个制表符 `\t`**，候选之间是**单个空格 `' '`**。

因此解析**必须**「先按 `\t` `split_once` 一次拿到 `(key, value)`，再对 `value` 按单个空格 `' '` 切候选」。

> **不可用 `split_whitespace()`**：它会把 TAB 与空格一视同仁地连续切分，把 key 粘碎成碎片
> （如 `一坏\t一坯` 会被切成 `["一坏", "一坯"]` 混在一起而无法区分 key 与首个候选），
> 也会把多空格当作多个空候选。两侧（Rust / TS）必须同规则解析。

**多候选取第一个**：`TSCharacters.txt` 4148 条正文中 997 条为多候选，其中 **70 条首候选 ≠ 原字**
（如 `乾 → 干 乾`、`劃 → 划 㓰`、`剋 → 克 剋`、`儘 → 尽 侭`、`噁 → 恶 𫫇`）；
`TSPhrases.txt` 480 条正文中有 10 条多候选、6 条首候选 ≠ 原字（如 `乾紅 → 干红 乾红`、
`龍鍾 → 龙钟 龙锺`）。**「取该条第一个候选」是必须真实实现的规则**——取末位、取原字或排序后再取都会在这些条目上错。

## 折叠算法（两侧同规则）

**先词后字、最长优先**，只作用于比较侧（打分 / 同源去重 key / 组内排序），**不改写**候选的展示、
填入与写盘文本：

1. 以 `TSPhrases.txt` 做**最长匹配**（长度 ≥ 2；该表 key 长度实测分布 `[2,3,4,5,6,7,8,10]`，**无单字 key**），命中即整段替换为该条第一个候选；
2. 未命中短语的字符逐个查 `TSCharacters.txt`，命中即替换为该条第一个候选；
3. 表内无映射 → 原样保留（`著`、`杰`、`座` 在两表中均无条目）。

`TSPhrases.txt` 是**短语表**（多字 key），`TSCharacters.txt` 是**单字表**——字表只处理单字、
不越权覆盖词表级映射。

## 关于 `TSCharactersExt.txt`

`TSCharacters.txt` 第 10 行的上游注释声称「会生成 `TSCharactersExt.txt`」，但上游
`data/dictionary/TSCharactersExt.txt` **当前返回 404，该文件实际不存在**。因此：

- **本项目不使用、不声称存在该扩展表**；
- 折叠只依赖上面两份文件；
- 若日后上游真的发布了该文件，需先更新本文档的校验表与两侧 fixture，再引入。

## 数据事实备忘（供实现与评审核对）

- 两表**无任何 ASCII key** → 纯 ASCII 输入（如 `Red Hot Chili Peppers`）与空串天然幂等。
- `TSPhrases.txt` 480 条正文（6 行注释 + 1 行空行），`TSCharacters.txt` 4148 条正文
  （913 行注释 + 1 行空行）；计数口径为「真正带 `\t` 的条目行」，解析器跳过空行故无影响。
- 判别用例请用 `一坏 → 一坯`（唯一能干净证明「词表优先于逐字」的用例：纯逐字实现给 `一坏`）。
  **不要**用 `乾隆`：词表有恒等条目 `乾隆 → 乾隆`，「只查词表」与「先词后字」同结果，区分不出。
