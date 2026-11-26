# Loop 群聊状态边界

## 职责

`loopPlusPanelProjection.ts` 把任务记录中的 Loop+ snapshot 变成只读 UI 投影。它仅通过 `createLoopPlusScheduler({ snapshot })` 建立读取副本，再从副本的 `snapshot()` 与 `wait().view` 生成展示状态；活动验收批次 eventId 由宿主只读查询传入，并必须匹配 FIFO 队列前缀。无有效宿主元数据时不把整队列标成验收中；classic 模式返回 `null`，缺失或非法 snapshot 返回 invalid 投影。

`loopGroupChatPanelState.ts` 负责群聊状态、成员/进度/active speaker、transcript 创建与 markdown 合并。文件系统、运行中任务集合、活动子任务、完成总结及翻译均由窄依赖传入。展示类型从 `webview/loopGroupChatPanelTypes` 以 type-only import 引入，不加载 Webview 或 VS Code 宿主。

`panelStateBuilder.ts` 继续承载普通面板及编辑器状态，并具名重导出群聊构建、transcript 创建与 Loop+ 投影函数，保留既有公开名称和函数对象身份。Extension host 的群聊协调器直接依赖群聊状态模块。

## 必须保持的行为

- review FIFO、current review 与 visible count 一致、blocked 任务的中断标记、历史 acceptance 推导及 paused/decomposing 判定保持原实现。活动成员和状态说明只依据宿主传入且通过 FIFO 前缀校验的冻结 eventId；完整 review queue 继续用于等待成员和队列总数。
- 成员开始时间遵循任务记录、round 和 transcript joined-at 的既有优先级；进度未完成不超过 99，完成为 100。
- 经典 Loop 和 Loop+ 的成员面板固定主任务在首位，子任务按 `subTasks` 顺序倒排。子任务编号仍取原始位置，首次渲染和内容补丁共用此顺序。
- 继续、停止和补充权限由原任务运行控制状态决定。
- 经典 Loop 后台子任务仅在其主任务标签仍为活动标签时接管可见标签；运行期间用户切换标签后，子任务收尾不得切回原主任务。并行子任务组不因后台完成而抢占用户选择。Loop 与 Loop+ 共用的面板快照携带单调标签选择版本，Webview 保留更新版本的用户选择，宿主拒绝迟到的旧选择。
- transcript 路径、创建时机、初始内容、终态段落去重、缺失文件错误、澄清数据及中文文案保持原实现。
- 投影不得修改任务记录、调度实例或宿主 scheduling state。
- 父任务活动为 `reviewing` 且事件 ID 属于 `activeReviewEventIds` 时，子任务成员显示「验收中」。`currentReview` 和队列中未进入活动批次的验收（包括修复完成后等待复验）均显示「待验收」。修复执行中的成员显示「修复中」。父任务处于暂停或错误状态时保留相应说明。验收中的说明文案只列活动批次名称，队列计数仍包括完整队列。查询返回副本且在暂停、停止、完成、释放或元数据与 FIFO 前缀不符时为空。

## Loop+ 状态标签

- 普通 Loop+ 群聊与产研部组长群聊使用同一汇总口径；总监群聊的组长行直接使用宿主透传的对应组长群聊汇总。按主任务和每个子任务的最新成员展示状态计数，每名成员至多计一次，不累计旧轮次或旧 attempt。
- 标签依次为“运行中”“修复中”“验收中”“待验收”“待启动”“验收失败”“已阻塞”“已完成”。“验收失败”位于“已阻塞”左侧，两者非零时沿用主题红色；所有零值沿用现有深灰背景。
- 只读投影按子任务 ID 从 attempt 历史计算修复轮次，与现有修复判定使用相同依据。成员行从第二轮起附加 `xN`。修复执行中的成员显示 `repairing`；修复完成后等待复验显示 `queued_review`、汇总计入“待验收”，加入活动验收批次后显示 `reviewing`。修复轮次后缀在执行、等待复验和活动复验时均保留。顶部标签按状态键汇总，每名成员计一次。
- 仅“验收中”计数排除主任务，活跃验收批次中的子任务照常计数，不改变主任务活动状态或完整验收队列计数。失败验收必须在同一决策中关联修复子任务，或用 `noRepairReason` 明确结案；未处置的失败不确认。修复沿用原逻辑子任务 ID，新 attempt 排队和执行时显示“修复中”，完成后等待复验显示“待验收”，活动复验时显示“验收中”。复验通过显示“验收成功”，再次失败显示“验收失败”，进入同一循环。明确无需修复时成员显示“验收成功”，同时保留失败验收与结案理由，且不放行成功依赖或父任务完成门禁。`acceptance_failed` 独立计入“验收失败”；验收成功和免验收完成计入“已完成”。
- 分解归入运行中，等待开始验收归入待验收。主任务在 `needs-review` 状态、阻塞复核为 `reviewed` 且有宿主生成的熔断说明时，成员状态与汇总都显示已阻塞。调度投影保留 `paused`，用于详细活动说明。开放执行的中断状态继续显示等待续跑。经典 Loop 和独立底部状态栏的计数口径不变。

