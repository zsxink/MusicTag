'use strict';
// 确定性节点命令适配层：verify/integrate 不直接 spawn 真实二进制，而是统一经本模块
// 解析命令执行器。测试/CI 通过 PIPE_FAKE_CMDS=<dir> 注入假命令目录：
//   <dir>/<command>  放置同名可执行文件，则该 command 用假实现（不碰真实工具/网络）。
// 与既有 fake driver 注入（PIPE_CLAUDE_BIN 等）同一模式，跨子进程边界生效（env 透传）。
// 未设置时回退 command-runner 真实执行（行为不变）。

const path = require('node:path');
const fs = require('node:fs');
const { runCommand } = require('./command-runner.js');

// 返回 { execCommand, commandPathFor }。
// commandPathFor(command)：PIPE_FAKE_CMDS 里存在同名文件 → 替换为该文件绝对路径。
function resolveExecutable(command, fakeCmdDir) {
  if (!fakeCmdDir) return command;
  const candidate = path.join(fakeCmdDir, command);
  return fs.existsSync(candidate) ? candidate : command;
}

// 构造 verify/integrate 用的命令执行器。若配置了 fake 目录，命令被替换为假实现路径。
function makeRunCommand(fakeCmdDir, baseRunCommand = runCommand) {
  const execCommand = (options) => {
    const command = options.command;
    const resolved = resolveExecutable(command, fakeCmdDir);
    if (resolved !== command) {
      // fake 命令直接可执行（.sh/.js），跳过真实工具。
      return baseRunCommand({ ...options, command: resolved, args: options.args || [], shell: false });
    }
    return baseRunCommand(options);
  };
  return execCommand;
}

module.exports = { resolveExecutable, makeRunCommand };