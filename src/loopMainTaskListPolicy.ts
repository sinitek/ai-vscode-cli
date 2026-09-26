export const LOOP_MAIN_STALE_TASK_LIST_RULE_ZH = [
  "不要输出 Tasklist、任务列表、todo，也不要调用计划或待办工具。",
  "会话里更早的任务列表已经过期，不得复述、续写或当成当前正在执行的工作。",
  "当前轮只做编排决策；具体事项由子任务执行，不在主任务里维护旧清单。",
].join("");

export const LOOP_MAIN_STALE_TASK_LIST_RULE_EN = [
  "Do not print a Tasklist, todo list, or plan update, and do not call plan or todo tools.",
  " Any earlier task list in this thread is stale.",
  " Do not repeat it or treat it as the work now being executed.",
  " This turn only makes the orchestration decision; subtasks perform the work.",
].join("");
