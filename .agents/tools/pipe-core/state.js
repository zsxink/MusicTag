'use strict';
// 节点级状态文件读写、缓存键、dirty 失效、commit SHA 落地校验、仓库根判定。
// 状态文件路径一律以仓库根锚定（path.resolve(repoRoot, '.agents/runs/<change>/state.json')），
// worktree 并行场景同样写主仓库状态目录，不受子进程 --cwd 影响。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

const SCHEMA_VERSION = 1;

// 仓库根判定：① PIPE_CORE_REPO_ROOT（主编排器派生 worktree 子进程时注入主仓库绝对路径）
// → ② git rev-parse --show-toplevel（普通直跑）→ ③ 报错退出。
function repoRoot() {
  if (process.env.PIPE_CORE_REPO_ROOT) return process.env.PIPE_CORE_REPO_ROOT;
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return out;
  } catch (_) {
    // fallthrough
  }
  throw new Error('无法判定仓库根：既无 PIPE_CORE_REPO_ROOT，git rev-parse --show-toplevel 也失败');
}

function runsDir() {
  return path.resolve(repoRoot(), '.agents', 'runs');
}

function stateFile(change) {
  return path.resolve(runsDir(), change, 'state.json');
}

function newState(change, driver) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    change,
    driver,
    startedAt: now,
    updatedAt: now,
    nodes: {},
  };
}

function loadState(change) {
  const file = stateFile(change);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`state.json schemaVersion 不兼容：${raw.schemaVersion} !== ${SCHEMA_VERSION}`);
  }
  return raw;
}

// 原子写盘：先写同目录 .tmp 再 rename。
function saveState(change, stateObj) {
  const file = stateFile(change);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  stateObj.updatedAt = new Date().toISOString();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stateObj, null, 2));
  fs.renameSync(tmp, file);
}

function hash(...parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

// 节点缓存键 = hash(nodeId + 输入 hash + 源快照/git ref)。
function cacheKey(nodeId, inputHash, ref) {
  return hash(nodeId, inputHash || '', ref || currentHead());
}

function currentHead() {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return 'no-head';
  }
}

// 落地校验：commit 存在（cat-file -e）且是当前 HEAD 祖先（工作仍在历史里）。
// 判定根（cwd）可传——worktree 场景须传 worktree 路径：commit 对象在主仓库对象库（共享），
// 但 HEAD 是 worktree 分支 HEAD，merge-base 判定必须针对该分支（独立复核 M3/M1）。
function commitLanded(sha, root = repoRoot()) {
  if (!sha) return false;
  try {
    execSync(`git cat-file -e "${sha}^{commit}"`, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    execSync(`git merge-base --is-ancestor "${sha}" HEAD`, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (_) {
    return false;
  }
}

// 续跑：对每个 succeeded 节点校验落地；未落地 → 标记 failed（待重跑）。
// root 为判定根（默认 repoRoot；worktree 场景传 worktree 路径）。
function validateLandings(stateObj, root) {
  const dirty = [];
  for (const [id, node] of Object.entries(stateObj.nodes)) {
    if (node.status === 'succeeded' && !commitLanded(node.commitSha, root)) {
      dirty.push(id);
      node.status = 'failed';
      node.error = node.error || '落地校验失败：记录的 commit 不存在或已被重写';
    }
  }
  return dirty;
}

// dirty 失效：节点失败 → 标记自身 + 所有依赖它的节点 dirty（已通过且未污染节点复用结果）。
function markDirty(stateObj, defs, nodeId) {
  const dependents = (id) => defs.filter((d) => (d.dependsOn || []).includes(id)).map((d) => d.id);
  const queue = [nodeId];
  const visited = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = stateObj.nodes[id];
    if (node) {
      node.status = 'failed';
      node.dirty = true;
    }
    for (const dep of dependents(id)) queue.push(dep);
  }
  return [...visited];
}

module.exports = {
  SCHEMA_VERSION,
  repoRoot,
  runsDir,
  stateFile,
  newState,
  loadState,
  saveState,
  hash,
  cacheKey,
  currentHead,
  commitLanded,
  validateLandings,
  markDirty,
};
