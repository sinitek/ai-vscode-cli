# 移除 Loop/Loop+ 子任务思考力度上限

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：feature

## 背景与目标

用户要求删除“Loop/Loop+ 子任务最大思考力度”配置，子任务按用户提交的角色思考力度执行，不再将 max/ultra 截断为 xhigh。

## 范围与非目标

- 移除设置 UI、面板协议、持久化字段、宿主读取和执行限幅逻辑。
- 保留原有 CLI 能力校验、角色选择、未选择时的默认行为及跨 CLI/config 隔离。
- 旧 settings.json 中的上限字段读取时忽略；不主动改写用户文件。
- 不修改工作区已有的模型导入、群聊弹窗等未提交改动，不发布扩展。

- 本计划只承担设置 UI/协议/持久化/宿主及执行链路移除；产品/规则文档原由已退役 docs companion 承接（仅历史分工）。测试与验证脚本维护属于已完成历史工作，证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-loop-thinking-uncapped.md` 见[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。

## 验收标准

- 工具设置不再显示或发送上限配置，旧上限消息不再持久化。
- 经典 Loop 和 Loop+ 子任务的合法显式力度（含 max/ultra）不再被插件限幅，主任务行为不变。
- 旧字段不进入归一化设置或面板状态，不主动改写用户文件。

## 影响面与风险

- src/toolSettings.ts、sessionMessageActions.ts、panelStateBuilder.ts、extension.ts、extensionHost 和 Webview 设置链路。
- 风险：移除限幅时意外改变默认力度；历史显式/空值/非法值、跨 CLI 和角色路由回归证据见上述来源审计。
- 回滚：仅回退对应生产变更，保留工作区已有模型导入、群聊弹窗与 ARCHITECTURE 未提交改动。

## 任务列表

- [x] 定位配置入口与力度限制链路。
- [x] 移除限幅模块及全部生产引用，保持用户提交力度与原 CLI 能力校验。
- [x] 设置、消息、面板与执行器不再读取或输出旧字段。

## 验证计划与历史结果

原计划执行构建、437 条相关 Node 单测及两个视口的完整 Webview smoke 验证；测试计划移除审计仅保留历史结果、首次编译失败及平台/主题限制摘要，不保留完整命令。来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-loop-thinking-uncapped.md`。文档/ontology 历史校验由 docs 保存。未真实付费调用或 DevHost 验证，不将模拟结果当真实模型。

## 当前结论

已移除配置、持久化、面板协议和运行时上限链路。经典 Loop 与 Loop+ 共用角色力度解析器，不再截断用户提交的 max/ultra；原生 CLI 能力校验、角色隔离与默认行为不变。旧字段读取忽略，不主动改写用户配置。已归档，无待办。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留 Loop 子任务力度保留与旧配置回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-loop-thinking-uncapped.md`；不再作为现行测试责任。
- 历史文档分工：Loop 子任务思考力度规格与角色规则同步，共享本来源的历史背景与接口。 原 docs companion `2026-11-05-docs-loop-thinking-uncapped.md#背景与目标` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
