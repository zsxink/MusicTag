import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../../scripts/homebrew-publish.sh', import.meta.url));
const caskPath = 'Casks/m/musictag.rb';
const tag = 'v0.1.4';
const bytes = { aarch64: Buffer.from('fixture arm64 DMG\n'), x64: Buffer.from('fixture Intel DMG\n') };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const assetName = (arch) => `MusicTag_0.1.4_${arch}.dmg`;
const assetUrl = (arch) => `https://github.com/zsxink/MusicTag/releases/download/${tag}/${assetName(arch)}`;

// Strict fakes never delegate to the real gh, curl, or git. Unknown operations fail.
// Each invocation is a separate process, so mutable fake state lives in fixture JSON.
const fakeSource = String.raw`
import * as fs from 'node:fs';
import path from 'node:path';
const root = process.env.HOMEBREW_TEST_ROOT;
const stateFile = path.join(root, 'state.json');
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const log = (entry) => fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(entry) + '\n');
log({ command, args });
const fail = (message) => { process.stderr.write(message + '\n'); process.exit(91); };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const snapshot = (directory) => {
  const files = {};
  const walk = (current, relative = '') => {
    for (const name of fs.readdirSync(current).sort()) {
      const next = path.join(current, name), key = path.posix.join(relative, name);
      if (fs.statSync(next).isDirectory()) walk(next, key);
      else files[key] = fs.readFileSync(next).toString('base64');
    }
  };
  walk(directory);
  return files;
};
if (command === 'sleep') process.exit(0);
if (command === 'curl') {
  if (state.curlFailure) process.exit(22);
  if (!args.includes('--head') || !args.includes('--netrc-file') || !args.includes('/dev/null')) fail('Unsafe public URL request');
  if (args.some((arg) => /authorization|cookie|--user|--netrc$/i.test(arg))) fail('Credential passed to curl');
  process.exit(0);
}
if (command === 'gh') {
  if (args[0] !== 'release' || valueAfter('--repo') !== 'zsxink/MusicTag') fail('Unexpected source operation');
  if (args[1] === 'view') {
    process.stdout.write(JSON.stringify(state.release));
    process.exit(0);
  }
  if (args[1] === 'download') {
    const name = valueAfter('--pattern');
    if (!(name in state.downloads)) fail('Missing download fixture');
    fs.writeFileSync(path.join(valueAfter('--dir'), name), Buffer.from(state.downloads[name], 'base64'));
    process.exit(0);
  }
  fail('Unexpected gh operation');
}
if (command !== 'git') fail('Unexpected fake command');
let directory;
let remaining = [...args];
while (remaining[0] === '-c' || remaining[0] === '-C') {
  const [option, value] = remaining.splice(0, 2);
  if (option === '-C') directory = value;
}
const [operation, ...rest] = remaining;
if (!directory) fail('Git operation lacks explicit checkout');
const remote = path.join(root, 'remote');
const cask = 'Casks/m/musictag.rb';
if (operation === 'rev-parse') process.stdout.write(directory + '\n');
else if (operation === 'symbolic-ref') process.stdout.write('main\n');
else if (operation === 'status') process.stdout.write(state.dirty ? '?? unrelated.txt\n' : '');
else if (operation === 'remote') process.stdout.write(state.remoteUrl || 'https://github.com/zsxink/homebrew-tap.git\n');
else if (operation === 'fetch') {
  if (rest.join(' ') !== '--no-tags origin refs/heads/main:refs/remotes/origin/main') fail('Unexpected fetch');
} else if (operation === 'worktree') {
  if (rest[0] === 'add') {
    if (rest[1] !== '--detach' || rest[3] !== 'refs/remotes/origin/main') fail('Unsafe worktree creation');
    fs.cpSync(remote, rest[2], { recursive: true });
  } else if (rest[0] === 'remove') fs.rmSync(rest.at(-1), { recursive: true, force: true });
  else fail('Unexpected worktree operation');
} else if (operation === 'diff' && rest[0] === '--quiet') {
  if (rest.join(' ') !== '--quiet -- ' + cask) fail('Unexpected comparison scope');
  const existing = path.join(remote, cask);
  process.exit(fs.existsSync(existing) && fs.readFileSync(existing).equals(fs.readFileSync(path.join(directory, cask))) ? 0 : 1);
} else if (operation === 'ls-files') {
  if (rest.join(' ') !== '--error-unmatch ' + cask) fail('Unexpected tracked-file scope');
  process.exit(fs.existsSync(path.join(remote, cask)) ? 0 : 1);
} else if (operation === 'add') {
  if (rest.join(' ') !== '-- ' + cask) fail('Unsafe stage scope');
  state.staged = cask;
  save();
} else if (operation === 'diff' && rest.join(' ') === '--cached --name-only') {
  process.stdout.write(state.staged + '\n');
} else if (operation === 'commit') {
  if (rest.at(-2) !== '--' || rest.at(-1) !== cask || state.staged !== cask) fail('Unsafe commit scope');
  log({ committedTree: snapshot(directory) });
  state.commits = (state.commits || 0) + 1;
  save();
} else if (operation === 'push') {
  if (rest.join(' ') !== 'origin HEAD:refs/heads/main') fail('Unsafe push destination');
  state.pushes = (state.pushes || 0) + 1;
  if (state.rejectFirstPush && state.pushes === 1) {
    // Simulate a concurrent update from the other app while preserving MusicTag.
    fs.writeFileSync(path.join(remote, 'Casks/m/markflow.rb'), 'concurrent MarkFlow update\n');
    save();
    process.exit(1);
  }
  fs.cpSync(directory, remote, { recursive: true });
  save();
} else fail('Unexpected git operation: ' + operation + ' ' + rest.join(' '));
`;

