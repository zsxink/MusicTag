# 任务（纯文档，单组）

## G1 README 文案替换

- [ ] 1.1 `README.md`：替换「项目简介」「核心特性」两节为产品文案 v2（见 design.md Decisions 1）；删除「目标播放器/无批量/无在线曲库/无账号」句
- [ ] 1.2 验证：`grep -n "目标播放器\|无批量\|无在线曲库\|无账号" README.md` 无命中；`git diff README.md` 确认保留技术栈/常用命令/文档入口/协作流程四节
- [ ] 1.3 提交：`git commit -m "docs(readme): 产品视角精简简介与特性"`（分支 readme-product-copy，PR Closes #87）
