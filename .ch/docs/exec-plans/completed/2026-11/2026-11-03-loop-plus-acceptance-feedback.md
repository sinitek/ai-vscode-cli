# Loop+ 群聊验收结果去重与格式调整

- 日期：2026-11-03
- 状态：completed
- 负责人：Codex

## 背景与目标

本机只读核对用户截图对应的群聊记录：同一子任务只有一个已确认 attempt，但 `accept` 后的 `completed` 收尾再次写入默认及附加审查表格。修复事件验收与父任务收尾的展示边界，表格上方明确子任务名和整体验收结果。

## 范围与非目标

- 范围：验收结果生成器、编排写入边界、相关回归测试、功能清单和业务本体。
- 非目标：不取消主任务收尾检查，不改调度状态、验收限额或协议，不改写用户已有群聊文件。

## 验收标准

- 同一批完成事件经 `accept` 确认后，无新事件的 `completed` 收尾不再追加相似表格。
- `completed` 直接确认新事件仍保留本次子任务验收结果；无确认事件的收尾或直接完成只总结，不展示验收表格。
- 表格上方显示真实子任务名与整体验收结果；表格只保留默认及附加审查明细，不再出现“验收事件 1”行。
- 同批多任务、失败后修复的新 attempt、恢复后收尾均不误抑制真实新验收。

## 影响面与风险

- 代码：`src/loopPlusAcceptancePlan.ts`、`src/extensionHost/loopPlusOrchestration.ts` 及相关测试。
- 文档：功能清单、Loop+ 调度设计、ontology。
- 风险：误隐藏新事件；仅以当前确认事件 ID 决定是否展示子任务验收表格，保持协议及完成条件不变。
- 回滚：恢复结果生成器和写入边界，不迁移用户数据。

## 验证计划

- 最小相关：先构建，再运行验收格式、编排、调度、群聊及提示词单测。
- 页面验证：用真实群聊渲染器生成合成夹具，headless Chromium 检查标题、表格行、单表及窄屏展示并截图；不调用付费模型或修改用户任务。
- 结构验证：ontology validate、ontology 单测、空白检查。

## 测试与清单同步

- 单元测试新增/更新：覆盖 accept 后 completed 只写一张表、无确认事件时有/无附加方案均只总结、completed 直接确认一批事件显示所有任务名、恢复及失败后修复的新 attempt、批量通过/失败、特殊任务名转义、实际 Markdown 表格渲染与整体结果前置。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopGroupChat.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/webview/chatMarkdown.test.js` 全部 194 项通过。
- 全量验证：`node scripts/run_unit_tests.js` 共 2579 项，2575 通过、3 跳过、1 既有范围外失败。`runPromptHistoryWebview` 的 `sets loading animation state on historyButton and removes it after modal render` 报 `vscode is not defined`；单独执行 `node --test dist/test/webview/runPromptHistoryWebview.test.js` 同样复现，相关测试与 `src/webview/viewContentScript/historyPanels.ts` 均与 HEAD 一致，不扩大修复范围。
- 失败处理记录：初次构建发现新测试的可选 `reviewEventIds` 直接取长度，修正类型断言；恢复夹具需明确 `resumeRequested` 才会唤醒无待验收项的主任务。全量发现旧 Markdown 测试仍要求“验收事件 1”首行，属于本次格式变化的过期断言，更新后通过。浏览器夹具最初漏设 scheduler 必填 `maxConcurrency`，修正后全部通过。
- 功能清单和 ontology：已同步功能总表、能力规格、Loop+ 调度设计与既有验收方案规则；`--validate` 通过，ontology 单测 9 项通过。
- 静态验证：`npm run validate:whitespace`、`git diff --check` 通过；Impeccable detector 无发现。
- 本机页面验证：复用生产 `buildLoopGroupChatPanelStateWithDeps`、`buildLoopGroupChatPanelHtml` 与 Markdown 渲染器，使用模拟 VS Code 消息桥和合成任务，不写用户运行数据。通过 `chromium-playwright-smoke` runner 验证 1280×1000、640×1100 和批量含失败项三种场景；断言单表、10 行明细、任务名/整体验收结果在表外、无“验收事件”首行、无重叠。三次结果的 browserErrors/httpErrors/requestFailures 全为空。
- 页面证据：`.tmp/loop-plus-acceptance-smoke/{desktop,narrow,batch}/result.json` 与 `success.png`；裁剪预览 `.tmp/loop-plus-acceptance-smoke/acceptance-preview.png`。任务专用服务器和场景文件验证后清理，证据保留在 ignored 目录。
- 验证边界：未启动付费 CLI 或 Extension Development Host；真实 CLI 任务只读核对持久化群聊和 scheduler，验证的是已有记录的根因与生产渲染器，不声称已在已安装插件中部署。没有改写历史 transcript。
- 记忆：稳定边界优先写入调度设计，不自动写入滚动摘要。

## 当前结论

根因已从 CodeGraph 调用关系、当前源码及本机持久化记录交叉确认。反馈入口只对当前决策明确确认的完成事件写入验收气泡；无确认事件的收尾只总结。标题和整体验收结果已移到表格上方，默认与附加检查明细保持不变。相关回归及三个浏览器场景通过，无未决问题；全量既有范围外失败已单独记录。

## 决策记录

- 2026-11-03：用户补充“收尾只需要总结，无需展示验收表格”。无确认事件的完成一律不生成验收气泡，包括没有派发子任务的直接完成；直接确认新事件属于子任务验收，仍保留对应明细。
