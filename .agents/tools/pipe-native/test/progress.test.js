'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const runtime = require('../progress.js');
const cli = require('../progress-cli.js');

function sourceEvidence(seed = 'source') {
  const fingerprintVersion = 'pipe-source-fingerprint/v1';
  const manifest = [{ path: 'src/fixture.ts', kind: 'file', sha256: crypto.createHash('sha256').update(seed).digest('hex') }];
  const manifestJson = JSON.stringify(manifest);
  return {
    fingerprintVersion,
    sourceFingerprint: crypto.createHash('sha256').update(`${fingerprintVersion}\0${manifestJson}`).digest('hex'),
    manifestSha256: crypto.createHash('sha256').update(manifestJson).digest('hex'),
    manifest,
  };
}
const SOURCE = sourceEvidence();

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-native-progress-'));
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  return root;
}

function remove(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function successEvidence(phase) {
  if (phase === 'bootstrap') return { commandIds: ['bootstrap-check'] };
  if (phase === 'architect') return { artifactPaths: ['openspec/changes/demo/design.md', 'openspec/changes/demo/tasks.md'] };
  if (phase === 'spec-gate') return { commandIds: ['openspec-strict'] };
  if (phase === 'dev') return { commitSha: 'dev-sha' };
  if (phase === 'tester') return { commandIds: ['npm-test'] };
  if (phase === 'cr') return { crResult: 'pass', ...SOURCE };
  if (phase === 'verify') return { verificationHead: 'head', ...SOURCE, specFingerprint: 'spec', commandIds: ['verify'], expectedCommandIds: ['verify'], commandEvidence: { verify: { exitCode: 0, head: 'head', sourceFingerprint: SOURCE.sourceFingerprint, specFingerprint: 'spec' } } };
  return {};
}
function epicFacts(worktree, epicItems = {}, sourceRevision = 'epic-base') {
  return { remoteVerified: true, verifiedAt: new Date().toISOString(), branch: 'main', worktree, sourceRevision, epicItems };
}
function checkpointEvidence(id) {
  const values = {
    archive: { archivePath: 'openspec/changes/archive/demo' }, commit: { commitSha: 'commit-sha' }, 'sync-main': { mainHead: 'main-head' },
    push: { remote: 'origin', branch: 'demo', head: 'push-head' }, 'get-or-create-pr': { prNumber: 132, prUrl: 'https://example.test/pr/132', head: 'pr-head' },
    'wait-required-ci': { prNumber: 132, head: 'ci-head', requiredChecks: ['test'], conclusion: 'success' }, merge: { prNumber: 132, mergeSha: 'merge-sha' },
    'verify-remote': { prNumber: 132, mergeSha: 'merge-sha', merged: true }, 'cleanup-local': { worktreeRemoved: true },
  };
  return { type: id, ...SOURCE, ...values[id] };
}
function startIntegrate(root, change, owner) {
  for (const phase of runtime.PHASES.slice(0, -1)) {
    runtime.setPhase(root, change, owner, phase, 'running');
    runtime.setPhase(root, change, owner, phase, 'succeeded', successEvidence(phase));
  }
  runtime.setPhase(root, change, owner, 'integrate', 'running', SOURCE);
}
function validFacts(root, checkpoints = {}) {
  return {
    branch: 'demo', worktree: root, head: 'head', ...SOURCE, specFingerprint: 'spec', checkpoints,
    commits: { 'dev-sha': true, 'bootstrap-sha': true, 'architect-sha': true, 'spec-gate-sha': true, 'tester-sha': true, 'cr-sha': true },
    files: { 'openspec/changes/demo/design.md': true, 'openspec/changes/demo/tasks.md': true },
    commands: { 'bootstrap-check': true, 'openspec-strict': true, 'npm-test': true, verify: { exitCode: 0, head: 'head', sourceFingerprint: SOURCE.sourceFingerprint, specFingerprint: 'spec' } },
  };
}

function concurrentTakeover(moduleFile, root, owner) {
  const source = [
    'const runtime = require(' + JSON.stringify(moduleFile) + ');',
    'try {',
    '  runtime.takeoverProgress(' + JSON.stringify(root) + ", 'demo', " + JSON.stringify(owner) + ", 'codex:old-race', true, { evidence: 'race test' });",
    "  console.log('ok');",
    '} catch (error) {',
    "  console.log('error:' + error.code + ':' + error.message);",
    '}',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { errors += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output, errors }));
  });
}

