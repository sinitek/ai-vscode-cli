# 避坑指南

这个文件用于沉淀 **已经真实踩过的坑**，而不是猜测性的“注意事项”清单。

目标只有一个：让后续的人或代理在遇到相同问题前，就能提前知道风险、触发条件、规避方式和验证方法。

## 记录原则

- 只有真实发生过、已确认会重复出现或有明显复发风险的问题，才写进来。
- 记录要写清楚“现象 → 条件 → 根因 → 规避方式 → 验证方法”，不要只写一句结论。
- 优先记录会反复浪费时间的问题，例如环境坑、脚手架坑、兼容性坑、发布坑、权限坑、隐式前置条件。
- 如果某个坑只属于某个子系统，也可以在对应目录下补充更贴身的文档，但这里应保留索引或摘要。
- 问题被彻底消除后，可以标记“已失效/已修复”，不要悄悄删除历史经验。

## 建议模板

```md
## <坑点标题>

- 状态：有效 / 已修复 / 仅历史版本有效
- 首次发现：YYYY-MM-DD
- 适用范围：模块 / 环境 / 脚本 / 版本

### 现象
- 看到什么报错、错误行为或异常结果？

### 触发条件
- 在什么前提下会出现？

### 根因
- 已确认的根因是什么？如果只是推断，要明确写“推断”。

### 临时绕过
- 当前如何快速恢复或继续推进？

### 长期规避
- 以后应该怎么做，才能避免再次踩坑？

### 验证方式
- 修改后如何确认这个坑已被规避？

### 关联资料
- 相关代码路径、runbook、issue、设计文档、外部链接
```

## 当前状态

- 当前为模板初始状态，等待目标项目按真实踩坑情况持续补充。

## 龙虾辩论阻塞共识被误读成任务断开

- 状态：已修复
- 首次发现：2026-06-18
- 适用范围：`debate_multi_agent` 龙虾任务收尾与排障

### 现象
- 最新辩论轮已经生成 `consensus.md` 和 `decision.json`，任务记录进入 `needs-review`，但界面或记录看起来像“没完全结束”。
- `estimatedRemainingRounds` 可能沿用上一轮数值，例如上一轮还有 2 轮，而本轮 `decision.json` 已写 `estimatedRemainingRounds=0`。

### 触发条件
- `consensus.reached=true`，但最终参与者 stance 仍有 `block` 或 `openDisagreements` 仍有 `severity=blocking`。
- 共识汇总器输出 `decision.status=blocked`，运行时在共识校验未通过分支进入人工复核。

### 根因
- 旧收尾逻辑把所有共识校验失败都写成“辩论未达成一致”，没有区分“达成阻塞共识”。
- 该分支没有从 `consensus.decision` 同步 `finalSummary` 和 `estimatedRemainingRounds`，导致排障时容易误判为任务中途断开。

### 临时绕过
- 查 `~/.sinitek_cli/lobster-communications/<taskId>/debates/round-*/decision.json` 的 `status`。
- 如果是 `blocked`，再看 `consensus.md` 的最终 stance 和 open blocking disagreement，而不是继续等待自动派发。

### 长期规避
- 人工复核摘要必须区分“未达成一致”和“达成阻塞共识”。
- 阻塞共识进入 `needs-review` 时，任务记录和 `main-task.md` 必须同步 `consensus.summary`、`decision.finalSummary` 和 `decision.estimatedRemainingRounds`。
- 龙虾群聊面板还必须在时间线末尾展示主持人 `error` 样式停止说明，避免用户误以为只是普通 transcript 收束后断开。

### 验证方式
- `node --test dist/test/lobsterDebate.test.js`
- `npm run build`
- 手工打开对应龙虾群聊，确认末尾存在 `主持人停止说明` 气泡。

### 关联资料
- 代码：`src/lobsterDebate.ts`、`src/extension.ts`
- 事实来源：`.ch/docs/references/cli-runtime-reference.md`

## Webview 定时刷新会重置未持久化的独立滚动容器

- 状态：已修复
- 首次发现：2026-06-18
- 适用范围：`src/webview/lobsterDebatePanel.ts` 这类通过重建 `webview.html` 刷新的面板

### 现象
- 龙虾群聊左侧“成员”列表向下滚动阅读时，经常在定时刷新或重新可见后回到顶部。
- 右侧群聊时间线能保留阅读位置，但左侧成员栏不能。

### 触发条件
- 面板存在多个独立滚动容器，例如 `.main` 时间线和 `.sidebar` 成员栏。
- 后端刷新状态时通过重新设置 `panel.webview.html` 重建页面。
- 只保存了其中一个滚动容器的位置。

### 根因
- Webview HTML 重建会丢弃 DOM 自身的 `scrollTop`。
- 旧实现只把 `.main` 的滚动位置写入 `vscode.setState()`，没有监听和恢复 `.sidebar`。

