'use strict';
// P3 子变更并行执行器：读 openspec/epics/<epic>/epic.json 的 dependsOn DAG → 每批就绪子项 ≤3 并行，
// 各在独立 git worktree + 独立分支跑完整 pipe 子流程（子进程 node run.js <item> --driver <driver> --cwd <worktree>），
// 派生时以 PIPE_CORE_REPO_ROOT 环境变量注入主仓库绝对路径（D1：worktree 内 .git 是文件指向主仓库，
// git rev-parse --show-toplevel 会解析成 worktree 自身路径，不能直接用作状态根）。
// epic 并行状态写 .agents/runs/<epic>/epic-state.json（版本控制外）；cursor 字段废弃（D4），
// 推进判定按就绪集/批次。崩溃恢复：读 epic-state 恢复未完成子项（中断时 running → pending 重新调度）、
// 不重跑已合并项（done 保留）。

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const stateApi = require('./state.js');
const worktree = require('./worktree.js');

const MAX_CONCURRENCY = 3;
const EPIC_SCHEMA_VERSION = 1;

function epicFile(epic) { return path.resolve(stateApi.repoRoot(), 'openspec', 'epics', epic, 'epic.json'); }
function epicStateFile(epic) { return path.resolve(stateApi.runsDir(), epic, 'epic-state.json'); }

