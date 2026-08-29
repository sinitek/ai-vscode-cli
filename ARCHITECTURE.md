# 项目架构说明

本仓库是一个 **VS Code 插件单仓**，用于在编辑器内统一接入本地 CLI（Codex / Claude / OpenCode），并提供聊天面板、配置中心、会话管理与本地状态持久化能力。

更详细的运行时设计见：

- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## 1. 当前实际结构

```text
.
├── AGENTS.md
├── ARCHITECTURE.md
├── README.md
├── package.json
├── src/
│   ├── extension.ts          # 扩展入口、命令注册、状态编排
│   ├── extensionHost/        # 扩展宿主侧运行时 host 与组合根拆分
│   ├── cli/                  # CLI 设置读取、命令解析、进程执行
│   ├── interactive/          # Codex / Claude 交互 Runner 与会话映射
│   ├── webview/              # 聊天面板、配置中心、前后端协议
│   ├── config/               # 本地配置档案、Skills、MCP 管理
│   ├── graph/                # Graph 运行图、调度、边语义与节点控制
│   ├── shared/               # 跨 CLI/config/Graph 复用的纯工具
│   ├── trace/                # trace/tool 输出格式化
│   ├── loopDebate.ts         # Loop 辩论路径、记录与共识校验纯函数
│   ├── loopSubtaskExecutionRoot.ts # Loop 子任务规则隔离执行根
│   ├── loopTaskStore.ts      # Loop 任务记录持久化
│   ├── i18n.ts               # 国际化
│   ├── logger.ts             # 日志
│   └── errorDisplay.ts       # 错误展示
├── media/
│   ├── config/assets/        # 配置中心静态资源
│   ├── official_skills_catalog.json
│   └── mcp_marketplace.json
├── docs/                     # 兼容入口文档，详细内容已迁移到 .ch/docs/
└── .ch/docs/                 # 事实来源文档体系
```

## 2. 分层边界

### 2.1 推荐依赖方向

```text
webview UI
    ↓
extension.ts 组合根 / extensionHost 运行时 host
    ↓
cli / interactive / config 服务层
    ↓
本地文件系统 / 本地 CLI / 外部 SDK
```

### 2.2 各层职责

#### Webview/UI 层

- 位于 `src/webview/`
- 负责渲染聊天面板、配置中心、输入交互和消息协议
- 不直接访问文件系统，不直接执行 CLI

#### 扩展编排层

- 以 `src/extension.ts` 为核心
- 负责命令注册、状态管理、消息分发、会话与标签页编排
- 不应承载具体 CLI 协议细节和配置文件读写实现
- 当前 `src/extension.ts` 是组合根，保留 activate/deactivate、命令与视图注册、Webview 消息路由、Graph/Loop/session/model/config host 装配和跨运行时生命周期适配
- 本次运行时抽取后，`src/extension.ts` 为 4993 行；3000 行以下是期望指标而非硬性边界，后续继续拆分必须按职责内聚推进

#### 扩展运行时 Host 层

- 位于 `src/extensionHost/`
- `promptOneShotRuntime.ts` 承载 OpenCode one-shot 运行、JSONL stream 解析、hidden retry、fresh-session recovery、任务列表、子代理进度消费、长期记忆触发和自动压缩触发；当前 1224 行
- `promptParallelRuntime.ts` 承载 OpenCode parallel tab 运行、tab 定向 JSONL stream 映射、hidden retry、fresh-session recovery、任务列表、子代理进度消费、长期记忆触发和自动压缩触发；当前 1181 行。parallel 终态 `TaskRunRecord` 通过统一 helper 写入，`end` / `error` / `stopped` 均保留 Loop 与 Graph 追踪字段
- `promptInteractiveRuntime.ts` 承载 Codex / Claude interactive turn、runner 事件映射、session adoption、停止收口、消息持久化、subagent progress、hidden retry 和 final answer 判定；当前 1387 行
- `loopOrchestration.ts` 承载 Loop 主从与红蓝辩论编排 host，依赖注入类型必须显式、可搜索，不使用宽泛 `Record<string, any>` 作为事实边界；当前 3043 行
- `openCodeSubagentRuntime.ts` 承载 OpenCode 子代理 server attach / managed startup / ready wait / Basic auth env override / unavailable fallback 和 disabled monitor；当前 201 行
- `promptExecutionShared.ts` 只保存提示运行 host 共享的窄类型；当前 59 行
- 依赖方向固定为 `extension.ts` 导入 host 并注入显式回调，host 可以依赖 `cli/`、`interactive/`、`promptRunState` 等服务与类型，但不能反向依赖 `extension.ts`

#### CLI / Interactive / Config 服务层

