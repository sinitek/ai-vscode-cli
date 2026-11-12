# Loop+ 主任务中断子任务 — 文档

- 日期：2026-09-29
- 状态：completed
- 负责人：Codex
- owner：loop-plus-subtask-control
- claimed_at：2026-09-29
- claim_ttl：本计划已完成，不再占用
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-29-loop-plus-subtask-control.md`

## 本类型目标

同步loop-plus-scheduling设计、FEATURE_INVENTORY、capabilities、ontology及PITFALLS的控制/中止边界，不迁移同提交generated索引。

## 范围与所有权

- 同步loop-plus-scheduling设计、FEATURE_INVENTORY、capabilities、ontology及PITFALLS的控制/中止边界，不迁移同提交generated索引。
- 本记录只承担 文档；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 同步loop-plus-scheduling设计、FEATURE_INVENTORY、capabilities、ontology及PITFALLS的控制/中止边界，不迁移同提交generated索引。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-09-29-feature-loop-plus-subtask-control.md](2026-09-29-feature-loop-plus-subtask-control.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 本类型历史记录

### 范围

- 设计文档、功能清单、能力和 ontology。

### 影响面

- 文档目录：`.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`、`.ch/docs/runbooks/PITFALLS.md`

## 分类依据与真实状态

feature：新增主任务控制协议和宿主中止/重派能力；test：5aed9b82实际更新decision/scheduler/编排/提示及面板测试；docs：源文范围、影响面与同提交证实设计/产品/PITFALLS/ontology实际更新。只保留源文相关回归通过，不虚构数量或整体上线。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
