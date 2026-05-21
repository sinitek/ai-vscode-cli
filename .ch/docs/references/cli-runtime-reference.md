# CLI 接入参考

本文档替代原 `docs/cli-reference.md` 的详细说明，聚焦**当前仓库已经落地的 CLI 接入行为**。如果 CLI 官方版本发生变化，仍以各自 `--help` 和官方文档为准。

## 1. 当前支持矩阵

| CLI | 当前执行模式 | 会话续接 | 主要实现 |
| --- | --- | --- | --- |
| Codex | 交互式 + 一次性 | 支持 | `src/interactive/codexRunner.ts`、`src/cli/commandRunner.ts` |
| Claude | 交互式 + 一次性 | 支持 | `src/interactive/claudeRunner.ts`、`src/interactive/metaStore.ts` |
| Gemini | 一次性 headless stream-json | 复用 CLI `--resume` 参数，不维护交互 Runner | `src/cli/commandRunner.ts`、`src/cli/geminiStreamJson.ts` |

## 2. 命令来源

三个平台命令都从 VS Code 设置读取：

- `sinitek-cli-tools.commands.codex`
- `sinitek-cli-tools.commands.claude`
- `sinitek-cli-tools.commands.gemini`

参数来源：

- `sinitek-cli-tools.args.codex`
- `sinitek-cli-tools.args.claude`
- `sinitek-cli-tools.args.gemini`

命令解析逻辑集中在 `src/cli/commandRunner.ts`：

- 支持绝对路径、PATH 查找
- Unix/macOS 下会优先尝试常见用户级 npm/pnpm bin 目录（如 `~/.npm-global/bin`、`PNPM_HOME`），降低旧 Homebrew CLI 抢占 `gemini` 命令的概率
- Windows 下额外尝试 npm 全局安装目录
- macOS 下优先直接启动已解析的 CLI；仅在命令仍无法直接解析时，才回退到 `sinitek-cli-tools.macTaskShell` 对应的 `zsh` / `bash`

## 3. 交互模式真实行为

### Codex

- 使用当前用户安装的官方 `codex` CLI
- 通过 `codex app-server --listen stdio://` 建立 JSON-RPC 会话
- 优先直接 `spawn` 已解析的 Codex 可执行路径；macOS 仅在命令无法直接解析时回退到用户配置的 shell 包装
- 会为 Codex 子进程显式注入 `CODEX_HOME` / `CODEX_HOME_DIR`，并移除 `npm_config_prefix` / `NPM_CONFIG_PREFIX`
- 启动前会确保当前工作区在 Codex 配置中被标记为 trusted，并通过 `-c projects.<workspace>.trust_level="trusted"` 追加运行时 override
- 会做 `initialize` / `initialized` 握手
- 使用 `thread/start`、`thread/resume`、`turn/start` 维护 threadId
- 面板“常用命令 -> 压缩上下文”在 Codex 下会直接复用当前 threadId，走 app-server `thread/compact/start` 原生压缩；不会再通过“生成摘要后切到新线程”模拟压缩
- 面板“工具设置”支持项目级“执行后自动压缩上下文”开关（默认关闭）；开启后，在已有会话任务成功结束后会自动压缩上下文；任务中断或报错不触发。该自动行为当前对 Codex / Claude / Gemini 生效
- 回合完成后优先走 graceful shutdown：先结束 stdin，再升级到信号终止，避免长任务在 flush 边界被粗暴打断
- 会把部分设置映射到 thread 选项，例如：
  - model
  - approval policy
  - sandbox mode
  - add-dir
  - web search
  - thinking / reasoning effort
- 面板“工具设置”支持项目级控制 Codex 官方 `multi_agent` 功能，默认关闭；关闭时扩展会在 app-server 启动参数中附加 `--disable multi_agent`，并在 thread config 中显式写入 `features.multi_agent=false`

### Claude

- 使用 `@anthropic-ai/claude-agent-sdk`
- 优先尝试复用用户设置的 Claude 可执行入口
- 同步传入当前模型、工作目录和 `user/project/local` settings
- 通过 SDK session 做会话续接
- 面板“常用命令 -> 压缩上下文”在 Claude 下优先直接发送官方 `/compact` slash command，并通过 SDK `status=compacting` / `compact_boundary` 事件判定原生压缩完成；若当前 Claude 环境明确不支持原生 compact，则回退到旧的“生成摘要后切新会话”兼容方案
- 面板“工具设置”开启“执行后自动压缩上下文”后，Claude 的已有会话任务会在成功结束后走一次压缩（含 `/compact` 原生能力与兼容回退路径）；任务中断或报错不触发
- Claude Code 2.1.118 的官方 CLI 帮助已提供 `--effort <level>`，取值为 `low`、`medium`、`high`、`xhigh`、`max`
- 插件交互 Runner 优先通过 SDK `extraArgs.effort` 传递新版思考力度；若旧 Claude Code/SDK 不支持该参数，则回退到 `maxThinkingTokens`
- 插件 one-shot Claude 调用默认通过 `thinkingArgs.claude.*` 拼装 `--effort <level>`；`off` 默认不再追加旧版 `--max-thinking-tokens 0`

### Gemini