### 临时绕过
- 修复前只能等待刷新结束后手动把成员列表滚回原位置。

### 长期规避
- 通过 `panel.webview.html` 重建页面的 Webview，只要有多个独立滚动容器，就必须分别保存和恢复滚动状态。
- 手动刷新、定时刷新、`visibilitychange` 刷新和置底操作都应保留其它滚动容器的已有状态。

### 验证方式
- 在仓库执行：`npm run build` 与 `git diff --check`。
- 手工验证：打开龙虾群聊，把成员列表滚到下方，等待 5 秒自动刷新或点击刷新，确认成员列表不回到顶部。

### 关联资料
- 代码：`src/webview/lobsterDebatePanel.ts`
- 设计要求：`.ch/docs/design-docs/vscode-cli-extension-runtime.md` 中关于群聊面板刷新时保留阅读位置的说明。

## 龙虾群聊继续按钮不能走普通发送入口

- 状态：有效
- 首次发现：2026-06-18
- 适用范围：`src/webview/lobsterDebatePanel.ts`、`src/extension.ts` 的龙虾任务恢复链路

### 现象
- 中断未完成的龙虾任务从群聊 UI 点击“继续执行”时，如果只向 AI 对话输入框发送普通“继续”，可能找不到原任务或被当成新龙虾任务。
- 如果跳过确认框直接恢复，用户无法在恢复前补充“本次继续指令”，主持人/主任务也看不到这次额外说明。
- 历史任务尤其容易触发，因为当前活跃 tab 不一定就是原主任务 tab。

### 触发条件
- 入口来自独立内容区 WebviewPanel，而不是 AI 对话主任务 tab。
- 原任务主 tab 已关闭、不是当前活跃 tab，或任务只剩历史记录可查。

### 根因
- 普通发送入口依赖当前 tab 上下文推断可恢复的龙虾任务。
- 群聊面板已经明确持有 `taskId`，但如果不把该 ID 传给 `runLobsterPrompt(..., { resumeTaskId })`，恢复链路会退化为“按当前 tab 猜测任务”。

### 临时绕过
- 修复前手动打开原主任务 tab，再输入“继续/continue/resume”。

### 长期规避
- 从群聊 UI、历史列表、命令参数等明确持有 `taskId` 的入口恢复龙虾任务时，必须传 `resumeTaskId`，并复用或创建主任务 tab。
- 群聊 UI 的继续入口必须先显示可编辑确认框；默认值可以是“继续”，但用户确认前不能发起恢复。确认后的文本要作为“本次继续指令”注入主任务提示或辩论 brief。
- 历史列表的“加载”只打开群聊 UI，不应自动继续任务；继续任务必须由用户在群聊 UI 再显式点击“继续执行”。

### 验证方式
- 打开一个 `error` / `stopped` / `needs-review` 的龙虾任务群聊，点击“继续执行”，确认先出现可编辑确认框；修改默认文案并确认后，复用同一任务 ID 且主任务/主持人继续判断下一步。
- 打开历史记录的“龙虾群聊” tab，点击“加载”，确认只打开群聊 UI，不自动发起恢复。

### 关联资料
- 代码：`src/extension.ts`、`src/webview/lobsterDebatePanel.ts`、`src/webview/viewContent.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-06-18-lobster-chat-continue-history.md`

## 龙虾群聊中止按钮不能只停当前 tab

- 状态：有效
- 首次发现：2026-06-18
- 适用范围：`src/webview/lobsterDebatePanel.ts`、`src/extension.ts` 的龙虾任务停止链路

### 现象
- 运行中的龙虾任务可能同时有主任务、并发子任务、辩论主持人、参与者或共识汇总器在不同 tab 运行。
- 如果群聊 UI 的“中止”只调用当前 tab 的普通 `stopRun`，会遗漏同一龙虾任务的其他运行进程，群聊仍会继续刷新出新消息。

### 触发条件
- 从独立龙虾群聊 WebviewPanel 点击中止。
- 同一 `lobsterTaskId` 下存在多个 parallel 或 interactive 运行。

### 根因
- 普通停止入口以 `tabId` 为边界；龙虾群聊 UI 的真实边界是 `lobsterTaskId`。

### 长期规避
- 群聊中止入口必须按 `lobsterTaskId` 遍历 active / parallel / interactive 运行并逐一停止。
- 运行中显示“中止”按钮；无运行且未完成时才显示“继续执行”按钮，两者必须互斥出现。
- 停止后要把任务记录标记为 `stopped`，清空 active 子任务，并刷新已打开的龙虾群聊面板。

### 验证方式
- 启动一个有多个并发子任务或辩论参与者的龙虾任务，打开群聊面板点击“中止”，确认所有相关 tab 停止，任务记录状态为 `stopped`，群聊面板随后显示“继续执行”而不是“中止”。

### 关联资料
- 代码：`src/extension.ts`、`src/webview/lobsterDebatePanel.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-06-18-lobster-chat-stop-task.md`

