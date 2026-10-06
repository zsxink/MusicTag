'use strict';

// These assertions cover the repository-owned part of the native protocol.
// Host APIs are exercised by the current main session; a Node test must not
// emulate a second agent process to claim that coverage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const nativeSelfCheck = require('../../.agents/tools/pipe-native/self-check.js');
const progressRuntime = require('../../.agents/tools/pipe-native/progress.js');
const epicPreflight = require('../../.agents/tools/pipe-native/epic-preflight.js');
const sourceFingerprint = require('../../.agents/tools/pipe-native/source-fingerprint.js');

const REPO = path.resolve(__dirname, '../..');
const read = (...parts) => fs.readFileSync(path.join(REPO, ...parts), 'utf8');

test('native entry contract: every host entry points to the shared main-session workflow', () => {
  const entries = [
    ['AGENTS.md'],
    ['.agents', 'skills', 'pipe', 'SKILL.md'],
    ['.claude', 'commands', 'pipe.md'],
    ['.claude', 'commands', 'pipe-epic.md'],
    ['.claude', 'commands', 'pipe-init.md'],
    ['.claude', 'commands', 'pipe-epic-status.md'],
    ['.opencode', 'commands', 'pipe.md'],
    ['.opencode', 'commands', 'pipe-epic.md'],
  ];
  for (const entry of entries) {
    const source = read(...entry);
    assert.match(source, /WORKFLOW\.md|主会话|当前会话/, entry.join('/'));
    assert.doesNotMatch(source, /^\s*node\s+\.agents\/tools\/pipe-core\/run\.js/m, entry.join('/'));
    assert.doesNotMatch(source, /^\s*(?:codex\s+exec|claude\s+-p|opencode\s+run)\b/m, entry.join('/'));
  }
});

test('native workflow contract: stages, parent decisions, native dispatch, and evidence rules are explicit', () => {
  const workflow = read('.agents', 'skills', 'pipe', 'WORKFLOW.md');
  const phases = ['bootstrap', 'architect', 'spec-gate', 'dev', 'tester', 'cr', 'verify', 'integrate'];
  let previous = -1;
  for (const phase of phases) {
    assert.match(workflow, new RegExp(`\\b${phase}\\b`));
    const index = workflow.indexOf(`| ${phase} |`);
    assert.ok(index > previous, `${phase} must remain in the native stage table order`);
    previous = index;
  }
  assert.match(workflow, /Codex 协作子 Agent.*Claude Code Agent.*OpenCode Task\/subagent/s);
  assert.match(workflow, /DONE.*NEEDS_PARENT_DECISION.*FAILED/s);
  assert.match(workflow, /产品行为歧义.*向用户询问/s);
  assert.match(workflow, /主 Agent 唯一负责阶段转换.*progress\.md/s);
  assert.match(workflow, /不得启动.*run\.js/s);
});

