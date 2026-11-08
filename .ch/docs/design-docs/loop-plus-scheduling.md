# Loop+ 子任务调度

会话连续性：每次 attempt 可以新建展示 Tab，但不必新建 CLI 会话。验收失败 review 关联的修补项自动续接原子任务，主模型也可用 `continueFromSubtaskId` 显式选择连续工作来源；控制重派保留原子任务来源。持久化绑定、配置兼容、串行执行及边界见 [Loop 子任务会话复用](loop-subtask-session-reuse.md)，原有调度和验收条件保持不变。

## 调度边界

### 每轮简单事项直办

Loop 与 Loop+ 在首次、补充需求、用户消息、继续、验收及收尾的每轮主决策中，都先按 `src/loopDirectExecutionPolicy.ts` 判断当前事项是否特别简单：目标明确、局部低风险、结果能从操作本身直接确认，不需要独立调查、设计或协作，且用户与项目规则均未要求测试、构建或独立验收。满足时由主任务直接处理，不按操作类型、文件数或行数设白名单，也不为了流程完整派发微型子任务。

独立简单补充事项可与其它工作同轮处理，但不能争抢运行中、排队中或待验收任务的写入，不能接管或修补已派发产物。处理完简单事项后，仍按其它工作的状态返回 `dispatch`、`wait`、`accept` 或正常 `completed`；不能遗漏原要求、跳过待验收事件或因子模型失败回退主模型编码。

Loop+ 宿主每轮重新计算 `allowDirectCompletion`：仅无 running / pending / currentReview / reviewQueue 且无附加审查项时允许精简收口，不以是否存在历史子任务为条件。模型还必须确认所有原始及补充要求已完成且本轮符合直办条件，返回 `status=completed`、`directCompletion=true`、非空 `answerConclusion` 与 `finalSummary`，不携带子任务、事件确认、验收或覆盖清单字段。解析器默认拒绝该协议，须由宿主显式放行；用户消息确认、并发变化检查和 scheduler 完成门禁保持有效。其它 `completed` 的固定清单和附加审查校验不变。

### 子任务完成汇报与压缩顺序

Loop 与 Loop+ 的子任务成功返回后，先持久化完成结果并提交主任务汇报或验收事件，再异步压缩子任务自己的会话；主任务验收、其它子任务派发不等待这次压缩。交互运行和 OpenCode 共用运行模板都通过 `src/loopSubtaskAutoCompact.ts` 延迟登记压缩，经典 Loop 在 `finalizeLoopSubtaskRun` 完成汇报后放行，Loop+ 在完成事件处理后放行，包含人工续接的完成事件；过期 attempt 的结果不能放行新 attempt 的压缩。

后台压缩通过 `src/extensionHost/isolatedContextCompaction.ts` 使用独立运行状态和目标 Tab 消息路由，不占用或清理主模型运行槽，不改写主任务耗时。CLI 会话级等待同时覆盖原 Tab 和新 Tab 续接；同会话待压缩时不重入，其它会话照常执行。压缩沿用原执行配置、模型与思考快照并重新获取配置执行租约；配置档案已切换时跳过并记录错误，同一档案的 revision 更新仍沿用现有租约兼容规则，不切换用户配置、不撤销已上报的完成状态。自动压缩开关、成功且超过五分钟的触发条件、三分钟超时，以及主任务与普通对话既有策略保持不变。

群聊补充需求是独立于主模型运行锁的本地输入：弹窗打开和连续提交不等待当前模型调用结束，也不依赖群聊内容补丁重建入口。提交按顺序写入任务记录与 transcript；Loop+ 通过 `submitUserMessage` 写入既有持久化 `userMessageQueue`，忙碌时不额外启动主模型或中断当前调用。消息确认只消费本次请求已捕获的队列前缀，新到需求留给后续调度；验收优先级与完成阻塞条件不变。经典 Loop 的补充需求仍随下次主任务提示读取，并在应用 completed 决策前核对调用开始时的需求快照；发生变化时返回 `pending-requirements`，原轮次重新判断，不遗漏收尾期间收到的要求。

Loop+ 主模型在每次成功验收批次的 `accept` 决策中给出 0–99 的总体进度整数，结合所有原始/补充需求及剩余工作判断，不按子任务数或验收次数推算；接收新需求后允许重新校准。宿主只在验收事件批次成功提交后持久化该值，协议重试、拒绝或未提交批次不更新。新建任务从 0% 开始，暂停、停止和续跑保留当前值；最终完成门禁成功并持久化时置为 100%。群聊左侧 Loop+ 主任务成员标题展示“主任务 N%”，经典 Loop 不变。

