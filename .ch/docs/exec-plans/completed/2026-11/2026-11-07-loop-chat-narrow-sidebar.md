# 群聊窄屏浮层侧栏

- 日期：2026-11-07
- 状态：completed
- 负责人：Codex

## 背景与目标

群聊当前在 780px 以下把任务信息与聊天区上下排列，占用聊天高度。改为只保留标题栏和聊天区，侧栏通过内容区左侧居中的图标展开，浮动覆盖聊天内容。

## 范围与非目标

- 范围：Loop / Loop+ 共用群聊布局、主题样式、侧栏开关、键盘与焦点、响应式回切、相关测试和功能说明。
- 非目标：不改调度、验收协议、持久化任务或现有对话框；保留上一轮蓝色批量验收修改。

## 验收标准

- 窄屏默认隐藏侧栏，聊天占满标题栏以下内容区，不再上下堆叠。
- 左侧居中图标展开浮层；再次点击、点击侧栏外区域或按 Esc 收起。
- 展开不改变聊天宽度及滚动位置；侧栏内容独立滚动，标题操作仍可用。
- 宽屏保持双栏；切换断点清理浮层状态，隐藏侧栏不能获得键盘焦点。
- 周期内容补丁不重置侧栏开关；现有对话框层级与 Esc 行为不受影响。

## 影响面与风险

- 代码：`src/webview/loopGroupChatPanel.ts`、`src/webview/loopGroupChatPanelStyles.ts`、`src/webview/loopGroupChatPanelRenderer.ts`。
- 测试：`src/test/loop/loopGroupChatPanel.test.ts`。
- 文档：功能总表及 Loop+ 设计说明。纯布局与本地交互不改变业务本体，无需修改 ontology 数据。
- 风险：浮层遮挡、隐藏元素焦点与断点状态残留；通过主题样式、inert、焦点归还和浏览器断点/补丁验证缓解。仅改展示，回退上述局部修改即可。

## 验证计划

- `npm run build`。
- `node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopPlusPanelState.test.js`。
- Headless Chromium：宽屏、420px/320px 窄屏、展开/收起/遮罩/Esc、补丁刷新、对话框层级、断点回切、实际几何尺寸及焦点。
- `git diff --check`、ontology 校验、界面机械检测。

## 进展与结果

- 已确认现有断点为 780px，侧栏与聊天各自有滚动容器，内容补丁只替换容器内 HTML。
- 已实现默认收起、左侧居中开关、覆盖式侧栏、外部点击/Esc 收起、焦点归还、断点回切及隐藏侧栏 inert；现有对话框仍优先处理 Esc。
- 已同步功能总表和 Loop+ 设计说明；纯展示交互不改变业务概念、调度状态、持久化或权限，因此无需更新 ontology 数据或长期记忆热区。
- `npm run build` 最终通过。首次构建曾被并行会话摘要改动导致的 `submission` 参数类型错误阻塞；未修改该模块，等待其自身修复后重新构建通过，归类为范围外并行改动。
- 最终单元自测：`node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/webview/chatCopy.test.js dist/test/webview/chatMarkdown.test.js`，78 项全部通过。新增三组侧栏单测覆盖展开/收起、键盘与对话框优先级、宽窄屏切换及焦点。
- Headless Chromium 使用真实面板渲染器与模拟任务/VS Code 桥接：1440px、420px 场景通过；补充验证 320px 无横向溢出、聊天铺满、展开前后聊天尺寸和滚动位置不变、内容补丁保留开关、对话框层级/Esc、遮罩与图标关闭、焦点归还、宽窄屏回切。浏览器、HTTP 和请求错误均为零，并检查截图。
- `git diff --check` 与 ontology `--validate` 通过。界面机械检测仅提示既有 Markdown 引用块的 3px 左边框，非本次引入，未扩展修改。
- 未启动真实 Extension Development Host 或真实模型调用；本次不改宿主协议或 CLI 路径，浏览器验证覆盖实际 Webview HTML/CSS/脚本。
