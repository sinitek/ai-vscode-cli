# Open Blockers

- Output dir: .ch/docs/generated

## Current blockers

## Harness 单元自测与 Chromium Playwright 能力吸收

- Plan: `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md`
- Status: in-progress
- Owner: Loop 主任务 `msg_1783998484827_4b2d85596667a`
- Responsible: 协作
- Blocker: | 将浏览器 smoke 设为所有项目强制门禁 | 非 Web 项目成本和失败噪音增加 | 只对 Web/UI/浏览器 runtime 风险条件触发；其他任务记录“不适用”；Playwright 不进入业务项目依赖 | `integrate-tiered-testing-policy`；canonical 规则与模板证据槽复核 |
- Blocker: | 精确 `1.61.1` 在 macOS/Linux/Windows 的 Node/浏览器兼容性未真实验证 | 某些平台无法安装或启动 | 本轮仅作为 exact-semver、隔离默认常量；不自动装系统依赖、不手写 cache；三平台 L2 未跑前保持开放风险 | 下轮独立 Reviewer / 平台验证者；按平台记录 Node/npm/arch/L2 证据 |
- Dependency: 依赖与配置：不修改 `package.json`、lockfile、业务项目 manifest、历史 sync manifest 或官方 Skills catalog；不新增运行时同步机制。
- Handoff to: 由 Loop 主任务派发的审计归并、实施与独立验收代理

## 核心单元测试覆盖率基线

- Plan: `.ch/docs/exec-plans/active/2026-07-15-core-test-coverage.md`
- Status: in-progress
- Owner: 核心测试覆盖率改造
- Responsible: Codex
- Blocker: 风险：覆盖率命令被无关项目级失败阻塞。缓解：核心测试集显式列出，只运行覆盖核心链路所需的测试；全量失败仍保留在 `npm test` 基线中。
- Blocker: 风险：会话和 CLI 模块包含文件系统、子进程和 VS Code 依赖。缓解：后续测试必须延续现有 `vscodeMock`、临时目录和子进程 mock，不得调用真实 CLI 或网络。
- Dependency: 配置与脚本：`package.json`、`package-lock.json`，新增开发依赖 `c8@^10.1.3`（Node `>=18`）。

## MCP 市场全量检测与权威刷新

- Plan: `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md`
- Status: draft
- Owner: Loop main task / rolling subtasks
- Responsible: Codex / 人类 / 协作
- Blocker: 本计划已完成第 2 轮核心实现，等待主任务复核。已修改 `media/mcp_marketplace.json`、`scripts/validate_mcp_marketplace.js`、`package.json`、`src/test/mcpMarketplaceCatalog.test.ts` 和授权文档入口；最终验证结果以 `round-2-mcp-marketplace-refresh-implementation.md` 为准。主任务复核后可决定是否归档到 `completed/`，或追加联网 smoke/OAuth 真实连接验证。
- Dependency: 可能涉及配置页打包产物或静态资源目录
- Dependency: 配置与脚本：
- Dependency: 本计划已完成第 2 轮核心实现，等待主任务复核。已修改 `media/mcp_marketplace.json`、`scripts/validate_mcp_marketplace.js`、`package.json`、`src/test/mcpMarketplaceCatalog.test.ts` 和授权文档入口；最终验证结果以 `round-2-mcp-marketplace-refresh-implementation.md` 为准。主任务复核后可决定是否归档到 `completed/`，或追加联网 smoke/OAuth 真实连接验证。
- Handoff to: 下一轮 MCP 市场实现/验证子任务
