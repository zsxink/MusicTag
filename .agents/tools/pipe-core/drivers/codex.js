'use strict';
// codex driver：把一个 agent 节点翻译成 `codex exec` CLI 子进程 + 读 result 文件。
// D7：codex 把 roles/<role>.md 单源内容拼进 exec prompt；核心对落盘结果做二次 schema 校验。
// runAgent(task, ctx) → { ok, structured?, raw?, sessionId?, exitCode? }

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validate } = require('../schema.js');

// 纯函数：拼装 codex exec CLI 参数（供单测断言，不 spawn）。
// schemaFile/resultFile 由 runAgent 在临时目录生成。
function buildArgs(task, ctx = {}) {
  const args = ['exec', task.prompt, '--json'];
  if (ctx.cwd) args.push('--cd', ctx.cwd);
  if (ctx.sandbox) args.push('--sandbox', ctx.sandbox);
  if (task.schema && ctx.schemaFile) args.push('--output-schema', ctx.schemaFile);
  if (ctx.resultFile) args.push('-o', ctx.resultFile);
  if (ctx.model) args.push('--model', ctx.model);
  return args;
}

function runAgent(task, ctx = {}) {
  const bin = ctx.codexBin || 'codex';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-codex-'));
  let schemaFile = null;
  const resultFile = path.join(tmpDir, 'result.json');
  try {
    if (task.schema) {
      schemaFile = path.join(tmpDir, 'schema.json');
      fs.writeFileSync(schemaFile, JSON.stringify(task.schema));
    }
    const args = buildArgs(task, { ...ctx, schemaFile, resultFile });
    let res;
    try {
      res = spawnSync(bin, args, {
        encoding: 'utf8',
        cwd: ctx.cwd || process.cwd(),
        env: ctx.env || process.env,
        timeout: ctx.timeoutMs || 600000,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      return { ok: false, error: String(e), exitCode: null };
    }
    if (res.error) {
      return { ok: false, error: String(res.error), exitCode: res.status ?? null };
    }
    if (res.status !== 0) {
      // 认证/配置缺失显式上报，不静默降级
      return { ok: false, raw: res.stdout, error: res.stderr || `codex exec 退出码 ${res.status}`, exitCode: res.status };
    }
    if (!fs.existsSync(resultFile)) {
      return { ok: false, error: 'codex exec 未产出 result 文件', exitCode: res.status };
    }
    const raw = fs.readFileSync(resultFile, 'utf8');
    let structured;
    try {
      structured = JSON.parse(raw);
    } catch (_) {
      return { ok: false, error: 'codex result 文件非 JSON', raw, exitCode: res.status };
    }
    if (task.schema) {
      const v = validate(task.schema, structured);
      if (!v.valid) {
        return { ok: false, error: `codex 输出未通过 schema 二次校验: ${v.errors.join('; ')}`, raw, exitCode: res.status };
      }
    }
    return { ok: true, structured, raw, exitCode: res.status };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* 忽略清理失败 */ }
  }
}

module.exports = { runAgent, buildArgs };
