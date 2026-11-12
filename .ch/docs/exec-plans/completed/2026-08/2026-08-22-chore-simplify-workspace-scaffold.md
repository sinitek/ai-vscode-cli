# 简化 workspace scaffold harness 骨架 — 维护与治理

- 日期：2026-08-22
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-22
- claim_ttl：本轮任务
- handoff_to：无
- 类型：chore
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-22-simplify-workspace-scaffold.md`

## 本类型目标

清理 scaffold 非必要 skills、生成物占位与空目录，保留轻量治理骨架；不修改插件运行时或新建生成机制。

## 范围与所有权

- 清理 scaffold 非必要 skills、生成物占位与空目录，保留轻量治理骨架；不修改插件运行时或新建生成机制。
- 本记录只承担 维护与治理；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 清理 scaffold 非必要 skills、生成物占位与空目录，保留轻量治理骨架；不修改插件运行时或新建生成机制。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-08-22-docs-simplify-workspace-scaffold.md](2026-08-22-docs-simplify-workspace-scaffold.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

`media/workspace-scaffold` 是内置新工作区 harness 模板。当前骨架保留了较多导航页、工具型技能和占位目录，冷启动成本偏高。

### 目标

把 scaffold 简化为规则、测试、ontology、product specs、memory、exec-plans 和必要 skills 的轻量骨架，同时保持事实来源可追踪。

### 范围

- 删除 scaffold 中不属于轻量骨架的导航目录、生成物占位和非必要 skills。

### 非目标

- 不改变 VS Code 插件运行时代码。
- 不改变当前仓库本体以外的业务功能清单。
- 不引入新的 scaffold 生成机制。

### 验收标准

- [x] scaffold 只保留规则、测试、ontology、product specs、memory、exec-plans 和必要 skills。

### 影响面

- 代码目录：`media/workspace-scaffold/`
- 配置与脚本：无运行时代码变更

### 风险与缓解

- 风险：删除目录后遗留引用造成新工作区冷启动困惑。
- 缓解：修改后用 `rg` 扫描旧路径和技能名，并运行 ontology 校验与相关测试。

### 任务列表

- [x] 删除非必要目录、技能和占位导航。

### 决策记录

- 2026-08-22：按用户要求把 scaffold 限定为轻量 harness 骨架，验证细节从功能清单移出，保留到执行计划或测试报告。

## 分类依据与真实状态

chore：删除 skills/占位和清理目录是治理维护且并非插件行为保持抽取；test：原文实际更新 scaffold 回归；docs：索引模板、薄导航、内链和 ontology 描述实际调整。原最终 build 因并行 Loop 类型改动失败、全量 whitespace 既有失败及安全策略拒绝清理均保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
