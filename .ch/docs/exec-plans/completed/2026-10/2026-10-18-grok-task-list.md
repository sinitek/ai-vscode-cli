# Grok 任务列表获取与解析修复

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-18
- claim_ttl：已释放
- handoff_to：无

## 背景与目标

用户反馈 Grok 分组使用 Grok 模型执行任务时很少看到任务列表。核对实际 CLI 协议、任务输入输出和宿主到 Webview 链路，修复可以实证的缺口。

## 范围与非目标

- 覆盖 Grok 原生 ACP plan、todo 工具、增量更新与任务列表展示。
- 复用现有任务列表、主题和文案，补回归与真实 CLI/浏览器验证。
- 保留用户配置与历史数据，验证使用隔离目录和本地模拟 API。
- 不改 CLI 权限、依赖和其他模型协议，不发起付费模型调用。

## 验收标准

- [x] 明确 Grok 当前版本的任务列表原生来源与查询方式。
- [x] CLI 真实 todo 创建、状态更新、清空能正确投影到现有列表。
- [x] 增量、失败、取消、异会话和重复通知保持正确边界。
- [x] 构建、相关单测和生产 Webview 浏览器交互验证通过。
- [x] 功能清单、runbook 与 ontology 按行为变化同步。

## 影响面与风险

- 源码：`src/interactive/grokAppServerProtocol.ts`、`grokToolCallStream.ts`、`grokReplayStream.ts`、`src/promptRuntime.ts`。
- 风险：局部 todo 误当完整列表；输入意图冒充执行结果；重放旧任务污染新回合。
- 缓解：采用原生完整计划与成功完整输出，缺失输出时仅合并已知 ID，按会话/调用/回合隔离；真实 CLI 和回归确认。
- 回滚：按本计划涉及的局部差异撤回，无持久化数据迁移。工作区存在其他任务的并行改动，禁止整文件或全局回滚。

## 调查与决策

- memory-recall focus 为 grok tasklist todo 任务列表 CLI stream-json，按本地召回结果展开 Grok runbook；memory MCP 握手失败后使用本地来源。ontology ready，CodeGraph 定位 `GrokToolCallStream → GrokReplayStream → GrokInteractiveRunner → interactiveTurnGrok → taskListUpdate`。
- Context7 官方 Grok Build 文档与真实 Grok 1.0.62（1474f9cbdd91）一致：标准 `session/update` 的 `sessionUpdate:"plan"` / `entries` 是实时完整列表，不需额外 plan 能力声明。未确认独立查询当前 todo 的 RPC；后台 list_tasks/get_task 与此列表语义不同。
- 排除本次会话后，只读历史抽样 30 次 TodoWrite 均有完整 TodosUpdated 和 native plan，未证实正常原生计划普遍漏解析。模型实际调用 todo 才有任务，原 Grok prompt 缺少原生任务引导，出现率不能单独归因于解析。
- 工具身份优先 `_meta["x.ai/tool"].name`，兼容 TodoWrite variant、Todo 输出；通用 think/Updating plan 不用于确定工具类型。
- 仅成功后生成计划，优先 `TodosUpdated.todos` 完整输出，缺失时按默认 merge/ID 合并当前 prompt 内已知数据。merge:false 替换，空数组清空；未知 ID 的不完整补丁拒绝。
- 原生和派生计划共用内容去重；已应用或失败的 todo 终态拒绝迟到回退。每 prompt 新实例，回合完成清理，不增加跨回合缓存和磁盘轮询。
- 普通多步 Grok prompt 引导原生 todo_write、稳定 ID、中文描述；hidden retry 共用，机器协议 opt-out。沿用既有浮层、中英文文案和主题，无新增控件或自然语言 UI 字符串。

## 任务列表

Tasklist:
- [completed] 核对真实协议与任务展示链路
- [completed] 修复解析并补回归测试
- [completed] 完成真实 CLI、浏览器和文档验证

## 单元测试与构建

- `npm run build`：通过。
- `node --test dist/test/interactive/grok*.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptRuntimeCoreCoverage.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/webview/openCodeTaskListOverlay.test.js dist/test/loop/loopMainTaskListPolicy.test.js`：151/151 通过。
- 新增/更新协议名称优先级、成功完整输出、ID-only merge、替换/清空、原生去重、重复终态、失败/取消/中断、异会话、跨回合以及 prompt opt-out 回归。
- runner 集成断言验证回调完整列表、外部 session 拒绝、失败不清空、完成后迟到拒绝及下一轮无旧 ID 缓存。
- 未运行全仓单测；相关模块与共享宿主/浮层回归已通过，范围外并行修改保持原样。

