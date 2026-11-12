# 计划标题

- 日期：YYYY-MM-DD
- 类型：feature / bugfix / refactor / chore / docs / test / perf
- 关联计划：无 / `.ch/docs/exec-plans/active/YYYY-MM-DD-<type>-<kebab-case-slug>.md`（填写具体路径及依赖）
- 状态：draft / in-progress / blocked / completed
- 负责人：Codex / 人类 / 协作
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

说明为什么要做这件事。

## 目标

说明本次交付目标。

## 范围

说明本次覆盖内容。

## 非目标

说明本次明确不做的内容。

## 验收标准

- [ ] 标准 1
- [ ] 标准 2

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

- [ ] 步骤 1
- [ ] 步骤 2
- [ ] 步骤 3

## 决策记录

- YYYY-MM-DD：记录关键决策

## 当前结论

总结当前进展、未决问题、下一步。

## 分类与拆分提示

- 文件名：`YYYY-MM-DD-<type>-<kebab-case-slug>.md`；日期后只能有一个 type。允许类型及定义以 `.ch/docs/exec-plans/README.md` 为准。
- `feature` 表示新功能，`bugfix` 表示已发布版本 bug 修复；不得缩写为 `feat` / `fix`。
- 多个实质类型必须拆成独立计划，各自维护目标、范围、验收、验证和真实状态；在“关联计划”中填写具体互链路径并记录共同背景/依赖，不复制混合正文。
- 仅记录验证证据不等于测试开发；实际测试开发工作应单独归为 `test`。
