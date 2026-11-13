# Loop / Loop+ 随时补充需求

- 日期：2026-11-04
- 状态：completed
- 类型：feature
- 负责人：Codex

## 背景与目标

补充需求提交后将入口按钮设为 disabled，但群聊增量刷新会跳过相同 HTML，按钮可能一直禁用。弹窗本身不依赖主模型空闲；Loop+ 已有持久化用户消息队列。修复入口锁死，让运行中的任务可连续接收补充需求，复用既有队列而不打断当前模型调用。

## 范围与非目标

- 范围：群聊补充弹窗、重复确认保护和连续提交入口行为；不承接回归开发，历史测试摘要见关联删除审计，功能/规格/ontology/PITFALLS 同步原由已退役 docs companion 承接（仅历史分工）。
- 非目标：更换 CLI / 框架、改变验收优先级、自动恢复已完成或手动停止的任务、发布扩展。
- 在当前干净工作区实施，不创建分支或独立 worktree。

## 关联计划

- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-loop-supplement-always-available.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
- 历史文档分工：原 docs companion `2026-11-04-docs-loop-supplement-always-available.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。本计划只承接入口、提交保护和队列实现。[references 索引](../../../references/index.md)仅作导航。

## 验收标准

- 主模型忙碌时补充需求入口保持可用，提交后不等待内容刷新就能再次打开。
- 多条需求按提交顺序保存；Loop+ 进入已有用户队列，经典 Loop 在下一轮读取。
- 空白输入不提交；关闭后的重复确认或快捷键不重复发送；打开弹窗时刷新不丢草稿。
- 入口行为修复、构建和 Chromium 真实脚本交互的历史验证通过；新增回归是历史测试工作，不转入本 feature 计划，摘要见关联删除审计；事实来源同步原由已退役 docs companion 承接（仅历史分工）。

## 影响面与风险

- 代码：`src/webview/loopGroupChatPanel.ts`、`src/webview/loopGroupChatPanelRenderer.ts`、`src/extensionHost/loopOrchestration.ts`、`src/extension.ts`。
- 测试：群聊面板、群聊协调器、Loop+ 调度相关测试。
- 关联交付：功能清单、运行时规格、ontology 与排障文档原由已退役 docs companion 承接（仅历史分工）；历史回归结果见下文及关联删除审计，不再指向存活 test 计划。
- 风险：移除入口禁用后重复确认可能重复发送；在提交函数中以弹窗打开状态和模式防重，不锁入口。
- 回滚：恢复本次针对入口与提交保护的局部修改；不迁移数据。

## 验证计划

- 单元自测：`npm run build` 后执行群聊面板、协调器、Loop+ 编排与核心调度相关测试。
- 浏览器：用生成的真实 Webview HTML 和 VS Code bridge 夹具，在 headless Chromium 验证忙碌、连续提交、刷新、空白输入和重复确认。
- 结构：ontology 校验、Python ontology 测试及 `git diff --check`。
- 不调用付费真实模型，不执行发布脚本；本次不改变模型调用或调度协议。

## 任务列表

- [completed] 定位入口锁死并核对现有排队链路
- [completed] 修复入口及重复确认保护
- [completed] 完成入口、提交保护和队列实现
- [completed] 验证行为并记录未覆盖边界

## 测试与清单同步

- 连续提交、重复确认、空白/模式保护和队列回归属于历史测试工作，相关结果保留于本节，删除审计仅保留摘要；`2026-11-04-docs-loop-supplement-always-available.md` 当时承担（该页已退役，仅历史分工）功能清单、规格、ontology 与 PITFALLS 同步，本计划不承接回归开发。
- 单元自测结果：`npm run build` 及群聊面板、协调器、经典 / Loop+ 编排、运行态与抽取契约六文件测试通过，共 178 项。
- 全量验证：`node scripts/run_unit_tests.js` 共 2875 项，2872 通过、0 失败、3 个依赖真实 DSH 配置的用例按既有条件跳过；日志位于 `/tmp/loop-supplement-all-unit.log`。
- 浏览器验证：使用编译后的真实 Webview HTML、VS Code bridge 夹具和官方 smoke runner，在 headless Chromium 中通过经典 Loop 1440×1000、Loop+ 390×1000 两种场景。连续提交三条需求，同时每 150ms 发送真实内容补丁，验证草稿不丢、快捷键提交、空白校验、取消不发送、再次打开、模型选择持续隐藏、按钮无重叠；两场景 browserErrors / httpErrors / requestFailures 均为空。结果保留于 `.tmp/playwright-smoke/supplement-loop/result.json` 和 `.tmp/playwright-smoke/supplement-loop-plus/result.json`，已人工检查两张截图；临时服务器与场景源文件已清理。
- 结构验证：ontology `--validate` 通过（102 rules），ontology Python 测试 9 项通过，UI detector 返回空 findings，`git diff --check` 通过。
- 失败处理记录：先复现三个 UI 回归与两个经典 Loop 收尾回归；均为实现缺陷，已修复后通过。新增状态尚未声明时出现一次 TypeScript 不可达分支错误，随返回类型及调用者更新消除。
- 文档边界：具体文档交付原由已退役 docs companion 记录（仅历史分工）；本计划仅引用其结果，不把验证日志或历史排障证据重复认领为文档写作。
- 验证边界：浏览器使用真实页面脚本与桥接夹具，不等同于 VS Code Extension Development Host 的人工端到端或真实供应商调用；未调用付费真实模型，未执行发布脚本。

## 决策记录

- 2026-11-04：复用 Loop+ 既有持久化队列，不另建队列、不改变验收优先级。经典 Loop 无需新持久化字段，以请求开始的需求快照拦截过期完成结论，并在原轮次重新判断。

## 当前结论

已完成修复、全量单元测试、真实 Chromium 页面交互和结构校验。工作区内修改可供审查；未发布扩展。
