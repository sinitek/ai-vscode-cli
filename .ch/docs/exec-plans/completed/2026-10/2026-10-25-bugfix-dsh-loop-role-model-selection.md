# DSH Loop 角色模型与思考力度 — 已发布行为修复

- 日期：2026-10-25
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：
- 类型：bugfix

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-25-dsh-loop-role-model-selection.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-25-docs-dsh-loop-role-model-selection.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

修复已支持 DSH 角色模型在白名单、思考存储与派发链路的遗漏。仅承担已发布行为修复；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的已发布行为修复；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-25-bugfix-dsh-loop-role-model-selection.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

DSH 配置解析、extension host 与 Webview 已支持 Loop 角色模型和按模型思考力度，但 `sessionMessageActions` 的角色模型白名单仍排除 DSH，思考力度派发也遗漏 DSH 主/子角色。导致选择 UI 虽可显示和保存设置，Loop、Loop+ 的初始派发仍没有把 DSH 主/从模型与思考力度交给执行器；后续还发现 DSH 合法思考档位漏掉了 `medium`。

## 目标

- 让 DSH 的 Loop、Loop+ 复用现有主模型/子模型控件，按活动 DSH 配置选择角色模型，并按模型已声明的 `reasoningEfforts` 保存、读取和下发角色级思考力度；完整支持 `low / medium / high / xhigh / max`。

## 范围

- 扩展模型选择策略、角色思考力度存储、PanelState 与消息处理，使 DSH 角色选择按 DSH 配置隔离。

- 扩展 Webview 现有 Loop 主/子模型及思考选择器，不增加新的 UI 结构。

- Loop、Loop+ 执行时将角色模型和对应思考力度传入现有 DSH ACP runner；runner 仍须以当前 ACP 公布并确认的 `reasoning_effort` 为准。

## 非目标

- 不修改 DSH 密钥环境变量、ACP wire contract 或 provider patch 结构；仅按已安装 `dsh-llm-pi-ai` schema 补齐合法的 `medium` reasoning effort。

- 不为 OpenCode、Codex、Grok、Claude 改动现有角色选择语义。

- 不将 DSH 推理档位硬编码成通用能力；选项必须基于当前角色模型的 `reasoningOptionsByModelId`，实际应用仍受 ACP 公告约束。

## 验收标准

- [x] DSH 在 Loop、Loop+ 中显示现有主/子模型下拉，选项只来自当前活动 DSH 配置模型。

- [x] DSH 思考力度下拉按各自选中模型声明的 `reasoningEfforts` 显示；不同角色、不同模型的设置独立保存。

- [x] 三种模式派发时携带主/子模型与对应思考力度；实际 DSH ACP 应用仍校验当前公告档位。

- [x] 非 DSH CLI 的既有角色模型和思考选项回归测试通过。

- [x] 相关 DSH/Webview 测试、生产源码类型检查及 Ontology 校验通过。

- [x] 仓库标准 `npm run build` 和页面测试套件通过。

## 影响面

- 代码目录：`src/modelSelectionStore.ts`、`src/sessionMessageActions.ts`、`src/extensionHost/cliModelSelectionStrategies.ts`、`src/extensionHost/modelSettings.ts`、`src/webview/types.ts`、`src/webview/viewContentScript/`

- 配置与脚本：无

## 风险与缓解

- 风险：DSH ACP 对特定模型公布的思考选项可能与 profile 声明不一致。

- 缓解：选择 UI 使用 profile 中该模型的明确声明；runner 仍只应用 ACP 当前公告且成功确认的值，并维持现有拒绝/提示路径。

- 风险：主、子模型可能在相同配置下使用不同的思考档位。

- 缓解：沿用 `loopThinkingByConfigId[configId][role][model]` 维度存储，分别查询和执行。

## 验证计划

- 最小相关验证：模型存储与 DSH 选择策略测试、Loop DSH 思考解析测试、Webview 模型/选项/消息交互回归测试。

- 单元自测命令：定向严格 TypeScript 编译与 DSH/Webview 回归测试；`npm run build`。

## 测试与清单同步

- DSH 角色模型和力度状态；Webview 选择器。

- 单元自测结果：`npm run build` 通过；DSH 定向测试 31 项通过；`npm run test:page` 通过 283 项；Loop/Loop+、思考下拉与页面夹具定向测试通过；Ontology 校验通过，Ontology Python 单测 9 项通过，whitespace 与 `git diff --check` 通过。

- 失败处理记录：页面测试初始因新增生产辅助函数未注入到四个独立 harness 而失败，已补齐真实函数依赖并复测通过；新增 `medium` 运行时回归用例后，构建发现 DSH host 测试夹具的 `thinkingMode` 联合类型遗漏 `medium`，已扩充夹具类型，并复跑构建与相关测试通过；未修改生产逻辑掩盖测试。此前会话锁类型错误已不再复现。

## 任务列表

- [x] 补全 DSH 角色模型与思考状态流

- [x] 增加 UI、执行路径与回归测试

- [x] 补入 `medium` 并保留旧配置兼容

## 决策记录

- 2026-10-25：复用既有 Loop 角色选择控件与 DSH ACP `reasoning_effort` 协议；思考档位按角色模型分开保存，执行时继续以 ACP 确认值为准。

- 2026-10-25：将已安装 DSH schema 支持的 `medium` 纳入 DSH profile 与 Webview 白名单；旧四档和旧 `off` 结构归一到新五档，实际发送仍以 ACP 当前公告为最终边界。
