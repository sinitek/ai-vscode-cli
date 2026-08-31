# 避坑指南索引

这个文件用于记录仍有行动价值的真实踩坑。starter 默认不预置条目，也不为空内容预建模块分片。

历史复盘（已修复、已废弃、仅历史版本有效）先放在 [PITFALLS_HISTORY.md](./PITFALLS_HISTORY.md)。

## 记录原则

- 只记录真实发生过、已确认会复发或仍需长期防回归的问题。
- 每个条目必须写清楚“现象 → 触发条件/根因 → 长期规避 → 验证方式”。
- 如果问题已经被彻底修复或方案已废弃，不再留在主文件，迁移到历史归档。
- 条目状态尽量使用可执行语义：`有效`、`需部署时检查`、`已规避`、`需观察`。
- 同一主题超过 5 条仍有效条目，或单文件超过约 300 行时，再拆出专题文件并在本页建立索引。

## 当前有效条目

## 配置切换下拉显示不能先于宿主提交完成

- 状态：已规避，需随配置提交 / 发送链路变化复核
- 首次发现：2026-08-28
- 适用范围：AI 对话面板配置档案下拉、`src/extension.ts`、`src/sessionMessageHandlers.ts`、`src/sessionMessageActions.ts`、`src/webview/viewContentScript/*`

### 现象
- 用户在 AI 对话里切换配置后，下拉选项已经显示为新配置，但紧接着发送 prompt 时，实际运行偶发仍使用旧配置。
- 如果切换失败，界面还可能短暂保持新选择，直到后续状态刷新才回到真实 active config。

### 触发条件与根因
- Webview 先乐观更新 `selectedConfigId`，而宿主侧 `applyConfig` 是异步提交，`activeConfigIdByCli` 只有在提交成功后才会写回。
- 早期发送路径或队列出队会直接读取 active config / heartbeat 快照，导致“下拉已切过去、实际还没切”的窗口被命中。
- 快速连续切换时，晚到的旧请求如果没有被显式标记为 superseded，可能把新选择覆盖回旧提交结果。

### 长期规避
- 配置切换必须先进入待生效态，只有宿主完成提交并回写 active config 后，才允许新的 prompt 发送或队列出队。
- 同一 CLI 的配置应用采用 latest-selection-wins；被新选择覆盖的旧请求必须返回 `superseded`，不得提交过期 active config。
- 配置应用失败后要把 Webview 回滚到当前真实 active config，并保留用户输入，不要伪装成已切换成功。
- 成功或失败回包都要按 `cli + configId` 清理对应 pending 状态；不能只在当前 CLI 匹配时清理，否则用户切到其他 CLI 后再回来会被旧 pending 卡住。
- 任何读取 `activeConfigIdByCli` 的发送、队列和模型解析逻辑，都应优先判断是否仍存在 pending 配置应用。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/config/configApplyQueue.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`。
- 手动复现：快速切到新配置后立刻发送 prompt，确认下拉先显示待生效项、发送被暂缓，提交完成后才真正运行；失败时回滚到旧 active config。

### 关联资料
- `src/config/configApplyQueue.ts`
- `src/extension.ts`
- `src/extensionHost/modelSettings.ts`
- `src/sessionMessageActions.ts`
- `src/sessionMessageHandlers.ts`
- `src/webview/viewContentScript/modelAndPanelState.ts`
- `src/webview/viewContentScript/runStreamAndQueue.ts`
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/webview/viewContentScript/windowMessageDispatch.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## OpenCode 模型选择消息必须绑定配置 ID

- 状态：已规避，需随 OpenCode 模型选择或配置心跳链路变化复核
- 首次发现：2026-08-25
- 适用范围：AI 对话面板 OpenCode 主/子模型选择、Webview 消息、配置心跳与 `src/sessionMessageHandlers.ts`

### 现象
- 用户在 AI 对话面板切换 OpenCode 模型后，选择偶发失败，面板刷新后又显示配置默认模型。

### 触发条件与根因
- Webview 原先只发送模型引用，不携带用户当前选择的配置 ID。
- 扩展端异步处理消息时重新读取 active config；配置切换或心跳刷新竞争会让同一个模型选择被校验/写入另一个配置，随后状态回显为默认模型。

### 长期规避
- OpenCode 主/子模型选择消息必须携带 `state.selectedConfigId`，扩展端优先使用消息中的配置 ID；仅对旧消息回退到 active config。
- Webview 必须按配置 ID、模型角色和有效模型引用暂存未确认选择；同一配置的旧状态快照在尚未回显该引用前不得覆盖本地选择。选择配置默认值时暂存其有效默认引用，而不是已清除的 `null` 覆盖值。
- 仍须使用当前配置的 `validateOpenCodeModelOverride` 校验 exact provider/model 引用，不把模型名写入全局或通用 Codex 选择存储。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/openCodeThinkingWebview.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/extensionHost/opencoderolemodelruntime.test.js`。
- 检查选择消息包含 `configId`，确认宿主显式配置 ID 优先于 active config fallback，并断言旧快照不会把刚选择的 `gpt-5.5` 覆盖为 `gpt-5.6-sol`。

### 关联资料
- `src/webview/viewContentScript/eventBindings.ts`
- `src/sessionMessageHandlers.ts`
- `src/extensionHost/modelSettings.ts`
- `src/test/session/sessionMessageActions.test.ts`
- `src/test/webview/opencodedualmodelwebview.test.ts`

## Codex app-server 残留进程会把 spawn 失败放大成 EAGAIN

- 状态：已规避，需随 Codex app-server 启动/停止策略变化复核
- 首次发现：2026-08-20
- 适用范围：`src/interactive/codexRunner.ts`、Codex app-server、Loop/Graph 子任务、Extension Host 停止与 reload

### 现象
- 插件长时间使用后，Codex 运行开始报 `spawn /Users/fangjiawei/.npm-global/bin/codex EAGAIN`。
- 重启电脑后恢复；只 reload 或重新发起任务不一定释放所有旧资源。
- 本机只读排查能看到多个旧 `codex app-server --listen stdio://` 进程仍挂在 VS Code 相关父进程下，其中包括临时 Loop 子任务工作目录对应的进程。

### 触发条件
- 同一 Codex runner 在边界状态下同时存在多个 app-server child，或停止/扩展停用时只记住最后一个 child。
- Codex CLI 的 Node wrapper 还会派生 vendor binary；仅杀直接子进程时，后代或同 runner 早期 child 可能残留。
- 残留进程、pipe 和文件描述符累计后，系统拒绝继续创建新进程，Node 最终把失败表现为 `EAGAIN`。

### 根因
- 早期 `CodexInteractiveRunner` 只保存单个 `activeChild`，新 run 会覆盖旧 child 引用，停止时无法遍历所有活跃 app-server。
- Codex app-server 以非独立进程组运行，`requestChildShutdown` 主要向直接 child 发信号，不能稳定清理 Node wrapper 及其 vendor 子进程树。
- `spawn` 失败路径若只触发 `error` 而没有及时收口 exit/readline，相关 promise 和句柄也可能继续悬挂。

### 长期规避
- Codex app-server child 必须以集合跟踪，`stopAndRebuild()` / `dispose()` 对所有活跃 child 发起 shutdown。
- macOS/Linux 下 Codex app-server 应使用独立 process group；关闭时先结束 stdin，再升级到 `SIGTERM` / `SIGKILL` 清理进程组。
- `EAGAIN` 要转换为可诊断的资源耗尽错误，并记录 command、pid、active child 数，不能只透传裸 `spawn ... EAGAIN`。
- 本机排查优先只读运行 `ps -axo pid,ppid,pgid,stat,etime,command | rg "codex app-server"`，确认是否有旧工作区或临时目录残留进程；不要默认要求用户重启电脑。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/interactive/codexRunnerLifecycle.test.js dist/test/interactive/codexRunnerSubagent.test.js`。
- 本机只读验证 `codex --version` 与 `ps` 中 Codex app-server 进程列表；如仍有旧版本遗留进程，需区分历史残留和本次修复后的新进程。

### 关联资料
- `src/interactive/codexRunner.ts`
- `src/interactive/codexRunnerProcess.ts`
- `src/test/interactive/codexRunnerLifecycle.test.ts`

## LoopMainDecision 解析不能优先采用 prompt 内 fenced JSON 示例

- 状态：已规避，需随 Loop 主任务协议和 prompt 模板变化复核
- 首次发现：2026-08-11
- 适用范围：Loop 主任务 `LoopMainDecision` 解析、`src/extensionHost/promptRunRuntime.ts`、主任务 prompt 中的子任务 JSON 示例

### 现象
- Loop 主任务最后返回看似合法的 `{"status":"continue","subtasks":[...]}` JSON，但运行被置为 `needs-review`。
- UI 中断说明为 `Main task did not return a valid loop decision JSON.`，最新任务记录里 round-2 子任务仍停留在 `pending`，没有被真正派发。

### 触发条件与根因
- 外层 `LoopMainDecision` JSON 的 `subtasks[].prompt` 字符串里包含 fenced `json` 示例，例如业务规则 DSL 示例。
- 早期 `extractJsonObjectText` 优先匹配第一个 ```json fenced block```，没有判断该 fenced block 是否位于 JSON 字符串内部。
- 解析器因此拿到 prompt 内的业务规则示例对象，而不是外层 `LoopMainDecision`，`normalizeLoopMainDecision` 返回 null 后触发 `loop-main-decision-invalid`。

### 长期规避
- Loop 主任务解析应扫描候选 JSON 对象，并用 `normalizeLoopMainDecision` 选择第一个合法决策对象，不能仅凭第一个 fenced block 判定。
- 子任务 prompt 允许包含 JSON 示例、DSL 示例和 markdown code fence；这些内容不应影响外层机器协议解析。
- 真实日志排查时同时看 `loop-main-decision-invalid` 附近的 assistant content 和 `loop-tasks.json` 中 `subTasks` 状态，确认是解析失败还是模型确实没返回协议。

### 验证方式
- 运行 `npm run build`。
- 运行 `node --test dist/test/extensionHost/loopMainDecisionParsing.test.js`。
- 用包含 `subtasks[].prompt` fenced `json` 示例的外层 `LoopMainDecision` 回归样例，确认能解析出 `status=continue` 和完整子任务。

### 关联资料
- `src/extensionHost/promptRunRuntime.ts`
- `src/test/extensionHost/loopMainDecisionParsing.test.ts`

## 人工交互自然语言兜底不能只识别“可选：”候选项

- 状态：已规避，需随 Codex / Claude / OpenCode 澄清回复样式变化复核
- 首次发现：2026-08-08
- 适用范围：Codex / Claude / OpenCode Vibe/coding 人工交互兜底、`src/humanInteraction.ts`、Webview 表单渲染

### 现象
- 用户执行“写一首诗，你来问我一些要求帮你更精准写出我想要的诗”时，Codex 没有发结构化 `requestUserInput`，而是输出普通最终答复里的问题和选项。
- 弹窗出现后，本应展示选项的字段仍是多行 textarea。

### 触发条件与根因
- 真实 Codex 回复常用 `1. 问题` 后紧跟 `A. 选项一 / 选项二`、`B. ...` 的字母选项列表。
- 早期 parser 只识别“可选 / 选项 / 例如 / 如”这类显式提示词，丢掉了紧随问题的 `A.` / `B.` / `C.` 选项行，导致字段没有 `options` 并回退为 textarea。

### 长期规避
- 自然语言人工交互兜底必须覆盖至少两类真实样式：显式提示词候选项，以及紧随问题的字母选项列表。
- Webview 层要保留“有 `options` 且无显式 type 时默认 radio”的归一化，并用前端脚本级 smoke 验证 `createHumanInteractionInput` 实际生成 radio/checkbox 控件。
- 回归用例要使用真实诗歌提示样例，不能只覆盖人工构造的“可选：爱情、自然、人生”。

### 验证方式
- 运行 `npm run build`。
- 运行 `node --test dist/test/core/humanInteraction.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/webview/multiAgentSettingWebview.test.js`。
- 用 `buildNaturalLanguageHumanInteractionRequest` 喂入含 `A.` / `B.` / `C.` 选项的诗歌澄清文本，确认输出字段 `type=radio` 或 `checkbox` 且 `options` 非空。

### 关联资料
- `src/humanInteraction.ts`
- `src/test/core/humanInteraction.test.ts`
- `src/test/extensionHost/promptInteractiveRuntime.test.ts`
- `src/test/webview/multiAgentSettingWebview.test.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## Extension Host 拆分时同名包装函数不能回注自身

- 状态：已规避，需随后续 `extensionHost/*` 拆分和依赖注入变更复核
- 首次发现：2026-08-02
- 适用范围：`src/extension.ts`、`src/extensionHost/*` host wrapper、controller dependency injection

### 现象
- VS Code Extension Host 反复输出 `RangeError: Maximum call stack size exceeded`，堆栈集中在 `dist/extensionHost/sessionTabs.js` 的 `wrap(...).finally(syncToDeps)` 和 `persistSessionStore`。
- 报错出现在 Promise reject callback 中，表面看像异步清理问题，实际是 host 方法通过依赖闭包调用回同名包装方法。

### 触发条件与根因
- `extension.ts` 创建 host 时传入形如 `persistSessionStore: (store) => persistSessionStore(store)` 的依赖。
- 同一作用域随后又从 `sessionTabsHost` 解构出同名 `persistSessionStore` 包装函数，闭包最终捕获的是 host wrapper，不是原始存储实现。
- host 内部 `persistSessionStore -> deps.persistSessionStore -> persistSessionStore` 自递归，Promise `finally(syncToDeps)` 反复排队后触发栈溢出。

### 长期规避
- 拆分 `extensionHost/*` 时，注入依赖必须指向命名清晰的原始实现，例如 `persistSessionStoreToStorage`，不要用与 host 返回方法同名的闭包转发。
- 如果 host 返回对象需要暴露同名方法，`extension.ts` 解构时不要再绑定成会被依赖闭包捕获的同名局部变量。
- 对关键依赖注入边界加源码契约测试，断言不会出现 `name: (args) => name(args)` 这类自引用 wiring。

### 验证方式
- 运行 `npm run build`。
- 运行 `node --test dist/test/session/sessionPersistenceWiring.test.js dist/test/session/sessionLifecycleCoreCoverage.test.js dist/test/session/sessionStoreCoreCoverage.test.js`。
- 编译后用 `rg "persistSessionStoreToStorage|persistSessionStore: persistSessionStoreToStorage" dist/extension.js src/extension.ts` 确认宿主注入指向原始实现。

### 关联资料
- `src/extension.ts`
- `src/extensionHost/sessionTabs.ts`
- `src/test/session/sessionPersistenceWiring.test.ts`

## Graph 全量验证节点不能默认硬阻断交付收束

- 状态：已规避，需随 Graph planner / scheduler / summary 变更复核
- 首次发现：2026-08-02
- 适用范围：Graph AI planner、验证节点规划、scheduler 结构依赖、summary 未解决事项

### 现象
- Graph 运行中相关 focused 回归已经通过，但 `npm run test:unit` 等完整单测失败少量历史/范围外 subtests 后，整个 run 进入 `needs-review`，后续 review / summary 未执行。
- 用户看到的是“Graph 中断”，而不是“相关验证已通过，全量验证存在遗留失败”。

### 触发条件与根因
- AI planner 把完整单测节点规划成普通 blocking `depends_on`，并让 review/summary 结构依赖该节点。
- 完整单测节点 `maxAttempts=1` 且失败后没有可用 `if_fail` 返工路径，scheduler 后续无可运行节点，宿主 idle 后置为 `needs-review`。
- 全量测试输出常引用 `dist/test/*.test.js`，如果失败分类不映射回 `src/test/*.test.ts`，会误判真实修复范围。

### 长期规避
- 完整单测、全仓测试、全量 lint 等覆盖面大且可能包含历史/范围外失败的验证节点，默认规划为 `blocking:false` advisory 节点，并用 `evidence_for` 连到 review/summary。
- 相关 focused 验证仍必须使用普通 blocking dependency 或 `if_pass`，确保真实相关失败能阻断交付。
- Summary 必须把 advisory failed 节点列入 unresolved，不能把失败命令描述为已成功通过。
- failure classifier 必须把 `dist/test/*.test.js` 候选映射回 `src/test/*.test.ts`，再判断是否需要测试适配或源码返工。

### 验证方式
- 覆盖 failed `blocking:false` 结构依赖可继续调度 review/summary，但 `if_pass` 仍不满足。
- 覆盖 planner/store 保留 `blocking:false`，prompt 明确完整单测默认 advisory。
- 覆盖 `dist/test/webview/codexdualmodelwebview.test.js` 能映射到 `src/test/webview/codexdualmodelwebview.test.ts`。
- 运行 `npm run build` 与 `node --test dist/test/graph*.test.js`。

