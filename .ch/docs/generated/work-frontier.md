# Work Frontier

## Summary

- Generated at: 2026-07-15T08:20:37Z
- Output dir: .ch/docs/generated
- Active plans: 9
- Blocked plans: 0
- Claimed plans: 4

## Now

- `.ch/docs/exec-plans/active/2026-07-14-harness-testing-playwright.md` | 状态=in-progress | owner=Loop 主任务 `msg_1783998484827_4b2d85596667a`; 负责人=协作; claimed_at=2026-07-14T03:18:27Z; claim_ttl=本 Loop 任务完成前；每轮主任务复核时续期; handoff_to=由 Loop 主任务派发的审计归并、实施与独立验收代理
  标题：Harness 单元自测与 Chromium Playwright 能力吸收
  下一步：先补 runner 契约与 scaffold 安装回归测试，再实现最小通用化资源和必要安装改动。；通用化 Skill、scenario 文档、runner 和 metadata，移除所有源项目专属默认。；落实显式可选、隔离、无项目污染的 Playwright/Chromium 获取策略和强制 headless。
  阻塞：| 将浏览器 smoke 设为所有项目强制门禁 | 非 Web 项目成本和失败噪音增加 | 只对 Web/UI/浏览器 runtime 风险条件触发；其他任务记录“不适用”；Playwright 不进入业务项目依赖 | `integrate-tiered-testing-policy`；canonical 规则与模板证据槽复核 |；| 精确 `1.61.1` 在 macOS/Linux/Windows 的 Node/浏览器兼容性未真实验证 | 某些平台无法安装或启动 | 本轮仅作为 exact-semver、隔离默认常量；不自动装系统依赖、不手写 cache；三平台 L2 未跑前保持开放风险 | 下轮独立 Reviewer / 平台验证者；按平台记录 Node/npm/arch/L2 证据 |
  依赖：依赖与配置：不修改 `package.json`、lockfile、业务项目 manifest、历史 sync manifest 或官方 Skills catalog；不新增运行时同步机制。

- `.ch/docs/exec-plans/active/2026-07-15-core-test-coverage.md` | 状态=in-progress | owner=核心测试覆盖率改造; 负责人=Codex
  标题：核心单元测试覆盖率基线
  当前结论：覆盖率工具、统一命令、模块白名单和严格 100% 门禁已建立，但核心功能尚未达到 100%。后续应按上述分批策略补充单测，并先修复或隔离项目级 `commandResolution` 的 HOME 泄漏与配置页 CSS 基线失败，再要求 `npm test` 全绿。
  阻塞：风险：覆盖率命令被无关项目级失败阻塞。缓解：核心测试集显式列出，只运行覆盖核心链路所需的测试；全量失败仍保留在 `npm test` 基线中。；风险：会话和 CLI 模块包含文件系统、子进程和 VS Code 依赖。缓解：后续测试必须延续现有 `vscodeMock`、临时目录和子进程 mock，不得调用真实 CLI 或网络。
  依赖：配置与脚本：`package.json`、`package-lock.json`，新增开发依赖 `c8@^10.1.3`（Node `>=18`）。

- `.ch/docs/exec-plans/active/2026-06-27-loop-main-failure-stop.md` | 状态=in-progress | 负责人=Codex
  标题：Loop 主任务失败终止护栏
  下一步：复现并确认主任务失败后仍可继续派发的状态机缺陷；实现主任务失败上限与恢复阻断修复；更新测试与文档并完成最小验证
  依赖：配置与脚本：无新增配置

- `.ch/docs/exec-plans/active/2026-06-27-official-skills-version-refresh.md` | 状态=in-progress | 负责人=Codex / 人类 / 协作
  标题：官方 skills 版本刷新与最新判断修复
  当前结论：当前已完成本轮刷新、版本字段落库与文档同步。当前支持平台仅为 Claude / Codex / OpenCode；以下 Gemini 内容均为已移除历史 catalog 的审计记录，不代表当前支持目标，也不再对应仓库内置 ZIP 或同步入口。；`media/official_skills_catalog.json` 已刷新到 `2026-06-27T12:34:44Z`；当前支持口径覆盖 Claude 17、Codex 39，历史 Gemini 记录（已移除）当时计数为 40。
  依赖：配置与脚本：

- `.ch/docs/exec-plans/active/2026-06-29-loop-debate-moderator-turn-taking.md` | 状态=in-progress | 负责人=Codex
  标题：Loop 红蓝辩论主持人轮流点名调度
  当前结论：已完成。`debate_multi_agent` 现改为主持人驱动的轮流点名调度：组队阶段指定首批发言者，后续每个发言批次都由主持人用 `nextSpeakerIds` 指定 1-3 位下一批发言者；只有被点名的参与者进入该批次。验证通过：`npm run build`、`node --test dist/test/loopDebate.test.js`。
  依赖：配置与脚本：无新增配置；沿用现有 `npm run build`

## Blocked

- None

## Next

- `.ch/docs/exec-plans/active/2026-07-11-mcp-market-refresh.md` | 状态=draft | owner=Loop main task / rolling subtasks; 负责人=Codex / 人类 / 协作; claimed_at=2026-07-11; claim_ttl=本轮 Loop 任务完成前; handoff_to=下一轮 MCP 市场实现/验证子任务
  标题：MCP 市场全量检测与权威刷新
  当前结论：本计划已完成第 2 轮核心实现，等待主任务复核。已修改 `media/mcp_marketplace.json`、`scripts/validate_mcp_marketplace.js`、`package.json`、`src/test/mcpMarketplaceCatalog.test.ts` 和授权文档入口；最终验证结果以 `round-2-mcp-marketplace-refresh-implementation.md` 为准。主任务复核后可决定是否归档到 `completed/`，或追加联网 smoke/OAuth 真实连接验证。
  阻塞：本计划已完成第 2 轮核心实现，等待主任务复核。已修改 `media/mcp_marketplace.json`、`scripts/validate_mcp_marketplace.js`、`package.json`、`src/test/mcpMarketplaceCatalog.test.ts` 和授权文档入口；最终验证结果以 `round-2-mcp-marketplace-refresh-implementation.md` 为准。主任务复核后可决定是否归档到 `completed/`，或追加联网 smoke/OAuth 真实连接验证。
  依赖：可能涉及配置页打包产物或静态资源目录；配置与脚本：

- `.ch/docs/exec-plans/active/2026-06-04-trace-error-bubble-dedupe.md` | 状态=draft
  标题：Trace Error Bubble Dedupe

- `.ch/docs/exec-plans/active/2026-06-25-loop-group-chat-ui-followups.md` | 状态=draft
  标题：Loop Group Chat UI Follow-ups