test('progress: init writes readable Markdown, embedded record, and owner lock', () => {
  const root = tempRoot();
  const owner = 'codex:main-1';
  try {
    runtime.initializeProgress(root, { change: 'demo', issue: 132, branch: 'demo', worktree: root, owner });
    const file = runtime.progressFile(root, 'demo');
    const markdown = fs.readFileSync(file, 'utf8');
    assert.match(markdown, /^---\n/);
    assert.match(markdown, /# Native pipe progress: demo/);
    assert.equal(runtime.parseMachineRecord(markdown).issue, 132);
    assert.equal(runtime.readLock(root, 'demo').owner, owner);
    assert.throws(() => runtime.acquireLock(root, 'demo', 'codex:other'), runtime.ProgressLockError);
    runtime.releaseLock(root, 'demo', owner);
    assert.equal(runtime.readLock(root, 'demo'), null);
  } finally {
    remove(root);
  }
});

test('progress: initialization crash after a complete change lock is recovered with an audited replacement lock', () => {
  const root = tempRoot();
  const previousOwner = 'codex:init-old';
  const owner = 'codex:init-new';
  try {
    // Fault injection: this is exactly the state after acquireLock completed
    // and before initializeProgress first wrote progress.md.
    runtime.acquireLock(root, 'demo', previousOwner, { host: 'local', session: 'crashed-before-progress-write' });
    assert.equal(runtime.loadProgress(root, 'demo'), null);
    assert.equal(runtime.readLock(root, 'demo').owner, previousOwner);
    assert.throws(() => runtime.recoverInitialization(root, {
      change: 'demo', branch: 'demo', worktree: root, owner, previousOwner, evidence: 'old main session exited',
    }), /confirmed-no-live-writer/);
    assert.throws(() => runtime.recoverInitialization(root, {
      change: 'demo', branch: 'demo', worktree: root, owner, previousOwner: 'codex:not-old', confirmedNoLiveWriter: true, evidence: 'old main session exited',
    }), /必须匹配/);
    assert.throws(() => runtime.recoverInitialization(root, {
      change: 'demo', branch: 'demo', worktree: root, owner, previousOwner, confirmedNoLiveWriter: true, evidence: '   ',
    }), /非空 evidence/);
    const progress = runtime.recoverInitialization(root, {
      change: 'demo', branch: 'demo', worktree: root, owner, previousOwner, confirmedNoLiveWriter: true,
      evidence: 'parent confirmed the prior main session and children exited',
    });
    assert.equal(progress.owner, owner);
    assert.equal(runtime.readLock(root, 'demo').owner, owner);
    assert.equal(progress.initializationRecovery.previousOwner, previousOwner);
    assert.match(progress.decisions.at(-1).evidence[0].message, /children exited/);
    assert.equal(fs.readdirSync(runtime.runDir(root, 'demo')).some((name) => name.startsWith(`progress.init-lock.quarantine.${previousOwner}.`)), true);
    assert.equal(fs.existsSync(runtime.takeoverRecoveryFile(root, 'demo')), false);
  } finally {
    remove(root);
  }
});

test('progress: initialization crash after a complete Epic lock is recovered without replacing the old lock in place', () => {
  const root = tempRoot();
  const previousOwner = 'codex:epic-init-old';
  const owner = 'codex:epic-init-new';
  try {
    runtime.acquireLock(root, 'demo-epic', previousOwner, { host: 'local', session: 'crashed-before-epic-progress-write' });
    assert.equal(runtime.loadEpicProgress(root, 'demo-epic'), null);
    assert.throws(() => runtime.recoverInitialization(root, {
      change: 'demo-epic', kind: 'epic', branch: 'feature-branch', mainBranch: 'main', worktree: root, sourceRevision: 'epic-base', owner, previousOwner, confirmedNoLiveWriter: true,
      evidence: 'wrong branch',
    }), /branch 必须与 mainBranch/);
    const progress = runtime.recoverInitialization(root, {
      change: 'demo-epic', kind: 'epic', branch: 'main', worktree: root, sourceRevision: 'epic-base', owner, previousOwner, confirmedNoLiveWriter: true,
      evidence: 'parent confirmed the prior Epic scheduler exited',
    });
    assert.equal(progress.kind, 'epic');
    assert.equal(progress.mainBranch, 'main');
    assert.equal(progress.sourceRevision, 'epic-base');
    assert.equal(runtime.loadEpicProgress(root, 'demo-epic').owner, owner);
    assert.equal(runtime.readLock(root, 'demo-epic').owner, owner);
    assert.equal(fs.readdirSync(runtime.runDir(root, 'demo-epic')).some((name) => name.startsWith(`progress.init-lock.quarantine.${previousOwner}.`)), true);
  } finally {
    remove(root);
  }
});

test('progress: interrupted initialization recovery resumes from quarantined-lock and replacement-lock states', () => {
  for (const stage of ['quarantined-lock', 'replacement-lock']) {
    const root = tempRoot();
    const previousOwner = 'codex:init-recovery-old';
    const owner = 'codex:init-recovery-new';
    try {
      runtime.acquireLock(root, 'demo', previousOwner);
      const quarantine = path.join(runtime.runDir(root, 'demo'), `progress.init-lock.quarantine.${previousOwner}.fault.json`);
      fs.renameSync(runtime.lockFile(root, 'demo'), quarantine);
      if (stage === 'replacement-lock') {
        runtime.acquireLock(root, 'demo', owner, {
          initializationRecoveryId: 'recovery-crash', previousOwner,
          previousLockQuarantine: path.basename(quarantine), confirmedNoLiveWriter: true,
        });
      }
      const progress = runtime.recoverInitialization(root, {
        change: 'demo', branch: 'demo', worktree: root, owner, previousOwner,
        confirmedNoLiveWriter: true, evidence: `resume interrupted ${stage}`,
      });
      assert.equal(progress.owner, owner, stage);
      assert.equal(progress.initializationRecovery.previousLockQuarantine, path.basename(quarantine), stage);
      assert.equal(runtime.readLock(root, 'demo').owner, owner, stage);
    } finally {
      remove(root);
    }
  }
});

test('progress: completed initialization removes only its audited dead recovery claim on retry', () => {
  const root = tempRoot();
  const previousOwner = 'codex:init-complete-old';
  const owner = 'codex:init-complete-new';
  try {
    runtime.acquireLock(root, 'demo', previousOwner);
    const progress = runtime.recoverInitialization(root, {
      change: 'demo', branch: 'demo', worktree: root, owner, previousOwner,
      confirmedNoLiveWriter: true, evidence: 'confirmed prior session exit',
    });
    runtime.atomicWrite(runtime.takeoverRecoveryFile(root, 'demo'), `${JSON.stringify({
      id: 'interrupted-init-cleanup', operation: 'cleanup-initialize', completedRecoveryId: progress.initializationRecovery.id, change: 'demo', kind: 'change',
      owner, previousOwner, host: os.hostname(), pid: 99999999,
    })}\n`);
    const retried = runtime.recoverInitialization(root, {
      change: 'demo', branch: 'demo', worktree: root, owner, previousOwner,
      confirmedNoLiveWriter: true, evidence: 'confirmed init recovery process exit',
    });
    assert.equal(retried.initializationRecovery.id, progress.initializationRecovery.id);
    runtime.atomicWrite(runtime.takeoverRecoveryFile(root, 'demo'), `${JSON.stringify({
      id: 'interrupted-init-cleanup-second', operation: 'cleanup-initialize', completedRecoveryId: progress.initializationRecovery.id,
      rootRecoveryId: progress.initializationRecovery.id, change: 'demo', kind: 'change', owner, previousOwner,
      host: os.hostname(), pid: 99999999,
    })}\n`);
    runtime.recoverInitialization(root, {
      change: 'demo', branch: 'demo', worktree: root, owner, previousOwner,
      confirmedNoLiveWriter: true, evidence: 'confirmed second cleanup recovery process exit',
    });
    assert.equal(fs.existsSync(runtime.takeoverRecoveryFile(root, 'demo')), false);
    assert.equal(fs.readdirSync(runtime.runDir(root, 'demo')).some((name) => name.startsWith('takeover.recovery.quarantine.')), true);
  } finally {
    remove(root);
  }
});

test('progress: takeover can clean a completed dead recovery claim before acquiring the next owner', () => {
  const root = tempRoot();
  const recoveryOwner = 'codex:recovered';
  const nextOwner = 'codex:next';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner: recoveryOwner });
    runtime.atomicWrite(runtime.takeoverRecoveryFile(root, 'demo'), `${JSON.stringify({
      id: 'completed-stale-takeover-recovery', change: 'demo', kind: 'change', previousOwner: 'codex:old',
      staleTakeoverOwner: recoveryOwner, owner: recoveryOwner, host: os.hostname(), pid: 99999999,
    })}\n`);
    const progress = runtime.takeoverProgress(root, 'demo', nextOwner, recoveryOwner, true, { evidence: 'confirmed previous recovery writer exited' });
    assert.equal(progress.owner, nextOwner);
    assert.equal(runtime.readLock(root, 'demo').owner, nextOwner);
    assert.equal(fs.existsSync(runtime.takeoverRecoveryFile(root, 'demo')), false);
    assert.equal(fs.readdirSync(runtime.runDir(root, 'demo')).some((name) => name.startsWith('takeover.recovery.quarantine.completed-stale-takeover-recovery.')), true);
  } finally {
    remove(root);
  }
});

test('progress: takeover resumes after a dead cleanup-completed claim', () => {
  const root = tempRoot();
  const oldOwner = 'codex:cleanup-old';
  const nextOwner = 'codex:cleanup-next';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner: oldOwner });
    runtime.takeoverProgress(root, 'demo', nextOwner, oldOwner, true, { evidence: 'first owner transfer complete' });
    runtime.atomicWrite(runtime.takeoverRecoveryFile(root, 'demo'), `${JSON.stringify({
      id: 'interrupted-cleanup-completed', operation: 'cleanup-completed', completedRecoveryId: 'prior-recovery', rootRecoveryId: 'prior-recovery',
      change: 'demo', kind: 'change', previousOwner: nextOwner, historicalPreviousOwner: oldOwner, owner: 'codex:cleanup-final',
      host: os.hostname(), pid: 99999999,
    })}\n`);
    const recovered = runtime.takeoverProgress(root, 'demo', 'codex:cleanup-final', nextOwner, true, { evidence: 'confirmed interrupted cleanup writer exited' });
    assert.equal(recovered.owner, 'codex:cleanup-final');
    assert.equal(runtime.readLock(root, 'demo').owner, 'codex:cleanup-final');
    assert.equal(fs.existsSync(runtime.takeoverRecoveryFile(root, 'demo')), false);
  } finally {
    remove(root);
  }
});

