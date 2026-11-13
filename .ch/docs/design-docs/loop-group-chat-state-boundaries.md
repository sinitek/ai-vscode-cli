# Loop 群聊状态边界

## 职责

`loopPlusPanelProjection.ts` 把任务记录中的 Loop+ snapshot 变成只读 UI 投影。它仅通过 `createLoopPlusScheduler({ snapshot })` 建立读取副本，再从副本的 `snapshot()` 与 `wait().view` 生成展示状态；classic 模式返回 `null`，缺失或非法 snapshot 返回 invalid 投影。

`loopGroupChatPanelState.ts` 负责群聊状态、成员/进度/active speaker、transcript 创建与 markdown 合并。文件系统、运行中任务集合、活动子任务、完成总结及翻译均由窄依赖传入。展示类型从 `webview/loopGroupChatPanelTypes` 以 type-only import 引入，不加载 Webview 或 VS Code 宿主。

`panelStateBuilder.ts` 继续承载普通面板及编辑器状态，并具名重导出群聊构建、transcript 创建与 Loop+ 投影函数，保留既有公开名称和函数对象身份。Extension host 的群聊协调器直接依赖群聊状态模块。

## 必须保持的行为

- review FIFO、current review 与 visible count 一致、blocked 任务的中断标记、历史 acceptance 推导及 paused/decomposing 判定保持原实现。
- 成员开始时间遵循任务记录、round 和 transcript joined-at 的既有优先级；进度未完成不超过 99，完成为 100。
- 继续、停止和补充权限由原任务运行控制状态决定。
- transcript 路径、创建时机、初始内容、终态段落去重、缺失文件错误、澄清数据及中文文案保持原实现。
- 投影不得修改任务记录、调度实例或宿主 scheduling state。

## 验证边界

独立输出目录编译与显式 `node --test` 覆盖投影、群聊状态和呈现回归。未做真实模型调用、浏览器检查或扩展宿主运行；本次未改变执行协议和页面。