### 关联资料
- `src/graph/types.ts`
- `src/graph/graphScheduler.ts`
- `src/graph/graphPromptBuilders.ts`
- `src/graph/graphFailureClassification.ts`
- `.ch/docs/exec-plans/completed/2026-08/2026-08-02-graph-advisory-validation.md`

## Graph Tab 元数据不能覆盖前台模式选择

- 状态：已规避，需随 Graph / Loop / Vibe 入口变更复核
- 首次发现：2026-07-31
- 适用范围：AI 对话 Webview 模式选择、Graph tab 恢复元数据、前台发送与后台队列分发

### 现象
- 同一 conversation tab 先执行 Graph 后，用户切换到 Vibe/coding 或 Loop 再发送新提示，仍会被自动按 Graph 执行。
- 视觉上模式选择已经改变，但运行路径没有跟随用户当前选择。

### 触发条件与根因
- Graph run 会在 tab 上保留 `graphRunId` / `openGraphRun` 等元数据，用于展示图入口、状态和历史恢复。
- 前台发送路径若先根据 tab 元数据调用 auto mode 解析，再读取当前 UI 模式，就会把普通前台输入误判为 Graph 续跑。

### 长期规避
- 前台发送没有显式 `interactiveMode` 时，必须以当前 `state.interactiveMode` 为权威。
- Graph 元数据只能用于图入口、展示、历史恢复，以及后台派发或 Graph 续跑的自动归类，不能覆盖用户在同一 tab 中切换后的 Vibe/coding 或 Loop 前台发送。
- 修改 `resolveDispatchInteractiveMode`、tab 自动模式、队列出队或 Graph 恢复逻辑时，要同时覆盖“Graph 后切 Vibe”和“Graph 后切 Loop”回归测试。

### 验证方式
- 在带 `graphRunId` 的 active tab 上断言前台 `dispatchPrompt` 会随 `state.interactiveMode="coding"` 发送 coding/Vibe，并随 `state.interactiveMode="loop"` 发送 Loop。
- 保留后台派发 Graph tab 自动使用 `graph` 的覆盖。
- 运行 `npm run build` 与 `node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/graph/graphMainWebview.test.js`。

### 关联资料
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/test/webview/clipagescriptruntimecoverage.test.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `.ch/docs/references/cli-runtime-reference.md`

## VSIX 新增运行时依赖必须同步 `.vscodeignore` 放行

- 状态：已规避，需发布时检查
- 首次发现：2026-07-26
- 适用范围：VS Code 插件打包、`.vscodeignore`、运行时 `node_modules` 依赖

### 现象
- 开发态和本地 `dist/` 加载正常，但安装新打出的 VSIX 后插件激活失败。
- VS Code Extension Host 报错：`Cannot find module '@dagrejs/dagre'`，require stack 指向 `dist/webview/graphRunPanel.js -> dist/panelDiagnostics.js -> dist/extension.js`。

### 触发条件
- 源码新增了扩展宿主运行时的第三方依赖，并已写入 `package.json` / `package-lock.json`。
- `.vscodeignore` 先用 `node_modules/**` 排除了全部依赖，但没有同步增加对应 `!node_modules/<scope-or-package>/**` 放行规则。

### 根因
- `vsce package` 按 `.vscodeignore` 生成安装包；`package.json.dependencies` 只能表达依赖关系，不能覆盖显式 ignore 规则。
- 因此 `dist/*.js` 中保留的 `require("@dagrejs/dagre")` 在用户安装目录找不到实际包，插件在激活阶段直接失败。

### 长期规避
- 新增任何扩展宿主运行时依赖时，必须同时检查 `package.json.dependencies`、`.vscodeignore` 放行规则和实际 VSIX ZIP 清单。
- 对有传递依赖的 scope 包，优先放行整个作用域，例如 `!node_modules/@dagrejs/**`，避免只带主包漏掉子依赖。
- 单元测试至少覆盖关键依赖的声明和 `.vscodeignore` 放行；发布前仍必须以实际 VSIX 解包验证为准。

### 验证方式
- 执行 `npm run build` 和相关定向测试，例如 `node --test dist/test/graph/graphRunPanel.test.js`。
- 执行 `./export_vscode_extension.sh` 后，用 `unzip -l dist/sinitek-cli-tools-<version>.vsix | rg 'extension/node_modules/@dagrejs/(dagre|graphlib)/'` 确认主依赖和传递依赖都进入包。
- 可进一步解包到临时目录并加载对应 `dist` 模块，确认不会再因缺少依赖抛错。

### 关联资料
- `.vscodeignore`
- `package.json`
- `src/webview/graphRunPanel.ts`
- `src/test/graph/graphRunPanel.test.ts`
- `export_vscode_extension.sh`

## VSIX 打包脚本不能只依赖全局 `vsce`

- 状态：已规避，需发布时检查
- 首次发现：2026-08-20
- 适用范围：VS Code 插件打包、`export_vscode_extension.sh`、`publish_vscode_extension.sh`、本机开发环境

### 现象
- 执行 `./export_vscode_extension.sh` 立即失败：`Error: vsce is not installed. Install it with: npm i -g @vscode/vsce`。
- 同一仓库之前可用，但换机器、清理全局 npm 包或 PATH 变化后突然失败。

### 触发条件
- 打包脚本只检查 `command -v vsce`，没有优先使用项目内 devDependency。
- 当前 shell 环境没有全局 `vsce`，即使项目代码和构建产物本身没有问题也会在入口预检失败。

### 根因
- `vsce` 属于本项目打包工具链，放在全局 npm 环境会让脚本依赖不可复现的机器状态。
- 本地依赖和脚本命令解析没有对齐，导致 `npm install` 后仍可能因为 PATH 缺少全局命令而失败。

### 长期规避
- 将 `@vscode/vsce` 放入 `devDependencies`。
- 打包和发布脚本优先调用 `node_modules/.bin/vsce`，仅在本地依赖不存在时回退到全局 `vsce`。
- 文档以 `npm install` + `./export_vscode_extension.sh` 为默认流程，不再要求全局安装。

### 验证方式
- 执行 `npm run build`。
- 执行 `./export_vscode_extension.sh`，确认无全局 `vsce` 时也能生成 VSIX 并通过 ZIP 清单检查。

### 关联资料
- `package.json`
- `package-lock.json`
- `export_vscode_extension.sh`
- `publish_vscode_extension.sh`
- `.ch/docs/runbooks/local-development.md`

## Codex 可见 Tasklist 不能只识别括号状态

- 状态：已规避，需随 Codex 日志表达复核
- 首次发现：2026-07-20
- 适用范围：Codex `agent_message` commentary、Webview task list overlay、`Tasklist` / `任务列表` 文本解析

### 现象
- Codex 今天的执行日志中，很多可见任务列表不会写成统一的 `Tasklist: [pending] ...` 格式，而是使用无状态中文分隔、编号、checkbox、反引号包裹状态，或把“已完成 / 正在 / 待执行”等状态词直接嵌在条目文本里。
- 只识别 `[pending]` / `[in_progress]` / `[completed]` 会导致部分 Tasklist 完全不显示，或已完成项被当成未完成项。

### 触发条件与根因
- 真实日志里出现过 `Tasklist：事项1、事项2`、`Tasklist: \`[completed]\` ...`、`任务列表：1) ...已完成；2) ...进行中`、`Tasklist 更新：定位完成，开始修改` 等多种写法。
- Parser 早期把状态视为方括号里的结构化 token，没有从明确 Tasklist section 内的普通文本提炼有限状态词，也没有识别中文 `任务列表` / `任务列表状态` 头。

### 长期规避
- Tasklist parser 应先锚定明确标题，再在该 section 内兼容少量真实出现的格式：括号/checkbox 状态、反引号括号状态、编号/项目符号、中文/英文分隔符，以及“已/正在/待/最后”等进度短句。
- 不要把任意正文里的“完成”“待办”全局升级成任务；只有明确 Tasklist 标题后的内容才走兼容解析。
- 无状态但明确位于 Tasklist 标题后的事项仍按未完成处理；从文本提炼出的完成状态需要清洗掉状态词，避免面板显示“定位完成”这类混合状态文本。

### 验证方式
- 用当天真实样例覆盖：反引号状态、中文 `任务列表` 标题、编号条目后缀状态、`Tasklist 更新` 进度短句和无状态中文分隔清单。
- 运行 `npm run build` 和 `node --test dist/test/webview/clipagescriptruntimecoverage.test.js`。

### 关联资料
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/test/webview/clipagescriptruntimecoverage.test.ts`

## Codex Tasklist 全完成更新不能立即清空浮层

- 状态：已规避，需随 Codex `turn.plan.updated` / `todo_list` 事件和普通可见 Tasklist 文本复核
- 首次发现：2026-07-21
- 适用范围：Codex App Server plan 事件、普通 Codex stdout/assistant 文本、Webview task list overlay、外部 taskListUpdate

### 现象
- 最新 Codex 日志已经收到 `turn.plan.updated`，plan item 会输出 `completed` / `inProgress` / `pending` 的混合状态，长任务中会多次渐进更新。
- 2026-07-22 最新日志也出现另一类来源：没有 `turn.plan.updated` / `todo_list`，只有普通 stdout/assistant 文本里的 `Tasklist：...` 或 `任务列表更新：...`。
- 前端也能把任务列表解析成列表，但用户看不到逐步完成过程；当最后一个任务完成时，也几乎看不到复选框被打勾。

### 触发条件与根因
- `turn.plan.updated` 已经作为 raw event 进入日志/运行流，但如果只依赖 runner 内部专用 `onTaskListUpdate` 分支，协议形态变化或转发路径差异会让“日志有过程、浮层不刷新”。
- 普通 assistant 文本增量更新常走 `appendAssistantDelta -> updateRenderedAssistantMessage` 的局部 DOM 路径，不一定触发 `renderMessages()`；如果不在该路径上主动 `updateTaskList()`，文本里的 Tasklist 会进入聊天正文但不会刷新浮层。
- `setTaskListItems` 曾通过 `shouldDisplayTaskListItems(items.some(done !== true))` 判断显示条件。
- 当 Codex 发来“全部 completed”的列表时，解析结果正确，但显示条件判定为 false，随后把 `taskListState.items` 清空并关闭浮层，所以完成态没有机会渲染成 checked checkbox。

### 长期规避
- Codex `turn.plan.updated` / `todo_list` 的转发 raw event 也必须提取 taskList 并发送 Webview `taskListUpdate`，不能只把它写入 raw stream 日志。
- 普通 assistant 文本流式追加后必须同步重算 taskList；如果该消息只包含 Tasklist，要触发完整渲染以隐藏正文并显示浮层。
- 任务列表显示条件只能判断是否存在有效条目，不能用“是否还有未完成项”作为显示条件。
- 全部完成的列表应保留并显示 `N/N` 与已勾选项；运行结束后再由 `closeTaskListForRunCompletion` 统一收起，避免把最终状态吞掉。
- 空数组或运行结束后的迟到更新仍应重置/隐藏，避免历史任务列表泄漏到下一次运行。

### 验证方式
- 用真实日志形态 `turn.plan.updated` / taskListUpdate 中的混合状态、全 `completed` 状态，以及普通 assistantDelta 文本 `Tasklist: [completed] ... [inProgress] ... [pending] ...` 覆盖过程刷新与最终勾选。
- 运行 `npm run build`、`node --test dist/test/interactive/codexAppServerProtocol.test.js dist/test/webview/openCodeTaskListOverlay.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`。

### 关联资料
- `src/interactive/codexAppServerProtocol.ts`
- `src/extension.ts`
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/webview/viewContentScript/traceRendering.ts`
- `src/test/interactive/codexAppServerProtocol.test.ts`
- `src/test/webview/openCodeTaskListOverlay.test.ts`
- `src/test/webview/clipagescriptruntimecoverage.test.ts`

## Codex 同一 UI 分组切换模型/配置时必须 resume 已映射 thread

- 状态：已规避，需随 Codex app-server provider 恢复语义复核
- 首次发现：2026-07-16；规则修正：2026-08-25
- 适用范围：Codex app-server interactive runner、模型配置切换、conversation tab / group 到 Codex thread 的映射、自动上下文压缩

### 现象
- 同一个 AI 对话分组中，先用配置 A / 模型 A 完成任务，再不切换分组只切换到配置 B 或模型 B 后继续执行，插件若主动新建 thread，模型将看不到已有会话上下文。
- 跨 provider/account 的历史若含目标端不能解密的 reasoning/compaction 内容，app-server 可能返回 `invalid_encrypted_content`；这不是通过重放旧工具调用能够修复的客户端问题。

### 触发条件与根因
- 旧实现把模型或配置变化直接解释为“必须新建 thread”，并冻结旧 mapping；这会绕过 app-server 的服务端会话恢复。
- 旧 runner 只向 thread 请求传 `model`，没有从当前 `~/.codex/config.toml` 读取根级 `model_provider` 并传入 `modelProvider`，使跨 provider resume 不能按 app-server 官方路径选择目标 provider。
- app-server 只在 `thread/start` / `thread/resume` 接收 `modelProvider`；把它错误传给 `turn/start` 或使用已废弃 `persistExtendedHistory` 都不能恢复上下文。

### 长期规避
- Codex runner 缓存身份仍须包含 active config ID 和 selected model，以便重建本地 process 配置；但模型或配置变化后必须继续将已映射 `threadId` 传给 `thread/resume`，不得主动冻结并创建新 thread。
- 从当前生效 `~/.codex/config.toml` 读取根级 `model_provider`，仅在 `thread/start` / `thread/resume` 传入 `modelProvider`；没有该设置时省略字段，让 app-server 自动恢复。
- app-server 恢复服务端 thread，不重新执行旧工具调用或重发完整历史事件。若返回不兼容的加密历史错误，保留原始错误并要求用户按服务端限制新建会话；不得伪造完整历史重放。
- 自动上下文压缩还必须有有界超时；Codex app-server `thread/compact/start` 可能长时间没有完成事件，自动路径最多等待 3 分钟，超时直接停止并按未压缩处理。

### 验证方式
- 断言相同 config/model 及模型或 config 任一变化时均继续复用 mapped thread。
- 用临时 `config.toml` 断言 runner 发出的 `thread/resume` 同时包含原 `threadId`、当前模型和 `modelProvider`，且 `turn/start` 不含 provider。
- 运行 `npm run build` 和 `node --test dist/test/interactive/codexThreadSelection.test.js dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexRuntimeConfig.test.js dist/test/interactive/codexRunnerLifecycle.test.js`。

### 关联资料
- `src/interactive/codexThreadSelection.ts`
- `src/interactive/manager.ts`
- `src/interactive/codexRuntimeConfig.ts`
- `src/interactive/codexRunner.ts`
- `src/contextCompactionRunner.ts`
- `src/test/interactive/codexThreadSelection.test.ts`
- `.ch/docs/exec-plans/completed/2026-08/2026-08-25-codex-app-server-provider-resume.md`

## Codex Graph 子任务报 `spawn <codex> ENOENT` 不一定是命令丢失

- 状态：已规避，需随 Codex interactive runner 复用策略复核
- 首次发现：2026-07-24
- 适用范围：Codex app-server interactive runner、Graph 节点执行、Loop/Graph 子任务临时执行根

### 现象
- Graph 节点运行日志显示 `spawn /Users/.../.npm-global/bin/codex ENOENT`，但同一终端里 `codex --version` 正常，symlink 和目标 `codex.js` 都存在。
- 插件日志中同一个 Graph run 的后续节点快速失败，但 Graph store 曾继续把节点记为 passed 并生成 `Graph run completed`。

### 触发条件与根因
- 早期 Graph 节点通过 `taskRole="subtask"` 创建临时执行根，节点结束后会清理该目录。2026-07-24 起 Graph 节点改为使用 run 级独立 git worktree；Loop 子任务仍可能使用临时执行根。
- `InteractiveRunnerManager` 只按 session/config/model 等维度复用 Codex runner，未把 `command`、`args`、`cwd` 作为 runner 身份的一部分时，后续 Graph 节点可能复用仍指向已删除临时 `cwd` 的旧 runner。
- Node `spawn` 在 `cwd` 不存在时也会报 `ENOENT`，错误文本仍形如 `spawn <command> ENOENT`，容易误判为 CLI 可执行文件缺失。
- Graph executor 如果不要求 `runPrompt` 错误回传，会把已展示到 UI 的节点执行失败吞掉，导致 kernel 收到 passed 结果并继续 summary。

### 长期规避
- Codex runner 缓存身份必须同时包含 `command`、`args` 和 `cwd`；任何执行根变化都要重建 runner。
- Graph 节点调用 `runPrompt` 必须使用内部错误回传路径，并在节点结束后解析 communication file 的 `## JSON`；CLI 启动失败、最终答复失败、artifact 缺失/非法或 runner 异常要进入 `failed/blocked/needs-review`，不能继续生成 completed summary。
- 排查 `spawn <cli> ENOENT` 时同时检查 `cwd` 是否存在，不能只检查 `command -v` 或 symlink。

