'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateNode, topoSort, readySet, batches } = require('../dag.js');

test('dag: validateNode 缺必填报错', () => {
  const errs = validateNode({ id: 'x', role: 'architect' });
  assert.ok(errs.length > 0);
  assert.ok(validateNode({ id: 'x', role: 'architect', prompt: 'p', schema: {} }).length === 0);
  assert.ok(validateNode({ id: 'x', role: 'architect', promptFn: () => 'p', schema: {} }).length === 0);
});

test('dag: topoSort 按依赖排前', () => {
  const defs = [
    { id: 'c', role: 'r', dependsOn: ['a', 'b'] },
    { id: 'a', role: 'r', dependsOn: [] },
    { id: 'b', role: 'r', dependsOn: ['a'] },
  ];
  const order = topoSort(defs);
  const pos = (id) => order.indexOf(id);
  assert.ok(pos('a') < pos('b'));
  assert.ok(pos('b') < pos('c'));
});

test('dag: topoSort 环检测抛错', () => {
  const defs = [
    { id: 'a', role: 'r', dependsOn: ['b'] },
    { id: 'b', role: 'r', dependsOn: ['a'] },
  ];
  assert.throws(() => topoSort(defs), /环/);
});

test('dag: topoSort 依赖不存在的节点抛错', () => {
  const defs = [{ id: 'a', role: 'r', dependsOn: ['ghost'] }];
  assert.throws(() => topoSort(defs), /不存在/);
});

test('dag: readySet 只含依赖全 succeeded 且自身未完成', () => {
  const defs = [
    { id: 'a', role: 'r', dependsOn: [] },
    { id: 'b', role: 'r', dependsOn: ['a'] },
    { id: 'c', role: 'r', dependsOn: ['a'] },
  ];
  const state = { nodes: { a: { status: 'succeeded' } } };
  const ready = readySet(defs, state).map((d) => d.id).sort();
  assert.deepEqual(ready, ['b', 'c']);
});

test('dag: readySet 排除 succeeded 与 in-flight 节点自身', () => {
  const defs = [
    { id: 'a', role: 'r', dependsOn: [] },
    { id: 'b', role: 'r', dependsOn: [] },
    { id: 'c', role: 'r', dependsOn: [] },
  ];
  const state = { nodes: { a: { status: 'succeeded' }, b: { status: 'running' } } };
  const ready = readySet(defs, state).map((d) => d.id);
  assert.deepEqual(ready, ['c']);
});

test('dag: batches 按 ≤N 分并发批次', () => {
  const defs = [1, 2, 3, 4, 5].map((i) => ({ id: `n${i}`, role: 'r', dependsOn: [] }));
  const state = { nodes: {} };
  const bs = batches(defs, state, 3);
  assert.equal(bs.length, 2);
  assert.equal(bs[0].length, 3);
  assert.equal(bs[1].length, 2);
});
