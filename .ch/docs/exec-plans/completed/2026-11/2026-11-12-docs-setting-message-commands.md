# 设置消息分派事实来源同步

- 日期：2026-11-12
- 类型：docs
- 状态：completed
- 负责人：Loop+ fullstack coding attempt
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-12-refactor-setting-message-commands.md` 提供实际生产边界；`.ch/docs/exec-plans/completed/2026-11/2026-11-12-test-setting-message-contracts.md` 提供公开入口回归，本计划只引用不编辑，其归档状态独立维护。

## 背景与目标

将本轮实际落地的 Command + Facade 依赖方向、扩展方式与兼容契约写入稳定事实来源，而不是只留在执行报告。

## 范围与非目标

- 范围：`ARCHITECTURE.md`、设计文档和必要导航、`cli-plugin-runtime.json` 实现来源。
- 非目标：用户功能规格变更、无关历史文档整理、旧 Loop 模型路由 blocked 状态或真实验收门禁改判。

## 验收标准

- [x] 文档准确反映新模块、最小依赖、按调用快照和匹配/刷新/异常契约。
- [x] 说明新增命令方式、选择理由和未重构其它候选的原因。
- [x] ontology 保留稳定 ID，仅更新日期与实现来源；校验通过，归档引用同步。

## 影响面与风险

- 文档与语义导航，不改变运行逻辑。
- 风险：文档先于实现导致漂移；缓解：实现后对照源码，归档前检查本地路径。
- 回滚：仅撤回本次新增设计与导航条目，不覆盖并发文档。

## 验证计划

- ontology 查询、`search_ontology.py --validate` 及 ontology 脚本单测。
- 文档相对路径存在性、计划归档引用、改动范围空白检查。
- 运行时证据引用 refactor 计划，不将文档校验冒充真实 CLI/UI 验证。

## 测试与清单同步

- 不新增测试代码；文档流程校验与生产契约测试职责分离。
- 功能清单不改：纯内部重构，用户能力与配置格式不变。
- 不写 ROLLING_SUMMARY，也不创建重复记忆事实源。

## 当前进展

- 已确认现有架构与 ontology 来源；设计 index 在当前工作树缺失，新增最小导航而非重整目录。
- 新设计与架构导航反映实际接线；ontology 只同步 extension_host、history_retention_settings、DSH/通知/隐藏指令气泡规则的实现来源，概念、规则、关系和稳定 ID 不变。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（2 domains、17 concepts、16 relations、129 rules、2 workflows、3 documents）。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 通过；没有运行失败需分类。
- 生产构建与七个相关套件结果由关联 refactor 计划记录，不以文档校验替代真实 CLI/UI 验证。
- 归档后对本轮文档导航/计划引用做存在性检查，并对本轮文件做空白检查；命令与最终证据在 attempt report。
- 不修改功能清单、热区记忆或旧计划；关联 test 计划已独立归档，本计划与 refactor 计划中的对应引用均已同步为真实归档路径。