## Claude 新版任务工具不会自动落到 AI 对话面板任务列表

- 状态：已修复
- 首次发现：2026-06-12
- 适用范围：`src/interactive/claudeRunner.ts`、AI 对话面板任务列表展示链路

### 现象
- Claude 分组执行任务时，面板右侧“任务列表 / Task List”一直为空。
- 同一轮 Claude 实际已经创建了 `TaskCreate` / `TaskUpdate` 工具任务，导出的流式日志能看到任务创建和状态更新。

### 触发条件
- 使用较新的 Claude Code / SDK 工具集，任务管理不再只走 `TodoWrite`。
- Claude 流里出现 `TaskCreate`、`TaskUpdate`、`TaskList`、`TaskGet`、`TaskStop` 等工具事件。

### 根因
- 旧实现只识别 `TodoWrite` 的 `todos/newTodos/oldTodos` 结构，并直接映射到面板的 `{ text, done }`。
- 新版 Claude 任务工具改成了 `Task*` 系列，输入和结果里使用 `taskId`、`subject`、`statusChange`、`tasks[]` 等不同字段，导致扩展完全跳过了这些事件。

### 临时绕过
- 修复前只能依赖 assistant 文本里的 `tasklist:` 段落回退提取；如果 Claude 没输出该文本段落，面板就不会显示任务列表。
- 也可以手工导出 run stream，从日志中查看 `TaskCreate` / `TaskUpdate` 事件确认真实执行情况。

### 长期规避
- Claude 交互 Runner 需要把 `TodoWrite` 和 `Task*` 工具事件统一归一化到同一份任务列表协议。
- 任务列表解析应独立成纯函数/状态跟踪模块，避免把 Claude 协议分支散落在 webview 层。

### 验证方式
- 在仓库执行：`npm run build` 与 `node --test dist/test/claudeTaskList.test.js`。
- 使用 Claude 分组复现一次包含 `TaskCreate` / `TaskUpdate` 的任务，确认 AI 对话面板任务列表会实时出现并在完成后勾选。

### 关联资料
- 日志样例：`~/.sinitek_cli/temp/1781243579877_86147ad9_sinitek-run-stream-2026-06-12T05-51-47-606Z.txt`
- 代码：`src/interactive/claudeRunner.ts`、`src/interactive/claudeTaskList.ts`

## Webview HTML 模板字符串里写正则时，反斜杠必须双重转义

- 状态：已修复
- 首次发现：2026-06-11
- 适用范围：`src/webview/viewContent.ts` 这类通过模板字符串直接生成 HTML/JS 的 Webview 页面

### 现象
- 插件面板启动即报错：
  `Uncaught SyntaxError: Failed to execute 'write' on 'Document': Invalid or unexpected token`
- `npm run build` 可以通过，但 Webview 仍然白屏或无法启动。

### 触发条件
- 在 `getWebviewHtml()` 的模板字符串里直接写浏览器侧正则字面量。
- 正则包含 `\s`、`\d`、`\/` 这类需要反斜杠的片段，但在 TypeScript 模板字符串里只写了一层转义。

### 根因
- Webview 页面不是单独的 `.js` 文件，而是先由 TypeScript 模板字符串生成 HTML，再由浏览器解析其中的内联脚本。
- 如果在模板字符串里写 `/^\s*...\/...$/`，第一层字符串解析会先吃掉反斜杠，最终浏览器拿到的是损坏的正则源码，例如 `\s` 变成 `s`，`\/` 变成 `/`，导致脚本语法错误。

### 临时绕过
- 把可疑正则改回 `startsWith/includes` 一类纯字符串判断，先确认是否由模板转义导致。
- 也可以先导出生成后的 HTML，用脚本单独解析内联 `<script>` 复现真正的语法错误位置。

### 长期规避
- 在 Webview HTML 模板字符串里写正则时，统一使用双重转义：`\\s`、`\\d`、`\\/`。
- 对复杂浏览器侧脚本，优先考虑下沉到独立 `.js` 文件，而不是继续堆在超长 HTML 模板字符串里。
- 修改后除了 `npm run build`，再对生成后的内联脚本做一次语法解析验证。

### 验证方式
- 在仓库执行：`npm run build`。
- 然后基于 `dist/webview/viewContent.js` 生成 HTML，抽取每个 `<script>`，用 `vm.Script` 或浏览器 DevTools 再做一次语法解析，确认所有内联脚本都能 parse。

### 关联资料
- 代码：`src/webview/viewContent.ts`
- 本次修复点：隐藏重试消息匹配正则的模板转义

## 模型下拉偶发只剩“默认/管理”时不要静默吞掉状态错误

- 状态：已修复
- 首次发现：2026-05-26
- 适用范围：`src/extension.ts` 的模型状态心跳、`src/webview/viewContent.ts` 的模型管理入口

