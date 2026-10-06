#!/usr/bin/env node
'use strict';

// Reproducible source manifest for cross-host Verify/integrate rechecks.
// v2 builds the path set by walking the workspace filesystem instead of the Git
// index: `git ls-files --cached` mixes a deletion's committed state into the
// path set, so the same source tree fingerprinted differently before and after
// the delete was committed, invalidating an in-flight Verify. The workspace walk
// makes the path set depend only on what is actually on disk.
// OpenSpec files are fingerprinted separately and excluded so archive can move
// a change without invalidating an otherwise unchanged source verification.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const VERSION = 'pipe-source-fingerprint/v2';
const EXCLUDED = new Set(['.git', 'openspec', '.agents/runs', '.worktrees', 'node_modules', 'target', 'dist', 'coverage']);

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256Target(target) { return sha256(Buffer.from(target, 'utf8')); }
function excluded(file) {
  const parts = file.split('/');
  return parts.some((part) => EXCLUDED.has(part)) || (parts[0] === '.agents' && parts[1] === 'runs');
}

function walk(root, relative = '', into = []) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return into; throw error; }
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (excluded(childRelative)) continue;
    // A symlinked directory is recorded as a symlink entry, never descended
    // into: following it would either loop or import another tree's content.
    if (entry.isDirectory()) walk(root, childRelative, into);
    else into.push(childRelative);
  }
  return into;
}

// One `git check-ignore --stdin` call replaces per-path spawns. Exit 0 means at
// least one input path is ignored and stdout lists them; exit 1 means none are
// (not an error). `--no-index` keeps the answer driven by ignore rules alone, so
// a force-added file still counts as ignored the way `--exclude-standard` did.
function ignoredPaths(repoRoot, paths) {
  const ignored = new Set();
  if (!paths.length) return ignored;
  const result = spawnSync('git', ['-C', repoRoot, 'check-ignore', '-z', '--stdin', '--no-index'], {
    input: Buffer.from(`${paths.join('\0')}\0`, 'utf8'),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore 失败（exit=${result.status}）：${String(result.stderr || '').trim()}`);
  }
  for (const entry of result.stdout.toString('utf8').split('\0')) if (entry) ignored.add(entry);
  return ignored;
}

function buildManifest(root = process.cwd()) {
  const repoRoot = execFileSync('git', ['-C', path.resolve(root), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const candidates = walk(repoRoot);
  const ignored = ignoredPaths(repoRoot, candidates);
  const names = candidates
    .filter((file) => !ignored.has(file))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const files = [];
  for (const relativePath of names) {
    const absolutePath = path.join(repoRoot, relativePath);
    let kind;
    let digest;
    try {
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        kind = 'symlink';
        digest = sha256Target(fs.readlinkSync(absolutePath));
      } else if (stat.isFile()) {
        kind = 'file';
        digest = sha256(fs.readFileSync(absolutePath));
      } else {
        continue;
      }
    } catch (error) {
      // The workspace changed under the walk; a vanished path simply is not part
      // of this source state.
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    files.push({ path: relativePath.split(path.sep).join('/'), kind, sha256: digest });
  }
  const manifestJson = JSON.stringify(files);
  const fingerprint = sha256(Buffer.from(`${VERSION}\0${manifestJson}`, 'utf8'));
  return { fingerprintVersion: VERSION, fingerprint, manifestSha256: sha256(Buffer.from(manifestJson, 'utf8')), manifest: files };
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(buildManifest(process.argv[2] || process.cwd()), null, 2) + '\n'); }
  catch (error) { console.error(`source-fingerprint: ${error.message}`); process.exitCode = 1; }
}

module.exports = { VERSION, buildManifest, sha256Target };