#!/usr/bin/env node
'use strict';

const cwdIndex = process.argv.indexOf('--dir');
const cwd = cwdIndex >= 0 ? process.argv[cwdIndex + 1] : process.cwd();
if (process.env.FAKE_OPENCODE_BAD_EVENT === '1') {
  process.stdout.write('{broken-json}\n');
  process.exit(0);
}
const output = process.env.FAKE_OPENCODE_OUTPUT || JSON.stringify({ ready: true, cwd });
const fence = '```';
process.stdout.write(JSON.stringify({ type: 'message', role: 'assistant', content: 'progress' }) + '\n');
process.stdout.write(JSON.stringify({ type: 'message', role: 'assistant', final: true, sessionID: 'fake-session', content: `${fence}json\n${output}\n${fence}` }) + '\n');
