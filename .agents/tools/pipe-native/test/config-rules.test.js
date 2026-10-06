'use strict';

// Regression guard for GitHub Issue #147 defect 1: openspec/config.yaml rule entries
// containing YAML structural characters were silently corrupted.
//
// Two distinct failure modes existed in `rules`:
//   1. An entry holding ASCII ": " (`feat(<issue>): <任务>`) parsed as a nested
//      mapping instead of a string, so the entry was dropped from the rules array.
//   2. An entry holding a space-preceded "#" (`（Issue #46/#47）`) had everything
//      from the " #" onward swallowed as a YAML comment.
//   3. The whole group key `all` is not a valid artifact ID for the `spec-driven`
//      schema (valid IDs: proposal/specs/design/tasks) and has no global fallback in
//      the instruction loader, so anything filed under it was dead config that also
//      emitted `Unknown artifact ID in rules: "all"` on every command.
//
// This suite asserts the *shape* of the config source, not a parsed object. It has no
// dependencies on purpose: the repo root package.json declares no YAML parser, so a
// suite that requires one would fail under a cold `npm ci`. Critically, it also
// refuses to hand-roll a YAML parser -- a partial parser that silently returns empty
// arrays produces false PASSES, which is strictly worse than failing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

// Resolve the repo root from this file's location, never from process.cwd(), so the
// suite behaves identically no matter where it is invoked. This file is CommonJS
// because the nearest package.json (.agents/tools/pipe-native/package.json) sets
// "type": "commonjs", overriding the ESM root package.json.
const REPO = path.resolve(__dirname, '../../../..');
const CONFIG = path.join(REPO, 'openspec', 'config.yaml');

const readConfig = () => fs.readFileSync(CONFIG, 'utf8');

/**
 * Strip a surrounding pair of YAML quotes, if present.
 * @param {string} body raw text after the `- ` sequence item marker
 * @returns {{quoted: boolean, value: string}}
 */
function unwrapItem(body) {
  const quoted = body.startsWith("'") || body.startsWith('"');
  const value = quoted ? body.slice(1, -1) : body;
  return { quoted, value };
}

/**
 * Locate the `rules:` block and parse its sequence items, keeping the raw body text.
 * This is deliberately a line scanner, not a YAML engine: it recognises only the
 * exact top-level `rules:` key and its `  <artifact>:` / `    - <item>` children.
 *
 * @param {string} text full config.yaml source
 * @returns {{groups: Array<{key: string, items: Array<{raw: string, quoted: boolean, value: string, line: number}>}>}}
 */
