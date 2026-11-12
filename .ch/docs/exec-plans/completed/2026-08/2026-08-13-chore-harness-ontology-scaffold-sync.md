# Harness ontology scaffold 同步 — 维护与治理

- 日期：2026-08-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-13
- claim_ttl：1d
- handoff_to：
- 类型：chore
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-13-harness-ontology-scaffold-sync.md`

## 本类型目标

按明确授权同步通用 skill 脚本及 scaffold 骨架，移除旧 helper package，保留 local-real-testing 与插件业务边界；不迁入目标系统业务。

## 范围与所有权

- 按明确授权同步通用 skill 脚本及 scaffold 骨架，移除旧 helper package，保留 local-real-testing 与插件业务边界；不迁入目标系统业务。
- 本记录只承担 维护与治理；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 按明确授权同步通用 skill 脚本及 scaffold 骨架，移除旧 helper package，保留 local-real-testing 与插件业务边界；不迁入目标系统业务。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-08-13-docs-harness-ontology-scaffold-sync.md](2026-08-13-docs-harness-ontology-scaffold-sync.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

目标系统 `/Users/fangjiawei/sinitek/sinitek-zhiqiu-workspace` 的 harness 骨架已更新，并支持 ontology 本体。当前仓库需要吸收这些 harness 规则，同时让内置 `media/workspace-scaffold` 模板也具备相同能力。用户明确要求重点关注 `AGENTS.md` 的写法，并将目标系统 skills 完整复制过来。

### 目标

- 对比目标系统与当前仓库的 harness、ontology、AGENTS 和 skills 差异。
- 将目标系统 `.agents/skills/` 完整同步到当前仓库。

### 范围

- `.agents/skills/`
- `media/workspace-scaffold/`

### 非目标

- 不替换当前 VS Code 插件技术栈。
- 不迁移目标系统业务代码、业务文档或业务配置。
- 不修改与 harness/scaffold/skills 无关的插件运行时代码。

### 验收标准

- [x] 目标系统 `.agents/skills/` 已完整复制到当前仓库。

### 影响面

- 代码目录：无预期运行时代码改动。
- 配置与脚本：按目标系统 skills 完整同步，可能影响可用 skill 集合。

### 风险与缓解

- 风险：直接覆盖 `AGENTS.md` 可能丢失当前 VS Code 插件项目规则。
- 缓解：先对比目标系统与当前文件，人工合并稳定规则，只把业务无关的 ontology / harness 机制带入。
- 风险：目标系统包含业务专属文档，不应进入通用 scaffold。
- 缓解：只迁移 harness 骨架、ontology 支持和 skills；业务内容仅用于识别新规则。
- 风险：skills 全量覆盖可能删除当前仓库已有但目标系统没有的 skill。
- 缓解：遵循用户“skills 完全复制过来”的明确要求，执行前后记录清单差异。

### 验证计划

- 最小相关验证：检查关键文件存在、对比 skills 文件清单、搜索 ontology / workspace-scaffold 入口。
- 单元自测命令：如无运行时代码改动，执行 `npm run build` 作为 Node 项目构建验证。
- 扩展验证：必要时执行 scaffold 文件清单检查与 JSON 格式检查。

### 任务列表

- [x] 读取目标系统 harness / ontology / AGENTS / skills 结构。
- [x] 同步目标系统 `.agents/skills/` 到当前仓库。

### 决策记录

- 2026-08-13：按用户“skills 完全复制过来”要求，同步目标系统 `.agents/skills/`，但保留当前仓库专用 `local-real-testing` skill。
- 2026-08-13：目标系统新版 memory / repo / frontier 脚本采用单文件脚本结构，已删除旧版 helper package 目录，并修复 generated artifact 的 repo-relative 输出约束。

## 分类依据与真实状态

chore：授权同步技能/脚本与清理 helper package 属开发治理，不是插件新增功能；test：实际修改 scaffold 路径回归；docs：AGENTS/skill/ontology/scaffold 导航实际合并。7项 ontology 和归档后复核均为历史证据，不重新执行。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
