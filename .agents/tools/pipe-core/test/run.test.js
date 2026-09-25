'use strict';

// `run.js` is intentionally a diagnostic compatibility shim. These tests
// protect the retirement boundary: it must direct callers to the current
// main-session protocol and must never become a second agent scheduler.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const RUNJS = path.join(__dirname, '..', 'run.js');

function invoke(args) {
  return spawnSync(process.execPath, [RUNJS, ...args], {
    encoding: 'utf8',
    cwd: path.resolve(__dirname, '../../../..'),
  });
}

test('retired run.js: every former invocation fails closed and points to the shared native protocol', () => {
  for (const args of [[], ['demo'], ['demo', '--driver', 'codex'], ['--epic', 'demo'], ['--self-check']]) {
    const result = invoke(args);
    assert.notEqual(result.status, 0, `${args.join(' ') || '<none>'} must not start a pipeline`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /已退役|retired/i);
    assert.match(output, /WORKFLOW\.md/);
    assert.match(output, /原生子 Agent|native/i);
  }
});

test('retired run.js: source has no scheduler, driver, or subprocess delegation', () => {
  const source = fs.readFileSync(RUNJS, 'utf8');
  for (const forbidden of [
    /node:child_process/,
    /runPipeline/,
    /require\(['"]\.\/drivers\//,
    /legacy-run/,
    /spawnSync/,
    /execSync/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