### 现象
- AI 对话面板底部模型下拉偶发只剩“默认”和“管理”。
- 此时打开“管理模型”弹窗，原本已配置的模型列表也为空。
- 切换 CLI 分组后再切回，或重新加载 VS Code 插件后模型又恢复。

### 触发条件
- 已在模型管理中维护过模型。
- 运行中心跳刷新配置/模型状态时，模型存储读取或当前配置档案判定出现临时异常。
- 上方 conversation tab 切换后，后端短暂返回 `activeConfigId = null`，但前端仍保留一个有效的配置下拉选择。
- 输入框 `Shift+Enter` 换行本身不发送任务；如果刚好遇到 5 秒配置心跳推送空模型快照，用户侧会误以为是换行操作触发了模型列表清空。

### 根因
- 已确认的事实：模型列表存储在 `~/.sinitek_cli/models.json`，并按当前配置档案 id 分组。
- 已确认：临时读取 `models.json` 失败，或当前配置档案 id 被刷新为 `null` 时，旧逻辑会把空模型状态推给 webview，用户侧只能看到空列表。
- 已确认：前端 `autoAppliedConfig` 只在 CLI 分组变化时重置，conversation tab 变化不会重置；如果此时 `activeConfigId` 为空但配置下拉仍有有效选择，旧逻辑只保留选择，不会再次走 `applyConfig` 刷新模型状态。
- 已确认：后端 `loadConfigState()` 在当前 CLI 文件暂时匹配不到任何配置档案时，会删除仍存在的工作区首选配置 id；随后 `buildModelState()` 使用 `null` 配置 id 读取模型，导致 webview 收到空数组。

### 临时绕过
- 切换 CLI 分组后再切回，触发现有配置初始化路径。
- 重新加载 VS Code 窗口或插件通常可以恢复。
- 检查 `~/.sinitek_cli/models.json` 是否仍包含对应配置 id 下的模型列表。

### 长期规避
- 模型存储读取失败时保留当前内存模型状态，不用空对象覆盖面板。
- 当前 CLI 文件暂时匹配不到配置档案时，只要工作区首选配置 id 仍存在于配置列表，就继续用它作为模型状态读取上下文，不要立刻删除。
- webview 收到当前 CLI 的空模型快照时，如果前端已有有效模型且配置状态缺失或不一致，应保留最后有效列表；正常配置下用户主动删空模型时仍允许空列表生效。
- 点击“管理模型”时，如果前端空列表与磁盘/运行态不一致，弹出可复制诊断详情，记录配置 id、存储路径、模型计数和最近错误。
- `applyState()` 应同时监听 CLI 分组和 active conversation tab 变化，tab 切换时也重置自动应用配置的保护标记。
- 当后端 `activeConfigId` 为空但前端已有有效配置选择时，应复用现有 `applyConfig` 路径恢复配置/模型状态，不要只静默保留下拉选择。

### 验证方式
- 在仓库执行：`npm run build`。
- 手工验证：构造模型存储读取异常或配置 id 不一致时，点击“管理模型”能看到错误详情；正常空列表不弹诊断。
- 手工验证：在多个 conversation tab 间切换，确认底部模型下拉不会长期停留在只剩“默认/管理”；若配置状态短暂为空，应自动恢复到已配置模型列表。

### 关联资料
- 代码：`src/extension.ts`、`src/webview/viewContent.ts`、`src/webview/types.ts`

## 后台压缩任务必须绑定原始 conversation tab

- 状态：已修复
- 首次发现：2026-05-21
- 适用范围：`src/extension.ts` 的自动/手动上下文压缩运行态

### 现象
- 任务成功结束后触发自动压缩，界面已经显示上下文压缩完成，但对应 tab 仍然显示“执行中”。
- 此时点击终止任务没有效果，看起来像任务卡死。

### 触发条件
- 开启“执行后自动压缩上下文”。
- 在已有 Codex / Claude / Gemini 会话中运行任务，任务成功结束后进入自动压缩。
- 压缩期间或压缩结束时，前端运行态事件没有稳定携带原始 `tabId`。

### 根因
- 压缩逻辑复用全局 `runContextCompaction()` 运行态，但启动压缩任务时没有设置 `activeTabIdForRun`。
- `runStatus` 消息因此会落到前端当前激活 tab，而后端 `stopRunForTab()` 又依赖 `activeTabIdForRun` 反查可停止的全局运行，导致 UI 状态和后端运行态脱节。
- Gemini 压缩还会设置 `activeProcess`，如果停止入口先命中 `activeInteractiveStop`，旧逻辑不会杀掉底层进程。

### 临时绕过
- 修复前可以关闭“执行后自动压缩上下文”，或者切换会话/重新加载窗口清理错误的前端运行态。

### 长期规避
- 所有会发出 `runStatus` 的后台任务都必须在启动时绑定原始 `tabId`，确保前后端对同一个 tab 开始、结束、停止。
- 可停止的后台任务在 stop 回调里必须同时处理交互 runner 和底层 `activeProcess`。
- 异步任务被停止后，后续返回的旧 cleanup 必须校验 `runId`，避免覆盖新运行态或错误 tab。

