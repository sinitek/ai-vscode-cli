# AI 对话 Tab 成功结束后错误状态残留修复

- 日期：2026-11-11
- 状态：completed
- 负责人：Codex

## 背景与目标

Tab 的 `runStatus:end` 会清除错误，但随后到达的 trace/system 错误以及自动重试排队消息会再次将空闲 Tab 标红。为每个 Tab 保留本轮成功终态，避免消息内容覆盖明确的成功结果。

## 范围与非目标

修改 Webview 每 Tab 运行态、消息错误推断、事件分发及相关测试和事实来源。不调整 CLI 执行结果、不隐藏错误气泡、不改变布局，不触碰工作区已有的 Loop 群聊改动。

## 验收标准

- 前台与后台 Tab 成功后，迟到的 appendMessage、replaceMessage、traceSegment 和重试排队消息不再标红。
- 新用户消息、新运行与会话重置释放上一轮成功保护；明确 `runStatus:error` 仍显示失败，未运行过的空闲错误仍可见。
- Tab 状态互不污染；相关单测、构建和真实 Chromium Webview 验证通过。

## 影响面与风险

- `src/webview/viewContentScript/` 与 `src/test/webview/tabRunStatus.test.ts`。
- 功能清单、运行时设计与 ontology 状态优先级规则同步。
- 风险：成功保护影响下一轮错误展示；以新用户消息、新运行、重置和明确失败用例约束。字段仅在 Webview 内存保存，不迁移会话文件，回滚对应局部改动即可。

## 验证计划

- 先补事件序列回归，确认旧实现失败，再修复并重跑。
- `npm run build`；`node --test dist/test/webview/tabRunStatus.test.js`，再扩展相关 Webview / 会话回归。
- 复用 `.tmp/chat-tab-status-config-smoke.cjs` 的完整 Webview Chromium 验证，增加成功后的迟到错误序列，检查宽窄屏和浏览器错误。
- ontology 校验与相关 Python 测试、`git diff --check`。

## 进度与验证记录

- 已完成 CodeGraph 定位尝试并核对当前源码；图谱未有效返回模板字符串内部函数，按函数行范围直接读取。
- 已核对 ontology 与运行时状态规则；召回焦点为对话标签完成后错误状态，anchor 为空。召回无本次专属 active plan。
- 新增每 Tab 内存字段 `lastRunStatus`，先记录宿主结果再处理消息；成功后的普通错误推断和重试排队提示不再标红。只在新增用户消息时释放保护，替换历史用户消息不释放；新运行、重置与回收仍按原有生命周期处理。
- 回归测试覆盖前台/后台成功后的新增、替换、trace 与重试提示，以及明确失败、下一轮用户消息、历史用户消息替换、停止、新运行、重置、回收和未运行空闲错误，共 8 项。
- 旧实现复现：`node --require ./.tmp/chat-tab-completion-baseline.cjs --test dist/test/webview/tabRunStatus.test.js`，首次 7 项中 3 项失败，均为成功后被迟到错误重新标红；此 preload 仅在内存加载 `git show HEAD` 的三份原实现，不回退源码或工作区其他改动。
- `npm run build` 通过；最小回归与状态/摘要/分页相关测试最终 33/33 通过。
- 初轮扩展验证 228 项中 13 项聊天气泡保留断言失败；以同一 preload 加载原实现后仍有同名 13 项失败，证明与本次改动无关。期间工作区存在其他并发任务更新该领域代码/测试，本任务不修改其实现或断言；最终当前工作区相关测试 229/229 通过。
- 并发构建曾清理 `dist/`，导致补跑出现 `MODULE_NOT_FOUND`，属于环境/并发产物冲突。最终改用隔离输出：`./node_modules/.bin/tsc -p ./ --outDir .tmp/chat-tab-completion-dist` 通过；随后 `node --test .tmp/chat-tab-completion-dist/test/webview/tabRunStatus.test.js .tmp/chat-tab-completion-dist/test/webview/clipagescriptruntimecoverage.test.js .tmp/chat-tab-completion-dist/test/webview/conversationtabsummarytooltip.test.js .tmp/chat-tab-completion-dist/test/webview/chatBubbleRetentionWebview.test.js .tmp/chat-tab-completion-dist/test/session/conversationTabRunningFlow.test.js .tmp/chat-tab-completion-dist/test/session/conversationTabPagination.test.js`，229/229 通过。
- `CHAT_TAB_BUILD_ROOT=.tmp/chat-tab-completion-dist node .tmp/chat-tab-completion-smoke.cjs` 使用真实生成的完整 Webview，在 headless Chromium 1100×850、390×850 两个视口共 54 项状态断言通过，页面/控制台/网络失败为 0；宽窄屏截图已查看。证据：`.tmp/chat-tab-completion-smoke/result.json` 与同目录截图。未连接真实 CLI/provider 或 VS Code Extension Development Host，不将模拟宿主事件宣称为完整端到端验证。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`，9/9 通过；`git diff --check` 通过。
- 首轮新增夹具缺少 `ensureRuntimeTaskList`，已补齐依赖后重跑，不据此更改业务逻辑。

## 记忆与文档判断

稳定规则进入现有功能清单、运行时设计与 ontology；不追加自动任务到热区记忆，不新增重复事实来源。

## 当前结论

成功终态不再被迟到的非终态错误消息覆盖，真实失败和下一轮任务仍可正常展示错误。无需新增配置、修改 CLI 协议或迁移磁盘数据；Linux/macOS/Windows 共用纯 Webview JavaScript 路径，无平台专有实现。未执行发布脚本、未安装依赖、未改动其他任务的代码。
