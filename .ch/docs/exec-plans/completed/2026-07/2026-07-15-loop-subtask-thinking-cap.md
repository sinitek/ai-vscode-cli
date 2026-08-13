# Loop 子任务思考力度上限

- 日期：2026-07-15
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-15
- claim_ttl：本次会话
- handoff_to：

## 背景

Loop 模式的子任务继承当前模型思考力度。高于 `xhigh` 的 `max` 与 `ultra` 会造成不必要的子任务成本，因此需要全局可见的上限，并在真正执行时统一生效。

## 目标

在“工具设置 - 全局”提供 Loop 子任务最大思考力度设置，默认 `xhigh`；每个 Loop 子任务以当前已选力度与该上限的较低值运行。

## 范围

- 全局工具设置的存储、面板状态、Webview 设置控件和中英文文案。
- Loop 子任务的思考力度解析与执行参数。
- 纯函数回归测试、设置持久化测试、面板/运行时集成覆盖。
- 产品功能清单与运行时事实来源。

## 非目标

- 不改变普通任务、Loop 主任务或非 Loop 模式的思考力度。
- 不改变模型选择、CLI 配置档案或 OpenCode 动态 variant 语义。

## 验收标准

- [x] 默认最大力度为 `xhigh`；用户更新后保存到 `~/.sinitek_cli/settings.json`。
- [x] 设置为较低值时，Loop 子任务不超过该较低值。
- [x] 当前选择为 `max` 或 `ultra` 时，Loop 子任务实际使用 `xhigh`。
- [x] 工具设置全局区域可查看和更新该配置，中英文文案完整。
- [x] 相关单元测试和严格 TypeScript 检查通过；已运行的完整构建仅被既有删除文件阻断。

## 影响面

- 代码目录：`src/extension.ts`、`src/loopSubtaskThinking.ts`、`src/toolSettings.ts`、`src/webview/`、`src/test/`。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、本计划。
- 配置与脚本：`~/.sinitek_cli/settings.json` 的新增可选字段。

## 风险与缓解

- 风险：将通用或主任务的思考力度错误下调。
- 缓解：仅在 `runLoopRound` 的 `role="subtask"` 派发选项中应用纯函数上限；普通任务和主任务没有覆写字段。

## 验证计划

- 最小相关验证：Loop 力度上限、工具设置消息、面板状态、Webview 脚本。
- 单元自测命令：将相关 TypeScript 测试编译到仓库内临时目录后执行 `node --test`。
- 扩展验证：`npm run build`。

## 测试与清单同步

- 单元测试新增/更新：新增 `loopSubtaskThinking.test.ts`；更新工具设置、面板状态、Webview 脚本输入和设置消息回归测试。
- 单元自测结果：严格 TypeScript 检查通过；`loopSubtaskThinking`、`toolSettings`、`sessionMessageActions`、`finalAnswerPolicy` 共 39 个测试通过。包含 `opencodethinkingintegration` 的生成测试套件中共 46 个 Node 测试通过。
- 失败处理记录：`npm run build` 已执行，但当前工作区删除了已跟踪的 `src/loopSkillGuidance.ts`，旧的 `loopMainFailure` 与 `loopPromptQueue` 测试仍导入该模块，导致 `TS2307`。同一批正在进行的 Loop Skill 删除/重构还留下 `src/loopPromptBuilders.ts` 未定义 `normalizedCompactSkillCatalogSection`，以及 `loopPromptBuilders.test.ts` 仍按旧签名调用的 `TS2554`。未恢复或修改这些用户工作区改动；均在本次改动范围外。
- 功能清单：已新增“子任务思考力度全局上限”条目。
- 相关文档同步：已更新 CLI 运行时参考和插件能力规格。

## 任务列表

- [x] 使用 CodeGraph 确认全局设置、面板状态和 Loop 子任务执行调用链。
- [x] 实现全局上限设置与 Webview 协议。
- [x] 在 Loop 子任务执行处应用上限并补齐测试。
- [x] 同步事实来源文档并完成构建、自测。

## 决策记录

- 2026-07-15：将上限应用在 Loop 子任务的最终运行参数，而不是改写模型级保存值，确保普通任务和 Loop 主任务保持原有选择。
- 2026-07-15：全局配置只允许 `low / medium / high / xhigh`；保存或读取 `max`、`ultra` 均归一为 `xhigh`，而当前模型选择为更低档时保持原值。

## 当前结论

`loopSubtaskMaxThinkingMode` 已作为全局可选字段连通工具设置、PanelState 和 Loop 子任务派发。默认值为 `xhigh`，低档位不被提高，`max` 和 `ultra` 均被截断为 `xhigh`。CodeGraph 已在编辑后同步；未新增热区记忆，因为稳定行为已写入产品和运行时事实来源。
