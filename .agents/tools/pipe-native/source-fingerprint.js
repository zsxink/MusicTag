#!/usr/bin/env node
'use strict';

// Reproducible source manifest for cross-host Verify/integrate rechecks.
// OpenSpec files are fingerprinted separately and excluded so archive can move
// a change without invalidating an otherwise unchanged source verification.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const VERSION = 'pipe-source-fingerprint/v1';
const EXCLUDED = new Set(['.agents/runs', '.worktrees', 'node_modules', 'target', 'dist', 'coverage', 'openspec']);

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function excluded(file) {
  const parts = file.split('/');
  return parts.some((part) => EXCLUDED.has(part)) || (parts[0] === '.agents' && parts[1] === 'runs');
}

function buildManifest(root = process.cwd()) {
  const repoRoot = execFileSync('git', ['-C', path.resolve(root), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const listed = execFileSync('git', ['-C', repoRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const names = [...new Set(listed.toString('utf8').split('\0').filter(Boolean))]
    .filter((file) => !excluded(file))
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
        digest = sha256(Buffer.from(fs.readlinkSync(absolutePath), 'utf8'));
      } else if (stat.isFile()) {
        kind = 'file';
        digest = sha256(fs.readFileSync(absolutePath));
      } else {
        continue;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      kind = 'deleted';
      digest = sha256(Buffer.from('deleted', 'utf8'));
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

module.exports = { VERSION, buildManifest };