主任务用 `controls.reprompt` 纠正正在运行或排队的子任务时，必须同时提供非空 `title` 和至少 80 字的 `prompt`。新标题由主模型按纠正后的目标用简体中文描述，范围或目标改变时不得沿用旧标题；缺失、空白或非字符串标题会导致整份决策被拒绝并走既有协议重试，不会先停止旧执行。新标题沿原有调度、任务记录和群聊投影链路同步到新 attempt、成员名称和启动通知，子任务 ID 与会话连续性不变。`close` 仍不要求标题，历史消息不回写改名。

Loop+ scheduler 为纯状态内核，维护 `running`、`pending`、验收队列和可恢复快照；extension host 只启动 scheduler 返回的 `started` 项。生产并发上限为 6，单次决定的派发上限由独立设置约束。扩展宿主按每次实际启动间隔约 3 秒错峰，错峰队列不改变 scheduler 的准入状态。

群聊在 `activity=reviewing` 时按宿主实际验收批次展示：`currentReview` 与 `reviewQueue` 中的所有子任务都标为「正在验收」，状态说明列出整批名称；文案使用主题蓝色。新增完成事件触发宿主扩批重问后沿用同一展示。暂停或未领取验收时不把排队项标为正在验收；scheduler 仍保留单个当前项及 FIFO 队列，底层计数和快照不变。

Loop 与 Loop+ 共用群聊的 780px 窄屏断点：标题栏下方只保留聊天区，任务信息与成员通过左侧居中开关作为浮层展示，而非上下堆叠。浮层开关属于 Webview 本地展示状态，内容补丁不重置它；断点变化会收起浮层，宽屏侧栏恢复常驻。点击外部、开关或 Esc 可关闭，隐藏时使用 inert 与 aria-hidden 隔离键盘焦点，不改变任务状态与聊天滚动位置。

## 容量感知拆分与轻量冲突协作

宿主把真实 `maxConcurrency` 传给主模型提示，显示并发上限、当前 `running` 预留后剩余的槽位与单次派发上限。已中断但仍开放的 attempt 继续占槽；pending 不算运行槽位，但已排队工作不得重复派发，且可能优先消耗释放的槽位。

- 容量允许且至少有三个有收益的独立交付边界时，主模型争取 3–6 路并行；边界不足、前置依赖、配置限制或空槽不足时允许 1–2 路，不为凑数拆微任务。
- 按实现、稳定契约下的独立测试、文档、配置、脚本等交付边界拆分，不按模型角色个数拆分。同为后端、前端或全栈的多个独立任务可以并行；全栈模式不等于只能派一个任务，前后端模式不等于最多两个。
- 每个子任务声明精确的主要 `writeFiles` 和独立验收方式；`conflictGroup` 只表示真实共享可变资源，不以整个功能或角色统一分组。共享只读资料不产生写入冲突，已知共同写入路径必须如实声明，不能为提高并行而隐藏路径或清空冲突组。
- 共享契约、中心注册点等由一个任务负责，必要时先做小型前置任务，只串行真正相依的部分，其它交付不必一起等待。`dispatch` 和 `accept` 均寻找可回填的独立工作；开放验收批次先整批处理，再通过 `accept` 附带后续任务，不增加全批屏障。
- 极少量确有必要、可局部协调的附带范围外改动可以由子任务自行处理，不能仅因其存在可能性就取消主体并行。编码子任务写入前重读文件，保留其他任务改动，不盲目回退或覆盖；小范围互不竞争的改动局部协调并记录路径、原因和处理结果。同符号或共享契约的竞争修改应交由主模型重排，不能强行大范围重写。
- 调度器对明确 `writeFiles` 重叠与相同 `conflictGroup` 的串行保护不变。局部冲突协作是提示约定，不是文件锁、合并器或冲突率保证。

协议 `dispatch` 示例默认展示四个交付任务，数量受单次派发上限与并发上限共同约束；上限为 1 时派发和控制示例仍能通过解析。示例只表达协议形状，不是任务数量或角色配额。

## 准入与并行回填

