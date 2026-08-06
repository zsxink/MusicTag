'use strict';
// 自研轻量 JSON Schema 校验（零依赖）。支持子集：type / required / enum / items /
// properties / anyOf / additionalProperties。用于 driver 结构化输出的二次校验。
// validate(schema, value) → { valid, errors: [] }

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validate(schema, value, path = '$', errors = []) {
  if (!schema || typeof schema !== 'object') return { valid: false, errors: ['schema 非法'] };

  if (schema.anyOf) {
    const anyValid = schema.anyOf.some((sub) => validate(sub, value).valid);
    if (!anyValid) errors.push(`${path}: 不满足 anyOf 任一分支`);
    return { valid: errors.length === 0, errors };
  }

  const got = typeOf(value);

  if (schema.type) {
    if (schema.type === 'integer') {
      if (got !== 'number' || !Number.isInteger(value)) errors.push(`${path}: 期望 integer，实际 ${got}`);
    } else if (schema.type === 'number') {
      if (got !== 'number') errors.push(`${path}: 期望 number，实际 ${got}`);
    } else if (schema.type === 'array') {
      if (got !== 'array') errors.push(`${path}: 期望 array，实际 ${got}`);
    } else if (schema.type === 'object') {
      if (got !== 'object' || value === null) errors.push(`${path}: 期望 object，实际 ${got}`);
    } else if (got !== schema.type) {
      errors.push(`${path}: 期望 ${schema.type}，实际 ${got}`);
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: 值 ${JSON.stringify(value)} 不在枚举 ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type === 'object' && got === 'object' && value !== null) {
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in value)) errors.push(`${path}: 缺少必填字段 ${req}`);
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in value) validate(sub, value[k], `${path}.${k}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const k of Object.keys(value)) {
        if (!allowed.has(k)) errors.push(`${path}: 不允许的额外字段 ${k}`);
      }
    }
  }

  if (schema.type === 'array' && got === 'array' && schema.items) {
    for (let i = 0; i < value.length; i++) validate(schema.items, value[i], `${path}[${i}]`, errors);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validate };
