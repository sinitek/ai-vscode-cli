# Exec plan 月份归档支持

- 日期：2026-08-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-13
- claim_ttl：1d
- handoff_to：

## 背景

目标系统 `.ch/docs/exec-plans/completed` 已按 `YYYY-MM/` 月份目录归档完成计划。当前仓库上一轮已把一份计划归档到 `completed/2026-08/`，但历史完成计划仍大量平铺在 `completed/` 根目录，部分 harness skill 和文档也仍默认只描述平铺目录或非递归读取。

## 目标

- 将当前仓库执行计划规则调整为 `completed/YYYY-MM/` 月份归档。
- 更新 harness skill 规则，使需要枚举 completed 历史计划时递归使用 `completed/**/*.md`；active 队列工具保持只看 active，但展示 git changed paths 时识别已迁移的月份路径。
- 同步 `media/workspace-scaffold` 的文档和 skill 骨架。
- 迁移当前仓库已有平铺 completed 计划到对应月份目录，并更新可验证记录。

## 范围

- `.ch/docs/exec-plans/README.md`
- `.agents/skills/` 中涉及 active/completed 计划读取、展示或归档规则的脚本/说明
- `media/workspace-scaffold/` 对应 scaffold 文件
- 当前执行计划和必要的 ontology 文档

## 非目标

- 不修改插件运行时代码。
- 不重写历史执行计划正文中的叙述性旧路径，除非它们作为当前事实来源或可点击目标被直接引用。
- 不引入新的任务状态或计划元数据格式。

## 验收标准

- [x] `completed/` 根目录不再平铺历史执行计划 `.md` 文件，历史计划位于 `completed/YYYY-MM/`。
- [x] 执行计划 README 明确月份归档规则和递归扫描要求，scaffold 同步一致。
- [x] `execution-plan` skill 明确历史 completed 枚举使用 `completed/**/*.md`；`task-board` / `harness-workbench` 展示迁移中的 git changed paths 时规范化为月份路径。
- [x] 最小相关测试、构建、ontology validate 和空白检查通过。

## 影响面

- 文档目录：`.ch/docs/exec-plans/`、`.ch/docs/ontology/`、`media/workspace-scaffold/.ch/docs/exec-plans/`
- Skill 脚本：task-board、work-frontier、memory-indexer、memory-consolidator、harness-workbench 及其 scaffold 镜像
- 运行时代码：无预期改动

## 风险与缓解

- 风险：移动大量历史计划会导致某些文档中的历史路径引用过期。
- 缓解：保持文件名不变，工具使用完整相对路径；当前事实来源引用如 ontology 需要同步更新，历史叙述中的旧路径不强改。
- 风险：脚本只读取 `completed/*.md` 时遗漏月份目录。
- 缓解：集中加入递归枚举 helper，并用现有构建/测试与脚本 smoke 覆盖。

## 验证计划

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`
- `npm run build`
- `node --test dist/test/workspaceScaffoldSkillPaths.test.js`
- 相关 skill 脚本 smoke：task-board、work-frontier、memory-indexer、memory-consolidator、harness-workbench 可生成或解析成功
- `git diff --check`

## 测试与清单同步

- `npm run build`：通过。
- `node --test dist/test/workspaceScaffoldSkillPaths.test.js`：通过，2 项。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，根仓库 rules=7。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：通过，7 项。
- 在 `media/workspace-scaffold` 下执行 ontology validate / unittest：通过。
- `find .agents/skills media/workspace-scaffold/.agents/skills -name '*.py' -print0 | xargs -0 python3 -m py_compile`：通过。
- skill smoke：task-board、work-frontier、claim-release-auditor、memory-indexer、memory-consolidator 均可生成。
- `git diff --check`：通过。
- 功能清单：本次只调整开发 harness、执行计划归档与 scaffold，不改变插件用户可见产品能力；无需更新功能清单语义，只修正已有事实来源路径。

## 决策记录

- 2026-08-13：历史 completed 计划从平铺目录迁移到 `completed/YYYY-MM/`，月份取文件名首段 `YYYY-MM`。
- 2026-08-13：不为 active 队列工具引入 completed 历史扫描；active plan、task-board 和 claim audit 仍只关注未归档计划，历史枚举规则由 `execution-plan` skill 和 exec-plans README 定义。
- 2026-08-13：删除旧的根级 `recall-pack.md`、`recall-summary.json`、`retrieval-debug.md` tracked 生成物；`memory-recall` 默认输出使用 ignored 的 `.local/`。

## 当前任务列表

- [x] 查询 ontology 并读取 execution-plan / codegraph 规则。
- [x] 对比目标系统 exec-plans README 与当前规则差异。
- [x] 更新月份归档规则、迁移历史 completed 计划并同步 scaffold。
- [x] 更新相关 skill 规则和路径展示逻辑。
- [x] 执行验证并准备归档本计划。