- `running` 项（包括人工中断后等待续跑结果的开放 attempt）占并发槽，并通过 `writeFiles` 路径重叠与相同 `conflictGroup` 对新任务形成冲突约束。
- scheduler 依 pending FIFO 顺序检查候选项；同一次准入中已成功提升为 running 的项立即参加后续冲突检查。
- 由于冲突或并发上限仍未启动的 pending 项只保留队列顺序，不占并发槽，也不为后续候选预留写入范围。因此后续任务可越过被当前运行任务阻塞的 pending 项，填补可用并发槽。
- 后续候选仍必须与当前 running 及本次已提升的任务互不冲突。活动冲突释放后，再按 FIFO 选择最早的可运行项；更早 pending 项仍冲突时可以继续回填其它安全任务。
- 达到 `maxConcurrency` 时，仍未启动的任务留在 pending；结束任务会在同一 scheduler 转换中释放槽位并提升可运行项。

示例：A 写入 `x.ts` 正在运行，B 写入 `x.ts` 和 `y.ts` 因与 A 冲突而等待，C 仅写 `y.ts`。C 与 A 不冲突，应立即运行；B 在 A、C 中任一仍占用冲突范围时继续等待。

## 阻塞观测

`dispatch` 决策把 pending 原因归为运行中 `writeFiles` / `conflictGroup` 冲突或 `max_concurrency`。宿主 `loop-plus-dispatched` 日志为每个 pending attempt 记录 `subtaskId`、`attemptId` 和 `blockedBy`，冲突项附带冲突值及对应活动 attempt；异常未分类项使用 `scheduler`。pending 项之间不再报告互相阻塞。

## 全局阻塞复核与暂停留证

主模型返回 `blocked` 不等于所有剩余要求均无法推进。每个无进展阶段首次出现全局阻塞时，宿主先将任务的 `loopPlusBlockReview` 保存为 `pending`，不确认原验收事件，再发起一轮带 `Bounded blocked review` 标记的复核。提示要求逐项核对根需求、补充需求与未完成事项，分辨外部依赖和仍可独立实施的工作；不能以删除门禁、重复失败诊断或编造成功替代推进。

有效复核决策将状态变为 `reviewed`，发现独立工作则沿用原 `dispatch` / `accept` 流程；再次确认 `blocked` 才暂停。待复核与已复核状态均持久化并跨宿主重建保留，新用户输入、成功派发或验收提交会清除状态；显式继续也重新开放一次复核。协议错误与总决策次数继续受已有上限约束，不因等待或加载历史自动无限调用模型。

最终暂停沿用 `needs-review`，保留活动 attempt 和验收队列。主聊天展示阻塞原因、未完成事项与恢复入口；`src/loopPlusPause.ts` 同步将该说明写入主任务沟通文件和群聊 transcript，按任务 ID、持久化更新时间与暂停原因标记去重。群聊解析暂停段落时隐藏该元数据，不改写持久化内容。聊天通知写入与文件记录异常隔离，不因单一展示失败丢失另一条证据，也不将暂停改为完成。

## 完成提示分层

运行时把任务记录传给单次调用结束文案构建器：Loop+ 主任务显示“本轮调度已结束”，子任务显示“等待主任务验收”，普通对话与经典 Loop 保持原文案。父任务只有完成状态成功持久化后才显示“全部任务已完成”并触发既有完成提醒；子任务通过或主模型单次调用返回不代替整体目标完成。

## 角色模型与子任务模式

前端历史快照若已保存独立模型或档案、但省略 `cli`，沿用该任务主 CLI；前端独立档案优先，仅同 CLI 且未保存独立档案时使用 `originProfile.configId`。这只恢复执行器身份，不替换前端模型，也不从当前激活配置猜测历史配置。仅有思考档、空白路由、非法 CLI 或跨 CLI 缺档案仍拒绝派发。运行时绑定主模型提示时，同 CLI 的前端、全栈命名角色也保留 CLI 身份，避免再次丢失。

角色路由的 CLI 身份与主 CLI 相同也必须写入全栈、前端请求快照，不能只在跨 CLI 时携带。模型快照取下拉实际显示值：独立角色模型存在时优先使用，未设置时取已有子模型；显式空字符串仍表示 CLI 默认，不等同于未设置。继续时改用当前配置也应用相同规则，尚未保存命名角色 CLI 时跟随主 CLI 并写入完整快照；保持原配置不迁移或猜测历史遗漏的模型。经典 Loop 同样不以是否跨 CLI 决定是否应用已解析的子模型及思考力度。

参数隔离覆盖 Codex、Claude、OpenCode、Grok、DSH、Kimi Code、ZCode，不做 Codex 特判。支持模型选择的 CLI 发送主子角色模型与思考档快照；Claude 按自身能力使用默认模型并保留子角色思考档。OpenCode 子任务模型在启动前水合配置时不得被主模型覆盖，显式角色思考档传入实际运行 variant；未指定时保留该配置、模型、角色自己的 variant。OpenCode 的 xhigh/max/ultra、DSH 的 medium 和 ZCode 原生档位不被通用归一化降档；既有子任务思考上限仍有效。OpenCode、Claude 布局的命名角色下拉同样绑定模型/思考修改事件。

