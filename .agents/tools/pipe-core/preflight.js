'use strict';

const path = require('node:path');
const { runCommand } = require('./command-runner.js');

async function runGate(stage, { change, root, ctx, log }) {
  const script = (ctx && ctx.preflightScript) || path.join(root, '.agents', 'workflows', 'pipe-preflight.sh');
  const command = await runCommand({
    command: 'bash',
    args: [script, change, stage],
    cwd: root,
    timeoutMs: 120_000,
    onOutput: ({ stream, text }) => { if (log) log(`[${stage}:${stream}] ${text.trimEnd()}`); },
    onHeartbeat: ({ elapsedMs }) => { if (log) log(`[${stage}] 仍在执行（${elapsedMs}ms）`); },
  });
  return {
    ok: command.ok,
    structured: {
      ready: command.ok,
      branch: stage === 'bootstrap' ? change : '',
      issues: command.ok ? [] : [command.outputTail || command.error || `${stage} failed`],
      steps: [command],
    },
    error: command.ok ? null : { kind: command.errorKind || 'command', message: command.outputTail || `${stage} failed`, retryable: false },
    exitCode: command.exitCode,
    commands: [command],
  };
}

module.exports = {
  bootstrap: (context) => runGate('bootstrap', context),
  specGate: (context) => runGate('spec-gate', context),
  runGate,
};
