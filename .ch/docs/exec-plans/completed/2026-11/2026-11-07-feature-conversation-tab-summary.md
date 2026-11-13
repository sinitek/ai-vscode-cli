# 对话 Tab 任务摘要

- 日期：2026-11-07
- 状态：completed
- 类型：feature
- 负责人：运行时、前端、文档三个独立交付边界协作
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-07-conversation-tab-summary.md`

## 目标与范围

新增异步AI任务摘要、会话持久化、受限独立调用及1000ms安全浮层。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- 历史文档分工：文档/事实源交付及其历史校验。 原 docs companion `2026-11-07-docs-conversation-tab-summary.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 验收标准

- 新增异步AI任务摘要、会话持久化、受限独立调用及1000ms安全浮层；原可观察契约、非目标和限制以以下分配的原文为准。
- 首次新增能力；E1/E2/E4覆盖有重叠，281/18/299/41不求和；E3历史真实Codex、其余六CLI未真实联调及早期失败保留。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文；原 docs companion 已退役，其完整记录未恢复；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-07-conversation-tab-summary.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 来源头部说明

- 当前阶段：运行时与浮层已通过主审，源码/原始材料复核后完成文档、本体与月份归档；验证限制保留如下

### 背景与目标

多 Tab 场景需要在不扩张标签尺寸的前提下识别任务。实施前基线中的 `renderConversationTabs` 负责标签渲染，`preparePendingLabel` 从首条提示词建立会话标签；这不是 AI 任务摘要。现已在首次提交时异步归纳任务意图，通过可选 `ConversationTabSummary.taskSummary?: string` 提供简短中文提示，原标签行为保留。

### 范围与非目标

- 范围：一次性 AI 归纳、任务/会话级持久化和身份校验、Tab 延迟提示、规格/设计/ontology 同步。
- 非目标：不改原 Tab 尺寸、分页、运行/错误状态、角色标记和关闭行为；不新增配置、语言包、用户开关；不追溯生成旧历史摘要，不替换原会话标签，不总结最终执行结果。
- 本文档交付不修改运行时代码、UI 或测试，不执行构建、发布、分支或提交操作，不触碰 Loop+ 调度状态及记忆热区。

### 验收标准

- [x] Tab 对应任务首次有效提交即异步发起一次 AI 文本归纳，不等任务完成，不阻塞原任务；空白新 Tab 不生成。（E1：首次提交/完成前接收/空输入用例；E3：真实 AI 输出）
- [x] 后续普通消息、hover、面板刷新、旧历史恢复均不重复生成；失败或超时不因这些动作重试。（E1：去重/失败/历史恢复；E2/E4：无 hover 请求）
- [x] 提示要求简体中文纯文本，最多 30 个 Unicode 码点；通过可选 `ConversationTabSummary.taskSummary` 传递，不把原提示词截断伪装成摘要。（E1：Unicode/结果校验；E3：22 码点简体中文；无确定性繁简转换，见限制）
- [x] 摘要按任务/会话保存，兼容旧记录缺失字段；local/native session 绑定、扩展重载与历史重开不丢失、不串 Tab。（E1：保存/读盘、绑定/迁移、已有目标 session 和多 Tab 用例；非完整扩展宿主端到端）
- [x] 关闭、重置或工作区切换使在途请求失效，迟到结果不能写入旧会话、新 Tab 或其它工作区。（E1：迟到结果、立即复用重置 Tab、资源释放用例）
- [x] AI 失败、超时或不可用仅使摘要缺失；不影响主任务、会话消息、运行/错误状态或 Loop 协议。（E1：失败/超时/容量溢出与独立调用；E2：状态/角色/关闭回归）
- [x] 鼠标连续停留 Tab 1000 毫秒才显示摘要；离开、切换、关闭、分页和 Escape 均隐藏并撤销未触发的显示。（E2：18 项专门用例；E4：999/1000ms、重绘与选择浏览器检查）
- [x] 键盘连续聚焦 1000 毫秒也能读取；无摘要、生成中和失败均不显示占位浮层。（E2/E4：焦点/重绘/失焦/无效字段与空态）
- [x] 浮层只有一段正文，使用既有主题语义、安全纯文本渲染；窄视口换行且不越界，既有 Tab 功能保持不变。（E2：纯文本/极窄视口/分页/状态；E4：宽窄×深浅四组合、8 张截图）
- [x] 摘要执行复用已有 CLI/provider 配置，但使用独立受限 session，不污染原对话或 Loop 协议；DSH/Kimi/ZCode 不绕过现有 one-shot prompt 参数禁令。（E1：七 CLI 配置/原生协议/权限测试；E3：真实 Codex；其余六 CLI 未做真实 provider 调用）

