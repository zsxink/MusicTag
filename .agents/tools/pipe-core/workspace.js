'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { runCommand } = require('./command-runner.js');

function git(root, args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...options });
}

function fingerprint(root, relativePath) {
  const file = path.join(root, relativePath);
  try {
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) return `dir:${stat.mtimeMs}`;
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) {
    return 'missing';
  }
}

function statusEntries(root) {
  const entries = new Map();
  const raw = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const records = raw.split('\0').filter(Boolean);
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const status = record.slice(0, 2);
    let file = record.slice(3);
    if (/^[RC]/.test(status) || /^[RC]/.test(status.slice(1))) {
      const destination = records[++index];
      if (destination) file = destination;
    }
    if (!file || file.startsWith('.agents/runs/')) continue;
    entries.set(file, { status, fingerprint: fingerprint(root, file) });
  }
  const ignored = git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  for (const file of ignored) {
    if (!file.startsWith('.agents/runs/')) entries.set(file, { status: '!!', fingerprint: fingerprint(root, file) });
  }
  return entries;
}

function snapshot(root = process.cwd()) {
  const indexPatch = git(root, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-color']);
  return {
    root,
    head: git(root, ['rev-parse', 'HEAD']).trim(),
    indexFingerprint: crypto.createHash('sha256').update(indexPatch).digest('hex'),
    entries: statusEntries(root),
    capturedAt: new Date().toISOString(),
  };
}

function scopeMatches(file, scope) {
  const normalized = String(scope || '').replace(/^\.\//, '');
  if (!normalized) return false;
  if (normalized.includes('*')) {
    const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`).test(file);
  }
  return normalized.endsWith('/') ? file.startsWith(normalized) : file === normalized || file.startsWith(`${normalized}/`);
}

function audit(before, after, writeScopes = []) {
  const allPaths = new Set([...before.entries.keys(), ...after.entries.keys()]);
  const changed = [];
  for (const file of allPaths) {
    const a = before.entries.get(file);
    const b = after.entries.get(file);
    if (JSON.stringify(a || null) !== JSON.stringify(b || null)) changed.push(file);
  }
  if (before.head !== after.head) {
    try {
      for (const file of git(after.root, ['diff', '--name-only', `${before.head}..${after.head}`]).split(/\r?\n/).filter(Boolean)) changed.push(file);
    } catch (_) { /* headChanged 本身仍会 fail-closed */ }
  }
  const changedPaths = [...new Set(changed)].sort();
  const unauthorizedPaths = changedPaths.filter((file) => !writeScopes.some((scope) => scopeMatches(file, scope)));
  const preexistingTouchedPaths = changedPaths.filter((file) => before.entries.has(file));
  const indexChanged = before.indexFingerprint !== after.indexFingerprint;
  return {
    headChanged: before.head !== after.head,
    indexChanged,
    beforeHead: before.head,
    afterHead: after.head,
    changedPaths,
    unauthorizedPaths,
    preexistingTouchedPaths,
    safeToCommit: before.head === after.head && !indexChanged && unauthorizedPaths.length === 0 && preexistingTouchedPaths.length === 0,
  };
}

async function commitChanges(root, paths, message) {
  const uniquePaths = [...new Set(paths || [])].sort();
  if (!uniquePaths.length) return { ok: true, committed: false, commitSha: git(root, ['rev-parse', 'HEAD']).trim(), commands: [] };
  const commands = [];
  const add = await runCommand({ command: 'git', args: ['add', '--', ...uniquePaths], cwd: root, timeoutMs: 60_000 });
  commands.push(add);
  if (!add.ok) return { ok: false, error: { kind: add.errorKind, message: add.outputTail || add.error }, commands };
  const commit = await runCommand({ command: 'git', args: ['commit', '-m', message], cwd: root, timeoutMs: 60_000 });
  commands.push(commit);
  if (!commit.ok) return { ok: false, error: { kind: commit.errorKind, message: commit.outputTail || commit.error }, commands };
  return { ok: true, committed: true, commitSha: git(root, ['rev-parse', 'HEAD']).trim(), commands };
}

module.exports = { git, snapshot, audit, commitChanges, scopeMatches, fingerprint };
