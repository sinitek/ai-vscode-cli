# Loop / Loop+ 随时补充需求

- 日期：2026-11-04
- 状态：completed
- 负责人：Codex

## 背景与目标

补充需求提交后将入口按钮设为 disabled，但群聊增量刷新会跳过相同 HTML，按钮可能一直禁用。弹窗本身不依赖主模型空闲；Loop+ 已有持久化用户消息队列。修复入口锁死，让运行中的任务可连续接收补充需求，复用既有队列而不打断当前模型调用。

## 范围与非目标

- 范围：群聊补充弹窗、重复确认保护、连续提交回归测试、功能清单与语义导航同步。
- 非目标：更换 CLI / 框架、改变验收优先级、自动恢复已完成或手动停止的任务、发布扩展。
- 在当前干净工作区实施，不创建分支或独立 worktree。

## 验收标准

- 主模型忙碌时补充需求入口保持可用，提交后不等待内容刷新就能再次打开。
- 多条需求按提交顺序保存；Loop+ 进入已有用户队列，经典 Loop 在下一轮读取。
- 空白输入不提交；关闭后的重复确认或快捷键不重复发送；打开弹窗时刷新不丢草稿。
- 最小相关测试、构建与 Chromium 真实脚本交互验证通过。

## 影响面与风险

- 代码：`src/webview/loopGroupChatPanel.ts`、`src/webview/loopGroupChatPanelRenderer.ts`、`src/extensionHost/loopOrchestration.ts`、`src/extension.ts`。
- 测试：群聊面板、群聊协调器、Loop+ 调度相关测试。
- 文档：功能清单、运行时规格、ontology 与排障文档。
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
- [completed] 添加回归测试并同步事实来源
- [completed] 执行验证并归档计划

## 测试与清单同步

- 单元测试新增/更新：连续提交不禁用、重复确认、空白与模式保护；协调器忙碌期间按序持久化；经典 Loop 完成期间新增需求的不可变与原地修改两种记录回归。
- 单元自测结果：`npm run build` 及群聊面板、协调器、经典 / Loop+ 编排、运行态与抽取契约六文件测试通过，共 178 项。
- 全量验证：`node scripts/run_unit_tests.js` 共 2875 项，2872 通过、0 失败、3 个依赖真实 DSH 配置的用例按既有条件跳过；日志位于 `/tmp/loop-supplement-all-unit.log`。
- 浏览器验证：使用编译后的真实 Webview HTML、VS Code bridge 夹具和官方 smoke runner，在 headless Chromium 中通过经典 Loop 1440×1000、Loop+ 390×1000 两种场景。连续提交三条需求，同时每 150ms 发送真实内容补丁，验证草稿不丢、快捷键提交、空白校验、取消不发送、再次打开、模型选择持续隐藏、按钮无重叠；两场景 browserErrors / httpErrors / requestFailures 均为空。结果保留于 `.tmp/playwright-smoke/supplement-loop/result.json` 和 `.tmp/playwright-smoke/supplement-loop-plus/result.json`，已人工检查两张截图；临时服务器与场景源文件已清理。
- 结构验证：ontology `--validate` 通过（102 rules），ontology Python 测试 9 项通过，UI detector 返回空 findings，`git diff --check` 通过。
- 失败处理记录：先复现三个 UI 回归与两个经典 Loop 收尾回归；均为实现缺陷，已修复后通过。新增状态尚未声明时出现一次 TypeScript 不可达分支错误，随返回类型及调用者更新消除。
- 功能清单：已同步连续补充、忙碌排队与收尾防遗漏行为。
- 相关文档同步：已同步规格、调度设计、ontology 与 PITFALLS，不重复写热区记忆。
- 文档边界：未改变分层和运行命令，因此无需更新 `ARCHITECTURE.md`；本次可复用根因上提到 PITFALLS，未向 `ROLLING_SUMMARY.md` 或 EVENT_MEMORY 重复写入任务流水。
- 验证边界：浏览器使用真实页面脚本与桥接夹具，不等同于 VS Code Extension Development Host 的人工端到端或真实供应商调用；未调用付费真实模型，未执行发布脚本。

## 决策记录

- 2026-11-04：复用 Loop+ 既有持久化队列，不另建队列、不改变验收优先级。经典 Loop 无需新持久化字段，以请求开始的需求快照拦截过期完成结论，并在原轮次重新判断。

## 当前结论

已完成修复、全量单元测试、真实 Chromium 页面交互和结构校验。工作区内修改可供审查；未发布扩展。
