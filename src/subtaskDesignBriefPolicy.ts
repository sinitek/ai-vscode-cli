export const SUBTASK_DESIGN_KEY_POINT_RULE_ZH = [
  "子任务是单独新会话，看不到主任务的规划推理。",
  "派发时禁止只给粗粒度目标。",
  "subtasks[*].prompt 除背景目标、范围、步骤和验收外，只要存在高难度或非显而易见的设计关键点，就必须写成可执行约束：架构约束、不变量、兼容口径、数据契约、边界条件、失败模式，以及必须沿用的既有实现。",
  "不要只写“注意设计”或“自行判断”，也不要指望子任务重新发现这些决策。",
  "没有这类关键点时不要编造。",
  "涉及 UI 美化、布局或交互时，主模型必须先把可执行界面设计写进 prompt：信息层级、布局结构、间距与对齐、关键状态（默认、悬停、禁用、空、错误、加载）和交互路径，并要求子任务沿用现有主题语义、按该设计实现，不得自行改配色、间距、组件结构或交互。",
  "非这类任务不要编造界面设计。",
].join("");

export const SUBTASK_DESIGN_KEY_POINT_RULE_EN = [
  "A subtask is a fresh session and cannot see the parent planning.",
  "Do not assign only a coarse goal.",
  "Besides its goal, write scope, steps, and verification, the prompt must include every high-difficulty or non-obvious design key point as an executable constraint: architecture constraints, invariants, compatibility rules, data contracts, edge cases, failure modes, and existing implementation it must preserve.",
  "Do not write only \"be careful with the design\" or \"use your judgment\", and do not expect the subtask to rediscover the decision.",
  "Do not invent key points that do not exist.",
  "When the task changes UI appearance, layout, or interaction, the parent must first write the executable UI design into the prompt: information hierarchy, layout structure, spacing and alignment, key states (default, hover, disabled, empty, error, loading), and the interaction path.",
  "Require the subtask to reuse existing theme semantics and implement that design without changing color, spacing, component structure, or interaction.",
  "Do not invent a UI design for non-UI work.",
].join(" ");

export const GRAPH_NODE_DESIGN_BRIEF_RULE_ZH = [
  "每个执行节点的 instructions 是子节点唯一能看到的任务说明，新会话看不到规划推理。",
  "禁止只留标题式粗任务。",
  "instructions 必须写清要做什么、边界和完成标准；只要存在高难度或非显而易见的设计关键点（架构约束、不变量、兼容口径、数据契约、边界条件、失败模式、必须沿用的既有实现），必须逐条写成可执行约束。",
  "不要只写“注意设计”或指望执行节点重新发现。",
  "没有这类关键点时不要编造，但简单节点也要写清具体改动意图，不能只重复 title。",
  "涉及 UI 美化、布局或交互时，必须先把可执行界面设计写进 instructions：信息层级、布局结构、间距与对齐、关键状态（默认、悬停、禁用、空、错误、加载）和交互路径，并要求执行节点沿用现有主题语义、按该设计实现，不得自行改配色、间距、组件结构或交互。",
  "非这类任务不要编造界面设计。",
  "instructions 可以是字符串，或逐条字符串数组。",
].join("");