test('progress: completed cleanup claim after owner transfer is finalized before a new takeover', () => {
  const root = tempRoot();
  const owner = 'codex:cleanup-current';
  const nextOwner = 'codex:cleanup-new';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner: 'codex:cleanup-origin' });
    runtime.takeoverProgress(root, 'demo', owner, 'codex:cleanup-origin', true, { evidence: 'prior takeover completed' });
    runtime.atomicWrite(runtime.takeoverRecoveryFile(root, 'demo'), `${JSON.stringify({
      id: 'cleanup-crashed-after-transfer', operation: 'cleanup-completed', rootRecoveryId: 'root-recovery', completedRecoveryId: 'root-recovery',
      change: 'demo', kind: 'change', previousOwner: 'codex:cleanup-origin', owner,
      host: os.hostname(), pid: 99999999,
    })}\n`);
    const next = runtime.takeoverProgress(root, 'demo', nextOwner, owner, true, { evidence: 'confirmed cleanup writer exited after owner transfer' });
    assert.equal(next.owner, nextOwner);
    assert.equal(runtime.readLock(root, 'demo').owner, nextOwner);
    assert.equal(fs.existsSync(runtime.takeoverRecoveryFile(root, 'demo')), false);
  } finally {
    remove(root);
  }
});

test('progress: takeover requires an exact prior owner and explicit no-live-writer confirmation', () => {
  const root = tempRoot();
  const oldOwner = 'codex:old-session';
  const newOwner = 'codex:new-session';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner: oldOwner });
    assert.throws(() => runtime.takeoverProgress(root, 'demo', newOwner, oldOwner, false), /confirmed-no-live-writer/);
    assert.throws(() => runtime.takeoverProgress(root, 'demo', newOwner, oldOwner, true, { evidence: '   ' }), /非空 evidence/);
    assert.throws(() => runtime.takeoverProgress(root, 'demo', newOwner, 'codex:not-owner', true, { evidence: 'parent checked writer exit' }), /owner 必须匹配/);
    const taken = runtime.takeoverProgress(root, 'demo', newOwner, oldOwner, true, { evidence: 'old main session and child writers have exited' });
    assert.equal(taken.owner, newOwner);
    assert.equal(runtime.readLock(root, 'demo').owner, newOwner);
    assert.equal(taken.decisions.at(-1).decision, '由 codex:new-session 接管');
    assert.match(taken.decisions.at(-1).evidence[0].message, /have exited/);
    assert.equal(fs.existsSync(runtime.takeoverFile(root, 'demo')), false);
  } finally {
    remove(root);
  }
});

test('progress: concurrent takeover claims allow only one new owner', async () => {
  const root = tempRoot();
  const moduleFile = path.resolve(__dirname, '../progress.js');
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner: 'codex:old-race' });
    const [one, two] = await Promise.all([
      concurrentTakeover(moduleFile, root, 'codex:new-race-a'),
      concurrentTakeover(moduleFile, root, 'codex:new-race-b'),
    ]);
    const results = [one, two];
    assert.equal(results.filter((result) => result.code === 0 && result.output.includes('ok')).length, 1);
    assert.equal(results.filter((result) => result.output.includes('PIPE_PROGRESS_LOCKED')).length, 1);
    const progress = runtime.loadProgress(root, 'demo');
    assert.equal(progress.owner, runtime.readLock(root, 'demo').owner);
    assert.equal(fs.existsSync(runtime.takeoverFile(root, 'demo')), false);
  } finally {
    remove(root);
  }
});

test('progress: Epic uses the same explicit takeover lock contract', () => {
  const root = tempRoot();
  const oldOwner = 'codex:epic-old';
  const newOwner = 'codex:epic-new';
  try {
    runtime.initializeEpicProgress(root, { change: 'demo-epic', worktree: root, sourceRevision: 'epic-base', owner: oldOwner });
    runtime.takeoverProgress(root, 'demo-epic', newOwner, oldOwner, true, { kind: 'epic', evidence: 'all epic writers stopped' });
    assert.equal(runtime.loadEpicProgress(root, 'demo-epic').owner, newOwner);
    assert.equal(runtime.readLock(root, 'demo-epic').owner, newOwner);
    assert.equal(fs.existsSync(runtime.progressFile(root, 'demo-epic', 'epic')), true);
  } finally {
    remove(root);
  }
});

test('progress: a normal suspended run without a lock can be safely taken over', () => {
  const root = tempRoot();
  const oldOwner = 'codex:suspended-old';
  const newOwner = 'codex:suspended-new';
  try {
    runtime.initializeProgress(root, { change: 'safe', branch: 'safe', worktree: root, owner: oldOwner });
    runtime.setPhase(root, 'safe', oldOwner, 'bootstrap', 'suspended', { reason: 'waiting for parent decision' });
    runtime.releaseLock(root, 'safe', oldOwner);
    runtime.takeoverProgress(root, 'safe', newOwner, oldOwner, true, { evidence: 'parent checked no child is active' });
    assert.equal(runtime.loadProgress(root, 'safe').owner, newOwner);

    runtime.initializeProgress(root, { change: 'unsafe', branch: 'unsafe', worktree: root, owner: oldOwner });
    runtime.releaseLock(root, 'unsafe', oldOwner);
    assert.throws(() => runtime.takeoverProgress(root, 'unsafe', newOwner, oldOwner, true, { evidence: 'parent checked no child is active' }), /不在正常 suspended/);
  } finally {
    remove(root);
  }
});

test('progress: stale takeover recovery repairs an interrupted lock transfer with an audited claim', () => {
  const root = tempRoot();
  const oldOwner = 'codex:stale-old';
  const staleOwner = 'codex:stale-writer';
  const newOwner = 'codex:stale-recovery';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner: oldOwner });
    const stale = {
      schemaVersion: 1, id: 'takeover-crashed-a', change: 'demo', kind: 'change', previousOwner: oldOwner, owner: staleOwner,
      confirmedNoLiveWriter: true, lockWasAbsent: false, evidence: [{ message: 'original takeover approved' }], createdAt: new Date().toISOString(),
    };
    runtime.atomicWrite(runtime.takeoverFile(root, 'demo'), `${JSON.stringify(stale)}\n`);
    runtime.atomicWrite(runtime.lockFile(root, 'demo'), `${JSON.stringify({ schemaVersion: 1, change: 'demo', owner: staleOwner, acquiredAt: new Date().toISOString(), updatedAt: new Date().toISOString(), takeoverId: stale.id })}\n`);
    assert.throws(() => runtime.recoverStaleTakeover(root, 'demo', newOwner, oldOwner, staleOwner, false, { evidence: 'parent checked stale writer exited' }), /confirmed-no-live-writer/);
    assert.throws(() => runtime.recoverStaleTakeover(root, 'demo', newOwner, oldOwner, staleOwner, true, { evidence: [] }), /非空 evidence/);
    assert.throws(() => runtime.recoverStaleTakeover(root, 'demo', newOwner, oldOwner, 'codex:wrong-stale', true, { evidence: 'parent checked stale writer exited' }), /不匹配/);
    const recovered = runtime.recoverStaleTakeover(root, 'demo', newOwner, oldOwner, staleOwner, true, { evidence: 'parent checked stale writer exited after fault injection' });
    assert.equal(recovered.owner, newOwner);
    assert.equal(runtime.readLock(root, 'demo').owner, newOwner);
    assert.equal(fs.existsSync(runtime.takeoverFile(root, 'demo')), false);
    assert.equal(fs.existsSync(runtime.takeoverRecoveryFile(root, 'demo')), false);
    assert.equal(recovered.takeovers.at(-1).recoveredTakeoverId, stale.id);
    assert.match(recovered.decisions.at(-1).evidence.at(-1).message, /恢复中断的接管事务/);
  } finally {
    remove(root);
  }
});

