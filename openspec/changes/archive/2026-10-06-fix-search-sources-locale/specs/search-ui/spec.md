# search-ui Specification Delta

## MODIFIED Requirements

### Requirement: 取词失败自动换源（C2）
点选候选取词失败（None）时 SHALL 自动换另一家来源重试同一首歌（按歌名+作者），不降级到低分候选；全源失败显示空态。换源身份校验的归一化 SHALL 与后端 `searcher::norm` 同规则（trim + 繁→简折叠 + 全角半角 + 小写），使繁体点选候选能匹配到简体换源结果，同时仍然拒绝「同名不同歌」。

#### Scenario: 换源重试
- **WHEN** 点选某候选取词返回 None
- **THEN** 按固定来源序（netease→qqmusic→kugou→lrclib，iTunes 无歌词不入链）跳过原源，对每家走单源 `search_source` 重搜同一首歌

#### Scenario: 繁体候选可匹配简体换源结果
- **WHEN** 点选的是繁体候选（如 iTunes HK 的「稻香/周杰倫」）取词失败，换源源返回简体条目（「稻香/周杰伦」）
- **THEN** 归一化后判定为同一首，取回该源歌词并填入（badge 更新为该源），不因简体差异误判为「同名不同歌」

#### Scenario: 同名不同歌拒绝
- **WHEN** 另一家源返回的候选与点选歌曲归一化 title/artist 不一致（如 Live 版/翻唱）
- **THEN** 跳过该源，不填「同名不同歌」的歌词（FR-8.8a）

#### Scenario: 全源失败空态
- **WHEN** 所有源取词均失败
- **THEN** 显示空态（如「未找到匹配的歌词，可手动粘贴」）

### Requirement: 离线降级（失败首响）
本会话第一次自动搜索**五源全部网络失败**（`all_failed=true`）时 SHALL 标记会话离线，后续选中不再自动搜、候选区不出现，界面提示「离线：仅手动填写」，只留手动搜索按钮。iTunes 源仅在 HK 与 US 两店面**全部失败**时才计为失败。

#### Scenario: 标记离线
- **WHEN** 会话内第一次自动搜索 `all_failed=true`（断网/五源全失败）
- **THEN** 标记会话离线，提示「离线：仅手动填写」，候选区不出现

#### Scenario: 无结果不标离线
- **WHEN** 五源均成功但无匹配候选（冷门歌，`all_failed=false`）
- **THEN** 不标记离线，仅显示空态且保留手动填写入口

#### Scenario: 后续不自动搜
- **WHEN** 会话已离线且用户再选中歌曲
- **THEN** 不再自动搜索，仅保留手动搜索按钮
