## ADDED Requirements

### Requirement: 搜索源与加密 helper 对非法输入不 panic

搜索源 `search()` 的 URL 构造失败 SHALL 作为该源的错误返回（`Err(String)`），使 `source_stats` 记 0、`all_failed` 判定与网络失败一致，不影响其他源。网易云加密 helper（`rsa_encrypt` / `aes_ecb_encrypt` 等）SHALL 对调用方提供的非法输入返回错误或由类型约束排除，不使用 `expect` 直接 panic；固定常量与内部生成的合法输入行为不变。

#### Scenario: 注入的搜索 URL 无法解析

- **WHEN** 测试向某个搜索源注入非法 `search_url` 后调用 `search()`
- **THEN** 返回 `Err` 且不 panic，聚合时该源候选记 0，其他源结果不受影响

#### Scenario: 固定合法 URL 行为不变

- **WHEN** 使用默认搜索 URL 与正常标题/歌手/专辑
- **THEN** 请求构造与候选解析保持现有行为

#### Scenario: 非法加密输入

- **WHEN** 调用方传入非 16 字节 AES key 或非 hex secret
- **THEN** helper 返回中文错误或通过参数类型在编译期排除，不进程 panic

#### Scenario: 合法加密输入不变

- **WHEN** 使用内部固定密钥、随机 hex secret 与既有测试向量
- **THEN** `weapi`/`linuxapi` 输出与现有已知向量一致