### 验证方式
- 在仓库执行：`npm run build`。
- 手工验证：开启执行后自动压缩，运行已有会话任务，确认压缩完成后 tab 不再显示运行中；压缩期间点击终止，状态能结束且不会继续卡住。

### 关联资料
- 代码：`src/extension.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-05-21-auto-compact-after-run.md`

## Codex 上游返回 HTTP 200 但 SSE `event:error` 为限流时，不能按成功回合处理

- 状态：已修复
- 首次发现：2026-05-07
- 适用范围：`src/interactive/codexRunner.ts` 的 Codex app-server `method=error` / `item.type=error` 事件处理

### 现象
- Codex 回合最终显示为正常完成，没有进入 hidden retry。
- 但上游 request log 明确出现 `text/event-stream` 的 `event:error`，内容是 `rate_limit_error`（例如 `Concurrency limit exceeded for user, please retry later`），随后又跟了 `response.completed`。
- 结果是“HTTP 200 + completed”掩盖了真实失败，用户只能看到任务中断或无结果。

### 触发条件
- 上游 Responses SSE 在同一回合中先返回限流错误事件，再返回 completed 事件。
- Codex app-server 把该事件透传为普通 `error` notification，且回合状态仍可能是 completed。

### 根因
- 旧逻辑仅在 `turn/completed.status === failed`、进程退出异常、或显式抛错时才 failRun。
- 对 `method=error` / `item.type=error` 只写 trace，不会把“限流类错误”提升为失败。

### 临时绕过
- 修复前只能手动重试，或从 request-log / stream-log 人工确认是否是限流伪成功。

### 长期规避
- 在 Codex interactive runner 中增加限流错误分类：识别 `rate_limit_error`、`concurrency limit exceeded`、`too many pending requests`、`HTTP 429` 等信号。
- 命中后立即 `failRun` 并终止当前回合，让现有 hidden retry 逻辑接管。

### 验证方式
- 在仓库执行：`npm run build` 与 `node --test dist/test/codexErrorClassifier.test.js`。
- 手工验证：构造含 `event:error(rate_limit_error)` + `response.completed` 的上游包，确认插件把该轮标记为失败并触发自动重试提示。

### 关联资料
- 代码：`src/interactive/codexRunner.ts`、`src/interactive/codexErrorClassifier.ts`
- 样例包：`~/.sinitek_cli/temp/1778131225923_7640e3f1_request-log-2026-05-07T13-13-49-08-00-c2e331cb-7b63-4b32-9b67-ef7d824ce819.json`

## Gemini thinking 不能继续依赖运行时改写工作区 `.gemini/settings.json`

- 状态：已修复
- 首次发现：2026-04-26
- 适用范围：`src/extension.ts`、`src/cli/geminiThinking.ts` 的 Gemini headless 运行链路

### 现象
- 插件每次运行 Gemini 前都会改写工作区 `.gemini/settings.json`，把 thinking 设置塞进 `modelConfigs`。
- 运行结束后该文件会残留在项目里，污染用户工作区；切换分支、在终端直接运行 Gemini CLI，或者团队共享仓库时都容易出现“配置来源不明”的问题。
- 对 Gemini 3 Pro 这类不能真正关闭 thinking 的模型，旧链路还会把 `off` 误退化成“删掉文件”，实际效果并不可靠。

### 触发条件
- 使用插件运行 Gemini，且选择任意 thinking mode。
- 旧逻辑命中 `applyGeminiThinkingSettings()`，直接写工作区 `.gemini/settings.json`。

### 根因
- Gemini CLI 当前公开文档没有独立 `--thinking-level` / `--thinking-budget` 命令行参数。
- 旧实现为了模拟“请求级 thinking 参数”，错误地把工作区 settings 文件当成运行时临时参数通道。

### 临时绕过
- 修复前只能手动删除项目里的 `.gemini/settings.json`，并避免让插件继续以旧链路写入。

### 长期规避
- 不再运行时改写工作区 `.gemini/settings.json`。
- 通过 `GEMINI_CLI_SYSTEM_SETTINGS_PATH` 注入临时 system settings 覆盖层，在里面声明一次性的 `modelConfigs.customAliases`，再用 `-m/--model` 选择 alias。
- 对 Gemini 2.5 / 3 系列的 thinking 差异做显式映射；对不支持的模型（例如 `flash-lite`）直接 passthrough，不伪造参数。

### 验证方式
- 在仓库执行：`npm run build` 与 `node --test dist/test/geminiThinking.test.js`。
- 手工验证：运行 Gemini 前后检查工作区不再生成或更新 `.gemini/settings.json`；命令实际使用 `-m sinitek-*` alias。

