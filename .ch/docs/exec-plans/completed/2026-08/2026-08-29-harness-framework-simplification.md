# Harness 框架升级与简化

- 日期：2026-08-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-29
- claim_ttl：1d

## 背景

当前仓库的 `.ch` 与 `.agents` harness 文件较重，目标系统 `/Users/fangjiawei/sinitek/sinitek-zhiqiu-workspace` 已完成较新版本的升级和简化。本次参考目标系统，把通用 harness 治理层同步到当前 VS Code 插件仓库，同时保留本仓库已有产品事实源与历史执行记录。

## 目标

升级并简化 `.ch` 与 `.agents` 下的通用 harness 框架、规则、skill 与脚本，使入口更轻、路由更清晰、生成物更少，同时不覆盖当前仓库的插件业务文档和历史计划。

## 范围

- 对比并迁移目标系统中可复用的 `.agents/profiles`、`.agents/skills` 通用框架更新。
- 对比并迁移 `.ch/docs` 下通用治理入口、测试/安全/工具/记忆/执行计划等基础文档模板更新。
- 保留当前仓库的产品规格、设计文档、runbook、ontology 数据、完成计划和 VS Code 插件事实源。

## 非目标

- 不迁移目标系统的业务功能、数据库、工坊、登录、权限等项目私有文档。
- 不改动当前仓库源码行为。
- 不替换技术栈、CLI 运行方式或 VS Code 插件产品定义。

## 验收标准

- [x] `.agents` 通用 profile、skill 与脚本与目标系统的最新简化框架对齐，且移除当前仓库中不再需要的旧 harness skill。
- [x] `.ch/docs` 通用入口与模板对齐目标系统的简化版本，保留当前仓库业务事实源。
- [x] 相关 harness 脚本、ontology 校验和最小文档检查通过。
- [x] 根级 `AGENTS.md` 的 harness 入口变轻，并继续保留当前仓库的 VS Code 插件约束。

## 影响面

- 代码目录：无源码改动计划。
- 文档目录：`.ch/docs/`、`AGENTS.md`。
- 配置与脚本：`.agents/skills/`、`.agents/profiles/`。

## 风险与缓解

- 风险：直接复制目标系统可能带入 zhiqiu 业务私有规则。
- 缓解：只迁移通用 harness 层；对业务文档、ontology 数据和产品规格做保留或局部适配。

## 验证计划

- 最小相关验证：目录差异复核、Markdown/JSON 可读性检查。
- 单元自测命令：`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`。
- 扩展验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`，必要时运行更新后的 harness 脚本 `--help` 或生成检查。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/workspaceScaffoldSkillPaths.test.ts`，确保 scaffold 保留轻量 skills/docs，且 `runbooks` 作为长期事实源继续存在。
- 单元自测结果：通过 `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`、`python3 -m unittest discover -s .agents/skills/memory-consolidator/tests -p 'test_*.py'`、`python3 -m py_compile .agents/skills/memory-consolidator/scripts/consolidate_memory.py .agents/skills/memory-indexer/scripts/generate_memory_index.py .agents/skills/memory-recall/scripts/build_recall_pack.py .agents/skills/ontology/scripts/search_ontology.py .agents/skills/repo-indexer/scripts/generate_repo_index.py`、`npm run build`、`node --test dist/test/workspaceScaffoldSkillPaths.test.js`、`git diff --check`。
- 失败处理记录：`node --test dist/test/workspaceScaffoldSkillPaths.test.js` 初次失败，因为测试错误地要求删除 scaffold `runbooks`；核对目标系统与当前仓库后确认 `runbooks` 应保留，已修正断言并重跑通过。
- 功能清单：无用户可见插件功能变更，无需更新。
- 相关文档同步：`AGENTS.md`、`.ch/docs/*`、`.ch/docs/ontology/*`、`.agents/skills/*`、`src/test/workspaceScaffoldSkillPaths.test.ts`。

## 任务列表

- [x] 对比目标系统与当前仓库 harness 文件差异。
- [x] 迁移通用 `.agents` profile、skill 和脚本更新。
- [x] 迁移通用 `.ch/docs` 入口、模板与治理文档更新。
- [x] 删除不再需要的旧 harness 文件，并保留业务事实源。
- [x] 执行最小相关验证并记录结论。

## 决策记录

- 2026-08-29：执行范围限定为通用 harness 框架升级与简化，不迁移目标系统项目业务内容。

## 当前结论

已完成 `.ch` 与 `.agents` harness 框架升级和简化：core skills 精简到八个高复用入口，旧治理报表、跨仓包、评测、看板和工作台类 skills/生成物已移出 core；根级 `AGENTS.md` 与 `.ch/docs` 入口变轻，并保留 VS Code 插件事实源、runbooks、ontology、产品规格和历史计划。所有最小相关验证通过，本计划可归档。
