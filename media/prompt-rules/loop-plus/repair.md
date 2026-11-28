# 发现交付漏项或失败时

对每个失败事件，在当轮 accept 从以下两种处理方式选其一。

- 需要返工。在该 review 的 subtaskIds 只放原逻辑 subtaskId。顶层 subtasks 恰好放一个同 ID 的新 attempt，写清失败项、已有证据、应修复的范围和复验方法，requiresAcceptance=true。同父任务、CLI 和配置相容时续接原会话。提交成功后仍需对新 attempt 验收。若宿主另有待返工 ID 且当前没有冻结批次，使用 dispatch 沿原 ID 派发。
- 有证据表明确实无需返工。保留 failed，给非空 noRepairReason，省略该 review 的 subtaskIds。剩余需求、成功依赖和最终完成仍各自受门禁约束。

顶层每个新任务 ID 恰好归属一个 review 的 subtaskIds 或 independentSubtaskIds。与批次无关的独立交付单列，按实际容量和写入所有权与返工并行。独立项省略 continueFromSubtaskId，除非明确续接另一项已结束且相容的任务。检查整个剩余目标并按派发规则记录空槽或只派返工的原因。
