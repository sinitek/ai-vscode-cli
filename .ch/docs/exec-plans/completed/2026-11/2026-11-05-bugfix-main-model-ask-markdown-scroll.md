# 主模型提问弹窗 Markdown 与自动滚动

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：bugfix

## 背景与目标

“向主模型提问”已有共享 Markdown 函数，但弹窗单独拼接渲染结果，且离开底部后新问题或回答不会自动滚到底部。统一使用群聊的 Markdown 挂载入口，并在新内容出现或重新打开弹窗时定位到最新消息。

## 范围与非目标

- 范围：提问气泡共享 Markdown 挂载与自动滚动。
- 非目标：不改变主模型调用、忙碌锁、历史持久化、群聊主时间线滚动策略或技术栈；保留当前工作区其他修改。

- 本计划仅记录既有入口缺陷修复，不承担回归开发；历史测试证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-main-model-ask-markdown-scroll.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。清单/本体/图片延迟加载 runbook 编写由关联 docs 计划承接。原文没有发布版本，不补造版本号。

## 验收标准

- 用户、回复气泡使用群聊同一 Markdown 挂载链路，支持标题、列表、表格、代码和 JSON 等现有能力。
- 用户问题、等待气泡、回复更新后，即使此前滚离底部，也自动显示最新内容；重新打开亦滚到底部，异步图片加载后继续校正。
- 无变化的周期更新不打断用户阅读，隐藏弹窗不主动滚动。
- 相关单测、`npm run build` 和本机 Chromium 页面验证通过。

## 影响面与风险

- 生产代码：`src/webview/loopGroupChatPanel.ts`；不改调用、忙碌锁和持久化。
- 利用 HTML 缓存判断内容变化，避免无变化刷新拉到底部；布局完成后再次校正，沿用 Markdown 转义安全边界。
- 回滚只撤回本任务气泡/滚动；关联测试/文档各自跟踪，不覆盖并行修改。

## 任务列表与实现结果

- [x] 共享 Markdown 挂载，新增内容/重开滚到底部，无变化或隐藏不主动滚动。
- [x] Chromium 发现 SVG 解码晚于下一帧的实现缺陷，补捕获 `load` 校正并复测，不把初轮失败掩盖为通过。

## 验证计划与历史结果

历史构建、42/42最小及89/89扩展回归、1280×900与420×900离线 Webview 结果及环境限制摘要，按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-main-model-ask-markdown-scroll.md` 见[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)；该条目保留最小、扩展和浏览器命令，但不保留全部证据细节。稳定事实校验见 docs。浏览器最终底部距离均0，不等同真实宿主/主模型/Windows实机。

## 当前结论

实现及验证完成；未调用真实主模型、未启动真实 Extension Development Host，也未进行 Windows 原生实机验证；改动不新增平台相关路径或 API。保留工作区其他任务修改。架构与 CLI 调用不变，不额外更新架构或事件记忆。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留主模型提问共享挂载与滚动回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-main-model-ask-markdown-scroll.md`；不再作为现行测试责任。
- [docs：主模型提问 Markdown 与图片加载文档同步](2026-11-05-docs-main-model-ask-markdown-scroll.md#背景与目标)：分别承接主模型提问 Markdown 与图片加载文档同步，共享本来源的历史背景与接口。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