## 真实 CLI 验证

- 命令：`node /tmp/sinitek-grok-tasklist-native-as8ZeB/verify.cjs`，退出码 0；临时脚本与目录已清理。
- 真实 CLI：`grok --no-auto-update --permission-mode bypassPermissions agent --no-leader --model sinitek-tasklist-local-fake stdio`，由当前编译后的 `GrokInteractiveRunner` 驱动。隔离 HOME/GROK_HOME/cwd、白名单环境和临时 fake key，macOS sandbox 限制网络仅 loopback、写入仅临时目录，本地 Chat Completions mock，不使用用户凭据或真实付费 API。
- 同回合执行：创建两项 → 省略 merge 的 `{id,status}` 更新 → 全完成 → invalid_status 失败 → merge:false 空数组。
- 四次成功每次一份完整 native plan、一次插件回调，done 序列 `[false,false] → [true,false] → [true,true] → []`。成功工具完整输出与 native plan 一致并去重。
- 非法状态工具 failed，保留错误正文，零 native plan/派生 plan/任务回调；当前列表不受失败输入影响。最终 stopReason=end_turn。
- Grok 在回合结束时会自动完成 in_progress 项，中间状态需同回合观察。验证不证明任意模型必定遵循任务提示。
- 子代理单独复核协议/工具/回放测试 51/51。dist 哈希前后一致；runner dispose 后确认 CLI 进程及组退出，本地 API 关闭。

## 浏览器验证与失败分流

- 命令：`node /tmp/sinitek-grok-tasklist-browser-server.cjs` 提供生产 `getWebviewHtml`，`node /tmp/sinitek-grok-tasklist-browser.cjs` 使用本机 Chrome 和已有隔离 Playwright；脚本、截图和服务在收尾清理。
- 使用隔离 VS Code 消息桥；真实填入提示、点击发送，生产 GrokReplayStream 派生列表进入原消息分发，再实际点击折叠/展开、Tab 与停止。
- 1280×1000、390×844 两种视口均通过 12 项流程：发送、创建、ID-only 进度、折叠更新/展开、Tab 隔离、全完成保持、停止清空、迟到拒绝、正常结束清空、Loop 主任务隐藏、空列表清空、错误结束。列表处于视口内；console/pageerror/失败请求/HTTP 错误均零。
- 验证脚本初次引用已不存在的 Playwright 临时路径，改用已安装目录；初次假设运行中发送按钮 disabled，实际支持追加输入，改用 stopRun 显示判断运行态。原生 details toggle 异步派发，脚本等待 toggle 处理后注入下一次更新。以上属于环境/夹具问题，未因此修改产品代码。
- 未启动 VS Code Extension Development Host，也未做付费真实模型任务；浏览器覆盖生产 Webview 与隔离消息桥，真实 CLI 单独验证协议和 runner。

## 文档、结构与记忆

- 同步 `.ch/docs/runbooks/grok-model-config.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/runbooks/PITFALLS.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 更新 `plugin.rule.grok_semantic_replay` 的 todo 状态、合并与来源引用；`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过（2 domains / 17 concepts / 16 relations / 43 rules / 2 workflows / 3 documents）。
- 最终源码再次 `npm run build` 与上述回归 151/151 通过；仅带 Updating plan 标题与 Todo 输出的身份恢复也通过桌面/窄屏浏览器完整交互复核。
- `git diff --check`、本次范围 `npm run validate:whitespace -- <源码、测试和文档路径>`、归档路径引用检查均通过。另一个已完成计划对本计划的历史基线引用同步到归档路径，保留当时位于 active 的事实。
- 可复用协议与排障经验已上提 runbook 和 PITFALLS，不重复写 EVENT_MEMORY；无需修改滚动摘要、画像和技能。执行计划归档到 `completed/2026-10/`。

## 当前结论

已完成协议核对、任务引导、识别/增量/终态修复和相关验证。原生 plan 是当前实时来源，模型是否调用 todo 决定是否建立列表；正常原生计划未被证实普遍漏解析。单步任务可省略列表，Loop 主任务按现有产品规则隐藏。
