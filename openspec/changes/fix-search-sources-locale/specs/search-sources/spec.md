# search-sources Specification Delta

## MODIFIED Requirements

### Requirement: 打分去重排序
搜索结果 SHALL 按 title/artist/album 相等与包含打分，归一化（trim + 全角半角 + 小写折叠 + **繁→简折叠**，见「繁简归一化」requirement）**按来源分组去重**：**同一来源内**同曲（归一化 title/artist 相同）只保留该源得分最高一条；**不同来源之间不折叠**，各源候选各自保留。排序**先按来源分组**（Netease→QqMusic→Kugou→Lrclib→Itunes），组内按分降序；每源保留 TOP 3（最多 5×3=15 条）。album 参与打分时仅对非空 album 计分。聚合的输入候选 SHALL 按**固定来源顺序**展开（iTunes 源内部再按店面序 HK→US），使同分同曲的取舍与最终排序可复现。

#### Scenario: 打分排序
- **WHEN** 多源返回候选
- **THEN** 按打分（title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1 + album 相等 0.3）降序

#### Scenario: 同源去重
- **WHEN** **同一来源**返回同一首歌的两个版本（归一化 title/artist 相同，如网易云精确版 + 演唱会版）
- **THEN** 该源只保留得分最高的一条（精确匹配那条）

#### Scenario: 繁简同曲同源折叠
- **WHEN** **同一来源**（含 iTunes 双店面合并后的结果）返回同一首歌的繁体与简体两条（如 HK 的「稻香/周杰倫」与 US 的「稻香/周杰伦」）
- **THEN** 归一化后二者 key 相同，该源只保留得分最高一条（同分保留先出现的一条，即店面序在前的 HK）

#### Scenario: 繁简不影响跨源保留
- **WHEN** 两家**不同来源**分别返回同一首歌的繁体与简体条目
- **THEN** 仍按既有规则**各自保留、并排展示**（跨源不折叠），各带来源 badge

#### Scenario: 跨源保留（不折叠）
- **WHEN** **两家不同来源**返回同一首歌（如网易云 + QQ 都返回「粗糙|许嵩|安泊猜想」）
- **THEN** 两家候选**各自保留**、并排展示（各带来源 badge），互不折叠——封面候选因此能同时看到网易云/QQ/iTunes 的封面

#### Scenario: 空查询守卫
- **WHEN** 查询或候选 title/artist 为空
- **THEN** 不给匹配分（防空串互相包含的退化命中），title 零关联的候选被过滤

#### Scenario: album 加分仅限非空
- **WHEN** 候选 album 为空或查询 album 为空
- **THEN** album 维度不计分，排序仍由 title/artist 维度决定（空 album 不拉低或抬高排名）

#### Scenario: 每源上限与排序
- **WHEN** 五源各自返回 >3 条候选（iTunes 为两店面合并后的候选）
- **THEN** 每源只保留该源得分最高 TOP 3；列表按来源分组排序（Netease→QqMusic→Kugou→Lrclib→Itunes），组内按分降序，最多 15 条

#### Scenario: 结果可复现
- **WHEN** 同一批候选（含同分同曲的重复条目）以不同到达顺序执行聚合
- **THEN** 最终候选列表与顺序一致（固定来源序展开；组内同分按归一化 title/artist 稳定）

### Requirement: 酷狗签名搜索
酷狗源 SHALL 用 `complexsearch.kugou.com/v2/search/song` + MD5 签名（`NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt` secret 包裹参数字符串），返回候选含 `fileHash` 供后续取 KRC 歌词，并 SHALL 从响应既有 `Image` 字段派生封面 URL：`{size}` 字面占位符替换为 `480`、`http://` 升为 `https://`；host 为 `singerimg.kugou.com`（歌手头像）的条目 SHALL 视为无封面（`cover_url = None`）。签名纯 Rust 实现（`md5` 依赖），无 JS 引擎。

#### Scenario: 签名搜索
- **WHEN** 调用酷狗搜索
- **THEN** 用 MD5 签名参数请求，正常返回候选列表

#### Scenario: 签名错误降级
- **WHEN** 签名无效被拒（`error_code:20006`）
- **THEN** 该源计为失败、降级为空列表，不影响其余源

#### Scenario: 封面 URL 派生
- **WHEN** 候选条目含 `Image` = `http://imge.kugou.com/stdmusic/{size}/...jpg`
- **THEN** `cover_url` = `https://imge.kugou.com/stdmusic/480/...jpg`（占位符替换 + https 升级），可被封面候选网格展示与点选下载

#### Scenario: 歌手头像不入封面候选
- **WHEN** 候选条目 `Image` 指向 `singerimg.kugou.com`（歌手头像）
- **THEN** 该条 `cover_url = None`，不进入封面候选

#### Scenario: 无封面字段
- **WHEN** 候选条目 `Image` 缺失或为空
- **THEN** `cover_url = None`（与既有缺省行为一致），歌词候选不受影响

### Requirement: iTunes 封面源
iTunes Search SHALL 提供带封面 URL 的候选：`GET https://itunes.apple.com/search?term=<title> <artist> <album>&country=<店面>&media=music&entity=song`，其中店面 SHALL 并发查询 **HK 与 US 两个店面**（`country=HK`、`country=US`），店面序固定 HK 在前，两店面结果按序拼接后作为该源候选返回；`artworkUrl100` 作封面 URL（`100x100bb` → `600x600bb`），无歌词。任一店面成功即该源成功（含成功但空结果），两店面全部失败才计为该源失败。该源 SHALL NOT 依语种选择店面、SHALL NOT 新增来源枚举（前端 badge 仍为 iTunes），合并后候选仍受每源 TOP 3 截断约束。

