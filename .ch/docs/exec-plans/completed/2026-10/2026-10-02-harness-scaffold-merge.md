# harness scaffold 保留式升级

- 日期：2026-10-02
- 状态：completed
- 负责人：Codex / 人类协作
- owner：harness-scaffold-merge
- claimed_at：2026-10-02
- claim_ttl：本次会话

## 背景

当前仓库的 harness 已经积累了项目专属的 VS Code 插件规则、记忆索引、热区记忆、设计文档和执行计划；`media/workspace-scaffold` 提供了更新的通用治理入口。直接覆盖会丢失项目事实和历史上下文，因此需要做保留式合并。

## 目标

- 把 scaffold 中较新的 harness 路由、Ontology、计划、记忆与收尾规则合并到项目入口。
- 保留现有 `.ch/docs/memory/` 正文、`.ch/docs/exec-plans/` 历史计划、项目专属 skills、profiles、设计文档与运行事实。
- 为后续 scaffold 同步留下清晰的来源、边界和校验信息。

## 范围

- 根级 `AGENTS.md`、`ARCHITECTURE.md` 与 `.agents/skills/AGENTS.md` 的治理和导航入口。
- `.ch/docs/README.md`、`MEMORY.md`、`SECURITY.md`、`TESTING.md`、`TOOL_POLICY.md`、Ontology、产品规格模板、执行计划入口和 runbook 入口。
- 对 scaffold 专属的 `project-system` Ontology 占位域做边界说明；已有真实项目业务域时不复制该占位域。
- 更新 harness 同步清单，明确采用保留式合并。

## 非目标

- 不覆盖或清空现有 `.ch/docs/memory/` 热区正文。
- 不删除、重写或移动现有 active/completed 执行计划。
- 不删除项目专属 `.agents/skills/`、profiles、设计文档、references、generated 索引或产品能力事实。
- 不改变插件运行时、用户可见产品功能或技术栈。

## 验收标准

- [x] 根级规则包含 scaffold 的入口检查、Ontology 查询/校验、Tasklist、计划与记忆边界，同时保留项目专属硬约束。
- [x] 记忆规则同时保留当前仓库的 observation/claim/generated 索引约束，并补齐 scaffold 的跨会话、隐私与收尾规则。
- [x] 执行计划入口支持递归归档路径，并能说明本次计划与历史计划的保留关系。
- [x] 真实项目 Ontology 保持现有业务域，且明确不复制 scaffold `project-system` 占位域。
- [x] 未提交的 `.ch/docs/generated/memory-index/.local/` 文件保持原样。
- [x] 文档/结构校验和项目规定的最小构建验证有明确结果。

## 影响面

- 代码目录：无。
- 文档目录：根级 harness 入口、`.ch/docs/` 规则文档、Ontology、计划与同步清单。
- 配置与脚本：无运行时配置变更；复用现有 Ontology 校验和测试脚本。

## 风险与缓解

- 风险：模板文件覆盖项目事实或历史记忆。
  - 缓解：共享文件全部手工合并；只新增缺失文件，不执行目录级覆盖。
- 风险：生成索引被同步动作重建，污染用户未提交内容。
  - 缓解：不运行 memory-indexer；显式检查 `.local/` diff 仅保留进入任务前的原始修改。
- 风险：Ontology 域与现有项目事实来源不一致。
  - 缓解：先用 status report 和 source_refs 核对，再执行 `--validate`。

## 验证计划

- 最小相关验证：检查共享文件差异、现有计划/记忆路径、Ontology status 与 validate、Git diff 范围。
- 单元自测命令：`npm run build`；按 `.ch/docs/TESTING.md` 运行相关文档/共享测试（如有）。
- 扩展验证：确认 workspace scaffold 路径测试仍通过；确认未提交 `.local/` 变更未被改写。

## 测试与清单同步

- 单元测试新增/更新：无运行时逻辑变化；先复用现有 workspace scaffold 路径测试。
- 单元自测结果：`npm run build` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 通过（9/9）；`node --test dist/test/shared/workspaceScaffoldSkillPaths.test.js` 通过（3/3）；`node --test dist/test/interactive/codexRunnerRuntime.test.js` 通过（21/21）。
- 失败处理记录：组合运行 `clipagescriptruntimecoverage.test.js` 的相关断言均通过，但测试进程未释放句柄；使用 30 秒超时后以退出码 142 结束，归类为测试清理/环境问题，不修改无关代码。`.ch/docs/generated/memory-index/.local/` 未被改写。
- 功能清单：无需更新；本次只调整开发 harness，不改变插件用户可见能力。
- 相关文档同步：根级入口、`.ch/docs/` 事实来源、Ontology 与同步清单。

## 任务列表

- [completed] 对比当前 harness 与 `media/workspace-scaffold`
- [completed] 确定 merge + preserve 策略
- [completed] 合并治理规则、导航与缺失 Ontology 域
- [completed] 运行校验、构建并完成归档

## 决策记录

- 2026-10-02：采用手工 `merge`，不采用同名文件覆盖；保留现有记忆、执行计划和项目专属能力。
- 2026-10-02：使用 decision-model 评估同步策略，`merge` 与 `preserve` 均以 0.86 confidence 获得选择。

## 当前结论

已完成保留式合并。同步了通用治理规则、计划归档约定、产品规格模板、记忆保护边界、Ontology 维护入口和 harness 同步清单；保留现有 memory 热区、generated 索引、active/completed 计划、项目专属 skills/profiles 与真实业务 Ontology。验证通过：`npm run build`、Ontology `--validate`、Ontology 单测、workspace scaffold 结构测试、focused Codex runtime 测试和 whitespace 校验；Webview 回归断言通过但测试进程存在未释放句柄，已记录为环境/测试收尾问题。
