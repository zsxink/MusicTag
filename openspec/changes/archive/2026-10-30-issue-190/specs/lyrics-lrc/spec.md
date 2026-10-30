## ADDED Requirements

### Requirement: 覆盖已有 .lrc 时保留其权限

勾选同步写 `.lrc` 且同名 `.lrc` 已存在时，原子替换 SHALL 在 rename 前保留该文件的原权限位；`.lrc` 不存在时 SHALL 保持现有新建文件行为。写 `.lrc` 失败时原 `.lrc` 内容与权限位 MUST 保持不变。

#### Scenario: 覆盖已有 .lrc 保留权限

- **WHEN** 同名 `.lrc` 已存在且权限位为 `0640`，用户勾选「同时保存为 .lrc」并保存
- **THEN** `.lrc` 内容更新为当前歌词，且权限位仍为 `0640`

#### Scenario: 新建 .lrc 行为不变

- **WHEN** 同名 `.lrc` 不存在，用户勾选同步写并保存
- **THEN** 正常生成 `.lrc`，不要求继承音频文件权限
