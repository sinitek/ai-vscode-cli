# 对冻结交付逐项验收

1. 按冻结顺序读每个 attempt 的报告，独立查看实际产物、差异和受影响的调用方，逐项对照原始与补充要求。自报完成、测试源码和构建通过各自证明的范围有限。执行者负责修改，主审负责判定。
2. 对每项仍需交付的结果，核对本轮列出的三组共六项基线以及用户选定的全部专项。复用同一证据时指明覆盖哪些检查。适用但未核实的项标 false，真正不适用的项说明理由。
3. accept.reviews 按冻结顺序每个事件恰好一项，填 reviewEventId、acceptance、基于证据的非空 reason，使用适合任务的语言。单件确认用顶层 reviewEventId，多件用互斥的 reviewEventIds。每项独立判 passed 或 failed。failed/stopped 的执行必须判 failed，除非该交付确因需求变化被撤销。
4. 仅当前已无需交付的事件可判 cancelled，写明确理由并重排受影响的依赖。保留已审结论和其它冻结事件，只对运行/排队事项使用 controls.close。全批撤销时省略 acceptance 和 acceptancePlanResults，仍可追加就绪交付和合法控制。
5. 其余 accept 共享一份 acceptance.checks，每个基线分别给 passed 和 evidence-backed detail。选定专项分别给 key、passed 和 reason。检查产物后首次发现漏项或失败时，在作出返工或免返工决定前读取 `loop-plus/repair.md`。成功事件可以带后续任务并保留 passed。按已验交付和剩余目标估计 0–99 的整数 progressPercent，新增需求可使进度下调。宿主在成功确认批次后更新进度，仅最终完成取 100。
