#!/usr/bin/env node
'use strict';
// 流水线 CLI 入口（模型无关核心，D5）：把「一个变更 / 一个 epic」驱动成 DAG 执行。
//   node run.js <change> --driver claude|codex [--resume] [--self-check]
//   node run.js --epic <epic> --driver claude|codex [--resume]
//   node run.js --self-check
// 环境自动感知：未显式 --driver 时按环境变量判断（CLAUDECODE → claude；AI_AGENT 含 claude/codex），
// 无法判断 → 要求显式指定，避免猜错（D5）。
// 退出码：0 成功 / 1 失败 / 2 用法错误 / 3 挂起（suspended，交主会话决策）。

const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const { runPipeline } = require('./core.js');
const pipeline = require('./pipeline.js');
const stateApi = require('./state.js');
const claudeDriver = require('./drivers/claude.js');
const codexDriver = require('./drivers/codex.js');
const selfcheck = require('./selfcheck.js');
const epicRunner = require('./epic.js');

const DRIVERS = { claude: claudeDriver, codex: codexDriver };
const ROLES_DIR = path.join(__dirname, 'roles');
let rolesIndex = {};
try {
  rolesIndex = JSON.parse(fs.readFileSync(path.join(ROLES_DIR, 'roles.json'), 'utf8'));
} catch (_) { /* 角色定义缺失时 wrapDriver 退化为无角色注入 */ }

// D5 环境自动感知。
function detectDriver() {
  if (process.env.CLAUDECODE) return 'claude';
  const agent = process.env.AI_AGENT || '';
  if (/claude/i.test(agent)) return 'claude';
  if (/codex/i.test(agent)) return 'codex';
  return null;
}

function parseArgs(argv) {
  const opts = { driver: null, resume: false, selfCheck: false, epic: null, change: null, cwd: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--driver') opts.driver = argv[++i];
    else if (a === '--epic') opts.epic = argv[++i];
    else if (a === '--resume') opts.resume = true;
    else if (a === '--self-check') opts.selfCheck = true;
    else if (a === '--cwd') opts.cwd = argv[++i];
    else if (a.startsWith('-')) { console.error(`未知参数: ${a}`); process.exit(2); }
    else if (!opts.change) opts.change = a;
    else { console.error(`多余参数: ${a}`); process.exit(2); }
  }
  return opts;
}

function printUsage() {
  console.error(
    '用法:\n' +
    '  node run.js <change> --driver claude|codex [--resume] [--self-check]\n' +
    '  node run.js --epic <epic> --driver claude|codex [--resume]\n' +
    '  node run.js --self-check\n' +
    '选项:\n' +
    '  --driver claude|codex   执行后端（未指定时按环境自动感知）\n' +
    '  --epic <epic>           epic 并行执行器（P3）\n' +
    '  --resume                续跑已存在状态（从失败/挂起节点继续）\n' +
    '  --self-check            静态自检（角色/节点定义/driver 契约/脚本语法），fail-closed\n' +
    '  --cwd <dir>             切换工作目录（epic worktree 场景由执行器注入）'
  );
}

function repoHead(root) {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return 'no-head';
  }
}

// 角色单源适配（D7）：claude 走 --append-system-prompt 注入 roles/<role>.md；
// codex 把 role 内容拼进 exec prompt。工具集/沙箱同样来自 roles.json（角色单源）。
function wrapDriver(driverName, driver, baseCtx) {
  return {
    runAgent(task, extraCtx = {}) {
      const ctx = { ...baseCtx, ...extraCtx };
      const role = rolesIndex[task.role];
      const roleFile = path.join(ROLES_DIR, `${task.role}.md`);
      let t = task;
      if (role) {
        ctx.allowedTools = role.allowedTools || [];
        ctx.sandbox = role.sandbox || 'workspace-write';
        if (driverName === 'claude') {
          ctx.roleFile = roleFile;
          ctx.permissionMode = role.sandbox === 'read-only' ? 'read-only' : 'acceptEdits';
        }
        if (driverName === 'codex' && fs.existsSync(roleFile)) {
          t = { ...task, prompt: `${fs.readFileSync(roleFile, 'utf8')}\n\n${task.prompt}` };
        }
      }
      return driver.runAgent(t, ctx);
    },
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.cwd) {
    try { process.chdir(opts.cwd); } catch (e) { console.error(`无法进入目录 ${opts.cwd}: ${e.message}`); process.exit(2); }
  }

  if (opts.selfCheck) {
    let root;
    try { root = stateApi.repoRoot(); } catch (e) { root = process.cwd(); }
    const res = selfcheck.run({ repoRoot: root });
    if (res.ok) {
      console.log('✓ self-check 通过（角色/节点定义/driver 契约/脚本语法均合法）');
      process.exit(0);
    }
    console.error('✗ self-check 失败（fail-closed）：');
    for (const e of res.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  if (opts.epic) {
    const driverName = opts.driver || detectDriver();
    if (!driverName) {
      console.error('--epic 需要 --driver claude|codex（环境无法自动判断）');
      process.exit(2);
    }
    process.exit(epicRunner.run(opts.epic, driverName));
  }

  if (!opts.change) { printUsage(); process.exit(2); }

  const driverName = opts.driver || detectDriver();
  if (!driverName) {
    console.error('无法自动判断 driver（环境无 CLAUDECODE/AI_AGENT 标记）。请用 --driver claude|codex 显式指定。');
    process.exit(2);
  }
  if (!DRIVERS[driverName]) { console.error(`未知 driver: ${driverName}（可选 claude|codex）`); process.exit(2); }

  const root = stateApi.repoRoot();
  const stateFile = stateApi.stateFile(opts.change);

  let state;
  if (opts.resume) {
    state = stateApi.loadState(opts.change);
    if (!state) { console.error(`无状态文件可续跑：${stateFile}`); process.exit(2); }
    const dirty = stateApi.validateLandings(state);
    if (dirty.length) console.error(`[resume] 落地校验 ${dirty.length} 个 succeeded 节点失败，标记重跑：${dirty.join(', ')}`);
  } else {
    if (fs.existsSync(stateFile)) {
      console.error(`状态文件已存在：${stateFile}\n如需续跑请用 --resume；确认重跑请先删除该文件。`);
      process.exit(2);
    }
    state = stateApi.newState(opts.change, driverName);
  }

  const driver = wrapDriver(driverName, DRIVERS[driverName], { cwd: root, model: process.env.PIPE_MODEL || undefined });

  const result = runPipeline({
    change: opts.change,
    state,
    defsFn: (s) => pipeline.buildPipeline(s),
    driver,
    logger: console.error,
    getHead: () => repoHead(root),
    maxConcurrency: 1, // 单变更 DAG 串行（epic 并行在 worktree 层）
  });

  console.error(`\n[${opts.change}] 结果：${JSON.stringify(result, null, 2)}`);
  if (result.status === 'success') { console.log(`✓ ${opts.change} 流水线成功`); process.exit(0); }
  if (result.status === 'suspended') {
    console.error(`✗ ${opts.change} 挂起：${result.decision && result.decision.reason ? result.decision.reason : result.reason}`.trim());
    process.exit(3);
  }
  console.error(`✗ ${opts.change} 失败：${result.reason || '未知原因'}`);
  process.exit(1);
}

main();
