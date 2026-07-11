# OpenCode MCP 配置文件管理

- 日期：2026-07-11
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-11
- claim_ttl：本次任务完成前
- handoff_to：

## 背景

配置中心当前通过 `opencode mcp add` 安装 MCP，并尝试通过不存在的
`opencode mcp remove` 卸载。OpenCode 官方支持在全局
`${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 的顶层 `mcp`
节点直接配置 MCP，因此安装和卸载应改为配置文件管理。

## 目标

使用 OpenCode 官方全局配置文件完成市场 MCP 的安装、覆盖和卸载，同时保留
其他顶层配置、已有 MCP 和 CLI 列表健康检测行为。

## 范围

- OpenCode 全局配置路径解析，支持 `XDG_CONFIG_HOME`。
- 市场 local/remote MCP 转换为 OpenCode 官方配置结构。
- 安装时合并 `mcp[id]`，卸载时删除 `mcp[id]`。
- JSON/JSONC 输入读取、原子写入、错误保护和单元测试。
- 同步运行时事实、产品能力清单和避坑文档。

## 非目标

- 不改变 Claude、Codex MCP 的安装卸载方式。
- 不改变配置中心维护的 `~/.opencode/config.json` 模型档案。
- 不新增 OAuth MCP 凭据管理。
- 不改变 `opencode mcp list` 健康检测解析。

## 验收标准

- [x] OpenCode local MCP 写入 `type=local`、命令数组、环境变量和启用状态。
- [x] OpenCode remote MCP 写入 `type=remote`、URL、headers 和启用状态。
- [x] 安装保留未知顶层字段、其他 MCP，并覆盖同 id 条目。
- [x] 卸载只删除目标 `mcp[id]`，目标不存在时幂等成功。
- [x] 默认路径与自定义 `XDG_CONFIG_HOME` 均有单元测试。
- [x] JSONC 配置可读取；无效配置不会被覆盖。
- [x] 最小相关单测和 `npm run build` 通过。

## 影响面

- 代码目录：`src/config/`
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：OpenCode 官方全局 `opencode.json`

## 风险与缓解

- 风险：JSONC 修改后丢失注释或格式。
- 缓解：无新增解析依赖时将有效 JSONC 规范化为严格 JSON；写入前完整解析，
  无效内容直接报错且不覆盖；使用同目录临时文件原子替换。
- 风险：误改配置中心的 OpenCode 模型档案。
- 缓解：全局 MCP 路径解析独立于 `configService` 的 `~/.opencode/config.json`。
- 风险：覆盖其他 MCP 或未知配置字段。
- 缓解：只克隆并修改顶层 `mcp` 目标键，测试字段保留。

## 验证计划

- 最小相关验证：OpenCode MCP 配置模块单元测试。
- 单元自测命令：`npm run build`；
  `node --test dist/test/openCodeMcpConfig.test.js dist/test/configMcpService.test.js dist/test/opencodeMcpHealth.test.js`
- 扩展验证：检查构建产物与 git diff，确认无无关文件变化。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/openCodeMcpConfig.test.ts`，覆盖默认/XDG
  路径、JSONC、local/remote、覆盖、卸载幂等、无效配置保护和字段保留。
- 单元自测结果：`npm run build` 通过；
  `node --test dist/test/openCodeMcpConfig.test.js dist/test/configMcpService.test.js dist/test/opencodeMcpHealth.test.js`
  共 19 项通过；`git diff --check` 通过。
- 失败处理记录：无。
- 功能清单：已新增“配置 / MCP”能力条目。
- 相关文档同步：已更新 CLI runtime reference、产品能力、兼容入口与 PITFALLS。

## 任务列表

- [x] 核对官方配置路径、schema 与现有实现。
- [x] 实现 OpenCode MCP 配置映射和原子文件更新。
- [x] 接入安装卸载服务并补单元测试。
- [x] 同步事实文档与产品清单。
- [x] 执行测试、构建并归档计划。

## 决策记录

- 2026-07-11：OpenCode MCP 管理使用官方 XDG 全局配置文件，不复用插件配置中心的
  `~/.opencode/config.json`。
- 2026-07-11：保留 `opencode mcp list` 作为安装状态和连接健康检测入口。

## 当前结论

OpenCode MCP 安装与卸载已切换为官方 XDG 全局配置文件管理；CLI 仅保留
`mcp list --pure` 安装状态与连接健康检测。构建、19 项相关测试和补丁格式检查均通过。
