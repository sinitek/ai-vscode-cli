# Vibe 发送即时反馈与已完成 Loop 会话续跑

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：无；保留工作区已有 Loop+ 显式依赖改动。
- 状态：completed
- 负责人：Codex

## 背景与目标

Vibe 的用户气泡要等待图片解析、配置同步和完整面板刷新，发送等待状态仅覆盖 Loop+ 和暂停发送，造成长时间无反馈。用户还报告已完成 Loop / Loop+ 会话切到 Vibe 后模式回弹，后续确认至少存在气泡延迟，需要同时验证模式续跑。

## 范围与验收

- 有效发送立即在当前 Tab 展示原始提示词预览和三点等待动画，不等待宿主配置或 CLI。
- 宿主持久化用户消息后接管预览，同次提交只显示一条用户气泡；预览不写入历史。
- 首次正文/思考、终态、拒绝和异常清理等待；迟到回执、切换 Tab 和暂停确认保持隔离。
- 完整展示刷新不阻塞普通执行；真实配置校验与会话交接保留。
- 已完成 Loop / Loop+ 会话显式切到 Vibe 后按普通执行链继续，检查刷新与发送不覆盖当前选择。
- 不改依赖、CLI 协议或已有 Loop+ 调度改动。

## 影响面、风险与缓解

发送处理、消息预加载、Webview 提交反馈及相关测试。预览用已有主题气泡样式，通过提交 ID 与真实消息 ID 对应，避免重复及同文提示词误匹配。页面内按 Tab 保存当前 CLI 的显式模式，同 CLI 的状态快照和历史自动推断均优先采用该选择；未手动选择时保留原推断，关闭 Tab 随运行态清理。发送当前 Tab 不重复激活。不修改持久化格式或原生 runner。

## 根因与交付

- 普通发送先等待 `postPanelState()` 读取各 CLI 配置/模型，再预加载用户气泡；即使 CLI 尚未开始也没有反馈。现在三种模式实际发送时在前端立即显示原始提示词和等待动画，真实用户消息按 `requestId` 接管，完整面板刷新后台执行，拒绝后的刷新也不拖延回执。
- 历史主任务在返回 Tab 时会重新推断 Loop / Loop+，迟到面板快照也会覆盖手动模式。真实 Chromium 复现后，增加页面内 `interactiveModeSelection`，保护当前 Tab / CLI 的显式选择；宿主跳过重复激活当前 Tab，继续 Vibe 使用原会话普通执行链。
- 保留首次输出、终态与拒绝清理，以及旧回执、跨 Tab 和暂停确认隔离；不将临时气泡写入会话、导出或模型上下文。

## 验证计划

- `npm run build` 后运行发送、任务摘要、Tab 模式、Webview runtime 及消息渲染相关测试。
- 使用真实 Webview HTML 构建器和 headless Chromium，模拟慢宿主，验证即时气泡、动画、真实消息接管、模式续跑、拒绝清理、跨 Tab 隔离及页面错误。
- 同步功能清单、运行时文档和 ontology，执行 ontology 校验及相关测试。

Tasklist:
- [completed] 对照现有发送路径和等待状态
- [completed] 实现即时预览与等待并验证模式续跑
- [completed] 完成回归、构建和浏览器验证
- [completed] 同步事实来源并归档验证结论

## 测试与清单同步

### 构建与回归

`npm run build` 通过；构建与读取 `dist/` 的测试串行执行。最小相关 8 文件 344 项全部通过。扩大到模式、队列和消息渲染关联范围后实际运行：

```bash
node --test --test-reporter=tap \
  dist/test/session/sessionMessageActions.test.js \
  dist/test/session/sessionMessageActionsCoreCoverage.test.js \
  dist/test/session/conversationTaskSummary.test.js \
  dist/test/session/loopPlusSessionTabs.test.js \
  dist/test/session/conversationTabLock.test.js \
  dist/test/webview/clipagescriptruntimecoverage.test.js \
  dist/test/webview/cliPageStaticRenderCoverage.test.js \
  dist/test/webview/loopPlusModeEntry.test.js \
  dist/test/webview/looppluswebviewintegration.test.js \
  dist/test/webview/tabRunStatus.test.js \
  dist/test/webview/jsonTreeMessageRender.test.js \
  dist/test/webview/codexdualmodelwebview.test.js \
  dist/test/webview/opencodedualmodelwebview.test.js \
  dist/test/webview/modelManagerIme.test.js \
  dist/test/loop/loopPromptQueue.test.js \
  dist/test/loop/opencodeloopmodewebview.test.js
```

共 416 项，415 通过、1 失败，无取消/跳过/TODO。本次新增回归全部通过，覆盖三模式即时预览、同文旧消息不确认、append/setMessages 接管、慢展示刷新、配置拒绝回执、会话续接、显式选择、不同 CLI、跨 Tab 和旧回执隔离。

失败分类与处理：

- 函数抽取夹具缺少新增 runtime getter / 模式 helper：补齐真实依赖；普通发送现在也带提交 ID，更新对应队列夹具与断言，最终均通过，未向生产代码添加测试降级分支。
- 历史失败：`loopPromptQueue.test.ts` 的 `prevents the conflict overlay from bypassing a running Loop main tab` 用正则匹配旧冲突发送结构。使用 HEAD `1dc9f71a77be9d54d7c286ceee1430aeae57e8a8` 的原断言和原 `settingsAndOverlays.ts` 计算后同样为 false；该断言、本次未改的目标模块及其生成脚本内容与基线一致。保留范围外历史失败，不改本任务以外的冲突规则。本机证据 `.tmp/vibe-submission-baseline.json`，完整输出 `.tmp/vibe-submission-tests.log`。

### 浏览器与结构校验

- `node .tmp/vibe-submission-browser.cjs` 通过：使用真实 Webview HTML/CSS/完整脚本与本机 headless Chromium，隔离 VS Code 宿主，模拟不响应宿主；气泡和三点动画立即可见。验证完成 Loop+ 切到 Vibe、Tab 隔离、真实 ID 接管后仅一条用户气泡、start/首次输出/拒绝清理、旧回执及减少动态效果。页面/console/请求/HTTP 错误均为空。
- 同一 fixture 运行 `chromium-playwright-smoke` 的结构化场景通过，包含气泡/等待文字与可见性、无重叠检查。本机报告 `.tmp/vibe-submission-browser/result.json`、`.tmp/vibe-submission-browser/structured-smoke/result.json`；截图 `.tmp/vibe-submission-browser/vibe-waiting.png`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过（150 rules）；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9 项通过。
- `git diff --check` 通过；本次修改文件的 trailing whitespace 检查通过。

### 事实来源与边界

已更新功能清单、插件能力规格、Loop+ 发送反馈与运行时设计、ontology；将可复发的展示阻塞和历史模式覆盖沉淀到 `runbooks/PITFALLS.md`。稳定事实已进入设计/规则文档，不另重复写入热区或 `ROLLING_SUMMARY.md`。

未运行全仓单测、真实模型、已安装扩展的 Extension Development Host 或 Windows/Linux 原生验证；本次浏览器验证使用隔离宿主，不代表真实 CLI 首次响应时间已经缩短。修复保证实际发送立即有反馈，并移除已确认的完整展示刷新阻塞；必要的配置、所有权、压缩和 CLI 等待仍按真实状态进行。未发布扩展。
