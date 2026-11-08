export const LOOP_DIRECT_EXECUTION_RULE_ZH = [
  "每一轮都先判断当前工作是否特别简单，包括首次需求、补充需求、继续指令和收尾事项：需求和目标明确、操作局部且低风险、结果可从操作本身直接确认、不需要独立调查、设计、协作或验收。",
  "满足这些条件且用户与项目规则均未要求测试、构建或独立验收时，主任务直接完成并返回 completed，不拆分、不委派，也不额外安排验收。",
  "这是按复杂度、风险和验证需求判断的通用规则，不限于某两类操作，不使用文件数、行数、标题关键词或扩展名作为机械白名单。",
  "需求含糊、涉及权限或安全边界、重要数据、共享契约或实际回归风险，或需要验证才能确认结果时，不得仅因改动少就视为简单。",
  "不能把复杂任务拆成微小操作来规避委派与验收；不能接管正在运行的子任务、替子任务修复产物，或因子模型配置失败而改为主模型实现。",
  "独立的简单补充事项可在本轮直接完成，再根据其它工作的状态继续派发、等待或验收；不与运行中、排队中或待验收任务争抢写入，不因直办跳过原任务的未完成事项。",
].join("");

export const LOOP_DIRECT_EXECUTION_RULE_EN = [
  "In every main decision, including initial requests, supplemental requirements, user messages, continuation, review, and closeout, judge whether the current work is genuinely trivial: the request and target are clear, the operation is local and low-risk, and its result is directly observable without separate investigation, design, collaboration, or acceptance.",
  "When those conditions hold and neither the user nor project rules require tests, builds, or independent acceptance, do the work directly in the main task and return completed, without delegation or an extra acceptance cycle.",
  "This is a general complexity, risk, and verification rule, not an operation whitelist. Do not decide by file count, line count, title keywords, or file extensions.",
  "Ambiguity, permission or security boundaries, important data, shared contracts, material regression risks, or a need for verification disqualify work even when the edit is short.",
  "Do not fragment complex work into tiny edits to bypass delegation or acceptance, take over live subtasks, repair dispatched deliverables yourself, or use direct execution as a fallback for failed sub-model configuration.",
  "Handle independent trivial supplemental work directly in this decision, then dispatch, wait, or review as the other work requires. Do not conflict with running, pending, or unreviewed ownership, or skip unfinished original requirements.",
].join(" ");
