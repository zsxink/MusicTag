## ADDED Requirements

### Requirement: 菜单状态锁异常不静默清空

`MenuState` 锁被毒化时 SHALL NOT 以空状态或默认值掩盖异常：读取和快照 SHALL 明确记录锁异常；`sync_menu_state` 在未毒化路径上的启用/可见性同步行为不变。

#### Scenario: 毒化后读取菜单状态

- **WHEN** `MenuState` 锁已被毒化且有菜单事件到达
- **THEN** 不 panic，不把整份状态当作“全部禁用/空快照”，锁异常可被诊断

#### Scenario: 正常同步行为不变

- **WHEN** 锁未被毒化，前端提交 `save`/`rescan-folder`/`show-about` 状态
- **THEN** 菜单启用/可见性与内部状态按既有规则同步
