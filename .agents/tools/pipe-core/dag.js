'use strict';
// 节点定义校验 + 拓扑排序 + 就绪集 + 并发批次。核心消费数据驱动的节点定义，
// 不硬编码节点顺序（spec「节点定义驱动」场景）。

function validateNode(node) {
  const errors = [];
  if (!node || typeof node !== 'object') return ['节点定义非法：非对象'];
  if (!node.id) errors.push('节点缺少 id');
  if (!node.role) errors.push(`节点 ${node.id || '(unknown)'}: 缺少 role`);
  if (node.prompt === undefined && node.promptFn === undefined) {
    errors.push(`节点 ${node.id || '(unknown)'}: 缺少 prompt 或 promptFn`);
  }
  if (node.schema === undefined) errors.push(`节点 ${node.id || '(unknown)'}: 缺少 schema`);
  if (node.dependsOn !== undefined && !Array.isArray(node.dependsOn)) {
    errors.push(`节点 ${node.id || '(unknown)'}: dependsOn 必须是数组`);
  }
  return errors;
}

// Kahn 拓扑排序；返回有序 id 数组，环或缺失依赖抛错。
function topoSort(defs) {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const indeg = new Map(defs.map((d) => [d.id, (d.dependsOn || []).length]));
  const adj = new Map(defs.map((d) => [d.id, []]));
  for (const d of defs) {
    for (const dep of d.dependsOn || []) {
      if (!byId.has(dep)) throw new Error(`节点 ${d.id} 依赖不存在的节点 ${dep}`);
      adj.get(dep).push(d.id);
    }
  }
  const queue = [...indeg.keys()].filter((id) => indeg.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of adj.get(id)) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== defs.length) throw new Error('节点依赖存在环');
  return order;
}

// 就绪集：依赖全部 succeeded 且自身未完成（非 succeeded/running/suspended）。
function readySet(defs, state) {
  return defs.filter((d) => {
    const s = state.nodes[d.id];
    if (s && (s.status === 'succeeded' || s.status === 'running' || s.status === 'suspended')) return false;
    const deps = d.dependsOn || [];
    return deps.every((dep) => {
      const ds = state.nodes[dep];
      return ds && ds.status === 'succeeded';
    });
  });
}

// 就绪集按 ≤N 拆并发批次。
function batches(defs, state, maxConcurrency = 3) {
  const ready = readySet(defs, state);
  const out = [];
  for (let i = 0; i < ready.length; i += maxConcurrency) {
    out.push(ready.slice(i, i + maxConcurrency));
  }
  return out;
}

module.exports = { validateNode, topoSort, readySet, batches };
