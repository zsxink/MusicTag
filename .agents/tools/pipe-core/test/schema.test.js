'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../schema.js');

test('schema: type 校验基础类型', () => {
  assert.equal(validate({ type: 'boolean' }, true).valid, true);
  assert.equal(validate({ type: 'boolean' }, 'x').valid, false);
  assert.equal(validate({ type: 'string' }, 'ok').valid, true);
  assert.equal(validate({ type: 'number' }, 3).valid, true);
  assert.equal(validate({ type: 'integer' }, 3).valid, true);
  assert.equal(validate({ type: 'integer' }, 3.5).valid, false);
});

test('schema: object 必填与属性递归校验', () => {
  const schema = {
    type: 'object',
    properties: {
      ready: { type: 'boolean' },
      branch: { type: 'string' },
    },
    required: ['ready', 'branch'],
  };
  assert.equal(validate(schema, { ready: true, branch: 'x' }).valid, true);
  const bad = validate(schema, { ready: true });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => e.includes('缺少必填字段 branch')));
});

test('schema: enum 校验', () => {
  const schema = { type: 'string', enum: ['backend', 'frontend', 'both', 'docs', 'spec', 'infra'] };
  assert.equal(validate(schema, 'infra').valid, true);
  assert.equal(validate(schema, 'unknown').valid, false);
});

test('schema: array items 校验', () => {
  const schema = {
    type: 'array',
    items: {
      type: 'object',
      properties: { step: { type: 'string' }, status: { type: 'string', enum: ['pass', 'fail'] } },
      required: ['step', 'status'],
    },
  };
  assert.equal(validate(schema, [{ step: 'a', status: 'pass' }]).valid, true);
  assert.equal(validate(schema, [{ step: 'a', status: 'nope' }]).valid, false);
});

test('schema: anyOf 分支校验', () => {
  const schema = {
    anyOf: [
      { type: 'object', required: ['action'], properties: { action: { type: 'string' } } },
      { type: 'null' },
    ],
  };
  assert.equal(validate(schema, { action: 'retry' }).valid, true);
  assert.equal(validate(schema, null).valid, true);
  assert.equal(validate(schema, 42).valid, false);
});

test('schema: additionalProperties=false 拦截额外字段', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
  assert.equal(validate(schema, { a: '1' }).valid, true);
  assert.equal(validate(schema, { a: '1', b: '2' }).valid, false);
});

test('schema: null 与空值处理不误报 object', () => {
  const schema = { type: 'object', properties: {}, required: [] };
  assert.equal(validate(schema, { }).valid, true);
});