### 验证方式
- 断言 `InteractiveRunnerManager` 在相同 session/config/model 但不同 `cwd` 时不会复用 Codex runner。
- 断言 Graph 节点执行路径设置错误回传，`runPrompt` interactive 失败时会 throw 给 Graph kernel；断言 artifact JSON 的 failed/blocked 不会被 executor 改写成 passed。
- 用真实日志核对：失败 run 的 `codex-app-server-spawn.cwd` 指向临时执行根，且该根可能已被清理。

### 关联资料
- `src/interactive/manager.ts`
- `src/extension.ts`
- `src/test/interactive/codexThreadSelection.test.ts`
- `src/test/graph/graphExtensionRuntime.test.ts`

## 不能只依赖 CLI 结构化 `final_answer`，也不能默认猜测普通正文是最终答复

- 状态：已规避，需随 Codex app-server 事件协议复核
- 首次发现：2026-06-14；再次确认：2026-07-10
- 适用范围：Codex / Claude / OpenCode prompt、Codex app-server `agent_message` / `turn.completed`、最终结论气泡与 hidden retry

### 现象
- Codex 已在 AI 对话中输出非空 assistant 答复，并以 `turn.completed status:"completed"` 正常结束，但该回合所有 `agent_message` 都是 `phase:"commentary"`，没有 `phase:"final_answer"`。
- 固定严格协议下，这类回合不能被视为最终答复，必须显示“任务已退出，但没有产生最终结论气泡，自动继续”，并按 hidden retry 约定请求显式终态。

### 触发条件与根因
- 真实日志中的会话 `019f4b72-86f8-72b3-80f0-860bf9b467c4` 在收到 `hi` 后输出 commentary assistant 文本，随后成功完成；自动继续后的第二回合再次出现相同事件序列。
- `phase` 描述消息阶段，`turn.completed status:"completed"` 描述结构化回合终态。不同 Codex 模型或版本可能成功结束一个没有显式 final phase 的回合，不能假设两者永远同时出现；Claude / OpenCode 也没有统一等价的 `final_answer` phase 可供插件依赖。
- 直接把“成功退出前最后一段普通正文”默认当最终答复会反向引入过程性 commentary 误判，无法成为所有 CLI 的严格语义；因此不再保留成功回复兼容回退。

### 长期规避
- 所有普通任务和 hidden retry 的实际模型 prompt 都追加统一约定：任务完成后的最终回复必须以 `[final_answer]` 开头，过程更新不得使用该标记；不要改写界面里的原始用户消息。
- Loop 主任务/子任务等已有纯 JSON 或专用结构化终态的机器协议必须显式关闭文本标记注入和严格文本判定，否则 `[final_answer]` 前缀会破坏 JSON 解析；这些路径继续按自己的完成气泡验收。
- 结构化 `final_answer` 仍是最高优先级终态信号；没有结构化类型时，只从当前用户消息之后的非 thinking assistant 文本识别 `[final_answer]`。按产品约定使用“包含”语义，不能从 thinking、trace、system 或 user 文本识别。
- `[final_answer]` 只能在 Webview assistant 气泡的展示文本中移除；不能提前改写 `message.content` 或会话存档，否则固定严格协议、历史恢复和 hidden retry 会丢失兜底终态信号。
- 普通任务固定只接受结构化 final 或文本标记；工具设置不提供切换项，遗留 `finalAnswerPolicy` / `codexFinalAnswerPolicy` 字段会被忽略。Codex `turn.completed status:"completed"` 不得把 commentary 原位提升为最终答复；唯一窄例外是 Codex 交互式成功回合的最后一个当前回合 assistant 气泡带明确完成/结论语义且没有继续执行语义，用于兼容 `grok-4.6` 这类 `phase=null` 最终正文。
- 空回复、failed、interrupted、主动停止、commentary-only completed turn、最后消息不是 assistant，或“接下来/继续/下一步”等进度语义都不得收口。禁止扫描当前用户锚点之前的历史消息，也禁止把所有 commentary 无条件当最终答复。

### 验证方式
- 对 Codex / Claude / OpenCode 的首轮和 hidden retry prompt 断言都含最终回复标记约定。
- 对 Loop 机器协议断言首轮和 hidden retry prompt 都不含 `[final_answer]`，且普通任务的固定严格协议不会覆盖其专用终态规则。
- 断言结构化 final 和 `[final_answer]` assistant 文本通过；普通正文、thinking 中的标记和当前用户锚点之前的旧标记不通过。
- 用 `commentary agent_message -> turn.completed completed` 断言 Codex 不会产生合成的 `codexFinalAnswer`；显式 final 仍按上游元数据转发。
- 断言工具设置中的遗留策略字段和旧消息键都不会改变运行时行为。

### 关联资料
- `src/toolSettings.ts`
- `src/interactive/codexRunner.ts`
- `src/interactive/codexRunnerRuntime.ts`
- `src/finalConclusion.ts`
- `src/test/webview/finalAnswerPolicy.test.ts`
- `src/test/extensionHost/promptRuntime.test.ts`
- `src/test/interactive/codexRunnerRuntime.test.ts`

## 子代理事件必须按子会话身份分流，不能只观察父进程输出

- 状态：已规避，需随 OpenCode / Codex 协议版本复核
- 首次发现：2026-07-13
- 适用范围：OpenCode 1.17.18 本地服务、Codex App Server 0.144.1、Loop 独立子任务、多子代理对话气泡与父任务收口

### 现象
- OpenCode 父 `run --format json` 等待内部子代理时可以长时间没有新 JSONL，子代理实际仍在读文件、调用工具和输出文本；只显示一次“请等待”仍会让用户误判卡死。
- Loop 主从模式的子任务是扩展启动的独立 CLI 进程和 conversation tab，不是 OpenCode/Codex provider 内部 child session。只监控 provider 的 parent/child API 时，Loop 主任务 tab 在整个子任务执行期间仍不会出现新气泡。
- Codex App Server 的子代理通知与父通知共用一个连接。若忽略 `params.threadId`，子代理正文会并入父 assistant 气泡，子线程 `thread/started` 会覆盖父 threadId，子线程 `turn/completed` 甚至会提前结束父任务。

### 触发条件与根因
- OpenCode 子代理有独立 session，父 CLI stdout 不承担子 session 事件转发；本机 1.17.18 对较大 session 执行 `opencode export` 还观察到 JSON 在字符串中途截断，不能把活跃任务轮询建立在该命令输出上。
- OpenCode 1.17.18 的 `run --help` 虽声明 `--port`，实际执行 `run --port <port>` 后该端口可持续 `ECONNREFUSED`，不能把“参数被接受”当作服务已经监听。`opencode serve` 才提供经过 `/global/health` 验证的 HTTP 服务，并公开 children/message/status 与 SSE event；父子关系由 child `parentID` 表达。
- Loop 子任务的可见输出已经进入插件自身的子任务 tab 消息存储；继续从 OpenCode child API 查找它们属于身份模型错误，应从插件拥有的消息流生成主任务进度快照。
- Codex `item/agentMessage/delta`、`item/started|completed`、`turn/completed` 都携带 `threadId`，初始化连接还会自动订阅新建子线程。把连接等同于单线程是错误假设。

### 长期规避
- OpenCode 由插件先启动受管 `opencode serve`，健康检查通过后再用 `run --attach`；不得恢复为未经监听验证的 `run --port`。SSE 只作为低延迟刷新触发器，正文始终读取 child message 完整快照并做前缀增量，另以 60 秒 children/status/messages 全量轮询兜底。服务、订阅与轮询必须由单次尝试统一释放；连接失败使用指数退避且只周期性记录错误。禁止直接读取私有 SQLite。
- OpenCode 只接纳当前运行尝试中新建的直接 child session，避免恢复旧父会话时把历史子代理正文重新插入当前回合。
- Loop 子任务启动后立即在主任务 tab 建立稳定 `taskId + round + subtaskId` 进度气泡，并从子任务 tab 的非 thinking、非内部子代理 assistant 消息做快照同步；子任务自己的完整消息流继续留在原 tab。
- Codex 所有 assistant delta、item、plan 和 turn 完成事件先比较主 `threadId`；子线程生命周期和正文走独立 handler，只有主 threadId 且 active turnId 匹配的完成通知可以收口父 turn。
- 子代理气泡必须带稳定 `subagentId`、禁止自动合并，并从父任务 final-answer 与 successful-reply fallback 中排除。

### 验证方式
- OpenCode 用模拟 serve 健康检查、children/status/messages 与分片 SSE 覆盖：`run --attach` 参数、60 秒 interval、当前尝试过滤、快照增量、重连退避、无用户 prompt/tool output 泄漏、dispose 后不再更新。
- Loop 用多条匹配/不匹配消息覆盖：启动即有等待气泡、每秒快照去重、过滤 thinking/内部子代理/其他轮次、完成/失败/中断状态映射和主 tab 定向接线。
- Codex 用 parent/child threadId 覆盖：child delta 不进入 `onAssistantDelta`，child completion 不通过父 turn settle，collab/subAgentActivity 状态能映射到独立气泡。
- Webview 用两个交错子代理断言旧气泡仍按原 message ID 原位更新，不重定向成新的末尾 assistant 气泡。

### 关联资料
- `src/cli/openCodeSubagentMonitor.ts`
- `src/interactive/codexRunner.ts`
- `src/interactive/codexRunnerRuntime.ts`
- `src/subagentProgress.ts`
- `src/finalConclusion.ts`
- `src/test/cli/openCodeSubagentMonitor.test.ts`
- `src/test/interactive/codexAppServerEvents.test.ts`
- `src/test/core/subagentProgress.test.ts`

## Codex reasoning 摘要不能按普通 assistant 正文直接落盘

- 状态：已规避，需随 Codex app-server 事件协议复核
- 首次发现：2026-07-10
- 适用范围：Codex `item.completed` reasoning 事件、thinking 气泡、历史会话存档

### 现象
- 部分 Codex 模型的 reasoning `summary` / `text` 会输出 `**Planning ...**`，并在其后附加独占一行的空 HTML 注释 `<!-- -->`。
- 插件把 reasoning 作为 thinking assistant 消息持久化后，空注释残片会反复出现在对话和历史会话中。

### 触发条件与根因
- Codex app-server 原始事件为 `item.completed` 且 `item.type=reasoning`，与正常最终回答的 `agent_message` 不是同一事件类型。
- reasoning 提取器此前只做片段扁平化和去重，没有对该模型特有的空分隔标记做边界清洗。

### 长期规避
- 只在 Codex reasoning/thinking 边界清洗独占一行的空 HTML 注释，禁止对全部消息做全局 HTML 注释正则替换。
- 行内 `<!-- -->`、非空 `<!-- explanation -->`、普通 assistant/user 消息必须保持原样。
- 会话加载和保存使用同一清洗函数修复历史 Codex thinking 消息；清洗后为空的 thinking 消息直接移除。

### 验证方式
- 用真实日志形态 `**Planning ...**\n\n<!-- -->` 断言 reasoning trace 只保留标题。
- 断言普通 assistant 消息中的 `<!-- -->`、行内空注释和非空注释不变。
- 断言历史 Codex thinking 消息加载后被清洗，而 Claude thinking 消息不受影响。

### 关联资料
- `src/codexReasoningContent.ts`
- `src/interactive/codexAppServerProtocol.ts`
- `src/sessionStore.ts`
- `src/test/core/codexReasoningContent.test.ts`

## OpenCode 真实会话字段是 `sessionID`，不能把插件 `local_*` 当作 CLI session

- 状态：已规避，需随 OpenCode JSONL 协议复核
- 首次发现：2026-07-10
- 适用范围：OpenCode 1.17.16、one-shot / 并行执行、会话 tab 二次执行

### 现象
- 同一个 OpenCode 会话 tab 第一次执行成功，第二次稳定报 `Error: Session not found`。
- CLI 启动参数出现 `--session local_<timestamp>_<random>`，而不是 OpenCode 返回的 `ses_*`。

### 触发条件
- 会话提取器只识别 `session_id`，没有识别 OpenCode JSONL 的 `sessionID`。
- 首轮未捕获真实 ID后，插件为消息落盘创建 `local_*` 占位会话，下一轮又没有在 CLI 边界过滤该占位 ID。

### 根因
- OpenCode 1.17.16 的 `step_start`、`text`、`step_finish` 和 `error` JSONL 事件在顶层及 `part` 中使用 `sessionID`。
- `local_*` 是插件内部存储身份，不存在于 OpenCode session store；把它传入 `opencode run --session` 必然找不到会话。

### 长期规避
- OpenCode 输出优先按 JSONL 结构读取 `sessionID`，同时兼容 `sessionId` / `session_id`，不要只依赖单一正则字段名。
- OpenCode 运行边界必须拒绝插件 `local_*`，只把真实外部 ID传给 `--session`。
- 修复前已有 `local_*` tab 不使用 `--continue` 猜测全局最近会话；启动新底层会话并捕获 `ses_*` 后，先迁移本地消息和 tab 引用再接管真实 ID，避免多 tab 或并发串线。

### 验证方式
- 用真实 OpenCode JSONL 样例断言 `sessionID` 可提取为 `ses_*`。
- 断言 `resolveCliSessionIdForResume("opencode", "local_...")` 返回空，最终 argv 不含 `--session local_*`。
- 在同一 tab 连续运行两次，第二次日志应包含 `--session ses_*`，且不再出现 `Session not found`。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/sessionLifecycle.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode 空配置档案不能按运行完整性阻断保存

- 状态：有效
- 首次发现：2026-07-12
- 适用范围：OpenCode 配置中心、配置档案保存、运行前校验

### 现象
- 点击“添加 OpenCode 配置”时，空档案使用 `{}` 初始化，却立即报错 `OpenCode primary model is missing`，导致用户无法先创建档案再填写 Provider 和模型。

### 根因
- 配置档案保存直接复用了运行前完整性校验；顶层 `model` 对运行是必需项，但对尚未填写的草稿不是保存前提。

### 长期规避
- 保存档案时允许缺少顶层 `model` 的草稿落盘，但继续阻止无效 JSON、错误模型引用、占位配置和不完整的兼容网关配置。
- 应用或运行 OpenCode 前仍执行完整校验，缺少主模型必须阻断执行。

### 验证方式
- `saveConfig` 可以保存内容为 `{}` 的 OpenCode 档案。
- `validateOpenCodeConfigForRun("{}")` 仍返回 `role-model-missing`。

### 关联资料
- `src/config/configService.ts`
- `src/test/config/configService.test.ts`

## OpenCode provider `npm` 不能按模型品牌推断

- 状态：有效
- 首次发现：2026-07-10
- 适用范围：OpenCode 配置中心、自定义 provider、配置校验与文档范例

### 现象
- 配置范例如果使用 Claude、Gemini 或 DeepSeek 型号名，同时写 `npm: "@ai-sdk/openai-compatible"`，用户容易认为适配器包和模型品牌冲突。
- 反过来，如果代码按模型 id 中的 `claude` / `gemini` / `deepseek` 自动替换或拒绝 npm 包，会误伤通过 OpenAI-compatible 网关合法代理这些模型的配置。

### 触发条件
- 把 `provider.<id>.npm` 理解成“模型厂商品牌”，而不是请求所使用的 API 协议适配器。
- 配置页只展示 JSON 范例，但没有说明内置 provider、原生 API 自定义 provider、兼容网关三种场景的差异。

### 根因
- OpenCode 的 `npm` 指定 provider 使用的 AI SDK 包。官方 provider 目录中 Anthropic、Google、OpenAI 分别使用 `@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai`；官方自定义 provider 文档说明 `@ai-sdk/openai-compatible` 用于任何 OpenAI-compatible API。
- 网关可以通过统一 OpenAI-compatible endpoint 承载多个品牌模型，因此模型 id 或展示名称不能可靠推断底层协议。

### 长期规避
- 优先使用 OpenCode 内置 provider 和 `/connect` 鉴权；这种场景通常无需手写 `provider.<id>.npm`。
- 只有手写自定义 provider 时才按真实 API 协议选择 SDK：原生 Anthropic / Google / OpenAI API 使用对应 `@ai-sdk/*` 包，兼容网关使用 `@ai-sdk/openai-compatible`。
- 校验只检查可证实的协议要求，例如 OpenAI-compatible 自定义 provider 必须有 `options.baseURL`；禁止根据模型名称自动换包或报错。
- 配置页范例使用中性网关模型名，并明确标记为 OpenAI-compatible 网关范例；provider 名称继续使用 `myAPI`。范例模型 id 和示例 `baseURL` 作为占位值参与 preflight，用户必须替换为真实值。

### 验证方式
- `validateOpenCodeConfigForRun` 应允许 `@ai-sdk/openai-compatible` 承载包含 Claude、Gemini、DeepSeek 名称的网关模型。
- `@ai-sdk/openai-compatible` 缺少 `options.baseURL` 时应返回明确阻断问题；`@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai` 不应被强制要求兼容网关 baseURL。
- 配置页示例 JSON 可解析，标题和说明必须明确“OpenAI-compatible 网关”以及“按 API 协议选择 npm”。

