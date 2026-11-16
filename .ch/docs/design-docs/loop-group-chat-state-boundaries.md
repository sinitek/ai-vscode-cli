# Loop 群聊状态边界

## 职责

`loopPlusPanelProjection.ts` 把任务记录中的 Loop+ snapshot 变成只读 UI 投影。它仅通过 `createLoopPlusScheduler({ snapshot })` 建立读取副本，再从副本的 `snapshot()` 与 `wait().view` 生成展示状态；活动验收批次 eventId 由宿主只读查询传入，并必须匹配 FIFO 队列前缀。无有效宿主元数据时不把整队列标成正在验收；classic 模式返回 `null`，缺失或非法 snapshot 返回 invalid 投影。

`loopGroupChatPanelState.ts` 负责群聊状态、成员/进度/active speaker、transcript 创建与 markdown 合并。文件系统、运行中任务集合、活动子任务、完成总结及翻译均由窄依赖传入。展示类型从 `webview/loopGroupChatPanelTypes` 以 type-only import 引入，不加载 Webview 或 VS Code 宿主。

`panelStateBuilder.ts` 继续承载普通面板及编辑器状态，并具名重导出群聊构建、transcript 创建与 Loop+ 投影函数，保留既有公开名称和函数对象身份。Extension host 的群聊协调器直接依赖群聊状态模块。

## 必须保持的行为

- review FIFO、current review 与 visible count 一致、blocked 任务的中断标记、历史 acceptance 推导及 paused/decomposing 判定保持原实现。活动成员和状态说明只依据宿主传入且通过 FIFO 前缀校验的冻结 eventId；完整 review queue 继续用于等待成员和队列总数。
- 成员开始时间遵循任务记录、round 和 transcript joined-at 的既有优先级；进度未完成不超过 99，完成为 100。
- 继续、停止和补充权限由原任务运行控制状态决定。
- transcript 路径、创建时机、初始内容、终态段落去重、缺失文件错误、澄清数据及中文文案保持原实现。
- 投影不得修改任务记录、调度实例或宿主 scheduling state。
- 群聊成员按 eventId 区分当前冻结批次与后续排队事件；说明文案只列活动批次名称，队列计数仍包括完整队列。查询返回副本且在暂停、停止、完成、释放或元数据与 FIFO 前缀不符时为空。

## 验证边界

共享输出目录的 build 与显式 `node --test` 覆盖投影、群聊状态和呈现回归。冻结批次通过单项及多项前缀夹具检查；没有真实模型调用、浏览器检查或扩展宿主运行。此投影仅呈现宿主状态，不改变执行协议或调度页面结构。

## 群聊打开与加载反馈

主任务 Tab 优先发送打开群聊请求，再同步标签状态；同步消息只更新运行时引用，普通面板后续状态同步负责展示，省去切换群聊前的即时重复重绘。

`LoopGroupChatPanel.showLoading` 立即创建或 reveal 面板。首次仅安装轻量加载壳；浏览器经过两个动画帧及一个独立任务，发送 `loopGroupChatChat:loadingReady`。协调器收到该通知后才准备模型选项、读取最新任务和问答记录、构建完整群聊。完整页面保留加载提示，首次 Markdown 挂载以约 8ms 为批次预算，通过计时器让出主线程；全部完成后恢复滚动位置、收起加载提示，再发送既有 `domReady`。单个极长气泡的解析仍不可在气泡内部拆分。

已安装的群聊保持原 DOM 并立即 reveal，异步刷新继续复用既有内容补丁。协调器按面板实例合并连续打开请求，加载期间的普通刷新由最终最新任务快照覆盖；每个异步阶段核对面板身份，关闭会释放加载壳等待，迟到结果不重建页面。加载错误通过文本显示并提供重试，沿用原刷新入口。状态构建在单次调用内共享 transcript 读取快照，成员时间、正文和缺失检查复用同一次读取；不跨刷新缓存，保留新增内容可见性。

回归入口：`loopGroupChatPanel.test.ts`、`loopGroupChatCoordinator.test.ts`、`loopGroupChatPanelState.test.ts`、`conversationtabsummarytooltip.test.ts`、`chatMarkdown.test.ts`。2026-11-16 使用生成的真实 Webview HTML 和模拟 VS Code 消息桥在 headless Chromium 检查加载首帧、失败重试、181 个气泡及 4320 个 Markdown 小节、问答 Markdown、宽窄屏和减少动态效果；该验证不等同于已安装扩展内的实测。测量、测试命令和历史失败对照见[性能执行计划](../exec-plans/completed/2026-11/2026-11-16-perf-loop-group-chat-opening.md)。
