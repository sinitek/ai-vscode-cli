# Loop 子任务思考力度上限

- 日期：2026-07-15
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-15
- claim_ttl：本次会话
- handoff_to：
- 类型：feature

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [docs：产品、运行时或审计文档写作](./2026-07-15-docs-loop-subtask-thinking-cap.md)：同源历史任务；文档计划依据本实现的能力和兼容边界编写事实说明；写作不再属于本实现。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景

Loop 模式的子任务继承当前模型思考力度。高于 `xhigh` 的 `max` 与 `ultra` 会造成不必要的子任务成本，因此需要全局可见的上限，并在真正执行时统一生效。

## 目标

在“工具设置 - 全局”提供 Loop 子任务最大思考力度设置，默认 `xhigh`；每个 Loop 子任务以当前已选力度与该上限的较低值运行。

## 范围

- 全局工具设置的存储、面板状态、Webview 设置控件和中英文文案。
- Loop 子任务的思考力度解析与执行参数。
- 此记录仅承担全局设置与Loop执行参数实现；独立测试计划已删除、历史验证证据见删除审计；事实来源写作仍由关联 docs 计划承担。

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

- 代码目录：`src/extension.ts`、`src/loopSubtaskThinking.ts`、`src/toolSettings.ts`、`src/webview/`。
- 产品与运行时文档影响：由关联docs计划记录。
- 配置与脚本：`~/.sinitek_cli/settings.json` 的新增可选字段。

## 风险与缓解

- 风险：将通用或主任务的思考力度错误下调。
- 缓解：仅在 `runLoopRound` 的 `role="subtask"` 派发选项中应用纯函数上限；普通任务和主任务没有覆写字段。

## 验证计划

- 最小相关验证：Loop 力度上限、工具设置消息、面板状态、Webview 脚本。
- 单元自测命令：将相关 TypeScript 测试编译到仓库内临时目录后执行 `node --test`。
- 扩展验证：`npm run build`。

## 测试与清单同步

- 测试开发与原始验证/失败明细见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)，本实现记录仅消费验证证据。
- 产品/运行时/审计文档及功能清单写作见关联[docs计划](./2026-07-15-docs-loop-subtask-thinking-cap.md#范围与非目标)，不属于本实现范围。

## 任务列表

- [x] 使用 CodeGraph 确认全局设置、面板状态和 Loop 子任务执行调用链。
- [x] 实现全局上限设置与 Webview 协议。
- [x] 在Loop子任务执行处应用上限。
- [x] 消费删除审计留存的39/46项与严格类型检查证据，保留完整构建范围外阻断。

## 决策记录

- 2026-07-15：将上限应用在 Loop 子任务的最终运行参数，而不是改写模型级保存值，确保普通任务和 Loop 主任务保持原有选择。
- 2026-07-15：全局配置只允许 `low / medium / high / xhigh`；保存或读取 `max`、`ultra` 均归一为 `xhigh`，而当前模型选择为更低档时保持原值。

## 当前结论

`loopSubtaskMaxThinkingMode` 已作为全局可选字段连通工具设置、PanelState 和 Loop 子任务派发。默认值为 `xhigh`，低档位不被提高，`max` 和 `ultra` 均被截断为 `xhigh`。CodeGraph 已在编辑后同步；未新增热区记忆，因为稳定行为已写入产品和运行时事实来源。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
