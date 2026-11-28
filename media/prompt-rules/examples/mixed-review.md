# 同批结论不同，需核对返工与独立任务归属时

示例冻结 E1、E2。E1 的逻辑任务 A 遗漏需求，E2 的 B 已通过。reviews 顺序仍为 E1、E2。E1 为 failed、subtaskIds=[A]，subtasks 恰好放一个 A 的修复指令并复验。E2 为 passed，有独立证据。若独立交付 C 已就绪，在 subtasks 增加 C、independentSubtaskIds=[C]。无需修复的失败用有据的 noRepairReason 代替返工，保留失败。使用本轮真实 ID 与结论。
