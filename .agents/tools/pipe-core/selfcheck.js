'use strict';
// --self-check（spec「流程脚本静态自检」）：校验角色定义、节点定义、driver 契约完整性，
// 并对流程脚本做静态自检（Node `node --check` + shell `bash -n`），fail-closed——
// 任一失败即 self-check 非零退出，preflight ready=false，不进入任何写入阶段。

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { validateNode, topoSort } = require('./dag.js');
const pipeline = require('./pipeline.js');

const REQUIRED_ROLES = ['leader', 'architect', 'rust-backend', 'vue-frontend', 'cr-agent', 'verify-agent', 'tester'];
const DRIVER_NAMES = ['claude', 'codex'];

// 返回 { ok, errors[] }。ok=false 即 fail-closed。
function run({ repoRoot = process.cwd() } = {}) {
  const errors = [];
  const dir = __dirname;

  // ① 角色定义完整性（D7 单源）
  let rolesJson;
  try {
    rolesJson = JSON.parse(fs.readFileSync(path.join(dir, 'roles', 'roles.json'), 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`roles.json 解析失败: ${e.message}`] };
  }
  for (const role of REQUIRED_ROLES) {
    if (!rolesJson[role]) { errors.push(`角色 ${role} 未定义`); continue; }
    const f = path.join(dir, 'roles', rolesJson[role].file || `${role}.md`);
    if (!fs.existsSync(f)) errors.push(`角色 ${role} 的文案文件缺失: ${f}`);
  }

  // ② 节点定义合法 + 角色引用合法（遍历全部 6 个 domain 的动态展开）
  for (const domain of pipeline.DOMAINS) {
    const s = { change: 'demo', nodes: { architect: { status: 'succeeded', result: { domain } } } };
    let defs;
    try { defs = pipeline.buildPipeline(s); } catch (e) { errors.push(`domain=${domain} 构建流水线失败: ${e.message}`); continue; }
    for (const d of defs) {
      const ve = validateNode(d);
      if (ve.length) errors.push(`节点 ${d.id}: ${ve.join('; ')}`);
      if (!rolesJson[d.role]) errors.push(`节点 ${d.id} 引用未定义角色 ${d.role}`);
      if (typeof d.resultOk === 'function') {
        const probe = d.role === 'cr-agent' || d.role === 'verify-agent'
          ? { pass: true, blockers: [], majors: [], steps: [] }
          : { done: true, summary: '', smokePassed: true, covered: [], missing: [], risks: [] };
        if (d.resultOk(probe) !== true) errors.push(`节点 ${d.id} 的 resultOk 语义异常`);
      }
    }
    try { topoSort(defs); } catch (e) { errors.push(`domain=${domain} 拓扑非法: ${e.message}`); }
  }

  // ③ driver 契约完整性（P5 统一接口 runAgent/buildArgs）
  for (const name of DRIVER_NAMES) {
    let mod;
    try { mod = require(path.join(dir, 'drivers', `${name}.js`)); }
    catch (e) { errors.push(`driver ${name} 加载失败: ${e.message}`); continue; }
    if (typeof mod.runAgent !== 'function') errors.push(`driver ${name} 缺 runAgent 函数`);
    if (typeof mod.buildArgs !== 'function') errors.push(`driver ${name} 缺 buildArgs 函数`);
  }

  // ④ 静态自检：Node `node --check`（核心全部顶层 .js）+ shell `bash -n`（.claude/workflows/*.sh）
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    try { execSync(`node --check "${path.join(dir, f)}"`, { stdio: 'ignore' }); }
    catch (_) { errors.push(`node --check 失败: pipe-core/${f}`); }
  }
  const wfDir = path.resolve(repoRoot, '.claude', 'workflows');
  if (fs.existsSync(wfDir)) {
    for (const sh of fs.readdirSync(wfDir).filter((f) => f.endsWith('.sh'))) {
      try { execSync(`bash -n "${path.join(wfDir, sh)}"`, { stdio: 'ignore' }); }
      catch (_) { errors.push(`bash -n 失败: .claude/workflows/${sh}`); }
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { run, REQUIRED_ROLES };
