# 主 Prompt 运行状态控制器重构 — 行为保持重构

- 日期：2026-10-03
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-03
- claim_ttl：本次会话
- handoff_to：
- 类型：refactor

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-03-primary-prompt-run-controller.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-03-docs-primary-prompt-run-controller.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

抽取主 Prompt 运行状态控制器，保持 One-shot、停止和清理行为。仅承担行为保持重构；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的行为保持重构；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-03-refactor-primary-prompt-run-controller.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- `src/extension.ts` 通过多组模块级 `active*` 变量维护主 Prompt、上下文压缩和停止流程的运行状态。One-shot、上下文压缩、会话生命周期和 deactivate 都通过不同的 getter/setter 组合访问同一份状态，容易造成清理遗漏和过期回调写入新运行。

## 目标

- 新增一个无 VS Code 依赖的主 Prompt 运行状态控制器，统一维护运行身份、进程、停止回调、会话目标、消息目标、trace 状态和任务记录，并让现有组合根通过该控制器访问状态。

## 范围

- 新增 `src/extensionHost/primaryPromptRunController.ts`。

- 将 `src/extension.ts` 的主运行模块级状态迁移到控制器。

- 保持 One-shot、上下文压缩、停止和 deactivate 的公开行为不变。

- 运行 `npm run build` 和最小相关单测。

## 非目标

- 不改变 CLI 协议、Loop/Loop+ 或 Webview 协议。

- 不把并行运行和 interactive tab 运行合并到主运行控制器。

- 不引入 DI 容器、框架或新依赖。

- 不修改用户可见功能，因此不更新功能清单。

## 验收标准

- [x] 主运行状态不再以独立模块级 `active*` 变量散落在 `src/extension.ts`。

- [x] One-shot、上下文压缩和 deactivate 仍能识别当前运行并完成清理。

- [x] 旧运行 ID 无法被识别为当前运行。

- [x] 控制器覆盖启动、状态更新、停止回调和清理行为。

- [x] `npm run build` 通过，相关单测通过。

## 影响面

- 代码目录：`src/extensionHost/`、`src/extension.ts`、`src/test/extensionHost/`。

- 配置与脚本：无。

## 风险与缓解

- 风险：状态迁移时遗漏某个流式回调引用，导致消息无法更新或清理不完整。

- 缓解：保持现有 Host 依赖接口不变，只替换组合根状态实现；先跑控制器单测，再跑 One-shot、上下文压缩和 deactivate 相关测试。

- 风险：`clear` 行为改变工作区切换或 process title 收口时机。

- 缓解：保留 `clearActiveRun` 的外层副作用，仅将内部状态归零委托给控制器。

## 验证计划

- 最小相关验证：`npm run build`。

- 单元自测命令：`npm run build && node --test dist/test/extensionHost/primaryPromptRunController.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/core/contextCompactionRunner.test.js dist/test/extensionHost/extensionDeactivateStopAll.test.js`。

- 扩展验证：本次不启动 Extension Development Host；验证重点是现有运行时契约测试。

## 测试与清单同步

- 单元自测结果：2026-10-03，`npm run build` 通过；定向测试 21/21 通过。

- 失败处理记录：首次定向测试发现 `extensionDeactivateStopAll.test.ts` 仍断言迁移前的模块级变量名；已更新源码契约断言，重跑后通过。

- 功能清单：无需更新，仅做内部可维护性重构。

## 任务列表

- [completed] 新增主 Prompt 运行状态控制器及单元测试。

- [completed] 将 `src/extension.ts` 的主运行状态和生命周期引用迁移到控制器。

- [completed] 执行构建与相关测试并修复本次引入的问题。

## 决策记录

- 2026-10-03：采用函数工厂和显式属性访问，不引入类继承或 DI 容器。

- 2026-10-03：并行运行和 interactive tab 运行继续保留各自 Map，不纳入主 Prompt 控制器。

## 当前结论

- 2026-10-03 已完成主 Prompt 运行状态控制器抽取、组合根迁移、契约测试修正和架构文档同步。One-shot、上下文压缩、停止与 deactivate 的行为验证通过；本次不改变 CLI 协议或用户可见功能。
