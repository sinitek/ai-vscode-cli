# 对话标签切换恢复执行配置与模型 — 新功能开发

- 日期：2026-10-22
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-22-conversation-tab-model-restore.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-22-docs-conversation-tab-model-restore.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

补齐对话标签切换后的配置、模型及思考力度恢复。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-22-feature-conversation-tab-model-restore.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

- 对话标签切换已有 CLI 分组和 Loop / Loop+ / Vibe 模式恢复，但没有恢复对应执行配置与模型。切换 Loop 主标签应展示任务当前绑定的主子模型，子标签应以 Vibe 展示实际执行的子模型。用户补充要求：有可靠记录时一起恢复思考力度。

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

- 风险：跨 CLI 子路由、OpenCode 配置内模型校验和异步标签竞争；通过复用现有接口、按配置校验和切换身份检查缓解。

## 验证计划

- 使用真实 Webview HTML、内存宿主适配器与 headless Chromium 验证，不启动实际付费模型请求。

## 测试与清单同步

- 覆盖主子路由、实际模型快照、思考力度、缺失配置/模型、默认模型、异常和异步过期；补充宿主调用顺序、历史会话、交互运行时、OpenCode 共享模板和持久化快照。

- 单元自测结果：构建通过；14 个相关测试文件共 140 项通过；Webview profile 专项 9 项通过；ontology 脚本单测 9 项通过。

- 不修改 `ARCHITECTURE.md`。

- 无需追加热区摘要或事件，不修改 `ROLLING_SUMMARY.md` / `EVENT_MEMORY.md`。

### 实际验证命令

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

  - Grok 配置模型单测在无配置 ID 的已有路径出现 `null !== 'updated'`。

  - Webview 指令折叠的 3 项旧断言仍预期数量后缀，而当前实现已使用数量前缀。

  - Webview 隔离函数分支夹具缺少 `enabledRuleCliNames`。

- 基线命令：独立目录执行 `tsc -p ./` 后运行 `node --test dist/test/extensionHost/grokConfigModels.test.js`，以及 `node --test --test-name-pattern='collapses two or more|restarts instruction folding|collapsed instruction group summary uses|handles run stream, queue' dist/test/webview/clipagescriptruntimecoverage.test.js`；失败签名与工作区一致。

- 没有通过放宽断言、修复无关实现或跳过本次新增回归来消除这些历史失败。

## 任务列表

- [completed] 追踪标签切换与模型配置来源

- [completed] 实现配置与模型自动恢复

- [completed] 执行构建与相关验证

## 当前结论

- 完成扩展侧配置/模型/思考力度恢复、实际执行快照持久化与 Webview 上下文切换保护。Loop 主标签使用当前绑定路由，子标签使用实际执行快照；普通旧会话没有可靠配置记录时保持现状。配置和模型删除时不重建、不猜测，切换时不把前一标签的 pending 配置反写。相关回归和真实 Webview Chromium 验证通过，5 项历史失败有独立基线证据。
