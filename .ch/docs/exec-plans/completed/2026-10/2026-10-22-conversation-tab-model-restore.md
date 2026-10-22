# 对话标签切换恢复执行配置与模型

- 日期：2026-10-22
- 状态：completed
- 负责人：Codex

## 背景与目标

对话标签切换已有 CLI 分组和 Loop / Loop+ / Vibe 模式恢复，但没有恢复对应执行配置与模型。切换 Loop 主标签应展示任务当前绑定的主子模型，子标签应以 Vibe 展示实际执行的子模型。用户补充要求：有可靠记录时一起恢复思考力度。

## 范围与非目标

- 复用现有配置应用队列和模型选择接口，补齐标签切换时的恢复流程。
- 使用 Loop 当前路由和普通会话的执行快照；历史记录缺少可靠配置时不猜测。
- 配置或模型已经删除时保留对应当前选择，不重建已删除模型，不修改任务执行路由。
- 不调整布局、主题、CLI 版本或运行中任务的执行行为。

## 验收标准

- Loop / Loop+ 主标签恢复正确模式、配置、主模型、子 CLI 与子模型。
- 子标签恢复 Vibe、目标 CLI 配置和实际执行模型。
- 普通会话有执行快照时恢复配置和模型；旧数据缺少快照时安全保持。
- 思考力度和 OpenCode variant 有可靠记录且仍受支持时恢复；模型缺失时不改对应思考设置。
- 配置或模型缺失、读取失败、快速切换时不误恢复到其他标签。
- 最小相关回归测试和 `npm run build` 通过。

## 影响面与风险

- 代码：`src/panelMessageHandlers/session.ts`、`src/extension.ts`、会话配置恢复模块、用户消息快照和 Webview 面板状态同步。
- 测试：`src/test/session/`、相关运行时与消息构建测试。
- 文档：功能清单、运行时说明和 ontology。
- 风险：跨 CLI 子路由、OpenCode 配置内模型校验和异步标签竞争；通过复用现有接口、按配置校验和切换身份检查缓解。

## 验证计划

- 构建后先运行新增恢复测试，再运行会话切换、用户消息快照与相关运行时测试。
- 执行 ontology 校验与脚本单测、差异空白校验。
- 使用真实 Webview HTML、内存宿主适配器与 headless Chromium 验证，不启动实际付费模型请求。

## 测试与清单同步

- 单元测试新增/更新：恢复规则 19 项，覆盖主子路由、实际模型快照、思考力度、缺失配置/模型、默认模型、异常和异步过期；补充宿主调用顺序、历史会话、交互运行时、OpenCode 共享模板和持久化快照；新增 3 项 Webview 乐观标签切换回归。
- 单元自测结果：构建通过；14 个相关测试文件共 140 项通过；Webview profile 专项 9 项通过；ontology 脚本单测 9 项通过。
- 功能清单与 ontology：已同步功能总表、能力规格、CLI 运行时说明与 ontology 新规则；架构边界未改变，不修改 `ARCHITECTURE.md`。
- 记忆判断：浏览器验证发现的旧配置反写根因沉淀到 `PITFALLS.md`，稳定语义进入 ontology；无需追加热区摘要或事件，不修改 `ROLLING_SUMMARY.md` / `EVENT_MEMORY.md`。

### 实际验证命令

```sh
npm run build
node --test --test-reporter=tap dist/test/session/conversationTabConfiguration.test.js dist/test/session/loopPlusSessionTabs.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionStoreCoreCoverage.test.js dist/test/session/loopAskConversationContext.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/extensionHost/openCodePromptRunTemplate.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/opencoderolemodelruntime.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/extensionHost/opencodethinkingrefreshstate.test.js dist/test/config/configApplyQueue.test.js dist/test/webview/openCodeThinkingWebview.test.js dist/test/webview/opencodedualmodelwebview.test.js
node --test --test-reporter=tap --test-name-pattern='profile|tab restored' dist/test/webview/clipagescriptruntimecoverage.test.js
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
git diff --check
```

- `scripts/check_trailing_whitespace.js` 对本次源码、测试和文档变更的检查通过。
- `impeccable` 对修改的 Webview 状态脚本机械检查结果为 `[]`。

### 浏览器验证

- 命令：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario <本次临时场景文件>`。
- 通过 4 个场景：经典 Loop 主子模型与思考力度、Loop+ 跨 CLI 子模型与思考力度、子标签 Vibe 模型和 variant、配置缺失保持当前选择。
- 使用 Chrome headless，960×1000；浏览器错误、HTTP 错误和请求失败均为零。已查看主标签与子标签成功截图。
- 本机结果和截图保留在 `.tmp/playwright-smoke/conversation-tab-{classic-model-thinking,plus-cross-cli-thinking,model-thinking-restore,missing-config-preserves-selection}/`；临时服务和场景文件已清理。
- 使用真实生成的 Webview HTML 和恢复模块，但配置/运行器为内存夹具；未启动真实 CLI 或 VS Code Extension Development Host。

### 失败分流与基线证据

- 第一次浏览器切换在主标签之间卡在旧配置。属于本次实现需要补齐的前端状态问题：标签点击已乐观更新 Tab ID，`applyState` 误把上一标签配置当作用户当前手动选择，又发回旧 `applyConfig`。改为跟踪最后已应用面板上下文后，4 个场景通过。
- 扩展测试中的 5 项范围外失败均已用 `git archive HEAD` 导出的独立基线编译复现，未在本次修复：
  - Grok 配置模型单测在无配置 ID 的已有路径出现 `null !== 'updated'`。
  - Webview 指令折叠的 3 项旧断言仍预期数量后缀，而当前实现已使用数量前缀。
  - Webview 隔离函数分支夹具缺少 `enabledRuleCliNames`。
- 基线命令：独立目录执行 `tsc -p ./` 后运行 `node --test dist/test/extensionHost/grokConfigModels.test.js`，以及 `node --test --test-name-pattern='collapses two or more|restarts instruction folding|collapsed instruction group summary uses|handles run stream, queue' dist/test/webview/clipagescriptruntimecoverage.test.js`；失败签名与工作区一致。
- 没有通过放宽断言、修复无关实现或跳过本次新增回归来消除这些历史失败。

## 任务列表

- [completed] 追踪标签切换与模型配置来源
- [completed] 实现配置与模型自动恢复
- [completed] 补充回归测试并同步文档
- [completed] 执行构建与相关验证

## 当前结论

完成扩展侧配置/模型/思考力度恢复、实际执行快照持久化与 Webview 上下文切换保护。Loop 主标签使用当前绑定路由，子标签使用实际执行快照；普通旧会话没有可靠配置记录时保持现状。配置和模型删除时不重建、不猜测，切换时不把前一标签的 pending 配置反写。相关回归和真实 Webview Chromium 验证通过，5 项历史失败有独立基线证据。
