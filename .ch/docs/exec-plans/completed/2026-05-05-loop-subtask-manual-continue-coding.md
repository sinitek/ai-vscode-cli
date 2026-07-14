# 龙虾子任务手动继续强制编码模式

- 日期：2026-05-05
- 状态：completed
- 负责人：Codex

## 背景

龙虾子任务如果中断，用户需要在该子任务标签中手动继续。但当前发送路径会携带全局交互模式；如果当前模式仍是 `lobster`，手动继续可能启动新的龙虾任务，形成嵌套龙虾编排。

## 目标

当目标 conversation tab 已经是龙虾子任务标签时，用户手动发送的继续提示必须按普通 coding 任务执行，不允许再次进入龙虾模式。

## 范围

- 在扩展发送入口识别龙虾子任务标签。
- 对龙虾子任务标签中的 `interactiveMode=lobster` 发送请求强制降级为 `coding`。
- 同步事实来源文档。

## 非目标

- 不改变主任务标签的龙虾模式行为。
- 不改变普通标签里手动选择龙虾模式的行为。
- 不实现子任务自动恢复。

## 验收标准

- [x] 子任务标签中发送提示时不会调用 `runLobsterPrompt`。
- [x] 子任务标签中发送提示会走普通 `runPrompt`，即 coding 任务链路。
- [x] 主任务/普通标签仍可启动龙虾任务。
- [x] 事实来源文档同步。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`

## 风险与缓解

- 风险：误判普通标签为子任务标签。
- 缓解：只根据消息中的 `taskRole=subtask` 且带 `lobsterTaskId/lobsterSubtaskId` 判定。

## 验证计划

- 最小相关验证：TypeScript 编译。
- 扩展验证：人工中断龙虾子任务后在子任务标签发送“继续”，确认未创建新的龙虾任务记录。

## 测试与清单同步

- 单元测试：本次逻辑依赖扩展内会话状态，先以编译验证为主。
- 功能清单：同步龙虾模式说明。
- 相关文档同步：同步能力规格与 CLI 运行参考。

## 任务列表

- [x] 定位发送入口与龙虾子任务标签识别字段。
- [x] 实现扩展侧强制 coding 续跑。
- [x] 同步事实来源文档。
- [x] 运行构建验证。
- [x] 完成后归档执行计划。

## 决策记录

- 2026-05-05：在扩展层拦截，避免仅依赖前端 UI 状态。

## 当前结论

已完成。扩展侧在发送入口识别龙虾子任务标签，若手动继续仍携带 `interactiveMode=lobster`，会强制按 `coding` 执行；文档已同步，`npm run build` 通过。未执行 VS Code 内人工中断续跑验证。
