# 计划标题

- 日期：YYYY-MM-DD
- 类型：feature / bugfix / refactor / perf
- 关联计划：无 / `active/YYYY-MM-DD-<type>-<kebab-case-slug>.md`（填写具体路径及依赖）
- 状态：draft / in-progress / blocked / completed
- 负责人：Codex / 人类 / 协作
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

说明为什么要做这件事，以及相关计划的共同背景（如适用）。

## 目标

说明本计划独立交付目标。

## 范围

说明本类型计划的范围。

## 非目标

说明本计划明确不做的内容。

## 验收标准

- [ ]

## 影响面

- 代码目录：
- 文档目录：
- 配置与脚本：

## 风险与缓解

- 风险：
- 缓解：

## 验证计划

- 最小相关验证：
- 单元自测命令：
- 扩展验证：

## 测试与清单同步

- 单元测试新增/更新：
- 单元自测结果：
- 失败处理记录：
- 功能清单：
- 相关文档同步：

## 任务列表

- [ ]

## 当前状态与下一步

记录真实状态、已验证和未验证证据、阻塞和后续动作。

## 决策记录

- YYYY-MM-DD：记录关键决策

## 分类提示

文件名为 `YYYY-MM-DD-<type>-<kebab-case-slug>.md`，日期后仅一个 type；仅允许 feature、bugfix、refactor、perf，具体定义以 `.ch/docs/exec-plans/README.md` 为准。`bugfix` 仅修复已发布版本中的 bug。`test`、`chore`、`doc`（含 `docs`）任务不使用本模板，也不在本目录创建或归档计划。

多个允许类型的任务必须拆成独立计划，各自维护目标、范围、验收、验证和真实状态，并在关联计划填写具体互链路径及依赖；不复制混合正文。`test`、`chore`、`doc`（含 `docs`）不参与拆分；属于本计划交付范围的测试、维护和文档工作直接在本计划中记录，不另建计划，也不免除相应验证和文档同步要求。