test('progress: stale takeover recovery also resumes before transfer and after progress transfer', () => {
  for (const stage of ['before-lock-transfer', 'after-progress-transfer']) {
    const root = tempRoot();
    const oldOwner = 'codex:stale-old';
    const staleOwner = 'codex:stale-writer';
    const newOwner = 'codex:stale-recovery';
    try {
      runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner: oldOwner });
      const stale = {
        schemaVersion: 1, id: `takeover-crashed-${stage}`, change: 'demo', kind: 'change', previousOwner: oldOwner, owner: staleOwner,
        confirmedNoLiveWriter: true, lockWasAbsent: false, evidence: [{ message: 'original takeover approved' }], createdAt: new Date().toISOString(),
      };
      runtime.atomicWrite(runtime.takeoverFile(root, 'demo'), `${JSON.stringify(stale)}\n`);
      if (stage === 'after-progress-transfer') {
        runtime.atomicWrite(runtime.lockFile(root, 'demo'), `${JSON.stringify({ schemaVersion: 1, change: 'demo', owner: staleOwner, acquiredAt: new Date().toISOString(), updatedAt: new Date().toISOString(), takeoverId: stale.id })}\n`);
        const progress = runtime.loadProgress(root, 'demo');
        progress.owner = staleOwner;
        runtime.atomicWrite(runtime.progressFile(root, 'demo'), runtime.renderProgress(progress));
      }
      const recovered = runtime.recoverStaleTakeover(root, 'demo', newOwner, oldOwner, staleOwner, true, { evidence: `recovery ${stage}` });
      assert.equal(recovered.owner, newOwner, stage);
      assert.equal(runtime.readLock(root, 'demo').owner, newOwner, stage);
      assert.equal(fs.existsSync(runtime.takeoverFile(root, 'demo')), false, stage);
    } finally {
      remove(root);
    }
  }
});

test('progress: an active stale-takeover recovery claim rejects competing takeover writers', () => {
  const root = tempRoot();
  const owner = 'codex:old';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    runtime.atomicWrite(runtime.takeoverRecoveryFile(root, 'demo'), `${JSON.stringify({ id: 'recovery-active', change: 'demo', owner: 'codex:recovering', host: os.hostname(), pid: process.pid })}\n`);
    assert.throws(() => runtime.takeoverProgress(root, 'demo', 'codex:competing', owner, true, { evidence: 'must not race recovery' }), runtime.ProgressLockError);
  } finally {
    remove(root);
  }
});

test('progress: active recovery lock fails closed and dead same-host recovery lock is quarantined then reclaimed', () => {
  const makeStale = (root) => {
    const oldOwner = 'codex:old';
    const staleOwner = 'codex:stale';
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner: oldOwner });
    runtime.atomicWrite(runtime.takeoverFile(root, 'demo'), `${JSON.stringify({
      schemaVersion: 1, id: 'takeover-pending', change: 'demo', kind: 'change', previousOwner: oldOwner, owner: staleOwner,
      confirmedNoLiveWriter: true, lockWasAbsent: false, evidence: [], createdAt: new Date().toISOString(),
    })}\n`);
    return { oldOwner, staleOwner };
  };
  const activeRoot = tempRoot();
  const deadRoot = tempRoot();
  const remoteRoot = tempRoot();
  try {
    const active = makeStale(activeRoot);
    runtime.atomicWrite(runtime.takeoverRecoveryFile(activeRoot, 'demo'), `${JSON.stringify({
      id: 'active-recovery', change: 'demo', host: os.hostname(), pid: process.pid, owner: 'codex:other',
    })}\n`);
    assert.throws(() => runtime.recoverStaleTakeover(activeRoot, 'demo', 'codex:new', active.oldOwner, active.staleOwner, true, { evidence: 'must not steal active recovery' }), /仍存活/);

    const dead = makeStale(deadRoot);
    runtime.atomicWrite(runtime.takeoverRecoveryFile(deadRoot, 'demo'), `${JSON.stringify({
      id: 'dead-recovery', change: 'demo', host: os.hostname(), pid: 99999999, owner: 'codex:dead',
    })}\n`);
    const recovered = runtime.recoverStaleTakeover(deadRoot, 'demo', 'codex:new', dead.oldOwner, dead.staleOwner, true, { evidence: 'pid was confirmed absent' });
    assert.equal(recovered.owner, 'codex:new');
    assert.equal(fs.existsSync(runtime.takeoverRecoveryFile(deadRoot, 'demo')), false);
    assert.equal(fs.readdirSync(runtime.runDir(deadRoot, 'demo')).some((name) => name.startsWith('takeover.recovery.quarantine.dead-recovery.')), true);

    const remote = makeStale(remoteRoot);
    runtime.atomicWrite(runtime.takeoverRecoveryFile(remoteRoot, 'demo'), `${JSON.stringify({
      id: 'remote-recovery', change: 'demo', host: 'unverifiable-remote-host', pid: 42, owner: 'codex:remote',
    })}\n`);
    assert.throws(() => runtime.recoverStaleTakeover(remoteRoot, 'demo', 'codex:new', remote.oldOwner, remote.staleOwner, true, { evidence: 'must not reclaim remote host' }), /远端主机/);
  } finally {
    remove(activeRoot);
    remove(deadRoot);
    remove(remoteRoot);
  }
});

test('progress: phase gates require predecessors and recheckable success evidence', () => {
  const root = tempRoot();
  const owner = 'codex:gates';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    assert.throws(() => runtime.setPhase(root, 'demo', owner, 'dev', 'running'), /必须先成功完成 bootstrap/);
    runtime.setPhase(root, 'demo', owner, 'bootstrap', 'running');
    assert.throws(() => runtime.setPhase(root, 'demo', owner, 'bootstrap', 'succeeded'), /commandIds/);
    runtime.setPhase(root, 'demo', owner, 'bootstrap', 'succeeded', { commandIds: ['preflight'] });
    assert.equal(runtime.loadProgress(root, 'demo').phases.bootstrap.status, 'succeeded');
  } finally {
    remove(root);
  }
});

test('progress: typed checkpoint evidence is revalidated during resume', () => {
  const root = tempRoot();
  const owner = 'codex:checkpoint-resume';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    startIntegrate(root, 'demo', owner);
    assert.throws(() => runtime.recordCheckpoint(root, 'demo', owner, { id: 'archive', status: 'succeeded', evidence: { type: 'archive' } }), /archivePath/);
    const evidence = { type: 'archive', archivePath: 'openspec/changes/archive/demo', ...SOURCE };
    runtime.recordCheckpoint(root, 'demo', owner, { id: 'archive', status: 'succeeded', evidence });
    const progress = runtime.loadProgress(root, 'demo');
    assert.equal(runtime.validateResume(progress, {}).valid, false);
    assert.equal(runtime.validateResume(progress, { checkpoints: { archive: { type: 'archive', archivePath: 'other' } } }).valid, false);
    assert.deepEqual(runtime.validateResume(progress, validFacts(root, { archive: evidence })).checkpointProblems, []);
  } finally {
    remove(root);
  }
});