test('native quality gates: CR, Verify, and Integrate remain mandatory ordered checkpoints', () => {
  const workflow = read('.agents', 'skills', 'pipe', 'WORKFLOW.md');
  assert.match(workflow, /CR 必须只读且独立于开发者/);
  assert.match(workflow, /file \+ issue \+ specReference \+ suggestion/);
  assert.match(workflow, /最多三轮.*挂起交用户/s);
  assert.match(workflow, /Tester\/CR 后的源码变化使旧 Verify 失效/);

  for (const command of ['cargo check', 'cargo test', 'npm run test', 'npm run build']) {
    assert.match(workflow, new RegExp(command.replaceAll(' ', '\\s+')));
  }
  // openspec 校验必须以固定版本形态出现（Issue #147 D1）：裸 `openspec validate`
  // 不再是合格的验证基线表述，退回去本断言即红。
  assert.match(workflow, /@fission-ai\/openspec@\S+\s+validate\s+--all/);
  assert.match(workflow, /失败即停，不能集成/);

  const checkpoints = ['archive', 'commit', 'sync-main', 'push', 'get-or-create-pr', 'wait-required-ci', 'merge', 'verify-remote', 'cleanup-local'];
  const checkpointSection = workflow.slice(workflow.indexOf('依次执行 `archive'));
  let previous = -1;
  for (const checkpoint of checkpoints) {
    const index = checkpointSection.indexOf(checkpoint);
    assert.ok(index > previous, `${checkpoint} must stay in integrate order`);
    previous = index;
  }
  assert.match(workflow, /Closes #<issue>/);
  assert.match(workflow, /required checks 未通过不能合并/);
});

test('native progress contract: template records unique ownership, phases, evidence, and recovery facts', () => {
  const template = read('.agents', 'tools', 'pipe-native', 'progress-template.md');
  for (const field of ['schemaVersion', 'change', 'issue', 'branch', 'worktree', 'owner', 'updatedAt']) {
    assert.match(template, new RegExp(`^${field}:`, 'm'));
  }
  for (const phase of ['bootstrap', 'architect', 'spec-gate', 'dev', 'tester', 'cr', 'verify', 'integrate']) {
    assert.match(template, new RegExp(`\\| ${phase} \\| pending \\|`));
  }
  assert.match(template, /written only by the main-session Agent/);
  assert.match(template, /Resume checks/);
  assert.match(template, /machine-readable JSON written by progress\.js/);
});

test('native preflight: it invokes the native self-check instead of the retired scheduler', () => {
  const preflight = read('.agents', 'workflows', 'pipe-preflight.sh');
  assert.match(preflight, /\.agents\/tools\/pipe-native\/self-check\.js/);
  assert.doesNotMatch(preflight, /pipe-core\/run\.js/);
  assert.match(preflight, /assert-pipe-workspace\.sh/);
  // In-place mode must not loosen the branch gate: developing on main stays fail-closed.
  assert.match(preflight, /test "\$\(git branch --show-current\)" = "\$change_name"/);
  const epicPreflightScript = read('.agents', 'workflows', 'pipe-epic-preflight.sh');
  assert.match(epicPreflightScript, /all_rows=\$\(node \.agents\/tools\/pipe-native\/epic-preflight\.js items/);
  assert.match(epicPreflightScript, /closingIssuesReferences/);
  assert.match(epicPreflightScript, /epic-preflight\.js match-pr/);
  assert.match(epicPreflightScript, /progress-cli\.js epic-ready .*--facts/);
  assert.match(epicPreflightScript, /epic_owner=\$\{2:/);
  assert.doesNotMatch(epicPreflightScript, /includeClosedPrs/);
  assert.match(epicPreflightScript, /progress\.owner !== owner \|\| !lock \|\| lock\.owner !== owner/);
  assert.match(epicPreflightScript, /active_rows=\$\(node \.agents\/tools\/pipe-native\/epic-preflight\.js active/);
  assert.doesNotMatch(epicPreflightScript, /done < <\(node \.agents\/tools\/pipe-native\/epic-preflight\.js/);
  for (const file of [['.claude', 'commands', 'pipe.md'], ['.opencode', 'commands', 'pipe.md']]) {
    const entry = read(...file);
    assert.match(entry, /pipe-preflight\.sh <change> bootstrap/);
    assert.doesNotMatch(entry, /pipe-preflight\.sh <change>`/);
  }
});

test('Epic merge facts accept only a merged PR in this repository that closes the exact Issue', () => {
  const common = { mergedAt: '2026-09-25T00:00:00Z', number: 44, mergeCommit: { oid: 'merge-sha' } };
  assert.equal(epicPreflight.mergedClosingPr([{ ...common, repository: { nameWithOwner: 'org/repo' }, closingIssuesReferences: { nodes: [{ number: 87, repository: { nameWithOwner: 'org/repo' } }] } }], 'org/repo', 87).number, 44);
  assert.equal(epicPreflight.mergedClosingPr([{ ...common, repository: { nameWithOwner: 'other/repo' }, closingIssuesReferences: { nodes: [{ number: 87, repository: { nameWithOwner: 'other/repo' } }] } }], 'org/repo', 87), null);
  assert.equal(epicPreflight.mergedClosingPr([{ ...common, repository: { nameWithOwner: 'org/repo' }, closingIssuesReferences: { nodes: [{ number: 88, repository: { nameWithOwner: 'org/repo' } }] } }], 'org/repo', 87), null);
  assert.equal(epicPreflight.mergedClosingPr([{ ...common, repository: { nameWithOwner: 'org/repo' }, closingIssuesReferences: { nodes: [] } }], 'org/repo', 87), null);
});

test('Epic facts serialize merged and unmerged GraphQL results as a complete issue-matched snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-facts-'));
  const epicDir = path.join(root, 'openspec', 'epics', 'demo');
  const runDir = path.join(root, '.agents', 'runs', 'demo');
  fs.mkdirSync(epicDir, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  const epicFile = path.join(epicDir, 'epic.json');
  const rowsFile = path.join(runDir, 'rows.tsv');
  const factsFile = path.join(runDir, 'remote-facts.json');
  fs.writeFileSync(epicFile, JSON.stringify({ name: 'demo', sourceRevision: 'base', items: [{ name: 'merged', issue: 87 }, { name: 'open', issue: 88 }] }));
  fs.writeFileSync(rowsFile, 'merged\t87\t44\tmerge-sha\t2026-09-25T00:00:00Z\nopen\t88\t\t\t\n');
  try {
    progressRuntime.initializeEpicProgress(root, { change: 'demo', owner: 'codex:facts', worktree: root, sourceRevision: 'base' });
    epicPreflight.writeRemoteFacts(epicFile, rowsFile, factsFile, 'main', root, 'head', root);
    const facts = JSON.parse(fs.readFileSync(factsFile, 'utf8'));
    assert.equal(facts.remoteVerified, true);
    assert.equal(facts.epicItems.merged.remoteMerged, true);
    assert.deepEqual([facts.epicItems.merged.prNumber, facts.epicItems.merged.mergeSha], [44, 'merge-sha']);
    assert.equal(facts.epicItems.open.remoteMerged, false);
    assert.equal(facts.epicItems.open.issueNumber, 88);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Epic preflight item producer fails on corrupt Markdown progress instead of returning an empty set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-corrupt-progress-'));
  const epicDir = path.join(root, 'openspec', 'epics', 'demo');
  fs.mkdirSync(epicDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', 'runs', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(epicDir, 'epic.json'), JSON.stringify({ name: 'demo', items: [{ name: 'a', issue: 87 }] }));
  fs.writeFileSync(path.join(root, '.agents', 'runs', 'demo', 'epic-progress.md'), '<!-- pipe-native-progress\n{broken}\n-->\n');
  try {
    const helper = path.join(REPO, '.agents', 'tools', 'pipe-native', 'epic-preflight.js');
    const result = spawnSync(process.execPath, [helper, 'candidates', path.join(epicDir, 'epic.json')], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JSON|无法读取|无效/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Epic preflight skips items only from fresh merged-PR facts, independent of stale Markdown status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-preflight-'));
  const epic = { items: [
    { name: 'archived-a', issue: 87, status: 'pending', dependsOn: [] },
    { name: 'active-b', issue: 88, status: 'done', dependsOn: ['archived-a'] },
  ] };
  const progress = { epicItems: { 'archived-a': { status: 'pending', remoteMerged: false } } };
  const checkedIssues = [];
  const checkedSpecs = [];
  try {
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
      const dir = path.join(root, 'openspec', 'changes', 'active-b');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), 'valid');
    }
    fs.mkdirSync(path.join(root, 'openspec', 'changes', 'active-b', 'specs'));
    const active = await epicPreflight.validateActiveItems({
      epic, progress, remotelyMergedIssues: [87], repoRoot: root,
      artifactExists: async (target) => fs.existsSync(target),
      issueExists: async (issue) => { checkedIssues.push(issue); return true; },
      specValid: async (name) => { checkedSpecs.push(name); return true; },
    });
    assert.deepEqual(active.map((item) => item.name), ['active-b']);
    assert.deepEqual(checkedIssues, [88]);
    assert.deepEqual(checkedSpecs, ['active-b']);
    assert.deepEqual(epicPreflight.activeItems(epic, progress, [] ).map((item) => item.name), ['archived-a', 'active-b']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Epic preflight blocks invalid OpenSpec and missing GitHub issues for active items', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-invalid-'));
  const epic = { items: [{ name: 'active', issue: 89 }] };
  for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
    const dir = path.join(root, 'openspec', 'changes', 'active');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'invalid');
  }
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'active', 'specs'));
  const common = { epic, progress: { epicItems: {} }, remotelyMergedIssues: [], repoRoot: root,
    artifactExists: async (target) => fs.existsSync(target), specValid: async () => false };
  try {
    await assert.rejects(epicPreflight.validateActiveItems({ ...common, issueExists: async () => true }), /未通过 openspec validate/);
    await assert.rejects(epicPreflight.validateActiveItems({ ...common, issueExists: async () => false }), /GitHub Issue #89 无法读取/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source fingerprint is stable across cwd and OpenSpec archive moves, and changes with source files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-source-fingerprint-'));
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Pipe Test']);
    git(['config', 'user.email', 'pipe-test@example.invalid']);
    fs.writeFileSync(path.join(root, 'source.js'), 'const value = 1;\n');
    fs.mkdirSync(path.join(root, 'openspec', 'changes', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'openspec', 'changes', 'demo', 'proposal.md'), 'proposal\n');
    fs.mkdirSync(path.join(root, 'src-tauri', 'target'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src-tauri', 'target', 'build.bin'), 'generated\n');
    git(['add', 'source.js', 'openspec']);
    git(['commit', '-m', 'baseline']);
    const before = sourceFingerprint.buildManifest(root);
    const nested = path.join(root, 'nested');
    fs.mkdirSync(nested);
    const fromNestedCwd = sourceFingerprint.buildManifest(nested);
    assert.deepEqual(fromNestedCwd, before);

    fs.mkdirSync(path.join(root, 'openspec', 'changes', 'archive'), { recursive: true });
    fs.renameSync(path.join(root, 'openspec', 'changes', 'demo', 'proposal.md'), path.join(root, 'openspec', 'changes', 'archive', 'demo.md'));
    const afterArchiveMove = sourceFingerprint.buildManifest(root);
    assert.equal(afterArchiveMove.fingerprint, before.fingerprint);

    fs.writeFileSync(path.join(root, 'source.js'), 'const value = 2;\n');
    const afterSourceEdit = sourceFingerprint.buildManifest(root);
    assert.notEqual(afterSourceEdit.fingerprint, before.fingerprint);
    assert.equal(afterSourceEdit.fingerprintVersion, sourceFingerprint.VERSION);
    assert.ok(afterSourceEdit.manifest.some((entry) => entry.path === 'source.js'));
    assert.ok(!afterSourceEdit.manifest.some((entry) => entry.path.includes('/target/')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source fingerprint does not drift when a tracked deletion becomes committed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-fingerprint-delete-drift-'));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Pipe Test']);
    git(['config', 'user.email', 'pipe-test@example.invalid']);
    fs.writeFileSync(path.join(root, 'kept.js'), 'const kept = 1;\n');
    fs.writeFileSync(path.join(root, 'removed.js'), 'const removed = 1;\n');
    git(['add', 'kept.js', 'removed.js']);
    git(['commit', '-m', 'baseline']);

    fs.unlinkSync(path.join(root, 'removed.js'));
    const uncommitted = sourceFingerprint.buildManifest(root);

    git(['add', '-A']);
    git(['commit', '-m', 'delete removed']);
    const committed = sourceFingerprint.buildManifest(root);

    // The deletion is visible either way, so committing it must not move the
    // fingerprint: an in-flight Verify would otherwise be invalidated by the
    // archive/commit checkpoints recording the very same source state.
    assert.equal(uncommitted.fingerprint, committed.fingerprint);
    assert.equal(uncommitted.manifestSha256, committed.manifestSha256);
    assert.deepEqual(uncommitted.manifest.map((entry) => entry.path), ['kept.js']);
    assert.deepEqual(committed.manifest.map((entry) => entry.path), ['kept.js']);
    assert.ok(!committed.manifest.some((entry) => entry.kind === 'deleted'));
    assert.equal(committed.fingerprintVersion, sourceFingerprint.VERSION);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source fingerprint reacts to content edits, additions and deletions, and returns to the same value when reverted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-fingerprint-sensitivity-'));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Pipe Test']);
    git(['config', 'user.email', 'pipe-test@example.invalid']);
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n*.log\n');
    fs.writeFileSync(path.join(root, 'source.js'), 'const value = 1;\n');
    fs.mkdirSync(path.join(root, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ignored', 'noise.js'), 'not source\n');
    fs.writeFileSync(path.join(root, 'debug.log'), 'noise\n');
    git(['add', '.gitignore', 'source.js']);
    git(['commit', '-m', 'baseline']);

    const baseline = sourceFingerprint.buildManifest(root);
    assert.deepEqual(baseline.manifest.map((entry) => entry.path), ['.gitignore', 'source.js']);

    fs.writeFileSync(path.join(root, 'source.js'), 'const value = 2;\n');
    const edited = sourceFingerprint.buildManifest(root);
    assert.notEqual(edited.fingerprint, baseline.fingerprint);

    fs.writeFileSync(path.join(root, 'source.js'), 'const value = 1;\n');
    assert.equal(sourceFingerprint.buildManifest(root).fingerprint, baseline.fingerprint);

    fs.writeFileSync(path.join(root, 'added.js'), 'const added = 1;\n');
    const added = sourceFingerprint.buildManifest(root);
    assert.notEqual(added.fingerprint, baseline.fingerprint);
    assert.deepEqual(added.manifest.map((entry) => entry.path), ['.gitignore', 'added.js', 'source.js']);

    fs.unlinkSync(path.join(root, 'added.js'));
    assert.equal(sourceFingerprint.buildManifest(root).fingerprint, baseline.fingerprint);

    // Deleting a tracked file must be visible even though v2 has no `deleted`
    // kind: the entry disappears, so the fingerprint still moves.
    fs.unlinkSync(path.join(root, 'source.js'));
    const deleted = sourceFingerprint.buildManifest(root);
    assert.notEqual(deleted.fingerprint, baseline.fingerprint);
    assert.deepEqual(deleted.manifest.map((entry) => entry.path), ['.gitignore']);
    assert.ok(!sourceFingerprint.buildManifest(root).manifest.some((entry) => entry.kind === 'deleted'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source fingerprint records symlinks by link target, skips directories, and keeps ignored paths out of the manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-fingerprint-kinds-'));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Pipe Test']);
    git(['config', 'user.email', 'pipe-test@example.invalid']);
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
    fs.mkdirSync(path.join(root, 'real-dir'), { recursive: true });
    fs.writeFileSync(path.join(root, 'real-dir', 'inside.js'), 'inside\n');
    fs.mkdirSync(path.join(root, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ignored', 'noise.js'), 'noise\n');
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), 'dep\n');
    fs.symlinkSync('real-dir', path.join(root, 'link-to-dir'));
    fs.symlinkSync('real-dir/inside.js', path.join(root, 'link-to-file'));
    git(['add', '.gitignore', 'real-dir', 'link-to-dir', 'link-to-file']);
    git(['commit', '-m', 'baseline']);

    const manifest = sourceFingerprint.buildManifest(root);
    assert.deepEqual(manifest.manifest.map((entry) => entry.path), [
      '.gitignore',
      'link-to-dir',
      'link-to-file',
      'real-dir/inside.js',
    ]);
    const byPath = Object.fromEntries(manifest.manifest.map((entry) => [entry.path, entry]));
    assert.equal(byPath['link-to-dir'].kind, 'symlink');
    assert.equal(byPath['link-to-file'].kind, 'symlink');
    assert.equal(byPath['real-dir/inside.js'].kind, 'file');
    assert.deepEqual([...new Set(manifest.manifest.map((entry) => entry.kind))].sort(), ['file', 'symlink']);
    // The symlink digest covers the link target string, not the pointed-to content.
    assert.equal(byPath['link-to-file'].sha256, sourceFingerprint.sha256Target('real-dir/inside.js'));

    fs.writeFileSync(path.join(root, 'real-dir', 'inside.js'), 'changed\n');
    const retargeted = sourceFingerprint.buildManifest(root);
    assert.equal(retargeted.manifest.find((entry) => entry.path === 'link-to-file').sha256, byPath['link-to-file'].sha256);
    assert.notEqual(retargeted.fingerprint, manifest.fingerprint);

    // Removing the pointed-to target must not crash the walk; the broken
    // symlink itself is still a workspace path.
    fs.unlinkSync(path.join(root, 'real-dir', 'inside.js'));
    const broken = sourceFingerprint.buildManifest(root);
    assert.ok(broken.manifest.some((entry) => entry.path === 'link-to-file' && entry.kind === 'symlink'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source fingerprint excludes .git and is documented as the workspace-filesystem algorithm in WORKFLOW.md', () => {
  const manifest = sourceFingerprint.buildManifest(REPO);
  assert.ok(manifest.manifest.length > 0);
  assert.ok(!manifest.manifest.some((entry) => entry.path === '.git' || entry.path.startsWith('.git/')));
  assert.ok(!manifest.manifest.some((entry) => entry.path.split('/').includes('.git')));
  for (const excluded of ['openspec', 'node_modules', 'target', 'dist', 'coverage', '.worktrees']) {
    assert.ok(!manifest.manifest.some((entry) => entry.path.split('/').includes(excluded)), excluded);
  }
  assert.ok(!manifest.manifest.some((entry) => entry.path.startsWith('.agents/runs/')));
  assert.equal(manifest.fingerprintVersion, 'pipe-source-fingerprint/v2');

  const workflow = read('.agents', 'skills', 'pipe', 'WORKFLOW.md');
  assert.match(workflow, /pipe-source-fingerprint\/v2/);
  assert.doesNotMatch(workflow, /ls-files --cached --others --exclude-standard/);
  assert.match(workflow, /check-ignore/);
  assert.match(workflow, /普通文件\/符号链接/);
});

test('native workspace guard: the main worktree and linked worktrees both pass with a mode marker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-worktree-guard-'));
  const main = path.join(root, 'repo');
  const linked = path.join(root, 'linked');
  const guard = path.join(REPO, '.agents', 'workflows', 'assert-pipe-workspace.sh');
  try {
    fs.mkdirSync(main);
    const git = (args, cwd = main) => execFileSync('git', args, { cwd, stdio: 'ignore' });
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Pipe Test']);
    git(['config', 'user.email', 'pipe-test@example.invalid']);
    fs.writeFileSync(path.join(main, 'README.md'), 'test\n');
    git(['add', 'README.md']);
    git(['commit', '-m', 'test']);
    git(['worktree', 'add', '-b', 'change', linked, 'main']);
    const inMain = spawnSync('bash', [guard], { cwd: main, encoding: 'utf8' });
    const inLinked = spawnSync('bash', [guard], { cwd: linked, encoding: 'utf8' });
    assert.equal(inMain.status, 0, inMain.stderr);
    assert.equal(inMain.stdout.trim(), 'in-place');
    assert.equal(inLinked.status, 0, inLinked.stderr);
    assert.equal(inLinked.stdout.trim(), 'worktree');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native progress: cleanup checkpoint remains writable after deleting its linked worktree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-progress-root-'));
  const main = path.join(root, 'repo');
  const linked = path.join(root, 'linked');
  const cli = path.join(REPO, '.agents', 'tools', 'pipe-native', 'progress-cli.js');
  const owner = 'test:main-session';
  const git = (args, cwd = main) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  try {
    fs.mkdirSync(main);
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Pipe Test']);
    git(['config', 'user.email', 'pipe-test@example.invalid']);
    fs.writeFileSync(path.join(main, 'README.md'), 'test\n');
    git(['add', 'README.md']);
    git(['commit', '-m', 'test']);
    git(['worktree', 'add', '-b', 'change', linked, 'main']);
    const manifest = sourceFingerprint.buildManifest(main);
    const sourceEvidence = {
      sourceFingerprint: manifest.fingerprint,
      fingerprintVersion: manifest.fingerprintVersion,
      manifestSha256: manifest.manifestSha256,
      manifest: manifest.manifest,
    };

    const initialized = spawnSync(process.execPath, [cli, 'init', 'demo', '--issue', '132', '--branch', 'change', '--worktree', linked, '--owner', owner], { cwd: linked, encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    const phases = progressRuntime.PHASES;
    for (const phase of phases.slice(0, -1)) {
      progressRuntime.setPhase(main, 'demo', owner, phase, 'running');
      const evidence = phase === 'bootstrap' ? { commandIds: ['preflight'] }
        : phase === 'architect' ? { artifactPaths: ['openspec/changes/demo/design.md', 'openspec/changes/demo/tasks.md'] }
          : phase === 'spec-gate' || phase === 'tester' ? { commandIds: [phase + '-check'] }
            : phase === 'dev' ? { commitSha: 'dev-sha' }
              : phase === 'cr' ? { crResult: 'pass', ...sourceEvidence }
              : { verificationHead: 'head', ...sourceEvidence, specFingerprint: 'spec', commandIds: ['verify-check'], expectedCommandIds: ['verify-check'], commandEvidence: { 'verify-check': { exitCode: 0, head: 'head', sourceFingerprint: sourceEvidence.sourceFingerprint, specFingerprint: 'spec' } } };
      progressRuntime.setPhase(main, 'demo', owner, phase, 'succeeded', evidence);
    }
    progressRuntime.setPhase(main, 'demo', owner, 'integrate', 'running', sourceEvidence);
    const checkpoints = [
      ['archive', { type: 'archive', archivePath: 'openspec/changes/archive/demo', ...sourceEvidence }],
      ['commit', { type: 'commit', commitSha: 'final-sha', ...sourceEvidence }],
      ['sync-main', { type: 'sync-main', mainHead: 'main-sha', ...sourceEvidence }],
      ['push', { type: 'push', remote: 'origin', branch: 'change', head: 'final-sha', ...sourceEvidence }],
      ['get-or-create-pr', { type: 'get-or-create-pr', prNumber: 132, prUrl: 'https://example.test/pr/132', head: 'final-sha', ...sourceEvidence }],
      ['wait-required-ci', { type: 'wait-required-ci', prNumber: 132, head: 'final-sha', requiredChecks: ['tests'], conclusion: 'success', ...sourceEvidence }],
      ['merge', { type: 'merge', prNumber: 132, mergeSha: 'merge-sha', ...sourceEvidence }],
      ['verify-remote', { type: 'verify-remote', prNumber: 132, mergeSha: 'merge-sha', merged: true, ...sourceEvidence }],
    ];
    for (const [id, evidence] of checkpoints) progressRuntime.recordCheckpoint(main, 'demo', owner, { id, status: 'succeeded', evidence });

    git(['worktree', 'remove', linked]);
    assert.equal(fs.existsSync(linked), false);
    progressRuntime.recordCheckpoint(main, 'demo', owner, { id: 'cleanup-local', status: 'succeeded', evidence: { type: 'cleanup-local', worktreeRemoved: true, ...sourceEvidence } });
    const progress = progressRuntime.loadProgress(main, 'demo');
    assert.equal(progress.checkpoints.at(-1).id, 'cleanup-local');
    assert.equal(progress.checkpoints.at(-1).evidence.worktreeRemoved, true);
    progressRuntime.releaseLock(main, 'demo', owner);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native self-check fails closed when host registrations or shared workflow are missing', () => {
  const invalidRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-native-self-check-'));
  try {
    const result = nativeSelfCheck.run(invalidRoot);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.includes('缺少')));
  } finally {
    fs.rmSync(invalidRoot, { recursive: true, force: true });
  }
});

test('OpenCode child agents cannot spawn nested tasks', () => {
  for (const role of ['architect', 'rust-backend', 'vue-frontend', 'tester', 'cr-agent', 'verify-agent']) {
    const agent = read('.opencode', 'agents', `${role}.md`);
    assert.match(agent, /^mode: subagent$/m, role);
    assert.match(agent, /^  task: deny$/m, role);
    assert.match(agent, new RegExp(`\\.agents/tools/pipe-core/roles/${role}\\.md`), role);
  }
});

test('CR host permissions satisfy its read/search-only public capabilities', () => {
  const roles = JSON.parse(read('.agents', 'tools', 'pipe-core', 'roles', 'roles.json'));
  assert.deepEqual(roles['cr-agent'].capabilities.sort(), ['read_files', 'search_files']);
  const claude = read('.claude', 'agents', 'cr-agent.md');
  const toolLine = /^tools:\s*(.+)$/m.exec(claude);
  assert.ok(toolLine);
  assert.deepEqual(toolLine[1].split(/,\s*/), ['Read', 'Glob', 'Grep']);
  const opencode = read('.opencode', 'agents', 'cr-agent.md');
  assert.match(opencode, /^    "\*": deny$/m);
  assert.doesNotMatch(opencode, /^    "[^"]+": allow$/m);
});
