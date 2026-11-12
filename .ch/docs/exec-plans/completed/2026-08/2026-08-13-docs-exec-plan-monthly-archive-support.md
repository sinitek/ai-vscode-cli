# Exec plan 月份归档支持 — 文档

- 日期：2026-08-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-13
- claim_ttl：1d
- handoff_to：
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-13-exec-plan-monthly-archive-support.md`

## 本类型目标

更新 exec-plans README、execution-plan 等 skill 说明、scaffold 对应导航及 ontology 来源，明确 completed/YYYY-MM 与 completed/**/*.md；文档不承接脚本/历史文件迁移执行。

## 范围与所有权

- 更新 exec-plans README、execution-plan 等 skill 说明、scaffold 对应导航及 ontology 来源，明确 completed/YYYY-MM 与 completed/**/*.md；文档不承接脚本/历史文件迁移执行。
- 本记录只承担 文档；其它类型的实施、测试开发或文档编写归下列具体关联计划，不作为本计划的附带事项。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 更新 exec-plans README、execution-plan 等 skill 说明、scaffold 对应导航及 ontology 来源，明确 completed/YYYY-MM 与 completed/**/*.md；文档不承接脚本/历史文件迁移执行。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-08-13-chore-exec-plan-monthly-archive-support.md](2026-08-13-chore-exec-plan-monthly-archive-support.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 目标

- 将当前仓库执行计划规则调整为 `completed/YYYY-MM/` 月份归档。
- 同步 `media/workspace-scaffold` 的文档和 skill 骨架。

### 范围

- `.ch/docs/exec-plans/README.md`
- `.agents/skills/` 中涉及 active/completed 计划读取、展示或归档规则的脚本/说明
- `media/workspace-scaffold/` 对应 scaffold 文件
- 当前执行计划和必要的 ontology 文档

### 验收标准

- [x] `execution-plan` skill 明确历史 completed 枚举使用 `completed/**/*.md`；`task-board` / `harness-workbench` 展示迁移中的 git changed paths 时规范化为月份路径。

### 验证计划

- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`
- `npm run build`
- `node --test dist/test/workspaceScaffoldSkillPaths.test.js`

### 测试与清单同步

- 功能清单：本次只调整开发 harness、执行计划归档与 scaffold，不改变插件用户可见产品能力；无需更新功能清单语义，只修正已有事实来源路径。

### 当前任务列表

- [x] 对比目标系统 exec-plans README 与当前规则差异。

## 分类依据与真实状态

chore：核心是治理归档迁移、脚本历史枚举适配及旧 recall 生成物清理，不是用户新功能；docs：README、skills、scaffold 规则明确实际更新。原文只运行既有 workspaceScaffoldSkillPaths/ontology 等测试，未记载测试开发，故不虚构 test。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。
