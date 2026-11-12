# CLI 原生压缩与上下文用量适配 — 文档与事实源交付

- 日期：2026-11-10
- 状态：completed
- 类型：docs
- 负责人：Loop+ 四个交付边界协作
- owner：各实现边界独立交付；主审已完成 Kimi 修复后的串行构建与相关复验，文档边界归档仓库实施计划；宿主父任务最终状态仍由主模型验收决定
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-10-cli-compaction-context-adaptation.md`

## 目标与范围

公共功能清单、CLI独立参考、Kimi指引/导航与三条ontology及状态一致性收尾。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-10-feature-cli-compaction-context-adaptation.md](2026-11-10-feature-cli-compaction-context-adaptation.md)：承接产品实现及其决策/约束。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。

## 验收标准

- 完成以下实际文档交付：公共功能清单、CLI独立参考、Kimi指引/导航与三条ontology及状态一致性收尾；记录与实现、测试证据一致，不把文档门禁当作功能或真实环境验收。
- Kimi收尾身份/中文提示是在新能力交付内的实现修正，不凭措辞补造发布bugfix；Node升级属独立交付非本计划chore；145/481/509阶段、7基线失败和OpenCode停顿/未实现即时刷新保留。

## 验证与真实状态

验证计划：复用原文档/ontology/引用/空白检查记录；没有原文成功证据的检查不补造。原计划记录的 ontology 校验及范围空白/差异检查通过；独立测试开发已移除，其审计保留的历史测试摘要、结果与边界见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-10-cli-compaction-context-adaptation.md）。功能/页面行为历史验证按关联计划中的存活实现记录追溯；本 docs 计划及删除审计均不构成现行 test 验证入口。本次不重新执行。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 验证计划

- ontology JSON 验证、修改文件 whitespace 检查。常规 build 和 Extension Development Host 点击由父任务串行验收。

### 任务与当前结论

- [x] 公共功能条目、CLI 契约、参考导航及 ontology 来源登记。
- [x] Kimi 收尾身份防护及中文提示修复后的主审复验、公共状态同步与仓库实施计划归档。

### 最终主审复验与能力边界（2026-11-10）

- `ontology-validate.log`、`ontology-tests.log`、`doc-reference-check.log`、`git-diff-check.log` 分别记录 validate、9项 Python 单测、前轮52处精确大小写引用及差异检查通过。前轮引用检查日志的“仍待 Kimi/最终复验”是当时文档断言，现由本节更新，并不篡改原日志。
- 文档/ontology 已承接可复用契约，历史过程留在本归档；按 MEMORY 规则无需再扩写热区或新增重复记忆。真实环境验证及压缩后可信测量属于明确后续增强/验收条件，不包装为本轮已覆盖。

### 收尾文档验证与清单同步（2026-11-10）

- 影响面：本轮仅归档本计划，更新公共功能清单、CLI/独立参考、用户 Kimi 指引、导航和 ontology；无实现、测试、依赖、环境或调度状态改动。Claude 独立参考因旧具体归档路径及过期状态做最小同步。
- 单元测试变化：文档收尾未新增或修改测试；复用现有 ontology 单测及当前 dist 文档契约产物，不执行构建、不清理共享 dist。
- 实际命令：`python3 .agents/skills/ontology/scripts/search_ontology.py --status-report`、关键词 search、Kimi 稳定 ID 查询及 `--validate` 均通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9项通过；`NODE_PATH="$PWD/node_modules" node --test dist/test/config/kimiCodeDocContract.test.js` 11项通过。
- 独立临时检查脚本 `/tmp/cli-context-closeout.sMWMaW/check_docs.py` 检查10份目标文档、43处精确大小写引用、Markdown 围栏/链接/功能表格、尾随空白、稳定 ID、历史失败保留和旧具体路径清零，结果通过；`git diff --check` 通过。本轮日志位于 `/tmp/cli-context-closeout.sMWMaW/`，不是再次运行509项或真实 CLI 的证据。
- 功能清单、能力分册与 ontology 当前状态已从“待修复/复验”更新为主审已复验；原审计不改，历史阶段失败留档。无新增可复用知识需要扩写 memory 热区，稳定契约继续以独立参考及 ontology 为准。

### 文档收尾状态一致性修订（2026-11-10）

- 修正 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 的“CLI 当前上下文与压缩入口”：删除仍将 Kimi 身份防护、中文提示修复及最终复验记为待完成的过期当前结论，改为已归档计划与已复验状态；481项及当时待修复/复验结论仅作为下方明确标记的历史阶段证据保留。
- 当前依据仍为主审 `/tmp/loopplus-final-review.ENB7ol` 的标准构建及448+61共509项相关回归，不冒称本次重跑，也不等同全仓测试、付费模型或真实宿主端到端验收。统一消息、用量口径、窗口来源、隔离行为及原始审计不变。
- 明确保留 OpenCode 无可信压缩后新测量时等待下一主回合、即时刷新未实现等限制。真实 run 探针未产出步骤、模拟桥非真实宿主点击、Windows及真实模型摘要质量未验证，Node仅新登录 shell 默认切换等既有边界不变。本次仅修订仓库文档，不改变宿主父任务状态。
- 新增临时只读语义断言提取目标章节至下一同级标题，修改前准确检出过期 Kimi/最终复验结论，修改后通过；3个过期状态拒绝样例、2个合法历史/限制样例通过，避免把 OpenCode 即时刷新未实现等真实限制误判为过期状态。
- 本次实际验证：ontology status/search/稳定ID查询与 validate 通过，既有本体单测9项、当前 dist 文档契约11项通过；两份修订文档的 Markdown/表格/空白、42处精确大小写引用、历史证据原样保留、Node边界及统一消息检查通过，`git diff --check` 通过。日志及只读脚本位于 `/tmp/cli-context-consistency.1zOYyF/`；未构建、未清理共享 dist、未重跑509项或真实 CLI。

### 公共契约登记验证（2026-11-10，历史阶段证据）

- 本轮只编辑公共文档、独立参考和 ontology，不修改运行时、UI、依赖或系统环境。新增 Claude / OpenCode / 面板契约三条规则并保留已有稳定 ID（包括 Kimi 历史 ID）。
- ontology status/search（含新规则 ID 查询）可用，validate 通过，既有 Python 单元测试9项通过；现有 `dist/test/config/kimiCodeDocContract.test.js` 文档契约11项通过，没有重新构建或清理共享 dist。
- 8个目标文件的 Markdown 基础结构、新表格与尾随空白检查通过；52个新增或变更行中的仓库引用及新 source_refs 通过精确大小写存在性检查；共享仓库 `git diff --check` 通过。预扫描中的历史删除路径、原有大小写引用及图片语法示例不作为新增坏链修复。
- 本轮验证日志与检查脚本：`/tmp/cli-context-public-check.siCRz2/`。这是文档/登记的局部检查，不追加声称运行时全量验收或压缩后刷新完成；Kimi 修复和父任务最终复验仍待处理。

### 关键接线与兼容性

- ontology 的历史稳定 ID `plugin.rule.kimi_no_native_compaction` 保留，名称与规则正文已改为原生命令压缩；历史审计文件原样保留。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。Kimi收尾身份/中文提示是在新能力交付内的实现修正，不凭措辞补造发布bugfix；Node升级属独立交付非本计划chore；145/481/509阶段、7基线失败和OpenCode停顿/未实现即时刷新保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