## 产研部冷启动展示

冷启动后，总监与组长群聊使用可信任务记录和当前宿主的执行状态。历史记录仍为运行中但当前宿主已无对应执行时，应投影为当前宿主执行已中断，而不是继续显示正在运行。仅阅读或刷新群聊不改写任务或调度状态。当前宿主执行已中断不等于用户中止已确认、原执行已退出或资源已释放；原执行的退出与清理反馈仍由既有组织控制链路判定。展示不授予自动恢复权限，继续执行仍须显式发起并经过原有身份、权限和清理门槛。

## 验证边界

共享输出目录的 build 与显式 `node --test` 覆盖投影、群聊状态和呈现回归。冻结批次通过单项及多项前缀夹具检查；此投影仅呈现宿主状态，不改变执行协议或调度页面结构。

2026-11-22 冷启动展示回归执行 `npm run test:unit`（6024 通过、3 跳过、0 失败），并执行 `node --test scripts/verify_department_full_eh_integration.test.js`（39 项通过）。隔离双宿主场景检查了真实群聊投影、运行中计数为 0、无自动续跑及显式中止门禁；无员工运行条目的历史“分解中”边界由 `departmentGroupChatHost.test.ts` 覆盖。未对用户任务记录发起执行，也未重启当前开发 VS Code 窗口。

## 运行中成员打开对话标签

经典 Loop 与 Loop+ 共用成员渲染：`role=subtask` 且 `status=running` 时使用原生按钮，点击及 Enter / Space 发送 `loopGroupChatChat:openSubtaskConversation`，仅携带 `subtaskId`。按钮复用成员网格、主题悬停和焦点样式；发送前保留阅读位置并关闭窄屏抽屉。同一成员有历史验收反馈时，运行态优先打开对话，其它状态保留验收定位。

协调器使用该群聊绑定的父任务 ID 读取最新记录，核对子任务归属，再通过组合根注入的解析端口查找现有运行标签。`findRunningLoopSubtaskConversationTabId` 从最新标签向前按父任务和子任务身份匹配，只接受真实活动标签，不按标题或浏览器提供的 tabId/sessionId 跳转；子任务可使用不同 CLI。宿主展开 AI 对话面板后复查活动状态，再复用 `switchVisibleConversationTabForLoop` 的 CLI、配置恢复及消息同步。失效标签提示刷新，打开异常显示中文原因，不创建会话或启动任务。

回归入口：`loopSubtaskTabs.test.ts`、`loopGroupChatCoordinator.test.ts`、`loopGroupChatAcceptance.test.ts`，并复跑群聊呈现与标签切换测试。浏览器验证使用实际生成的 Webview HTML 与模拟 VS Code 桥，不代表已安装扩展内的人工实测。

## 群聊打开与加载反馈

普通 Loop / Loop+ 主任务和产研部总监的 Tab 优先发送打开群聊请求，再同步标签状态。同步消息只更新运行时引用，普通面板后续状态同步负责展示，省去切换群聊前的即时重复重绘。产研部组长 Tab 依据宿主提供的部门角色投影，仅切换和渲染 AI 对话会话。鼠标与 Enter / Space 共用此规则，查看组长群聊可从总监群聊成员列表进入。

`LoopGroupChatPanel.showLoading` 立即创建或 reveal 面板。首次仅安装轻量加载壳；浏览器经过两个动画帧及一个独立任务，发送 `loopGroupChatChat:loadingReady`。协调器收到该通知后才准备模型选项、读取最新任务和问答记录、构建完整群聊。完整页面保留加载提示，首次 Markdown 挂载以约 8ms 为批次预算，通过计时器让出主线程；全部完成后恢复滚动位置、收起加载提示，再发送既有 `domReady`。单个极长气泡的解析仍不可在气泡内部拆分。

已安装的群聊保持原 DOM 并立即 reveal，异步刷新继续复用既有内容补丁。协调器按面板实例合并连续打开请求，加载期间的普通刷新由最终最新任务快照覆盖；每个异步阶段核对面板身份，关闭会释放加载壳等待，迟到结果不重建页面。加载错误通过文本显示并提供重试，沿用原刷新入口。状态构建在单次调用内共享 transcript 读取快照，成员时间、正文和缺失检查复用同一次读取；不跨刷新缓存，保留新增内容可见性。

回归入口：`loopGroupChatPanel.test.ts`、`loopGroupChatCoordinator.test.ts`、`loopGroupChatPanelState.test.ts`、`conversationtabsummarytooltip.test.ts`、`chatMarkdown.test.ts`。2026-11-16 使用生成的真实 Webview HTML 和模拟 VS Code 消息桥在 headless Chromium 检查加载首帧、失败重试、181 个气泡及 4320 个 Markdown 小节、问答 Markdown、宽窄屏和减少动态效果；该验证不等同于已安装扩展内的实测。测量、测试命令和历史失败对照见[性能执行计划](../exec-plans/completed/2026-11/2026-11-16-perf-loop-group-chat-opening.md)。
