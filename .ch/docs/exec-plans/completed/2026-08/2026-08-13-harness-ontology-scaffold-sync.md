# Harness ontology scaffold 同步

- 日期：2026-08-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-13
- claim_ttl：1d
- handoff_to：

## 背景

目标系统 `/Users/fangjiawei/sinitek/sinitek-zhiqiu-workspace` 的 harness 骨架已更新，并支持 ontology 本体。当前仓库需要吸收这些 harness 规则，同时让内置 `media/workspace-scaffold` 模板也具备相同能力。用户明确要求重点关注 `AGENTS.md` 的写法，并将目标系统 skills 完整复制过来。

## 目标

- 对比目标系统与当前仓库的 harness、ontology、AGENTS 和 skills 差异。
- 将目标系统 `.agents/skills/` 完整同步到当前仓库。
- 更新当前仓库根级 `AGENTS.md`，吸收目标系统新增的 ontology / harness 规则，同时保留本 VS Code 插件项目特有约束。
- 更新 `media/workspace-scaffold`，让新建工作区模板也支持 ontology 本体与最新 harness 写法。
- 完成最小相关验证，确认文档和 scaffold 结构可检索、关键文件存在、构建不受影响。

## 范围

- 根级 `AGENTS.md`
- `.agents/skills/`
- `media/workspace-scaffold/`
- 必要的 `.ch/docs/` harness / ontology 文档入口
- 本执行计划及验证记录

## 非目标

- 不替换当前 VS Code 插件技术栈。
- 不迁移目标系统业务代码、业务文档或业务配置。
- 不修改与 harness/scaffold/skills 无关的插件运行时代码。

## 验收标准

- [x] 目标系统 `.agents/skills/` 已完整复制到当前仓库。
- [x] 根级 `AGENTS.md` 保留当前项目特有规则，并吸收目标系统新增 ontology / harness 规则。
- [x] `media/workspace-scaffold` 包含 ontology 支持与最新 `AGENTS.md` 写法。
- [x] 相关 scaffold 文档入口可导航，且不存在目标业务系统专属内容误植。
- [x] 完成最小相关验证并记录结果。

## 影响面

- 代码目录：无预期运行时代码改动。
- 文档目录：`AGENTS.md`、`.agents/skills/`、`media/workspace-scaffold/`、`.ch/docs/exec-plans/completed/2026-08/`
- 配置与脚本：按目标系统 skills 完整同步，可能影响可用 skill 集合。

## 风险与缓解

- 风险：直接覆盖 `AGENTS.md` 可能丢失当前 VS Code 插件项目规则。
- 缓解：先对比目标系统与当前文件，人工合并稳定规则，只把业务无关的 ontology / harness 机制带入。
- 风险：目标系统包含业务专属文档，不应进入通用 scaffold。
- 缓解：只迁移 harness 骨架、ontology 支持和 skills；业务内容仅用于识别新规则。
- 风险：skills 全量覆盖可能删除当前仓库已有但目标系统没有的 skill。
- 缓解：遵循用户“skills 完全复制过来”的明确要求，执行前后记录清单差异。

## 验证计划

- 最小相关验证：检查关键文件存在、对比 skills 文件清单、搜索 ontology / workspace-scaffold 入口。
- 单元自测命令：如无运行时代码改动，执行 `npm run build` 作为 Node 项目构建验证。
- 扩展验证：必要时执行 scaffold 文件清单检查与 JSON 格式检查。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/workspaceScaffoldSkillPaths.test.ts`，适配目标系统新版 `memory-recall` 默认输出路径与移除的 `--skip-indexer` 参数，并继续约束 generated artifact 不写入本机绝对路径。
- 单元自测结果：
  - `npm run build`：通过。
  - `node --test dist/test/workspaceScaffoldSkillPaths.test.js`：通过。
  - `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
  - `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：通过，7 项。
  - 在 `media/workspace-scaffold` 下执行同组 ontology validate / unittest：通过。
  - `python3 -m py_compile` 覆盖本次改动的 skill Python 脚本：通过。
  - `git diff --check`：通过。
- 归档后复核结果：
  - 计划已归档到 `.ch/docs/exec-plans/completed/2026-08/2026-08-13-harness-ontology-scaffold-sync.md`。
  - 根仓库 ontology validate / unittest、scaffold ontology validate / unittest、`npm run build`、`node --test dist/test/workspaceScaffoldSkillPaths.test.js`、`git diff --check`：均通过。
  - `.ch/docs/ontology/` 中指向本计划的 `source_refs` 已更新为归档路径。
- 失败处理记录：`workspaceScaffoldSkillPaths` 初次回归暴露目标系统新版 skills 的 generated artifact 重新写入本机绝对路径，已修复 `claim-release-auditor`、`reference-pack-drift-auditor`、`repo-indexer`、`work-frontier` 的 repo-relative 输出；同时更新测试以适配新版 `memory-recall` 输出到 `.ch/docs/generated/memory-index/.local/`。
- 功能清单：本次只更新开发 harness、skills、ontology 与 workspace scaffold，不改变插件用户可见产品能力；无需更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新根级 `AGENTS.md`、`.ch/docs/README.md`、`.ch/docs/AGENTS.md`、新增 `.ch/docs/ontology/`；同步更新 `media/workspace-scaffold/AGENTS.md`、`media/workspace-scaffold/.ch/docs/README.md`、`media/workspace-scaffold/.ch/docs/AGENTS.md` 和 scaffold ontology 骨架；刷新 `.ch/docs/generated/harness-sync-manifest.json`。

## 任务列表

- [x] 读取目标系统 harness / ontology / AGENTS / skills 结构。
- [x] 同步目标系统 `.agents/skills/` 到当前仓库。
- [x] 合并更新根级 `AGENTS.md`。
- [x] 更新 `media/workspace-scaffold` 的 AGENTS、ontology 和 harness 文档。
- [x] 执行最小验证并写回计划。

## 决策记录

- 2026-08-13：本次只吸收目标系统的通用 harness、ontology、AGENTS 和 skills，不迁移目标系统业务代码。
- 2026-08-13：根仓库 ontology 使用 VS Code CLI 插件运行时与 harness 治理概念；`media/workspace-scaffold` 使用业务中性的 `project.*` 占位骨架，避免误植目标业务系统专属概念。
- 2026-08-13：按用户“skills 完全复制过来”要求，同步目标系统 `.agents/skills/`，但保留当前仓库专用 `local-real-testing` skill。
- 2026-08-13：目标系统新版 memory / repo / frontier 脚本采用单文件脚本结构，已删除旧版 helper package 目录，并修复 generated artifact 的 repo-relative 输出约束。

## 当前结论

本次同步已完成。当前仓库和 `media/workspace-scaffold` 均具备 ontology 查询/维护入口、目标系统新版 skills、更新后的 AGENTS 导航和可验证的 scaffold 相对路径回归。官方 skills catalog 未改动，现有 56 条 description 均保持中文。
