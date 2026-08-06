#!/usr/bin/env node
// 模拟 claude -p 输出：读 FAKE_OUTPUT（默认成功结构化输出），FAKE_EXIT 控制退出码
const out = process.env.FAKE_OUTPUT || JSON.stringify({ type: 'result', structured: { ready: true, branch: 'demo', issues: [] } });
process.stdout.write(out);
if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
