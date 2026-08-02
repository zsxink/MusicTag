## 1. Rust：侧载 .lrc 关联读 + 同步写

- [ ] 1.1 增强 `lyrics_source` 判定：内嵌非空 → Embedded；否则同目录同名 `.lrc` 存在 → SidecarLrc 读文本；否则 None
- [ ] 1.2 `Song` 增加 `export_lrc: bool` 标志（保存参数，随 save_song 传入）
- [ ] 1.3 保存扩展：勾选 export_lrc 且歌词非空 → 写同目录同名 `.lrc`（UTF-8）；歌词为空 → 忽略复选框不生成空文件
- [ ] 1.4 并存同步：内嵌 + `.lrc` 并存时两边都写当前歌词文本；`.lrc` 写失败并入 `save_song` 的 Err
- [ ] 1.5 单元测试：侧载关联读（有/无 `.lrc`）、同步写 `.lrc`（命名去扩展名）、空歌词不写、`.lrc` 写失败报错、并存同步更新

## 2. 前端：LyricPanel 来源 badge + 复选框

- [ ] 2.1 `LyricPanel.vue` head 行：来源 badge（内嵌标签/侧载 .lrc/无）+ 「同时保存为 .lrc」复选框（默认不勾选）
- [ ] 2.2 歌词 textarea：等宽 mono（12.5px），LRC 时间标签原样编辑
- [ ] 2.3 store：`exportLrc` 状态随保存传参；切歌/换曲重置为默认不勾选
- [ ] 2.4 保存传参：勾选 + 非空歌词 → 通知 Rust 写 `.lrc`；失败并入保存失败状态

## 3. 验证

- [ ] 3.1 `cargo test` + `cargo clippy` 通过（侧载/同步写测试）
- [ ] 3.2 `npm run build` + `npm run test` 通过
- [ ] 3.3 `npm run tauri dev` 人工确认：内嵌优先读取、无内嵌关联 `.lrc`、复选框写 `.lrc`、空歌词不生成空文件