### 关联资料
- OpenCode Providers：`https://opencode.ai/docs/providers/`
- models.dev provider directory：`https://models.dev/api.json`
- `src/config/configService.ts`
- `src/test/config/openCodeConfigService.test.ts`

## OpenCode `.env` 与 `config.json` 双配置会误导用户

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode 配置中心、配置文档、示例配置

### 现象
- 用户会误以为 OpenCode 需要同时维护 `config.json` 和 `.env` 两个配置文件。
- 配置页如果出现多个 OpenCode 保存按钮，会让用户不清楚哪个文件才是当前运行配置来源。

### 触发条件
- 文档或 UI 把 OpenCode `.env` 描述为当前配置要求。
- OpenCode 示例把 provider 名称写成具体历史供应商名，导致用户把示例名当作固定平台。

### 根因
- OpenCode 当前配置收口为单 `~/.opencode/config.json`，`.env` 不应再作为当前配置中心的保存对象。
- 历史调试中的 provider 示例名混入入口文档，容易被用户理解为推荐默认名称。

### 长期规避
- OpenCode 配置中心和文档只暴露一个 `config.json` 保存入口，不再要求或生成 `~/.opencode/.env`。
- OpenCode 配置范例中的 provider 名称统一使用 `myAPI`，不使用历史供应商名作为当前示例名称。
- 只有历史踩坑、兼容迁移或外部 endpoint 调试说明可以提到旧 `.env` / 具体供应商名，并且必须明确不是当前配置要求。

### 验证方式
- 在入口文档和 `.ch` 事实来源中运行 `rg -n "PackyAPI|OpenCode.*\\.env|\\.opencode/\\.env"`，当前配置口径不得命中；若命中只能是历史踩坑说明。
- 在配置中心验收 OpenCode 页面只有 `config.json` 保存入口，保存后不创建或更新 `~/.opencode/.env`。

### 关联资料
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `docs/cli-reference.md`

## OpenCode OpenAI-compatible 自定义 provider 裸 baseURL 会空响应

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode 1.17.15、`@ai-sdk/openai-compatible` 自定义 provider、PackyAPI/OpenAI-compatible endpoint

### 现象
- VS Code 插件发起 `opencode run --format json <prompt>` 后，OpenCode 进程 `code=0` 成功退出，但 stdout 只有 `step_start` / `step_finish`，tokens input/output/reasoning 全为 0，没有 assistant 文本。
- 用户侧看到 `OpenCode exited successfully, but did not return an assistant answer...`，且可能重复显示同一句空响应错误。

### 触发条件
- `opencode.json` 使用示例占位配置，例如 `model=myprovider/my-model-name`、provider `myprovider`、models alias `my-model-name`。
- PackyAPI 这类 OpenAI-compatible provider 的 `options.baseURL` 配成裸域名 `https://www.packyapi.com`，而不是实际兼容接口 `https://www.packyapi.com/v1`。

### 根因
- OpenCode 官方 schema 中 `model` 是 `provider/model`，`provider.<id>.models.<id>.name` 是展示元数据，不能把 `my-model-name` alias 自动改写成真实供应商模型名。
- `@ai-sdk/openai-compatible` 需要指向实际 OpenAI-compatible endpoint；PackyAPI 裸域名会导致 OpenCode 1.17.15 空事件成功退出，`/v1` endpoint 则返回明确 provider/API 错误或正常 assistant。

### 长期规避
- 产品配置示例保持中性 `myAPI` 网关，不绑定具体供应商；真实排障或 smoke 必须替换为实际 provider/model、兼容 endpoint 和鉴权信息。
- 运行前 preflight 必须阻止 `myprovider`、`my-model-name`、`my-small-model-name`、示例 baseURL、缺失 `{env:NAME}`；JSON error 事件必须展示 provider/API message，不能只显示泛化空响应。
- OpenCode `code!=0` 且 stderr 为空时，仍要解析 stdout JSON `error` 事件；PackyAPI 403 这类错误气泡应包含 `APIError`、`403`、`access_denied` 或 provider message，不能只显示 `CLI 退出码: 1`。
- OpenCode one-shot 只在启动后完全没有 assistant / error / status / progress 活动的 60 秒内按空输出超时进入 hidden retry；收到首个有效事件后必须解除外层 watchdog。重试耗尽时要追加可见 system 错误气泡并写入会话存档，不能只停在运行态或只留下 trace。
- OpenCode `--format json` 的 `step_start`、`tool_use`、reasoning 和 `text` 事件主要出现在 stdout；可见气泡解析必须消费 stdout JSONL，不能只依赖 stderr trace，否则用户会只看到最终答复，看不到思考/工具/中间 AI 气泡。
- 普通 one-shot 与并行/Loop 子任务必须走同一套 visible-event 语义。`rawStreamDelta` 只更新原始流诊断面，不能替代 `appendMessage` / `assistantDelta` / `traceSegment`；否则并行子任务会持续显示流记录，却在进程退出前没有任何对话气泡。退出时还必须按本轮已展示 assistant 文本去重完整 final text。

### 验证方式
- 回放 OpenCode `text` 事件且正文为独占 `...` / `…` 时，不应追加 assistant 气泡；包含实际正文的文本仍应正常展示。
- 对占位配置运行 `validateOpenCodeConfigForRun`，应返回 placeholder / missing env 等阻断问题。
- 对修正后的 PackyAPI `/v1` 配置运行 `OPENCODE_CONFIG=... opencode run --format json 'Reply with exactly: OK_OPENCODE_CONFIG_TEST'`，应返回 assistant 文本，或返回明确 provider/API 错误；不得再出现 `code=0` 且 tokens=0 的空 assistant。
- 对 PackyAPI 返回非零退出的场景，stdout JSON `error` 中的 provider/API 详情应进入 AI 对话错误气泡；无 JSON error 时才允许回退通用退出码。
- 对 OpenCode 启动后无 stdout/stderr 的场景，最终错误气泡应包含 OpenCode 空输出/超时诊断；hidden retry 最终失败后仍应有可见 system 错误消息。
- 回放并行 OpenCode 的 `step_start -> tool_use -> text` JSONL 时，应在对应 `tabId` 依次产生 thinking、trace、assistant 消息；完整 final text 与已流式展示文本相同时不得再追加重复 assistant 气泡。

### 关联资料
- `src/config/configService.ts`
- `src/cli/commandRunner.ts`
- `src/openCodeTabStream.ts`
- `src/test/core/openCodeTabStream.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`

## OpenCode Loop 后续轮次不能用历史回答判定当前回合成功

- 状态：有效
- 首次发现：2026-07-14
- 适用范围：OpenCode one-shot / parallel、Loop 主任务多轮复核、成功退出判定

### 现象
- Loop 子任务批次全部 completed 后，主任务确实被下一轮唤醒；OpenCode 运行约几十秒并以 `code=0` 退出，但 JSONL 只有 `step_start`、纯 thinking 和 `step_finish(reason=unknown)`，没有 assistant 正文。
- 任务随即进入 `needs-review` 并显示 `Main task did not return a valid loop decision JSON.`，看起来像主任务没有被唤醒或卡住。

### 根因
- Loop 后续轮次复用初始用户消息 ID；旧完成判定只检查“该用户消息之后是否存在任意 assistant 正文”，因此上一轮合法 `LoopMainDecision` 会把当前空响应误判为成功。
- 轮次级 JSON 解析只读取带当前 `loopTaskId + loopRound + taskRole=main` 的正文，不会读取旧轮次，于是成功判定与决策解析使用了不同时间边界。
- `code=0` 缺少当前正文的分支此前直接错误收口，没有进入非零退出已使用的 hidden retry。

### 现场判定
- 同一 provider/model 的新 session 能正常得到 `finish=stop` 和非零 input/output token；旧 session 及其 fork 都持续返回 `step_start -> step_finish(reason=unknown)`，`input=0/output=0`。因此先排除 provider/model 配置，再按会话级故障处理。
- 旧 session 现场累计约 919k input token、6.7m cache-read token；OpenCode SQLite 中 message/part JSON 有效。`opencode export` 恰在 128 KiB 截断是 CLI stdout 限制，不是持久化 JSON 损坏。
- 对 disposable fork 发送字面 `/compact` 也返回零 token；`--command compact` 只查找用户自定义 command，不是 OpenCode 原生 compact 调用，不能作为自动恢复依据。

### 长期规避
- 普通任务可继续使用当前用户消息锚点；Loop 内部回合必须只依据当前 OpenCode 进程尝试是否产生非 thinking assistant 正文。
- one-shot 与 parallel 的 `code=0` 空正文统一进入既有 hidden retry；重试耗尽后才落可见错误与任务失败记录。
- 只有已有远端 session、无 provider JSON error 的 Loop 主任务才允许一次 fresh-session retry。恢复尝试不传旧 `--session`、重发完整主任务 prompt；捕获新 `sessionID` 后保留旧 session、复制 UI 消息并用 `bindLoopTaskToSession` 移动任务记录。新 session 再次空响应不得继续 rollover。
- 可恢复的会话级空响应使用本地化 system 恢复提示，不追加看起来像最终 provider/model 配置错误的 trace；真实 provider JSON error 保持原错误展示和重试语义。
- 日志只记录 task/round、当前正文布尔值与长度、结构化终态和 stdout/stderr 长度，不记录完整模型正文或提示词。

### 验证方式
- 当 `conversationHasFinalConclusion=true`、`isLoopRun=true`、`currentAttemptHasAssistantAnswer=false` 时，`resolveOpenCodeSuccessfulExitOutcome` 必须返回 `retry`。
- 当前尝试出现非 thinking assistant 正文时返回 `complete`；重试计数达到上限后空响应返回 `fail`。
- 回放只有 `step_start` / thinking / `step_finish(reason=unknown)` 的当前轮 JSONL，即使历史会话已有合法 JSON，也不得把当前轮标记为 `end`。
- `shouldRecoverOpenCodeLoopMainSessionInFreshSession` 仅对 provider-clean、已有远端 session、未 rollover 的主任务返回 true；Loop 子任务、普通任务、provider error 和二次恢复必须返回 false。
- `bindLoopTaskToSession` 后源 task store 删除（无其他任务时），目标 session store 保留相同任务和新 `sessionId`。

### 关联资料
- `src/openCodeRunCompletion.ts`
- `src/extension.ts`
- `src/test/core/openCodeRunCompletion.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode 分组/子代理执行不能用父 JSONL 静默判断卡死

- 状态：有效
- 首次发现：2026-07-12
- 适用范围：OpenCode 1.17.18、`opencode run --format json`、分组/子代理任务、one-shot hidden retry

### 现象
- 父 `opencode run --format json` 已返回 `step_start`、assistant 文本和工具事件，之后连续 300 秒没有新的 stdout/stderr，插件报“kept returning progress”并终止本次尝试。
- 同一时间 OpenCode 自身日志仍持续记录子代理的文件读取、搜索、模型 stream 和 loop step；超时前 1 秒仍有活动，说明任务并未卡死。

### 根因
- OpenCode 分组/子代理在内部 session 中执行时，不保证把每个子代理活动实时转发到父 `run --format json` JSONL。
- 父 stdout/stderr 的静默只表示“当前没有父事件”，不能作为整个 OpenCode 任务的可靠心跳。固定 5 分钟活跃空闲超时会误杀正常长任务，并错误触发 hidden retry。

### 长期规避
- 只保留 60 秒启动 watchdog，用于识别进程启动后完全没有 assistant / error / status / progress 的配置或启动异常。
- 首个有效事件到达后立即解除外层 watchdog；后续生命周期只由 CLI exit/error、用户停止和扩展进程管理收口，不再根据父 JSONL 静默时长自动杀进程。
- 不通过读取 OpenCode 私有数据库或日志来补造心跳，避免绑定外部 CLI 的内部存储实现。

### 验证方式
- `resolveOpenCodeOneShotWatchdogTimeoutMs(false)` 返回 60 秒，传入已检测到的 `step_start`/progress 活动后返回 `null`。
- 回放包含首个 JSONL 活动、随后超过 5 分钟父流静默的分组任务时，不应再出现 `runPrompt-one-shot-idle-timeout`，任务应继续等待 OpenCode 自身退出或用户停止。
- 启动后 60 秒完全没有 stdout/stderr 的场景仍应进入 hidden retry，并保留可见 system 错误消息与日志。

### 关联资料
- `src/cli/opencodewatchdog.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode `UnknownError` 要保留 server ref

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode `opencode run --format json`、自定义 OpenAI-compatible provider、hidden retry 错误展示

### 现象
- OpenCode stdout JSON 返回 `{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_xxx"}}}`。
- 用户侧如果只看到通用退出码或只看到 `Unexpected server error`，无法把插件日志、OpenCode server 日志和 provider 侧请求串起来。

### 触发条件
- Provider/server 返回 OpenCode JSON error，但 stderr 为空、退出码为 1。
- hidden retry 已经记录 provider error 后，用户在下一次重试等待期间点击停止。

### 根因
- OpenCode 把部分 provider/server 失败写入 stdout JSON `error.data.ref`，这个 ref 是继续查 server 日志的关键线索。
- 停止动作是本地运行控制事件，不能反向覆盖或伪造成 provider 错误。

### 长期规避
- 非零退出时优先解析 stdout JSON `error`，错误气泡必须保留 `error.name`、`data.message`、`data.ref`，并继续保留可用的 `statusCode`、`metadata.url`、`responseBody`。
- 用户在 hidden retry 等待期间点击停止时，只记录为本地 stopRun，不要把停止动作误判成 provider `UnknownError`；已经落入 stdout 的 provider error 仍留在 OpenCode 日志用于诊断。
- 当前配置排查时只摘要 provider、model、baseURL host，不输出 `apiKey`。

### 验证方式
- `parseOpenCodeRunOutput` 覆盖 `UnknownError` / `Unexpected server error` / `ref`，`buildOpenCodeRunFailureMessage` 不应回退到 `CLI exit code`。
- AI 对话层最终 system message 应包含 `UnknownError`、provider message 和 `err_xxx`；空 stdout/stderr 仍应有可见 fallback 错误；`stopRun` 不应创建 provider 错误。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `src/test/session/sessionMessageActions.test.ts`

## OpenCode 自定义 provider 不能传裸 `--model`

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode `opencode run --format json`、自定义 OpenAI-compatible provider、UI 托管模型选择

### 现象
- `~/.opencode/config.json` 顶层 `model` 为 `myAPI/gpt-5.5` 时，终端直接运行默认 `opencode run --format json` 能成功，显式 `--model myAPI/gpt-5.5` 也能成功。
- 插件如果传 `opencode run --format json --model gpt-5.5 ...`，OpenCode 会绕开 provider-qualified 默认配置，返回 `UnknownError / Unexpected server error / err_xxx`。

### 触发条件
- OpenCode 配置使用自定义 provider，且 provider id 不是官方内置模型前缀。
- UI 或 managed model store 保存的是 provider 内部裸模型 key，例如 `gpt-5.5`。

### 根因
- OpenCode CLI 层使用 `provider/model` 选择 provider；本地 OpenAI-compatible endpoint 自身可能接受裸模型 `gpt-5.5`，但这不等于 OpenCode CLI 的 `--model gpt-5.5` 可定位到自定义 provider。
- Codex 能跑通是因为 Codex 走自己的 CLI/配置和模型选择逻辑，不复用 OpenCode 的 provider-qualified model 规则。

### 长期规避
- OpenCode 运行前应基于已生效 `config.json` 顶层 `model=provider/model` 和 `provider.<id>.models` 规范化 UI 选择：裸模型存在于 active provider 时传 `provider/model`。
- 裸模型不在 active provider 的 `models` 中时，应显示配置/模型不匹配诊断，不能把裸模型继续传给 `opencode run --model`。
- 不要把 `provider/model` 直接拿去调用底层 OpenAI-compatible endpoint；该写法只属于 OpenCode CLI provider 选择层。

### 验证方式
- `buildCliArgs("opencode", { model: "gpt-5.5", openCodeConfigContent }, "hello")` 应生成 `--model myAPI/gpt-5.5`。
- provider-qualified `myAPI/gpt-5.5` 应保持不变。
- 不在 active provider models 中的裸 `glm-5.2` 应产生可诊断错误，不应被错误映射或传入 OpenCode。

### 关联资料
- `src/cli/modelArgs.ts`
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode 推理力度不能按 adapter 或模型名猜测

- 状态：已规避
- 首次发现：2026-07-10
- 适用范围：OpenCode 模型选择、PanelState、`opencode run` 参数、配置切换

### 现象
- 同为 `@ai-sdk/openai-compatible` 的模型可能有不同 variants，也可能完全没有可调档位；把 OpenCode 固定显示为 low/high 会展示无效选项。
- 把 `--thinking` 或 `thinkingArgs.opencode.*` 当成推理力度会与 OpenCode 官方语义不一致；配置/模型切换后复用旧选择还会把无效 `--variant` 传给新模型。

