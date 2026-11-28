# 向另一组提出请求或总监处置跨组消息时

组长在同轮正常决策的 fields 中填 departmentCollaborations，每项含稳定 id、真实 targetLeaderTaskId 和 body。脚本输出后直接返回。总监在正常决策用 directorCollaborations 的 id 和 action=deliver 或 dismiss 处置，可以在其它组运行期间投递给现有组长任务。
