# Codex 官方规范对齐说明

- 核验日期：2026-03-28
- 目标：说明这个仓库骨架为什么这样组织，以及它和 Codex 官方规范的对应关系。

## 我们采用的官方要点

### 1. 项目级配置使用 `.codex/config.toml`

Codex 官方文档说明，项目可以使用 `.codex/config.toml` 提供项目级配置，并且只在**受信任项目**中生效。

因此本仓库把以下内容放进项目级配置：

- 项目文档发现参数
- 项目级 MCP

### 2. 项目级说明文件使用 `AGENTS.md`

官方说明中，Codex 会从项目根到当前目录按层读取 `AGENTS.md` / `AGENTS.override.md`，越近的目录优先级越高。

因此本骨架采用：

- 根级 `AGENTS.md` 只做总入口
- 未来真实业务目录再增加局部 `AGENTS.md`
- 避免把所有规则堆进一个超长文件

### 3. 技能目录使用 `.agents/skills`

Codex 官方文档说明，仓库级技能会从当前目录到仓库根逐层扫描 `.agents/skills`。

因此本骨架把仓库级技能放在：

- `.agents/skills/repo-radar/`
- `.agents/skills/execution-plan/`
- `.agents/skills/repo-indexer/`

并且刻意保持极简，只保留少数对大仓库长期收益高、且噪音可控的技能。

### 4. MCP 通过 `config.toml` 管理

官方说明中，MCP 可以配置在用户级 `~/.codex/config.toml`，也可以配置在项目级 `.codex/config.toml`。

因此本骨架只预置一个项目级 MCP：

- `openaiDeveloperDocs`

原因：它对 Codex 自身能力、官方规范、配置边界的查询价值高，又不会强行把项目绑定到浏览器、设计稿、第三方平台等具体场景。

### 5. 规则文件能力当前不默认落库

官方说明中，规则文件可放在 `.codex/rules/*.rules`，用于约束离开沙箱后的命令行为。

但当前骨架不再预置默认规则文件。原因是团队常以 `codex --dangerously-bypass-approvals-and-sandbox` 启动，继续在仓库里声明这类护栏会让事实来源与实际行为脱节。

因此当前选择是：

- 不在仓库内默认承诺项目级 shell 审批/沙箱护栏
- 如需命令约束，优先在外层 runner、CI 权限或团队流程中实现
- 未来若团队统一回到受控启动方式，再按真实流程重建 `.codex/rules/*.rules`