Loop+ 用单一字段 `loopSubtaskMode` 表示 `fullstack` 或 `split`。新任务和输入区缺省 `fullstack`。全栈勾选时只展示并启用「子-全栈」，backend、frontend 和未归类编码都用这一套 CLI、configId、模型和思考力度。取消勾选才展示「子-后端」「子-前端」：frontend 走前端子模型，backend 和其它编码走后端子模型。主模型默认自行完成拆分、仓库推理和普通只读思考；只有规模大、至少能拆成两个相互独立且各自需要充分调查的分析方向，并且并行能显著缩短耗时或扩大覆盖时，才一次派发多个主模型 `general` 子任务。小/中型思考或单一分析方向不派 `general`。需要委派的非简单编码/写入任务（包括代码、测试、文档、配置和脚本）优先按互不冲突且可分别验收的交付边界一次拆成多个子任务并行；存在共享文件或强依赖时保持单任务，不为增加数量而拆分。`general` 读取主 CLI、主档案、`modelRouting.main` 和 `originProfile.mainThinkingMode`，不能携带 `writeFiles` 或 `codingDelivery`。纯回答/只读请求若不需要独立证据或并行分析，主模型直接 `completed`，不创建子任务。

三套配置分别落在 `loopSubtask*`、`loopSubtaskFrontend*`、`loopSubtaskFullstack*`，以及 `modelRouting.subtask` / `subtaskFrontend` / `subtaskFullstack`。切换模式只改变显隐和路由，不互相覆盖。全栈角色第一次缺失时从原子模型完整配置初始化一次，并用 `loopFullstackRoleSeededByConfigId` 记住，避免来回切换重拷贝。空模型字符串表示用户选择 CLI 默认模型，与整组配置缺失区分。

模式和三套配置随发送、排队、`PromptRunInput`、根任务记录和续跑保存。已运行任务绑定创建时的快照。原配置续跑保留原模式和各组配置；当前配置续跑改用当前模式。没有模式、也没有独立前端子路由的旧任务按 fullstack 沿用原子模型，执行不变。已经保存前后端独立配置但没有模式的记录按 split 恢复。未知非空模式或分类拒绝，不猜测。子配置不可用时失败，不回退主模型编码。用户可以把子角色设成与主角色相同的模型名。

群聊续接弹窗分别使用原任务模式和当前配置模式生成模型摘要：split 展示主模型、子-后端、子-前端，fullstack 展示主模型、子-全栈；隐藏角色不进入摘要。原任务模式从任务记录携带，旧任务通过 `resolveStoredLoopSubtaskMode` 沿用同一兼容规则，只有未记录模式且无全栈路由的旧全栈任务才展示原子模型作为全栈模型。当前配置预览完整传递模式、全栈 CLI 及独立角色模型读取回调，与确认续跑时的 `resolveCurrentLoopModelPair` 输入保持一致。经典 Loop 继续使用原有主/子模型摘要。

主模型提示注入当前模式、可用角色和编码约束。fullstack 不再要求为了选模型把所有编码拆成前后端。提示词不是只读沙箱。经典 Loop、普通聊天和 OpenCode `small_model` 不读这个开关。

## 验收方案快照

新建 Loop+ 根任务时，Webview 在 `sendPrompt` 前弹出“主模型验收方案”弹窗，把用户确认的复选项和“其它”审查内容作为 `loopPlusAcceptancePlan` 快照随请求提交。宿主只在该请求属于 `loop_plus` 且不是续跑/恢复/补充需求时接受该字段，归一化后连同 `loopTaskId` 一起写入 `LoopTaskRecord.loopPlusAcceptancePlan`；空基线快照不落盘，读不到的旧任务按固定清单处理。

- 方案下拉第一项是「新增方案」（未保存草稿），其后始终是内置「默认方案」和已保存方案。每次打开使用当前项目最近一次有效选择，明确选回内置默认也会记忆；未保存的新建草稿不覆盖最近选择，无效或已删除选择回退内置默认。方案名称输入框不显示标签，占位文字是「方案名称」：内置默认显示「默认方案」且只读、保存按钮禁用；新增方案预填「新建方案」，自定义方案可以改名和保存。勾选「其它」后的文本域也不显示标签，占位文字是「审查内容」。自定义方案保存时若名称已存在则覆盖那一条，不再新增第二条；「系统默认」和「默认方案」均为保留名称。旧版已保存的「默认方案」在读入时自动改名为「新建方案」，重名时使用「新建方案（2）」等后缀；保留稳定 ID、检查项、其它文本、时间戳及选中关系，后续工作区设置写入会持久化迁移结果，不改既有任务快照。已保存方案可删除，删除前弹出确认；内置方案没有删除按钮。下拉、「保存」和「删除」始终同一行，窄屏时下拉收缩，按钮不换行。

