## 1. Rust：封面选择与压缩

- [ ] 1.1 实现 `pick_cover_file() -> Option<CoverInput>` command（rfd 文件对话框，jpg/png/webp 过滤器，返回 bytes base64 + mime）
- [ ] 1.2 实现封面压缩函数 `compress_cover(bytes, mime) -> (bytes, mime)`：>5MB 或任一边 >2048 → 等比缩至 ≤2048×2048；失败保留原 bytes
- [ ] 1.3 拖拽路径支持：Rust command 读本地拖拽文件路径 → bytes → 压缩（与点击同路径）
- [ ] 1.4 注册 command 到 invoke_handler
- [ ] 1.5 单元测试：压缩边界（大图缩至 ≤2048、小图不变、压缩失败保留原 bytes、mime 保持）

## 2. 前端：封面区交互

- [ ] 2.1 `CoverPanel.vue`：点击封面区调 `pick_cover_file` → 预览；支持拖拽 drop
- [ ] 2.2 封面区显示 mime 信息与「点击选择 / 拖拽嵌入」提示；空态占位
- [ ] 2.3 封面预览数据写入 store current.cover（base64 data URL + cover_mime）
- [ ] 2.4 清空封面操作：置 null，保存后字段删除
- [ ] 2.5 预览后保存验证：`save_song` 把预览图嵌入（复用 v1-song-save 通道）

## 3. 验证

- [ ] 3.1 `cargo test` + `cargo clippy` 通过（压缩边界测试）
- [ ] 3.2 `npm run build` + `npm run test` 通过
- [ ] 3.3 `npm run tauri dev` 人工确认：点击选择/拖拽嵌入封面、大图压缩、保存后第三方工具验证嵌入正确
