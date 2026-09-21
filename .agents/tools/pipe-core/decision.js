'use strict';
// P2 决断链：节点失败 → leader 决断节点 → { action: retry|reroute|escalate|abort, node, reason }。
// 只做技术归类（retry/reroute 不涉及产品方向）；一旦需要用户拍板（方向/范围/歧义/CR 三轮不过）
// → escalate 挂起回主会话（D6），不自动继续。

const OWNER_RULES = [
  { prefix: 'src-tauri/', role: 'rust-backend', scope: 'src-tauri/ 下代码' },
  { prefix: 'src/', role: 'vue-frontend', scope: 'src/ 下代码' },
];

// CR 返回的 file 可能是绝对路径（含 /MusicTag/）或仓库相对路径。归一化后按前缀判归属。
function ownerFor(file) {
  const f = file || '';
  const seg = f.includes('/MusicTag/') ? f.slice(f.indexOf('/MusicTag/') + '/MusicTag/'.length) : f;
  for (const rule of OWNER_RULES) {
    if (seg.startsWith(rule.prefix)) return rule;
  }
  return { role: 'leader', scope: '配置、CI、OpenSpec artifacts 或工作流文档' };
}

function roleLabel(role) {
  const map = {
    leader: 'Leader（工作流/规格维护）',
    'rust-backend': 'Rust 开发',
    'vue-frontend': 'Vue 开发',
    architect: '架构设计师',
    tester: '测试角色',
    'cr-agent': 'CR（只读）',
    'verify-agent': '验证(CI)角色',
  };
  return map[role] || role;
}

function decisionPrompt(ctx) {
  const { def, attempts, error, errorKind, result, round, maxRounds } = ctx;
  return `你是流水线 Leader 决断节点。节点「${def.id}」第 ${round}/${maxRounds} 轮失败，` +
    `attempt=${attempts}，errorKind=${errorKind || 'unknown'}，失败原因：${error || '未知'}。` +
    `节点结果：${JSON.stringify(result || null)}。` +
    `只能返回 JSON：{action:"retry|reroute|escalate|abort",node:"${def.id}",reason:"..."}` +
    `。retry 仅用于技术性临时失败；reroute 仅用于 CR 的 blocker/major 且需在 reason 外由调用方保留问题；` +
    `涉及产品方向、范围、歧义或需要用户拍板时必须 escalate/abort。`;
}

// 决断入口：节点失败后调用。返回 { action, node, reason, ... }。
// ctx: { def, attempts, error, result, round, maxRounds }
function decide(ctx) {
  const { def, attempts, error, errorKind, result, round, maxRounds } = ctx;

  // ① CR 内容问题（pass=false 且 blocker/major 非空）优先 reroute（内容问题非技术性，不进 retry）
  if (def.role === 'cr-agent' && result && result.pass === false) {
    const problems = [...(result.blockers || []), ...(result.majors || [])];
    if (problems.length && round < maxRounds) {
      return {
        action: 'reroute',
        node: def.id,
        reason: `CR 第 ${round} 轮存在 ${problems.length} 条 blocker/major，按文件所有权打回修复后复审`,
        problems,
        round,
        maxRounds,
      };
    }
    return {
      action: 'escalate',
      node: def.id,
      reason: 'CR 三轮未通过，挂起交主会话决策',
      problems,
      escalate: true,
    };
  }

  // 配置/权限/schema 错误重试不会改变外部条件；尤其只读节点已经产生
  // 工作区写入时，第二次尝试可能把同一污染误判为“无变化”。立即挂起。
  if (['auth', 'config', 'schema'].includes(errorKind)) {
    return {
      action: 'escalate',
      node: def.id,
      reason: `节点 ${def.id} 发生不可重试的 ${errorKind} 错误：${error || '未知'}`,
      escalate: true,
    };
  }

  // ② 技术性失败 → retry（attempts 未超上限；退避由调用方按 def.retry.intervalMs 执行）
  const retryMax = def.retry && def.retry.max !== undefined ? def.retry.max : 2;
  if (attempts <= retryMax) {
    return { action: 'retry', node: def.id, reason: `第 ${attempts} 次执行失败（${error || '未知'}），技术性重试` };
  }

  // ③ 其余（开发/验证/集成反复失败、歧义）→ escalate 回主会话（D6）
  return {
    action: 'escalate',
    node: def.id,
    reason: `节点 ${def.id} 重试耗尽仍失败（${error || '未知'}），涉及方向/范围/歧义，挂起交主会话`,
    escalate: true,
  };
}

module.exports = { decide, decisionPrompt, ownerFor, roleLabel };
