'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { runCommand } = require('../command-runner.js');

const node = process.execPath;
const cwd = path.resolve(__dirname, '../../..');

test('command-runner: streams output, sends heartbeat, truncates evidence, and redacts secrets', async () => {
  const output = [];
  const heartbeats = [];
  const result = await runCommand({
    command: node,
    args: ['-e', "console.log(process.env.TEST_TOKEN); console.error('stderr-' + 'x'.repeat(80)); setTimeout(() => console.log('done'), 25)"],
    cwd,
    env: { TEST_TOKEN: 'super-secret-value' },
    envAllowlist: ['TEST_TOKEN'],
    heartbeatMs: 5,
    maxOutputChars: 48,
    onOutput: (event) => output.push(event),
    onHeartbeat: (event) => heartbeats.push(event),
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.ok(output.some((event) => event.stream === 'stdout' && event.text.includes('[REDACTED]')));
  assert.ok(output.some((event) => event.stream === 'stderr'));
  assert.ok(heartbeats.length >= 1);
  assert.match(result.outputTail, /\[REDACTED\]/);
  assert.ok(result.outputTail.length <= 48);
  assert.equal(result.command, `${node} -e ${JSON.stringify("console.log(process.env.TEST_TOKEN); console.error('stderr-' + 'x'.repeat(80)); setTimeout(() => console.log('done'), 25)")}`);
  assert.ok(result.durationMs >= 0);
  assert.ok(result.startedAt <= result.endedAt);
});

test('command-runner: timeout terminates the process and reports timeout classification', async () => {
  const result = await runCommand({
    command: node,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd,
    timeoutMs: 30,
    killGraceMs: 5,
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorKind, 'timeout');
  assert.equal(result.timedOut, true);
  assert.ok(result.signal || result.exitCode !== 0);
});

test('command-runner: abort signal terminates the process and does not expose secret env', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const result = await runCommand({
    command: node,
    args: ['-e', 'setInterval(() => console.log(process.env.PASSWORD), 2)'],
    cwd,
    env: { PASSWORD: 'should-not-leak' },
    envAllowlist: ['PASSWORD'],
    signal: controller.signal,
    killGraceMs: 5,
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorKind, 'cancelled');
  assert.doesNotMatch(result.outputTail, /should-not-leak/);
});

test('command-runner: spawn and non-zero errors are classified deterministically', async () => {
  const missing = await runCommand({ command: 'pipe-core-command-that-does-not-exist', args: [], cwd });
  assert.equal(missing.ok, false);
  assert.equal(missing.errorKind, 'spawn');

  const nonZero = await runCommand({ command: node, args: ['-e', 'process.exit(7)'], cwd });
  assert.equal(nonZero.ok, false);
  assert.equal(nonZero.errorKind, 'command');
  assert.equal(nonZero.exitCode, 7);
});
