# Loop+ 群聊继续执行弹窗

- 日期：2026-11-28
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与范围

用户在可继续的任务上点击「继续执行」有时看不到弹窗，同一任务可从 AI 对话输入继续。围绕群聊按钮、本地弹窗、宿主回执与后台刷新复现。复用现有任务受理和模型恢复流程。

## 验收与验证

- 在可继续状态用鼠标或键盘打开说明框，刷新期间能编辑，确认只提交一次，取消可再打开。
- 待启动或宿主仍禁止继续时拦截重复提交，任务再次可继续时按钮恢复。
- 使用合成任务在 Chromium 中先复现，再运行 `npm run build`、群聊页面与宿主的定向单测以及隔离的 Extension Development Host 场景。

## 影响与风险

普通 Loop、Loop+ 和产研部共用群聊工具栏。验证刷新后按钮的原生禁用状态、产研部清理门禁及回执的请求匹配。功能清单同步按钮操作的可见行为。

## 根因与交付

Chromium 中按住可继续按钮，收到进度从 30% 到 31% 的补丁后松开。原实现重建了工具栏，浏览器没有向原按钮派发 click。第二个场景中，回执临时禁用了按钮，后续可继续快照的工具栏 HTML 与缓存相同，导致按钮持续禁用。两个用例在修复前均命中对应断言。

继续操作现在有单独的 DOM 区域。每次有效刷新都核对宿主可用状态与当前请求，即便 HTML 相同也同步原生按钮的 disabled 状态。带有待收尾请求 ID 的刷新可在宿主空闲后补收回执。确认仍走已有续跑入口，运行中的重复请求受到保护。交互边界已同步到功能清单、群聊状态设计与 `plugin.rule.loop_continuation_recovery`。

## 验证结果

- `npm run build` 通过。针对群聊面板、协调器、Loop+ 运行时、状态投影及共享产研部工具栏执行 10 个编译后测试文件，共 363 项通过。
- `node --test scripts/loop_plus_continue_refresh_smoke.cjs` 使用 `PLAYWRIGHT_MODULE` 指向本机 Playwright，并通过 `CHROMIUM_PATH` 指定本机 Chrome。3 个用例通过，覆盖原生按下与松开跨刷新、编辑与取消、Space 重开、点击期间撤销权限、同内容重新启用和错过回执后切回群聊。
- `node scripts/loop_plus_protocol_regression_smoke.cjs --scenario=group-continue-panel` 在 macOS 隔离的 VS Code Extension Development Host 中通过。本地 DSH 替身收到 1 次续跑，重复点击时按钮禁用，宿主记录 0 个插件错误，退出码 0。
- Ontology 校验通过，配套 9 项测试通过。测试中发现的 VM 夹具缺少新按钮状态及 HTML 断言误匹配脚本选择器，均已修正并复测。
