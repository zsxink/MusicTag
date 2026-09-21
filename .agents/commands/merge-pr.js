#!/usr/bin/env node
'use strict';
import { spawnSync } from 'node:child_process';
const target = process.argv[2];
if (!target) { console.error('用法: merge-pr.js <pr>'); process.exit(2); }
const result = spawnSync('gh', ['pr', 'merge', target, '--squash', '--delete-branch'], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
