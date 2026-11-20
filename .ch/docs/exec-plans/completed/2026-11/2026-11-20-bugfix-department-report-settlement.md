# 产研部组长汇报型子任务结算修复

- 日期：2026-11-20
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

本机任务记录中组长和调度器均完成，最终需求覆盖通过。组织门禁只接受 `reviewed`，把两个成功且已确认的 `reported` 验证任务判为失败。

## 范围与验收标准

- 成功且已确认汇报的免验收子任务可结算。未汇报、未完成、普通验收未通过及缺有效验收的修复链继续拦截。
- 在既有组织恢复成功、组长已无占用且完成证据齐备时，重判旧版误标的 `failed`。Owner 清理与占用核验继续独立执行。
- 总监收到准确的已完成组长状态。兄弟组仍在执行时部门仍在运行。

## 验证结果

- 新增回归在旧实现得到 `false`，复现误判。修复后 `npm run build` 通过。
- `node --test dist/test/extensionHost/{departmentcompletion,departmentruntimeintegration,departmentproductioncomposition,loopPlusOrchestration}.test.js dist/test/loop/loopPlusScheduler.test.js` 共 321 项通过。首轮集成测试夹具漏传 `maxConcurrency`，补齐后重跑通过。
- 本机只读回放确认旧记录组长任务 `completed`、组织 `failed`、Owner 集合 `closed`、组长容量已释放、其余两组 `running`。新结算规则对同一组长记录返回通过。
- Ontology 结构及 9 项单测通过。已安装宿主和历史对话维持现场，旧状态由新代码在既有组织恢复核验成功后重新结算。
