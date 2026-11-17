## ADDED Requirements

### Requirement: 目录监听锁异常时安全降级

目录监听状态锁（`FolderWatch.target`）若被毒化，SHALL NOT 使用 `into_inner()` 读取可能不一致的状态。应用退出路径 SHALL 安全跳过清理而不 panic；监听注册错误回调 SHALL 在锁异常时丢弃该次错误记录，不继续消费损坏状态。正常路径下替换监听与停止监听的行为不变。

#### Scenario: 退出时锁被毒化

- **WHEN** `FolderWatch.target` 已被毒化且应用收到 `RunEvent::Exit`
- **THEN** `shutdown()` 不 panic、不读取毒化后的 target，进程正常退出

#### Scenario: 注册错误回调时锁被毒化

- **WHEN** 后备 PollWatcher 注册期间收到错误，且错误记录锁已被毒化
- **THEN** 该次错误被丢弃，回调不 panic，监听注册流程按既有成功/失败语义继续

#### Scenario: 正常状态不受影响

- **WHEN** 锁未被毒化
- **THEN** 替换监听、停止监听与失效事件通知保持现有行为
