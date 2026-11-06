# AI 对话任务列表滚动稳定性修复

- 日期：2026-11-06
- 状态：completed
- 负责人：Codex

## 背景与目标

任务列表的 `renderTaskList` 每次刷新都会销毁 `.tasklist-items` 滚动容器，即使内容与高度不变，浏览位置也会回到顶部。修复同一任务列表的重复刷新和进度更新，不改变显示、折叠、运行结束清空及 Tab 隔离规则。

## 范围与非目标

- 范围：任务列表局部 DOM 渲染、回归测试、功能清单。
- 非目标：聊天主区域滚动、CLI 协议、任务生命周期、布局与主题。

## 验收标准

- 重复渲染、任务状态或等高文本更新不重建滚动容器，保留滚动位置及已有任务行。
- 增删任务正确反映内容；实际内容高度缩小时允许浏览器自然约束滚动范围。
- 不同任务列表不继承上一列表滚动位置，清空与后续新建正常。
- 相关单测、构建和真实 Chromium DOM 验证通过。

## 影响面与风险

- 代码：`src/webview/viewContentScript/taskListAndUi.ts`。
- 测试：`src/test/webview/openCodeTaskListOverlay.test.ts` 及相关 Webview 回归。
- 文档：功能清单与执行计划；仅修复渲染，不改变业务语义，无需新增 ontology 规则。
- 风险：Tab 切换错误复用容器；通过任务列表状态对象标识隔离，补回归测试。
- 回滚：撤销本次局部渲染改动与对应测试。

## 验证计划与记录

- `npm run build`。
- `node --test dist/test/webview/openCodeTaskListOverlay.test.js dist/test/webview/loopMainTaskList.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`。
- headless Chromium 加载实际任务列表脚本与样式，验证重复渲染、状态更新、滚动位置与尺寸。
- 回归先红后绿：原实现未通过新增容器身份与滚动位置断言；局部更新后通过。
- `npm run build`：通过。
- 最小相关单测：158/158 通过；`node --test dist/test/webview/*.test.js`：390/390 通过。
- `node .tmp/task-list-scroll-smoke.cjs`：加载完整实际 Webview HTML、运行时与样式，以模拟 VS Code 消息桥驱动运行开始、任务列表更新与消息重绘。1280px、420px 下，列表高度 525px、视口 97px；旧版重复重绘后 `scrollTop` 从 120 变为 0，修复版重复 30 次重绘、更新进度和等高文本、追加任务均保持 120。内容缩短至单行自然归零。无浏览器、HTTP、请求或 Webview 错误。
- 标准 skill runner 的布局检查通过，截图已检查；结果保存在 `.tmp/playwright-smoke/task-list-scroll/result.json`、`layout/result.json`，截图为同目录 `fixed-1280.png`、`fixed-420.png` 与 `layout/success.png`。
- `git diff --check`、Impeccable detector 与 ontology 校验通过。ontology 无业务概念、权限、生命周期或事实来源变化，无需修改。
- 失败分流：全 Webview 测试首次运行后，shell 使用 zsh 只读变量 `status` 导致包装命令报错，但日志 390/390 已通过；改用 `test_exit` 后重跑确认退出码。
- 验证边界：未启动 Extension Development Host，未调用真实模型、未发布或安装扩展；滚动与布局使用本机真实 Chromium。

## 文档与记忆同步

- 功能清单补充刷新保留浏览位置的契约。
- 已在 `runbooks/PITFALLS.md` 记录容器重建导致滚动丢失的复用经验；不重复写入热区记忆或事件记录。

## 当前结论

修复和验证完成；保留同一列表的滚动容器，从根因消除无高度变化的滚动归零，显示布局及生命周期保持不变。
