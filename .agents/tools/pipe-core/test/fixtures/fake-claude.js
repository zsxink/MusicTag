#!/usr/bin/env node
// 模拟 claude -p 输出：读 FAKE_OUTPUT（默认成功结构化输出），FAKE_EXIT 控制退出码，
// FAKE_DELAY_MS（可选）延迟输出以模拟长任务（供异步 runAgent 超时/成功路径测试）。
// 字段名按真实 claude 契约：顶层 `structured_output`（下划线）。
const out = process.env.FAKE_OUTPUT || JSON.stringify({ type: 'result', structured_output: { ready: true, branch: 'demo', issues: [] } });
const delay = Number(process.env.FAKE_DELAY_MS || 0);
if (delay > 0) {
  setTimeout(() => {
    process.stdout.write(out);
    if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
  }, delay);
} else {
  process.stdout.write(out);
  if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
}