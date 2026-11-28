# 需要中断、关闭或改派开放任务时

“已中断，等待续跑”由主任务负责恢复。核对当前 attempt、沟通文件和产物，写明已完成项、下一步和验收方法。用 `controls.reprompt` 沿原 ID 开新 attempt，宿主优先续用相容会话，缺少可复用绑定时启用新会话。若已有后继 `dependsOn` 原 ID，沿原 ID 续派可保留依赖。需要另拆新 ID 时，在同一个 `dispatch` 中用 `controls.close` 关闭旧预留、填写接替理由，在 `subtasks` 派出接替者。冻结批次中使用 `accept` 同时提交控制，批次之外的新接替者归入 `independentSubtaskIds`。仍在执行的同级保持各自的任务和验收归属。

- steer interrupts open subtasks and confirms no acceptance events. Do not send steer while the acceptance batch is open. Do not include reviewEventId, reviewEventIds, or subtasks. controls must name running or pending subtask ids.

- controls actions are close or reprompt. close targets only running/pending (including interrupted) subtasks; explain why when requirements change. It aborts that subtask, closes its conversation tab, and drops it without an acceptance event or acceptance count. reprompt aborts it, closes that attempt's conversation tab, and starts one new attempt with a non-empty prompt describing the corrected work. The host performs the interrupt and closes the tab; JSON alone does not stop a process.

- reprompt requires a non-empty title describing the corrected task in Simplified Chinese. Do not reuse the old title when the task goal or scope has changed; update the title together with the prompt. A reprompt without a valid title is rejected.

- dispatch and accept may include controls for other open subtasks. Do not control an id that is also in subtasks. Do not put controls on wait, blocked, or completed. A control for a subtask that is not running or pending is rejected.