### 关联资料
- 代码：`src/cli/geminiThinking.ts`、`src/extension.ts`、`src/cli/commandRunner.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-04-26-gemini-thinking-alias-migration.md`

## CLI 分组切换不能全局 dispose interactive runner

- 状态：已修复
- 首次发现：2026-04-25
- 适用范围：`src/extension.ts` 的 conversation tab 分组切换、历史会话切换链路

### 现象
- 多个 conversation tab 并发任务时，在某个 tab 切换 CLI 分组（例如切到 Gemini）或切换历史会话，会把其他 tab 中仍在执行的 Codex / Claude 任务直接打断。
- 用户侧通常表现为 Codex / Claude 任务突然断流，随后出现 `run.disposedExternally` 一类外部释放错误。

### 触发条件
- 至少有一个 Codex / Claude interactive 任务正在运行。
- 另一个 tab 触发 `selectCli` 或 `selectSession` 消息。
- 扩展在这些 UI 事件里无条件执行 `interactiveRunnerManager.disposeAll()`。

### 根因
- 分组切换和历史会话切换属于单 tab 的状态切换，但旧逻辑把 runner 清理做成了全局释放。
- 交互式 runner 由 `InteractiveRunnerManager` 统一托管；一旦全局 `disposeAll()`，其他 tab 中正在执行的 runner 也会被一并销毁。

### 临时绕过
- 修复前只能避免在其他 tab 仍有 Codex / Claude 长任务运行时切换 CLI 分组或切换历史会话。

### 长期规避
- runner 回收必须按 `cli + sessionId` 精确判断，只能释放既不被任何 tab 的 `sessionIdByCli` 引用、也不在当前运行态中的 interactive session。
- 对会话切换、多 tab 并发隔离这类场景补最小回归测试，避免以后再次回到全局 `disposeAll()`。

### 验证方式
- 在仓库执行：`npm run build` 与 `node --test dist/test/runnerRetention.test.js`。
- 手工复现：Tab A 运行 Codex / Claude，Tab B 切到 Gemini 或切换历史会话，确认 Tab A 持续输出且不会收到外部释放错误。

### 关联资料
- 代码：`src/extension.ts`、`src/interactive/runnerRetention.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-04-25-multi-tab-run-isolation.md`

## Interactive Runner 不能依赖全局 currentKey 表示当前运行会话

- 状态：已修复
- 首次发现：2026-04-24
- 适用范围：`src/interactive/manager.ts`、`src/extension.ts` 的 Codex / Claude 多 Tab 交互式运行链路

### 现象
- 多 Tab 并发运行时，某个 Tab 的 Runner 生命周期操作可能落到另一个最近触碰过的 Tab / session 上。
- 当前主要表现为 idle timer / lastUsedAt 状态串扰风险；如果后续在 begin/end 中加入 stop、dispose 或资源释放逻辑，会升级为跨 Tab 中断风险。

### 触发条件
- 同时存在多个 Codex / Claude 交互式会话运行或快速切换。
- `InteractiveRunnerManager` 使用全局 `currentKey`，而 `beginActiveRun()` / `endActiveRun()` 通过 `getCurrent()` 查找目标 Runner。

### 根因
- 多 Tab 并发没有唯一“当前 Runner”。
- `getOrCreate*Runner()` 和 `setCurrentRunner()` 会覆盖同一个全局 `currentKey`，导致较早启动的任务在收尾时可能操作较晚启动的 Runner entry。

### 临时绕过
- 修复前避免在多个 Tab 中同时触发 Codex / Claude 长任务，尤其避免运行中频繁切换会话或执行上下文压缩。

### 长期规避
- Runner 生命周期操作必须显式携带 `cli + sessionId`，不要依赖全局 current 状态。
- 新增 RunnerManager API 时，优先设计成显式 key / token；除非 UI 单例态非常明确，否则不要引入“当前运行中 Runner”的全局缓存。

### 验证方式
- 全局搜索确认不再存在 `InteractiveRunnerManager.currentKey`、`getCurrent()`、`setCurrentRunner()`。
- 在仓库执行：`npm run build`。

### 关联资料
- 代码：`src/interactive/manager.ts`、`src/extension.ts`

## Interactive 历史会话被 local 临时 ID 污染，恢复后出现 invalid thread id

- 状态：已修复
- 首次发现：2026-04-15
- 适用范围：`src/extension.ts` 的 Codex / Claude 交互式会话历史恢复链路

### 现象
- 历史会话列表里会出现 `local_*` 临时会话。
- 恢复这类历史会话后，可能看不到完整历史消息。
- 在该会话继续发送消息时，Codex 报错：`invalid thread id ... found 'l' at 1`。

### 触发条件
- 交互式会话开始后，真实 thread/session id 尚未返回前，扩展先创建了 `local_*` 临时会话并落盘。
- 真实 id 返回后，没有把 local 会话稳定迁移/合并到真实会话。

