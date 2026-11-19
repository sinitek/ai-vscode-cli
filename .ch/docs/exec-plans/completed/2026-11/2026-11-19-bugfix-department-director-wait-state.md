# 产研部总监等待状态与阻塞诊断修复

- 日期：2026-11-19
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex（本次执行）；主任务负责验收

## 背景与目标

本机 2026-11-19 日志对应的总监决策把“组长仍在运行，等待汇报”输出为 `status=blocked`，因为总监提示词直接要求等待汇报使用 blocked。另有基础组发生 `DEPARTMENT_NATIVE_UNKNOWN`，表示真实 Owner generation 不可确认；现有生命周期日志只记录 `unexpected-failure`，不足以判断根因。需将正常等待与真实阻塞分开，保留未知 Owner 的 fail-closed 行为，并安全记录可诊断错误码。

## 范围与非目标

- 为总监增加 `waiting` 决策，仅有仍运行/启动中的组长时接受并等待真实结算唤醒。
- `blocked` 不再用于等待汇报；有结构化 blocker 时将总监根转为 `needs-review`，保留组长及其容量所有权。
- 生命周期日志只增加白名单格式的错误码，不记录错误正文、路径、会话或凭据。
- 不自动重试、接管、释放或重建 `DEPARTMENT_NATIVE_UNKNOWN` 对应的 Owner/容量；不更改用户本地任务数据。

## 验收标准

- [x] 总监提示词明确 `waiting` 和 `blocked` 的不同语义。
- [x] 有运行组长时 `waiting` 不派发重复任务，根保持运行并等待原汇报唤醒。
- [x] 无运行组长时拒绝无依据的 `waiting` 并暂停复核；有效 `blocked` 保存为 `needs-review`。
- [x] 缺失 Owner generation 仍保留原租约和安全门禁，诊断日志可显示安全错误码且不泄漏异常正文。
- [x] 普通 Loop 不会把 `waiting` 当作可继续派发的决策。

## 影响面与风险

- 代码：Loop 主任务决策解析/状态机、产研部总监 composition、产研部生命周期诊断。
- 文档：功能清单、部门设计事实来源、Ontology。
- 风险：历史决策协议没有 `waiting`；兼容期继续接受旧的无 blocker blocked 决策，但新的提示词只在确有运行组长时输出 waiting。未知原生状态必须继续 fail-closed。

## 验证计划

- 最小验证：`npm run build`；运行 Loop 主任务解析、产研部 composition 与生命周期诊断相关编译测试。
- Ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 及 ontology 单测。
- 未覆盖真实 CLI Owner 恢复；不能据此声称本机旧任务已恢复。

## 测试与清单同步

- 单元测试：覆盖 `waiting` 解析、部门活跃组长等待/真实 blocked 暂停、错误码白名单与敏感异常文本不落日志。
- 功能清单：同步总监等待/阻塞语义。
- 当前本机日志的证据边界：`department-producer-no-live-generation` 为原生执行代次缺失的真实暂停信号；历史通用日志未保留底层错误码，源码修复只改善后续可观测性，不追溯或篡改旧日志。

## 当前结论

已核对日志、持久化运行快照和总监原始对话。实现、回归用例及文档同步已完成；在 Owner generation 缺失时不做自动恢复或容量释放。

## 验证结果

- `npm run build`：通过。
- Loop+ 决策、运行集成、决策解析、状态机及生命周期诊断相关单测：`117/117` 通过；普通 Loop 不把 `waiting` 作为可派发决策的回归用例：`1/1` 通过。
- Ontology 校验：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；Ontology 单测：`9/9` 通过。
- `git diff --check`：通过。
- 扩展组合测试仍有 `1/137` 失败：既有状态机摘要断言期待“未提供具体阻塞原因”，当前摘要输出“主模型未提供具体熔断原因、依据和未完成事项”。该断言与本次等待/阻塞状态转换无关，本次未修改。
- 未验证真实 CLI Owner 恢复、已安装扩展及其他平台；不能据此声称本机旧任务已恢复。
