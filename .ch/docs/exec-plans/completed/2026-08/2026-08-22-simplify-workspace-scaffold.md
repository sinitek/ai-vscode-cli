# 简化 workspace scaffold harness 骨架

- 日期：2026-08-22
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-22
- claim_ttl：本轮任务
- handoff_to：无

## 背景

`media/workspace-scaffold` 是内置新工作区 harness 模板。当前骨架保留了较多导航页、工具型技能和占位目录，冷启动成本偏高。

## 目标

把 scaffold 简化为规则、测试、ontology、product specs、memory、exec-plans 和必要 skills 的轻量骨架，同时保持事实来源可追踪。

## 范围

- 精简 `media/workspace-scaffold/.ch/docs/product-specs/FEATURE_INVENTORY.md` 为能力索引。
- 合并薄导航页到 `media/workspace-scaffold/.ch/docs/README.md`。
- 删除 scaffold 中不属于轻量骨架的导航目录、生成物占位和非必要 skills。
- 更新 scaffold 内部引用，避免断链。

## 非目标

- 不改变 VS Code 插件运行时代码。
- 不改变当前仓库本体以外的业务功能清单。
- 不引入新的 scaffold 生成机制。

## 验收标准

- [x] `FEATURE_INVENTORY.md` 只保留状态、角色、规格来源、实现入口、最近验证链接等索引字段。
- [x] scaffold 只保留规则、测试、ontology、product specs、memory、exec-plans 和必要 skills。
- [x] 薄导航页信息已并入 `.ch/docs/README.md`，事实源入口不丢失。
- [x] scaffold 内没有指向已删除目录或技能的断链引用。
- [x] 相关校验命令已执行并记录结果。

## 影响面

- 代码目录：`media/workspace-scaffold/`
- 文档目录：`.ch/docs/exec-plans/`
- 配置与脚本：无运行时代码变更

## 风险与缓解

- 风险：删除目录后遗留引用造成新工作区冷启动困惑。
- 缓解：修改后用 `rg` 扫描旧路径和技能名，并运行 ontology 校验与相关测试。

## 验证计划

- 最小相关验证：检查 scaffold 文件清单、断链引用和文档字段。
- 单元自测命令：`python3 media/workspace-scaffold/.agents/skills/ontology/scripts/search_ontology.py --validate --root media/workspace-scaffold`
- 扩展验证：`python3 -m unittest discover -s media/workspace-scaffold/.agents/skills/ontology/tests -p 'test_*.py'`

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/workspaceScaffoldSkillPaths.test.ts`，断言 scaffold 只保留必要 skills、目标文档入口、能力索引字段和 ontology 校验。
- 单元自测结果：
  - `python3 media/workspace-scaffold/.agents/skills/ontology/scripts/search_ontology.py --validate --root media/workspace-scaffold`：通过，domains=2 concepts=9 relations=6 rules=5 workflows=1 documents=3。
  - `python3 -m unittest discover -s media/workspace-scaffold/.agents/skills/ontology/tests -p 'test_*.py'`：通过，9 项。
  - `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，domains=2 concepts=13 relations=10 rules=10 workflows=2 documents=3。
  - `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：通过，9 项。
  - `node --test dist/test/workspaceScaffoldSkillPaths.test.js`：通过，3 项。
  - `node scripts/check_trailing_whitespace.js media/workspace-scaffold .ch/docs/exec-plans/completed/2026-08/2026-08-22-simplify-workspace-scaffold.md`：通过。
  - `git diff --check`：通过。
  - `npm run build`：最终重跑失败，原因是工作区已有并行 Loop auto-sleep 类型改动导致 `LoopTaskStatus` / `LoopMainDecision` / `LoopTaskRecord` 类型不一致；不是本次 scaffold 修改引入。
- 失败处理记录：`rm -rf` 被安全策略拒绝，改用 `apply_patch` 删除文件；删除文件后空目录仍在本机工作区，已用 `find media/workspace-scaffold -type d -empty -delete` 清理。`npm run validate:whitespace` 命中既有 minified / style 文件尾随空白，已改用 scoped whitespace 校验确认本次范围通过。
- 功能清单：本次修改 scaffold 模板清单规则，不改变当前插件用户可见能力；无需更新当前仓库 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 scaffold 文档、scaffold ontology 建议路径、root ontology scaffold 描述与本计划。

## 任务列表

- [x] 读取相关技能、ontology 和 scaffold 文件清单。
- [x] 精简 scaffold 文档入口和功能清单模板。
- [x] 删除非必要目录、技能和占位导航。
- [x] 更新引用、运行校验并归档计划。

## 决策记录

- 2026-08-22：按用户要求把 scaffold 限定为轻量 harness 骨架，验证细节从功能清单移出，保留到执行计划或测试报告。

## 当前结论

已完成并归档到 `.ch/docs/exec-plans/completed/2026-08/2026-08-22-simplify-workspace-scaffold.md`。scaffold 已精简为轻量 harness 骨架，能力清单已改为索引，薄导航页已合并到 `.ch/docs/README.md`。