### 根因
- local 临时会话用于承接首条消息的落盘，但真实 id 到达时只更新了当前运行态，没有清理历史里的 local 会话副本。
- 历史恢复时如果继续选中了 local 会话，后续续接会把 `local_*` 误当成真实 Codex thread id。

### 临时绕过
- 修复前可手动删除 `local_*` 历史项，改选对应的真实 UUID 会话；若没有真实会话，只能查看历史，不能继续回复。

### 长期规避
- 真实 thread/session id 到达时，立即把 local 会话消息迁移/合并到真实会话并移除 local 历史项。
- 恢复历史会话前，先尝试把 local 会话修复到真实会话；如果确实没有真实远端 id，则直接阻止继续回复并提示原因。

### 验证方式
- 构造 local 会话 + 真实 UUID 会话同时存在的样本，验证会命中真实会话并合并完整消息。
- 在仓库执行：`npm run build` 与 `node scripts/validate_history_session_fix.js`。

### 关联资料
- 代码：`src/extension.ts`、`src/interactive/sessionHistoryRepair.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-04-15-history-session-local-thread-merge.md`

## Codex 协作子任务 wait 超时只回传 timed_out，AI 对话里没有明确错误

- 状态：已修复
- 首次发现：2026-04-21
- 适用范围：`src/interactive/codexRunner.ts` 的 Codex app-server 流式事件解析链路

### 现象
- Codex 在开启 explorer / worker 子任务后，主任务执行到 `wait` 时可能中途结束或停住。
- 日志里可能只能看到回合结束，AI 对话气泡里没有明确错误。
- 真实超时结果可能只是工具输出 `{"status":{},"timed_out":true}`，不是顶层业务异常。

### 触发条件
- Codex 使用协作子任务工具（例如 `spawn_agent` / `wait`）。
- `wait` 返回的是超时结果而不是抛错。
- 插件只解析传统 `item/started` / `item/completed` 条目，没有消费 `rawResponseItem/completed` 中的工具原始输出。

### 根因
- Codex app-server 新增了 `rawResponseItem/completed`、`collabAgentToolCall` 等协作相关事件。
- 插件旧逻辑没有识别这些新事件，因此 `wait` 的超时结果不会被转成用户可见错误。
- `account/rateLimits/updated` 这类账号配额通知只是普通 notification，不会直接导致中断；真正的问题是协作工具超时结果没有上屏。

### 临时绕过
- 修复前只能从 debug/流式日志里人工寻找 `timed_out`、`collab`、`turn.completed` 等线索。

### 长期规避
- 解析 `rawResponseItem/completed`，记录 function/custom tool 的 `call_id -> toolName` 映射。
- 当 `wait` 的原始工具输出包含 `timed_out: true` 时，立即转成 AI 对话中的明确错误。
- 同时解析 `collabAgentToolCall`，把明确的子任务失败状态也映射为对话内错误。

### 验证方式
- 在仓库执行：`npm run build` 与 `node scripts/validate_codex_collab_timeout.js`。
- 如需手工验证，可构造一次使用 explorer 子任务并等待超时的 Codex 回合，确认 AI 对话出现错误提示。

### 关联资料
- 代码：`src/interactive/codexRunner.ts`、`src/interactive/codexAppServerEvents.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-04-21-codex-collab-wait-timeout-surface.md`

## Codex item.started / item.completed 的 trace 内容不稳定，不能只按 id 抢占去重位

- 状态：已修复
- 首次发现：2026-04-23
- 适用范围：`src/interactive/codexRunner.ts`、`src/interactive/codexAppServerEvents.ts` 的 Codex app-server trace 事件解析链路

### 现象
- 原始流式日志里能看到多条 `item.started` / `item.completed` 事件。
- 聊天区可能缺少关键 trace，或者先显示一个空洞/弱信息 trace，后续更完整的 completed trace 又没有出现。
- 首个真实暴露案例是 `web_search`：明明发生了网络查询，聊天区却没有对应过程气泡。

### 触发条件
- Codex app-server 对同一个条目会分 started / completed 两阶段发送事件，但两阶段内容不保证同样完整。
- 某些类型在 started 阶段可能只有 `id` 或弱信息，completed 阶段才补足真实内容；首个明确案例是 `web_search` 的 `query` 只在 completed 才完整。
- 旧逻辑只要看到 started 就可能先按 `id` 去重，导致 completed 即使内容更完整也被视为“已经上过屏”。

### 根因
- started/completed 的职责更接近“生命周期阶段”，不是“内容稳定快照”。
- 旧逻辑把多个 trace 类型的去重都建立在“同类型同 id 只上屏一次”的假设上，但这个假设并不稳。
- 一旦 started 阶段内容为空、过弱，或者 completed 阶段才补足重要字段，就会出现“started 抢占 completed 上屏机会”的误判。

### 临时绕过
- 修复前只能打开“流式消息”或导出 run stream，手工对照 started/completed 事件找丢失的 trace 细节。

