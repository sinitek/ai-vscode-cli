# 分离会话消息清理策略与生命周期编排

- 日期：2026-11-16
- 类型：refactor
- 关联计划：无
- 状态：completed
- 负责人：Codex
- owner：Loop+ round-1 子任务
- claimed_at：2026-11-16
- claim_ttl：本轮执行结束
- handoff_to：Loop+ 主审

## 背景

`sessionLifecycle.ts#pruneChatMessages` 同时承担请求身份授权、目标消息数组收集、候选校验/保护规则、持久化和内存提交。保护与删除决策可在纯函数中表达，生命周期应继续拥有授权和副作用顺序。

## 目标

在保持现有聊天气泡永久清理行为、公开入口和存储格式不变的前提下，将删除规划提取到 `src/sessionMessagePruningPolicy.ts`，并由生命周期入口继续编排落盘与提交。

## 范围

- 新增只依赖最终答复协议、JSON 容器解析和消息类型的纯同步 Policy。
- 保持身份验证、source/targets 构造、runtime/primary 活跃消息收集、持久化、数组原地压缩、标记及索引更新留在宿主。
- 补充 Policy 行为测试并复用生命周期真实临时存储回归。
- 更新设计事实来源及本计划；Ontology 补充 Policy 来源路径。

## 非目标

- 不改变 Webview 批次选择、群聊清理、按天历史保留、最终答复/JSON 解析协议、用户可见行为、设置或产品清单。
- 不改仓储、文件路径/格式、CLI 外部日志上下文、依赖、UI 或公开消息协议。

## 验收标准

- [x] Policy 对 source、共同消息数组、候选快照与 protectedIds 只读，返回待删 ID 和按 source 顺序保留原对象的剩余数组。
- [x] 用户消息、文本最终答复、跨数组内容变化/最终答复升级及活跃 ID 不会被删除；完整 JSON 对象/数组最终气泡仍可删除，候选无效与重复语义不变。
- [x] 生命周期保留授权入口及同步签名，持久化成功后才原地压缩所有 targets，失败时数组与索引不变。
- [x] 既有真实文件生命周期回归确认重开、草稿迁移、Claude 防复活；计划归档并同步事实来源。

## 影响面

- 代码目录：`src/sessionLifecycle.ts`、新增 `src/sessionMessagePruningPolicy.ts`、相关 session tests。
- 文档目录：聊天气泡保留设计、ontology、执行计划。
- 配置与脚本：无。

## 风险与缓解

- 策略抽取可能改变候选异常值、重复 ID 覆盖或多数组保护语义；保留原 Map 最后覆盖及逐数组复核算法，并以边界单测锁定。
- 调整副作用顺序可能造成写盘失败时内存已变；Policy 只规划，生命周期仍先 `persistPrunedMessages` 成功后压缩数组。

## 验证计划

- 最小相关验证：`npm run build` 后运行指定 Policy、Lifecycle、Repository、message handler、Webview retention、runtime、final answer 与 JSON 容器编译后测试。
- 单元自测命令：同上，并执行 `git diff --check`、ontology `--validate` 和 ontology Python 单测。
- 扩展验证：不启动真实 CLI/VS Code；现有生命周期测试使用真实临时会话文件，不宣称为扩展端到端。

## 测试与清单同步

- 单元测试新增/更新：新增纯 Policy 边界测试；现有 Lifecycle Core Coverage 已覆盖持久化先后、写入失败、重开、草稿迁移与 Claude 防复活。
- 单元自测结果：`npm run build` 通过；指定 9 个编译后测试文件 287/287 通过（0 failed/skipped）；`git diff --check` 通过；Ontology `--validate` 通过（domains=2、concepts=17、relations=16、rules=141、workflows=2、documents=3）；ontology Python 单测 9/9 通过。
- 失败处理记录：首轮指定测试 286/287，唯一失败来自测试 helper 将显式 `undefined` 默认化为有效候选；调整用例为直接调用 Policy 验证 undefined 后，重建并重跑整份清单通过。无产品代码失败。
- 功能清单：无需修改；这是内部规则抽取，产品行为及用户可见功能不变。
- 相关文档同步：设计文档说明 Policy/宿主编排边界；Ontology 稳定规则保留原 ID、含义及 lifecycle 来源并增加 Policy 来源。

## 任务列表

- [x] 建立专属计划并确认既有生命周期集成回归。
- [x] 提取纯删除 Policy，接入 lifecycle facade，补充 Policy 测试。
- [x] 同步设计文档与 ontology，完成验证并归档计划。

## 决策记录

- 2026-11-16：只选择删除规划抽取这一方向；其它候选已有策略/仓储/外观边界或收益证据不足，不扩展本次范围。
- 2026-11-16：不修改 FEATURE_INVENTORY，因为行为、协议和产品能力均保持不变。

## 当前结论

本轮实施与自测已完成并归档。回归使用 Node 临时目录中的真实会话文件和实际 session lifecycle / repository；没有启动真实 CLI 或 VS Code Extension Host。归档表示本轮实现交付完成，仍等待 Loop+ 主审独立阅读 diff 验收。
