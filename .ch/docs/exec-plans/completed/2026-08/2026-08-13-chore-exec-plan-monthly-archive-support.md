# Exec plan 月份归档支持 — 维护与治理

- 日期：2026-08-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-13
- claim_ttl：1d
- handoff_to：
- 类型：chore
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-13-exec-plan-monthly-archive-support.md`

## 本类型目标

迁移既有 completed 到原月份，维护 completed 递归枚举与 task-board/workbench git 路径展示脚本；不改运行时或新增任务状态。

## 范围与所有权

- 迁移既有 completed 到原月份，维护 completed 递归枚举与 task-board/workbench git 路径展示脚本；不改运行时或新增任务状态。
- 本记录只承担 维护与治理；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 迁移既有 completed 到原月份，维护 completed 递归枚举与 task-board/workbench git 路径展示脚本；不改运行时或新增任务状态。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [2026-08-13-docs-exec-plan-monthly-archive-support.md](2026-08-13-docs-exec-plan-monthly-archive-support.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

目标系统 `.ch/docs/exec-plans/completed` 已按 `YYYY-MM/` 月份目录归档完成计划。当前仓库上一轮已把一份计划归档到 `completed/2026-08/`，但历史完成计划仍大量平铺在 `completed/` 根目录，部分 harness skill 和文档也仍默认只描述平铺目录或非递归读取。

### 目标

- 更新 harness skill 规则，使需要枚举 completed 历史计划时递归使用 `completed/**/*.md`；active 队列工具保持只看 active，但展示 git changed paths 时识别已迁移的月份路径。
- 迁移当前仓库已有平铺 completed 计划到对应月份目录，并更新可验证记录。

### 非目标

- 不修改插件运行时代码。
- 不重写历史执行计划正文中的叙述性旧路径，除非它们作为当前事实来源或可点击目标被直接引用。
- 不引入新的任务状态或计划元数据格式。

### 验收标准

- [x] `completed/` 根目录不再平铺历史执行计划 `.md` 文件，历史计划位于 `completed/YYYY-MM/`。
- [x] 执行计划 README 明确月份归档规则和递归扫描要求，scaffold 同步一致。
- [x] 最小相关测试、构建、ontology validate 和空白检查通过。

### 影响面

- 文档目录：`.ch/docs/exec-plans/`、`.ch/docs/ontology/`、`media/workspace-scaffold/.ch/docs/exec-plans/`
- Skill 脚本：task-board、work-frontier、memory-indexer、memory-consolidator、harness-workbench 及其 scaffold 镜像
- 运行时代码：无预期改动

### 风险与缓解

- 风险：移动大量历史计划会导致某些文档中的历史路径引用过期。
- 缓解：保持文件名不变，工具使用完整相对路径；当前事实来源引用如 ontology 需要同步更新，历史叙述中的旧路径不强改。
- 风险：脚本只读取 `completed/*.md` 时遗漏月份目录。
- 缓解：集中加入递归枚举 helper，并用现有构建/测试与脚本 smoke 覆盖。

### 验证计划

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- 相关 skill 脚本 smoke：task-board、work-frontier、memory-indexer、memory-consolidator、harness-workbench 可生成或解析成功
- `git diff --check`

### 测试与清单同步

- `npm run build`：通过。
- `node --test dist/test/workspaceScaffoldSkillPaths.test.js`：通过，2 项。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，根仓库 rules=7。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：通过，7 项。
- 在 `media/workspace-scaffold` 下执行 ontology validate / unittest：通过。
- `find .agents/skills media/workspace-scaffold/.agents/skills -name '*.py' -print0 | xargs -0 python3 -m py_compile`：通过。
- skill smoke：task-board、work-frontier、claim-release-auditor、memory-indexer、memory-consolidator 均可生成。
- `git diff --check`：通过。

### 决策记录

- 2026-08-13：历史 completed 计划从平铺目录迁移到 `completed/YYYY-MM/`，月份取文件名首段 `YYYY-MM`。
- 2026-08-13：不为 active 队列工具引入 completed 历史扫描；active plan、task-board 和 claim audit 仍只关注未归档计划，历史枚举规则由 `execution-plan` skill 和 exec-plans README 定义。
- 2026-08-13：删除旧的根级 `recall-pack.md`、`recall-summary.json`、`retrieval-debug.md` tracked 生成物；`memory-recall` 默认输出使用 ignored 的 `.local/`。

### 当前任务列表

- [x] 查询 ontology 并读取 execution-plan / codegraph 规则。
- [x] 执行验证并准备归档本计划。

## 分类依据与真实状态

chore：核心是治理归档迁移、脚本历史枚举适配及旧 recall 生成物清理，不是用户新功能；docs：README、skills、scaffold 规则明确实际更新。原文只运行既有 workspaceScaffoldSkillPaths/ontology 等测试，未记载测试开发，故不虚构 test。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
