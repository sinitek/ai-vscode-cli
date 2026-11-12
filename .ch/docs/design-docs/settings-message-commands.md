# 设置消息：局部 Command 与兼容 Facade

## 选择与边界

`handleUpdateSettingMessage` 原先约 300 行，混合模型、Loop 角色、工作区偏好、全局设置、通知和 CLI 启停，并在各分支重复刷新。采用函数式 Command 将“是否命中”和“执行副作用”分开，Facade 保持公开导出路径、签名和调用方不变。收益是新增设置只改所属领域命令，刷新和未知键规则只维护一处，而不是把原条件链换文件。

这是宿主内部的局部静态分派，不是新 Webview 协议或通用总线；无类继承、装饰器、动态发现、依赖容器和新增依赖。沿用 `panelMessageHandlers` 的显式领域/窄依赖边界。`contextCompactionRunner` 已有策略注册表，CLI ReplayStream 各有协议语义，因此不为套模式再次抽象它们。选择依据是当前代码的职责混杂与重复副作用，不是文件大小。

## 实际调用与依赖

```text
panelMessageHandlers/index.ts
  → sessionMessageActions.ts: handleUpdateSettingMessage (兼容 Facade)
  → settingMessageRouter.ts: routeSettingMessage
      → settingMessageHandlers/model.ts: modelSettingCommands
      → settingMessageHandlers/preferences.ts: preferenceSettingCommands
```

- `types.ts` 定义本地 `SettingMessage`、每次调用的 CLI/工作区 context、`SettingCommand<Deps>` 与精确/前缀命令构造函数。
- 两领域静态数组只存匹配函数和执行函数，不捕获某次调用的 CLI、工作区、档案或配置。
- Router 每次先按原顺序调用 `getCurrentCli()`、`getWorkspaceSettings()`，未知键也保留这两次读取；然后依次查找模型表、偏好表的第一个匹配项。当前两表匹配集合互斥，领域拆分不改变原优先级语义。
- Router 在命中后显式构造该领域所需端口对象，类型是 `Pick<PanelMessageHandlerDeps, ...>`，不把完整宿主对象传入领域；context 同样只含此次快照。依赖及可选回调每次调用重新取得，不缓存到静态命令。
- 对宿主/消息类型的依赖为 type-only import；领域不运行时加载 Facade、组合根或 `sessionMessageHandlers`，无运行时循环。原归一化、模型存储与配置服务仍是规则事实源。

## 匹配、刷新与异常

| 情况 | 副作用与刷新 |
| --- | --- |
| 精确键或已登记前缀命中，正常返回 | 执行后 Router `await postPanelState()`，恰好一次；校验失败、保存返回 false、可选回调缺失也按原分支规则刷新 |
| 未知、已退役键，包括 `constructor` / `toString` / `__proto__` | 不写入、不刷新；数组谓词匹配不做对象原型键索引 |
| `loopRoleExplicitModel` / `loopRoleThinking` | key 与非 null object 值同时满足才算命中；null、原始值、函数等不刷新，object 内容非法则仍命中并刷新 |
| 普通依赖抛错或 Promise 拒绝 | 向调用方传播，不刷新；不使用 finally，也不把失败返回和抛错统一处理 |
| 四个通知键 | 仅 boolean 且回调存在才写入；保留原 try/catch、中文错误后刷新；若错误显示本身抛错则继续传播，不强制刷新 |

域内命令不调用 `postPanelState`。Router 只在执行正常完成后统一刷新；刷新自身的拒绝仍传播。

## 必须保持的领域差异

- 模型与角色：原 `isCliName`、角色白名单、`parseCliName`、思考力度归一化不变。`selectedLoopThinkingMode` 只支持 codex / grok / claude / dsh / kimi-code，不顺带扩大到 OpenCode 或 ZCode。可选回调缺失时是否仍 reload 模型存储，逐命令保留旧行为。
- 配置 ID 前缀：继续使用对应前缀 `slice(...).trim()`，ID 中的点保留；CLI/角色键 `selectedLoopModel.*`、`selectedLoopThinkingMode.*` 保留旧 `split(".")` 解析及尾部兼容行为，不通用化 parser。`selectedModel.*`、`interactiveMode.*`、`cliEnabled.*` 仍 slice 且不额外 trim。
- 布尔值：全局 humanInteractionEnabled / autoCompact / debug / autoAddEditorContextTags 用 `Boolean(value)`；hideInstructionBubbles、workspaceMemoryEnabled/longTermMemoryEnabled 用 `value === true`；通知与 cliEnabled 必须原生 boolean。
- `autoCompactContextBeforeRun` 是写入全局 `autoCompactContextAfterRun` 的兼容别名；只有全局保存成功，才清除并保存工作区两个旧键。`loopMaxRounds` 则仍在全局保存返回 false 时清除工作区旧键，不借重构统一策略。
- `cliEnabled.*` 先检查合法 CLI 和 boolean，复制旧 map 时仅保留合法 CLI/boolean 条目。只有全局保存成功才重新读取当前 CLI，按原次序等待必要的 `setCurrentCli`、重定向子任务选择、发布启停状态，再刷新；全关时仍将 null 传给重定向回调。
- 限额、历史天数与 shell 继续使用原归一化函数、平台限制、返回值处理与中文错误文案。debug 保存后仍读取实际 debug 配置再更新日志开关。

## 如何新增设置命令

1. 判定属于模型/角色还是偏好领域；在对应静态数组增加精确 `command`、`prefixCommand` 或必要的显式 payload matcher，不加新的长条件链。
2. 只为实际使用的能力扩展该领域 `Pick`，并在 Router 的投影同步补齐；不要将整个宿主、运行时实例或状态捕获进命令表。
3. 区分 matcher 与执行内校验：前者决定是否刷新，后者决定是否写入；新增前缀不得抢占现有匹配，改变重叠顺序需要明确契约评审。
4. 只执行既有服务并保持异常策略，命令内不刷新；通过既有 Facade 和统一消息入口增加成功、非法值/未知键、失败/拒绝和刷新次数测试。
5. 核对本设计、架构导航及 ontology 的实现来源，若新增用户行为再更新功能清单。本次纯重构不改功能清单、全局设置格式、提示词模型解析、OpenCode variant、UI 或 CLI 协议。

## 验证与计划

- 相关套件：sessionMessageActions、sessionMessageActionsCoreCoverage、sessionMessageHandlersCoreCoverage、sessionMessageRouter、toolSettings，以及 CLI/Webview 的 grokmodelselection。
- 按 `.ch/docs/TESTING.md` 先 `npm run build`，再显式列出相关 `dist/test/**/*.test.js`；并行契约测试使用私有 outDir，不清理共享 dist。
- 本机浏览器、真实 CLI/模型与完整发布不属于本次验证：没有 UI、外部协议或实际 CLI 实现变更，测试通过不替代旧 Loop 路由真实验收门禁。
- 实施与验证证据见 `.ch/docs/exec-plans/completed/2026-11/2026-11-12-refactor-setting-message-commands.md`；文档流程见 `.ch/docs/exec-plans/completed/2026-11/2026-11-12-docs-setting-message-commands.md`；契约测试由关联 `2026-11-12-test-setting-message-contracts.md` 独立维护。