#### Scenario: 双店面并发搜索
- **WHEN** 调用 iTunes 搜索
- **THEN** 并发发起两次请求，`country` 分别为 `HK` 与 `US`（不再使用 `CN`），`media=music`、`entity=song`、`term` 综合 title + artist + album

#### Scenario: 合并与店面序
- **WHEN** 两店面均返回候选
- **THEN** 候选按 HK 在前、US 在后拼接后返回；两店面属同一 iTunes 来源，同曲（归一化 title/artist 相同）在聚合的同源去重中折叠为一条，其余各自保留

#### Scenario: 部分成功
- **WHEN** 仅一个店面成功（另一店面超时/报错/被拒）
- **THEN** 返回成功店面的候选，该源计为成功（不计入 `all_failed`）

#### Scenario: 双店面全部失败
- **WHEN** 两店面均失败
- **THEN** 该源计为失败、降级为空列表，`source_stats` 记 0，不影响其余四源

#### Scenario: 搜索封面候选
- **WHEN** 调用 iTunes 搜索
- **THEN** 返回候选列表（title/artist/album/cover_url=`artworkUrl100` 经 `600x600bb` 高清替换）

#### Scenario: 无歌词降级
- **WHEN** 点选 iTunes 候选 `fetch_lyric`
- **THEN** 返回 None，前端 C2 换源从其他源取词（iTunes 不入换源链）

## ADDED Requirements

### Requirement: QQ 音乐搜索端点
QQ 音乐源的搜索 SHALL 使用 `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp`（公开 GET，`p`/`n`/`w`/`format=json`，零加密零签名），响应结构与既有解析一致（`data.song.list[]`：`songmid`/`songname`/`singer[].name`/`albumname`/`albummid`），顶层 `code != 0` 计为该源失败。已失效的 `client_search_cp` SHALL NOT 再用。取词路径（`fcg_query_lyric_new.fcg`）保持不变。

#### Scenario: 搜索端点可用
- **WHEN** 调用 QQ 音乐搜索（`w` 综合 title + artist + album）
- **THEN** 请求 `search_for_qq_cp`，正常返回候选（HTTP 200、`code:0`、`songmid` 非空），`albummid` 非空的候选带封面 URL

#### Scenario: 业务错误码降级
- **WHEN** 响应 HTTP 200 但顶层 `code != 0`（限流/风控）
- **THEN** 该源计为失败、降级为空列表，不误算「成功空」（离线判定依赖）

#### Scenario: 端点失效不留旧路径
- **WHEN** 审查 QQ 源默认配置
- **THEN** `search_url` 默认值为 `search_for_qq_cp`，代码与文档中不再存在 `client_search_cp` 作为可用端点的表述

### Requirement: 繁简归一化
搜索归一化 SHALL 在既有 trim + 全角转半角 + 小写折叠之前增加**繁→简折叠**，使繁体远端候选（如 iTunes HK 的「周杰倫/魔杰座」）与简体本地标签（「周杰伦」）可匹配。折叠 SHALL 使用内嵌的 OpenCC 字典（`TSCharacters` 字表 + `TSPhrases` 词表，Apache-2.0，随仓库分发并保留来源与许可声明），**零新增运行时依赖**；算法 SHALL 为**先词后字、最长优先**（多字词命中即整段替换；未命中则逐字查字表并取该条第一个候选；表内无映射则原样保留）。折叠 SHALL 只作用于比较侧（打分、同源去重 key、组内排序），SHALL NOT 改写候选的展示文本、SHALL NOT 改写点选后填入表单/写盘的文本。后端 `norm()` 与前端 C2 身份校验的归一化 SHALL 使用同一规则、同一份字典数据。

#### Scenario: 繁简艺人匹配
- **WHEN** 本地标签 artist = 「周杰伦」，远端候选 artist = 「周杰倫」
- **THEN** 归一化后二者相等，`artist_match` = 0.4（不折叠时为 0，中文歌走 HK 时最强信号丢失）

#### Scenario: 词表优先于逐字
- **WHEN** 折叠含词表条目的文本（如「乾隆」）
- **THEN** 按词表整体映射，不做逐字替换产生的误折；词表未覆盖的多字组合才回落逐字

#### Scenario: 多候选字取首
- **WHEN** 字表中一个繁体字对应多个简体候选（如 `著 → 着 著`）
- **THEN** 取该条第一个候选，前后端结果一致

#### Scenario: 无映射保持原样
- **WHEN** 文本为纯 ASCII、空串或表内无映射的字
- **THEN** 归一化输出与折叠前一致（幂等，不引入新字符）

#### Scenario: 只折叠比较侧
- **WHEN** 用户点选一条繁体候选并保存
- **THEN** 候选列表展示、填入表单与写盘的内容均为远端原文（如「周杰倫」），未被折叠成简体

#### Scenario: 前后端同规则
- **WHEN** 前端 C2 换源身份校验比较繁体点选候选与简体换源结果
- **THEN** 使用与后端 `norm()` 同规则的归一化判定为同一首（不再误判「同名不同歌」），Live 版/翻唱仍被判为不同
