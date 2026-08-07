'use strict';
// 全流水线 E2E 用的 role-aware fake driver 输出：按 prompt 内容返回对应节点的 schema 合法输出。
// 用于 run.js / epic.js 的端到端测试（单测无需真模型/真脚本）。FAKE_TESTER_FAIL=1 时 tester 语义失败。

function outputFor(prompt) {
  if (process.env.FAKE_TESTER_FAIL && prompt.includes('你是测试角色')) {
    return { covered: [], missing: ['tester 语义失败'], smokePassed: false, risks: [] };
  }
  if (prompt.includes('pipe-preflight.sh')) {
    return { ready: true, branch: 'demo', issues: [] };
  }
  if (prompt.includes('架构设计师')) {
    return { domain: 'infra', designSummary: 'infra 域设计', keyDecisions: [], taskGroups: [] };
  }
  if (prompt.includes('你是测试角色')) {
    return { covered: ['c'], missing: [], smokePassed: true, risks: [] };
  }
  if (prompt.includes('CR（只读')) {
    return { pass: true, blockers: [], majors: [], minors: [] };
  }
  if (prompt.includes('验证(CI)')) {
    return { pass: true, steps: [{ step: 'node --test', status: 'pass', detail: 'ok' }] };
  }
  if (prompt.includes('受控集成')) {
    return { archived: true, prUrl: 'http://fake/pr', merged: true, summary: 'merged' };
  }
  if (prompt.includes('流程维护')) {
    return { done: true, summary: 'infra dev done', filesChanged: [], tests: 'node --test' };
  }
  return { done: true, summary: 'fallback' };
}

module.exports = { outputFor };
