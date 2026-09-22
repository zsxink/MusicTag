'use strict';

// 产品无关能力层。角色只声明 capability，driver 再把 capability 翻译成宿主权限。
// 不能满足角色最小权限时 fail-closed；无法精确映射但可由沙箱/落地审计兜底时记录 degraded。

const DEFINITIONS = Object.freeze({
  shell: { description: '执行受控 shell 命令' },
  read_files: { description: '读取文件' },
  write_files: { description: '写入文件' },
  search_files: { description: '搜索文件与符号' },
  git_read: { description: '读取 git 状态与历史' },
  git_write: { description: '写入 git 提交与分支' },
  network: { description: '访问网络资源' },
});

const MINIMUMS = Object.freeze({
  'read-only': ['shell', 'read_files', 'search_files', 'git_read'],
  'workspace-write': ['shell', 'read_files', 'write_files', 'search_files', 'git_read'],
});

// 宿主工具名只能出现在这里，公共 core/role 文案不依赖它们。
const HOST_MAP = Object.freeze({
  claude: {
    shell: 'Bash', read_files: 'Read', write_files: 'Edit', search_files: 'Glob',
    git_read: 'Bash', git_write: 'Bash', network: 'WebFetch',
  },
  codex: {
    shell: 'sandbox shell', read_files: 'sandbox read', write_files: 'workspace-write',
    search_files: 'sandbox search', git_read: 'sandbox read', git_write: 'workspace-write',
    network: 'network',
  },
  opencode: {
    shell: 'shell', read_files: 'read', write_files: 'edit/write', search_files: 'glob/grep',
    git_read: 'shell', git_write: 'shell/edit', network: 'web/network',
  },
});

function capabilities() {
  return { ...DEFINITIONS };
}

function minCapabilities(sandbox = 'workspace-write') {
  const result = MINIMUMS[sandbox];
  if (!result) throw new Error(`未知 sandbox: ${sandbox}`);
  return [...result];
}

function hostTools(driver, requested = [], options = {}) {
  const map = HOST_MAP[driver];
  if (!map) return { failClosed: true, tools: [], degraded: [], error: `未知 driver: ${driver}` };
  const sandbox = options.sandbox;
  const required = new Set(sandbox ? minCapabilities(sandbox) : []);
  const requestedSet = new Set(requested);
  const missing = [...required].filter((cap) => !requestedSet.has(cap));
  if (missing.length) {
    // 角色定义自身缺能力也必须 fail-closed，不能由宿主默认权限补齐。
    return { failClosed: true, tools: [], degraded: [], missing, error: `缺少最小能力: ${missing.join(', ')}` };
  }
  const degraded = [];
  const tools = [];
  for (const cap of requested) {
    if (!DEFINITIONS[cap]) {
      degraded.push({ capability: cap, note: '未知能力，未映射到宿主工具' });
      continue;
    }
    if (!map[cap]) {
      degraded.push({ capability: cap, note: '宿主无法精确映射；依赖沙箱与落地审计' });
      continue;
    }
    if (!tools.includes(map[cap])) tools.push(map[cap]);
  }
  // 保持旧 driver 单测的数组兼容：没有降级时直接返回工具数组；有降级时返回审计对象。
  if (!degraded.length) return tools;
  return { tools, degraded, failClosed: false };
}

function validateRequested(driver, requested, sandbox) {
  const result = hostTools(driver, requested, { sandbox });
  if (Array.isArray(result)) return { ok: true, tools: result, degraded: [] };
  return { ok: !result.failClosed, ...result };
}

module.exports = { capabilities, minCapabilities, hostTools, validateRequested, HOST_MAP };
