# Loop / Loop+ 群聊气泡内部滚动回弹修复

- 日期：2026-11-03
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-03
- claim_ttl：本次任务
- handoff_to：无

## 背景

通过 CodeGraph 定位 `LoopGroupChatPanel` 及群聊面板事实来源，再直接读取当前实现确认：群聊每 5 秒自动刷新，宿主也会推送内容补丁。旧 `replaceHtml` 无条件重建时间线，只恢复外层主滚动区，气泡内代码、表格、JSON 等区域的横纵滚动位置因此归零。memory-recall 的 focus 为 `Loop Loop+ 群聊 滚动 气泡`，未指定 anchor；召回记录不作为代码事实来源。

## 目标

Loop 与 Loop+ 群聊刷新时保留气泡内部的水平、垂直阅读位置。

## 范围与非目标

- 修改群聊局部 HTML 更新逻辑，复用未变化内容，并在更新前后保留后代元素的滚动位置。
- 覆盖群聊时间线与共用更新逻辑的提问回复，保留原有主滚动区跟随底部规则。
- 不修改调度、CLI 调用、刷新频率、主题和现有未提交的启动 CLI 选择改动。

## 验收标准

- 相同内容刷新不重建已有气泡。
- 新增群聊记录时，已有气泡横纵滚动位置不归零。
- 相邻滚动容器独立恢复；内容缩短、移除及空补丁不抛错。
- 外层主区和提问列表仍遵循原有接近底部自动跟随规则。
- 最小单测、构建和 Chromium 真实 DOM 回归通过。

## 影响面与风险

- 代码：`src/webview/loopGroupChatPanel.ts`。
- 测试：`src/test/loop/loopGroupChatPanel.test.ts`。
- 文档：功能清单、能力规格及对应本体渲染规则。
- 风险：后代结构变化可能使原位置失效；按元素结构路径定位，节点不存在或类型不匹配时跳过，由浏览器夹紧超出内容范围的位置。

## 验证计划

- 单元自测：`npm run build && node --test dist/test/loop/loopGroupChatPanel.test.js`。
- 扩展回归：共享 Markdown 相关测试。
- 浏览器：使用 headless Chromium 加载实际生成的群聊 HTML，检查横纵滚动在重复补丁和新增消息后的值，并验证 Loop / Loop+。
- 文档：ontology 校验、改动范围空白校验。

## 任务列表

Tasklist:
- [completed] 定位群聊滚动回弹根因
- [completed] 修复滚动位置保留逻辑
- [completed] 补充回归验证与文档

## 测试与清单同步

- 单元测试新增：未变化内容复用、首次 HTML 规范化比较、多个嵌套区域横纵位置独立恢复、节点移除或类型变化、非法补丁不修改 DOM，共 5 条回归。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/webview/chatMarkdown.test.js dist/test/webview/chatCopy.test.js` 共 35 项通过。
- 浏览器命令：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/loop-group-chat-scroll/loop.json`，以及同目录的 `loopplus.json`、`baseline.json`。场景使用实际生成的群聊 HTML、共享 Marked / JSONFormatter、真实 5 秒定时刷新与 DOM 消息补丁，以本地宿主消息 mock 代替 VS Code 桥接；代码块限高仅用于构造同时存在横纵滚动条的夹具。
- Chromium 结果：Loop（1280×900）与 Loop+（760×900）均通过，代码位置从 `(scrollLeft=250, scrollTop=180)` 在定时刷新和追加消息后保持不变，宽表 `scrollLeft=130` 不变；外层历史阅读位置 `scrollTop=240` 保持，接近底部仍跟随；提问回复更新后同样保留横纵位置。三组场景均无页面、控制台、请求或 HTTP 错误，成功截图已检查。
- 旧实现对照：从 `HEAD` 取原 `replaceHtml` 替换进同一浏览器夹具，5 秒刷新后代码位置变为 `(0,0)`；baseline 场景以预期出现该回归为通过条件，证明覆盖原问题，而非证明旧实现正确。
- 失败处理记录：初次浏览器夹具使用错误表格选择器且含空内联事件处理器，归类为夹具问题，修正选择器并移除违反 CSP 的处理器；随后发现首次 HTML 比较受浏览器序列化影响，归类为实现缺口，改为首轮规范化比较、后续缓存原始来源，并补单测，重跑通过。
- 功能清单与本体：已同步功能清单、能力规格和 `plugin.rule.loop_group_shared_markdown`；ontology 校验通过。
- 踩坑沉淀：`.ch/docs/runbooks/PITFALLS.md` 新增“群聊补丁需保留气泡内部滚动”。
- 记忆判断：根因与验证保存在本计划及对应规格，不自动更新滚动摘要。

## 验证边界

- 未启动真实 Extension Development Host，也未发布或安装扩展；真实布局验证运行于 headless Chromium，宿主桥接使用夹具。
- 未运行全仓单测；执行群聊面板与共享 Markdown / 复制入口的最小相关回归，不扩大修复原有未提交改动。
- 场景和服务脚本为任务临时文件，结束后移除；结果与截图保留在 ignored 的 `.tmp/playwright-smoke/loop-group-chat-scroll/`、`loopplus-group-chat-scroll/` 和 `loop-group-chat-scroll-baseline/`。

## 当前结论

修复完成：相同内容不重建，必须更新时在 Markdown / JSON 挂载后恢复后代元素的横纵位置；提问回复复用同一逻辑，外层跟随底部规则不变。未改 CSS、刷新间隔或调度行为，未改动其他任务的启动 CLI 选择实现。
