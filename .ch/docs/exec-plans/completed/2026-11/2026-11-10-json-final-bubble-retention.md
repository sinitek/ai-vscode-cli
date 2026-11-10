# JSON 最终气泡参与限额清理

- 日期：2026-11-10
- 状态：completed
- 负责人：Codex

## 背景与目标

每个标签页气泡上限的永久保护排除解析成 JSON 树的最终气泡，尤其是主任务分派子任务的协议输出；普通文本最终答复与用户消息继续保护。

## 范围与非目标

同步 Webview 候选选择与宿主复核，复用渲染器完整 JSON 对象/数组及单代码围栏判定。保持批次窗口、最终标记、结果筛选、CLI 上下文及活动输出临时保护不变，不做视觉改版。

## 验收标准

- 超限且进入最旧窗口的 JSON 最终气泡可删除，不要求所有 JSON 立即消失。
- 覆盖裸对象、数组、代码围栏、最终文本/结构化标记和 Loop 分派消息。
- 文本最终答复、用户消息、活动输出保留；正文嵌入 JSON、非法 JSON 不误删。
- 宿主真正删除内存与临时存档，全新控制器重开不恢复。

## 影响面与风险

- 代码：共享 JSON 解析、Markdown 渲染、气泡保护、会话清理及相关测试。
- 文档：功能总表、保留设计、设置说明、ontology。
- 风险：前后端判定漂移或误删普通答复。缓解：提取原有解析器复用，覆盖边界与持久化回归；必要时回退本次改动，已删数据不可恢复。

## 验证计划

- `npm run build`，相关 Webview、解析器与会话生命周期单测。
- ontology 校验与单测、`git diff --check`。
- 按本地环境可用性补最小 Chromium 验证，不依赖真实 CLI 或用户私有历史。

## 测试与清单同步

- 单元测试新增/更新：新增共享解析器及运行时注入一致性测试；Webview 覆盖 JSON 最终气泡、主任务分派、结果筛选前清理、窗口外新 JSON 保留、流式完成后撤销临时保护；宿主覆盖真实内存/JSON 删除、缓存和运行索引、重开不恢复、活动 JSON 保护及结束后可删除；更新设置文案静态断言。
- 单元自测结果：`npm run build` 成功；以下 11 文件合计 266/266 项通过：
  `node --test dist/test/shared/jsonContainer.test.js dist/test/webview/chatMarkdown.test.js dist/test/webview/chatBubbleRetention.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/session/sessionLifecycleCoreCoverage.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/hideInstructionBubbles.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/core/chatMessageLimit.test.js dist/test/session/sessionStoreCoreCoverage.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js`。
- 失败处理记录：扩展回归首次发现设置中文文案断言过期（更新为非 JSON 最终答复说明）和新增流式用例缺少初始化 Tab 的夹具问题（先加载面板状态）；修正后重新构建，266 项全部通过。无未解决失败，不涉及范围外缺陷。
- 功能清单与设计、ontology：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/design-docs/chat-bubble-retention.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json` 和设置说明。`search_ontology.py --validate` 通过；ontology 单测 9/9 通过；`git diff --check` 通过。

## 浏览器与本机证据

- 复用 Chromium skill runner，通过实际编译生成的 Webview、marked 与 JSON 树渲染资源，桌面 1280×960、窄屏 420×960 各 8 项断言通过；无浏览器、HTTP 或请求错误。
- 先在默认限额下确认主任务分派最终消息确实渲染成 JSON 树，再降为 1 触发清理，验证裸 JSON、带最终标记 JSON、围栏数组被删除，用户和文本/混合最终答复保留，窗口外新 JSON 不被补删；提高限额并重新加载权威剩余集合后不会复活已删除消息。
- 本机运行命令：`node .tmp/json-final-retention-smoke.cjs`，内部调用 `.agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario <临时场景>`。临时场景与脚本验收后移除，未启动外部 CLI，未接触用户真实会话。仅 VS Code 消息传输/宿主确认使用本地适配器；真实临时 JSON 持久化与新控制器重开由生命周期单测覆盖，浏览器不冒称真实扩展宿主端到端。
- 本地证据：`.tmp/json-final-retention-smoke/{1280,420}/result.json` 与截图、`.tmp/json-final-retention-smoke/summary.json`，构建/回归日志为 `.tmp/json-final-retention-{build,tests,browser,ontology-tests}.log`。这些为忽略目录内临时产物，不是仓库事实来源。
- 未运行：全仓单测与覆盖率门禁、真实 VS Code Extension Host/CLI、Windows/Linux。未发布、未打包、未修改外部 CLI 数据。

## 记忆维护判断

行为变化已落入功能清单、设计和 ontology，无新增跨会话风险或通用排障动作；不重复扩张热区记忆、runbook 或 skill，不写入 ROLLING_SUMMARY.md / EVENT_MEMORY.md。

## 当前结论

Webview 和宿主均排除 JSON 最终气泡的永久保护，解析器由渲染器与宿主共享，已完成构建、相关回归、ontology 校验与双尺寸 Chromium 验证。最旧窗口与活动输出保护保持不变，完成归档。
