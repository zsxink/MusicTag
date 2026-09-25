'use strict';

// The readable Markdown is rendered from a JSON record in an HTML comment. It
// needs no Markdown/YAML dependency and this module never launches a process.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROGRESS_SCHEMA_VERSION = 1;
const LOCK_SCHEMA_VERSION = 1;
const PHASES = Object.freeze(['bootstrap', 'architect', 'spec-gate', 'dev', 'tester', 'cr', 'verify', 'integrate']);
const PHASE_STATUSES = Object.freeze(['pending', 'running', 'succeeded', 'failed', 'suspended']);
const TASK_STATUSES = Object.freeze([...PHASE_STATUSES, 'needs-verification']);
const EPIC_ITEM_STATUSES = Object.freeze(['pending', 'running', 'done', 'failed', 'suspended']);
const EPIC_BLOCK_ITEM = '__pipe_native_dispatch_block__';
const SOURCE_FINGERPRINT_VERSION = 'pipe-source-fingerprint/v1';
const INTEGRATION_CHECKPOINTS = Object.freeze(['archive', 'commit', 'sync-main', 'push', 'get-or-create-pr', 'wait-required-ci', 'merge', 'verify-remote', 'cleanup-local']);
const CHECKPOINT_EVIDENCE_FIELDS = Object.freeze({
  archive: ['archivePath', 'sourceFingerprint', 'fingerprintVersion', 'manifestSha256', 'manifest'],
  commit: ['commitSha', 'sourceFingerprint', 'fingerprintVersion', 'manifestSha256', 'manifest'],
  'sync-main': ['mainHead', 'sourceFingerprint', 'fingerprintVersion', 'manifestSha256', 'manifest'],
  push: ['remote', 'branch', 'head', 'sourceFingerprint', 'fingerprintVersion', 'manifestSha256', 'manifest'],
  'get-or-create-pr': ['prNumber', 'prUrl', 'head', 'sourceFingerprint', 'fingerprintVersion', 'manifestSha256', 'manifest'],
  'wait-required-ci': ['prNumber', 'head', 'requiredChecks', 'conclusion', 'sourceFingerprint', 'fingerprintVersion', 'manifestSha256', 'manifest'],
  merge: ['prNumber', 'mergeSha', 'sourceFingerprint', 'fingerprintVersion', 'manifestSha256', 'manifest'],
  'verify-remote': ['prNumber', 'mergeSha', 'merged', 'sourceFingerprint', 'fingerprintVersion', 'manifestSha256', 'manifest'],
  'cleanup-local': ['worktreeRemoved', 'sourceFingerprint', 'fingerprintVersion', 'manifestSha256', 'manifest'],
});
const MACHINE_RECORD_START = '<!-- pipe-native-progress\n';
const MACHINE_RECORD_END = '\n-->';

class ProgressLockError extends Error {
  constructor(message, holder = null) {
    super(message);
    this.name = 'ProgressLockError';
    this.code = 'PIPE_PROGRESS_LOCKED';
    this.holder = holder;
  }
}

function now() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function validateSourceFingerprintEvidence(evidence, name = 'source fingerprint') {
  if (!evidence || evidence.fingerprintVersion !== SOURCE_FINGERPRINT_VERSION || !Array.isArray(evidence.manifest)) {
    throw new Error(`${name} 必须包含 fingerprintVersion=${SOURCE_FINGERPRINT_VERSION} 与 manifest 数组`);
  }
  const seenPaths = new Set();
  let previousPath = null;
  for (const entry of evidence.manifest) {
    if (!entry || typeof entry.path !== 'string' || !entry.path || !['file', 'symlink', 'deleted'].includes(entry.kind) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`${name} manifest 项必须包含有效 path/kind/sha256`);
    }
    if (seenPaths.has(entry.path) || (previousPath !== null && Buffer.compare(Buffer.from(previousPath), Buffer.from(entry.path)) >= 0)) {
      throw new Error(`${name} manifest 路径必须唯一并按 UTF-8 字节序严格递增`);
    }
    seenPaths.add(entry.path);
    previousPath = entry.path;
  }
  const manifestJson = JSON.stringify(evidence.manifest);
  const manifestSha256 = crypto.createHash('sha256').update(manifestJson).digest('hex');
  const fingerprint = crypto.createHash('sha256').update(`${SOURCE_FINGERPRINT_VERSION}\0${manifestJson}`).digest('hex');
  if (evidence.manifestSha256 !== manifestSha256 || evidence.sourceFingerprint !== fingerprint) {
    throw new Error(`${name} 的 manifestSha256/sourceFingerprint 与 manifest 不匹配`);
  }
  return { fingerprintVersion: SOURCE_FINGERPRINT_VERSION, sourceFingerprint: fingerprint, manifestSha256, manifest: clone(evidence.manifest) };
}
function assertRepoRoot(root) {
  if (!root || typeof root !== 'string') throw new Error('repoRoot 必须是非空路径');
  return path.resolve(root);
}
function assertChange(change) {
  if (typeof change !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(change)) throw new Error(`change 名称非法：${change}`);
  return change;
}
function assertOwner(owner) {
  if (!owner || typeof owner !== 'string' || !owner.trim()) throw new Error('owner 必须是当前主会话的非空标识');
  return owner.trim();
}
function assertStatus(status, allowed, name) {
  if (!allowed.includes(status)) throw new Error(`${name} 状态非法：${status}`);
  return status;
}
function runDir(root, change) { return path.join(assertRepoRoot(root), '.agents', 'runs', assertChange(change)); }
function progressFile(root, change, kind = 'change') {
  return path.join(runDir(root, change), kind === 'epic' ? 'epic-progress.md' : 'progress.md');
}
function lockFile(root, change) { return path.join(runDir(root, change), 'progress.lock'); }
function takeoverFile(root, change) { return path.join(runDir(root, change), 'takeover.pending.json'); }
function takeoverRecoveryFile(root, change) { return path.join(runDir(root, change), 'takeover.recovery.lock'); }
function legacyStateFile(root, change) { return path.join(runDir(root, change), 'state.json'); }
function emptyPhases() {
  return Object.fromEntries(PHASES.map((name) => [name, { status: 'pending', attempt: 0, agentId: null, allowedPaths: [], evidence: [] }]));
}
function normalizeIssue(issue) {
  if (issue === undefined || issue === null || issue === '') return null;
  const number = Number(issue);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Issue 编号非法：${issue}`);
  return number;
}
function newProgress(options) {
  const createdAt = now();
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    kind: options.kind || 'change',
    change: assertChange(options.change),
    issue: normalizeIssue(options.issue),
    branch: options.branch || options.change,
    worktree: options.worktree ? path.resolve(options.worktree) : null,
    host: options.host || null,
    owner: assertOwner(options.owner),
    createdAt,
    updatedAt: createdAt,
    phases: emptyPhases(),
    tasks: {},
    decisions: [],
    checkpoints: [],
    migration: null,
    epicItems: options.epicItems || {},
    nextStep: options.nextStep || '执行 bootstrap 并记录可核对的证据',
  };
}
function atomicWrite(file, contents) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  try { fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
// A hard-link claim is atomic and no-replace on a single filesystem.  Build a
// complete, fsynced temporary JSON file first so a crashed writer never leaves
// an empty or partially written lock/journal at the target path.
function atomicExclusiveJson(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.claim`);
  let descriptor;
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  try {
    fs.linkSync(temp, file);
    return true;
  } catch (error) {
    if (error && error.code === 'EEXIST') return false;
    throw error;
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function parseMachineRecord(markdown, file = 'progress.md') {
  const begin = markdown.lastIndexOf(MACHINE_RECORD_START);
  if (begin < 0) throw new Error(`${file} 缺少 pipe-native 机器记录`);
  const start = begin + MACHINE_RECORD_START.length;
  const end = markdown.indexOf(MACHINE_RECORD_END, start);
  if (end < 0) throw new Error(`${file} 的 pipe-native 机器记录未闭合`);
  try { return JSON.parse(markdown.slice(start, end)); }
  catch (error) { throw new Error(`${file} 的机器记录不是有效 JSON：${error.message}`); }
}
function validateProgress(progress) {
  if (!progress || typeof progress !== 'object') throw new Error('progress 必须是对象');
  if (progress.schemaVersion !== PROGRESS_SCHEMA_VERSION) throw new Error(`progress.md schemaVersion 不兼容：${progress.schemaVersion}`);
  assertChange(progress.change);
  assertOwner(progress.owner);
  if (!progress.phases || typeof progress.phases !== 'object') throw new Error('progress.md 缺少 phases');
  for (const phase of PHASES) {
    const record = progress.phases[phase];
    if (!record) throw new Error(`progress.md 缺少阶段 ${phase}`);
    assertStatus(record.status, PHASE_STATUSES, `阶段 ${phase}`);
    if (!Number.isInteger(record.attempt) || record.attempt < 0) throw new Error(`阶段 ${phase} 的 attempt 非法`);
  }
  return progress;
}
function loadProgress(root, change, kind = 'change') {
  const file = progressFile(root, change, kind);
  if (!fs.existsSync(file)) return null;
  const progress = parseMachineRecord(fs.readFileSync(file, 'utf8'), file);
  validateProgress(progress);
  if (progress.change !== change) throw new Error(`progress.md change 不匹配：${progress.change} !== ${change}`);
  if (progress.kind !== kind) throw new Error(`progress.md kind 不匹配：${progress.kind} !== ${kind}`);
  return progress;
}
function cell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replaceAll('|', '\\|').replaceAll('\\n', '<br>');
}
function evidenceSummary(record) {
  const last = (record.evidence || []).at(-1);
  return last ? cell(last.message || last.command || last.kind || '已记录') : cell(record.commitSha || record.verificationHead);
}
function firstIncompletePhase(progress) {
  return PHASES.find((phase) => progress.phases[phase].status !== 'succeeded') || null;
}
function renderProgress(progress) {
  validateProgress(progress);
  const phaseRows = PHASES.map((phase) => {
    const record = progress.phases[phase];
    return `| ${phase} | ${record.status} | ${record.attempt} | ${cell(record.agentId)} | ${evidenceSummary(record)} |`;
  });
  const taskEntries = Object.entries(progress.tasks || {});
  const taskRows = taskEntries.length ? taskEntries.map(([id, task]) => `| ${cell(id)} | ${cell(task.phase)} | ${task.status} | ${task.attempt || 0} | ${cell(task.owner)} | ${evidenceSummary(task)} |`) : ['| — | — | — | — | — | — |'];
  const decisions = (progress.decisions || []).length ? progress.decisions.map((item) => `- ${item.at}: **${cell(item.decision)}** — ${cell(item.question)}（依据：${cell(item.basis)}）`) : ['- 暂无。'];
  const checkpoints = (progress.checkpoints || []).length ? progress.checkpoints.map((item) => `- ${item.at}: \`${cell(item.id)}\` = **${cell(item.status)}**${item.evidence ? `；${cell(item.evidence.summary || item.evidence.type || item.evidence)}` : ''}`) : ['- 暂无。'];
  const migration = progress.migration ? [`- 来源：${cell(progress.migration.sourceFile)}`, `- 迁移时间：${cell(progress.migration.migratedAt)}`, `- 待核查候选：${progress.migration.candidates.length} 项；旧 state.json 保持原样。`] : ['- 无旧 state.json 迁移记录。'];
  return [
    '---', `schemaVersion: ${progress.schemaVersion}`, `kind: ${JSON.stringify(progress.kind)}`, `change: ${JSON.stringify(progress.change)}`,
    `issue: ${JSON.stringify(progress.issue)}`, `branch: ${JSON.stringify(progress.branch)}`, `worktree: ${JSON.stringify(progress.worktree)}`,
    `owner: ${JSON.stringify(progress.owner)}`, `updatedAt: ${JSON.stringify(progress.updatedAt)}`, '---', '',
    `# Native pipe progress: ${progress.change}`, '',
    'This file is written only by the main-session Agent. `tasks.md` remains the versioned delivery checklist.', '',
    '## Current checkpoint', '', `- Phase: \`${cell(firstIncompletePhase(progress) || 'complete')}\``, `- Next step: ${cell(progress.nextStep)}`, `- Owner: \`${cell(progress.owner)}\``, '',
    '## Phases', '', '| Phase | Status | Attempt | Agent | Evidence |', '| --- | --- | ---: | --- | --- |', ...phaseRows, '',
    '## Tasks', '', '| Task | Phase | Status | Attempt | Owner | Evidence |', '| --- | --- | --- | ---: | --- | --- |', ...taskRows, '',
    '## Decisions', '', ...decisions, '', '## Integration checkpoints', '', ...checkpoints, '', '## Resume checks', '', ...migration, '',
    'On recovery, compare this file with branch, worktree, commits, source files, OpenSpec tasks and remote PR/CI facts.', '',
    MACHINE_RECORD_START + JSON.stringify(progress, null, 2) + MACHINE_RECORD_END, '',
  ].join('\n');
}
function readJson(file, description) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${description} 无法读取：${error.message}`); }
}
function readLock(root, change) {
  const file = lockFile(root, change);
  if (!fs.existsSync(file)) return null;
  const lock = readJson(file, 'progress.lock');
  if (lock.schemaVersion !== LOCK_SCHEMA_VERSION || lock.change !== change || !lock.owner) throw new Error(`progress.lock 内容非法：${file}`);
  return lock;
}
function acquireLock(root, change, owner, details = {}) {
  const normalizedRoot = assertRepoRoot(root);
  const normalizedChange = assertChange(change);
  const normalizedOwner = assertOwner(owner);
  const file = lockFile(normalizedRoot, normalizedChange);
  const lock = { schemaVersion: LOCK_SCHEMA_VERSION, change: normalizedChange, owner: normalizedOwner, acquiredAt: now(), updatedAt: now(), ...details };
  if (atomicExclusiveJson(file, lock)) return lock;
  const holder = readLock(normalizedRoot, normalizedChange);
  if (holder && holder.owner === normalizedOwner) return holder;
  throw new ProgressLockError(`change ${normalizedChange} 正由 ${holder ? holder.owner : '未知会话'} 持有，不能并行写入`, holder);
}
function assertLockOwner(root, change, owner) {
  const lock = readLock(root, change);
  const normalizedOwner = assertOwner(owner);
  if (!lock) throw new ProgressLockError(`change ${change} 没有运行锁；拒绝写入进度`);
  if (lock.owner !== normalizedOwner) throw new ProgressLockError(`change ${change} 由 ${lock.owner} 持有，${normalizedOwner} 无权写入`, lock);
  return lock;
}
function touchLock(root, change, owner) {
  const next = { ...assertLockOwner(root, change, owner), updatedAt: now() };
  atomicWrite(lockFile(root, change), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
function releaseLock(root, change, owner) {
  assertLockOwner(root, change, owner);
  fs.unlinkSync(lockFile(root, change));
}
function writeLock(root, change, lock) {
  atomicWrite(lockFile(root, change), `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}
