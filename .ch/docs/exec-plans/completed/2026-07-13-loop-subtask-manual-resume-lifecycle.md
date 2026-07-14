# Loop 子任务手动恢复收尾一致性

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-13
- claim_ttl：当前会话
- handoff_to：

## 背景

Loop 子任务因错误自动重试后成功，会统一更新子任务记录、按全局设置关闭子任务 Tab，并继续唤醒主任务。用户手动中止子任务后在子任务 Tab 中继续，完成时走另一条恢复路径；该路径会更新状态并唤醒主任务，但遗漏了子任务 Tab 自动关闭，导致与自动恢复行为不一致。

## 目标

让手动恢复的 Loop 子任务在成功完成后的状态更新、Tab 生命周期和主任务继续效果与自动重试成功路径一致。

## 范围

- 收敛 `src/extension.ts` 中自动重试与手动子任务恢复的完成收尾逻辑。
- 更新最小回归测试，覆盖手动恢复路由与统一完成收尾契约。
- 同步 Loop 用户可见行为的事实来源和功能清单。

## 非目标

- 不调整子任务自动重试次数、间隔或主任务连续失败上限。
- 不改变手动恢复仍以内部 coding 任务执行的既有路由。
- 不新增设置项、数据结构或 UI 文案。

## 验收标准

- [x] 手动中断后的子任务手动继续并以 `end` 成功结束时，在“Loop 子任务自动关标签”开启的情况下自动关闭该子任务 Tab。
- [x] 自动重试成功与手动恢复成功复用同一完成收尾规则，均更新子任务记录后才继续后续编排。
- [x] 手动恢复再次报错、停止或全局自动关闭设置关闭时，不关闭子任务 Tab，也不改变既有恢复阻断语义。
- [x] 主任务在可恢复时继续执行，达到主任务失败上限时仍保持既有阻断。
- [x] 相关单测与 TypeScript 构建通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/test/`
- 文档目录：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、本计划
- 配置与脚本：无新增配置或脚本

## 风险与缓解

- 风险：把运行中的或失败的子任务 Tab 错误关闭。
- 缓解：仅对已确认 `TaskRunStatus === "end"` 的子任务调用关闭逻辑，并继续依赖已有的活动运行和主任务锁定保护。
- 风险：自动和手动路径再次产生收尾差异。
- 缓解：抽取由两条路径调用的单一完成辅助函数，并以回归测试锁定手动恢复的调用契约。

## 验证计划

- 最小相关验证：编译后运行 `node --test dist/test/loopSubtaskLifecycle.test.js dist/test/sessionMessageActions.test.js`。
- 单元自测命令：`npm run build`；`node --test dist/test/loopSubtaskLifecycle.test.js dist/test/sessionMessageActions.test.js`。
- 扩展验证：CodeGraph 重新索引后执行其标记的 8 个受影响测试文件，102/102 通过。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/loopSubtaskLifecycle.test.ts`，覆盖成功、关闭设置关闭、错误/停止和两条编排路径共享收尾函数；保留并执行 `sessionMessageActions.test.ts` 的手动恢复路由覆盖。
- 单元自测结果：`npm run build` 通过；最小相关测试 18/18 通过；CodeGraph 受影响测试集 102/102 通过。
- 失败处理记录：首次最小测试中，源码断言辅助函数错误把 TypeScript 参数对象类型的 `}` 识别为函数结尾；已改用相邻函数边界截取，产品代码未发生失败，重跑通过。
- 功能清单：已新增“子任务手动恢复完成收尾一致性”条目。
- 相关文档同步：已更新 Loop 能力规格、运行时设计和 `PITFALLS.md`。

## 任务列表

- [x] 使用 CodeGraph 确认自动重试与手动恢复的调用链差异。
- [x] 提取共享的子任务完成收尾逻辑，并接入两条路径。
- [x] 补充最小回归测试和用户可见行为说明。
- [x] 执行相关单测与 TypeScript 构建，归档计划并记录结论。

## 决策记录

- 2026-07-13：以 `TaskRunStatus === "end"` 作为手动恢复成功的唯一关闭条件；保留现有主任务唤醒资格和失败上限检查。
- 2026-07-13：将自动重试和手动恢复都接入 `finalizeLoopSubtaskRun`；该函数先更新记录，再按全局设置关闭成功子任务 Tab，避免两条路径继续漂移。

## 当前结论

已完成。`src/loopSubtaskLifecycle.ts` 提供可注入且可单测的共享完成收尾规则；`runLoopSubtaskWithRetry` 与 `maybeWakeLoopMainAfterSubtaskContinuation` 都调用扩展侧适配器。手动恢复成功现会在记录更新后按全局设置关闭子任务 Tab，再保留既有主任务恢复守卫。所有计划验证均已通过。
