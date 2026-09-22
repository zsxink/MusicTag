'use strict';
// --self-check（spec「流程脚本静态自检」）：校验角色定义、节点定义、driver 契约完整性，
// 并对流程脚本做静态自检（Node `node --check` + shell `bash -n`），fail-closed——
// 任一失败即 self-check 非零退出，preflight ready=false，不进入任何写入阶段。

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { validateNode, topoSort } = require('./dag.js');
const pipeline = require('./pipeline.js');
const registry = require('./drivers/registry.js');
const contract = require('./drivers/contract.js');
const capability = require('./capability.js');

const REQUIRED_ROLES = ['leader', 'architect', 'rust-backend', 'vue-frontend', 'cr-agent', 'verify-agent', 'tester'];

// 返回 { ok, errors[] }。ok=false 即 fail-closed。
function run({ repoRoot = process.cwd() } = {}) {
  const errors = [];
  const checks = {
    agentGitWriteForbidden: true,
    scopedWriterNodes: true,
  };
  const dir = __dirname;
  // 旧测试传入 `<repo>/.agents` 作为 repoRoot；兼容该调用形态，实际资产根仍是仓库根。
  const requestedRoot = path.resolve(repoRoot);
  const root = path.basename(requestedRoot) === '.agents' && !fs.existsSync(path.join(requestedRoot, 'openspec'))
    ? path.dirname(requestedRoot) : requestedRoot;
  const NEUTRAL_WORKFLOW_DIR = '.agents/workflows';
  const NEUTRAL_COMMAND_DIR = '.agents/commands';

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
    if ((rolesJson[role].capabilities || []).includes('git_write')) {
      checks.agentGitWriteForbidden = false;
      errors.push(`角色 ${role} 不得申请 git_write，提交由 core 统一完成`);
    }
  }

  // ② 节点定义合法 + 角色引用合法（遍历全部 6 个 domain 的动态展开）
  for (const domain of pipeline.DOMAINS) {
    const s = { change: 'demo', nodes: { architect: { status: 'succeeded', result: { domain } } } };
    let defs;
    try { defs = pipeline.buildPipeline(s); } catch (e) { errors.push(`domain=${domain} 构建流水线失败: ${e.message}`); continue; }
    for (const d of defs) {
      const ve = validateNode(d);
      if (ve.length) errors.push(`节点 ${d.id}: ${ve.join('; ')}`);
      if ((d.kind || 'agent') === 'agent' && !rolesJson[d.role]) errors.push(`节点 ${d.id} 引用未定义角色 ${d.role}`);
      if ((d.kind || 'agent') === 'agent' && d.role !== 'cr-agent' && !Array.isArray(d.writeScopes)) {
        checks.scopedWriterNodes = false;
        errors.push(`可写 Agent 节点 ${d.id} 缺少 writeScopes`);
      }
      if (typeof d.resultOk === 'function') {
        const probe = ['bootstrap', 'spec-gate'].includes(d.id)
          ? { ready: true }
          : d.role === 'cr-agent'
          ? { pass: true, blockers: [], majors: [], steps: [] }
          : d.id === 'verify'
            ? { pass: true, blockers: [], majors: [], steps: [{ step: 'probe', status: 'pass', detail: '' }] }
          : d.id === 'integrate'
            ? { archived: true, prUrl: 'https://example.invalid/pr/1', merged: true, summary: '' }
          : { done: true, summary: '', smokePassed: true, covered: [], missing: [], risks: [] };
        if (d.resultOk(probe) !== true) errors.push(`节点 ${d.id} 的 resultOk 语义异常`);
      }
    }
    try { topoSort(defs); } catch (e) { errors.push(`domain=${domain} 拓扑非法: ${e.message}`); }
  }

  // ③ registry + versioned driver contract + capability 映射（新增 runtime 自动发现）
  for (const entry of registry.MANIFEST) {
    if (entry.apiVersion !== contract.API_VERSION) errors.push(`driver ${entry.name} manifest apiVersion 不兼容`);
    const info = registry.get(entry.name);
    if (!info || !info.available) { errors.push(`driver ${entry.name} 加载失败: ${info && info.loadError || '不可用'}`); continue; }
    if (info.module.API_VERSION !== contract.API_VERSION) errors.push(`driver ${entry.name} apiVersion 不兼容`);
    if (typeof info.module.runAgent !== 'function' || typeof info.module.buildArgs !== 'function') errors.push(`driver ${entry.name} 缺 runAgent/buildArgs 函数`);
  }
  for (const name of Object.keys(capability.capabilities())) {
    for (const driver of registry.names()) {
      const mapped = capability.hostTools(driver, [name]);
      if (!Array.isArray(mapped) && mapped.failClosed && name !== 'write_files') errors.push(`capability ${name} 无法映射到 ${driver}`);
    }
  }

  // ④ 静态自检：核心/commands 全部 Node 文件 + 中立 workflow；兼容壳也检查，fail-closed。
  const jsFiles = [];
  const walk = (root) => {
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      // test/fixtures/ 是故意注入语法错误/缺失输出的失败探针，不得进入静态自检。
      if (entry.isDirectory() && entry.name === 'fixtures') continue;
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) jsFiles.push(file);
    }
  };
  walk(dir);
  walk(path.resolve(root, NEUTRAL_COMMAND_DIR));
  for (const file of jsFiles) {
    try { execSync(`node --check "${file}"`, { stdio: 'ignore' }); }
    catch (_) { errors.push(`node --check 失败: ${path.relative(repoRoot, file)}`); }
  }
  for (const wfDir of [path.resolve(root, NEUTRAL_WORKFLOW_DIR), path.resolve(root, '.claude', 'workflows')]) {
    if (!fs.existsSync(wfDir)) { if (wfDir === path.resolve(root, NEUTRAL_WORKFLOW_DIR)) errors.push(`中立 workflow 目录缺失: ${wfDir}`); continue; }
    for (const sh of fs.readdirSync(wfDir).filter((f) => f.endsWith('.sh'))) {
      try { execSync(`bash -n "${path.join(wfDir, sh)}"`, { stdio: 'ignore' }); }
      catch (_) { errors.push(`bash -n 失败: ${path.relative(root, path.join(wfDir, sh))}`); }
    }
  }
  if (!fs.existsSync(path.resolve(root, NEUTRAL_COMMAND_DIR))) errors.push('中立 command 目录缺失');

  return { ok: errors.length === 0, errors, checks };
}

module.exports = { run, REQUIRED_ROLES };
