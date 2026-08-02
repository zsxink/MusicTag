## 1. Rust：rename_song command

- [ ] 1.1 实现 `rename_song(path, new_name) -> Result<(), String>` command：解析新路径，校验目标存在性（音频 + `.lrc`）
- [ ] 1.2 撞名拒绝：目标 `Path::exists()` → Err「目标已存在」，不执行 rename（禁止 POSIX 覆盖）
- [ ] 1.3 `.lrc` 同步改名：旧 `.lrc` 存在且新主干不同 → 一并 rename；纯扩展名变化 → `.lrc` 不动
- [ ] 1.4 改名失败（权限等）返回 Err；注册到 invoke_handler
- [ ] 1.5 单元测试：音频+`.lrc` 一并改名、无 `.lrc` 仅音频、纯扩展名变化 `.lrc` 不动、音频撞名拒绝、`.lrc` 撞名拒绝、失败原文件保留

## 2. 前端：文件名编辑 + 改名流程

- [ ] 2.1 文件名作为独立可编辑字段（FieldList 内）
- [ ] 2.2 改名字后保存流程：先 `rename_song`（撞名 Err → 顶栏「目标已存在」，标签仍写原路径）→ 成功才 `save_song` 新路径
- [ ] 2.3 store：改名字后 current.path / 列表项 path 同步；切歌/换目录重置
- [ ] 2.4 撞名提示 UI：保存时弹提示「目标已存在」，用户换名重试

## 3. 验证

- [ ] 3.1 `cargo test` + `cargo clippy` 通过（改名/撞名/.lrc 同步测试）
- [ ] 3.2 `npm run build` + `npm run test` 通过
- [ ] 3.3 `npm run tauri dev` 人工确认：改名后 `.lrc` 同步、撞名拒绝提示、改扩展名 `.lrc` 不动
