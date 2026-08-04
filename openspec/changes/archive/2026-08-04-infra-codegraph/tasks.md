# infra-codegraph 任务清单

> 依赖顺序：**初始化 → explore 验证 → git 决策 → 回归验证**（纯 infra，串行；design.md「任务拆分建议」）。无 Rust/Vue 产品代码改动。

## 1. 建立索引

- [ ] 1.1 在仓库根执行 `codegraph init`（生成 `.codegraph/` 索引目录）
- [ ] 1.2 `codegraph status` 确认已初始化（Project 指向仓库根，非 "Not initialized"）

## 2. explore 验证（spec：`codegraph explore` 查询可命中符号）

- [ ] 2.1 `codegraph explore "save_song"` 命中 V1 既有符号，返回源码与调用路径（含命令注册、前端 invoke 落点）
- [ ] 2.2 另查一个前端符号（如 `store/song.ts` 的 `save`）确认前端侧同样命中
- [ ] 2.3 确认索引覆盖 `src/`（Vue）与 `src-tauri/`（Rust）两侧源码

## 3. git 决策落地（spec：`.codegraph/` 的 git 归属——忽略）

- [ ] 3.1 `.gitignore` 追加 `.codegraph/`（本地产物，与 `node_modules/`/`dist/`/`src-tauri/target/` 同策略；加注释说明是本地 codegraph 索引，可随时 `codegraph index` 重建）
- [ ] 3.2 `git status` 确认 `.codegraph/` 不再出现在未跟踪文件列表（忽略生效）
- [ ] 3.3 `codegraph explore` 在忽略后仍正常命中（git 忽略不影响工具读取）

## 4. 回归验证（spec：codegraph 索引不影响现有构建/验证）

- [ ] 4.1 `cargo check --manifest-path src-tauri/Cargo.toml` 通过（与索引建立前一致，无新增错误/警告）
- [ ] 4.2 `npm run build` 通过（`.codegraph/` 不被 Vite 当作源码打包）
- [ ] 4.3 `openspec validate` 通过（索引不干扰 `openspec/` 变更/规格生命周期）

## 5. 收尾

- [ ] 5.1 确认 git 仅有一个文件变更：`.gitignore`（无产品代码 diff）
- [ ] 5.2 PR 描述写明：`.codegraph/` 忽略决策及理由、`codegraph explore` 接入方式、`Closes #51`
