---
name: codegraph
description: Use when CodeGraph MCP or CLI is available and you need low-cost code exploration, symbol lookup, call tracing, impact analysis, or architecture investigation. Do not use for generic shell/file tasks when CodeGraph is not installed or the project is not indexed.
---

# CodeGraph

目标：在已启用 CodeGraph 的仓库里，优先用语义代码图回答“在哪里、怎么流转、谁调用谁、改动影响面”这类问题，减少 `rg`、`find`、`Read` 的探索成本。

## 前置边界

- 本 skill 不负责自动安装 CodeGraph，也不默认改写用户级 agent 配置。
- Codex CLI 的 CodeGraph MCP 配置通常由 `codegraph install --target codex --location global` 写入用户级 `~/.codex/config.toml`；不要把它当作 harness 的项目级模板文件复制。
- 项目索引在 `.codegraph/`，这是本地缓存，不是业务事实来源。不要把索引数据库、日志或机器本地状态沉淀进 `.ch/docs/`。
- CodeGraph 不能替代编译、类型检查、测试、lint 或人工判断；它只提供结构化探索上下文。

## 什么时候用

- 需要理解陌生大仓库、跨模块调用链或架构入口。
- 用户问“X 在哪里定义 / 谁调用 X / X 怎么到 Y / 改 X 会影响什么”。
- 重构前需要 blast radius、调用者、被调用者、相关文件。
- 已确认项目存在 `.codegraph/codegraph.db`，或 MCP 工具 / `codegraph` CLI 可用。

## 什么时候不用

- 只是查看一个已知小文件或做简单文本替换。
- 项目没有初始化 CodeGraph，且用户没有要求启用。
- 需要最新磁盘内容而 CodeGraph 返回了 staleness banner 指定某个文件待同步；此时直接读那些被点名的文件。

## 工作流

1. 先判断可用性：
   - MCP 可用时，优先使用 `codegraph_status`。
   - 只有 CLI 可用时，运行 `codegraph status`。
   - 如果未初始化且用户明确要启用，运行 `codegraph init`；否则说明需要先初始化。
2. 按意图选工具：
   - 找符号：`codegraph_search` / `codegraph query`
   - 建任务上下文：`codegraph_context` / `codegraph context`
   - 追踪 X 到 Y 的流：`codegraph_trace`
   - 找调用者：`codegraph_callers` / `codegraph callers`
   - 找被调用者：`codegraph_callees` / `codegraph callees`
   - 看影响面：`codegraph_impact` / `codegraph impact`
   - 看多个相关符号源码：`codegraph_explore`
   - 看目录结构：`codegraph_files` / `codegraph files`
3. 默认先用 `codegraph_context` 缩小范围，再用一次 `codegraph_explore` 或 `codegraph_trace` 拿关键源码和关系。
4. 只在下面情况落回 `rg` / `Read`：
   - CodeGraph 没覆盖目标语言或文件。
   - 需要确认刚编辑、刚生成、刚合并的具体文件内容。
   - CodeGraph 明确提示某些文件 stale。
   - 需要验证测试、配置、文档、非代码资产等图谱不擅长的内容。
5. 如果通过 CLI 而不是 MCP 使用 CodeGraph，批量编辑或切换分支后先运行 `codegraph sync`，再继续依赖图谱结果。

## 输出要求

- 回答中说明关键结论来自 CodeGraph 结构查询还是来自直接文件读取。
- 做改动前，仍要打开最终会编辑的文件并确认当前内容。
- 做重构或影响面判断时，把 CodeGraph 结果当作优先候选清单，不要把它当作唯一验证结论。