- `src/cli/`：一次性执行与命令解析；配置化 CLI command string 的拆分边界在 `src/cli/commandResolution.ts`，`commandRunner.ts`、MCP 命令调用等路径只复用该结果
- `src/interactive/`：会话型运行与底层续接 ID 映射
- `src/config/`：外部 CLI 配置、Skills、MCP、本地配置档案管理；用户级配置路径由 `src/config/configPaths.ts` 集中维护，legacy `gemini` 配置平台仅兼容归一到 `opencode`
- `src/shared/`：跨服务层复用、无 VS Code 依赖的纯工具；当前包含 strict/jsonc JSON object 解析等后端共用逻辑
- 这一层负责和本地 CLI、SDK、home 目录配置打交道，但不负责 UI 渲染

#### Graph 编排层

- 位于 `src/graph/`
- 负责 Graph run 类型、store、communications、events、scheduler、edge semantics、prompt builders、node lifecycle 和 run control
- `src/graph/graphEdgeSemantics.ts` 是 active structural/blocking edge 与 rework trigger edge 的共享语义边界，scheduler 和 prompt topology 必须复用它，避免节点上下游、review scope 与调度 gate 口径漂移

#### 基础本地资源层

- 包括 `~/.sinitek_cli/`、`~/.codex/`、`~/.claude/`、`~/.opencode/` 和 OpenCode 官方全局 MCP 配置 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json`；`~/.gemini/` 仅作历史迁移参考
- Loop 模式的任务记录位于 `~/.sinitek_cli/loop-tasks/`；主子任务沟通和辩论 artifact 位于 `~/.sinitek_cli/loop-communications/`
- Graph 模式的 run store、`graph.json`、`events.jsonl` 和节点 communication artifact 位于 `~/.sinitek_cli/graph-*` 相关目录；新 Graph run 默认 direct 执行，不创建 worktree/checkpoint
- 首次枚举 Loop 任务时，`src/loopLegacyMigration.ts` 与 `src/loopTaskStore.ts` 会把旧 Lobster 任务存储和通信目录迁入上述 Loop 路径；新写入不再使用旧命名，冲突 artifact 以 `.pre-loop-migration` 后缀保留
- 属于运行时依赖或本地状态，不属于 UI 和业务编排层

#### Loop 子任务执行隔离

- Loop 主任务保持真实工作区作为 cwd，按各 CLI 的默认机制读取项目规则。
- `src/loopSubtaskExecutionRoot.ts` 为每个 Loop 子任务创建临时根目录，只链接可工作内容，隐藏根 `AGENTS.md`、`CLAUDE.md`、`.agents`、`.claude`、`.codex`；写入仍通过链接回到真实工作区，任务结束后立即删除临时根。
- 子任务调用还叠加 CLI 级隔离：Codex 使用 `--ignore-rules`，Claude SDK 使用空 `settingSources`，OpenCode 使用 `--pure`。子任务只遵循主任务传入的自包含授权、沟通文件与最小必要验证要求。
- 不再分发、加载或注入 Loop Workflow Skill 快照，也没有对应的工具设置开关。

## 3. 扩展规则

### 新增一个能力时怎么放

1. 只是设置读取、命令拼装、执行捕获：放 `src/cli/`
2. 需要会话复用、thread/session 恢复：放 `src/interactive/`
3. 需要管理外部 CLI 配置、Skills、MCP：放 `src/config/`
4. 只是面板交互、展示或协议字段：放 `src/webview/`
5. 需要打通整条链路时，在 `src/extension.ts` 接线；若是提示运行的连续状态机，优先放到 `src/extensionHost/*Runtime.ts` 并由 `extension.ts` 注入依赖
6. 只是 Loop 辩论记录、路径或共识校验纯函数：放 `src/loopDebate.ts`，不要反向依赖 VS Code API 或 Webview
7. 只是 Graph 边/调度/节点控制语义：放 `src/graph/` 内的专门模块；跨 scheduler 和 prompt builder 的边语义优先集中到 `graphEdgeSemantics.ts`

### 新增文档时怎么放

- 运行事实、手册：放 `.ch/docs/runbooks/` 或 `.ch/docs/references/`
- 设计和模块边界：放 `.ch/docs/design-docs/`
- 用户可见能力与范围：放 `.ch/docs/product-specs/`
- 多阶段任务：放 `.ch/docs/exec-plans/`

## 4. 明确禁止

- 在 Webview 中直接拼接文件系统或 CLI 调用逻辑
- 把 Codex / Claude / OpenCode 的协议分支散落在多个 UI 文件中
- 在多个模块重复维护同一份本地状态格式
- 将配置中心实现和聊天面板 DOM 逻辑直接耦合
- 在未批准时改动技术栈或替换核心依赖

## 5. 维护要求

出现下面情况时，必须同步更新本文件或对应 `.ch/docs/` 文档：

- 目录分层发生变化
- 新增独立运行面板或新的执行链路
- CLI 接入方式发生变化
- 本地状态目录、配置管理方式、文档事实来源发生变化

保持这份文档短、准、可导航；详细知识沉淀到 `.ch/docs/` 对应主题文档。