function loadEpic(epic) {
  const file = epicFile(epic);
  if (!fs.existsSync(file)) throw new Error(`epic.json 不存在: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadEpicState(epic) {
  const file = epicStateFile(epic);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.schemaVersion !== EPIC_SCHEMA_VERSION) {
    throw new Error(`epic-state.json schemaVersion 不兼容：${raw.schemaVersion} !== ${EPIC_SCHEMA_VERSION}`);
  }
  return raw;
}

function saveEpicState(epic, st) {
  const file = epicStateFile(epic);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  st.updatedAt = new Date().toISOString();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
  fs.renameSync(tmp, file);
}

// 就绪子项：依赖全部 done 且自身未完成（done/running/failed 均不进入——D6：失败子项不自动重试，
// 由主会话决策后清除 failed 状态或重跑）。纯函数，供单测。
function readyItems(epic, st) {
  const items = epic.items || [];
  const statusOf = (name) => {
    if (st.items[name]) return st.items[name].status;
    const it = items.find((x) => x.name === name);
    return it ? it.status : 'unknown';
  };
  return items.filter((it) => {
    const s = statusOf(it.name);
    if (s === 'done' || s === 'running' || s === 'failed') return false;
    return (it.dependsOn || []).every((dep) => statusOf(dep) === 'done');
  });
}

// 执行器入口。返回退出码（0 全部完成 / 非零有失败子项）。
async function run(epicName, driverName) {
  let epic;
  try { epic = loadEpic(epicName); } catch (e) { console.error(e.message); return 1; }

  let st = loadEpicState(epicName);
  if (!st) {
    st = {
      schemaVersion: EPIC_SCHEMA_VERSION,
      epic: epicName,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: {},
    };
  }
  // 同步 epic.json 中已 done 子项到 epic-state（崩溃恢复不重跑已合并项）
  for (const it of epic.items || []) {
    if (!st.items[it.name]) {
      st.items[it.name] = {
        branch: it.name,
        worktree: null,
        status: it.status === 'done' ? 'done' : 'pending',
        mergeOrder: it.status === 'done' ? null : null,
      };
    }
  }

  // 崩溃恢复（D4）：本进程中断/被杀时，批次子项可能正停在 running（状态已落盘但子进程未收尾）。
  // 续跑把 running → pending 重新调度，使其可恢复；已合并项 done 保留不重跑。父进程死后残留的
  // 孤儿子进程可能仍在 worktree 内自行跑 pipe，runItemAsync 的 ensureBranch + rebaseMain 会
  // 与残留 worktree 上的进行中操作以 git 锁互相暴露冲突，保证不并写（见 runItemAsync 注释）。
  const resumed = [];
  for (const it of epic.items || []) {
    const rec = st.items[it.name];
    if (rec && rec.status === 'running') {
      rec.status = 'pending';
      resumed.push(it.name);
    }
  }
  if (resumed.length) {
    console.error(`[epic] 恢复中断批次：${resumed.join(', ')} running → pending（重新调度）`);
  }
  saveEpicState(epicName, st);

  const main = stateApi.repoRoot();
  let mergeSeq = (st.mergeSeq || 0);
  let batch = (st.batch || 0);

  for (;;) {
    const ready = readyItems(epic, st);
    if (!ready.length) break;
    const batchItems = ready.slice(0, MAX_CONCURRENCY);
    batch++;
    st.batch = batch;
    console.error(`[epic] batch ${batch}: ${batchItems.map((i) => i.name).join(', ')}`);

    // 批次内 ≤MAX_CONCURRENCY 并行（P3）：先同步把每项状态置 running 并启动子进程，
    // 再异步并发等待完成；写盘按完成顺序串行化（异步回调内独占 st），无并发写竞态。
    const recs = [];
    for (const item of batchItems) {
      const rec = st.items[item.name];
      rec.status = 'running';
      rec.startedAt = new Date().toISOString();
      recs.push(rec);
    }
    saveEpicState(epicName, st);

    const completed = await Promise.all(batchItems.map((item) => runItemAsync(epicName, item, driverName, st, main)));
    for (let i = 0; i < batchItems.length; i++) {
      const rec = recs[i];
      const code = completed[i];
      if (code === 0) {
        rec.status = 'done';
        rec.mergeOrder = ++mergeSeq;
        st.mergeSeq = mergeSeq;
        rec.completedAt = new Date().toISOString();
      } else {
        rec.status = 'failed';
        rec.error = `子流程退出码 ${code}`;
        console.error(`✗ 子项 ${batchItems[i].name} 失败（exit=${code}），见 worktree 运行日志 / epic-state.json`);
      }
      saveEpicState(epicName, st);
    }
  }

  const allDone = (epic.items || []).every((it) => st.items[it.name] && st.items[it.name].status === 'done');
  console.log(allDone
    ? `✓ epic ${epicName} 全部子项完成（batch=${batch}）`
    : `✗ epic ${epicName} 有失败/未完成子项（见 .agents/runs/${epicName}/epic-state.json）`);
  return allDone ? 0 : 1;
}

// 单个子项：worktree 准备（此间同步写 st.items[item.name].worktree 并落盘）→ 子进程完整 pipe
// → 成功后清理 worktree。异步 child_process.spawn + Promise 收尾（B2：批次内并发，替代旧 spawnSync 串行 for-loop）。
// 批次内多个子项并发执行，完成时间互不阻塞；run() 中每个子进程完成后单独串行写回该子项状态（独占 st），无并发写竞态。
// 崩溃恢复场景（running → pending 后重跑）：残留 worktree 存在时走 ensureBranch + rebaseMain 复用；
// 若中断时孤儿子进程仍在 worktree 内自行跑 pipe，rebase 与它的 git 写操作会经 git 锁冲突暴露，确保不并写。
function runItemAsync(epicName, item, driverName, st, main) {
  const wtPath = path.resolve(main, '.worktrees', item.name);
  try {
    if (fs.existsSync(path.join(wtPath, '.git'))) {
      worktree.ensureBranch(wtPath, item.name);
      worktree.rebaseMain(wtPath);
    } else {
      worktree.add({ worktreePath: wtPath, branch: item.name, main });
    }
  } catch (e) {
    console.error(`✗ 子项 ${item.name} worktree 准备失败: ${e.message}`);
    return Promise.resolve(1);
  }
  st.items[item.name].worktree = wtPath;
  saveEpicState(epicName, st);

  const runJs = path.join(__dirname, 'run.js');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runJs, item.name, '--driver', driverName, '--cwd', wtPath], {
      cwd: wtPath,
      env: { ...process.env, PIPE_CORE_REPO_ROOT: main },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 输出只留尾部窗口（每流约 64K 字符——JS 字符串 slice 按 UTF-16 码元计，多字节 UTF-8 内容
    // 实际内存可达标称 3 倍，仅影响诊断日志观感，不做逐字节截断），防话痨子进程无界增长
    // （原 spawnSync maxBuffer 128MB 的兜底）；超大单行（>64K）时 tail 从行中截断，最后一行可能残缺。
    const TAIL_BYTES = 64 * 1024;
    const tails = { stdout: '', stderr: '' };
    const pushTail = (key, d) => {
      tails[key] = (tails[key] + d).slice(-TAIL_BYTES);
    };
    let timedOut = false;
    let spawnErr = null;
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 30 * 60 * 1000);
    child.stdout.on('data', (d) => pushTail('stdout', d));
    child.stderr.on('data', (d) => pushTail('stderr', d));
    child.on('error', (e) => { spawnErr = e; });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (spawnErr) {
        // error 事件后 close 也会触发：只在此处统一上报，避免重复日志
        console.error(`✗ 子项 ${item.name} 启动失败: ${spawnErr.message}`);
        resolve(1);
        return;
      }
      if (timedOut) {
        console.error(`✗ 子项 ${item.name} 执行超时（30min SIGKILL）`);
        resolve(1);
        return;
      }
      if (code === null) {
        // 非超时的异常终止（外部信号等）：无退出码，仅保留 signal 信息
        console.error(`✗ 子项 ${item.name} 异常终止（无退出码，可能被信号打断）`);
        resolve(1);
        return;
      }
      if (code !== 0) {
        const tail = (tails.stderr || tails.stdout || '').trim().split('\n').slice(-20).join('\n');
        console.error(`✗ 子项 ${item.name} 退出码 ${code}\n${tail}`);
        resolve(code);
        return;
      }
      try {
        worktree.cleanup(wtPath, item.name, main);
      } catch (e) {
        console.error(`⚠ 子项 ${item.name} 清理 worktree 失败: ${e.message}（可手动 git worktree remove）`);
      }
      resolve(0);
    });
  });
}

module.exports = { run, readyItems, epicFile, epicStateFile, loadEpic, loadEpicState, saveEpicState, runItemAsync, MAX_CONCURRENCY, EPIC_SCHEMA_VERSION };
