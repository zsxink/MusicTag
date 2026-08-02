## 1. Rust：save_song 写回

- [ ] 1.1 实现 cover base64 data URL 解码回 `Vec<u8>` + mime 探测
- [ ] 1.2 实现字段映射写回：FLAC Vorbis（TITLE/ARTIST/ALBUM/ALBUMARTIST/TRACKNUMBER/TRACKTOTAL/DATE/GENRE/LYRICS）、MP3 ID3v2.4（TIT2/TPE1/TALB/TPE2/TRCK/TDRC/TCON/USLT）
- [ ] 1.3 空字段移除：未 set 字段从既有标签清除（表单全量覆盖语义）
- [ ] 1.4 MP3 USLT：`ItemKey::UnsyncLyrics` + `set_lang(ENGLISH)`；不调用 `use_id3v23`
- [ ] 1.5 封面写盘：FLAC→PICTURE（CoverFront=3）/ MP3→APIC，原始字节嵌入
- [ ] 1.6 原子写回：写临时文件 → rename 替换原路径；写失败返回 `Err(String)` 不损坏原文件
- [ ] 1.7 实现 `save_song(song) -> Result<(), String>` command 并注册
- [ ] 1.8 单元测试：字段映射写回（FLAC/MP3 各一）、空字段清空、MP3 写后版本为 ID3v2.4、USLT lang=eng、封面嵌入后读回一致、写失败不损坏原文件

## 2. 前端：保存状态与撤销

- [ ] 2.1 store 增加 `saveState` 状态机（clean/dirty/saving/saved/save_failed）+ `save()` action（调 invoke save_song，传完整 Song）
- [ ] 2.2 EditorBar 保存状态渲染：dirty 琥珀 / 保存中 / ✓ 已保存 绿 / ✕ 保存失败：原因
- [ ] 2.3 保存失败：内容保留、仍可编辑可重试、dirty 保持 true、不假报已保存
- [ ] 2.4 撤销按钮：current 恢复为 original（编辑区内撤销），dirty 归 false
- [ ] 2.5 保存按钮禁用态：无 dirty 或 saving 时禁用（40% 透明）

## 3. 验证

- [ ] 3.1 `cargo test` + `cargo clippy` 通过（映射/清空/版本/USLT/封面/原子写测试）
- [ ] 3.2 `npm run build` + `npm run test` 通过
- [ ] 3.3 `npm run tauri dev` 人工确认：编辑字段保存后用 Kid3/mutagen 验证写回正确；清空字段保存后字段被删；失败场景提示正确
