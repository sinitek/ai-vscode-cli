# Harness ontology scaffold 同步 — 文档

- 日期：2026-08-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-13
- claim_ttl：1d
- handoff_to：
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-13-harness-ontology-scaffold-sync.md`

## 本类型目标

合并根 AGENTS、skill 说明、scaffold 与 .ch ontology 导航规则，保留插件专属约束；同步 ontology 归档来源。

## 范围与所有权

- 合并根 AGENTS、skill 说明、scaffold 与 .ch ontology 导航规则，保留插件专属约束；同步 ontology 归档来源。
- 本记录只承担 文档；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 合并根 AGENTS、skill 说明、scaffold 与 .ch ontology 导航规则，保留插件专属约束；同步 ontology 归档来源。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-08-13-chore-harness-ontology-scaffold-sync.md](2026-08-13-chore-harness-ontology-scaffold-sync.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 本类型历史记录

### 目标

- 更新当前仓库根级 `AGENTS.md`，吸收目标系统新增的 ontology / harness 规则，同时保留本 VS Code 插件项目特有约束。
- 更新 `media/workspace-scaffold`，让新建工作区模板也支持 ontology 本体与最新 harness 写法。

### 范围

- 根级 `AGENTS.md`
- 必要的 `.ch/docs/` harness / ontology 文档入口

### 验收标准

- [x] 根级 `AGENTS.md` 保留当前项目特有规则，并吸收目标系统新增 ontology / harness 规则。
- [x] `media/workspace-scaffold` 包含 ontology 支持与最新 `AGENTS.md` 写法。
- [x] 相关 scaffold 文档入口可导航，且不存在目标业务系统专属内容误植。

### 影响面

- 文档目录：`AGENTS.md`、`.agents/skills/`、`media/workspace-scaffold/`、`.ch/docs/exec-plans/completed/2026-08/`

### 测试与清单同步

  - `.ch/docs/ontology/` 中指向本计划的 `source_refs` 已更新为归档路径。
- 功能清单：本次只更新开发 harness、skills、ontology 与 workspace scaffold，不改变插件用户可见产品能力；无需更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新根级 `AGENTS.md`、`.ch/docs/README.md`、`.ch/docs/AGENTS.md`、新增 `.ch/docs/ontology/`；同步更新 `media/workspace-scaffold/AGENTS.md`、`media/workspace-scaffold/.ch/docs/README.md`、`media/workspace-scaffold/.ch/docs/AGENTS.md` 和 scaffold ontology 骨架；刷新 `.ch/docs/generated/harness-sync-manifest.json`。

### 任务列表

- [x] 合并更新根级 `AGENTS.md`。
- [x] 更新 `media/workspace-scaffold` 的 AGENTS、ontology 和 harness 文档。

### 决策记录

- 2026-08-13：本次只吸收目标系统的通用 harness、ontology、AGENTS 和 skills，不迁移目标系统业务代码。
- 2026-08-13：根仓库 ontology 使用 VS Code CLI 插件运行时与 harness 治理概念；`media/workspace-scaffold` 使用业务中性的 `project.*` 占位骨架，避免误植目标业务系统专属概念。

### 当前结论

本次同步已完成。当前仓库和 `media/workspace-scaffold` 均具备 ontology 查询/维护入口、目标系统新版 skills、更新后的 AGENTS 导航和可验证的 scaffold 相对路径回归。官方 skills catalog 未改动，现有 56 条 description 均保持中文。

## 分类依据与真实状态

chore：授权同步技能/脚本与清理 helper package 属开发治理，不是插件新增功能；test：实际修改 scaffold 路径回归；docs：AGENTS/skill/ontology/scaffold 导航实际合并。7项 ontology 和归档后复核均为历史证据，不重新执行。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