### 触发条件
- 仅根据 provider `npm`、provider 名或模型名推断能力。
- PanelState 只增量更新 options，没有在 CLI、配置或模型变化时发送完整 Default-only 快照。
- 持久化键未包含 active config id 和精确 `provider/model`，或运行时未重新校验选择是否属于当前 options。

### 根因
- OpenCode 的 variant 集合由精确模型 metadata、模型版本和用户显式配置共同决定，adapter 只是协议层输入，不能证明后端接受哪些推理参数。
- `--thinking` 控制 thinking blocks 展示；实际力度参数是 `--variant <name>`，且不传 variant 才表示跟随 OpenCode 默认。

### 长期规避
- 优先读取 `opencode models <provider> --verbose` 的精确模型 metadata；失败时仅回退当前激活配置显式 variants，再失败则 Default-only。
- 能力身份至少包含命令/version、active config id、配置内容 hash、provider 和 model；异步结果应用前校验请求序号和完整身份。
- 选择按配置和精确模型隔离；null 删除持久值，失效选择自动清理。运行时只传当前有效非空值，且用户显式 `--variant` 优先。
- 不恢复固定 `thinkingModeOpencode` 或 `thinkingArgs.opencode.*`；不得从 legacy ThinkingMode 迁移或映射成 variant。

### 验证方式
- 覆盖 CLI metadata 优先、配置 variants 回退、未知模型 Default-only、配置/模型隔离、失效清理和异步竞态。
- 覆盖 Default 不传 `--variant`、有效值追加、`--variant value` / `--variant=value` 显式参数优先，以及 Codex / Claude 原行为。
- 脱敏 smoke 只使用 `opencode models <provider> --verbose` 实际返回的 variant；返回空 variants 时验证命令不带 `--variant`，不得臆造档位。

### 关联资料
- `src/cli/openCodeModelCapabilities.ts`
- `src/modelSelectionStore.ts`
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode `--auto` 不能写成“禁用权限系统”

- 状态：有效
- 首次发现：2026-07-10
- 适用范围：OpenCode 1.17.16、`src/cli/commandRunner.ts`、普通消息与 Loop 任务执行

### 现象
- 加入 `opencode --auto` 或 `opencode run --auto` 后，默认 `external_directory: ask` 的跨目录读写可以自动执行，容易被误写成“完全跳过权限”或“禁用权限系统”。
- 当用户配置、agent 配置或 OpenCode 默认规则显式拒绝某项权限时，请求仍会被阻止；例如 `.env` 等文件的显式 `read: deny` 保护不会被 `--auto` 绕过。

### 触发条件
- 把 OpenCode `--auto` 直接类比为 Claude `--dangerously-skip-permissions` 或 Codex `--dangerously-bypass-approvals-and-sandbox`，但没有核对 OpenCode 的 `ask` / `allow` / `deny` 语义。
- 为了“全部目录可读写”而在 runtime overlay 中无条件写入全局 `permission: "allow"`，覆盖用户已有的显式拒绝规则。

### 根因
- OpenCode `--auto` 的官方语义是自动批准**未被显式拒绝**的权限请求；它处理的是 `ask`，不是把 `deny` 改成 `allow`。
- `external_directory` 默认通常为 `ask`，所以 `--auto` 足以覆盖默认跨目录请求；但用户级、agent 级和内置显式拒绝仍属于独立安全边界。

### 长期规避
- 文档、UI 和代码注释统一使用“自动批准未被显式拒绝的请求”，不得写成“关闭权限”“绕过所有权限”或“所有文件无条件可读写”。
- 插件只在共享参数构建器集中注入并去重 `--auto`；runtime overlay 保留用户 `permission`，不得静默覆盖显式 `deny`。
- 若未来产品确需覆盖某一权限，只允许基于明确需求做最小范围规则（例如单独处理 `external_directory`），并单独评审安全影响；禁止顺带移除 `.env` 等保护。

### 验证方式
- 默认配置下，以工作目录 A 运行 `opencode run --auto`，验证可以读取并写入外部目录 B。
- 显式设置 `external_directory: deny` 后重复测试，确认请求被阻止；对 `.env` 等显式拒绝文件确认仍不可读取。
- 回归检查普通消息、并行任务、Loop 主任务/子任务与无 prompt 终端启动都只包含一次 `--auto`。

### 关联资料
- `src/cli/commandRunner.ts`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`

## OpenCode MCP 卸载不能依赖 CLI，且全局配置不能写错路径

- 状态：已规避，需随 OpenCode 版本复核
- 首次发现：2026-07-10
- 适用范围：OpenCode 1.17.16 / 1.17.18、全局 MCP 安装卸载、MCP 健康检测

### 现象
- `opencode mcp add` 可以写入配置，但当前 CLI 没有 `mcp remove` 子命令；调用 `opencode mcp remove --scope user <id>` 必然失败。
- 旧回退逻辑误写 `~/.opencode/config.json`，且只删除 `mcpServers` / `mcp_servers`，无法删除官方全局配置中的顶层 `mcp[id]`。
- 插件模型档案 `~/.opencode/config.json` 与官方全局 MCP 文件 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 不是同一个配置来源。
- `opencode mcp list --pure` 即使列出的服务全部连接失败，也可能退出 `0`；只看退出码会把“不健康”误判成“健康”，只保留健康 id 又会把已安装条目误判成未安装。

### 触发条件
- 把 Claude/Codex 的 add/remove CLI 工作流直接套到 OpenCode。
- 把配置中心维护的 OpenCode 模型档案路径误当成官方 XDG 全局配置路径。
- 删除逻辑只兼容 Claude 的 `mcpServers` 命名。
- 健康检测把列表命令退出码、连接成功状态和安装状态合并成一个布尔值。

### 根因
- OpenCode 当前只提供 `mcp add/list/auth/logout/debug`，没有对称的 `mcp remove`。
- OpenCode 官方全局 MCP 使用 XDG 配置路径和顶层 `mcp`；插件自己的模型档案为了配置中心隔离保存在 `~/.opencode/config.json`。
- `mcp list` 同时承载“已配置条目清单”和“当前连接状态”；单个条目 `failed` 不会让列表命令整体失败。

### 长期规避
- OpenCode MCP 安装和卸载直接管理 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`，不执行 add/remove CLI。
- local MCP 固定写入 `type=local`、`command` 数组、`environment` 和 `enabled`；remote 固定写入 `type=remote`、`url`、`headers` 和 `enabled`。
- 安装只合并 `mcp[id]`；卸载只删除 `mcp[id]` 且目标不存在时幂等成功。其他顶层字段和已有 MCP 必须保留。
- JSON/JSONC 必须先完整解析；无效配置或非对象 `mcp` 不得覆盖。成功修改使用同目录临时文件原子替换。
- 安装状态不要依赖健康检测列表：配置页打开时按目标 id 是否存在于对应配置文件判断，Claude 读 `~/.claude.json`，Codex 读 `~/.codex/config.toml`，OpenCode 读 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 顶层 `mcp`。健康检测列表只在用户主动点击健康检查时用于连接状态映射；连接失败映射为 `installed: true`、`status: unhealthy`。

### 验证方式
- 对默认路径、`XDG_CONFIG_HOME` 和 `~` 展开做路径单测。
- 在临时 XDG 配置中预置 JSONC、其他顶层字段和已有 MCP，分别安装 local/remote、覆盖同 id、卸载目标 id，确认结构与字段保留。
- 对无效 JSON 和非对象 `mcp` 断言操作失败且原文件内容不变。
- 对不可连接的 local/remote 服务运行真实 `opencode mcp list --pure`，确认条目显示 `failed` 时 parser 仍将其映射为已安装且不健康，并将未列出条目映射为未安装。

