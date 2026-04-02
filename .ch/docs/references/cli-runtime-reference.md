# CLI 接入参考

本文档替代原 `docs/cli-reference.md` 的详细说明，聚焦**当前仓库已经落地的 CLI 接入行为**。如果 CLI 官方版本发生变化，仍以各自 `--help` 和官方文档为准。

## 1. 当前支持矩阵

| CLI | 当前执行模式 | 会话续接 | 主要实现 |
| --- | --- | --- | --- |
| Codex | 交互式 + 一次性 | 支持 | `src/interactive/codexRunner.ts`、`src/cli/commandRunner.ts` |
| Claude | 交互式 + 一次性 | 支持 | `src/interactive/claudeRunner.ts`、`src/interactive/metaStore.ts` |
| Gemini | 一次性 | 仅复用 CLI resume 参数，不维护交互 Runner | `src/cli/commandRunner.ts` |

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
- Windows 下额外尝试 npm 全局安装目录
- macOS 下可借助 `sinitek-cli-tools.macTaskShell` 选择 `zsh` / `bash`

## 3. 交互模式真实行为

### Codex

- 使用当前用户安装的官方 `codex` CLI
- 通过 `codex app-server --listen stdio://` 建立 JSON-RPC 会话
- 会做 `initialize` / `initialized` 握手
- 使用 `thread/start`、`thread/resume`、`turn/start` 维护 threadId
- 会把部分设置映射到 thread 选项，例如：
  - model
  - approval policy
  - sandbox mode
  - add-dir
  - web search
  - thinking / reasoning effort

### Claude

- 使用 `@anthropic-ai/claude-agent-sdk`
- 优先尝试复用用户设置的 Claude 可执行入口
- 同步传入当前模型、工作目录和 `user/project/local` settings
- 通过 SDK session 做会话续接

### Gemini

- 当前不维护交互 Runner
- 仍走 one-shot / stream 方式
- 会参与统一 UI、统一会话存档和统一配置读取

## 4. 模式与参数映射

### thinking mode

插件对外暴露统一的 thinking mode，但实际映射按 CLI 各自处理：

- Codex：映射到 reasoning effort / 相关参数
- Claude：映射到 `maxThinkingTokens` 和 SDK 选项
- Gemini：继续走 CLI 参数拼装

### interactive mode

当前 UI 暴露 `coding / plan` 两种模式：

- Codex `plan`：收敛到更保守的只读/低信任执行策略
- Claude `plan`：使用 `permissionMode=plan`

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
