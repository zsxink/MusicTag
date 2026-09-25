#!/usr/bin/env node
'use strict';

// Deterministic Markdown-state CLI. It never launches an Agent or subprocess.
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('./progress.js');

function usage() {
  return [
    'Usage: progress-cli.js <command> ... [--repo-root <path>]',
    '  init <change> --issue <n> --branch <branch> --worktree <path> --owner <host:session>',
    '  init-recover <change|epic> --owner <new> --previous-owner <old> --confirmed-no-live-writer true --evidence <text> --branch <branch> --worktree <path> [--issue <n> --epic --source-revision <sha>]',
    '  epic-init <epic> --owner <host:session> --worktree <path> --source-revision <sha> [--main-branch main]',
    '  lock|unlock <change> --owner <host:session>',
    '  takeover <change> --owner <new> --previous-owner <old> --confirmed-no-live-writer true [--evidence <text>] [--epic]',
    '  takeover-recover <change> --owner <new> --previous-owner <old> --stale-takeover-owner <stale> --confirmed-no-live-writer true --evidence <text> [--epic]',
    '  status <change> [--epic] [--json]',
    '  phase <change> <phase> <status> --owner <host:session> [--attempt <n>] [--cr-round <n>] [--cr-result pass] [--source-manifest <output.json>] [--evidence <text>]',
    '    Verify succeeded additionally requires --verification-head, --source-manifest, --spec-fingerprint, --command-id, --expected-command-id, and --command-evidence <json-file> with exact successful command facts.',
    '  task <change> <task-id> <status> --owner <host:session> [--phase <phase>]',
    '  decision <change> --owner <host:session> --question <text> --decision <text> --basis <text>',
    '  checkpoint <change> <name> <status> --owner <host:session> --evidence-json <typed-json>',
    '  migrate <change> --owner <host:session> [--issue <n> --branch <branch> --worktree <path>]',
    '  resume-plan <change> --facts <facts.json> [--epic]',
    '  resume-apply <change> --owner <host:session> --facts <facts.json> [--epic]',
    '  epic-item <epic> <item> <status> --owner <host:session> [--merged true|false]',
    '  epic-ready <epic> --owner <host:session> --facts <fresh-remote-facts.json> [--limit 3]',
    '  self-check',
    '',
    'Facts JSON: { branch, worktree, head, commits:{sha:true}, files:{path:true},',
    'commands:{id:{exitCode:0,head,sourceFingerprint,specFingerprint}}, sourceFingerprint, fingerprintVersion, manifestSha256, manifest, specFingerprint, remoteFacts:{key:value}, tasks:{"1.2":true}, epicItems:{name:{remoteMerged:true}} }',
  ].join('\n');
}
function parse(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!key) throw new Error('空选项名');
    if (next === undefined || next.startsWith('--')) { options[key] = true; continue; }
    index += 1;
    if (options[key] === undefined) options[key] = next;
    else if (Array.isArray(options[key])) options[key].push(next);
    else options[key] = [options[key], next];
  }
  return { positionals, options };
}
function required(options, name) {
  const value = options[name];
  if (value === undefined || value === true || value === '') throw new Error('缺少 --' + name);
  return value;
}
function values(options, name) {
  const value = options[name];
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? value : [value];
}
function sharedRepoRoot(start) {
  let current = path.resolve(start);
  while (true) {
    const gitEntry = path.join(current, '.git');
    if (fs.existsSync(gitEntry)) {
      if (fs.statSync(gitEntry).isDirectory()) return current;
      const pointer = fs.readFileSync(gitEntry, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
      if (!pointer) throw new Error(`linked worktree 的 .git 指针非法：${gitEntry}`);
      const gitDir = path.resolve(current, pointer[1]);
      const commonDirFile = path.join(gitDir, 'commondir');
      if (!fs.existsSync(commonDirFile)) throw new Error(`linked worktree 缺少 commondir：${commonDirFile}`);
      const commonDir = path.resolve(gitDir, fs.readFileSync(commonDirFile, 'utf8').trim());
      return path.dirname(commonDir);
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}
function rootFrom(options) { return sharedRepoRoot(options['repo-root'] || process.cwd()); }
function loadJson(file, label) {
  try {
    const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('根必须是对象');
    return value;
  } catch (error) { throw new Error(label + ' 无法读取：' + error.message); }
}
function inlineJson(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('必须是对象');
    return parsed;
  } catch (error) { throw new Error(label + ' 不是有效 JSON 对象：' + error.message); }
}
function bool(options, name) {
  const value = options[name];
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('--' + name + ' 只能是 true 或 false');
}
function output(value, options) {
  if (options.json || typeof value !== 'string') console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}
function phaseOptions(options) {
  const result = {
    agentId: options.agent, attempt: options.attempt, crRound: options['cr-round'],
    evidence: values(options, 'evidence'), commitSha: options.commit,
    verificationHead: options['verification-head'], sourceFingerprint: options['source-fingerprint'], specFingerprint: options['spec-fingerprint'],
    artifactPaths: values(options, 'artifact'), commandIds: values(options, 'command-id'), expectedCommandIds: values(options, 'expected-command-id'),
    commandEvidence: options['command-evidence'] ? loadJson(options['command-evidence'], 'Verify 命令证据') : undefined,
    reason: options.reason, nextStep: options['next-step'], crResult: options['cr-result'],
  };
  if (options['source-manifest']) {
    const manifest = loadJson(required(options, 'source-manifest'), '源码指纹清单');
    result.sourceFingerprint = manifest.fingerprint;
    result.fingerprintVersion = manifest.fingerprintVersion;
    result.manifestSha256 = manifest.manifestSha256;
    result.manifest = manifest.manifest;
  }
  if (options['remote-facts']) result.remoteFacts = loadJson(options['remote-facts'], '远端事实文件');
  if (options.path) result.allowedPaths = values(options, 'path');
  return Object.fromEntries(Object.entries(result).filter((entry) => entry[1] !== undefined && (!Array.isArray(entry[1]) || entry[1].length)));
}
function run(argv) {
  const parsed = parse(argv);
  const command = parsed.positionals[0];
  const change = parsed.positionals[1];
  const arg3 = parsed.positionals[2];
  const arg4 = parsed.positionals[3];
  const options = parsed.options;
  if (!command || command === 'help' || command === '--help') { console.log(usage()); return 0; }
  const root = rootFrom(options);
  if (command === 'init') {
    output(runtime.initializeProgress(root, { change, issue: required(options, 'issue'), branch: required(options, 'branch'), worktree: required(options, 'worktree'), owner: required(options, 'owner'), host: options.host, session: options.session }), options); return 0;
  }
  if (command === 'epic-init') {
    output(runtime.initializeEpicProgress(root, { change, owner: required(options, 'owner'), worktree: required(options, 'worktree'), mainBranch: options['main-branch'], sourceRevision: required(options, 'source-revision'), host: options.host, session: options.session }), options); return 0;
  }
  if (command === 'init-recover') {
    output(runtime.recoverInitialization(root, {
      change,
      kind: options.epic ? 'epic' : 'change',
      owner: required(options, 'owner'),
      previousOwner: required(options, 'previous-owner'),
      confirmedNoLiveWriter: bool(options, 'confirmed-no-live-writer'),
      evidence: values(options, 'evidence'),
      branch: required(options, 'branch'),
      worktree: required(options, 'worktree'),
      issue: options.issue,
      mainBranch: options['main-branch'],
      sourceRevision: options.epic ? required(options, 'source-revision') : options['source-revision'],
    }), options); return 0;
  }
  if (command === 'lock') { output(runtime.acquireLock(root, change, required(options, 'owner'), { host: options.host, session: options.session }), options); return 0; }
  if (command === 'unlock') { runtime.releaseLock(root, change, required(options, 'owner')); output({ unlocked: change }, options); return 0; }
  if (command === 'takeover') {
    output(runtime.takeoverProgress(root, change, required(options, 'owner'), required(options, 'previous-owner'), bool(options, 'confirmed-no-live-writer'), { kind: options.epic ? 'epic' : 'change', evidence: values(options, 'evidence') }), options); return 0;
  }
  if (command === 'takeover-recover') {
    output(runtime.recoverStaleTakeover(root, change, required(options, 'owner'), required(options, 'previous-owner'), required(options, 'stale-takeover-owner'), bool(options, 'confirmed-no-live-writer'), { kind: options.epic ? 'epic' : 'change', evidence: values(options, 'evidence') }), options); return 0;
  }
  if (command === 'status') {
    const progress = options.epic ? runtime.loadEpicProgress(root, change) : runtime.loadProgress(root, change);
    if (!progress) throw new Error('没有 ' + change + ' 的 progress.md');
    output(progress, options); return 0;
  }
  if (command === 'phase') {
    if (!arg3 || !arg4) throw new Error('phase 需要 <phase> <status>');
    output(runtime.setPhase(root, change, required(options, 'owner'), arg3, arg4, phaseOptions(options)), options); return 0;
  }
  if (command === 'task') {
    if (!arg3 || !arg4) throw new Error('task 需要 <task-id> <status>');
    output(runtime.setTask(root, change, required(options, 'owner'), arg3, arg4, { phase: options.phase, agentId: options.agent, taskOwner: options['task-owner'], allowedPaths: values(options, 'path'), evidence: values(options, 'evidence'), reason: options.reason }), options); return 0;
  }
  if (command === 'decision') {
    output(runtime.recordDecision(root, change, required(options, 'owner'), { phase: options.phase, question: required(options, 'question'), decision: required(options, 'decision'), basis: required(options, 'basis'), options: values(options, 'option'), nextTask: options['next-task'], nextStep: options['next-step'], userEscalated: Boolean(options['user-escalated']) }), options); return 0;
  }
  if (command === 'checkpoint') {
    if (!arg3 || !arg4) throw new Error('checkpoint 需要 <name> <status>');
    output(runtime.recordCheckpoint(root, change, required(options, 'owner'), { id: arg3, status: arg4, evidence: options['evidence-json'] ? inlineJson(options['evidence-json'], '--evidence-json') : undefined, nextStep: options['next-step'] }), options); return 0;
  }
  if (command === 'migrate') {
    output(runtime.migrateLegacyState(root, { change, owner: required(options, 'owner'), issue: options.issue, branch: options.branch, worktree: options.worktree, host: options.host, session: options.session }), options); return 0;
  }
  if (command === 'resume-plan') {
    const progress = options.epic ? runtime.loadEpicProgress(root, change) : runtime.loadProgress(root, change);
    if (!progress) throw new Error('没有 ' + change + ' 的 progress.md');
    const facts = loadJson(required(options, 'facts'), '事实文件');
    output(options.epic ? runtime.validateEpicResume(progress, facts) : runtime.validateResume(progress, facts), options); return 0;
  }
  if (command === 'resume-apply') {
    const facts = loadJson(required(options, 'facts'), '事实文件');
    output(options.epic ? runtime.applyEpicResumeFacts(root, change, required(options, 'owner'), facts) : runtime.applyResumeFacts(root, change, required(options, 'owner'), facts), options); return 0;
  }
  if (command === 'epic-item') {
    if (!arg3 || !arg4) throw new Error('epic-item 需要 <item> <status>');
    output(runtime.setEpicItem(root, change, required(options, 'owner'), arg3, arg4, { worktree: options.worktree, branch: options.branch, remoteMerged: bool(options, 'merged'), evidence: values(options, 'evidence') }), options); return 0;
  }
  if (command === 'epic-ready') {
    const file = path.join(root, 'openspec', 'epics', change, 'epic.json');
    if (!fs.existsSync(file)) throw new Error('epic.json 不存在：' + file);
    const progress = runtime.loadEpicProgress(root, change);
    if (!progress) throw new Error('Epic 尚无 epic-progress.md；必须先 epic-init 建立基线');
    if (!progress.worktree || !progress.sourceRevision) throw new Error('Epic 基线缺少 worktree/sourceRevision；禁止调度');
    const facts = loadJson(required(options, 'facts'), '本轮 Epic 远端事实');
    const updated = runtime.applyEpicResumeFacts(root, change, required(options, 'owner'), facts);
    output(runtime.epicReadyItems(JSON.parse(fs.readFileSync(file, 'utf8')), updated.epicItems, { limit: options.limit, block: updated.epicDispatchBlock }), options); return 0;
  }
  if (command === 'self-check') {
    const result = runtime.selfCheck(root); output(result, options); return result.ok ? 0 : 1;
  }
  throw new Error('未知命令：' + command);
}
module.exports = { parse, run, usage, rootFrom, sharedRepoRoot };
if (require.main === module) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) { console.error('pipe-native progress: ' + error.message); process.exitCode = 1; }
}
