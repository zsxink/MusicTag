'use strict';
// 全流水线 E2E 假命令目录种子：为临时仓库的确定性 verify/integrate runner 提供命令桩。
// 通过 PIPE_FAKE_CMDS=<dir> 注入（command-adapter.js 解析），子进程 env 透传生效。
// 提供桩：node / npx / openspec（验证计划短路），cargo / npm / bash / gh / git（集成与并发）。
// 同时覆盖 `git` 桩场景：E2E 临时仓库无 origin，det 集成必须有可用的 git/gh 假实现。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 写入一个可执行脚本桩。body 为 bash 片段（在脚本内可直接引用环境变量）。
function writeStub(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

// 构造一个完整假命令目录，返回 { dir, reload() }。
// options:
//   - verify: 让 node/npx/cargo/npm/openspec 假成功（E2E 验证计划短路）
//   - gitRemote: 让 git fetch/push/rebase/rev-list 假成功（无 origin 的临时仓库）
//   - ghFlat: gh 桩默认返回「PR 已存在/已通过/可合并」确定性事实
function fakeCommands(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-fakecmds-'));
  const { verify = true, gitRemote = false, ghFlat = false } = options;

  if (verify) {
    // node 桩最宽泛：任何 node 参数都假成功（--check/--test/run.js --self-check/测试子进程）。
    writeStub(dir, 'node', 'exit 0');
    writeStub(dir, 'npx', 'exit 0');
    writeStub(dir, 'npm', 'exit 0');
    writeStub(dir, 'cargo', 'exit 0');
    writeStub(dir, 'openspec', 'exit 0');
    // bash 桩用于 preflight/pipe 脚本：E2E 已种下 worktree/主仓库的脚本，直接假成功即可，
    // 避免临时仓库缺少真实 openspec 校验。演进：若需真实 preflight 断言，这里再收紧。
    writeStub(dir, 'bash', 'exit 0');
  }

  if (gitRemote) {
    // git 桩：本地操作透传真实 git，远端/network 操作假成功。
    // 临时仓库确有 git 对象，本桩目录未加入 PATH，故桩内 `git` 直接解析到真实 git。
    writeStub(dir, 'git', `
joined="\${*}"
case "\$1" in
  fetch) exit 0 ;;
  push) exit 0 ;;
  rebase) exit 0 ;;
  # diff --name-only origin/main...HEAD → 确定性「已归档 + 实现」文件集，供 commit checkpoint 断言。
  diff)
    echo "openspec/specs/workflow-core.md"
    echo "src/a.rs"
    exit 0 ;;
  # rev-list --count HEAD..origin/main → 0（不落后）。
  rev-list) echo "0"; exit 0 ;;
  # branch --show-current → 确定性分支名；branch -d → 成功。
  branch)
    if [[ "\$2" == "--show-current" ]]; then echo "demo"; exit 0; fi
    if [[ "\$2" == "-d" ]]; then exit 0; fi
    ;;
esac
exec git "\$@"
`);
  }

  if (ghFlat) {
    // gh 桩：按 integrate checkpoint 查询复用返回确定性事实。
    writeStub(dir, 'gh', `
case "$1 $2" in
  "pr list") echo '[]' ;;                       # 无既有 PR → create-pr create
  "pr create") echo 'https://github.com/zsxink/MusicTag/pull/1' ;;
  "pr checks") echo '[{"name":"cargo","state":"SUCCESS","required":true}]' ;;
  "pr view")
    if [[ " $* " == *" mergedAt "* ]]; then
      echo '{"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z"}'
    else
      echo '{"state":"MERGED","url":"https://github.com/zsxink/MusicTag/pull/1","mergeStateStatus":"MERGED"}'
    fi ;;
  "pr merge") exit 0 ;;
  *) exit 0 ;;
esac
`);
  }

  return {
    dir,
    env() {
      return { PIPE_FAKE_CMDS: dir };
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { fakeCommands, writeStub }; // eslint-disable-line camelcase