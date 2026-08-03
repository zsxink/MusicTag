## 1. Rust：rename_song command + service/rename.rs

- [ ] 1.1 `service/rename.rs`：`rename_song(old_path, new_name)` 业务——父目录解析、`new_path` 计算、新旧主干对比；`new_name` 防御校验（含 `/`、`\`、`..` → Err「文件名不合法」）；`service/mod.rs` 声明 `pub mod rename;`
- [ ] 1.2 撞名预检（任何 rename 前一次性完成）：`new_path.exists()` 或（旧 `.lrc` 存在且主干变）`new_lrc.exists()` → Err「目标已存在」，不执行 rename（禁止 POSIX 覆盖，FR-4.7）
- [ ] 1.3 `.lrc` 同步：复用 `service::lyrics::sidecar_lrc_path`；旧 `.lrc` 存在且新旧主干不同 → `.lrc` 一并 rename；纯扩展名变化 → `.lrc` 不动（FR-4.6a）
- [ ] 1.4 改名顺序 `.lrc` 先、音频后（失败自愈，D2）；任一失败返回中文 Err，原文件保留可重试
- [ ] 1.5 `commands/song.rs` 加 `rename_song` 薄壳（委托 service）；`lib.rs` `generate_handler![...]` 注册
- [ ] 1.6 集成测试 `src-tauri/tests/rename_song.rs`（复用 `tests/common` fixture）：音频+`.lrc` 一并改名 / 无 `.lrc` 仅音频 / 纯扩展名 `.lrc` 不动 / 音频撞名拒绝 / `.lrc` 撞名拒绝 / 失败原文件保留

## 2. 前端：文件名编辑 + 改名-保存联动

- [ ] 2.1 `lib/path.ts` 加 `replaceFileName(path, newName)`（跨 `/`/`\` 替换末段）+ 单测 `src/lib/path.test.ts`
- [ ] 2.2 `api/songs.ts` 加 `renameSong(path, newName)` 封装（`invokeCommand('rename_song', { path, newName })`）+ 单测参数透传
- [ ] 2.3 `store/song.ts`：新增 `pendingRename` / `renameRejected` 状态 + `setPendingRename` 动作 + `renamePending` 派生；`save(exportLrc, saveFn, renameFn)` 扩展（先改名→成功更新 path→再写标签；撞名→`renameRejected`+标签仍写原路径）；`open`/`activateFolder`/`undo` 重置
- [ ] 2.4 `FieldRow.vue` `file` 形态改可编辑 input（显示值 = `pendingRename ?? fileName(selectedPath)`、readonly 禁用、输入即 `setPendingRename`、`renameRejected` 行内 danger 提示「目标已存在」）
- [ ] 2.5 `EditorBar.vue` 保存门禁扩展 `dirty || exportPending() || renamePending()`
- [ ] 2.6 前端单测：store rename-save 流程（成功改名 path 更新 + dirty 归零、撞名标签仍写原路径、纯改名保存门禁、切歌/换目录/撤销重置）、FieldRow 编辑、EditorBar 门禁

## 3. 验证与收尾

- [ ] 3.1 `cargo test` + `cargo clippy`（rename_song 集成测试通过）
- [ ] 3.2 `npm run test` + `npm run build`（前端单测 + 结构守卫 design-layering/layering 不回归）
- [ ] 3.3 `npm run tauri dev` 人工确认：改名后 `.lrc` 同步、撞名拒绝提示、改扩展名 `.lrc` 不动、改名+标签联动保存
- [ ] 3.4 归档时同步 `docs/design/design.md` §10.4 未来子变更落位表：加 `v1-rename-sync` 行（Rust: `service/rename.rs` / 前端: `api/songs.ts`）
