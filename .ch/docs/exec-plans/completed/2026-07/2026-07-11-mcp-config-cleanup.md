# MCP 配置清理与市场清单刷新

- 日期：2026-07-11
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-11
- claim_ttl：1d
- handoff_to：

## 背景

用户反馈携宁 CLI 全局 MCP 健康检查大量超时，需要清理不可用项，并按权威来源刷新可用 MCP 配置。

## 目标

- 审计本机 Codex / Claude / Gemini / OpenCode 的全局 MCP 生效配置。
- 删除或修复已经不可用的 MCP 配置。
- 更新仓库内 MCP 市场清单中的过期包名，避免后续安装旧包。

## 范围

- 本机全局 MCP 配置健康检查。
- `media/mcp_marketplace.json` 内已确认失效的 MCP 包名和远程地址。
- 相关排障文档。

## 非目标

- 不改动模型供应商、token、CLI 主配置档案。
- 不替换项目技术栈。
- 不安装需要用户私有凭证的第三方 MCP。

## 验收标准

- [x] 当前本机 MCP 健康检查无失败项。
- [x] 市场清单 JSON 可解析，失效 npm 包不再出现在清单中。
- [x] 相关文档记录本次发现的 npx 缓存假失败问题。
- [x] `npm run build` 通过或记录明确失败原因。

## 影响面

- 代码目录：无业务代码变更。
- 文档目录：`.ch/docs/runbooks/PITFALLS.md`
- 配置与脚本：`media/mcp_marketplace.json`

## 风险与缓解

- 风险：把临时网络或缓存故障误判为 MCP 已失效。
- 缓解：先跑 CLI 健康检查、npm/PyPI/官方 Registry 查询和本机缓存清理复测。

## 验证计划

- 最小相关验证：`node -e "JSON.parse(...)"` 校验 MCP 市场清单。
- 单元自测命令：`npm run build`
- 扩展验证：`codex mcp list`、`claude mcp list`、`opencode mcp list`

## 测试与清单同步

- 单元测试新增/更新：暂不新增，当前改动为静态清单和文档。
- 单元自测结果：`npm run build` 通过。
- 失败处理记录：第一次旧包名扫描误把 `@modelcontextprotocol/server-github` 前缀匹配成 `server-git`，已改为精确 args 匹配并通过；Claude 健康检查中途出现 npx 型 MCP 临时报失败，独立初始化探针与最终 `claude mcp list` 均确认恢复。
- 功能清单：MCP 市场能力口径不变，具体清单数据更新。
- 相关文档同步：待补充 PITFALLS。

## 任务列表

- [x] 定位全局 MCP 配置来源。
- [x] 跑 Codex / Claude / OpenCode MCP 健康检查。
- [x] 清理 Context7 损坏的 npx 缓存并复测。
- [x] 用官方 Registry、npm、PyPI 查询失效市场条目替代配置。
- [x] 更新 MCP 市场清单。
- [x] 更新排障文档。
- [x] 运行 JSON 校验、健康检查和 build。

## 决策记录

- 2026-07-11：Claude `context7` 失败由 `~/.npm/_npx/.../@upstash/context7-mcp` 缓存目录 ENOTEMPTY 导致，删除损坏 npx 缓存后健康检查恢复，不删除 Context7 配置。
- 2026-07-11：Codex / Gemini / OpenCode 当前实际生效 MCP 只保留 `pencil`，不需要删除。
- 2026-07-11：市场清单中不存在的旧 `@modelcontextprotocol/server-*` 包改为官方 Registry、供应商官方远程 MCP 或当前可安装包。

## 当前结论

本机全局健康检查根因已定位为 npx 缓存损坏，清理后最终健康检查全绿。仓库 MCP 市场清单已替换已下线旧包名，并完成 JSON、旧包名扫描、全局 MCP 健康检查和 build 验证。
