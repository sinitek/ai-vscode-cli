# Harness 框架升级与简化 — 行为保持重构

- 日期：2026-08-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-29
- claim_ttl：1d
- 类型：refactor
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-29-harness-framework-simplification.md`

## 本类型目标

只调整通用 profile、可执行 skill/script 路由与旧治理工具结构；保留插件事实源和源码行为。AGENTS、SKILL 正文及 .ch 通用文档的编写/迁移独归 docs。

## 范围与所有权

- 只调整通用 profile、可执行 skill/script 路由与旧治理工具结构；保留插件事实源和源码行为。AGENTS、SKILL 正文及 .ch 通用文档的编写/迁移独归 docs。
- 本记录只承担 行为保持重构；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 只调整通用 profile、可执行 skill/script 路由与旧治理工具结构；保留插件事实源和源码行为。AGENTS、SKILL 正文及 .ch 通用文档的编写/迁移独归 docs。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-08-29-docs-harness-framework-simplification.md](2026-08-29-docs-harness-framework-simplification.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

当前仓库的 `.ch` 与 `.agents` harness 文件较重，目标系统 `/Users/fangjiawei/sinitek/sinitek-zhiqiu-workspace` 已完成较新版本的升级和简化。本次参考目标系统，把通用 harness 治理层同步到当前 VS Code 插件仓库，同时保留本仓库已有产品事实源与历史执行记录。

### 范围

- 对比并迁移目标系统中可复用的 `.agents/profiles`、`.agents/skills` 通用框架更新。
- 保留当前仓库的产品规格、设计文档、runbook、ontology 数据、完成计划和 VS Code 插件事实源。

### 非目标

- 不迁移目标系统的业务功能、数据库、工坊、登录、权限等项目私有文档。
- 不改动当前仓库源码行为。
- 不替换技术栈、CLI 运行方式或 VS Code 插件产品定义。

### 验收标准

- [x] `.agents` 通用 profile、skill 与脚本与目标系统的最新简化框架对齐，且移除当前仓库中不再需要的旧 harness skill。

### 影响面

- 代码目录：无源码改动计划。
- 配置与脚本：`.agents/skills/`、`.agents/profiles/`。

### 风险与缓解

- 风险：直接复制目标系统可能带入 zhiqiu 业务私有规则。
- 缓解：只迁移通用 harness 层；对业务文档、ontology 数据和产品规格做保留或局部适配。

### 任务列表

- [x] 对比目标系统与当前仓库 harness 文件差异。
- [x] 迁移通用 `.agents` profile、skill 和脚本更新。
- [x] 删除不再需要的旧 harness 文件，并保留业务事实源。

### 决策记录

- 2026-08-29：执行范围限定为通用 harness 框架升级与简化，不迁移目标系统项目业务内容。

## 分类依据与真实状态

refactor：仅通用可执行框架、profile/脚本结构和路由收敛，原文明确不改源码行为；docs 独占原范围第2项通用治理文档迁移和根导航/ontology正文；test 保留已验收拆分及 runbooks 首次错误断言后修正记录，不重跑。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
