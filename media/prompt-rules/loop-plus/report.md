# 读取免验收报告和确认冻结前缀时

逐个读冻结 FIFO 前缀里每个 attempt 的 communicationFile，评估对剩余工作的影响，按原序返回 reportEventIds。回执仅确认已读。clarify 保留报告到恢复调度。纯报告回合只回 wait 和完整前缀，即使没有运行任务。原验收批次与晚到报告留待后续决策。
