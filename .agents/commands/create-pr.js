#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const [head, title, body] = process.argv.slice(2);
if (!head || !title) { console.error('用法: create-pr.js <head> <title> [body]'); process.exit(2); }
const result = spawnSync('gh', ['pr', 'create', '--base', 'main', '--head', head, '--title', title, ...(body ? ['--body', body] : [])], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
