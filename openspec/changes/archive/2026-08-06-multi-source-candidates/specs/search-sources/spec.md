# search-sources Delta — Issue #115：多源候选展示（各家内部聚合、跨源不折叠）

## MODIFIED Requirements

### Requirement: 打分去重排序
搜索结果 SHALL 按 title/artist/album 相等与包含打分，归一化（trim + 全角半角 + 小写折叠）**按来源分组去重**：**同一来源内**同曲（归一化 title/artist 相同）只保留该源得分最高一条；**不同来源之间不折叠**，各源候选各自保留。排序**先按来源分组**（Netease→QqMusic→Kugou→Lrclib→Itunes），组内按分降序；每源保留 TOP 3（最多 5×3=15 条）。album 参与打分时仅对非空 album 计分。

#### Scenario: 打分排序
- **WHEN** 多源返回候选
- **THEN** 按打分（title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1 + album 相等 0.3）降序

#### Scenario: 同源去重
- **WHEN** **同一来源**返回同一首歌的两个版本（归一化 title/artist 相同，如网易云精确版 + 演唱会版）
- **THEN** 该源只保留得分最高的一条（精确匹配那条）

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
- **WHEN** 五源各自返回 >3 条候选
- **THEN** 每源只保留该源得分最高 TOP 3；列表按来源分组排序（Netease→QqMusic→Kugou→Lrclib→Itunes），组内按分降序，最多 15 条