function scanRulesBlock(text) {
  const lines = text.split('\n');
  const groups = [];
  let inRules = false;
  let current = null;

  for (const [index, line] of lines.entries()) {
    if (/^rules:\s*$/.test(line)) {
      inRules = true;
      continue;
    }
    // A new top-level key (or a full-line comment) terminates the block.
    if (inRules && /^[A-Za-z#]/.test(line)) inRules = false;
    if (!inRules) continue;

    const groupMatch = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*$/);
    if (groupMatch) {
      current = { key: groupMatch[1], items: [] };
      groups.push(current);
      continue;
    }

    const itemMatch = line.match(/^ {4}-\s(.*)$/);
    if (itemMatch && current) {
      current.items.push({ raw: itemMatch[1], line: index + 1, ...unwrapItem(itemMatch[1]) });
    }
  }

  return { groups };
}

/**
 * Assert that a sequence item is safe against YAML structural interpretation.
 *
 * A plain (unquoted) scalar in a block sequence degrades into a nested mapping as soon
 * as it contains ": ", and loses everything after a space-preceded "#" to a comment.
 * Requiring quotes for such entries is what keeps them single strings.
 *
 * @param {{raw: string, quoted: boolean, value: string, line: number}} item
 * @returns {string[]} human-readable problems, empty when the item is safe
 */
function ruleItemProblems(item) {
  const problems = [];
  const label = `rules item on line ${item.line}`;
  const body = item.value;

  if (body.trim() === '') problems.push(`${label} is empty`);

  // Quotes must actually pair. An unpaired leading quote is the classic half-quoted
  // entry: YAML reads it as a scalar anyway, but the intent was clearly a quoted one.
  const opens = (item.raw.match(/'/g) || []).length + (item.raw.match(/"/g) || []).length;
  if (item.quoted && (opens % 2 !== 0)) {
    problems.push(`${label} opens a quote it never closes: ${item.raw}`);
  }

  const needsQuoting = body.includes(': ') || / #/.test(body);
  if (needsQuoting && !item.quoted) {
    problems.push(
      `${label} contains YAML-significant text (${/ #/.test(body) ? '" #"' : '": "'}) `
      + 'but is unquoted, so it would be truncated or parsed as a mapping: ' + item.raw,
    );
  }

  // Backticks are Markdown code fences, not quotes; they must survive untouched.
  if (body.includes('`') && /``/.test(body)) {
    problems.push(`${label} has unbalanced backticks: ${item.raw}`);
  }

  return problems;
}

/**
 * Locate the `context: |` literal block and return its dedented lines.
 * @param {string} text full config.yaml source
 * @returns {string[]}
 */
function contextBlockLines(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^context:\s*\|\s*$/.test(l));
  assert.notEqual(start, -1, 'config.yaml must define `context` as a literal block scalar');

  const indent = (lines[start + 1] || '').match(/^ */)[0].length;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') { out.push(''); continue; }
    const lineIndent = line.match(/^ */)[0].length;
    if (lineIndent < indent) break; // dedent ends the block scalar
    out.push(line.slice(indent));
  }
  return out;
}

test('config-rules: rules block contains no `all` key (dead config for spec-driven)', () => {
  const { groups } = scanRulesBlock(readConfig());
  const keys = groups.map((g) => g.key);
  assert.ok(keys.length > 0, 'the `rules` block must contain at least one artifact key');
  assert.ok(!keys.includes('all'), `\`rules.all\` is not a valid spec-driven artifact ID and is dead config; keys found: ${keys.join(', ')}`);
});

test('config-rules: every rules artifact key is a real spec-driven artifact ID', () => {
  const VALID = new Set(['proposal', 'specs', 'design', 'tasks']);
  const { groups } = scanRulesBlock(readConfig());
  for (const { key } of groups) {
    assert.ok(VALID.has(key), `rules.${key} is not one of ${[...VALID].join('/')}`);
  }
});

test('config-rules: every rule entry is a single well-formed string', () => {
  const { groups } = scanRulesBlock(readConfig());
  for (const { key, items } of groups) {
    assert.ok(items.length > 0, `rules.${key} must not be empty`);
    for (const item of items) {
      for (const problem of ruleItemProblems(item)) assert.fail(problem);
    }
  }
});

test('config-rules: the colon-bearing Issue rule is not silently truncated', () => {
  // Regression shape for both original failure modes at once. These fragments must
  // exist in full: the nested-mapping loss cut at "Closes", and the comment loss cut
  // at "（Issue #46/#47）".
  const text = readConfig();
  for (const fragment of ['feat(<issue>): <任务>', 'Closes #<issue>', '（Issue #46/#47）']) {
    assert.ok(text.includes(fragment), `config.yaml must keep \`${fragment}\` intact`);
  }
});

test('config-rules: the two global process rules live in context, verbatim', () => {
  // `rules` has no global key, so context is the only field every artifact actually
  // receives. Both rules must be present, including the parenthetical tail that the
  // original YAML comment swallowed.
  const context = contextBlockLines(readConfig()).join('\n');
  for (const fragment of [
    'Issue 驱动',
    'Epic 拆分',
    'feat(<issue>): <任务>',
    'Closes #<issue>',
    '（合并即自动关闭对应 Issue）',
    '子 Issue 引用 Epic Issue 号',
  ]) {
    assert.ok(context.includes(fragment), `context block must contain \`${fragment}\``);
  }
});

test('config-rules: the context block keeps its existing project background', () => {
  // Guards against a "fix" that replaces context wholesale instead of extending it.
  const context = contextBlockLines(readConfig()).join('\n');
  for (const fragment of ['一次一首', 'ID3v2.4', 'docs/V1-PRD.md', '沟通语言：中文']) {
    assert.ok(context.includes(fragment), `context block must retain \`${fragment}\``);
  }
});

test('config-rules: shape checks actually detect unquoted structural characters', () => {
  // Red-test proof, in memory: these samples are the real historical bugs. If the
  // detector ever goes blind, this fails instead of the suite silently passing.
  const colonBug = { raw: 'feat(<issue>): <任务>；PR 引用 Closes #<issue>', quoted: false, value: 'feat(<issue>): <任务>；PR 引用 Closes #<issue>', line: 1 };
  assert.ok(ruleItemProblems(colonBug).length > 0, 'unquoted ": " must be flagged');

  const commentBug = { raw: '回归维度（Issue #46/#47）。', quoted: false, value: '回归维度（Issue #46/#47）。', line: 2 };
  assert.ok(ruleItemProblems(commentBug).length > 0, 'unquoted " #" must be flagged');

  const fixed = { raw: "'feat(<issue>): <任务>；PR 引用 Closes #<issue>'", quoted: true, value: 'feat(<issue>): <任务>；PR 引用 Closes #<issue>', line: 3 };
  assert.deepEqual(ruleItemProblems(fixed), [], 'quoting must make the same text pass');
});

test('config-rules: the all-key detector actually fires on a sample config', () => {
  const sample = [
    'rules:',
    '  all:',
    "    - 'Issue 驱动：分支提交用 `feat(<issue>): <任务>`'",
    '  proposal:',
    '    - 必须关联 Issue',
  ].join('\n');
  const keys = scanRulesBlock(sample).groups.map((g) => g.key);
  assert.ok(keys.includes('all'), 'detector must find an `all` key when one is present');
});

test('config-rules: resolves the repo config without depending on cwd', () => {
  assert.ok(fs.existsSync(CONFIG), `${CONFIG} must exist`);
  const text = readConfig();
  assert.match(text, /^schema: spec-driven$/m, 'config.yaml must still declare its schema');
  assert.ok(contextBlockLines(text).length > 5, 'the context literal block must be non-trivial');
});