test('progress: integrate cannot succeed before every ordered checkpoint succeeds', () => {
  const root = tempRoot();
  const owner = 'codex:integrate-gate';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    for (const phase of runtime.PHASES.slice(0, -1)) {
      runtime.setPhase(root, 'demo', owner, phase, 'running');
      runtime.setPhase(root, 'demo', owner, phase, 'succeeded', successEvidence(phase));
    }
    runtime.setPhase(root, 'demo', owner, 'integrate', 'running', { ...SOURCE });
    assert.throws(() => runtime.setPhase(root, 'demo', owner, 'integrate', 'succeeded'), /全部集成 checkpoint/);
    for (const id of runtime.INTEGRATION_CHECKPOINTS) {
      runtime.recordCheckpoint(root, 'demo', owner, { id, status: 'succeeded', evidence: checkpointEvidence(id) });
    }
    runtime.setPhase(root, 'demo', owner, 'integrate', 'succeeded');
    const progress = runtime.loadProgress(root, 'demo');
    assert.equal(progress.phases.integrate.status, 'succeeded');
    const checkpoints = Object.fromEntries(runtime.INTEGRATION_CHECKPOINTS.map((id) => [id, checkpointEvidence(id)]));
    assert.equal(runtime.validateResume(progress, validFacts(root, checkpoints)).valid, true);
  } finally {
    remove(root);
  }
});

test('progress: Verify source fingerprint gates integrate and every checkpoint write', () => {
  const root = tempRoot();
  const owner = 'codex:source-gate';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    for (const phase of runtime.PHASES.slice(0, -1)) {
      runtime.setPhase(root, 'demo', owner, phase, 'running');
      runtime.setPhase(root, 'demo', owner, phase, 'succeeded', successEvidence(phase));
    }
    assert.throws(() => runtime.setPhase(root, 'demo', owner, 'integrate', 'running'), /sourceFingerprint/);
    let invalidated = runtime.loadProgress(root, 'demo');
    assert.equal(invalidated.phases.verify.status, 'pending');
    assert.equal(invalidated.phases.integrate.status, 'pending');
    runtime.setPhase(root, 'demo', owner, 'verify', 'running');
    runtime.setPhase(root, 'demo', owner, 'verify', 'succeeded', successEvidence('verify'));
    assert.throws(() => runtime.setPhase(root, 'demo', owner, 'integrate', 'running', { sourceFingerprint: 'source-after-verify' }), /与 Verify 一致/);
    invalidated = runtime.loadProgress(root, 'demo');
    assert.equal(invalidated.phases.verify.status, 'pending');
    assert.equal(invalidated.phases.integrate.status, 'pending');
    runtime.setPhase(root, 'demo', owner, 'verify', 'running');
    runtime.setPhase(root, 'demo', owner, 'verify', 'succeeded', successEvidence('verify'));
    runtime.setPhase(root, 'demo', owner, 'integrate', 'running', { ...SOURCE });
    runtime.recordCheckpoint(root, 'demo', owner, { id: 'archive', status: 'succeeded', evidence: checkpointEvidence('archive') });
    assert.throws(() => runtime.recordCheckpoint(root, 'demo', owner, {
      id: 'commit', status: 'succeeded', evidence: { ...checkpointEvidence('commit'), ...sourceEvidence('changed') },
    }), /与 Verify 一致/);
    invalidated = runtime.loadProgress(root, 'demo');
    assert.equal(invalidated.phases.verify.status, 'pending');
    assert.equal(invalidated.phases.integrate.status, 'pending');
    assert.equal(invalidated.sourceFingerprintInvalidation.action, '集成 checkpoint commit');
    assert.equal([...invalidated.checkpoints].reverse().find((item) => item.id === 'archive').status, 'pending');
    runtime.setPhase(root, 'demo', owner, 'verify', 'running');
    runtime.setPhase(root, 'demo', owner, 'verify', 'succeeded', successEvidence('verify'));
    runtime.setPhase(root, 'demo', owner, 'integrate', 'running', { ...SOURCE });
    runtime.recordCheckpoint(root, 'demo', owner, { id: 'archive', status: 'succeeded', evidence: checkpointEvidence('archive') });
    assert.equal(runtime.loadProgress(root, 'demo').checkpoints.at(-1).evidence.sourceFingerprint, SOURCE.sourceFingerprint);
  } finally {
    remove(root);
  }
});

test('progress: first mismatched checkpoint invalidates it and every later checkpoint', () => {
  const root = tempRoot();
  const owner = 'codex:checkpoint-reset';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    startIntegrate(root, 'demo', owner);
    for (const id of runtime.INTEGRATION_CHECKPOINTS) {
      runtime.recordCheckpoint(root, 'demo', owner, { id, status: 'succeeded', evidence: checkpointEvidence(id) });
    }
    const facts = validFacts(root, Object.fromEntries(runtime.INTEGRATION_CHECKPOINTS.map((id) => [id, checkpointEvidence(id)])));
    facts.checkpoints.archive = { ...checkpointEvidence('archive'), archivePath: 'stale-archive' };
    runtime.applyResumeFacts(root, 'demo', owner, facts);
    const progress = runtime.loadProgress(root, 'demo');
    for (const id of runtime.INTEGRATION_CHECKPOINTS) {
      assert.equal([...progress.checkpoints].reverse().find((item) => item.id === id).status, 'pending');
    }
    runtime.setPhase(root, 'demo', owner, 'integrate', 'running', { ...SOURCE });
    assert.throws(() => runtime.recordCheckpoint(root, 'demo', owner, { id: 'commit', status: 'succeeded', evidence: checkpointEvidence('commit') }), /必须先完成 archive/);
    runtime.recordCheckpoint(root, 'demo', owner, { id: 'archive', status: 'succeeded', evidence: checkpointEvidence('archive') });
    runtime.recordCheckpoint(root, 'demo', owner, { id: 'commit', status: 'succeeded', evidence: checkpointEvidence('commit') });
  } finally {
    remove(root);
  }
});

test('progress: terminal lifecycle resumes from integrate after merge on main with deleted worktree', () => {
  const root = tempRoot();
  const owner = 'codex:terminal-lifecycle';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    startIntegrate(root, 'demo', owner);
    for (const id of runtime.INTEGRATION_CHECKPOINTS) {
      runtime.recordCheckpoint(root, 'demo', owner, { id, status: 'succeeded', evidence: checkpointEvidence(id) });
    }
    const terminalFacts = {
      branch: 'main',
      terminalLifecycle: { mainBranch: 'main', worktreeDeleted: true, mergeSha: 'merge-sha' },
      commits: { 'merge-sha': true, head: true },
      commands: { verify: { exitCode: 0, head: 'head', ...SOURCE, specFingerprint: 'spec' } },
      checkpoints: Object.fromEntries(runtime.INTEGRATION_CHECKPOINTS.map((id) => [id, checkpointEvidence(id)])),
    };
    assert.equal(runtime.validateResume(runtime.loadProgress(root, 'demo'), { ...terminalFacts, commands: {} }).terminalLifecycle.complete, false);
    assert.equal(runtime.validateResume(runtime.loadProgress(root, 'demo'), {
      ...terminalFacts,
      commands: { verify: { ...terminalFacts.commands.verify, specFingerprint: 'archived-spec' } },
    }).terminalLifecycle.complete, false);
    const plan = runtime.validateResume(runtime.loadProgress(root, 'demo'), terminalFacts);
    assert.equal(plan.terminalLifecycle.complete, true);
    assert.deepEqual(plan.reusablePhases, runtime.PHASES.slice(0, -1));
    assert.equal(plan.firstReadyPhase, 'integrate');
    runtime.applyResumeFacts(root, 'demo', owner, terminalFacts);
    assert.equal(runtime.loadProgress(root, 'demo').phases.integrate.status, 'running');

    runtime.setPhase(root, 'demo', owner, 'integrate', 'succeeded');
    const completed = runtime.validateResume(runtime.loadProgress(root, 'demo'), terminalFacts);
    assert.equal(completed.terminalLifecycle.complete, true);
    assert.deepEqual(completed.reusablePhases, runtime.PHASES);
  } finally {
    remove(root);
  }
});