### 关联资料
- `src/config/mcpInstallArgs.ts`
- `src/config/openCodeMcpConfig.ts`
- `src/config/mcpHealth.ts`
- `src/config/mcpService.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## npx 缓存损坏会把可用 MCP 误报为健康检查超时

- 状态：已确认，需在 MCP 排障时优先排除
- 首次发现：2026-07-11
- 适用范围：Claude/Codex/OpenCode 通过 `npx -y` 启动的 stdio MCP，尤其是 Context7 等频繁更新的 npm 包

### 现象
- `claude mcp list` 的健康检查出现单个 MCP 连接失败或超时。
- 直接执行对应 `npx -y <package>` 可能报 `ENOTEMPTY: directory not empty, rename .../.<package>-*`。
- MCP 包本身在 npm 或官方 Registry 中仍然存在，且删除损坏缓存后健康检查恢复。

### 触发条件
- `~/.npm/_npx/<hash>/node_modules/<scope>/<package>` 下同时存在旧包目录和 npm 临时 rename 目录。
- 上一次 `npx` 安装或更新被中断，留下半更新状态。

### 根因
- npm 在 `_npx` 缓存目录中更新包时需要 rename 临时目录；残留目录导致 rename 失败。
- 健康检查只看到 MCP 进程未按时完成初始化，容易误判为 MCP 服务或配置已经失效。

### 长期规避
- 对 `npx -y` MCP 的单点失败先运行对应 `npx -y <package> --help` 或等价启动探针。
- 如果看到 `ENOTEMPTY` / `rename`，删除对应 `~/.npm/_npx/<hash>` 损坏缓存目录后复测。
- 只有 npm/PyPI/官方 Registry 或供应商官方文档确认包名/端点失效时，才从全局配置或市场清单删除。

### 验证方式
- 清理损坏 `_npx` 目录后重新运行 `claude mcp list`，确认失败项变为 `Connected`。
- 对仓库内 MCP 市场包名定期运行 npm/PyPI/官方 Registry 可用性检查，避免重新引入已下线包名。

### 关联资料
- `media/mcp_marketplace.json`
- `src/config/mcpHealth.ts`
- `src/config/mcpService.ts`

## TypeScript 构建不会自动删除已移除源码对应的 dist 产物

- 状态：已规避
- 首次发现：2026-07-11
- 适用范围：`npm run build`、`node --test dist/test/*.test.js`、已删除或重命名的 `src/test/*.ts`

### 现象
- 仓库根目录出现多个未跟踪的 `.tmp-loop-launch-*` 空目录。
- 当前源码已没有 `loopBoundaryRecord.test.ts`，但 `dist/test/loopBoundaryRecord.test.js` 仍存在并可被全量 `node --test dist/test/*.test.js` 执行。
- 旧测试使用 `fs.mkdtempSync(path.join(process.cwd(), ".tmp-loop-launch-"))`，测试进程异常退出或被中止时会把空目录留在仓库根目录。

### 触发条件
- 测试源码被删除或重命名后，只运行 `tsc -p ./` 增量覆盖输出，不先清理 `dist`。
- 后续直接按 `dist/test/*.test.js` 跑全量测试，导致陈旧 JS 测试产物继续参与执行。
- 测试 helper 把临时目录建在 `process.cwd()` 下，而不是系统临时目录；进程未进入 `finally` 清理路径时就会污染仓库根目录。

### 根因
- `tsc` 不负责删除 `outDir` 里已经没有源文件对应的旧输出。
- 旧 `dist/test/loopBoundaryRecord.test.js` 保留了仓库根目录临时目录创建逻辑。

### 长期规避
- `npm run build` 必须先清理 `dist`，再执行 `tsc -p ./`。
- 新增测试临时目录默认使用 `os.tmpdir()`；如确需建在仓库内，目录前缀必须加入 `.gitignore`，并确保异常路径可清理。
- 发现无对应 `src/test` 的 `dist/test/*.test.js` 时，优先清理 `dist` 后重建，不要按旧产物继续解释失败。

### 验证方式
- 运行 `npm run build` 后确认 `dist/test/loopBoundaryRecord.test.js` 不再存在。
- 运行 `find . -maxdepth 1 -type d -name '.tmp-loop-launch-*'`，确认仓库根目录没有残留临时目录。

### 关联资料
- `package.json`
- `.gitignore`
- `dist/test/loopBoundaryRecord.test.js`（已清理的历史生成物）

## Loop `running` 状态不能脱离当前运行所有权永久锁定 Tab

- 状态：已规避
- 首次发现：2026-07-13
- 适用范围：Loop 主任务 conversation tab、关闭 Tab、重置当前会话、任务队列、Extension Host 异常或重载后的任务记录

### 现象

- 任务 tab 已不再有主任务、子任务、裁判或参与者 CLI 进程，但任务记录仍为 `running`，关闭和重置会被静默拒绝。
- 任务记录已经是 `needs-review`、`error` 或 `stopped`，群聊已经显示“任务已中断，需要人工复核或继续”，但尚未异步退出的旧编排所有权仍让主 Tab 显示执行中。
- 旧 Webview 在重置请求发出时先清空本地消息；扩展端随后因同一锁定条件拒绝操作，用户切回原 tab 后又看到原会话，形成“重置无效”的假成功体验。

### 触发条件与根因

- Loop 的持久化 `running` 状态原本用于保护主任务与子任务、裁判主持人与参与者之间没有单个 CLI 进程的编排空档。
- 如果编排路径出现未捕获异常，或 Extension Host 已不再拥有该任务的执行上下文，记录没有被写入 `error` / `stopped`，仅用持久化状态判断会把残留记录永久视为运行中。
- 如果运行所有权能覆盖明确中断终态，或者所有权只用任务 ID Set 表示，终止后立即恢复会出现两类竞态：旧运行仍显示执行中；旧运行的 `finally` 删除同一 task ID 时误删新恢复运行的所有权。子任务处于重试等待期时，缺少派发前终态门禁还会在等待结束后把 stopped 任务重新写回 `running`。
- 前端乐观清空会话并不能证明“新建空白 Tab + 关闭旧 Tab”已经在扩展端成功完成；前后端锁定状态短暂不同步时会放大这个问题。

### 长期规避

- 运行态必须由持久化任务状态和当前 Extension Host 的运行所有权共同判定。`runLoopPrompt` 从任务创建/恢复到收尾期间通过 `loopOrchestrationOwnership` 引用计数维护所有权，并与主、并行和交互 CLI 运行集合合并；`status=running` 且存在所有权时仍要保护编排空档，每个运行只能释放自己的句柄。
- `needs-review`、`error`、`stopped` 是明确中断终态，必须优先于残留所有权结束视觉运行态和关闭锁；每次主轮次、子任务轮次和重试派发前重新读取 Store，发现中断终态立即返回，禁止复活任务。
- 任务记录为 `running` 但没有任何当前运行所有权时，收敛为 `stopped`，清空活跃子任务 ID，并把仍为 `pending` / `running` 的子任务和辩论参与者写入终态；不要继续保留关闭锁。
- `runLoopPrompt` 的未捕获异常必须把仍为 `running` 的任务写成 `error`，然后再释放运行所有权。
- 重置当前会话只能由扩展端成功完成新建空白 Tab、关闭旧 Tab 后通过 PanelState 和 `setMessages` 更新 Webview；请求发送前不得清空旧 Tab 消息或强制切换交互模式。编辑器上下文的下一次提示意图可以保留，但不能替代成功确认。

### 验证方式

- 构造 `status="running"` 且运行所有权集合为空的任务，确认状态收敛为 `stopped`，主任务 Tab 解除关闭和重置锁；同一任务存在主/并行/交互运行或编排所有权时仍保持锁定。
- 构造 `status="stopped" / "error" / "needs-review"` 且仍有旧所有权的任务，确认不再显示运行中；同一 task ID 先后获取两份所有权，释放旧句柄后新句柄仍存在。
- 断言 SessionTabs 在运行态判定后再读取任务状态，避免本轮已经收敛为 `stopped` 却把旧 `running` 回传给 Webview。
- 断言 Webview 的重置请求只发送消息并保留旧视图，Extension Host 拒绝时不会出现空白会话；成功时由回推状态切换到空白 Tab。
- 运行 `npm run build && node --test dist/test/session/conversationTabLock.test.js dist/test/loop/loopDebate.test.js dist/test/loop/loopOrchestrationOwnership.test.js dist/test/session/sessionMessageActions.test.js`。

### 关联资料

- `src/extension.ts`
- `src/loopDebate.ts`
- `src/loopOrchestrationOwnership.ts`
- `src/sessionTabs.ts`
- `src/webview/viewContentScript/eventBindings.ts`
- `src/test/session/conversationTabLock.test.ts`
- `src/test/loop/loopDebate.test.ts`

## Loop 编排角色不能复用为模型角色

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：Loop Webview、模型持久化、`sendPrompt`、主从执行、红蓝辩论、续跑与自动唤醒

### 现象
- Codex Loop 同时展示“主任务模型 / 子任务模型”，同一任务不同角色可能收到不同模型。
- Claude 明明不支持插件侧模型选择，Loop 区域仍容易被通用模型 UI 逻辑误伤。
- OpenCode 的 `small_model` 容易被误解为 Loop 子任务模型，进而错误删除或映射。

### 根因
- 把 Loop 的主任务、子任务、裁判主持人、参与者等编排角色，错误建模成通用模型角色。
- OpenCode primary/small 是 CLI 自身能力，与 Loop 主从编排无直接对应关系。

### 长期规避
- Claude 在 Coding/Loop 均不展示插件侧模型选择。
- Codex 在 Coding/Loop 复用同一个模型下拉，消息只传 `model`；普通轮次、子任务、裁判、参与者、共识汇总、续跑和唤醒全部沿用该值。
- OpenCode 在 Coding/Loop 均保留 primary/small 和各自思考力度；所有 Loop 对话角色使用 effective primary，small 只用于 OpenCode 内部请求。
- 历史 `selectedLoopByConfigId` / `loopRolesByConfigId` 可以继续归一化读取，避免旧文件崩溃，但不得进入 PanelState、Webview payload 或运行时选择。

### 验证方式
- Webview 覆盖 OpenCode 双模型、Codex 单模型、Claude 无模型三种 Coding/Loop 组合。
- 用带旧 `loopMainModel` / `loopSubtaskModel` 的兼容消息回放，确认运行输入只保留统一 `model`。
- 构造包含旧主/子选择的模型存储，确认 PanelState 只暴露通用 Codex 选择。

### 关联资料
- `src/webview/viewContentScript/modelManager.ts`
- `src/sessionMessageActions.ts`
- `src/extension.ts`
- `src/loopDebateRunner.ts`
- `src/test/webview/opencodedualmodelwebview.test.ts`
- `src/test/session/sessionMessageActions.test.ts`

## 内部思考 wrapper 不能用通用 HTML 清洗

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：OpenCode JSONL text/reasoning、Codex reasoning、历史消息清洗

### 现象
- OpenCode `text` 事件可能直接返回 `<thinking>...</thinking>`，标签会原样显示在气泡中；同一事件还可能在思考块后继续包含可见正文。
- 如果简单删除所有尖括号内容，会破坏用户问题、代码片段和普通 `<div>` 等合法内容。

### 根因
- 外部 CLI 的内部思考协议与 assistant 正文共用 text 通道，旧解析器把整段都当作可见 assistant 文本。
- 通用 HTML sanitizer 无法区分协议 wrapper 与用户内容。

### 长期规避
- 只识别 `<thinking>`、`<think>`、`<analysis>`、`<reasoning>` 四类 wrapper，大小写不敏感。
- OpenCode 混合 text 按原顺序拆成 thinking 与 assistant；最终答复只收集 assistant 段。
- reasoning、Codex thinking 和历史消息只去除 wrapper 标签，不删除普通 HTML 或代码标签。

### 验证方式
- 回放 `~/.sinitek_cli/logs/sinitek-cli.opencode.2026-07-12.log` 中的 `<thinking>Mapping Codex loop model controls and execution flow</thinking>` 样本，确认可见文本无尖括号 wrapper。
- 覆盖混合思考+正文、纯思考、历史消息修复和普通 `<div>` 保留。

### 关联资料
- `src/thinkingMarkup.ts`
- `src/cli/commandRunner.ts`
- `src/codexReasoningContent.ts`
- `src/sessionStore.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `src/test/core/codexReasoningContent.test.ts`

## OpenCode 最终回复不能只靠 `[final_answer]` 文本标记识别

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：OpenCode `run --format json`、固定严格最终答复协议、one-shot / 并行 conversation tab

### 现象
- OpenCode 已返回非空助手答复并正常退出，界面仍追加“正文未包含 `[final_answer]`，严格最终答复判定拒绝”的 system 错误和任务失败气泡。
- 真实会话 `ses_0aaa0f435ffenK9Zu7ID3cpsL3` 的最终助手消息是在等待用户选择项目序号；OpenCode 导出显示该消息 `finish="stop"`，对应 parts 同时包含非空 `text` 与 `step-finish reason="stop"`。

### 触发条件
- 普通 OpenCode 任务使用固定严格最终答复协议。
- OpenCode 返回面向用户的最终回复，但没有遵循插件追加的 `[final_answer]` 文本约定。
- 运行时只检查正文标记，没有消费 OpenCode 自带的结构化终态。

### 根因
- 严格策略设计允许“结构化 final 或文本标记”，但实现只接入了 Codex `phase="final_answer"`，遗漏了 OpenCode JSONL 的 `step_finish.reason="stop"`。
- 单独看到 `text` 不能证明它是最终回复，因为 OpenCode 在 `tool-calls` 阶段也可能输出过程文本；单独看到 `stop` 也不能证明存在可见答案。

### 长期规避
- 解析 OpenCode JSONL 时按 `messageID` 关联非 thinking assistant `text` 与 `step_finish.reason="stop"`，二者属于同一消息才视为结构化最终答复。
- `step_finish.reason="tool-calls"`、跨 message ID 的正文与终态、无正文 `stop`、thinking-only 文本继续拒绝，不得根据问号或“请回复”等自然语言猜测终态。
- one-shot 与并行 tab 的成功退出路径必须传入同一个结构化终态信号，避免两条链路行为漂移。

### 验证方式
- 构造同 message ID 的 `text` + `step_finish reason="stop"`，确认严格策略成功收口。
- 构造 `tool-calls`、跨 message ID 和无正文 `stop`，确认均不产生结构化最终答复信号。
- 运行 `npm run build && node --test dist/test/cli/opencodeCommandRunner.test.js dist/test/core/finalConclusion.test.js`。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## Loop 子任务不能在用户可见回复中直接提问

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：Loop 主从执行、子任务沟通文件、独立子任务 conversation tab

### 现象
- 子任务遇到需求不明、授权不足或依赖冲突时停止推进，却直接在 assistant 气泡里向用户提问。
- 主任务虽然会读取子任务沟通文件，但文件没有固定的待确认结构，难以稳定区分普通遗留问题与必须确认的阻塞事项。

### 触发条件
- 子任务提示词只要求结束前写执行报告，没有明确规定“有疑问立即结束”和“不得向用户提问”。
- 子任务运行在独立可见标签页，assistant 输出会正常形成气泡，因此任何直接提问都会绕过主任务统一复核。

### 根因
- 主从协议缺少疑问转交契约：没有定义触发边界、沟通文件字段、任务记录收口方式和唯一允许的最终回复。
- 现有 `end -> completed -> 唤醒主任务` 已能完成交接，问题不在调度状态，而在模型职责约束不足。

### 长期规避
- 仅当问题必须由主任务或用户确认后才能安全继续时，子任务立即停止；能依据现有事实和仓库规则判断的问题仍应自行处理。
- 待确认内容只写入沟通文件的 `## 待主任务确认`，至少包含问题、已知事实、影响/阻塞步骤、选项和推荐方案。
- 子任务按 completed 正常收口并使用固定中性 assistant 文本，不提问、不复述问题、不等待回复；主任务读取后自行决策，确需人工确认时走 blocked。
- 不使用问号、疑问词等启发式隐藏或替换流式消息，避免误伤正常技术说明和已经可见的子任务 assistant 气泡。

### 验证方式
- 断言子任务 model prompt 同时包含触发条件、沟通章节、任务记录更新、禁止提问和固定收口文本。
- 断言主任务 model prompt 必须处理待确认章节，并在确需人工确认时返回 blocked。
- 新建子任务沟通文件，确认默认包含状态为“无”的结构化 `## 待主任务确认` 章节。
- 运行 `npm run build && node --test dist/test/loopSkillIntegration.test.js dist/test/loop/loopTaskStore.test.js`。

### 关联资料
- `src/extension.ts`
- `src/loopTaskStore.ts`
- `src/test/loopSkillIntegration.test.ts`
- `src/test/loop/loopTaskStore.test.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## Loop 子任务手动恢复必须复用自动重试的完成收尾

- 状态：已规避
- 首次发现：2026-07-13
- 适用范围：Loop 主从子任务、子任务 Tab、自动重试、用户手动恢复和主任务自动唤醒

### 现象
- 子任务在运行中被用户中止后，用户在该子任务 Tab 手动继续并成功完成，主任务可以被唤醒，但子任务 Tab 没有按统一成功收尾自动关闭。
- 相同子任务因执行错误触发自动重试并成功时，状态、Tab 关闭和主任务后续编排均正常，导致两种恢复方式的体验和资源清理不一致。

### 根因
- 自动重试在 `runLoopSubtaskWithRetry` 中直接执行子任务状态收尾和 Tab 自动关闭。
- 手动恢复在 `maybeWakeLoopMainAfterSubtaskContinuation` 中单独更新状态并唤醒主任务，遗漏了同一 Tab 生命周期收尾。

### 长期规避
- 自动重试和手动恢复成功都必须调用同一个子任务完成生命周期函数；先更新子任务记录和沟通记录，再固定关闭成功结束的子任务 Tab。
- 只在 `TaskRunStatus === "end"` 且存在目标 Tab 时关闭子任务 Tab；错误、停止或未找到目标 Tab 时不得关闭。
- 主任务是否继续仍由既有可恢复状态和主任务连续 AI 失败上限决定；Tab 收尾不得绕过或放宽这些守卫。

### 验证方式
- 单测覆盖成功结束时的状态更新先于 Tab 关闭、成功但无目标 Tab、错误/停止不关闭三种边界。
- 断言 `runLoopSubtaskWithRetry` 与 `maybeWakeLoopMainAfterSubtaskContinuation` 都接入共享收尾函数，且既有手动子任务 coding 路由仍会调用恢复唤醒。
- 运行 `npm run build && node --test dist/test/loop/loopSubtaskLifecycle.test.js dist/test/session/sessionMessageActions.test.js`。

### 关联资料
- `src/loopSubtaskLifecycle.ts`
- `src/extension.ts`
- `src/test/loop/loopSubtaskLifecycle.test.ts`
- `src/test/session/sessionMessageActions.test.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## OpenCode 的 spawn cwd 正确但会话仍可能落到 `/`

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：OpenCode 1.17.18、VS Code extension host、`opencode run` one-shot / 并行 / Loop 路径

### 现象
- 插件 `cli-startup` 日志中的 cwd 是目标项目，但 OpenCode export 与数据库中的 session `directory`、assistant `path.cwd/root` 都是 `/`，`projectID` 为 `global`。
- 模型从文件系统根目录搜索，可能找到多个包含相同相对目录的仓库，并要求用户重新选择当前项目。

### 触发条件
- VS Code extension host 的环境变量继承了 `PWD=/`。
- child process 只通过 spawn option 设置正确 cwd，但继续原样继承旧 `PWD`。
- 使用 OpenCode `run` 创建或续接任务；普通 `debug info` 不一定暴露该问题。

### 根因
- OpenCode `run` 先按真实进程 cwd 创建 CLI 实例，随后其内部请求还会读取 `PWD` 解析工作目录。
- 当真实 cwd 是项目、`PWD` 却是 `/` 时，同一 OpenCode 进程会先记录项目实例，再创建一个根目录实例；新会话最终绑定到 `/`。
- 这不是 child process 忽略 spawn cwd，也不是插件 workspace key 本身丢失，因此只检查插件 cwd 日志会得到误导性结论。

### 长期规避
- 所有带 cwd 的 CLI child process 环境都应把 `PWD` 最后收敛为同一路径，调用方 env override 和 runtime overlay 不得再次覆盖它。
- OpenCode 并行启动日志必须包含 cwd，排查时同时核对插件日志、OpenCode `creating instance/fromDirectory` 日志和 session export 的 `directory/path`。
- 不通过直接修改 OpenCode 数据库修复历史会话；保证后续实际进程 cwd/PWD 正确，必要时新建底层会话。

### 验证方式
- 使用 mock child 同时记录 `process.cwd()` 与 `process.env.PWD`，传入错误 `PWD=/` 后断言两者仍等于目标 workspace cwd。
- 可在隔离 HOME/XDG 目录中用 OpenCode 1.17.18 和无效模型复现：stale `PWD=/` 会出现第二个 `directory=/` 实例，同步 `PWD` 后只创建目标项目实例。
- 运行 `npm run build && node --test dist/test/cli/opencodeCommandRunner.test.js`。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/exec-plans/completed/2026-07/2026-07-12-opencode-workspace-cwd.md`

## 历史：已移除的 Loop Workflow Skill 根分类

- 状态：已于 2026-07-15 下线；以下为历史记录
- 首次发现：2026-07-12
- 适用范围：Loop 新任务分类、排队 prompt、非开发任务与旧任务恢复

### 现象
- 翻译、摘要或意图不明的任务，可能仅因长期记忆或补充上下文里的开发词汇被误判为 development，继而出现 Skill 候选目录和正文注入。
- Skill pack 缺失、损坏或没有合法 ID 时，如果把可选能力失败当成主任务失败，会错误进入 `needs-review`，中断原本可以直接安排的 Loop。

### 触发条件
- 根分类读取已经拼入长期记忆、系统补充或模型生成文本的 `modelPrompt`，或根据旧记录重新猜测任务类型。
- `non_development`、unknown、legacy 或 Skill 校验失败路径仍尝试加载 pack、追加 catalog，或累计主任务 AI 失败。

### 根因
- `modelPrompt` 不是用户本轮原始意图，可能包含跨轮记忆、自动补充文本或模型输出；把它作为分类证据会让不可信派生内容反向开启高级能力。
- Workflow Skill 是 development Loop 的可选增强，不是 Loop 调度成功的前置条件。

### 长期规避
- 根任务只使用原始 `displayPrompt`、原始 `contextTags` 和宿主确认的 workspace / active-editor 路径分类；不得读取 `modelPrompt`、Skill 正文或模型输出。
- 只持久化明确的 `development` / `non_development`；unknown 保持缺字段，legacy 不做猜测迁移。
- `non_development`、unknown 和 legacy 不加载 pack、不追加 catalog 或 guidance，继续按原 Loop 直接安排。
- pack 或门禁校验失败只降级为“无 Skill”，不得仅因此进入 `needs-review`、累计主任务 AI 失败或改变 CLI、模型、并发与重试语义。

### 验证方式
- 用“原始 display 为翻译、modelPrompt 含实现 API”和“原始意图不明、modelPrompt 含实现测试”样例，确认分别保持 `non_development` 与 unknown。
- 断言 non-development / legacy runtime context 不调用 loader；资源缺失时主 prompt 与无 catalog 基线一致，且不会达到主任务 AI 失败上限。

### 关联资料
- `src/loopSkillGuidance.ts`
- `src/extension.ts`
- `src/test/loop/loopPromptQueue.test.ts`
- `src/test/loopSkillIntegration.test.ts`
- `src/test/loop/loopMainFailure.test.ts`

## 历史：已移除的 Loop Workflow Skill 选择

- 状态：已于 2026-07-15 下线；以下为历史记录
- 首次发现：2026-07-12
- 适用范围：Skill manifest、主模型决策、宿主中央校验、子任务 prompt 与诊断日志

### 现象
- 如果接受模型返回的 path、`skillGuidance` 或 capability，模型可以绕过 manifest、角色和运行时能力门禁，注入未批准 Markdown 或声称拥有不存在的工具。
- 如果自动展开 `supportFiles`，参考资料、其他 Skill 入口甚至不应展示的正文会被递归塞入子任务上下文；如果复用 display/log/Webview 通道，还会扩大正文暴露面。

### 触发条件
- 主模型决策字段超过 `skillIds?: string[]`，或宿主直接信任模型返回的路径、hash、正文、CLI、model、command、capability。
- loader 从 cwd、用户 Home、workspace 同名目录或外部源回退读取，或把 `supportFiles` 当作自动注入清单。
- 将已校验 Skill 正文拼入 `displayPrompt`、诊断日志或 Webview payload / HTML。

### 根因
- 模型输出和 Markdown 都是不可信输入；可信路径、文件完整性、角色和 capability 只能由扩展宿主与内置 manifest 确认。
- `supportFiles` 当前只用于静态快照完整性与依赖清单，不等价于授权扩展上下文预算。

### 长期规避
- 主模型只接收有界 compact metadata，并且只允许返回稳定 Skill ID；归一化后再由中央宿主按本轮 allowlist、phase、task kind、role、负向 trigger、预算和 capability 校验。
- `requiredCapabilities` 必须来自宿主可信能力集；当前普通 Loop 子任务显式传空集合，模型或 Skill Markdown 自报均无效。
- 运行时只从 `extensionUri.fsPath/media/loop-workflow-skills` 加载并执行 containment、symlink、hash、bytes、UTF-8 与预算校验；禁止回退 Home、workspace、cwd 或外部源。
- 只清洗并注入所选 Skill 的入口 `SKILL.md` 正文；`supportFiles` 必须通过完整性校验，但不得自动递归注入。
- 正文只进入 Store 持久化快照和子任务 `modelPrompt`；`displayPrompt`、诊断日志与 Webview 不含正文，日志只记录诊断 code 及可选 `skillId/resourcePath`。

### 验证方式
- 让模型伪造 `skillGuidance`、path、command、CLI、model 和非法 ID，确认归一化只保留字符串 ID，Store 只写宿主生成的快照。
- 分别以空 capability 和宿主声明 `chrome-devtools-mcp` 校验浏览器 Skill，确认只有后者通过。
- 在 `supportFiles` 放入唯一标记，确认 loader 会校验该文件，但最终 guidance、display prompt 和 Webview 源码均不含该标记或正文 delimiter。

### 关联资料
- `media/loop-workflow-skills/manifest.json`
- `src/loopSkillGuidance.ts`
- `src/extension.ts`
- `src/test/loopSkillGuidance.test.ts`
- `src/test/loopSkillIntegration.test.ts`

## 历史：已移除的 Loop Workflow Skill 红蓝共识与自动重试

- 状态：已于 2026-07-15 下线；以下为历史记录
- 首次发现：2026-07-12
- 适用范围：普通主从、红蓝首轮 consensus、中央 apply、子任务自动重试

### 现象
- 只修改普通主任务 prompt builder 时，红蓝 brief 可能展示 Skill catalog，但真正生成 decision JSON 的 consensus 会话没有同一份 ID-only 合约。
- 自动重试如果只保存 Skill ID 并重新读取 pack，插件升级、资源变化或文件删除会让同一子任务前后收到不同执行要求。

### 触发条件
- 把红蓝首轮共识误认为普通主任务 prompt 的调用方，遗漏 `src/loopDebateRunner.ts` 内部直接构造 consensus model prompt 的真实 seam。
- retry 再次加载 pack、重新选择 ID 或重新生成 guidance，而不是使用任务 Store 中已经持久化的 `skillGuidance`。

### 根因
- 红蓝首轮 brief 与 consensus 经过不同调用链；后者由 runner 直接调用 consensus builder。
- ID 只能定位某一版资源，不能冻结已执行子任务的具体正文；可重复重试需要保存宿主确认后的内容快照。

### 长期规避
- 每个主任务轮次只创建一次 Skill runtime context；红蓝 brief 与 runner consensus 必须透传同一个 `compactCatalogSection`，普通主从和红蓝 decision 再共同经过 `applyLoopMainDecisionForRun`。
- 中央 apply 在写 Store 前生成稳定 `skillIds + skillGuidance` 快照；模型原始正文没有持久化路径。
- 子任务正文固定注入到“子任务职责”之后、“当前子任务”之前；首跑和自动 retry 都只读取已持久化 `subtask.skillGuidance`，不得重新加载或重新选择。
- Store 没有可用快照时保持无正文的原 Loop，不从已变化的 pack、外部目录或历史模型输出补造 guidance。

### 验证方式
- 断言红蓝 brief 与 runner consensus 使用同一 catalog，且 consensus prompt 开放的唯一新增字段仍是 `skillIds?: string[]`。
- 先持久化宿主 guidance，再删除扩展 pack 副本，确认首跑与 retry model prompt 仍逐字包含同一快照一次，display prompt 始终不含正文。

### 关联资料
- `src/loopDebateRunner.ts`
- `src/loopPromptBuilders.ts`
- `src/extension.ts`
- `src/loopTaskStore.ts`
- `src/test/loop/loopPromptBuilders.test.ts`
- `src/test/loopSkillIntegration.test.ts`
- `src/test/loop/loopTaskStore.test.ts`

## OpenCode 已解析 `todowrite` 但任务浮层仍可能被消息刷新覆盖

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：OpenCode one-shot、并行 tab、Loop 子任务、Webview 重载与会话消息刷新

### 现象
- `~/.sinitek_cli/logs/sinitek-cli.opencode.*.log` 中能看到完整 `tool_use/todowrite` 和 `state.input.todos`，工具 trace 也可能已经出现，但任务列表浮层没有显示或在切换/刷新后消失。
- 只验证 OpenCode JSONL 解析器会得到“任务已识别”的假阳性，不能证明对应 tab 的 Webview 浮层真正收到并保留了列表。

### 触发条件
- 任务列表和工具 trace 使用两条独立 Webview 消息，专用任务消息丢失、Webview 重建或 tab 刷新时没有回放来源。
- `setMessagesForTab` 在运行中无条件重置 task-list runtime state，而 OpenCode 的 `todowrite` 更新通常比 Codex 稀疏，清空后可能长时间没有下一条事件补回。

### 根因
- 任务解析、tab 定向消息和浮层状态原先只有分层单测，没有覆盖“真实工具事件 -> trace/message -> Webview task-list DOM”的完整可见链路。
- external 任务列表被当作可由历史 assistant 文本重新推导的自动列表处理，但 OpenCode 明细只存在于结构化工具事件，普通消息刷新无法重建。

### 长期规避
- 保留 `taskListUpdate` 主通道，同时让同一 `traceSegment` 携带 `taskListItems`，只要对应 tool trace 能送达，活动 tab 就能原子恢复浮层。
- 扩展宿主按 tab 缓存仍在运行的最新 OpenCode 列表；panel state 重建后定向重放，运行结束时立即释放。
- Webview 的 `setMessagesForTab` 仅在 tab 空闲或列表不是 external 来源时重置任务状态；`runStatus` 完成路径继续负责关闭浮层。
- 记录 `opencode-task-list-forwarded` 调试日志，现场至少核对 `source`、`tabId`、`itemCount`、`completedCount`，不要只看原始 CLI 日志。

### 验证方式
- 使用真实 `part.state.input.todos` 形状确认 parser 同时产出 tool trace 与 `{ text, done }[]`。
- 断言专用任务消息和 trace 元数据都调用同一 Webview 更新函数，并实际检查 panel display、details open、任务数量和完成状态。
- 在 external 列表显示期间模拟运行中的 `setMessagesForTab`，确认列表保留；将 tab 切为空闲后再次刷新，确认列表按既有规则清空。
- 执行 `node --test dist/test/cli/openCodeTaskList.test.js dist/test/core/openCodeTabStream.test.js dist/test/webview/openCodeTaskListOverlay.test.js dist/test/cli/opencodeCommandRunner.test.js`。

### 关联资料
- `src/cli/openCodeTaskList.ts`
- `src/openCodeTabStream.ts`
- `src/extension.ts`
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/webview/viewContentScript/coreRuntimeState.ts`
- `src/webview/viewContentScript/traceRendering.ts`
- `src/test/webview/openCodeTaskListOverlay.test.ts`

## 产品改名不能只机械替换持久化键和本地目录

- 状态：已规避
- 首次发现：2026-07-14
- 适用范围：Loop 任务存储、通信 artifact、设置、模型选择、任务运行记录、会话消息与公开命令

### 现象
- UI 已经显示 Loop，但新旧版本分别使用 `loop-*` 与 `lobster-*` 目录，直接改常量会让历史任务从列表消失、沟通 artifact 断链。
- TypeScript 全量改名仍可顺利编译，但旧 JSON 中的 `lobsterTaskId`、模式值、设置键和模型字段不会自动变成新的 `loop*` 字段。

### 触发条件
- 只做标识符、文件名和字符串的全仓替换，没有先枚举所有 JSON/本地文件读取边界。
- 只让新路径可写，没有在任务列表、恢复和清理之前迁移旧任务存储与通信树。
- 删除旧公开命令 ID，导致用户已有快捷键或外部调用失效。

### 根因
- 本地目录、JSON key、枚举值和命令 ID 都是跨版本契约，不是纯内部实现名。
- 编译器只能验证新源码内部一致，无法证明历史磁盘数据仍能被发现和规范化。

### 长期规避
- 新写入统一使用 Loop；旧 Lobster 字面量只集中在 `src/loopLegacyMigration.ts` 和迁移事实文档，不允许散回业务模块。
- 读取 JSON 时先递归迁移旧前缀键，新键与旧键同时存在时始终以新键为准；仅对已知协议值迁移旧模式与群聊动作，不改写用户正文。
- 首次枚举任务时先迁移通信目录，再按 workspace、CLI、session 将旧任务写入新 Store；目标冲突时保留 `.pre-loop-migration` artifact，验证新记录可读后才删除旧 Store 文件。
- 新命令进入 `package.json` 和命令面板，旧命令只在运行时注册隐藏别名。

### 验证方式
- 构造旧目录、旧 Store、旧通信文件和旧 JSON 字段，执行迁移后确认新路径存在、旧路径消失、任务可恢复且新写回不再包含旧键。
- 扫描全仓旧术语，结果只允许命中集中兼容模块与说明迁移边界的事实文档。
- 执行 `npm run build` 和 `node --test dist/test/loop/loopLegacyMigration.test.js dist/test/loop/loopTaskStore.test.js dist/test/core/toolSettings.test.js dist/test/core/workspaceSettingsStore.test.js dist/test/extensionHost/opencoderolemodelruntime.test.js dist/test/core/codexReasoningContent.test.js`。

### 关联资料
- `src/loopLegacyMigration.ts`
- `src/loopTaskStore.ts`
- `src/test/loop/loopLegacyMigration.test.ts`
- `src/test/loop/loopTaskStore.test.ts`
- `.ch/docs/exec-plans/completed/2026-07/2026-07-14-loop-naming-migration.md`

## 计费终态错误不能进入隐藏重试或充当恢复进度

- 状态：已规避
- 首次发现：2026-07-14
- 适用范围：Codex app-server 可见错误、通用 hidden retry、one-shot / 并行 / 交互运行

### 现象
- LLM proxy 返回 `402 Payment Required: model pool ... requires 1 points, remaining 0` 后，插件不断重试；界面长期停在 `1/5`，不会推进到 `2/5` 或耗尽上限。
- 同一故障在四个会话约十分钟内排队 110 次，日志反复出现 `failedAttempt=2`、`nextAttempt=3`、`retryCount=1`。

### 触发条件
- provider 返回 HTTP 402、Payment Required 或明确余额/积分耗尽。
- Codex Runner 先把错误文本通过普通 trace 展示，随后以失败结束回合。
- 外层交互重试把所有非 thinking trace 当作正常进度，并在异常处理前据此清零累计次数。

### 根因
- 通用错误资格判断过去只排除取消、Runner 释放和 ENOENT，未区分不可自行恢复的计费终态错误。
- 可见错误和正常工具 trace 共用 `normal` 类型；错误文本本身把 `attemptHadNormalReply` 置为 true，第二次失败时先把计数从 1 清零，再重新加到 1，形成无限循环。

### 长期规避
- Runner 的可见错误必须使用结构化 `error` trace；展示层可以继续使用普通错误气泡，但恢复计数只能消费 assistant 正文或非错误进度。
- HTTP 402、Payment Required、明确 insufficient credits/balance/points、积分需求大于零且 remaining 为零必须直接收口；不得依赖退避等待余额自行恢复。
- 429、连接中断和其他暂时性错误仍可按既有上限退避，不能用宽泛的 `remaining 0` 文本匹配误杀并发槽位等非计费错误。

### 验证方式
- 断言精确样本 `unexpected status 402 Payment Required: llm proxy error: model pool gpt-5.6-sol requires 1 points, remaining 0` 不具备 hidden retry 资格。
- 断言 Codex 可见错误 trace 的 kind 为 `error`，429、ECONNRESET 和普通网络错误仍可重试。
- 执行 `npm run build && node --test dist/test/core/hiddenRetry.test.js dist/test/core/panelDiagnostics.test.js dist/test/interactive/codexRunnerRuntime.test.js`，再运行 `npm run test:unit`。

### 关联资料
- `src/panelDiagnostics.ts`
- `src/interactive/codexRunner.ts`
- `src/interactive/codexRunnerRuntime.ts`
- `src/extension.ts`
- `src/test/core/panelDiagnostics.test.ts`
- `src/test/interactive/codexRunnerRuntime.test.ts`
- `.ch/docs/exec-plans/completed/2026-07/2026-07-14-codex-402-terminal-retry.md`

## Loop 长时间自动睡眠不能只保存内存定时器或普通更新时间

- 状态：已规避
- 首次发现：2026-07-17
- 适用范围：Loop 可解析任务决策自动睡眠、Extension Host 重启、任务历史清理、Node 长延迟定时器

### 现象
- 主任务返回“稍后再看”后当前进程能定时恢复，但重载 VS Code 或 Extension Host 后永远不再唤醒。
- 等待时间超过 Node 单个 `setTimeout` 安全范围时，定时器被截断或立即触发。
- 睡眠时间超过普通任务历史保留期时，任务在唤醒前被 Store 规范化或清理链路删除。
- 用户提前继续或中止后，旧定时回调仍可能再次启动同一任务。

### 触发条件
- 只把 timer handle 保存在进程内，没有把绝对唤醒时间写入任务记录。
- 直接把很长的相对毫秒数传给单个 `setTimeout`。
- 睡眠任务仍只按 `updatedAt` 参与普通历史淘汰。
- 定时回调不重新读取任务状态，取消动作只清 UI、不清调度状态。

### 根因
- 相对等待时长不是重启安全的事实；只有绝对墙钟时间才能在新进程中恢复。
- Node 定时器有单次延迟上限，进程退出也会丢失全部 timer handle。
- 普通历史记录和仍有未来执行承诺的睡眠任务生命周期不同，不能共用同一淘汰判定。

### 长期规避
- 模型协议返回 `wakeAfterSeconds`，宿主立即计算并持久化绝对 `autoWakeAt`；任务状态使用独立 `sleeping`，同时记录开始时间和原因。
- 调度器只把内存定时器视为缓存：长延迟按上限分段，每次触发重新读取任务状态和 `autoWakeAt`；Extension Host 激活时重新枚举并恢复。
- 带合法 `autoWakeAt` 的睡眠任务绕过普通历史保留淘汰，直到自动唤醒、人工继续或中止改变状态。
- 人工继续、完成和中止必须取消 timer 并清除睡眠字段；陈旧回调仍要以持久化状态复核作为最后门禁。
- 不承诺 VS Code 完全退出时由系统后台启动任务；产品文案和文档必须明确“下次扩展激活时补唤醒”。

### 验证方式
- 使用假时钟覆盖协议上下界、长延迟分段、到期启动、目标忙重试、取消和陈旧状态丢弃。
- 写入 `updatedAt` 已过普通保留期但 `status=sleeping + autoWakeAt` 合法的任务，确认读写后仍存在。
- 执行 `npm run build` 和 `node --test dist/test/loopAutoWake.test.js dist/test/loop/loopTaskStoreCoreCoverage.test.js dist/test/loop/loopDebate.test.js dist/test/loop/loopDebatePanel.test.js`。

### 关联资料
- `src/loopAutoWake.ts`
- `src/loopTaskStore.ts`
- `src/extension.ts`
- `src/webview/loopDebatePanel.ts`
- `.ch/docs/exec-plans/completed/2026-07/2026-07-17-loop-auto-sleep-wake.md`

## npm 启动的命令解析测试必须隔离 npm 前缀变量

- 状态：已规避
- 首次发现：2026-07-17
- 适用范围：`commandResolution.test.ts`、用户级 npm/pnpm bin 优先级测试

### 现象
- 直接运行 `node --test` 通过，但 `npm test` 中“优先 npm user bin”和“回退 PATH”的测试解析到开发机器真实的 npm global bin。

### 根因
- npm 会向子进程注入 `npm_config_prefix`；命令解析器按设计优先它而非 `HOME/.npm-global/bin`。测试只覆写 `HOME` 和 `PATH`，没有清空 `npm_config_prefix`、`NPM_CONFIG_PREFIX`、`PNPM_HOME`，所以夹具不再代表预期环境。

### 长期规避
- 所有模拟用户级命令路径的测试都必须快照、清空并在 `finally` 恢复 `HOME`、`PATH`、`npm_config_prefix`、`NPM_CONFIG_PREFIX`、`PNPM_HOME`。不要为了测试而降低生产解析器对显式 npm/pnpm 前缀的优先级。

### 验证方式
- 执行 `npm run build && node --test dist/test/cli/commandResolution.test.js`，再执行 `npm test`。

## Graph tab 识别不能只依赖完成消息

- 状态：已规避
- 首次发现：2026-07-24
- 适用范围：Graph runtime、tab 运行状态、Webview Graph 图标和“打开 Graph 图”入口

### 现象
- Graph 任务开始运行后，conversation tab 仍显示为普通 tab，底部运行状态行没有“打开 Graph 图”按钮；等 Graph run 结束或再次追加带 `openGraphRun` action 的系统消息后，tab 才显示地图图标和 Graph 入口。

### 触发条件
- Graph run 创建时先通过系统消息写入 `openGraphRun` action，但随后 Graph 节点用现有 `runPrompt` 在同一 tab 运行。
- 节点启动发出的 `runStatus:start` 没有携带 `graphRunId` / `graphNodeId`，Webview 将该 start 状态视为普通运行并清掉运行时 Graph meta。

### 根因
- Webview 的 Graph tab 标识依赖 `graphRunId`。Graph started/completed 消息能提供该 id，但运行中的节点 start 状态也会参与 tab 元数据同步；如果 start payload 缺少 Graph id，就会覆盖掉刚识别出的 Graph tab。

### 长期规避
- 任何 Graph 节点执行路径调用 `runPrompt` 时，都必须把 `graphRunId` / `graphNodeId` 透传到 tab 级 `runStatus:start` 和 assistant message metadata。
- 新增 Graph 运行状态入口时，不能只验证最终系统消息；必须验证任务运行中 tab label、Graph 图按钮和自动 Graph mode 选择都已经生效。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/graph/graphExtensionRuntime.test.js dist/test/graph/graphMainWebview.test.js dist/test/core/openCodeTabStream.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/loop/loopmaingroupchatbutton.test.js`。

## Graph planned parallel 节点不能被未声明 scope 隐式串行化

- 状态：已规避，需随 Graph scheduler / planner 并发语义变化复核
- 首次发现：2026-08-29
- 适用范围：Graph scheduler、Graph runtime、AI planner 并行 DAG、review/test/summary 节点调度

### 现象
- AI planner 已生成 4 个同层并行 `review` 节点且 `plannedGraph.maxConcurrent=4`，但运行日志中节点仍按单个或少量串行执行。
- 看起来像 executor 并发数没有生效，实际是 scheduler 在 batch selection 阶段提前把 ready 节点延后。

### 触发条件与根因
- 多个 ready 节点属于写入类节点，但没有声明 `writeFiles` 或 `conflictGroup`。
- 旧 scheduler 把这类节点归为隐式 `unscopedWrite` 全局冲突组，因此即使 DAG 和 `maxConcurrent` 允许并行，也只选中一个写入类节点。
- runtime 还有次要触发点：一次成功推进 tick 没有失败或阻塞节点时，也可能用空触发列表误追加 `replan-*`。

### 长期规避
- Graph 调度冲突只应来自显式 `conflictGroup` 或重叠 `writeFiles`；未声明 scope 的 ready 节点不应被 scheduler 自动当作全局写锁。
- 会修改文件的节点仍必须在 planner prompt / 节点约束中声明 `writeFiles` 或 `conflictGroup`；未声明 scope 的节点必须被视为不写文件。
- 动态 replan 只在 failed/blocked 触发节点存在，或真正 idle/no-progress 时尝试；普通成功推进 tick 不得追加 `replan-*`。

### 验证方式
- 执行 `node --test dist/test/graph/graphScheduler.test.js dist/test/graph/graphExtensionRuntime.test.js dist/test/graph/graphPlanner.test.js`。
- 检查 `graphScheduler` 回归用例中 4 个无 `writeFiles` 的 planned parallel `review` 节点会全部进入 `selectedNodeIds`。
- 检查 `graphExtensionRuntime` 回归用例中成功推进 `review -> summary` 后不会生成 `replan-*` 节点。

## Graph 重构后验证节点不能无写入授权地承担测试契约迁移

- 状态：已规避，需随 Graph planner / failure classification 变更复核
- 首次发现：2026-08-02
- 适用范围：Graph planner、Graph test/review 节点、source-contract / canonical source 测试、重构/迁移/拆模块任务

### 现象
- Graph run `graph_msg_1785661781962_abd923233c4068` 执行到 `test-schema-definitions` 后失败并进入 `needs-review`，attempts 达到 2/2。
- 失败看起来像 SQL schema 实现继续出错，但实际测试 `apps/server/test/performance/performance-observation-schema.test.js` 仍读取旧 `apps/server/src/db.js` 文本 source-contract，查找已经迁入 `apps/server/src/db/schema/observability.js` 的 SQL 定义。
- `test-schema-definitions` 节点没有测试文件 `writeFiles` 授权，只能重复失败，Retry 也不能新增授权范围。

### 触发条件
- 重构、迁移或拆模块移动 canonical source，例如把 SQL 常量从聚合文件移到子模块。
- 现有测试用 source-contract、文本快照、路径断言或 “canonical source” 读取旧文件，而 planner 只规划实现节点和只读验证节点。
- 验证节点没有声明受影响测试文件的 `writeFiles`，`if_fail` / `review_feedback` 又只回到原实现节点。

### 根因
- planner 过去没有把“实现迁移”和“测试契约迁移”拆成两个有写入授权的节点。
- runtime 过去只保留 `lastError`，缺少 `missing_write_scope` / `stale_test_contract` 分类与 recommendedWriteFiles，主 tab 难以看出失败应返工到测试适配节点。

### 长期规避
- planner 遇到重构/迁移/拆模块时，必须检查 source-contract、文本快照、路径断言和测试 canonical source；风险存在时规划独立 test adaptation / 契约更新节点，并声明具体测试 `writeFiles`。
- 验证节点发现旧测试契约失败时，应通过 `if_fail` / `review_feedback` 返工到测试适配节点，而不是只回到原实现节点。
- runtime 需要把该类失败分类为 `missing_write_scope`，signals 保留 `stale_test_contract`，recommendedRecovery 使用 `add_rework_node`，recommendedWriteFiles 指向需要授权的测试文件；不得建议单纯 Retry 作为主要恢复路径。
- needs-review / idle 文案必须展示 category、confidence、signals、recommendedRecovery、recommendedWriteFiles 和 nodeDraft，确保主任务或用户不用翻 artifact 才能理解下一步。

### 验证方式
- 用 `test-schema-definitions` 失败样本文本验证分类结果：category 为 `missing_write_scope`，signals 包含 `stale_test_contract`，recommendedWriteFiles 包含 `apps/server/test/performance/performance-observation-schema.test.js`。
- 检查 planner prompt 覆盖 stale/source-contract/writeFiles/test adaptation 要求。
- 执行 `node --test dist/test/graph/graphFailureClassification.test.js dist/test/graph/graphNodeLifecycle.test.js dist/test/graph/graphStore.test.js dist/test/graph/graphNodeArtifact.test.js dist/test/graph/graphExtensionRuntime.test.js dist/test/graph/graphPromptBuilders.test.js`，并在需要时执行 `npm run build`。

### 关联资料
- `.ch/docs/design-docs/graph-orchestration-mode.md`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `src/graph/graphFailureClassification.ts`
- `src/graph/graphPromptBuilders.ts`
- `src/extension.ts`
- `/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1785666611389_ecabb047f2973/subtasks/round-1-planner-stale-contract-guards.md`
- `/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1785666611389_ecabb047f2973/subtasks/round-2-graph-failure-classification-core.md`

## 同版本 VSIX 强装后人工交互弹窗可能卡在运行时 / webview 版本边界

- 状态：需部署时检查
- 首次发现：2026-08-10
- 适用范围：Codex / Claude / OpenCode Vibe 人工交互弹窗、VS Code extension 同版本本地强装、webview runtime

### 现象
- OpenCode 已按人工交互要求输出 2-3 个问题和选项，但界面只显示普通 assistant 气泡，没有弹出表单。
- OpenCode one-shot 日志可能已出现 `assistant-chunk` 和 `runPrompt-exit`，但用户看不到 `humanInteractionOverlay`。

### 触发条件
- 修改扩展后用同一版本号执行 `code --install-extension dist/sinitek-cli-tools-<version>.vsix --force`。
- 当前 VS Code 窗口或 webview 没有重新加载，导致后端 extension host、安装目录代码、已打开 webview script 可能不在同一版本。
- 人工交互链路缺少分段日志时，无法快速区分“未解析出表单”“后端已发请求但前端未收到”“前端收到但 DOM/CSS 未显示”。

### 根因
- VS Code 同版本强装只替换安装目录，不保证已经打开的窗口和 webview 立即加载新 HTML/script。
- OpenCode 自然语言 fallback 依赖后端解析 assistant 文本并向 webview 发送 `humanInteractionRequest`，任一侧版本不一致都会表现为普通消息而非表单。
- OpenCode one-shot 在 stdout 中检测到真实 `sessionID` 后会把本地 draft 消息迁移到真实 session；如果运行态仍拿旧 draft 数组做自然语言人工交互判断，就会出现 `assistant-chunk` 已写出、但 `runPrompt-one-shot-natural-human-interaction-skip` 报 `reason:"no-assistant-message"` 的假阴性。

### 长期规避
- 本地强装同版本 VSIX 后，必须执行 `Developer: Reload Window`，再重测人工交互弹窗。
- 排查时按日志事件分段判断：`runPrompt-one-shot-session-target-synced` 表示 OpenCode 真实 session 已同步到 one-shot 运行态；`runPrompt-one-shot-natural-human-interaction-prepared` 表示后端已解析表单并准备请求；`humanInteraction-request` 表示后端已发请求；`human-interaction-request-received` 表示 webview 已收到并尝试显示；`runPrompt-one-shot-natural-human-interaction-skip` 表示 one-shot 后端未能从最终助手消息构建表单。
- OpenCode one-shot/parallel 改动后，用包含 A/B/C 选项的问题输出做回归，确保能生成 radio 字段并移除普通 assistant 提问气泡。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/core/humanInteraction.test.js dist/test/webview/multiAgentSettingWebview.test.js`。
- 重新打包并强装 VSIX 后，检查安装目录包含 `runPrompt-one-shot-session-target-synced`、`runPrompt-one-shot-natural-human-interaction-prepared`、`humanInteraction-request`、`human-interaction-request-received`、`runPrompt-one-shot-natural-human-interaction-skip`。
- 重载 VS Code 窗口后，用 OpenCode 发送“写一首诗，你来问我一些要求帮你更精准写出我想要的诗”，确认出现表单弹窗。

### 关联资料
- `src/extension.ts`
- `src/extensionHost/promptOneShotRuntime.ts`
- `src/webview/viewContentScript/settingsAndOverlays.ts`
- `src/test/extensionHost/promptOneShotRuntime.test.ts`
- `src/test/core/humanInteraction.test.ts`
- `src/test/webview/multiAgentSettingWebview.test.ts`

## Webview 行级 label 包多个 select 会导致后一个下拉无法打开

- 状态：已规避
- 首次发现：2026-08-10
- 适用范围：主聊天面板模型/思考力度选择器、配置视觉编辑器中的 Ant Design Select

### 现象
- OpenCode 主/子模型旁的“思考力度”下拉点击后没有展开，看起来像配置已存在但 UI 不响应。
- 配置页日志只出现 `config-view-debug` 同步事件，没有进入对应控件的点击诊断，容易误判为配置数据问题。

### 触发条件
- 使用 `<label for="modelSelect">` 包住整行，并在同一 label 内同时放模型 `<select>` 和思考力度 `<select>`。
- Ant Design tags/multi Select 也放在外层 `<label>` 容器内时，点击/焦点行为可能被 label 转发或干扰。

### 根因
- HTML label 的点击会关联到 `for` 指向的控件；当一个 label 内包含多个交互控件时，点击非目标控件也可能被转发到目标控件。
- 对 OpenCode 主模型行来说，点击思考力度 select 会被转发到模型 select，因此思考力度自己的下拉无法稳定打开。

### 长期规避
- 不要用行级 label 包多个交互控件；行容器用 `div`，只给文字标签使用 `<label class="... " for="目标控件">`。
- 新增模型/思考力度组合控件时，测试中断言不存在 `<label class="open-code-model-row"` 这类整行 label。
- 配置页非 hash app 脚本变更后要带版本参数，避免 Webview 缓存继续执行旧 `config-app-ui.js`。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/openCodeThinkingWebview.test.js`。
- 配置页相关变更还需执行 `node --test dist/test/config/opencodeconfigvisualeditor.test.js dist/test/config/cliPageConfigCoverage.test.js`。

### 关联资料
- `src/webview/viewContentHtml.ts`
- `src/webview/configView.ts`
- `media/config/assets/config-app-ui.js`
- `src/test/webview/opencodedualmodelwebview.test.ts`
- `src/test/webview/codexdualmodelwebview.test.ts`
- `src/test/webview/cliPageStaticRenderCoverage.test.ts`

## OpenCode 配置正确但主面板 variants 为空时要检查 role override

- 状态：已规避
- 首次发现：2026-08-10
- 适用范围：OpenCode 主面板模型选择、动态 thinking variants、`~/.sinitek_cli/models.json`

### 现象
- `~/.opencode/config.json` 或 `~/.opencode/__config/<id>.json` 中主模型已经声明 `variants`，但主面板“思考力度”下拉点开仍没有选项。
- 日志里 `opencode run` 可能实际使用配置默认主模型，但 UI store 仍保留旧的 `openCodeRoleModelsByConfigId.<configId>.main`。

### 触发条件
- 旧 Webview label 转发或其它 UI 状态错误把 OpenCode main role override 写成了当前配置的 `small_model`。
- 后续配置文件已经恢复为 `model=<主模型>`、`small_model=<子模型>`，但 role override 仍优先覆盖配置默认主模型。

### 根因
- `resolveOpenCodeRoleModelsForConfig` 会优先读取 `openCodeRoleModelsByConfigId`，导致主面板使用 stale override 对应模型的 variants。
- 如果 stale override 指向子模型，而子模型没有主模型的 `xhigh/max/ultra` variants，thinking select 会被同步为空或只显示错误档位。

### 长期规避
- 当 OpenCode 配置文件与主面板表现不一致时，同时检查 `~/.sinitek_cli/models.json` 的 `openCodeRoleModelsByConfigId`。
- 解析 OpenCode role model 时，若某个 role override 正好镜像到当前配置的相反默认 role，自动清理该 stale override，回到配置默认模型。
- 回归测试要覆盖 `model=provider/sol`、`small_model=provider/luna`，但 store 中旧 `main=provider/luna` 的场景。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/openCodeThinkingWebview.test.js`。
- 复测 OpenCode 主面板时，切换到 OpenCode 或重载窗口后确认主模型 thinking 下拉出现配置中的 variants。

### 关联资料
- `src/extensionHost/modelSettings.ts`
- `src/test/extensionHost/opencodethinkingintegration.test.ts`
- `src/cli/openCodeModelCapabilities.ts`
- `~/.sinitek_cli/models.json`

## OpenCode thinking capability 异步回调要先同步 host 状态再刷新面板

- 状态：已规避
- 首次发现：2026-08-10
- 适用范围：OpenCode 主面板动态 thinking variants、`createModelSettingsHost`、异步 capability 解析

### 现象
- 本机 `~/.opencode/__config/<id>.json` 已配置模型 `variants`，直接解析 capability 能得到 `xhigh/max/ultra`，但主面板“思考力度”下拉仍为空。
- 日志里 OpenCode 运行路径已经使用正确主模型，排除配置文件和 role override 后仍复现。

### 触发条件
- `refreshOpenCodeThinkingState` 启动异步 `resolveOpenCodeThinkingCapability(...).then(...)`。
- 异步回调只更新 `createModelSettingsHost` 闭包里的 `openCodeThinkingState`，随后直接调用 `postPanelState()`。
- `postPanelState()` 内部重新进入 wrapped host 方法时会先 `syncFromDeps()`，从 extension 全局状态读回旧的 loading/空状态，覆盖刚解析出的 variants。

### 根因
- `createModelSettingsHost` 的 wrapper 只会在同步函数返回或 awaited promise finally 时自动 `syncToDeps()`；异步 fire-and-forget 回调不在 wrapper 生命周期内。
- capability 回调中如果没有显式 `syncToDeps()`，解析结果不会进入真实 panel state，刷新面板时仍看到旧状态。

### 长期规避
- 在 host 内部 fire-and-forget 异步回调里修改闭包状态后，若马上触发 `postPanelState()` 或其它依赖 deps getter 的流程，必须先显式 `syncToDeps()`。
- 回归测试要覆盖完整 `refreshOpenCodeThinkingState` 异步路径，而不是只测 capability parser 或纯 webview select 同步。
- 本机复现可用真实 OpenCode config 跑 host refresh，确认 `openCodeThinkingState.disabled=false` 且 `options` 非空。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/extensionHost/opencodethinkingrefreshstate.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/openCodeThinkingWebview.test.js`。
- 用真实 `~/.opencode` 配置调用 `resolveOpenCodeThinkingCapability` 与 `refreshOpenCodeThinkingState`，确认主模型 variants 均为非空。

### 关联资料
- `src/extensionHost/modelSettings.ts`
- `src/test/extensionHost/opencodethinkingrefreshstate.test.ts`
- `src/cli/openCodeModelCapabilities.ts`

## 建议模板

```md
## <坑点标题>

- 状态：有效 / 需部署时检查 / 已规避 / 需观察
- 首次发现：YYYY-MM-DD
- 适用范围：模块 / 环境 / 脚本 / 版本

### 现象
- 看到什么报错、错误行为或异常结果？

### 触发条件
- 在什么前提下会出现？

### 根因
- 已确认的根因是什么？如果只是推断，要明确写“推断”。

### 长期规避
- 以后应该怎么做，才能避免再次踩坑？

### 验证方式
- 修改后如何确认这个坑已被规避？

### 关联资料
- 相关代码路径、runbook、issue、设计文档、外部链接
```

## 历史归档入口

- [PITFALLS_HISTORY.md](./PITFALLS_HISTORY.md)：已修复、已废弃、仅历史版本有效条目，保留完整追溯信息。
