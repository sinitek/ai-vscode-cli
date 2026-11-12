# Loop 角色思考力度回归测试

- 日期：2026-11-12
- 类型：test
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-12-feature-loop-model-thinking.md`（依赖功能接口）

## 目标与范围

覆盖 Loop、Loop+ 两种子任务模式的力度选择、非法值拒绝、任务保存、调用前旧参数覆盖和弹窗交互。不调整无关测试或外部 CLI。

## 验收标准

相关最小单测与构建通过；Chromium 验证选择、提交及刷新保留草稿。普通对话、独立提问与未切换历史任务保持兼容。

## 风险与回滚

浏览器仅使用合成任务和 VS Code 消息 mock，不调用真实模型。出现失败先区分实现、夹具和环境问题，再针对性修复；可独立回滚新增用例。

## 验证计划与进展

已在 `loopModelSwitch.test.ts`、`loopGroupChatCoordinator.test.ts`、`loopGroupChatPanel.test.ts` 和 `loopPlusRuntimeIntegration.test.ts` 补充/更新回归。覆盖角色独立保存、仅切力度、旧消息兼容、无能力禁用、非法值原子拒绝、继续与调用参数刷新、活跃调用保持原值及主标签显式选择。

### 实际命令与结果

```sh
npm run build
node --test dist/test/loop/loopModelSwitch.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopSubtaskThinking.test.js dist/test/extensionHost/loopModelSwitchResume.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js
```

构建通过；245/245 测试通过，日志 `/tmp/loop-thinking-focused-final.log`。

```sh
node --test dist/test/loop/*.test.js dist/test/extensionHost/loopModelSwitchResume.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptRuntimeCoreCoverage.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js
```

604 项中 600 通过，4 项既有失败均在 `loopPlusGroupChatPanel.test.ts`：队列并行展示、暂停复核、验收结果及中断子项统计；旧断言依赖不再存在的统计卡片或验收文案。通过临时 require hook 将 `loopGroupChatPanel.ts` 和 `loopModelSwitchDialog.ts` 替换为 `git show HEAD:<path>` 的转译结果，仍复现相同四项失败（15 项中 11 通过）。未改动相关业务，日志 `/tmp/loop-thinking-expanded-final.log`、`/tmp/loop-thinking-baseline-test.log`。

### 浏览器验证

使用 skill 的 `run_smoke.mjs --scenario .tmp/loop-thinking-<mode>.json`，直接渲染当前构建的真实群聊 HTML；合成任务、模拟 VS Code 消息桥，无登录及外部服务请求。classic/fullstack 使用桌面视口，split 使用 480×900；补充 Playwright 校验在 480×760 下验证能力禁用/恢复、焦点保留、失败后重试成功及取消不提交。三种模式均通过，浏览器/网络错误均为零。截图及 `result.json` 位于 `.tmp/playwright-smoke/loop-thinking-<mode>/`；临时服务与场景已清理。

### 失败分流与边界

- 初始构建发现协议字段和局部输入类型未覆盖力度，已补齐；旧文案断言按新能力更新后通过。
- 补充浏览器脚本最初误认为 `selectOption` 会聚焦选择器；显式聚焦后再验证刷新焦点，全部通过，属于测试夹具问题。
- 上述四项为原版模块可复现的范围外失败，保留证据，不扩大修复。
- 未执行真实 CLI/外部模型或开发宿主验证；不把 mock 消息桥等同于外部服务完成验收。
