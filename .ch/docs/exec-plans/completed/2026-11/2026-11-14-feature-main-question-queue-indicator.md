# 主模型提问气泡排队提示

- 日期：2026-11-14
- 类型：feature
- 状态：completed
- 负责人：Codex
- 关联计划：无

## 背景与目标

提问弹窗隐藏提交后的忙碌提示，排队气泡缺少反馈。为每条排队中的用户消息显示三点动画及中文排队提示，连续提问时准确区分正在回答和后续排队。

## 范围与非目标

范围为问答气泡排队标记、宿主投影、主题样式、相关回归和功能清单。不改变 FIFO、主任务优先级、取消行为或 CLI 调用。

## 验收标准

- 排队用户气泡下方显示动画和文字，非排队气泡不显示。
- 开始回答、完成、失败、中止及重启恢复时正确清除对应标记；后续排队问题保留提示。
- 使用主题颜色并支持减少动态效果；关闭弹窗时暂停排队动画。

## 影响面与风险

`loopAskThread.ts`、`loopGroupChatPanelCoordinator.ts`、提问弹窗及相关测试。每条气泡新增可选排队字段，旧历史兼容；以宿主现有队列为事实来源，不从消息顺序推断。移除新增展示和投影即可回滚，不涉及调度变更。

## 验证计划

`npm run build` 后执行 `node --test dist/test/loop/loopAskThread.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopMainQuestionQueue.test.js`；headless Chromium 检查连续排队、回答切换、取消、窄视口、减少动态效果及错误输出。

## 测试与清单同步

已补充逐条排队投影、序列化/终态清理与气泡渲染回归；同步 `FEATURE_INVENTORY.md` 和对应 ontology 规则。

- `npm run build`：通过。
- 计划中的四个 `node --test` 文件：89 项通过，无失败或跳过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- `node .tmp/main-question-queue/verify.cjs`：调用 chromium-playwright-smoke runner 并运行额外 Chromium 断言，通过两问排队、动画实际播放、位置、回答切换、关闭/重开、减少动态效果、480px 窄视口与取消清理；无浏览器、网络或 HTTP 错误。截图和 JSON 结果在 `.tmp/main-question-queue/`。
- `git diff --check`：通过。
- impeccable detector 仅发现原有 Markdown 引用块的 `border-left: 3px`（范围外既有样式），本次新增样式无检测项。
- 首次构建发现测试夹具声明未包含新增 queued 字段，已扩展测试类型后重新构建和验证通过。额外浏览器脚本首次启动因默认 headless shell 缺失失败，显式复用 smoke runner 已使用的缓存 Chromium 后通过，没有安装依赖或改动项目依赖。

浏览器验证使用实际构建的 Webview HTML 和模拟 VS Code 宿主消息，不调用真实 CLI；本次未启动 Extension Development Host 或真实模型请求。未改变 CLI 调度和平台路径处理，无需扩大到付费模型验证。

## 当前进展

已完成逐条气泡排队投影及展示：队列 turnId 与等待启动的 activeTurnId 是唯一事实来源，宿主同步历史时更新气泡 queued 字段。开始回答清除当前问题标记，其他排队问题保留；所有终态及重启恢复清除遗留标记。历史 version 1 兼容新增可选字段。

功能规格与 ontology 已保存稳定事实；没有新增可复用故障或长期待办，无需更新 memory 热区、事件记忆或 runbook。当前任务已完成。
