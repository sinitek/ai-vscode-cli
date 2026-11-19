# 产研部组长均衡分轮派工

- 日期：2026-11-19
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 目标与范围

总监按可独立验收的模块目标拆出内聚任务，以预计实现、验证工作量为准尽量均衡；每轮只派已就绪且适合并行的工作，依据组长汇报再派后续批次。工作范围只涉及总监提示词、可信协调上下文及其回归，不改变员工额度、组长准入、协议、Owner 清理或验收门禁。

## 验收与风险

- 总监提示明确内聚优先，不按任务条数或员工名额机械平分；首轮不用覆盖全部目标，已派发模块完成也不代表原始及补充要求覆盖。
- 组长槽位来自实际租约与在途预留，随结算更新而不计入历史已完成模块；这是提示快照，不代替宿主准入。
- 确定性回归验证只派当前批次，汇报后可派下一批并完成；不以夹具断言真实模型会如何估算工作量。
- 如需回滚，仅撤回派工提示与槽位投影，无状态迁移。

## 验证与文档

先运行 `npm run build`，再执行部门角色提示词、编排与组装相关单测；同步功能清单、设计文档及 ontology 并验证结构。

## 当前进展

已核对 CodeGraph、ontology、记忆召回（焦点：产研部 总监 组长 派工 Loop 续轮，无 anchor）及当前源码。完成总监提示词、实际组长可用名额上下文及两轮组装回归；`npm run build` 通过，`node --test dist/test/loop/department.test.js dist/test/extensionHost/departmentruntimecomposition.test.js dist/test/extensionHost/departmentproductioncomposition.test.js` 通过（102/102），ontology `--validate` 通过（183 rules），`git diff --check` 通过。未运行完整测试套件或原生 macOS/Windows EH 验证；本次仅改派工策略提示与只读提示上下文，不改变原生 Owner/准入执行实现。