### 长期规避
- 不再只按 `id` 抢占 trace 去重位，而是改成“事件阶段 + 有效内容 + 已上屏内容签名”的组合判定。
- `web_search` 继续只在 completed 且有有效查询内容时才产出 trace，并兼容 `item.query`、`action.query`、`action.url`。
- 对 `command_execution`、`mcp_tool_call` 等 started/completed 类型，也要求 started 至少要有足够识别内容才允许上屏；同内容不重复上屏，completed 内容更完整时不能被吞掉。
- 对这条通用规则补最小回归脚本，防止后续协议调整时再次静默回归。

### 验证方式
- 在仓库执行：`npm run build` 与 `node scripts/validate_codex_item_trace_candidates.js`。
- 如需手工验证，可触发一次带联网检索、命令执行或 MCP 调用的 Codex 回合，确认 started 空内容不会吞掉 completed 的真实 trace。

### 关联资料
- 代码：`src/interactive/codexRunner.ts`、`src/interactive/codexAppServerEvents.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-04-23-codex-web-search-trace-gap.md`、`.ch/docs/exec-plans/completed/2026-04-23-codex-trace-type-hardening.md`

## VS Code 插件用 shell + detached 启动 Codex app-server，长任务更容易表现为“莫名中断”

- 状态：已缓解
- 首次发现：2026-04-23
- 适用范围：`src/interactive/codexRunner.ts`、`src/interactive/manager.ts`、`src/extension.ts` 的 Codex 交互式运行链路（尤其是 macOS）

### 现象
- 用户在 VS Code 插件里执行较长的 Codex 任务时，会感觉任务“突然中断”或“莫名结束”。
- 对比目标系统 `/Users/fangjiawei/work/cli_mcp/apps`，同机环境下其 Codex 任务稳定性明显更高。
- 当前插件侧通常拿不到像目标系统那样清晰的原始流与生命周期日志，因此现象容易被感知为“无原因中断”。

### 触发条件
- 在当前插件中执行 Codex 交互式任务。
- 运行环境为 macOS，且 `src/interactive/codexRunner.ts` 通过 `zsh -lc` 启动 `codex app-server`。
- 任务较长、需要继续续接、涉及更多工具/网络搜索，或运行中碰到 runner rebuild / dispose / stop 相关边界事件。

### 根因
- 已确认的代码差异：
  - 当前插件在 macOS 上通过 shell 包一层启动，并设置 `detached: true`。
  - 当前插件直接继承 `process.env`，没有显式固定 `CODEX_HOME` / `CODEX_HOME_DIR`，也没有清理 `npm_config_prefix`。
  - 当前插件没有像目标系统那样在启动前确保 project trust，也没有注入 `projects.<path>.trust_level="trusted"` override。
  - 当前插件收尾时更依赖 `killProcessTree()` 粗暴结束进程组；目标系统则是“先关 stdin，等待 close，再升级信号”的优雅关闭。
- 推断的主因：以上差异叠加后，当前插件的运行链路比目标系统多了 shell 副作用、环境污染、进程组信号复杂度和粗暴销毁四类不稳定因素，因此更容易把真实退出表现成“莫名中断”。

### 临时绕过
- 优先把 `sinitek-cli-tools.commands.codex` 配成绝对可执行路径，减少 shell 解析的不确定性。
- 稳定性优先时，先关闭不必要的高风险能力，例如默认 web search；避免在任务运行中切换 CLI、切会话、清会话或触发会导致 runner dispose 的操作。
- 如需继续排查，优先和目标系统使用相同的 `CODEX_HOME`、相同的 Codex 可执行路径与相同的 run mode 做对比。

### 长期规避
- 2026-04-23 已完成第一轮缓解：当前插件已改为优先直接 `spawn` 已解析的 Codex 可执行文件，不再默认启用 `detached`，并补齐 `CODEX_HOME` / project trust / 渐进式关闭。
- 如后续仍有零星中断，优先继续补 raw stream / lifecycle 日志，确认是否仍有 shell fallback、外部 CLI 自身退出或 UI 侧误触发 dispose。

### 验证方式
- 对当前插件完成最小改造后，执行一次长时 Codex 交互任务，确认不中途退出。
- 在同一工作区下对比改造前后：子进程启动参数、关闭方式、`CODEX_HOME`、project trust 配置和日志是否与目标系统对齐。
- 最小交付前执行：`npm run build`。

### 关联资料
- 当前系统代码：`src/interactive/codexRunner.ts`、`src/interactive/manager.ts`、`src/extension.ts`
- 对标系统代码：`/Users/fangjiawei/work/cli_mcp/apps/backend/src/infra/codex/CodexAppServerClient.ts`、`/Users/fangjiawei/work/cli_mcp/apps/backend/src/infra/codex/CodexExecClient.ts`
- 执行计划：`.ch/docs/exec-plans/completed/2026-04-23-codex-launch-compare.md`