test('progress: epic resume apply requeues unmerged items but preserves running child ownership', () => {
  const root = tempRoot();
  const owner = 'codex:epic-resume';
  try {
    runtime.initializeEpicProgress(root, { change: 'demo-epic', worktree: root, sourceRevision: 'epic-base', owner });
    runtime.setEpicItem(root, 'demo-epic', owner, 'A', 'done', { remoteMerged: true });
    runtime.setEpicItem(root, 'demo-epic', owner, 'B', 'running');
    runtime.applyEpicResumeFacts(root, 'demo-epic', owner, epicFacts(root, { A: { remoteMerged: true, prNumber: 9, mergeSha: 'merge-a' }, B: { remoteMerged: false } }));
    const progress = runtime.loadEpicProgress(root, 'demo-epic');
    assert.equal(progress.epicItems.A.status, 'done');
    assert.equal(progress.epicItems.B.status, 'running');
    assert.equal(progress.epicItems.B.resumeNeedsOwnerCheck, true);
    assert.equal(progress.resumeValidation.invalidItems[0].name, 'B');
    assert.throws(() => runtime.setEpicItem(root, 'demo-epic', owner, 'B', 'pending'), /非空 evidence/);
    assert.throws(() => runtime.setEpicItem(root, 'demo-epic', owner, 'B', 'failed'), /非空 evidence/);
    runtime.setEpicItem(root, 'demo-epic', owner, 'B', 'failed', { evidence: '主会话已核实原生子 Agent 与写入者全部退出' });
    assert.equal(runtime.loadEpicProgress(root, 'demo-epic').epicItems.B.resumeNeedsOwnerCheck, true);
    assert.throws(() => runtime.setEpicItem(root, 'demo-epic', owner, 'B', 'pending'), /非空 evidence/);
    runtime.setEpicItem(root, 'demo-epic', owner, 'B', 'pending', { evidence: '主会话再次核实子 Agent 已退出并完成 worktree 核查' });
    assert.equal(runtime.loadEpicProgress(root, 'demo-epic').epicItems.B.status, 'pending');
    assert.equal(runtime.loadEpicProgress(root, 'demo-epic').epicItems.B.resumeNeedsOwnerCheck, undefined);
  } finally {
    remove(root);
  }
});

test('progress: stale Epic done markers are cleared unless fresh remote merge facts confirm them', () => {
  const root = tempRoot();
  const owner = 'codex:epic-stale-done';
  const definition = { items: [{ name: 'A' }, { name: 'B', dependsOn: ['A'] }] };
  try {
    runtime.initializeEpicProgress(root, { change: 'demo-epic', worktree: root, sourceRevision: 'epic-base', owner });
    runtime.setEpicItem(root, 'demo-epic', owner, 'A', 'done', { remoteMerged: true });
    assert.throws(() => runtime.applyEpicResumeFacts(root, 'demo-epic', owner, {
      branch: 'main', worktree: root, sourceRevision: 'epic-base', epicItems: { A: { remoteMerged: false } },
    }), /fresh|远端 merge facts/);
    runtime.applyEpicResumeFacts(root, 'demo-epic', owner, epicFacts(root, { A: { remoteMerged: false, issueNumber: 10 } }));
    const progress = runtime.loadEpicProgress(root, 'demo-epic');
    assert.equal(progress.epicItems.A.status, 'pending');
    assert.equal(progress.epicItems.A.remoteMerged, false);
    assert.deepEqual(runtime.epicReadyItems(definition, progress.epicItems).map((item) => item.name), ['A']);
    runtime.applyEpicResumeFacts(root, 'demo-epic', owner, epicFacts(root, { A: { remoteMerged: true, issueNumber: 10, prNumber: 20, mergeSha: 'merge-a' } }));
    assert.deepEqual(runtime.epicReadyItems(definition, runtime.loadEpicProgress(root, 'demo-epic').epicItems).map((item) => item.name), ['B']);
  } finally {
    remove(root);
  }
});

test('progress: Epic initialization requires durable metadata and sourceRevision mismatch blocks readiness', () => {
  const root = tempRoot();
  const owner = 'codex:epic-metadata';
  const definition = { items: [{ name: 'A', dependsOn: [] }] };
  try {
    assert.throws(() => runtime.initializeEpicProgress(root, { change: 'missing-worktree', sourceRevision: 'base', owner }), /worktree/);
    assert.throws(() => runtime.initializeEpicProgress(root, { change: 'missing-revision', worktree: root, owner }), /sourceRevision/);
    runtime.initializeEpicProgress(root, { change: 'demo-epic', worktree: root, sourceRevision: 'base', owner });
    runtime.applyEpicResumeFacts(root, 'demo-epic', owner, {
      ...epicFacts(root, {}, 'different-base'),
    });
    const blocked = runtime.loadEpicProgress(root, 'demo-epic');
    assert.match(blocked.epicDispatchBlock.metadataIssues[0], /sourceRevision/);
    assert.equal(blocked.epicItems[runtime.EPIC_BLOCK_ITEM].status, 'blocked');
    assert.throws(() => runtime.epicReadyItems(definition, blocked.epicItems), /metadataIssues\/block/);
    runtime.applyEpicResumeFacts(root, 'demo-epic', owner, {
      ...epicFacts(root, {}, 'base'),
    });
    assert.equal(runtime.loadEpicProgress(root, 'demo-epic').epicDispatchBlock, undefined);
    assert.deepEqual(runtime.epicReadyItems(definition, runtime.loadEpicProgress(root, 'demo-epic').epicItems).map((item) => item.name), ['A']);
  } finally {
    remove(root);
  }
});

