'use strict';

// Deterministic contract tests for the read-only bootstrap helpers:
//   .agents/workflows/pipe-branch-check.sh
//   .agents/workflows/assert-pipe-workspace.sh
//
// Each fixture is a throwaway repository under os.tmpdir() and the real
// checkout is never touched. The scripts are executed for real through bash
// so the assertions cover stdout, exit codes, and the absence of Git side
// effects (no branch switch, no branch creation, no stash, no commit).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const REPO = path.resolve(__dirname, '../../../..');
const BRANCH_CHECK = path.join(REPO, '.agents', 'workflows', 'pipe-branch-check.sh');
const WORKSPACE_GUARD = path.join(REPO, '.agents', 'workflows', 'assert-pipe-workspace.sh');

function git(repo, args) {
  // Keep git's informational stderr (e.g. "Switched to a new branch") out of the
  // test log while still capturing stdout for the query-style calls.
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function makeRepo(prefix = 'pipe-branch-check-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Pipe Test']);
  git(repo, ['config', 'user.email', 'pipe-test@example.invalid']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'baseline\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'baseline']);
  return { root, repo };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function runBranchCheck(cwd, args, env) {
  return spawnSync('bash', [BRANCH_CHECK, ...args], { cwd, encoding: 'utf8', ...(env ? { env } : {}) });
}

function parseOutput(stdout) {
  const fields = stdout.replace(/\n$/, '').split('\t');
  // The three-field tab contract is the machine interface the caller parses;
  // pin the field count so an extra column cannot slip through unnoticed.
  assert.equal(fields.length, 3, `expected 3 tab-separated fields, got ${JSON.stringify(fields)}`);
  return { state: fields[0], branch: fields[1], workspace: fields[2], fields };
}

// Everything the read-only contract promises not to change.
function snapshot(repo) {
  return {
    head: git(repo, ['rev-parse', 'HEAD']),
    branch: git(repo, ['branch', '--show-current']),
    status: git(repo, ['status', '--porcelain']),
    refs: git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads']),
    stashes: git(repo, ['stash', 'list']),
  };
}

test('pipe-branch-check: clean branch matching the change reports already-on-change', () => {
  const { root, repo } = makeRepo();
  try {
    git(repo, ['checkout', '-b', 'my-change']);
    const result = runBranchCheck(repo, ['my-change']);
    assert.equal(result.status, 0, result.stderr);
    const out = parseOutput(result.stdout);
    assert.equal(out.state, 'already-on-change');
    assert.equal(out.branch, 'my-change');
    assert.equal(out.workspace, 'clean');
    assert.equal(result.stderr, '');
  } finally {
    cleanup(root);
  }
});

test('pipe-branch-check: clean main reports on-main with the change name', () => {
  const { root, repo } = makeRepo();
  try {
    const result = runBranchCheck(repo, ['my-change']);
    assert.equal(result.status, 0, result.stderr);
    const out = parseOutput(result.stdout);
    assert.equal(out.state, 'on-main');
    assert.equal(out.branch, 'main');
    assert.equal(out.workspace, 'clean');
    assert.equal(result.stderr, '');
  } finally {
    cleanup(root);
  }
});

test('pipe-branch-check: dirty main is flagged dirty and the workspace is left untouched', () => {
  const { root, repo } = makeRepo('pipe-branch-check-dirty-');
  try {
    fs.writeFileSync(path.join(repo, 'scratch.txt'), 'uncommitted\n');
    const before = snapshot(repo);
    assert.equal(before.status, '?? scratch.txt');

    const result = runBranchCheck(repo, ['my-change']);
    assert.equal(result.status, 0, result.stderr);
    const out = parseOutput(result.stdout);
    assert.equal(out.state, 'on-main');
    assert.equal(out.branch, 'main');
    assert.equal(out.workspace, 'dirty');

    // The script must not stash, commit, or otherwise mutate the dirty tree.
    assert.deepEqual(snapshot(repo), before);
    assert.equal(fs.readFileSync(path.join(repo, 'scratch.txt'), 'utf8'), 'uncommitted\n');
  } finally {
    cleanup(root);
  }
});

test('pipe-branch-check: an unrelated clean branch reports on-other', () => {
  const { root, repo } = makeRepo('pipe-branch-check-other-');
  try {
    git(repo, ['checkout', '-b', 'other-branch']);
    const result = runBranchCheck(repo, ['my-change']);
    assert.equal(result.status, 0, result.stderr);
    const out = parseOutput(result.stdout);
    assert.equal(out.state, 'on-other');
    assert.equal(out.branch, 'other-branch');
    assert.equal(out.workspace, 'clean');
  } finally {
    cleanup(root);
  }
});

test('pipe-branch-check: detached HEAD reports detached with a dash placeholder', () => {
  const { root, repo } = makeRepo('pipe-branch-check-detached-');
  try {
    git(repo, ['checkout', '--detach']);
    assert.equal(git(repo, ['branch', '--show-current']), '');
    const result = runBranchCheck(repo, ['my-change']);
    assert.equal(result.status, 0, result.stderr);
    const out = parseOutput(result.stdout);
    assert.equal(out.state, 'detached');
    assert.equal(out.branch, '-');
    assert.equal(out.workspace, 'clean');
  } finally {
    cleanup(root);
  }
});

test('pipe-branch-check: --main overrides which branch counts as main', () => {
  const { root, repo } = makeRepo('pipe-branch-check-main-override-');
  try {
    git(repo, ['checkout', '-b', 'release-2']);
    const defaultResult = runBranchCheck(repo, ['my-change']);
    assert.equal(parseOutput(defaultResult.stdout).state, 'on-other');

    const overridden = runBranchCheck(repo, ['my-change', '--main', 'release-2']);
    assert.equal(overridden.status, 0, overridden.stderr);
    const out = parseOutput(overridden.stdout);
    assert.equal(out.state, 'on-main');
    assert.equal(out.branch, 'release-2');
    assert.equal(out.workspace, 'clean');
  } finally {
    cleanup(root);
  }
});

test('pipe-branch-check: usage errors exit 2 with an empty stdout and a stderr message', () => {
  const { root, repo } = makeRepo('pipe-branch-check-usage-');
  try {
    const cases = [
      [[], /用法/],
      [['my-change', '--main'], /--main/],
      [['my-change', '--bogus'], /未知参数|用法/],
      [['my-change', 'extra-positional'], /多余参数|用法/],
    ];
    for (const [args, pattern] of cases) {
      const result = runBranchCheck(repo, args);
      assert.equal(result.status, 2, `${JSON.stringify(args)} -> ${result.status}`);
      assert.equal(result.stdout, '', `${JSON.stringify(args)} stdout`);
      assert.match(result.stderr, pattern, `${JSON.stringify(args)} stderr`);
    }
  } finally {
    cleanup(root);
  }
});

test('pipe-branch-check: -h and --help print usage to stdout and exit 0', () => {
  const { root, repo } = makeRepo('pipe-branch-check-help-');
  try {
    for (const flag of ['-h', '--help']) {
      const result = runBranchCheck(repo, [flag]);
      assert.equal(result.status, 0, `${flag}: ${result.stderr}`);
      assert.match(result.stdout, /用法:/);
      assert.equal(result.stderr, '');
    }
  } finally {
    cleanup(root);
  }
});

test('pipe-branch-check: exits 1 outside a Git repository', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-branch-check-nogit-'));
  try {
    const result = runBranchCheck(root, ['my-change'], { ...process.env, GIT_CEILING_DIRECTORIES: root });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Git 仓库/);
  } finally {
    cleanup(root);
  }
});

