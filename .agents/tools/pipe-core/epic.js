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

// 就绪子项：依赖全部 done 且自身未完成（done/running/failed/suspended 均不进入——D6：失败/挂起
// 子项不自动重试，由主会话决策后清除状态或重跑）。纯函数，供单测。
function readyItems(epic, st) {
  const items = epic.items || [];
  const statusOf = (name) => {
    if (st.items[name]) return st.items[name].status;
    const it = items.find((x) => x.name === name);
    return it ? it.status : 'unknown';
  };
  return items.filter((it) => {
    const s = statusOf(it.name);
    if (s === 'done' || s === 'running' || s === 'failed' || s === 'suspended') return false;
    return (it.dependsOn || []).every((dep) => statusOf(dep) === 'done');
  });
}

// 执行器入口。返回退出码（0 全部完成 / 非零有失败子项）。
async function run(epicName, driverName) {
  let epic;
  try { epic = loadEpic(epicName); } catch (e) { console.error(e.message); return 1; }
  // 依赖引用校验（复核2 minor：dependsOn 引用未知项名 → 静默退出 1 无诊断）：
  // 引用了 epic.items 里不存在的名字时，readyItems 恒判 'unknown' 非 done → 该子项永不就绪，
  // 全流程悄然卡死。此处显式报错，让操作者一眼看到依赖配错。
  const known = new Set((epic.items || []).map((it) => it.name));
  for (const it of epic.items || []) {
    for (const dep of it.dependsOn || []) {
      if (!known.has(dep)) {
        console.error(`✗ epic.json 依赖配置错误：子项「${it.name}」依赖不存在的子项「${dep}」`);
        return 1;
      }
    }
  }

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
  // 同步 epic.json 中已 done 子项到 epic-state（崩溃恢复不重跑已合并项）。
  // （复核2 minor：原 mergeOrder 死三元 `done ? null : null` 恒为 null，删除。）
  for (const it of epic.items || []) {
    if (!st.items[it.name]) {
      st.items[it.name] = {
        branch: it.name,
        worktree: null,
        status: it.status === 'done' ? 'done' : 'pending',
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
  let suspended = null; // 任一子项挂起（exit 3）→ 整 epic 挂起交主会话（D6）

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
      } else if (code === 3) {
        // 子项挂起（suspended，D6：CR 三轮等需用户决策）→ 语义透传：记 suspended + 原因，
        // 整 epic 返回 3，不折叠成 failed（独立复核：suspended 折叠丢挂起信号）。
        rec.status = 'suspended';
        rec.error = rec.error || '子项挂起，交主会话决策（见子项 worktree 运行日志 / epic-state.json）';
        if (!suspended) suspended = `${batchItems[i].name}（${rec.error}）`;
        console.error(`✗ 子项 ${batchItems[i].name} 挂起（suspended，交主会话决策）`);
      } else {
        rec.status = 'failed';
        rec.error = `子流程退出码 ${code}`;
        console.error(`✗ 子项 ${batchItems[i].name} 失败（exit=${code}），见 worktree 运行日志 / epic-state.json`);
      }
      saveEpicState(epicName, st);
    }
  }

  const allDone = (epic.items || []).every((it) => st.items[it.name] && st.items[it.name].status === 'done');
  if (suspended) {
    console.error(`✗ epic ${epicName} 有子项挂起（交主会话决策）：${suspended}`);
    return 3;
  }
  console.log(allDone
    ? `✓ epic ${epicName} 全部子项完成（batch=${batch}）`
    : `✗ epic ${epicName} 有失败/未完成子项（见 .agents/runs/${epicName}/epic-state.json）`);
  return allDone ? 0 : 1;
}

