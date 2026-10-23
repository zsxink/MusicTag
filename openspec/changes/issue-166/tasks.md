# issue-166 任务（初始稿，Architect 细化）

## 1. 许可与披露文本
- [ ] 1.1 重写 `LICENSE` 为自洽自定义许可（D1 要素齐全、无矛盾授予），README 软件协议章节同步（docs）
- [ ] 1.2 README「外部 API 声明」扩充数据披露（字段/接收方/时机/不发送内容/离线行为）（docs）
- [ ] 1.3 `EulaDialog.vue` 协议要点增加数据披露一条 + 前端测试（Vue，在 2.x 之后）

## 2. 传输加密（Rust → Vue 顺序）
- [ ] 2.1 `kugou.rs` 三默认端点改 HTTPS；补/改单测断言默认端点 https（Rust）
- [ ] 2.2 全源端点扫描确认无明文 HTTP 生产端点（含封面下载路径）（Rust）

## 3. 合规与归属
- [ ] 3.1 新增 `docs/compliance/search-sources.md`：五源记录 + 未决事项（负责方=用户/法律顾问）（docs）
- [ ] 3.2 新增 `scripts/generate-third-party-notices.mjs` + 生成 `THIRD-PARTY-NOTICES.md`（Cargo 全量 + npm 运行时闭包 + 构建工具链 + 内嵌素材）（infra）
- [ ] 3.3 `src-tauri/tauri.conf.json` bundle resources 增加清单文件（infra）

## 4. 文档同步
- [ ] 4.1 `docs/V1-PRD.md` 增补合规与数据披露章节（docs）
- [ ] 4.2 `docs/design/design.md` 酷狗端点 https + 披露契约（docs）

## 5. 验证
- [ ] 5.1 `cargo check --all-targets` / `cargo test --all-targets` 通过（tester）
- [ ] 5.2 `npm run build` / `npm run test` 通过（tester）
- [ ] 5.3 notices 脚本幂等（重跑零 diff）（tester）
- [ ] 5.4 `npx tauri build --no-bundle` 配置校验通过（tester）
- [ ] 5.5 `openspec validate --all --strict` 通过（leader/spec-gate）