test('progress: phase attempts, CR round, task and checkpoint are durable', () => {
  const root = tempRoot();
  const owner = 'codex:main-2';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    runtime.setPhase(root, 'demo', owner, 'bootstrap', 'running', { agentId: 'native-child-1', evidence: 'preflight passed' });
    runtime.setPhase(root, 'demo', owner, 'bootstrap', 'succeeded', { commandIds: ['preflight'], evidence: 'recorded command' });
    runtime.setPhase(root, 'demo', owner, 'architect', 'running', { attempt: 2, evidence: 'retry' });
    runtime.setPhase(root, 'demo', owner, 'architect', 'succeeded', { evidence: 'design written', artifactPaths: ['openspec/changes/demo/design.md', 'openspec/changes/demo/tasks.md'] });
    runtime.setPhase(root, 'demo', owner, 'spec-gate', 'running');
    runtime.setPhase(root, 'demo', owner, 'spec-gate', 'succeeded', { commandIds: ['openspec-strict'] });
    runtime.setPhase(root, 'demo', owner, 'dev', 'running');
    runtime.setPhase(root, 'demo', owner, 'dev', 'succeeded', { commitSha: 'def' });
    runtime.setPhase(root, 'demo', owner, 'tester', 'running');
    runtime.setPhase(root, 'demo', owner, 'tester', 'succeeded', { commandIds: ['npm-test'] });
    runtime.setPhase(root, 'demo', owner, 'cr', 'running', { crRound: 2 });
    runtime.setTask(root, 'demo', owner, '1.2', 'succeeded', { phase: 'dev', taskOwner: 'native-child-1', evidence: 'scope audit' });
    runtime.recordCheckpoint(root, 'demo', owner, { id: 'archive', status: 'pending', evidence: 'awaiting verify' });
    const progress = runtime.loadProgress(root, 'demo');
    assert.equal(progress.phases.architect.attempt, 2);
    assert.equal(progress.phases.cr.crRound, 2);
    assert.equal(progress.tasks['1.2'].owner, 'native-child-1');
    assert.equal(progress.checkpoints[0].id, 'archive');
  } finally {
    remove(root);
  }
});

test('progress: legacy state is read-only migration with unverified candidates', () => {
  const root = tempRoot();
  const owner = 'codex:migrate';
  try {
    const legacy = runtime.legacyStateFile(root, 'legacy');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    const original = JSON.stringify({ schemaVersion: 3, nodes: { dev: { status: 'succeeded', attempts: 1, commitSha: 'deadbeef' } } }, null, 2);
    fs.writeFileSync(legacy, original);
    const progress = runtime.migrateLegacyState(root, { change: 'legacy', owner, branch: 'legacy', worktree: root });
    assert.equal(fs.readFileSync(legacy, 'utf8'), original);
    assert.equal(progress.migration.candidates[0].verification, 'unverified');
    assert.equal(progress.phases.dev.status, 'pending');
    assert.equal(progress.phases.dev.legacyCandidate.legacyStatus, 'succeeded');
  } finally {
    remove(root);
  }
});

test('progress: resume invalidates failed evidence and downstream phases only', () => {
  const root = tempRoot();
  const owner = 'codex:resume';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    for (const phase of ['bootstrap', 'architect', 'spec-gate']) {
      runtime.setPhase(root, 'demo', owner, phase, 'running');
      runtime.setPhase(root, 'demo', owner, phase, 'succeeded', phase === 'architect' ? { ...successEvidence(phase), commitSha: phase + '-sha' } : phase === 'bootstrap' ? successEvidence(phase) : { ...successEvidence(phase), commitSha: phase + '-sha' });
    }
    const facts = validFacts(root);
    facts.head = 'spec-gate-sha';
    facts.commits['architect-sha'] = false;
    const plan = runtime.validateResume(runtime.loadProgress(root, 'demo'), facts);
    assert.deepEqual(plan.reusablePhases, ['bootstrap']);
    assert.deepEqual(plan.invalidatedPhases, ['architect', 'spec-gate', 'dev', 'tester', 'cr', 'verify', 'integrate']);
    runtime.applyResumeFacts(root, 'demo', owner, facts);
    const repaired = runtime.loadProgress(root, 'demo');
    assert.equal(repaired.phases.bootstrap.status, 'succeeded');
    assert.equal(repaired.phases.architect.status, 'pending');
    assert.equal(repaired.phases['spec-gate'].status, 'pending');
  } finally {
    remove(root);
  }
});

test('progress: interrupted native child is never silently reusable', () => {
  const root = tempRoot();
  const owner = 'codex:interrupted';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    runtime.setPhase(root, 'demo', owner, 'bootstrap', 'running', { agentId: 'child-writing' });
    const plan = runtime.validateResume(runtime.loadProgress(root, 'demo'), { branch: 'demo', worktree: root });
    assert.deepEqual(plan.interruptedPhases, ['bootstrap']);
    assert.equal(plan.firstReadyPhase, 'bootstrap');
  } finally {
    remove(root);
  }
});

test('progress: Verify and resume facts fail closed when HEAD is absent or changed', () => {
  const root = tempRoot();
  const owner = 'codex:verify';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    for (const phase of ['bootstrap', 'architect', 'spec-gate', 'dev', 'tester', 'cr']) {
      runtime.setPhase(root, 'demo', owner, phase, 'running');
      runtime.setPhase(root, 'demo', owner, phase, 'succeeded', { ...successEvidence(phase), commitSha: phase + '-sha' });
    }
    runtime.setPhase(root, 'demo', owner, 'verify', 'running');
    assert.throws(() => runtime.setPhase(root, 'demo', owner, 'verify', 'succeeded', { commandIds: ['all'] }), /verificationHead/);
    assert.throws(() => runtime.setPhase(root, 'demo', owner, 'verify', 'succeeded', { verificationHead: 'verify-sha', ...SOURCE, specFingerprint: 'spec-a' }), /commandIds/);
    const commandEvidence = { all: { exitCode: 0, head: 'verify-sha', sourceFingerprint: SOURCE.sourceFingerprint, specFingerprint: 'spec-a' } };
    assert.throws(() => runtime.setPhase(root, 'demo', owner, 'verify', 'succeeded', { verificationHead: 'verify-sha', ...SOURCE, specFingerprint: 'spec-a', commandIds: ['all'], expectedCommandIds: ['all'] }), /commandEvidence/);
    assert.throws(() => runtime.setPhase(root, 'demo', owner, 'verify', 'succeeded', { verificationHead: 'verify-sha', ...SOURCE, specFingerprint: 'spec-a', commandIds: ['all'], expectedCommandIds: ['all'], commandEvidence: { all: { ...commandEvidence.all, exitCode: 1 } } }), /成功退出码/);
    runtime.setPhase(root, 'demo', owner, 'verify', 'succeeded', { verificationHead: 'verify-sha', ...SOURCE, specFingerprint: 'spec-a', commandIds: ['all'], expectedCommandIds: ['all'], commandEvidence });
    const baseFacts = { branch: 'demo', worktree: root, head: 'verify-sha', ...SOURCE, specFingerprint: 'spec-a', commands: { 'bootstrap-check': true, 'openspec-strict': true, 'npm-test': true, all: { exitCode: 0, head: 'verify-sha', ...SOURCE, specFingerprint: 'spec-a' } }, files: { 'openspec/changes/demo/design.md': true, 'openspec/changes/demo/tasks.md': true }, commits: {
      'bootstrap-sha': true, 'architect-sha': true, 'spec-gate-sha': true, 'dev-sha': true, 'tester-sha': true, 'cr-sha': true,
    } };
    assert.equal(runtime.validateResume(runtime.loadProgress(root, 'demo'), baseFacts).valid, true);
    assert.equal(runtime.validateResume(runtime.loadProgress(root, 'demo'), { ...baseFacts, head: 'later-sha' }).valid, false);
    assert.equal(runtime.validateResume(runtime.loadProgress(root, 'demo'), { ...baseFacts, sourceFingerprint: 'source-b' }).valid, false);
    assert.equal(runtime.validateResume(runtime.loadProgress(root, 'demo'), { ...baseFacts, specFingerprint: 'spec-b' }).valid, false);
    assert.equal(runtime.validateResume(runtime.loadProgress(root, 'demo'), { ...baseFacts, commands: { all: { ...baseFacts.commands.all, exitCode: 1 } } }).valid, false);
    assert.equal(runtime.validateResume(runtime.loadProgress(root, 'demo'), { ...baseFacts, commands: { all: { exitCode: 0, head: 'verify-sha', ...SOURCE } } }).valid, false);
    assert.equal(runtime.validateResume(runtime.loadProgress(root, 'demo'), { branch: 'demo', worktree: root }).valid, false);
  } finally {
    remove(root);
  }
});

