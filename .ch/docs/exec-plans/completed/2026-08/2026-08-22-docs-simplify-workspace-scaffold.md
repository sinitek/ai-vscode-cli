# 简化 workspace scaffold harness 骨架 — 文档

- 日期：2026-08-22
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-22
- claim_ttl：本轮任务
- handoff_to：无
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-22-simplify-workspace-scaffold.md`

## 本类型目标

将 FEATURE_INVENTORY 模板收成索引，薄导航并入 README，更新 scaffold 内链与 ontology 描述，避免删目录后断链。

## 范围与所有权

- 将 FEATURE_INVENTORY 模板收成索引，薄导航并入 README，更新 scaffold 内链与 ontology 描述，避免删目录后断链。
- 本记录只承担 文档；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 将 FEATURE_INVENTORY 模板收成索引，薄导航并入 README，更新 scaffold 内链与 ontology 描述，避免删目录后断链。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-08-22-chore-simplify-workspace-scaffold.md](2026-08-22-chore-simplify-workspace-scaffold.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 本类型历史记录

### 范围

- 精简 `media/workspace-scaffold/.ch/docs/product-specs/FEATURE_INVENTORY.md` 为能力索引。
- 合并薄导航页到 `media/workspace-scaffold/.ch/docs/README.md`。
- 更新 scaffold 内部引用，避免断链。

### 验收标准

- [x] `FEATURE_INVENTORY.md` 只保留状态、角色、规格来源、实现入口、最近验证链接等索引字段。
- [x] 薄导航页信息已并入 `.ch/docs/README.md`，事实源入口不丢失。
- [x] scaffold 内没有指向已删除目录或技能的断链引用。

### 影响面

- 文档目录：`.ch/docs/exec-plans/`

### 测试与清单同步

- 功能清单：本次修改 scaffold 模板清单规则，不改变当前插件用户可见能力；无需更新当前仓库 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 scaffold 文档、scaffold ontology 建议路径、root ontology scaffold 描述与本计划。

### 任务列表

- [x] 精简 scaffold 文档入口和功能清单模板。

### 决策记录

- 2026-08-22：按用户要求把 scaffold 限定为轻量 harness 骨架，验证细节从功能清单移出，保留到执行计划或测试报告。

### 当前结论

已完成并归档到 `.ch/docs/exec-plans/completed/2026-08/2026-08-22-simplify-workspace-scaffold.md`。scaffold 已精简为轻量 harness 骨架，能力清单已改为索引，薄导航页已合并到 `.ch/docs/README.md`。

## 分类依据与真实状态

chore：删除 skills/占位和清理目录是治理维护且并非插件行为保持抽取；test：原文实际更新 scaffold 回归；docs：索引模板、薄导航、内链和 ontology 描述实际调整。原最终 build 因并行 Loop 类型改动失败、全量 whitespace 既有失败及安全策略拒绝清理均保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
