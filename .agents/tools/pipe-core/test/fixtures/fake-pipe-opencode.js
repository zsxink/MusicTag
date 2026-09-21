#!/usr/bin/env node
'use strict';
const { outputFor } = require('./fake-pipe-common.js');
const prompt = process.argv[process.argv.length - 1] || '';
const result = outputFor(prompt);
const fence = '```';
process.stdout.write(JSON.stringify({ type: 'message', role: 'assistant', content: 'progress' }) + '\n');
process.stdout.write(JSON.stringify({ type: 'message', role: 'assistant', final: true, sessionID: `fake-${process.cwd()}`, content: `${fence}json\n${JSON.stringify(result)}\n${fence}` }) + '\n');