function snapshot(directory) {
  const files = {};
  for (const name of fs.readdirSync(directory, { recursive: true }).sort()) {
    const target = path.join(directory, name);
    if (fs.statSync(target).isFile()) files[name.split(path.sep).join('/')] = fs.readFileSync(target).toString('base64');
  }
  return files;
}

function fixture(t, update = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'musictag-homebrew-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const tap = path.join(root, 'checkout');
  const remote = path.join(root, 'remote');
  fs.mkdirSync(bin);
  for (const directory of [tap, remote]) {
    fs.mkdirSync(path.join(directory, 'Casks/m'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'Casks/m/markflow.rb'), 'existing MarkFlow Cask\n');
    fs.writeFileSync(path.join(directory, 'README.md'), 'existing tap documentation\n');
  }
  // The same fake entry point is copied under each tool name, with an absolute
  // Node interpreter so PATH resolution cannot accidentally reach live tools.
  for (const name of ['gh', 'curl', 'git', 'sleep']) {
    fs.writeFileSync(path.join(bin, name), '#!' + process.execPath + '\n' + fakeSource, { mode: 0o755 });
  }
  const state = {
    release: {
      tagName: tag, isDraft: false, isPrerelease: false,
      assets: Object.entries(bytes).map(([arch, body]) => ({
        name: assetName(arch), url: assetUrl(arch), size: body.length,
        state: 'uploaded', digest: `sha256:${digest(body)}`,
      })),
    },
    downloads: Object.fromEntries(Object.entries(bytes).map(([arch, body]) => [assetName(arch), body.toString('base64')])),
  };
  update(state, { tap, remote });
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(state));
  const readState = () => JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  const calls = () => fs.existsSync(path.join(root, 'calls.jsonl'))
    ? fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOMEBREW_TEST_ROOT: root };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'HOMEBREW_TAP_TOKEN', 'BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS']) delete env[name];
  const run = (args, extraEnv = {}) => {
    const result = spawnSync('/bin/bash', [script, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.ok(!`${result.stdout}${result.stderr}`.includes('fixture-secret-never-print'));
    return result;
  };
  const output = path.join(root, 'output', 'musictag.rb');
  const render = (input = tag) => run([input, '--output', output]);
  const publish = (credential = 'fixture-secret-never-print') => run([tag, '--publish', '--tap-dir', tap], { HOMEBREW_TAP_TOKEN: credential });
  return { root, tap, remote, state, output, render, publish, readState, calls };
}

function successful(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function rejectedBeforeWrites(f, result, message) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(f.calls().filter((call) => call.command === 'git').length, 0);
}

test('renders both architecture hashes and canonical public URLs without tap operations', (t) => {
  const f = fixture(t);
  const result = f.render();
  successful(result);
  const cask = fs.readFileSync(f.output, 'utf8');
  assert.match(cask, /arch arm: "aarch64", intel: "x64"/);
  assert.match(cask, /version "0\.1\.4"/);
  assert.ok(cask.includes(`sha256 arm:   "${digest(bytes.aarch64)}",\n         intel: "${digest(bytes.x64)}"`));
  assert.ok(cask.includes('url "https://github.com/zsxink/MusicTag/releases/download/v#{version}/MusicTag_#{version}_#{arch}.dmg"'));
  assert.match(cask, /app "MusicTag\.app"/);
  assert.doesNotMatch(cask, /no_check|auto_updates/);
  assert.match(cask, /livecheck do/);
  assert.match(cask, /url :stable/);
  assert.match(cask, /strategy :github_latest/);
  assert.ok(cask.includes('uninstall quit: "com.musictag.desktop"'));
  assert.ok(cask.includes('~/Library/Application Support/MusicTag'));
  assert.ok(cask.includes('~/Library/Caches/com.musictag.desktop'));
  assert.ok(cask.includes('~/Library/WebKit/com.musictag.desktop'));
  for (const arch of Object.keys(bytes)) assert.ok(result.stdout.includes(`${digest(bytes[arch])}  ${assetUrl(arch)}`));
  assert.deepEqual(f.calls().filter((call) => call.command === 'curl').map((call) => call.args.at(-1)), Object.keys(bytes).map(assetUrl));
  assert.equal(f.calls().filter((call) => call.command === 'git').length, 0);
});

test('supports releases with no optional API digest', (t) => {
  const f = fixture(t, (state) => state.release.assets.forEach((asset) => delete asset.digest));
  successful(f.render());
});

for (const input of ['0.1.4', 'v01.1.4', 'v0.1', 'v0.1.4-beta', 'v0.1.4;touch injected', 'v0.1.4\n']) {
  test(`rejects malformed or unsupported tag ${JSON.stringify(input)}`, (t) => {
    const f = fixture(t);
    rejectedBeforeWrites(f, f.render(input), /stable vMAJOR.MINOR.PATCH/);
    assert.deepEqual(f.calls(), []);
  });
}

for (const flag of ['isDraft', 'isPrerelease']) {
  test(`rejects release with ${flag}`, (t) => {
    const f = fixture(t, (state) => { state.release[flag] = true; });
    rejectedBeforeWrites(f, f.publish(), /published, stable release/);
  });
}

for (const arch of Object.keys(bytes)) {
  test(`rejects missing ${arch} asset before tap operations`, (t) => {
    const f = fixture(t, (state) => { state.release.assets = state.release.assets.filter((asset) => asset.name !== assetName(arch)); });
    rejectedBeforeWrites(f, f.publish(), /Expected exactly one release asset/);
  });
  test(`rejects empty ${arch} download before tap operations`, (t) => {
    const f = fixture(t, (state) => { state.downloads[assetName(arch)] = ''; });
    rejectedBeforeWrites(f, f.publish(), /Empty or invalid downloaded asset/);
  });
  test(`rejects wrong ${arch} API digest before tap operations`, (t) => {
    const f = fixture(t, (state) => { state.release.assets.find((asset) => asset.name === assetName(arch)).digest = `sha256:${'0'.repeat(64)}`; });
    rejectedBeforeWrites(f, f.publish(), /digest mismatch/);
  });
}

test('rejects mismatched downloaded size', (t) => {
  const f = fixture(t, (state) => { state.release.assets[0].size += 1; });
  rejectedBeforeWrites(f, f.publish(), /size mismatch/);
});

test('rejects an asset that is not publicly reachable', (t) => {
  const f = fixture(t, (state) => { state.curlFailure = true; });
  rejectedBeforeWrites(f, f.publish(), /not publicly reachable/);
  assert.equal(f.calls().filter((call) => call.command === 'gh' && call.args[1] === 'download').length, 0);
});

test('missing credential fails clearly before any external tool call', (t) => {
  const f = fixture(t);
  rejectedBeforeWrites(f, f.publish(''), /HOMEBREW_TAP_TOKEN is required/);
  assert.deepEqual(f.calls(), []);
});

test('publishes only the MusicTag Cask and identical rerun makes no commit or push', (t) => {
  const f = fixture(t);
  const checkoutBefore = snapshot(f.tap);
  const remoteBefore = snapshot(f.remote);
  successful(f.publish());
  const remoteAfter = snapshot(f.remote);
  assert.deepEqual(snapshot(f.tap), checkoutBefore);
  assert.ok(remoteAfter[caskPath]);
  const { [caskPath]: _publishedCask, ...unrelatedFiles } = remoteAfter;
  assert.deepEqual(unrelatedFiles, remoteBefore);
  assert.deepEqual(f.calls().find((call) => call.committedTree).committedTree, remoteAfter);
  assert.equal(f.readState().commits, 1);
  assert.equal(f.readState().pushes, 1);
  const again = f.publish();
  successful(again);
  assert.match(again.stdout, /no commit needed/);
  assert.equal(f.readState().commits, 1);
  assert.equal(f.readState().pushes, 1);
  assert.deepEqual(snapshot(f.remote), remoteAfter);
  assert.deepEqual(snapshot(f.tap), checkoutBefore);
});

test('rejects downgrade without committing, pushing, or touching the caller checkout', (t) => {
  const f = fixture(t, (_state, { remote }) => fs.writeFileSync(path.join(remote, caskPath), 'cask "musictag" do\n  version "0.2.0"\nend\n'));
  const remoteBefore = snapshot(f.remote), checkoutBefore = snapshot(f.tap);
  const result = f.publish();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to downgrade/);
  assert.deepEqual(snapshot(f.remote), remoteBefore);
  assert.deepEqual(snapshot(f.tap), checkoutBefore);
  assert.equal(f.readState().commits, undefined);
  assert.equal(f.readState().pushes, undefined);
});

test('refreshes after rejected push and preserves concurrent MarkFlow changes', (t) => {
  const f = fixture(t, (state) => { state.rejectFirstPush = true; });
  const checkoutBefore = snapshot(f.tap);
  successful(f.publish());
  assert.equal(f.readState().pushes, 2);
  assert.equal(f.readState().commits, 2);
  assert.equal(fs.readFileSync(path.join(f.remote, 'Casks/m/markflow.rb'), 'utf8'), 'concurrent MarkFlow update\n');
  assert.match(fs.readFileSync(path.join(f.remote, caskPath), 'utf8'), /version "0\.1\.4"/);
  assert.equal(fs.readFileSync(path.join(f.remote, 'README.md'), 'utf8'), 'existing tap documentation\n');
  assert.deepEqual(snapshot(f.tap), checkoutBefore);
});