test('progress: integration checkpoints enforce order and success evidence', () => {
  const root = tempRoot();
  const owner = 'codex:integrate';
  try {
    runtime.initializeProgress(root, { change: 'demo', branch: 'demo', worktree: root, owner });
    startIntegrate(root, 'demo', owner);
    assert.throws(() => runtime.recordCheckpoint(root, 'demo', owner, { id: 'commit', status: 'succeeded', evidence: checkpointEvidence('commit') }), /必须先完成 archive/);
    assert.throws(() => runtime.recordCheckpoint(root, 'demo', owner, { id: 'archive', status: 'succeeded' }), /typed evidence/);
    runtime.recordCheckpoint(root, 'demo', owner, { id: 'archive', status: 'succeeded', evidence: checkpointEvidence('archive') });
    runtime.recordCheckpoint(root, 'demo', owner, { id: 'commit', status: 'succeeded', evidence: checkpointEvidence('commit') });
    assert.equal(runtime.loadProgress(root, 'demo').checkpoints.at(-1).id, 'commit');
  } finally {
    remove(root);
  }
});

test('progress: epic readiness requires remote-merged dependencies and caps at three', () => {
  const epic = {
    items: [
      { name: 'A', dependsOn: [] },
      { name: 'B', dependsOn: [] },
      { name: 'C', dependsOn: [] },
      { name: 'D', dependsOn: [] },
      { name: 'E', dependsOn: ['A'] },
    ],
  };
  assert.deepEqual(runtime.epicReadyItems(epic, {}, { limit: 3 }).map((item) => item.name), ['A', 'B', 'C']);
  const records = { A: { status: 'done', remoteMerged: true } };
  assert.deepEqual(runtime.epicReadyItems(epic, records, { limit: 3 }).map((item) => item.name), ['B', 'C', 'D']);
  records.B = { status: 'done', remoteMerged: true };
  records.C = { status: 'done', remoteMerged: true };
  records.D = { status: 'done', remoteMerged: true };
  assert.deepEqual(runtime.epicReadyItems(epic, records, { limit: 3 }).map((item) => item.name), ['E']);
  assert.deepEqual(runtime.epicReadyItems(epic, { A: { status: 'running' }, B: { status: 'running' } }, { limit: 3 }).map((item) => item.name), ['C']);
  assert.throws(() => runtime.epicReadyItems({ items: [{ name: 'A', dependsOn: ['A'] }] }), /存在环/);
});

test('progress CLI: parses repeated evidence without process launch', () => {
  const parsed = cli.parse(['phase', 'demo', 'cr', 'running', '--owner', 'codex:main', '--evidence', 'one', '--evidence', 'two']);
  assert.deepEqual(parsed.positionals, ['phase', 'demo', 'cr', 'running']);
  assert.deepEqual(parsed.options.evidence, ['one', 'two']);
});

test('progress CLI: takeover-recover forwards exact owners, confirmation, evidence, and epic kind', () => {
  const root = tempRoot();
  const original = runtime.recoverStaleTakeover;
  const originalLog = console.log;
  const calls = [];
  try {
    runtime.recoverStaleTakeover = (...args) => { calls.push(args); return { recovered: true }; };
    console.log = () => {};
    assert.equal(cli.run([
      'takeover-recover', 'demo-epic', '--repo-root', root, '--owner', 'codex:new', '--previous-owner', 'codex:old',
      '--stale-takeover-owner', 'codex:stale', '--confirmed-no-live-writer', 'true', '--evidence', 'parent confirmed writer exit', '--epic',
    ]), 0);
    assert.deepEqual(calls[0], [root, 'demo-epic', 'codex:new', 'codex:old', 'codex:stale', true, {
      kind: 'epic', evidence: ['parent confirmed writer exit'],
    }]);
    runtime.recoverStaleTakeover = original;
    assert.throws(() => cli.run([
      'takeover-recover', 'demo', '--repo-root', root, '--owner', 'codex:new', '--previous-owner', 'codex:old',
      '--stale-takeover-owner', 'codex:stale', '--evidence', 'missing explicit confirmation',
    ]), /confirmed-no-live-writer/);
    assert.throws(() => cli.run([
      'takeover', 'demo', '--repo-root', root, '--owner', 'codex:new', '--previous-owner', 'codex:old', '--confirmed-no-live-writer', 'true',
    ]), /非空 evidence/);
    assert.throws(() => cli.run([
      'takeover-recover', 'demo', '--repo-root', root, '--owner', 'codex:new', '--previous-owner', 'codex:old',
      '--stale-takeover-owner', 'codex:stale', '--confirmed-no-live-writer', 'true',
    ]), /非空 evidence/);
  } finally {
    runtime.recoverStaleTakeover = original;
    console.log = originalLog;
    remove(root);
  }
});

test('progress CLI: init-recover requires audited metadata and phase reads the versioned source manifest', () => {
  const root = tempRoot();
  const sourceFile = path.join(root, 'manifest.json');
  const manifest = { ...SOURCE, fingerprint: SOURCE.sourceFingerprint };
  delete manifest.sourceFingerprint;
  fs.writeFileSync(sourceFile, JSON.stringify(manifest));
  const originalRecover = runtime.recoverInitialization;
  const originalSetPhase = runtime.setPhase;
  const originalLog = console.log;
  const calls = [];
  try {
    runtime.recoverInitialization = (...args) => { calls.push(['init-recover', ...args]); return { recovered: true }; };
    runtime.setPhase = (...args) => { calls.push(['phase', ...args]); return { recorded: true }; };
    console.log = () => {};
    assert.equal(cli.run([
      'init-recover', 'demo', '--repo-root', root, '--owner', 'codex:new', '--previous-owner', 'codex:old',
      '--confirmed-no-live-writer', 'true', '--evidence', 'confirmed prior session exited', '--branch', 'demo', '--worktree', root,
    ]), 0);
    assert.equal(calls[0][0], 'init-recover');
    assert.deepEqual(calls[0][2], {
      change: 'demo', kind: 'change', owner: 'codex:new', previousOwner: 'codex:old', confirmedNoLiveWriter: true,
      evidence: ['confirmed prior session exited'], branch: 'demo', worktree: root, issue: undefined, mainBranch: undefined, sourceRevision: undefined,
    });
    assert.equal(cli.run([
      'phase', 'demo', 'verify', 'running', '--repo-root', root, '--owner', 'codex:new', '--source-manifest', sourceFile,
    ]), 0);
    const phaseArgs = calls.find((entry) => entry[0] === 'phase');
    assert.equal(phaseArgs[6].sourceFingerprint, SOURCE.sourceFingerprint);
    assert.equal(phaseArgs[6].fingerprintVersion, SOURCE.fingerprintVersion);
    assert.deepEqual(phaseArgs[6].manifest, SOURCE.manifest);
    assert.throws(() => cli.run(['epic-init', 'demo', '--repo-root', root, '--owner', 'codex:new']), /worktree/);
  } finally {
    runtime.recoverInitialization = originalRecover;
    runtime.setPhase = originalSetPhase;
    console.log = originalLog;
    remove(root);
  }
});