### 影响面与事实来源

- 现有入口：`src/webview/viewContentScript/messageRendering.ts`（`renderConversationTabs`）、`src/webview/types.ts`（`ConversationTabSummary`）。
- 实现入口：`src/extension.ts` 在 Loop 改写前捕获原始需求，在共同 `runPrompt` 取得配置执行租约后安排摘要；`src/conversationTaskSummary.ts` 的协调器并发 2、总容量 32、活动调用超时 20 秒，`taskSummaryAttempted` 使失败/超时/溢出也只尝试一次；`src/extensionHost/conversationTaskSummary.ts` 复用七种 CLI 现有 runner 独立受限调用。
- 现有数据/生命周期：`src/sessionTabs.ts`、`src/sessionStore.ts`、`src/sessionLifecycle.ts`、`src/extensionHost/sessionTabs.ts`。
- 原生协议限制：`src/cli/cliRunArgStrategies.ts`；不能将独立摘要 session 等同于所有 CLI 都能执行 one-shot 命令。
- 配置与脚本：无新增用户设置，无构建或发布脚本修改。

### 风险与缓解

- 重复生成/资源泄漏：以首次提交身份去重，失败也消费该次尝试；设置受限执行、超时和清理，不能依赖 hover 触发。
- session 接管与迟到写入：捕获工作区、Tab、任务/会话身份及有效代际，写回前重验；绑定迁移时保留摘要，关闭/重置/工作区切换立即失效。
- CLI 协议或主对话污染：独立摘要 session 不复用原 thread，不注入聊天气泡、工具操作或 Loop 汇报；不支持的调用安全缺失，不绕过参数守卫。
- 无效/危险文本：校验纯文本与码点长度，安全渲染，不执行 Markdown/HTML；失败不回落原提示截断。
- 回滚：移除摘要接入和浮层消费即可退回既有 Tab；可选字段缺失应天然兼容，既有会话/消息不需破坏性迁移。

### 验证结果与原始证据

下列实现验证由运行时/UI 交付者及主审执行；文档收口只读复核日志、代码和图片，没有重建 `dist` 或重新调用真实 CLI。E1/E2/E4 测试有重叠，不能相加为独立测试总数。

### E3 真实隔离 Codex 调用

`/tmp/tab-summary-runtime-real-call.log` 记录调用实际 `captureConversationTaskSummaryExecution` 编译产物，仅 VS Code API 为 mock，Codex binary/app-server/provider 为真实调用；独立 session、`model: null`、`thinkingMode: off`，外部安全取消上限 45 秒（不是协调器的 20 秒活动超时）。需求“请修复登录失败时丢失输入内容的问题，并保留用户填写的表单以便重新提交。”得到“修复登录失败后输入丢失问题，保留表单便于重试”，22 Unicode 码点，6348 毫秒，未取消；`isolatedRootRemoved: true` 且收口时目录已不存在。该 smoke 验证真实隔离归纳，不冒称完整扩展宿主/主任务/浮层端到端。

### 决策记录与当前结论

- 2026-11-07：沿用已确定的产品与数据契约，无新增用户开关；区分现有提示词标签与计划中的 AI 摘要。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。首次新增能力；E1/E2/E4覆盖有重叠，281/18/299/41不求和；E3历史真实Codex、其余六CLI未真实联调及早期失败保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