// 单个子项：worktree 准备（此间同步写 st.items[item.name].worktree 并落盘）→ 子进程完整 pipe
// → 成功后清理 worktree。异步 child_process.spawn + Promise 收尾（B2：批次内并发，替代旧 spawnSync 串行 for-loop）。
// 批次内多个子项并发执行，完成时间互不阻塞；run() 中每个子进程完成后单独串行写回该子项状态（独占 st），无并发写竞态。
// 崩溃恢复场景（running → pending 后重跑）：残留 worktree 存在时走 ensureBranch + rebaseMain 复用；
// 若中断时孤儿子进程仍在 worktree 内自行跑 pipe，pid 锁检测会拒绝双跑（见 acquirePidLock）。
function runItemAsync(epicName, item, driverName, st, main) {
  const wtPath = path.resolve(main, '.worktrees', item.name);
  try {
    // 孤儿双跑防护（独立复核 major）：父进程被杀后残留孤儿子进程可能仍在 worktree 内跑完整 pipe。
    // 续跑复用同一 worktree 前先检 pid 锁——孤儿仍存活 → 拒绝双跑（失败模式可检测，不静默损坏）；
    // 孤儿已退出 → 清理残留锁/孤儿 state 后正常续跑。
    const orphan = acquirePidLock(wtPath, item);
    if (orphan) {
      console.error(`✗ 子项 ${item.name} worktree 上存在存活孤儿进程（pid=${orphan.pid}，启动于 ${orphan.startedAt}）。` +
        `先等待其结束或手动终止，再续跑本 epic（避免同一 worktree/分支双跑）。`);
      return Promise.resolve(1);
    }
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
    // B2（独立复核阻断）：子项中途崩溃后其 .agents/runs/<item>/state.json 已存在，若重跑不带 --resume，
    // run.js 见状态文件存在会 exit 2 → 子项永久 failed。续跑时检测到子项 state.json 存在 → 自动追加 --resume。
    const itemState = stateApi.stateFile(item.name);
    const resume = fs.existsSync(itemState);
    const args = [runJs, item.name, '--driver', driverName, '--cwd', wtPath];
    if (resume) args.push('--resume');
    const child = spawn(process.execPath, args, {
      cwd: wtPath,
      env: { ...process.env, PIPE_CORE_REPO_ROOT: main },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    writePidLock(wtPath, item.name, child.pid);
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
    // 超时可配置（PIPE_EPIC_ITEM_TIMEOUT_MS，默认放宽）：完整子流水线含 CI 等待/gh pr merge，
    // 硬编码 30min 会误杀健康运行（独立复核 major）。先 SIGTERM 宽限期（默认 10s）再 SIGKILL。
    const timeoutMs = Number(process.env.PIPE_EPIC_ITEM_TIMEOUT_MS) || 90 * 60 * 1000;
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // SIGTERM 宽限：子进程自行收尾（落盘状态）后 close；未响应再 SIGKILL
      setTimeout(() => { if (!child.exitCode) child.kill('SIGKILL'); }, 10 * 1000);
    }, timeoutMs);
    child.stdout.on('data', (d) => pushTail('stdout', d));
    child.stderr.on('data', (d) => pushTail('stderr', d));
    child.on('error', (e) => { spawnErr = e; });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      releasePidLock(wtPath, item.name);
      if (spawnErr) {
        // error 事件后 close 也会触发：只在此处统一上报，避免重复日志
        console.error(`✗ 子项 ${item.name} 启动失败: ${spawnErr.message}`);
        resolve(1);
        return;
      }
      if (timedOut) {
        console.error(`✗ 子项 ${item.name} 执行超时（${Math.round(timeoutMs / 60000)}min SIGTERM→SIGKILL）`);
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

// —— 孤儿双跑 pid 锁 ——
// 锁文件：<worktree>/.pipe-lock.json。语义：
//   · spawn 成功后写 { pid, startedAt }；close 后删除。
//   · acquire（续跑复用同一 worktree 前）：锁存在且 pid 存活（process.kill 0）→ 返回孤儿信息（拒绝双跑）；
//     锁存在但 pid 已死 → 删除残留锁，返回 null（可正常续跑）。
// 副作用（已注释）：锁文件在 worktree 内，若孤儿未收尾就 `git worktree remove --force`，锁随目录删除，
// 但 `remove --force` 拒绝有未提交/未跟踪文件——锁文件本身能阻止误删（次要防护）。

function lockFile(wtPath) {
  return path.join(wtPath, '.pipe-lock.json');
}
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}
function writePidLock(wtPath, itemName, pid) {
  try {
    fs.mkdirSync(wtPath, { recursive: true });
    fs.writeFileSync(lockFile(wtPath), JSON.stringify({ pid, item: itemName, startedAt: new Date().toISOString() }));
  } catch (e) {
    console.error(`⚠ 子项 ${itemName} 写 pid 锁失败: ${e.message}（孤儿双跑防护降级，仍可运行）`);
  }
}
function releasePidLock(wtPath, itemName) {
  try {
    const lf = lockFile(wtPath);
    if (fs.existsSync(lf)) {
      const rec = JSON.parse(fs.readFileSync(lf, 'utf8'));
      if (!rec.pid || rec.pid === process.pid) fs.unlinkSync(lf);
      // 锁是别的 pid（理论上不会，spawn 后写）→ 不删，交给 acquire 判断孤儿
    }
  } catch (_) { /* 忽略清理失败 */ }
}
// 返回 null 表示无孤儿可续跑；返回孤儿信息表示拒绝双跑。
function acquirePidLock(wtPath, item) {
  const lf = lockFile(wtPath);
  if (!fs.existsSync(lf)) return null;
  let rec;
  try { rec = JSON.parse(fs.readFileSync(lf, 'utf8')); } catch (_) { return null; }
  if (rec && pidAlive(rec.pid)) return rec;
  try { fs.unlinkSync(lf); } catch (_) { /* 忽略 */ }
  return null;
}

module.exports = { run, readyItems, epicFile, epicStateFile, loadEpic, loadEpicState, saveEpicState, runItemAsync, MAX_CONCURRENCY, EPIC_SCHEMA_VERSION, lockFile, pidAlive, writePidLock, releasePidLock, acquirePidLock };