- 当前不维护交互 Runner
- 插件默认参数推荐使用 `--approval-mode auto_edit`；若用户显式改写 `sinitek-cli-tools.args.gemini`，则以用户配置为准
- 插件侧 one-shot / parallel 调用会自动补齐 Gemini headless 参数：`-p <prompt>`
- 若用户未显式配置 `--output-format`，插件会追加 `--output-format stream-json`，并按 JSONL 事件解析 assistant delta、`init.session_id`、`result.status` 与错误事件
- 若用户已在参数中显式配置 `-p` / `--prompt` 或 `--output-format`，插件不会重复插入对应参数，保持用户配置优先
- session 续接仍复用 Gemini CLI 的 `--resume <sessionId>` 参数；扩展侧不维护类似 Codex app-server 的 Gemini 交互 Runner
- 面板“常用命令 -> 压缩上下文”在 Gemini 下会直接复用当前 `sessionId` 调用官方 `/compress` 命令，继续走现有 headless `stream-json` 链路；“执行后自动压缩上下文”开启后，Gemini 也会在已有会话任务成功结束后自动执行一次 `/compress`
- 会参与统一 UI、统一会话存档和统一配置读取

## 4. 模式与参数映射

### thinking mode

插件对外暴露统一的 thinking mode，但实际映射按 CLI 各自处理：

- Codex：映射到 reasoning effort / 相关参数
- Claude：优先映射到 Claude Code `--effort`；旧版本兼容回退到 `maxThinkingTokens` 和 SDK 选项
- Gemini：继续走 CLI 参数拼装；one-shot 场景默认使用 `-p` 与 `--output-format stream-json`

### interactive mode

当前 UI 暴露 `coding / plan / lobster` 三种模式：

- Codex `plan`：收敛到更保守的只读/低信任执行策略
- Claude `plan`：使用 `permissionMode=plan`
- `lobster`：扩展侧编排的多轮主子任务模式；底层 CLI 权限按 coding 模式执行，并按会话隔离写入 `~/.sinitek_cli/lobster-tasks/<workspaceKey>/<cli>/<sessionId>/lobster-tasks.json` 记录任务概要（首次主任务尚未拿到真实会话 ID 时先写入 pending 路径，拿到会话 ID 后自动迁移），同时通过 `~/.sinitek_cli/lobster-communications/<taskId>/` 组织沟通文件、activeSubtaskId、activeSubtaskIds、主任务 JSON 决策、acceptance 验收结果、预计剩余轮次和轮次状态，供扩展解析并以独立新会话启动子任务；工具设置支持配置新建龙虾任务最大主任务复核轮次（默认 20，范围 1-100，已有任务保持记录值），以及“子任务成功完成后自动关闭 AI 对话标签页”开关（默认开启）；主任务每次复核应返回 `estimatedRemainingRounds` 预判剩余主任务复核轮次；`status=continue` 可返回旧 `subtask` 或新 `subtasks` 批次，扩展内部统一按批次处理；主任务按“并发优先、文件冲突兜底串行”判断子任务是否冲突，只有能确认 `writeFiles` / `conflictGroup` 互不重叠时才把多个子任务放入同一 `subtasks` 批次，同一批次最多 6 个；扩展会按声明的写入文件/冲突组自动规划组内并发、组间串行；单子任务时 UI 自动切换到子任务标签展示气泡和流式消息，多子任务批次会创建多个子任务标签并并发执行，只有批次内所有子任务都正常完成后才切回并唤醒主任务；每次主任务返回 `status=continue` 时，扩展会把该轮 JSON 协议气泡原位替换成 Markdown 子任务派发摘要，并把摘要追加到 `main-task.md`；轮次按主任务复核轮计数，同一轮可包含一个或多个并发子任务；第 1 轮要求主任务先做总体阶段规划，再优先派发首批互不冲突子任务，不再默认只派发 1 个；龙虾模式下底部模型选择支持分别指定主任务模型与子任务模型，并可在“管理模型”里按模型配置“主任务/子任务”角色开关来限定候选模型；主任务必须读取沟通文件并把 subtasks[*].prompt 写成自包含详细指令，且在完成时返回整体总结、各轮子任务摘要与用户需求覆盖清单（全部 passed=true），扩展会写入 `main-task.md` 和任务记录，并移除最终主任务 JSON 协议气泡，在对话中追加 assistant Markdown 最终总结气泡；只有主任务显式返回 `status=completed`（且 `acceptance.passed=true`）才结束；主任务中断后支持在同一标签输入“继续/continue/resume”等短提示词恢复同一任务并从当前轮次继续；子任务完成前必须写入自己的沟通文件；子任务执行出错会等待 1 分钟后重试，最多重试 5 次，主动停止不重试；子任务中断后在子任务标签手动继续时会强制按 coding 任务执行，不允许再次启动龙虾任务；`lobster-tasks` 与 `lobster-communications` 产物同样按 30 天保留策略清理

## 5. 图片与附件

当前聊天面板支持上传附件，Codex 额外支持图片输入桥接：

- 先把附件写入 `~/.sinitek_cli/temp/`
- 若是图片且 Codex CLI 版本满足要求，会转成官方图片输入路径
- 若版本不满足，则保留向后兼容行为并提示升级

## 6. 会话与本地映射

扩展侧会话 ID 与底层真实续接 ID 不同：

- Codex：扩展 sessionId ↔ threadId
- Claude：扩展 sessionId ↔ Claude sessionId

映射数据通过 `src/interactive/metaStore.ts` 落盘，避免切换会话或重启 VS Code 后丢失续接能力。

## 7. 当前平台注意事项

### Windows

如果出现 `spawn <cli> ENOENT`：

1. 先用 `where codex` / `where claude` / `where gemini` 验证命令
2. 必要时把命令配置成绝对路径
3. 修改 PATH 后重启 VS Code

### macOS

如果默认 shell 环境与 VS Code 环境不一致，可切换：

- `sinitek-cli-tools.macTaskShell = zsh`
- `sinitek-cli-tools.macTaskShell = bash`

## 8. 更新本文档时的原则

只有下面两类内容应进入这里：

- 当前仓库已经落地、可被代码验证的行为
- 对使用者排障有高价值的运行事实

不要把未来方案、未实现提案或纯猜测放进来；那类内容应进入设计文档或技术债跟踪。