test('pipe-branch-check: repeated calls never move HEAD, branches, refs, or the workspace', () => {
  const { root, repo } = makeRepo('pipe-branch-check-readonly-');
  try {
    git(repo, ['checkout', '-b', 'other-branch']);
    fs.writeFileSync(path.join(repo, 'scratch.txt'), 'uncommitted\n');
    const before = snapshot(repo);

    const invocations = [
      ['my-change'],
      ['other-branch'],
      ['other-branch', '--main', 'other-branch'],
      ['my-change', '--main', 'release-9'],
    ];
    for (const args of invocations) {
      const result = runBranchCheck(repo, args);
      assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    }

    assert.deepEqual(snapshot(repo), before);
  } finally {
    cleanup(root);
  }
});

test('assert-pipe-workspace: main worktree is in-place and a linked worktree is worktree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-workspace-guard-'));
  const main = path.join(root, 'repo');
  const linked = path.join(root, 'linked');
  const nested = path.join(main, 'nested');
  try {
    fs.mkdirSync(main);
    git(main, ['init', '-b', 'main']);
    git(main, ['config', 'user.name', 'Pipe Test']);
    git(main, ['config', 'user.email', 'pipe-test@example.invalid']);
    fs.writeFileSync(path.join(main, 'README.md'), 'baseline\n');
    git(main, ['add', 'README.md']);
    git(main, ['commit', '-m', 'baseline']);
    git(main, ['worktree', 'add', '-b', 'change', linked, 'main']);
    fs.mkdirSync(nested);

    const inMain = spawnSync('bash', [WORKSPACE_GUARD], { cwd: main, encoding: 'utf8' });
    const inNested = spawnSync('bash', [WORKSPACE_GUARD], { cwd: nested, encoding: 'utf8' });
    const inLinked = spawnSync('bash', [WORKSPACE_GUARD], { cwd: linked, encoding: 'utf8' });

    assert.equal(inMain.status, 0, inMain.stderr);
    assert.equal(inMain.stdout.trim(), 'in-place');
    assert.equal(inMain.stderr, '');
    assert.equal(inNested.status, 0, inNested.stderr);
    assert.equal(inNested.stdout.trim(), 'in-place');
    assert.equal(inLinked.status, 0, inLinked.stderr);
    assert.equal(inLinked.stdout.trim(), 'worktree');
    assert.equal(inLinked.stderr, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
