# Harness ontology 简化 — 文档

- 日期：2026-08-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-13
- claim_ttl：same-session
- handoff_to：
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-13-harness-ontology-simplification.md`

## 本类型目标

收敛根与 scaffold AGENTS、局部导航和 ontology README 的重复说明，保留初始化阻断及完整流程入口；不改 JSON 模型或脚本业务。

## 范围与所有权

- 收敛根与 scaffold AGENTS、局部导航和 ontology README 的重复说明，保留初始化阻断及完整流程入口；不改 JSON 模型或脚本业务。
- 本记录只承担 文档；其它类型的实施、测试开发或文档编写归下列具体关联计划，不作为本计划的附带事项。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 收敛根与 scaffold AGENTS、局部导航和 ontology README 的重复说明，保留初始化阻断及完整流程入口；不改 JSON 模型或脚本业务。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-08-13-chore-harness-ontology-simplification.md](2026-08-13-chore-harness-ontology-simplification.md)：维护与治理交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

Harness 已支持 AI 开发业务本体，根级规则、`.ch/docs` 局部说明、ontology README 和 ontology skill 之间出现了任务前查询、空本体初始化、任务后维护规则的重复描述。

### 目标

精简入口文档，只保留必须执行的硬规则和导航，把详细流程集中到 `.agents/skills/ontology/SKILL.md` 与 `.ch/docs/ontology/README.md`。

### 范围

- 根仓库 `AGENTS.md` 与 `.ch/docs/AGENTS.md`
- `media/workspace-scaffold/AGENTS.md` 与 `media/workspace-scaffold/.ch/docs/AGENTS.md`

### 非目标

- 不改变 ontology JSON 数据模型。
- 不删除高价值 skills。
- 不重构已有脚本或业务代码。

### 验收标准

- [x] 入口文档不再重复展开完整 ontology 查询流程。
- [x] 空本体必须先初始化的规则仍清晰保留。
- [x] scaffold 保持自足，新项目仍能找到 ontology 初始化入口。
- [x] 相关校验命令通过。

### 影响面

- 代码目录：无预期代码变更
- 文档目录：`AGENTS.md`、`.ch/docs/AGENTS.md`、`media/workspace-scaffold/**/AGENTS.md`
- 配置与脚本：无预期脚本变更

### 风险与缓解

- 风险：过度精简导致代理跳过 ontology 初始化。
- 缓解：入口只压缩说明，不移除 `--status-report`、初始化阻断和 skill/README 指向。

### 验证计划

- 最小相关验证：`git diff --check`
- 单元自测命令：本轮只改文档，运行 ontology validate 和 scaffold skill path test 作为回归边界。
- 扩展验证：必要时运行 `npm run build`

### 测试与清单同步

- 单元测试新增/更新：无；本轮为文档与 manifest 收敛，不改变运行时代码。
- 单元自测结果：
  - `git diff --check`：通过。
  - `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，domains=2 concepts=13 relations=10 rules=8 workflows=2 documents=3。
  - `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：通过，9 项。
  - 在 `media/workspace-scaffold` 下执行 ontology validate：通过，domains=2 concepts=9 relations=6 rules=5 workflows=1 documents=3。
  - 在 `media/workspace-scaffold` 下执行 ontology unittest：通过，9 项。
  - `npm run build`：通过。
  - `node --test dist/test/workspaceScaffoldSkillPaths.test.js`：通过，2 项。
- 功能清单：无用户可见功能变化，无需更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 文档同步：已精简根与scaffold AGENTS、.ch/docs/AGENTS及ontology README；manifest、生成清单与缓存维护独归关联chore。

### 决策记录

- 2026-08-13：保留 skills，因为 ontology 是语义地图，skills 是执行程序；本次只减少重复说明，不删除执行能力。
- 2026-08-13：`AGENTS.md` 只保留 ontology 的硬约束和入口导航；完整操作步骤集中到 `.agents/skills/ontology/SKILL.md`，ontology README 只保留数据说明和不变量。

### 当前结论

已完成并归档到 `.ch/docs/exec-plans/completed/2026-08/2026-08-13-harness-ontology-simplification.md`。

## 分类依据与真实状态

docs：原目标只精简入口说明，明确无代码及测试开发；chore：原文另有 manifest/生成清单刷新和四个明确缓存目录清理，独立记录维护事实。既有校验运行不能转成 test 开发；安全策略拒绝 rm -rf 的失败与替代清理保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。