function readTakeover(root, change) {
  const file = takeoverFile(root, change);
  if (!fs.existsSync(file)) return null;
  const transaction = readJson(file, 'takeover.pending.json');
  if (transaction.change !== change || !transaction.id || !transaction.previousOwner || !transaction.owner) {
    throw new Error(`takeover.pending.json 内容非法：${file}`);
  }
  return transaction;
}
function createTakeover(root, change, transaction) {
  const file = takeoverFile(root, change);
  if (atomicExclusiveJson(file, transaction)) {
    return { transaction, created: true };
  }
  const existing = readTakeover(root, change);
  if (existing && existing.previousOwner === transaction.previousOwner && existing.owner === transaction.owner && existing.kind === transaction.kind) {
    return { transaction: existing, created: false };
  }
  throw new ProgressLockError(`已有接管事务 ${existing ? existing.id : 'unknown'} 正在由另一主会话执行，拒绝并发接管`, existing);
}
function acquireTakeoverRecovery(root, change, recovery) {
  const file = takeoverRecoveryFile(root, change);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const candidate = { ...recovery, host: os.hostname(), pid: process.pid };
  for (;;) {
    if (atomicExclusiveJson(file, candidate)) return candidate;
    const existing = readJson(file, 'takeover.recovery.lock');
    if (!existing.host || !Number.isInteger(existing.pid) || existing.pid <= 0) {
      throw new ProgressLockError('已有 stale takeover 恢复锁缺少可核验的 host/pid，拒绝删除或覆盖', existing);
    }
    if (existing.host !== candidate.host) {
      throw new ProgressLockError(`恢复锁属于远端主机 ${existing.host}，本机无法证明写入者已退出`, existing);
    }
    let alive;
    try { process.kill(existing.pid, 0); alive = true; }
    catch (probeError) {
      if (probeError && probeError.code === 'ESRCH') alive = false;
      else throw new ProgressLockError(`无法核验恢复锁进程 ${existing.pid} 是否存活，拒绝覆盖`, existing);
    }
    if (alive) throw new ProgressLockError(`已有恢复锁进程 ${existing.pid} 仍存活，拒绝并发恢复`, existing);
    const quarantine = path.join(path.dirname(file), `takeover.recovery.quarantine.${existing.id || 'unknown'}.${crypto.randomUUID()}.json`);
    try { fs.renameSync(file, quarantine); }
    catch (renameError) {
      if (renameError && renameError.code === 'ENOENT') continue;
      throw renameError;
    }
    // The old lock remains as evidence in quarantine. Retry with an exclusive
    // hard-link claim so only one recovery writer can proceed after a race.
  }
}
function appendTakeoverRecoveryEvidence(input, staleTransaction, recovery) {
  return [
    ...asEvidence(input),
    {
      recoveryId: recovery.id,
      recoveredTakeoverId: staleTransaction.id,
      previousTakeoverOwner: staleTransaction.owner,
      message: `已显式恢复中断的接管事务 ${staleTransaction.id}；确认旧写入会话已退出`,
    },
  ];
}
function requireEvidence(input, action) {
  const evidence = asEvidence(input).filter((item) => Object.entries(item).some(([key, value]) => key !== 'at' && (typeof value !== 'string' || value.trim())));
  if (!evidence.length) throw new Error(`${action} 必须记录至少一条非空 evidence`);
  return evidence;
}
function takeoverProgress(root, change, owner, previousOwner, confirmedNoLiveWriter, options = {}) {
  const nextOwner = assertOwner(owner);
  const oldOwner = assertOwner(previousOwner);
  const kind = options.kind || 'change';
  if (nextOwner === oldOwner) throw new Error('接管 owner 必须与 previous-owner 不同');
  if (confirmedNoLiveWriter !== true) throw new Error('接管必须显式确认 confirmed-no-live-writer=true');
  requireEvidence(options.evidence, '接管');
  const activeRecovery = fs.existsSync(takeoverRecoveryFile(root, change)) ? readJson(takeoverRecoveryFile(root, change), 'takeover.recovery.lock') : null;
  if (activeRecovery && options._recoveryClaim !== activeRecovery.id) {
    const progress = loadProgress(root, change, kind);
    const lock = readLock(root, change);
    const pendingJournal = readTakeover(root, change);
    const ownershipAgrees = Boolean(progress && lock && progress.owner === lock.owner);
    const cleanupRetryMatches = activeRecovery.operation === 'cleanup-completed' && activeRecovery.completedRecoveryId && activeRecovery.previousOwner === oldOwner
      && ownershipAgrees && [oldOwner, activeRecovery.owner].includes(progress.owner)
      && (!pendingJournal || (pendingJournal.previousOwner === oldOwner && pendingJournal.owner === nextOwner));
    const completedJournal = Boolean(pendingJournal && pendingJournal.owner === oldOwner && pendingJournal.id && ownershipAgrees && progress.owner === oldOwner);
    const completedCleanupCanStartNextTakeover = activeRecovery.operation === 'cleanup-completed' && activeRecovery.completedRecoveryId
      && activeRecovery.owner === oldOwner && (!pendingJournal || completedJournal) && ownershipAgrees && progress.owner === oldOwner;
    const completedRecovery = Boolean(
      (activeRecovery.staleTakeoverOwner && !pendingJournal && ownershipAgrees && progress.owner === activeRecovery.owner) || cleanupRetryMatches || completedCleanupCanStartNextTakeover,
    );
    if (!completedRecovery) throw new ProgressLockError(`stale takeover 恢复事务 ${activeRecovery.id} 正在执行，拒绝并发接管`, activeRecovery);
    const cleanup = acquireTakeoverRecovery(root, change, {
      schemaVersion: 1, id: `completed-recovery-cleanup-${crypto.randomUUID()}`, operation: 'cleanup-completed', change, kind,
      previousOwner: oldOwner, historicalPreviousOwner: activeRecovery.previousOwner,
      rootRecoveryId: activeRecovery.rootRecoveryId || activeRecovery.completedRecoveryId || activeRecovery.id,
      completedRecoveryId: activeRecovery.rootRecoveryId || activeRecovery.completedRecoveryId || activeRecovery.id,
      owner: nextOwner, confirmedNoLiveWriter: true, evidence: asEvidence(options.evidence), createdAt: now(),
    });
    try {
      if (completedCleanupCanStartNextTakeover && completedJournal) {
        const journalFile = takeoverFile(root, change);
        const archivedJournal = path.join(runDir(root, change), `takeover.completed.${pendingJournal.id}.json`);
        fs.renameSync(journalFile, archivedJournal);
      }
      return takeoverProgress(root, change, nextOwner, oldOwner, confirmedNoLiveWriter, { ...options, _recoveryClaim: cleanup.id });
    } finally {
      const file = takeoverRecoveryFile(root, change);
      if (fs.existsSync(file) && readJson(file, 'takeover.recovery.lock').id === cleanup.id) fs.unlinkSync(file);
    }
  }
  let transaction = readTakeover(root, change);
  let createdTransaction = false;
  if (!transaction) {
    const lock = readLock(root, change);
    const progress = loadProgress(root, change, kind);
    if (!progress) throw new Error(`progress.md 不存在；不能接管：${progressFile(root, change, kind)}`);
    const normallySuspended = PHASES.some((phase) => progress.phases[phase].status === 'suspended');
    if (!lock && !normallySuspended) throw new ProgressLockError(`change ${change} 没有运行锁且不在正常 suspended 状态；不能安全接管`);
    if ((!lock && progress.owner !== oldOwner) || (lock && (lock.owner !== oldOwner || progress.owner !== oldOwner))) {
      const lockOwner = lock ? lock.owner : '(无锁)';
      throw new ProgressLockError(`接管前 owner 必须匹配 progress${lock ? ' 与 lock' : ''}：lock=${lockOwner} progress=${progress.owner} expected=${oldOwner}`, lock);
    }
    const candidate = {
      schemaVersion: 1,
      id: `takeover-${crypto.randomUUID()}`,
      change,
      kind,
      previousOwner: oldOwner,
      owner: nextOwner,
      confirmedNoLiveWriter: true,
      lockWasAbsent: !lock,
      evidence: asEvidence(options.evidence),
      recoveredTakeoverId: options.recoveredTakeoverId || null,
      recoveryId: options.recoveryId || null,
      createdAt: now(),
    };
    const claim = createTakeover(root, change, candidate);
    transaction = claim.transaction;
    createdTransaction = claim.created;
  } else if (transaction.previousOwner !== oldOwner || transaction.owner !== nextOwner || transaction.kind !== kind) {
    throw new ProgressLockError(`已有不同的接管事务 ${transaction.id}，拒绝覆盖`, transaction);
  }
  let lock = readLock(root, change);
  if (!lock && transaction.lockWasAbsent) {
    acquireLock(root, change, nextOwner, {
      takeoverFrom: oldOwner, confirmedNoLiveWriter: true, takeoverId: transaction.id, resumedFromSuspended: true,
    });
    lock = readLock(root, change);
  }
  if (!lock) throw new ProgressLockError(`change ${change} 的接管事务缺少运行锁`);
  if (lock.owner === oldOwner) {
    writeLock(root, change, {
      ...lock,
      owner: nextOwner,
      acquiredAt: now(),
      updatedAt: now(),
      takeoverFrom: oldOwner,
      confirmedNoLiveWriter: true,
      takeoverId: transaction.id,
    });
  } else if (lock.owner !== nextOwner) {
    if (createdTransaction && readTakeover(root, change)?.id === transaction.id) fs.unlinkSync(takeoverFile(root, change));
    throw new ProgressLockError(`接管事务 ${transaction.id} 的 lock owner 不匹配：${lock.owner}`, lock);
  }
  const progress = loadProgress(root, change, kind);
  if (!progress) throw new Error(`progress.md 不存在；不能完成接管：${progressFile(root, change, kind)}`);
  if (progress.owner === oldOwner) {
    const updated = clone(progress);
    updated.owner = nextOwner;
    updated.decisions.push({
      id: transaction.id,
      at: now(),
      phase: firstIncompletePhase(updated),
      question: `主会话 ${oldOwner} 已不可继续，是否接管运行记录`,
      options: ['等待旧会话', '确认旧会话与子 Agent 已退出后接管'],
      decision: `由 ${nextOwner} 接管`,
      basis: transaction.lockWasAbsent ? '运行记录处于正常 suspended 且无运行锁；已显式确认没有存活写入会话或子 Agent' : '已显式确认没有存活写入会话或子 Agent；lock 与 progress 的旧 owner 已核对一致',
      evidence: transaction.evidence,
      recoveredTakeoverId: transaction.recoveredTakeoverId || null,
      recoveryId: transaction.recoveryId || null,
      userEscalated: false,
      nextTask: null,
    });
    updated.takeovers = [...(updated.takeovers || []), {
      id: transaction.id, previousOwner: oldOwner, owner: nextOwner, at: now(), evidence: transaction.evidence,
      recoveredTakeoverId: transaction.recoveredTakeoverId || null, recoveryId: transaction.recoveryId || null,
    }];
    updated.nextStep = '核查中断任务的遗留差异和文件所有权，再按恢复计划续派';
    saveProgress(root, updated, nextOwner);
  } else if (progress.owner !== nextOwner) {
    throw new ProgressLockError(`接管事务 ${transaction.id} 的 progress owner 不匹配：${progress.owner}`);
  }
  fs.unlinkSync(takeoverFile(root, change));
  return loadProgress(root, change, kind);
}
function recoverStaleTakeover(root, change, owner, previousOwner, staleTakeoverOwner, confirmedNoLiveWriter, options = {}) {
  const nextOwner = assertOwner(owner);
  const oldOwner = assertOwner(previousOwner);
  const staleOwner = assertOwner(staleTakeoverOwner);
  const kind = options.kind || 'change';
  if (confirmedNoLiveWriter !== true) throw new Error('stale takeover 恢复必须显式确认 confirmed-no-live-writer=true');
  if (nextOwner === oldOwner || nextOwner === staleOwner) throw new Error('恢复 owner 必须不同于 previous-owner 与 stale takeover owner');
  requireEvidence(options.evidence, 'stale takeover 恢复');
  const recovery = acquireTakeoverRecovery(root, change, {
    schemaVersion: 1,
    id: `takeover-recovery-${crypto.randomUUID()}`,
    change,
    kind,
    previousOwner: oldOwner,
    staleTakeoverOwner: staleOwner,
    owner: nextOwner,
    confirmedNoLiveWriter: true,
    evidence: asEvidence(options.evidence),
    createdAt: now(),
  });
  try {
    const stale = readTakeover(root, change);
    if (!stale || stale.kind !== kind || stale.previousOwner !== oldOwner || stale.owner !== staleOwner) {
      throw new ProgressLockError('stale takeover 事务与显式 previous-owner/stale owner 不匹配，拒绝恢复', stale);
    }
    let lock = readLock(root, change);
    let progress = loadProgress(root, change, kind);
    if (!progress) throw new Error(`progress.md 不存在；不能恢复接管：${progressFile(root, change, kind)}`);
    let baseOwner;
    if (lock && lock.owner === staleOwner && progress.owner === oldOwner) {
      const repaired = clone(progress);
      repaired.owner = staleOwner;
      repaired.decisions.push({
        id: `${recovery.id}:repair`, at: now(), phase: firstIncompletePhase(repaired),
        question: `接管事务 ${stale.id} 在 lock 已转移后中断，是否补全进度 owner`,
        options: ['保留不一致状态', '补全后交由新的主会话恢复'],
        decision: `补全为 ${staleOwner} 后继续恢复`,
        basis: '已显式确认没有存活写入会话或子 Agent；lock 与原接管事务 owner 一致',
        evidence: appendTakeoverRecoveryEvidence(options.evidence, stale, recovery), userEscalated: false, nextTask: null,
      });
      saveProgress(root, repaired, staleOwner);
      progress = loadProgress(root, change, kind);
      lock = readLock(root, change);
      baseOwner = staleOwner;
    } else if (lock && lock.owner === oldOwner && progress.owner === oldOwner) {
      baseOwner = oldOwner;
    } else if (lock && lock.owner === staleOwner && progress.owner === staleOwner) {
      baseOwner = staleOwner;
    } else if (!lock && stale.lockWasAbsent && progress.owner === oldOwner && PHASES.some((phase) => progress.phases[phase].status === 'suspended')) {
      baseOwner = oldOwner;
    } else if (lock && lock.owner === oldOwner && progress.owner === staleOwner) {
      writeLock(root, change, { ...lock, owner: staleOwner, updatedAt: now(), takeoverId: stale.id, recoveredBy: recovery.id });
      baseOwner = staleOwner;
    } else {
      throw new ProgressLockError(`stale takeover 事务 ${stale.id} 的 lock/progress owner 状态不可安全恢复：lock=${lock ? lock.owner : '(无锁)'} progress=${progress.owner}`, { lock, progressOwner: progress.owner });
    }
    fs.unlinkSync(takeoverFile(root, change));
    const result = takeoverProgress(root, change, nextOwner, baseOwner, true, {
      kind,
      _recoveryClaim: recovery.id,
      recoveredTakeoverId: stale.id,
      recoveryId: recovery.id,
      evidence: appendTakeoverRecoveryEvidence(options.evidence, stale, recovery),
    });
    return result;
  } finally {
    const file = takeoverRecoveryFile(root, change);
    if (fs.existsSync(file)) {
      const active = readJson(file, 'takeover.recovery.lock');
      if (active.id === recovery.id) fs.unlinkSync(file);
    }
  }
}
function recoverInitialization(root, options) {
  const change = assertChange(options.change);
  const kind = options.kind || 'change';
  if (!options.branch || !options.worktree) throw new Error('初始化恢复必须提供 branch 与 worktree');
  const mainBranch = options.mainBranch || 'main';
  if (kind === 'epic' && !options.sourceRevision) throw new Error('Epic 初始化恢复必须提供 sourceRevision');
  if (kind === 'epic' && options.branch !== mainBranch) throw new Error(`Epic 初始化恢复 branch 必须与 mainBranch 一致：${options.branch} != ${mainBranch}`);
  const nextOwner = assertOwner(options.owner);
  const previousOwner = assertOwner(options.previousOwner);
  if (nextOwner === previousOwner) throw new Error('初始化恢复 owner 必须与 previous-owner 不同');
  if (options.confirmedNoLiveWriter !== true) throw new Error('初始化恢复必须显式确认 confirmed-no-live-writer=true');
  const evidence = requireEvidence(options.evidence, '初始化恢复');
  const existingProgress = loadProgress(root, change, kind);
  if (existingProgress) {
    const lock = readLock(root, change);
    const completion = existingProgress.initializationRecovery;
    if (!completion || completion.previousOwner !== previousOwner || existingProgress.owner !== nextOwner || !lock || lock.owner !== nextOwner) {
      throw new Error(`progress.md 已存在且不匹配此初始化恢复：${progressFile(root, change, kind)}`);
    }
    const pending = fs.existsSync(takeoverRecoveryFile(root, change)) ? readJson(takeoverRecoveryFile(root, change), 'takeover.recovery.lock') : null;
    if (!pending) return existingProgress;
    const completedClaim = pending.operation === 'initialize' && pending.id === completion.id;
    const interruptedCleanup = pending.operation === 'cleanup-initialize' && (pending.rootRecoveryId || pending.completedRecoveryId) === completion.id;
    if ((!completedClaim && !interruptedCleanup) || pending.owner !== nextOwner || pending.previousOwner !== previousOwner) {
      throw new ProgressLockError('遗留恢复 claim 与已完成初始化记录不匹配，拒绝清理', pending);
    }
    const cleanup = acquireTakeoverRecovery(root, change, {
      schemaVersion: 1, id: `completed-initialization-cleanup-${crypto.randomUUID()}`, operation: 'cleanup-initialize', change, kind,
      previousOwner, rootRecoveryId: completion.id, completedRecoveryId: completion.id, owner: nextOwner, confirmedNoLiveWriter: true,
      evidence, createdAt: now(),
    });
    try { return existingProgress; }
    finally {
      const file = takeoverRecoveryFile(root, change);
      if (fs.existsSync(file) && readJson(file, 'takeover.recovery.lock').id === cleanup.id) fs.unlinkSync(file);
    }
  }
  const initialLock = readLock(root, change);
  const runPath = runDir(root, change);
  const quarantinedLocks = fs.existsSync(runPath) ? fs.readdirSync(runPath)
    .filter((name) => name.startsWith(`progress.init-lock.quarantine.${previousOwner}.`))
    .filter((name) => {
      try { return readJson(path.join(runPath, name), '已隔离的初始化 lock').owner === previousOwner; }
      catch { return false; }
    }) : [];
  const originalLock = Boolean(initialLock && initialLock.owner === previousOwner);
  const interruptedRecoveryLock = Boolean(initialLock && initialLock.owner === nextOwner && initialLock.initializationRecoveryId && initialLock.previousOwner === previousOwner && initialLock.confirmedNoLiveWriter === true);
  if (!originalLock && !interruptedRecoveryLock && !(initialLock === null && quarantinedLocks.length)) {
    throw new ProgressLockError(`初始化恢复前 lock/quarantine 必须匹配 previous-owner：lock=${initialLock ? initialLock.owner : '(无锁)'} expected=${previousOwner}`, initialLock);
  }
  const recovery = acquireTakeoverRecovery(root, change, {
    schemaVersion: 1,
    id: `initialization-recovery-${crypto.randomUUID()}`,
    operation: 'initialize',
    change,
    kind,
    previousOwner,
    owner: nextOwner,
    confirmedNoLiveWriter: true,
    evidence,
    createdAt: now(),
  });
  try {
    if (fs.existsSync(progressFile(root, change, kind))) throw new Error('初始化恢复期间检测到 progress.md；拒绝覆盖');
    let quarantineName;
    const lock = readLock(root, change);
    if (lock && lock.owner === previousOwner) {
      const quarantine = path.join(runPath, `progress.init-lock.quarantine.${lock.owner}.${crypto.randomUUID()}.json`);
      fs.renameSync(lockFile(root, change), quarantine);
      quarantineName = path.basename(quarantine);
    } else if (lock && lock.owner === nextOwner && lock.initializationRecoveryId && lock.previousOwner === previousOwner) {
      quarantineName = lock.previousLockQuarantine;
    } else if (!lock) {
      quarantineName = quarantinedLocks.at(-1);
    } else {
      throw new ProgressLockError(`初始化恢复期间 lock owner 已变化：lock=${lock.owner} expected=${previousOwner}`, lock);
    }
    const recoveredLock = lock && lock.owner === nextOwner && lock.initializationRecoveryId
      ? lock
      : acquireLock(root, change, nextOwner, {
        initializationRecoveryId: recovery.id,
        previousOwner,
        previousLockQuarantine: quarantineName,
        confirmedNoLiveWriter: true,
      });
  const progress = newProgress({ ...options, change, kind, owner: nextOwner });
    if (kind === 'epic') {
      progress.mainBranch = mainBranch;
      progress.sourceRevision = options.sourceRevision;
    }
    progress.initializationRecovery = {
      id: recovery.id,
      at: now(),
      previousOwner,
      previousLockQuarantine: quarantineName,
      evidence,
    };
    progress.decisions.push({
      id: recovery.id,
      at: now(),
      phase: 'bootstrap',
      question: `初始化在 progress.md 首次写入前中断；是否由 ${nextOwner} 恢复`,
      options: ['保留孤立运行锁', '确认旧写入会话已退出后恢复初始化'],
      decision: `由 ${nextOwner} 恢复初始化`,
      basis: '已精确核对 previous owner 与完整运行锁，并显式确认没有存活写入会话或子 Agent',
      evidence,
      userEscalated: false,
      nextTask: '执行 bootstrap 并记录可核对的证据',
    });
    progress.nextStep = '初始化崩溃恢复已完成；执行 bootstrap 并记录可核对的证据';
    return saveProgress(root, progress, recoveredLock.owner);
  } finally {
    const file = takeoverRecoveryFile(root, change);
    if (fs.existsSync(file)) {
      const active = readJson(file, 'takeover.recovery.lock');
      if (active.id === recovery.id) fs.unlinkSync(file);
    }
  }
}
function saveProgress(root, progress, owner) {
  validateProgress(progress);
  assertLockOwner(root, progress.change, owner);
  if (progress.owner !== owner) throw new ProgressLockError(`progress owner ${progress.owner} 与当前 lock owner ${owner} 不一致`);
  const next = clone(progress);
  next.updatedAt = now();
  atomicWrite(progressFile(root, next.change, next.kind), renderProgress(next));
  touchLock(root, next.change, owner);
  return next;
}
function initializeProgress(root, options) {
  const change = assertChange(options.change);
  const owner = assertOwner(options.owner);
  const kind = options.kind || 'change';
  if (fs.existsSync(progressFile(root, change, kind))) throw new Error(`progress.md 已存在：${progressFile(root, change, kind)}`);
  if (kind !== 'epic' && fs.existsSync(legacyStateFile(root, change))) throw new Error(`发现旧 state.json；请先执行 migrate：${legacyStateFile(root, change)}`);
  acquireLock(root, change, owner, { host: options.host || null, session: options.session || null });
  try { return saveProgress(root, newProgress(options), owner); }
  catch (error) { releaseLock(root, change, owner); throw error; }
}
function mutateProgress(root, change, owner, mutation, options = {}) {
  const kind = options.kind || 'change';
  const current = loadProgress(root, change, kind);
  if (!current) throw new Error(`progress.md 不存在：${progressFile(root, change, kind)}`);
  assertLockOwner(root, change, owner);
  if (current.owner !== owner) throw new ProgressLockError(`progress owner ${current.owner} 与当前会话 ${owner} 不一致`);
  const next = clone(current);
  mutation(next);
  return saveProgress(root, next, owner);
}
function assertPhase(phase) {
  if (!PHASES.includes(phase)) throw new Error(`未知阶段：${phase}`);
  return phase;
}
function canTransition(from, to, options = {}) {
  if (from === to) return true;
  if (from === 'succeeded') return to === 'pending' && Boolean(options.reason);
  if (from === 'pending') return ['running', 'failed', 'suspended'].includes(to);
  if (from === 'running') return ['pending', 'succeeded', 'failed', 'suspended'].includes(to);
  return (from === 'failed' || from === 'suspended') && ['pending', 'running'].includes(to);
}
function asEvidence(input) {
  const items = !input ? [] : Array.isArray(input) ? input : [input];
  return items.filter(Boolean).map((item) => typeof item === 'string' ? { at: now(), message: item } : { at: now(), ...item });
}
function nextStepAfter(phase, status) {
  if (status === 'succeeded') return PHASES[PHASES.indexOf(phase) + 1] ? `核查依赖后推进 ${PHASES[PHASES.indexOf(phase) + 1]}` : '核查集成远端 checkpoint';
  if (status === 'failed') return `记录失败证据并决定重试、重派或挂起 ${phase}`;
  if (status === 'suspended') return `等待主 Agent 或用户决策后恢复 ${phase}`;
  return `完成 ${phase} 的当前 attempt 并记录证据`;
}
function hasStrongPhaseEvidence(options) {
  return Boolean(options.commitSha || options.verificationHead || options.sourceFingerprint || options.specFingerprint || (options.artifactPaths && options.artifactPaths.length) || (options.commandIds && options.commandIds.length) || (options.remoteFacts && Object.keys(options.remoteFacts).length));
}
function allIntegrationCheckpointsSucceeded(progress) {
  return INTEGRATION_CHECKPOINTS.every((id) => {
    const checkpoint = [...progress.checkpoints].reverse().find((item) => item.id === id);
    return checkpoint && checkpoint.status === 'succeeded';
  });
}
function validateStageSuccessEvidence(phase, options) {
  if (phase === 'bootstrap' && !(options.commandIds && options.commandIds.length)) throw new Error('bootstrap 成功必须记录前置检查 commandIds');
  if (phase === 'architect') {
    const artifacts = options.artifactPaths || [];
    if (!artifacts.some((item) => item.endsWith('/design.md')) || !artifacts.some((item) => item.endsWith('/tasks.md'))) throw new Error('architect 成功必须记录 design.md 与 tasks.md');
  }
  if ((phase === 'spec-gate' || phase === 'tester') && !(options.commandIds && options.commandIds.length)) throw new Error(`阶段 ${phase} 成功必须记录通过的 commandIds`);
  if (phase === 'dev' && !options.commitSha) throw new Error('dev 成功必须记录 commitSha');
  if (phase === 'cr' && (options.crResult !== 'pass' || !options.sourceFingerprint)) throw new Error('cr 成功必须记录 crResult=pass 与 sourceFingerprint');
}
function invalidateVerifyAndIntegrateForSourceMismatch(root, change, owner, observedFingerprint, action) {
  return mutateProgress(root, change, owner, (progress) => {
    const verify = progress.phases.verify;
    const expected = verify.sourceFingerprint || '(缺少 Verify sourceFingerprint)';
    const reason = `${action} 的 sourceFingerprint ${observedFingerprint || '(缺少)'} 与 Verify ${expected} 不一致；必须重新 Verify 后再集成`;
    for (const phaseName of ['verify', 'integrate']) {
      const phase = progress.phases[phaseName];
      phase.status = 'pending';
      phase.invalidatedAt = now();
      phase.invalidationReason = reason;
      phase.finishedAt = phaseName === 'verify' ? phase.finishedAt : undefined;
    }
    for (const id of INTEGRATION_CHECKPOINTS) {
      const latest = [...progress.checkpoints].reverse().find((item) => item.id === id);
      if (!latest || latest.status === 'pending') continue;
      progress.checkpoints.push({
        id, status: 'pending', attempt: latest.attempt || 0, at: now(),
        invalidatedAt: now(), invalidationReason: reason,
      });
    }
    progress.sourceFingerprintInvalidation = { at: now(), action, expected, observed: observedFingerprint || null, reason };
    progress.nextStep = '源码快照已变化；重新执行 Verify 并记录新的源码与规格指纹，之后从 integrate 重新开始';
  });
}
function assertIntegrateSourceFingerprint(root, change, owner, observedFingerprint, action) {
  const progress = loadProgress(root, change);
  if (!progress) throw new Error(`progress.md 不存在：${progressFile(root, change)}`);
  const verify = progress.phases.verify;
  if (verify.status === 'succeeded' && (!observedFingerprint || observedFingerprint !== verify.sourceFingerprint)) {
    invalidateVerifyAndIntegrateForSourceMismatch(root, change, owner, observedFingerprint, action);
    throw new Error(`${action} 的 sourceFingerprint 必须与 Verify 一致；Verify 与 integrate 已置为 pending`);
  }
}
function setPhase(root, change, owner, phase, status, options = {}) {
  assertPhase(phase); assertStatus(status, PHASE_STATUSES, `阶段 ${phase}`);
  if (phase === 'verify' && status === 'succeeded' && !options.verificationHead) {
    throw new Error('Verify 成功必须记录 verificationHead');
  }
  if (phase === 'verify' && status === 'succeeded' && (!options.sourceFingerprint || !options.specFingerprint)) {
    throw new Error('Verify 成功必须记录 sourceFingerprint 和 specFingerprint');
  }
  if (phase === 'verify' && status === 'succeeded') validateSourceFingerprintEvidence(options, 'Verify');
  if (phase === 'verify' && status === 'succeeded' && (!options.commandIds || !options.commandIds.length || !options.expectedCommandIds || !options.expectedCommandIds.length)) {
    throw new Error('Verify 成功必须记录 commandIds 与 expectedCommandIds');
  }
  if (phase === 'verify' && status === 'succeeded' && options.expectedCommandIds.some((id) => !options.commandIds.includes(id))) {
    throw new Error('Verify expectedCommandIds 必须包含在 commandIds 中');
  }
  if (phase === 'verify' && status === 'succeeded') {
    if (!options.commandEvidence || typeof options.commandEvidence !== 'object') throw new Error('Verify 成功必须记录每条命令的 commandEvidence');
    for (const id of options.expectedCommandIds) {
      const item = options.commandEvidence[id];
      if (!item || item.exitCode !== 0 || item.head !== options.verificationHead || item.sourceFingerprint !== options.sourceFingerprint || item.specFingerprint !== options.specFingerprint) {
        throw new Error(`Verify 命令 ${id} 缺少成功退出码或 HEAD/source/spec 指纹不匹配`);
      }
    }
  }
  if (status === 'succeeded' && !['verify', 'integrate'].includes(phase)) validateStageSuccessEvidence(phase, options);
  if (phase === 'integrate' && status === 'running') {
    assertIntegrateSourceFingerprint(root, change, owner, options.sourceFingerprint, 'integrate running');
    validateSourceFingerprintEvidence(options, 'integrate running');
  }
  return mutateProgress(root, change, owner, (progress) => {
    const record = progress.phases[phase];
    if (['running', 'succeeded'].includes(status)) {
      for (const previous of PHASES.slice(0, PHASES.indexOf(phase))) {
        if (progress.phases[previous].status !== 'succeeded') throw new Error(`阶段 ${phase} 前必须先成功完成 ${previous}`);
      }
    }
    if (status === 'succeeded' && phase !== 'integrate' && !hasStrongPhaseEvidence(options)) {
      throw new Error(`阶段 ${phase} 成功必须记录可重核的提交、文件、命令、快照或远端证据`);
    }
    if (status === 'succeeded' && phase === 'integrate' && !allIntegrationCheckpointsSucceeded(progress)) {
      throw new Error('integrate 成功前必须完成全部集成 checkpoint');
    }
    if (phase === 'integrate' && status === 'running') {
      const verify = progress.phases.verify;
      if (verify.status !== 'succeeded' || !verify.sourceFingerprint) throw new Error('integrate running 前必须存在成功 Verify 的 sourceFingerprint');
      if (!options.sourceFingerprint || options.sourceFingerprint !== verify.sourceFingerprint) throw new Error('integrate running 的 sourceFingerprint 必须与 Verify 一致');
      for (const field of ['fingerprintVersion', 'manifestSha256']) if (options[field] !== verify[field]) throw new Error(`integrate running 的 ${field} 必须与 Verify 一致`);
      if (JSON.stringify(options.manifest) !== JSON.stringify(verify.manifest)) throw new Error('integrate running 的 manifest 必须与 Verify 一致');
    }
    if (!canTransition(record.status, status, options)) throw new Error(`阶段 ${phase} 不允许从 ${record.status} 转为 ${status}`);
    if (options.attempt !== undefined) {
      const explicitAttempt = Number(options.attempt);
      if (!Number.isInteger(explicitAttempt) || explicitAttempt < record.attempt) throw new Error(`阶段 ${phase} 的 attempt 不能回退`);
      record.attempt = explicitAttempt;
    } else if (status === 'running' && record.status !== 'running') record.attempt += 1;
    record.status = status; record.updatedAt = now();
    if (status === 'running') record.startedAt = record.updatedAt;
    if (['succeeded', 'failed', 'suspended'].includes(status)) record.finishedAt = record.updatedAt;
    if (options.agentId !== undefined) record.agentId = options.agentId;
    if (options.crRound !== undefined) {
      const crRound = Number(options.crRound);
      if (!Number.isInteger(crRound) || crRound < 0) throw new Error('CR 轮次必须是非负整数');
      record.crRound = crRound;
    }
    if (options.allowedPaths !== undefined) record.allowedPaths = [...options.allowedPaths];
    for (const [key, option] of [['commitSha', 'commitSha'], ['verificationHead', 'verificationHead'], ['sourceFingerprint', 'sourceFingerprint'], ['fingerprintVersion', 'fingerprintVersion'], ['manifestSha256', 'manifestSha256'], ['manifest', 'manifest'], ['specFingerprint', 'specFingerprint'], ['remoteFacts', 'remoteFacts']]) if (options[option] !== undefined) record[key] = clone(options[option]);
    if (options.artifactPaths !== undefined) record.artifactPaths = [...options.artifactPaths];
    if (options.commandIds !== undefined) record.commandIds = [...options.commandIds];
    if (options.expectedCommandIds !== undefined) record.expectedCommandIds = [...options.expectedCommandIds];
    if (phase === 'verify' && status === 'succeeded') record.commandEvidence = clone(options.commandEvidence);
    if (options.crResult !== undefined) record.crResult = options.crResult;
    if (options.reason) record.reason = options.reason;
    record.evidence.push(...asEvidence(options.evidence));
    progress.nextStep = options.nextStep || nextStepAfter(phase, status);
  });
}
function setTask(root, change, owner, taskId, status, options = {}) {
  if (typeof taskId !== 'string' || !taskId.trim()) throw new Error('taskId 必须非空');
  assertStatus(status, TASK_STATUSES, `任务 ${taskId}`);
  if (options.phase !== undefined) assertPhase(options.phase);
  return mutateProgress(root, change, owner, (progress) => {
    const task = progress.tasks[taskId] || { status: 'pending', attempt: 0, owner: null, phase: options.phase || null, allowedPaths: [], evidence: [] };
    if (status === 'running' && task.status !== 'running') task.attempt += 1;
    task.status = status; task.updatedAt = now();
    if (options.phase !== undefined) task.phase = options.phase;
    if (options.agentId !== undefined) task.agentId = options.agentId;
    if (options.taskOwner !== undefined) task.owner = options.taskOwner;
    if (options.allowedPaths !== undefined) task.allowedPaths = [...options.allowedPaths];
    if (options.reason !== undefined) task.reason = options.reason;
    task.evidence.push(...asEvidence(options.evidence));
    progress.tasks[taskId] = task;
  });
}
function recordDecision(root, change, owner, decision) {
  if (!decision || !decision.question || !decision.decision || !decision.basis) throw new Error('决策必须包含 question、decision 与 basis');
  return mutateProgress(root, change, owner, (progress) => {
    progress.decisions.push({ id: decision.id || `decision-${progress.decisions.length + 1}`, at: now(), phase: decision.phase || firstIncompletePhase(progress), question: decision.question, options: decision.options || [], decision: decision.decision, basis: decision.basis, userEscalated: Boolean(decision.userEscalated), nextTask: decision.nextTask || null });
    if (decision.nextStep) progress.nextStep = decision.nextStep;
  });
}
function normalizeCheckpointEvidence(id, evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error(`集成 checkpoint ${id} 必须提供对象形式的 typed evidence`);
  if (evidence.type !== id) throw new Error(`集成 checkpoint ${id} 的 evidence.type 必须为 ${id}`);
  for (const field of CHECKPOINT_EVIDENCE_FIELDS[id]) {
    if (!Object.prototype.hasOwnProperty.call(evidence, field) || evidence[field] === null || evidence[field] === '' || (Array.isArray(evidence[field]) && !evidence[field].length)) {
      throw new Error(`集成 checkpoint ${id} 的 evidence 缺少 ${field}`);
    }
  }
  validateSourceFingerprintEvidence(evidence, `集成 checkpoint ${id}`);
  if (id === 'wait-required-ci' && evidence.conclusion !== 'success') throw new Error('wait-required-ci 的 conclusion 必须为 success');
  if (id === 'verify-remote' && evidence.merged !== true) throw new Error('verify-remote 的 merged 必须为 true');
  if (id === 'cleanup-local' && evidence.worktreeRemoved !== true) throw new Error('cleanup-local 的 worktreeRemoved 必须为 true');
  return clone(evidence);
}
function recordCheckpoint(root, change, owner, checkpoint) {
  if (!checkpoint || !checkpoint.id || !checkpoint.status) throw new Error('checkpoint 必须包含 id 与 status');
  if (!INTEGRATION_CHECKPOINTS.includes(checkpoint.id)) throw new Error(`未知集成 checkpoint：${checkpoint.id}`);
  assertStatus(checkpoint.status, PHASE_STATUSES, `集成 checkpoint ${checkpoint.id}`);
  if (checkpoint.status === 'succeeded') checkpoint = { ...checkpoint, evidence: normalizeCheckpointEvidence(checkpoint.id, checkpoint.evidence) };
  if (['running', 'succeeded'].includes(checkpoint.status)) {
    const observedFingerprint = checkpoint.evidence && checkpoint.evidence.sourceFingerprint || checkpoint.sourceFingerprint;
    assertIntegrateSourceFingerprint(root, change, owner, observedFingerprint, `集成 checkpoint ${checkpoint.id}`);
  }
  return mutateProgress(root, change, owner, (progress) => {
    if (['running', 'succeeded'].includes(checkpoint.status) && progress.phases.verify.status !== 'succeeded') throw new Error('集成 checkpoint 前必须先成功完成 verify');
    if (['running', 'succeeded'].includes(checkpoint.status) && progress.phases.integrate.status !== 'running') throw new Error('集成 checkpoint 前必须进入 integrate running');
    if (['running', 'succeeded'].includes(checkpoint.status) && (!progress.phases.verify.sourceFingerprint || !(checkpoint.evidence && checkpoint.evidence.sourceFingerprint || checkpoint.sourceFingerprint))) throw new Error(`集成 checkpoint ${checkpoint.id} 的 sourceFingerprint 必须与 Verify 一致`);
    if (checkpoint.status === 'succeeded') {
      const verify = progress.phases.verify;
      for (const field of ['fingerprintVersion', 'manifestSha256']) if (checkpoint.evidence[field] !== verify[field]) throw new Error(`集成 checkpoint ${checkpoint.id} 的 ${field} 与 Verify 不匹配`);
      if (JSON.stringify(checkpoint.evidence.manifest) !== JSON.stringify(verify.manifest)) throw new Error(`集成 checkpoint ${checkpoint.id} 的 manifest 与 Verify 不匹配`);
    }
    const index = INTEGRATION_CHECKPOINTS.indexOf(checkpoint.id);
    if (['running', 'succeeded'].includes(checkpoint.status)) {
      for (const previousId of INTEGRATION_CHECKPOINTS.slice(0, index)) {
        const previous = [...progress.checkpoints].reverse().find((item) => item.id === previousId);
        if (!previous || previous.status !== 'succeeded') throw new Error(`集成 checkpoint ${checkpoint.id} 前必须先完成 ${previousId}`);
      }
    }
    const earlier = [...progress.checkpoints].reverse().find((item) => item.id === checkpoint.id);
    const attempt = checkpoint.attempt === undefined ? ((earlier && earlier.attempt) || 0) + (checkpoint.status === 'running' ? 1 : 0) : Number(checkpoint.attempt);
    if (!Number.isInteger(attempt) || attempt < 0) throw new Error(`集成 checkpoint ${checkpoint.id} 的 attempt 非法`);
    progress.checkpoints.push({ at: now(), attempt, ...clone(checkpoint) });
    if (checkpoint.nextStep) progress.nextStep = checkpoint.nextStep;
  });
}
function migrateLegacyState(root, options) {
  const change = assertChange(options.change);
  const owner = assertOwner(options.owner);
  if (fs.existsSync(progressFile(root, change))) throw new Error(`progress.md 已存在；不允许 state.json 与 progress.md 双写：${progressFile(root, change)}`);
  const source = legacyStateFile(root, change);
  if (!fs.existsSync(source)) throw new Error(`旧 state.json 不存在：${source}`);
  const oldState = readJson(source, '旧 state.json');
  const progress = newProgress(options);
  const candidates = Object.entries(oldState.nodes || {}).map(([nodeId, node]) => ({ nodeId, legacyStatus: node && node.status || 'unknown', attempts: Number.isInteger(node && node.attempts) ? node.attempts : 0, verification: 'unverified', candidateEvidence: { commitSha: node && node.commitSha || null, checkpoints: node && node.checkpoints || {}, history: Array.isArray(node && node.history) ? node.history : [], error: node && node.error || null } }));
  progress.migration = { sourceFile: source, sourceSchemaVersion: oldState.schemaVersion || null, migratedAt: now(), candidates };
  for (const candidate of candidates) if (PHASES.includes(candidate.nodeId)) {
    progress.phases[candidate.nodeId].legacyCandidate = candidate;
    progress.phases[candidate.nodeId].evidence.push({ at: now(), message: `从旧 state.json 迁入 ${candidate.legacyStatus} 候选，待核查` });
  }
  progress.nextStep = '核查旧 state.json 候选的 Git、文件和远端事实；未核实前从 pending 阶段继续';
  acquireLock(root, change, owner, { host: options.host || null, session: options.session || null, migrated: true });
  try { return saveProgress(root, progress, owner); }
  catch (error) { releaseLock(root, change, owner); throw error; }
}
function evidenceProblems(phase, facts, phaseName, progress) {
  const problems = [];
  const commits = facts.commits || facts.reachableCommits || {};
  const files = facts.files || {};
  const commands = facts.commands || {};
  const remote = facts.remoteFacts || facts.remote || {};
  let recheckable = false;
  if (phase.commitSha) { recheckable = true; if (commits[phase.commitSha] !== true) problems.push(`提交 ${phase.commitSha} 未被当前分支证实`); }
  if (phase.verificationHead) { recheckable = true; if (commits[phase.verificationHead] !== true && facts.head !== phase.verificationHead) problems.push(`验证 HEAD ${phase.verificationHead} 未被当前分支证实`); }
  if (phaseName === 'verify') {
    recheckable = true;
    if (!phase.verificationHead) problems.push('Verify 缺少记录的 validation HEAD');
    else if (facts.head !== phase.verificationHead) problems.push(`Verify HEAD 不匹配：记录 ${phase.verificationHead}，当前 ${facts.head || '未提供'}`);
    if (!phase.sourceFingerprint || !phase.specFingerprint) problems.push('Verify 缺少源或规格快照指纹');
    try { validateSourceFingerprintEvidence(phase, '已保存 Verify'); }
    catch (error) { problems.push(error.message); }
    if (facts.fingerprintVersion !== phase.fingerprintVersion || facts.manifestSha256 !== phase.manifestSha256 || JSON.stringify(facts.manifest) !== JSON.stringify(phase.manifest)) {
      problems.push('恢复 facts 缺少或不匹配的源码指纹版本/manifest');
    }
    const expected = phase.expectedCommandIds || [];
    if (!expected.length) problems.push('Verify 缺少预期命令覆盖清单');
    for (const id of expected) {
      if (!(phase.commandIds || []).includes(id)) { problems.push(`Verify 实际命令记录缺少预期项 ${id}`); continue; }
      const evidence = commands[id];
      if (!evidence || typeof evidence !== 'object' || evidence.exitCode !== 0) { problems.push(`Verify 命令 ${id} 未提供 exitCode=0 证据`); continue; }
      if (evidence.head !== phase.verificationHead) problems.push(`Verify 命令 ${id} 的 HEAD 与 validation HEAD 不匹配`);
      if (evidence.sourceFingerprint !== phase.sourceFingerprint) problems.push(`Verify 命令 ${id} 的源快照不匹配`);
      if (evidence.specFingerprint !== phase.specFingerprint) problems.push(`Verify 命令 ${id} 的规格快照不匹配`);
    }
  }
  for (const file of phase.artifactPaths || []) { recheckable = true; if (files[file] !== true) problems.push(`产物或文件 ${file} 未被证实`); }
  for (const id of phase.commandIds || []) {
    recheckable = true;
    if (phaseName !== 'verify' && commands[id] !== true && !(commands[id] && commands[id].exitCode === 0)) problems.push(`命令证据 ${id} 未被证实`);
  }
  if (phase.sourceFingerprint !== undefined) { recheckable = true; if (facts.sourceFingerprint !== phase.sourceFingerprint) problems.push('源快照指纹已变化或未提供'); }
  if (phase.specFingerprint !== undefined) { recheckable = true; if (facts.specFingerprint !== phase.specFingerprint) problems.push('规格快照指纹已变化或未提供'); }
  for (const [key, expected] of Object.entries(phase.remoteFacts || {})) { recheckable = true; if (remote[key] !== expected) problems.push(`远端事实 ${key} 不匹配`); }
  if (phaseName === 'integrate' && allIntegrationCheckpointsSucceeded(progress)) {
    recheckable = true;
  }
  if (!recheckable) problems.push('缺少可重核的提交、文件、命令、源快照或远端证据');
  return problems;
}
function downstreamPhases(phase) { return PHASES.slice(PHASES.indexOf(phase)); }
function evidenceMatches(expected, actual) {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual);
  if (actual === null || typeof actual !== 'object' || Array.isArray(expected) !== Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => Object.prototype.hasOwnProperty.call(actual, key) && evidenceMatches(value, actual[key]));
}
function checkpointProblems(progress, facts) {
  const observed = facts.checkpoints || {};
  const problems = [];
  for (const id of INTEGRATION_CHECKPOINTS) {
    const checkpoint = [...progress.checkpoints].reverse().find((item) => item.id === id);
    if (!checkpoint || checkpoint.status !== 'succeeded') continue;
    if (!checkpoint.evidence || !evidenceMatches(checkpoint.evidence, observed[id])) {
      problems.push({ checkpoint: id, reason: 'typed evidence 未被当前远端或本地事实证实' });
    }
  }
  return problems;
}
function terminalLifecycle(progress, facts) {
  const verify = progress.phases.verify;
  const historicalVerifyProblems = [];
  if (!verify.verificationHead || (facts.commits || {})[verify.verificationHead] !== true) historicalVerifyProblems.push('历史 Verify HEAD 不再可达');
  for (const id of verify.expectedCommandIds || []) {
    const evidence = (facts.commands || {})[id];
    if (!evidence || evidence.exitCode !== 0 || evidence.head !== verify.verificationHead || evidence.sourceFingerprint !== verify.sourceFingerprint || evidence.specFingerprint !== verify.specFingerprint) historicalVerifyProblems.push(`历史 Verify 命令 ${id} 未被精确证实`);
  }
  if (!verify.expectedCommandIds || !verify.expectedCommandIds.length) historicalVerifyProblems.push('历史 Verify 缺少预期命令');
  const latest = (id) => [...progress.checkpoints].reverse().find((item) => item.id === id);
  const merge = latest('merge');
  const remote = latest('verify-remote');
  const cleanup = latest('cleanup-local');
  const lifecycle = facts.terminalLifecycle || {};
  const mergeSha = merge && merge.status === 'succeeded' && merge.evidence && merge.evidence.mergeSha;
  const complete = Boolean(
    mergeSha && remote && remote.status === 'succeeded' && remote.evidence && remote.evidence.mergeSha === mergeSha &&
    cleanup && cleanup.status === 'succeeded' && cleanup.evidence && cleanup.evidence.worktreeRemoved === true &&
    lifecycle.mainBranch && facts.branch === lifecycle.mainBranch && lifecycle.worktreeDeleted === true &&
    lifecycle.mergeSha === mergeSha && (facts.commits || {})[mergeSha] === true && historicalVerifyProblems.length === 0
  );
  return { complete, mergeSha, historicalVerifyProblems, reason: complete ? null : '缺少 merge/verify-remote/cleanup、main 可达或历史 Verify 事实' };
}
function validateResume(progress, facts = {}) {
  validateProgress(progress);
  const terminal = terminalLifecycle(progress, facts);
  const metadataIssues = [];
  const requiresFacts = PHASES.some((phase) => ['succeeded', 'running'].includes(progress.phases[phase].status)) || Object.values(progress.tasks || {}).some((task) => task.status === 'succeeded');
  if (!terminal.complete) {
    if (requiresFacts && facts.branch === undefined) metadataIssues.push('恢复事实缺少当前 branch');
    else if (facts.branch !== undefined && facts.branch !== progress.branch) metadataIssues.push(`分支不匹配：记录 ${progress.branch}，当前 ${facts.branch}`);
    if (requiresFacts && progress.worktree && facts.worktree === undefined) metadataIssues.push('恢复事实缺少当前 worktree');
    else if (facts.worktree !== undefined && progress.worktree && path.resolve(facts.worktree) !== progress.worktree) metadataIssues.push(`worktree 不匹配：记录 ${progress.worktree}，当前 ${path.resolve(facts.worktree)}`);
    if (requiresFacts && facts.head === undefined) metadataIssues.push('恢复事实缺少当前 HEAD');
  }
  const invalid = new Map();
  const interruptedPhases = [];
  for (const phaseName of PHASES) {
    const phase = progress.phases[phaseName];
    // A verified terminal lifecycle supersedes the old change-worktree facts for
    // every phase, including a completed integrate record. Its merge/remote/
    // cleanup typed evidence and historical Verify evidence are rechecked above.
    if (phase.status === 'succeeded' && !terminal.complete) { const issues = evidenceProblems(phase, facts, phaseName, progress); if (issues.length) invalid.set(phaseName, issues); }
    if (phase.status === 'running' && !(terminal.complete && phaseName === 'integrate')) { interruptedPhases.push(phaseName); invalid.set(phaseName, ['原生子 Agent 在中断后无法确认活跃，需先核查遗留差异再重新派发']); }
  }
  if (metadataIssues.length) invalid.set(PHASES[0], [...(invalid.get(PHASES[0]) || []), ...metadataIssues]);
  const invalidated = new Set();
  for (const phaseName of invalid.keys()) for (const downstream of downstreamPhases(phaseName)) invalidated.add(downstream);
  const taskProblems = [];
  for (const [taskId, task] of Object.entries(progress.tasks || {})) if (task.status === 'succeeded' && (facts.tasks || {})[taskId] !== true) {
    taskProblems.push({ taskId, reason: 'tasks.md 或任务产物未被当前事实证实' });
    if (task.phase) for (const downstream of downstreamPhases(task.phase)) invalidated.add(downstream);
  }
  const checkpointFailures = checkpointProblems(progress, facts);
  if (checkpointFailures.length) {
    if (progress.phases.integrate.status === 'succeeded') invalid.set('integrate', checkpointFailures.map((item) => `${item.checkpoint}: ${item.reason}`));
    invalidated.add('integrate');
  }
  const reusablePhases = PHASES.filter((phase) => progress.phases[phase].status === 'succeeded' && !invalidated.has(phase));
  return { valid: metadataIssues.length === 0 && invalid.size === 0 && taskProblems.length === 0 && checkpointFailures.length === 0, terminalLifecycle: terminal, metadataIssues, invalidPhases: Object.fromEntries(invalid), invalidatedPhases: PHASES.filter((phase) => invalidated.has(phase)), interruptedPhases, taskProblems, checkpointProblems: checkpointFailures, reusablePhases, firstReadyPhase: PHASES.find((phase) => !reusablePhases.includes(phase)) || null };
}
function applyResumeValidation(progress, validation) {
  const next = clone(progress);
  for (const phaseName of validation.invalidatedPhases || []) {
    const phase = next.phases[phaseName];
    if (phase.status === 'succeeded' || phase.status === 'running') { phase.status = 'pending'; phase.invalidatedAt = now(); phase.invalidationReason = (validation.invalidPhases[phaseName] || ['上游阶段待核查']).join('；'); }
  }
  for (const item of validation.taskProblems || []) if (next.tasks[item.taskId]) { next.tasks[item.taskId].status = 'needs-verification'; next.tasks[item.taskId].invalidationReason = item.reason; }
  const failedCheckpoints = validation.checkpointProblems || [];
  if (failedCheckpoints.length) {
    const first = Math.min(...failedCheckpoints.map((item) => INTEGRATION_CHECKPOINTS.indexOf(item.checkpoint)));
    const reasons = Object.fromEntries(failedCheckpoints.map((item) => [item.checkpoint, item.reason]));
    for (const id of INTEGRATION_CHECKPOINTS.slice(first)) {
      const latest = [...next.checkpoints].reverse().find((item) => item.id === id);
      if (!latest || latest.status !== 'succeeded') continue;
      next.checkpoints.push({
        id, status: 'pending', attempt: latest.attempt || 0, at: now(),
        invalidatedAt: now(),
        invalidationReason: reasons[id] || `前置 checkpoint ${INTEGRATION_CHECKPOINTS[first]} 的事实失配`,
      });
    }
  }
  next.nextStep = validation.firstReadyPhase ? `核查并从 ${validation.firstReadyPhase} 阶段恢复；不得复用未证实成功标记` : '全部阶段已核对；继续核对集成远端 checkpoint';
  return next;
}
function applyResumeFacts(root, change, owner, facts) {
  return mutateProgress(root, change, owner, (progress) => {
    const validation = validateResume(progress, facts);
    Object.assign(progress, applyResumeValidation(progress, validation));
    progress.resumeValidation = { at: now(), ...validation };
  });
}
function validateEpicResume(progress, facts = {}) {
  validateProgress(progress);
  if (progress.kind !== 'epic') throw new Error('Epic 恢复只能用于 epic-progress.md');
  const metadataIssues = [];
  if (facts.branch === undefined || facts.branch !== progress.branch) metadataIssues.push('Epic 恢复 branch 未提供或不匹配');
  if (progress.worktree && (facts.worktree === undefined || path.resolve(facts.worktree) !== progress.worktree)) metadataIssues.push('Epic 恢复 worktree 未提供或不匹配');
  if (progress.sourceRevision && facts.sourceRevision !== progress.sourceRevision) metadataIssues.push('Epic 恢复 sourceRevision 未提供或不匹配');
  const observed = facts.epicItems || {};
  const invalidItems = [];
  for (const [name, item] of Object.entries(progress.epicItems || {})) {
    if (item.status === 'done' && (!observed[name] || observed[name].remoteMerged !== true)) {
      invalidItems.push({ name, reason: 'done 子项未被远端已合并事实证实' });
    }
    if (item.status === 'running') invalidItems.push({ name, reason: '中断后无法确认原生子 Agent，需核查 worktree 后重派' });
  }
  return {
    valid: metadataIssues.length === 0 && invalidItems.length === 0,
    metadataIssues,
    invalidItems,
    reusableItems: Object.entries(progress.epicItems || {}).filter(([name, item]) => item.status === 'done' && observed[name] && observed[name].remoteMerged === true).map(([name]) => name),
  };
}
function applyEpicResumeFacts(root, epicName, owner, facts) {
  return mutateProgress(root, epicName, owner, (progress) => {
    if (!facts || facts.remoteVerified !== true || !facts.verifiedAt || !facts.epicItems || typeof facts.epicItems !== 'object') {
      throw new Error('Epic 调度必须提供本轮预检生成的远端 merge facts');
    }
    const verifiedAt = Date.parse(facts.verifiedAt);
    const ageMs = Date.now() - verifiedAt;
    if (!Number.isFinite(verifiedAt) || ageMs < 0 || ageMs > 10 * 60 * 1000) throw new Error('Epic 远端 facts 已过期或时间戳无效；请重新运行 Epic preflight');
    const definitionFile = path.join(root, 'openspec', 'epics', epicName, 'epic.json');
    const definition = fs.existsSync(definitionFile) ? validateEpicDefinition(readJson(definitionFile, 'epic.json')) : null;
    const expectedItems = definition ? definition.items : Object.keys(progress.epicItems || {}).filter((name) => name !== EPIC_BLOCK_ITEM).map((name) => ({ name }));
    const expectedNames = expectedItems.map((item) => item.name).sort();
    const factNames = Object.keys(facts.epicItems).sort();
    if (JSON.stringify(expectedNames) !== JSON.stringify(factNames)) throw new Error('Epic 远端 facts 必须覆盖且只覆盖 epic.json 的全部子项');
    if (definition) for (const item of expectedItems) {
      const fact = facts.epicItems[item.name];
      if (Number(fact.issueNumber) !== Number(item.issue)) throw new Error(`Epic 远端 facts 的 Issue 编号不匹配：${item.name}`);
      if (fact.remoteMerged === true && (!Number.isInteger(Number(fact.prNumber)) || !fact.mergeSha || !fact.mergedAt)) {
        throw new Error(`Epic 已合并事实缺少 PR/merge SHA/时间证据：${item.name}`);
      }
    }
    const validation = validateEpicResume(progress, facts);
    for (const item of validation.invalidItems) {
      const record = progress.epicItems[item.name];
      if (record.status === 'running') {
        record.resumeNeedsOwnerCheck = true;
        record.invalidationReason = item.reason;
        continue;
      }
      record.status = 'pending';
      record.invalidatedAt = now();
      record.invalidationReason = item.reason;
    }
    for (const [name, remote] of Object.entries(facts.epicItems)) {
      const record = progress.epicItems[name] || { status: 'pending' };
      if (remote.remoteMerged === true) {
        if (record.status !== 'running') record.status = 'done';
        record.remoteMerged = true; record.mergeEvidence = clone(remote);
        delete record.invalidatedAt;
        if (record.status !== 'running') delete record.invalidationReason;
      } else if (record.status === 'done' || (record.remoteMerged === true && record.status !== 'running')) {
        record.status = 'pending'; record.remoteMerged = false; record.invalidatedAt = now();
        record.invalidationReason = '本轮远端事实未确认关联 PR 已合并';
      }
      progress.epicItems[name] = record;
    }
    if (validation.metadataIssues.length) {
      progress.epicDispatchBlock = { at: now(), metadataIssues: [...validation.metadataIssues], facts: clone(facts) };
      progress.epicItems[EPIC_BLOCK_ITEM] = { status: 'blocked', at: now(), metadataIssues: [...validation.metadataIssues] };
      progress.nextStep = 'Epic 元数据事实不匹配；修复 branch/worktree/sourceRevision 后重新执行 resume-apply，禁止继续 DAG 调度';
    } else {
      delete progress.epicDispatchBlock;
      delete progress.epicItems[EPIC_BLOCK_ITEM];
      progress.nextStep = validation.invalidItems.length ? '核查失效子项的 worktree 与远端事实后按 DAG 重新派发' : '按 Epic DAG 推进下一个已就绪子项';
    }
    progress.resumeValidation = { at: now(), ...validation };
  }, { kind: 'epic' });
}
function validateEpicDefinition(epic) {
  if (!epic || !Array.isArray(epic.items)) throw new Error('epic.json 必须包含 items 数组');
  const names = new Set();
  for (const item of epic.items) { if (!item || typeof item.name !== 'string' || !item.name) throw new Error('epic item 缺少 name'); if (names.has(item.name)) throw new Error(`epic item 重名：${item.name}`); names.add(item.name); }
  const byName = Object.fromEntries(epic.items.map((item) => [item.name, item]));
  const visiting = new Set(); const visited = new Set();
  const visit = (name) => { if (visiting.has(name)) throw new Error(`epic dependsOn 存在环：${name}`); if (visited.has(name)) return; visiting.add(name); for (const dependency of byName[name].dependsOn || []) { if (!byName[dependency]) throw new Error(`epic item ${name} 依赖不存在的 ${dependency}`); visit(dependency); } visiting.delete(name); visited.add(name); };
  for (const item of epic.items) visit(item.name);
  return epic;
}
function epicReadyItems(epic, itemRecords = {}, options = {}) {
  validateEpicDefinition(epic);
  const block = options.block || itemRecords[EPIC_BLOCK_ITEM];
  const metadataIssues = options.metadataIssues || block && block.metadataIssues;
  if (block || (Array.isArray(metadataIssues) && metadataIssues.length)) {
    throw new Error(`Epic 调度被 metadataIssues/block 状态阻断：${(metadataIssues || []).join('；') || '未提供可恢复元数据'}`);
  }
  const limit = options.limit === undefined ? 3 : Number(options.limit);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 3) throw new Error(`Epic 并行上限必须为 1..3：${options.limit}`);
  const running = Object.values(itemRecords).filter((item) => item.status === 'running').length;
  const slots = Math.max(0, limit - running);
  return epic.items.filter((item) => {
    const current = itemRecords[item.name] || { status: item.status || 'pending' };
    return current.status === 'pending' && (item.dependsOn || []).every((dependency) => itemRecords[dependency] && itemRecords[dependency].status === 'done' && itemRecords[dependency].remoteMerged === true);
  }).slice(0, slots);
}
function initializeEpicProgress(root, options) {
  if (!options.worktree) throw new Error('epic-init 必须提供 worktree');
  if (!options.sourceRevision) throw new Error('epic-init 必须提供 sourceRevision');
  const progress = initializeProgress(root, { ...options, kind: 'epic', issue: null, branch: options.mainBranch || 'main' });
  return mutateProgress(root, progress.change, progress.owner, (current) => {
    current.mainBranch = options.mainBranch || 'main';
    current.sourceRevision = options.sourceRevision || null;
  }, { kind: 'epic' });
}
function loadEpicProgress(root, epicName) { return loadProgress(root, epicName, 'epic'); }
function setEpicItem(root, epicName, owner, itemName, status, options = {}) {
  if (itemName === EPIC_BLOCK_ITEM) throw new Error('保留的 Epic metadata block 不能作为子项写入');
  assertStatus(status, EPIC_ITEM_STATUSES, `Epic item ${itemName}`);
  return mutateProgress(root, epicName, owner, (progress) => {
    const item = progress.epicItems[itemName] || { status: 'pending', attempt: 0, evidence: [] };
    if (status === 'done' && options.remoteMerged !== true && item.remoteMerged !== true) throw new Error('Epic 子项仅在远端 merged=true 已核实后才能标记 done');
    if (item.resumeNeedsOwnerCheck && status !== item.status) {
      if (status === 'running') throw new Error('Epic 子项尚未完成 owner 核查；禁止重新派发 running 子 Agent');
      requireEvidence(options.evidence, '恢复 Epic running 子项');
      if (status === 'pending' || status === 'done') delete item.resumeNeedsOwnerCheck;
    } else if (item.status === 'running' && status === 'pending') {
      requireEvidence(options.evidence, '恢复 Epic running 子项');
    }
    if (status === 'running' && item.status !== 'running') item.attempt += 1;
    item.status = status; item.updatedAt = now();
    for (const key of ['worktree', 'branch']) if (options[key] !== undefined) item[key] = options[key];
    if (options.remoteMerged !== undefined) item.remoteMerged = Boolean(options.remoteMerged);
    item.evidence.push(...asEvidence(options.evidence)); progress.epicItems[itemName] = item;
  }, { kind: 'epic' });
}
function selfCheck(root) {
  const template = path.join(__dirname, 'progress-template.md');
  const issues = [];
  if (!fs.existsSync(template)) issues.push(`缺少模板：${template}`);
  else for (const required of ['Native pipe progress', 'pipe-native-progress', '## Phases', '## Resume checks']) if (!fs.readFileSync(template, 'utf8').includes(required)) issues.push(`模板缺少 ${required}`);
  if (!fs.existsSync(path.join(assertRepoRoot(root), '.agents'))) issues.push(`不是含 .agents 的仓库：${root}`);
  return { ok: issues.length === 0, issues, template };
}

module.exports = { PROGRESS_SCHEMA_VERSION, LOCK_SCHEMA_VERSION, PHASES, PHASE_STATUSES, TASK_STATUSES, EPIC_ITEM_STATUSES, EPIC_BLOCK_ITEM, INTEGRATION_CHECKPOINTS, ProgressLockError, runDir, progressFile, lockFile, takeoverFile, takeoverRecoveryFile, legacyStateFile, atomicWrite, newProgress, parseMachineRecord, validateProgress, renderProgress, loadProgress, readLock, readTakeover, acquireLock, assertLockOwner, touchLock, releaseLock, takeoverProgress, recoverStaleTakeover, recoverInitialization, saveProgress, initializeProgress, mutateProgress, setPhase, setTask, recordDecision, recordCheckpoint, migrateLegacyState, validateResume, applyResumeValidation, applyResumeFacts, validateEpicResume, applyEpicResumeFacts, firstIncompletePhase, validateEpicDefinition, epicReadyItems, initializeEpicProgress, loadEpicProgress, setEpicItem, selfCheck };
