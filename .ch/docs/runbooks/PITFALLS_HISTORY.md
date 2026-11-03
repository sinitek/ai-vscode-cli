# 避坑历史归档

这个文件用于保留已修复、已废弃或仅历史版本有效的踩坑复盘。

## 归档规则

- 主文件和未来专题文件只保留仍有行动价值的条目。
- 问题被彻底修复、方案已废弃或只影响历史版本时，将完整条目迁移到这里。
- 归档条目仍需保留首次发现时间、适用版本、修复方式和关联资料，便于审计和追溯。
- 当历史归档数量较多或单文件超过约 500 行时，再按主题拆分历史文件并从本页建立索引。

## Loop / Loop+ 同 CLI 子模型被主模型替代

- 发现时间：2026-11-03。
- 适用版本：经典 Loop 只在跨 CLI 分支注入绑定模型、Loop+ 命名角色快照只取独立设置的版本。
- 现象：主、子模型 CLI 相同但下拉选择不同模型，子任务仍启动主模型；同 CLI 前端子路由还可能被判定为不可用。
- 根因：经典 Loop 把模型、思考力度绑定误放在 `crossCli` 条件内；Loop+ 下拉在没有独立设置时显示已有子模型，但发送没有相同回退，且省略同 CLI 的命名角色身份。
- 修正：模型和思考力度绑定不依赖跨 CLI；新建及改用当前配置继续时，命名角色携带完整 CLI/config/model，模型回退与下拉一致，区分未设置与显式 CLI 默认。历史快照不自动改写；受影响旧任务继续时选择“使用新配置的主子模型”重新绑定。
- 验证：`npm run build`；`subtaskCliExecution.test.ts`、`loopPlusFullstackMode.test.ts`；真实 Chromium 对 Webview 的经典 Loop、全栈继承、全栈独立选择、拆分前端进行提交，并核对宿主路由与 Codex thread/turn 参数。
- 事实来源：`.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`。不修改历史任务、用户本地配置或模型目录。

同次全 CLI 核查补充：角色快照入口不能只列 Codex，ZCode 在宿主模型/思考能力判断中不能遗漏；OpenCode 启动前水合曾把子任务的 `model` 覆盖成 `loopMainModel`，必须在水合后保留实际绑定模型。命名角色思考档须传到 OpenCode 实际 variant 而非仅 UI 或展示快照，未指定时不以主模型档位覆盖原角色 variant；归一化保留 OpenCode 原生高档及 DSH medium。所有主 CLI 布局的全栈/前端思考控件都要绑定修改事件。`loopModelRouting.test.ts` 覆盖七种 CLI、同/跨 CLI、全栈/拆分；真实 CLI 验收必须有完整调度与产物证据，429 失败及仅 session 参数正确不能冒充成功，也不能越过发布门禁。

## Loop+ 手动中断被送入验收队列

- 发现时间：2026-10-20
- 适用版本：编排宿主把子任务任意 `stopped` 都直接传给 `scheduler.finish` 的版本。
- 现象：子模型手动中断后继续执行，主模型已经收到结束事件并开始验收。
- 根因：进程停止与可验收结果共用了同一完成入口；手动续跑成功通知到达时，原开放 attempt 已被移出 running。
- 修正：局部手动中断保留开放 reservation，以子任务 `blocked` 标记等待续跑，父任务继续或宿主重建时保留占用；成功通知才提交一次完成事件。真实失败、丢失进程及父任务停止仍走原终止分支。群聊投影排除待续跑项的运行计数和思考动画；主模型控制可继续关闭中断后的旧 Tab。
- 验证：`loopPlusOrchestration.test.ts`、`loopPlusRuntimeIntegration.test.ts`、`loopPlusGroupChatPanel.test.ts` 覆盖等待、幂等、恢复、冲突和控制；Chromium 对生产群聊与适配器消息桥执行中断、补充需求、独立验收、续跑通知和最终收口。
- 事实来源：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 首次模型报错后重试的首条 trace 触发空值异常

- 发现时间：2026-10-19
- 适用版本：`appendMessage` 的 `sameTraceKind` 判断直接访问 `last.kind` 的版本。
- 现象：首次模型报错后再次执行，Webview 报 `window-message-handler-failed`，原因是 `Cannot read properties of undefined (reading 'kind')`，首条执行记录丢失。
- 根因：异常会话重建会发送空的 `setMessages`；下一条消息为 trace 时，消息列表没有 `last`。即使合并分支另有 `sameRole` 检查，提前计算 `sameTraceKind` 仍会抛错。
- 修正：读取 `last.kind` 前先确认 `last` 存在；保持同类 trace 合并、工具调用不合并及 `merge: false` 隔离规则。不通过关闭异常会话隔离来绕过问题。
- 验证：`src/test/webview/clipagescriptruntimecoverage.test.ts` 覆盖空列表的 normal/thinking/tool-use、首次失败后重试及合并规则；完整生成的 Webview HTML 通过本机无头 Chromium 消息派发验证。

## 工作区安装开关被对话运行态误禁用

- 发现时间：2026-09-26
- 适用版本：工具设置“工作区”页把 Harness / CodeGraph 复选框绑定 `state.isRunning` 的版本
- 现象：工作区没有 `.ch`，也没有安装 CodeGraph，但两个复选框都是 disabled，无法点击安装。Loop 主任务在没有 CLI 进程时仍保持运行态，因此会长时间锁住开关。
- 根因：禁用条件把“当前对话或 Loop 主任务运行中”和“已经安装”混在一起。运行态只应反映任务生命周期，不应阻止尚未安装的工作区开关。
- 修正：Harness 只在已存在 `.ch` 时禁用；CodeGraph 只在已有 `.codegraph/` 索引或正在安装时禁用。运行态不再禁用这两个复选框。
- 验证：`src/test/webview/clipagescriptruntimecoverage.test.ts` 覆盖 Loop 主任务运行中仍可点击，以及已安装或正在安装时继续禁用。
