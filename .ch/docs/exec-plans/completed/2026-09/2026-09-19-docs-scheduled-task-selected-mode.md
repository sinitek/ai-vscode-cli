# 定时任务按选中的 Vibe/Loop 配置执行 — 文档

- 日期：2026-09-19
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-19
- claim_ttl：本次会话
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-19-scheduled-task-selected-mode.md`

## 本类型目标

同步 FEATURE_INVENTORY、capabilities、ontology，并在9/15 runtime-mode历史记录标注后续政策，不更改旧验证结论。

## 范围与所有权

- 同步 FEATURE_INVENTORY、capabilities、ontology，并在9/15 runtime-mode历史记录标注后续政策，不更改旧验证结论。
- 本记录只承担 文档；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 同步 FEATURE_INVENTORY、capabilities、ontology，并在9/15 runtime-mode历史记录标注后续政策，不更改旧验证结论。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-09-19-feature-scheduled-task-selected-mode.md](2026-09-19-feature-scheduled-task-selected-mode.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 本类型历史记录

### 影响面

- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`。

### 测试与清单同步

- 功能清单：已更新定时任务条目，明确按选中的 Vibe/Loop 及该模式已保存配置执行。
- 相关文档同步：已更新 capabilities、ontology，并在旧 runtime-mode 计划中标注后续决策。

## 分类依据与真实状态

feature：创建时显式模式选择及快照是新增产品行为；test：三组覆盖实际更新；docs：产品/ontology及9/15后续说明实际更新。51/51与分组24/24、8/8不擅自重算；detector脚本缺失未执行保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
