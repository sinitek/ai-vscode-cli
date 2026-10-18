# Grok 原生上下文自动压缩

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-18
- claim_ttl：本轮任务
- handoff_to：无

## 背景与目标

用户希望 Grok 分组像 Codex 一样支持自动压缩。CodeGraph 定位现有压缩策略后，直接核对当前代码，确认自动触发白名单、手动压缩入口及策略注册均未接入 Grok。本机 Grok 1.0.62 在隔离 GROK_HOME 中声明 `compact` 命令，ACP `session/prompt` 发送 `/compact` 后收到 `_x.ai/session_notification` 的 `auto_compact_completed`，最终返回 `end_turn`。

## 范围与非目标

- 复用现有执行后自动压缩开关、超过 5 分钟条件、3 分钟超时、停止和 Loop 主任务并行机制。
- 在原 Grok 会话上执行原生 `/compact`，要求原生完成事件与成功 stopReason，不将普通 AI 回复当作压缩成功。
- 补齐 Grok 的“常用指令 → 压缩上下文”入口，沿用 Codex 弹窗、运行时禁用、中止、压缩中状态和结束恢复，不新增独立 UI。
- 不修改用户实际配置、模型协议、压缩阈值或其他 CLI 行为；不新增配置 UI。

## 验收标准

- Grok 加入统一自动压缩能力判断，手动压缩同样可用。
- 模型配置表键、思考档、启动参数与正常会话一致，复用已映射会话；恢复失败不压缩新空会话、不替换原映射。
- 完成、失败、取消、未确认及异会话通知有回归覆盖；自动模式不新增回复或完成耗时气泡。
- 构建、相关单测及隔离本机 CLI 验证通过，记录真实结果与限制。

## 影响面与风险

- 代码：`src/contextCompactionRunner.ts`、`src/extension.ts`、`src/interactive/grokRunner.ts`、`src/interactive/grokAppServerProtocol.ts`、`src/i18n.ts` 与相关测试。
- 文档：功能清单、能力规格、CLI 运行时参考、Grok runbook 与 ontology。
- 风险：旧 CLI 不发原生确认事件、恢复失败回退新会话、取消后迟到事件。通过严格结果校验、保留原会话映射、现有 runId 生命周期及回归测试缓解。

## 验证计划

- `npm run build`
- `node --test dist/test/core/contextCompactionRunner.test.js dist/test/interactive/grokRunner.test.js dist/test/interactive/grokAppServerProtocol.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/loop/loopMainAutoCompact.test.js`
- 隔离 `GROK_HOME` 的真实 Grok + `gpt-6.1-sol` 验证，不打印连接与凭据，结束后清理。
- ontology 验证与测试、`git diff --check`；因补齐指令入口，补充真实 Webview HTML + 内存 IPC 的 Chromium 交互 smoke。

## 任务列表

Tasklist:
- [completed] 接入原生压缩与回归测试
- [completed] 核对补齐手动压缩交互
- [completed] 完成验证并同步文档

## 决策与当前结论

- 2026-10-18：使用本机已确认的原生 slash command，不生成插件侧摘要、不新建替代会话。空会话探针收到完成事件 `tokens_before=1339`、`tokens_after=1339`，仅证明协议可用，不作为上下文缩减验收。
- 2026-10-18：用户补充强调 Grok 指令入口必须与 Codex 相同；核对到 Webview 的两处 `syncCommonCommandOptions` 均遗漏 Grok，按现有交互补齐。
- 2026-10-18：真实浏览器发现共享 SVG 入口不支持 `.click()`，补充键盘事件回退与回归；指令说明补上 Grok，标题与说明改为上下排列，避免原左右挤压换行。沿用现有主题与弹窗。
- 记忆召回 focus 为 `grok codex automatic context compaction 自动压缩`，anchor 为空；生成包 baseline-fallback，采用当前代码与运行时探针为事实来源。

## 验证结果与文档同步

- `npm run build`：通过；`git diff --check`：通过。
- 相关单测：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/core/contextCompactionRunner.test.js dist/test/interactive/grokRunner.test.js dist/test/interactive/grokAppServerProtocol.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/loop/loopMainAutoCompact.test.js`，154/154 通过。覆盖原生完成、失败、取消、异会话、缺少确认、恢复失败不新建、超时释放与迟到完成不改映射、菜单开关、压缩中、中止和 SVG 键盘操作。
- `npm run test:page`：246/246 通过。
- 全量先执行 `npm run test:unit`，最终以当前构建再次执行 `node scripts/run_unit_tests.js`：1616 项，1612 通过、4 项范围外旧断言失败。`cliCommandRepair.test.ts` 的 3 项仍按三种 CLI 断言，遗漏 Grok；`grokCliEnum.test.ts` 全 HTML 中 Grok option 次数断言为 1、实际为 2。已独立复现 4 项失败，并核对相关源码及测试相对 HEAD 无本轮改动，不扩大修复。
- 构建/测试曾并行清理共享 `dist`，出现短暂 `MODULE_NOT_FOUND`；构建结束后顺序重跑相关 154 项与页面组全部通过，归类为验证调度问题而非实现缺陷。
- 本机真实验证：Grok 1.0.62 + `gpt-6.1-sol`，隔离 `GROK_HOME` 与工作目录，只复用所选模型已有连接；五轮对话后释放进程，再冷恢复同一 ACP ID 执行原生 `/compact`，31432 → 10825 token，成功续聊并准确回复压缩前口令。短会话原生完成但 token 不下降也已核对。最初夹具使用 `off` 被服务拒绝（模型不支持 `none`），改为该模型支持的 `low` 后通过；没有修改正式用户配置或自动推断模型协议。
- Chromium：使用已有 Chrome，真实 Webview HTML/运行脚本/样式 + 内存 IPC，桌面 1100×850 与窄屏 430×850；Grok 菜单、压缩中、中止恢复、正常结束恢复共 4 个结构化场景通过，另以 Codex 菜单场景对照通过；无 browser/http/request 错误。已检查桌面菜单、窄屏运行态和完成态截图，标题与说明采用上下布局，无相互重叠。
- 浏览器夹具首次拼接脚本未转义 `</script>`，修正为复用生产 `neutralizeInlineScriptEndTags`；停止后操作等待异步 IPC 状态恢复再重开菜单，均为夹具修正。真实 SVG 键盘 `.click()` 异常则已修复产品代码并补回归。
- Impeccable 机械检测执行一次，结果 `[]`。
- ontology JSON 与新增规则所有 source refs 有效；全域 `--validate` 仍有 15 处既有失效文档引用，ontology 单测 8/9，唯一失败为该完整性检查。本轮新增规则未引入失效引用，不扩大修复。
- 已同步功能清单、能力规格、CLI 运行时参考、Grok runbook（包含 SVG 键盘避坑）和 ontology。无新架构边界，不改 `ARCHITECTURE.md`；当前规则与排障经验已进入 runbook/规格，不另写热区摘要或 `EVENT_MEMORY.md`。
- 日志：`/tmp/sinitek-grok-compact-{build,related,page,unit-final,baseline-failures,live,ontology,ontology-tests,design}.log`。浏览器证据：`/tmp/sinitek-grok-compact-ui-{menu,running,stopped,complete}/result.json` 与 `success.png`；Codex 对照为 `/tmp/sinitek-codex-compact-ui-reference/`。
- 真实 CLI 临时配置、会话和工作目录已清理；验收后停止 19393 临时服务器，删除临时脚本/场景，保留日志与截图证据。没有打包安装扩展或重载 VS Code；浏览器 IPC 为夹具，不宣称完整 Extension Development Host 验收。