- 快照与模板解耦：弹窗里的方案是可复用模板，任务记录里的是确认时刻的副本。之后修改或删除模板不改变已启动任务；续跑、恢复、补充需求直接读任务记录里的快照。
- 提示注入：`initial` / `review` / `closeout` / `continue` / `user` 五类主模型提示共用同一份快照，只在固定验收清单之后追加已勾选审查项与有效“其它”文本，要求逐项给出证据或显式“不适用”。固定清单、调度协议和“主模型不得自行实现或修复被派发工作”的约束不变。
- 简短验收反馈：`accept` 或 `completed` 真正结束验收后，Loop+ 群聊追加一条「验收结果」气泡。气泡在表格外上方显示真实子任务名、整体验收结果及事件原因；批量确认列出本批所有子任务名和各自结论，共用一张明细表。两列表格仅保留默认及附加检查，第一列是审查内容，第二列是审查结果（通过或未通过，以及证据型原因），不再添加“验收事件”或整体结果首行；原因语言按任务、证据和上下文选择，不强制中文。即使没有附加快照，也必须显示固定六项默认验收：实现完整性、契约一致性、测试验证、产物可运行性、改动合理性、回归与边界检查。「其它」仅展示本次结论和原因，不重复长篇审查要求。
- 反馈协议：`accept.reviews[].reason` 解释各事件的结果，`accept.acceptance.checks[].detail` 和 `completed.acceptance.checks[].detail` 解释六项默认检查；已选择的附加项通过 `acceptancePlanResults[].reason` 解释。每条原因按 Unicode 字符计数不超过 50 字，不适用时说明具体限制，不能编造通过证据。运行时拒绝缺失、空白或超长原因，以及缺少默认项或所选附加结果的决策，走既有协议重试，不生成兜底评价或部分气泡；未发生验收时不写气泡。通用解析入口仍兼容旧数据，严格校验由 Loop+ 运行时启用。
- 固定基线不可关闭：归一化时强制包含基线项，前端布尔值、旧版数据或可选配置都无法移除。
- 模板持久化：方案与当前选中项存工作区设置（`loopPlusAcceptancePlans` / `loopPlusAcceptancePlanSelection`），系统默认是内置只读项，不写入存储。只改模板不会改写已启动任务。
- 群聊修改：Loop+ 群聊顶部「验收方案」打开同一弹窗，确认后把当前复选项写回该任务的 `loopPlusAcceptancePlan`。下一次主模型验收提示立即读取新快照；若复核或收尾正在进行，宿主中止这一轮并按新快照重新提问。空基线会清掉任务上的附加快照。主任务状态为 `completed` 后不再显示该按钮。

## 事实来源与验证

验收反馈以本轮确认事件为边界：`accept` 之后仍按原流程调用主任务收尾，但收尾没有新确认事件时只总结、不生成验收表格，没有派发子任务的直接完成同样只总结。直接 `completed` 确认新事件仍显示对应子任务表格，修复的新 attempt 不被历史确认抑制。展示依据当前决策的确认事件 ID，恢复后同样适用，不依赖内存去重标记；不改写用户已有 transcript，不删除历史气泡；符合简单直办条件且无开放工作或附加审查的收尾，可使用下述 directCompletion 精简协议，其它收尾检查不变。

- 实现：`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/loopPlusSubtaskMode.ts`、`src/subtaskCliRoute.ts`、`src/loopPlusAcceptancePlan.ts`、`src/extensionHost/loopPlusAcceptancePlanHost.ts`、`src/webview/viewContentScript/acceptancePlan.ts`
- 回归：`src/test/loop/loopPlusScheduler.test.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`、`src/test/core/loopPlusAcceptancePlan.test.ts`、`src/test/extensionHost/loopPlusAcceptancePlanHost.test.ts`、`src/test/webview/loopPlusAcceptancePlanDialog.test.ts`
- 验证：`npm run build`；`node --test dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopPlusAcceptancePlanHost.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/webview/loopPlusAcceptancePlanDialog.test.js dist/test/loop/loopTaskStore.test.js dist/test/core/workspaceSettingsStore.test.js`
