# 产研部角色会话验证

此入口验证已安装 VS Code 的真实 Extension Host 是否从隔离任务与会话存储恢复总监、组长、员工及普通会话，并通过正常面板状态投影到 Webview。它是展示和恢复链路检查，不启动 CLI 或模型。

## 运行

在带有项目依赖的独立源码副本中运行，避免写入共享 `dist`：

```bash
npm run build
node scripts/verify_department_conversation_host.js
```

需要已安装 VS Code。Playwright 默认从 `/tmp/zq-playwright-smoke/node_modules/playwright` 加载；其它安装位置可设置 `PLAYWRIGHT_MODULE`。脚本输出新建的 `/tmp/sinitek-dept-conversation-*` 证据目录，含 `report.json`、VS Code 日志和桌面、窄屏、部门弹窗截图。

## 隔离与证据

脚本只在新建临时根目录内创建 HOME、workspace、user-data、extensions、生产任务仓储和会话文件。fixture 通过生产任务仓储和会话持久化 API 写入已完成历史；预置 writer 正常关闭并释放 owner marker 后，才启动 Extension Host。VS Code 使用隔离 HOME、环境变量白名单、内存 secret storage 和自动激活，再通过正常的 `openPanel`、会话恢复、状态推送和真实 Webview 检查标签、tooltip、模式、键盘操作及总监群聊内的组长弹窗。验证器按构建输出的 `dist/test/extensionHost` 大小写加载 fixture，并在等待 Webview 时重新查询 CDP targets。正常通过要求 VS Code 退出码为 0、无残留进程、owner marker 已释放且没有强制清理。

标签检查确认总监、组长、员工仅在原 CLI 标签前增加 `👴🏻`、`👨🏻`、`👶🏻` 图标，原名如 `Codex2` 不变；宿主退出后还会读取隔离生产 session store，断言原始五个标签未被装饰文本覆盖。两个同名模块组长的标签仍保留各自既有会话名称；完整层级与身份由 tooltip 区分。窄屏检查通过拖动编辑区分隔条缩窄实际 Webview surface，并记录工作台几何和 Webview `innerWidth`；旧的仅缩小整个工作台截图（`webview-narrow.png`）中 Explorer 遮挡目标面板，不作为窄 Webview 可见性证据。

`scripts/department_conversation_tabs_smoke.cjs` 是生成完整 Webview runtime 的浏览器回归夹具，使用生产角色投影函数和明确声明为可用的模式状态，但通过 fixture `PanelState` 与 VS Code API bridge 驱动，不属于真实 Extension Host 证据。它断言可见标签严格保留原 `Codex`、`Codex2`、`Codex3` 名称并只增加对应角色图标；角色中文名、模块及完整 root/task/employee 身份只在 tooltip 中断言。窄视口同样检查原名和 tooltip，不要求短任务 ID 出现在标签。运行时应将 `DEPARTMENT_TABS_DIST` 指向本次独立源码构建的 `dist`，并设置 `DEPARTMENT_TABS_EVIDENCE` 与 `PLAYWRIGHT_MODULE` 指向隔离证据目录和 Playwright 安装；不要用共享 `dist` 作为本次源码证据。

组长弹窗检查等待加载状态结束、嵌入式 sandbox `about:srcdoc` frame 建立 execution context，再核对该 frame 的精确 leader task ID、模块、Loop+ 状态和适用于已完成历史的操作栏。关闭后核对打开按钮焦点和阅读位置恢复。仅看到 backdrop 或共同模块标题不算加载完成证据。

2026-11-14 round-121 已补过 macOS 真实宿主的弹窗与实际窄面缺口，证据在 `/tmp/sinitek-dept-conversation-J6j2qa/report.json`：VS Code 1.144.0 / Chromium 150，精确组长 `host-department-leader-one-18129d95-l00000021` 的真实 opaque-origin `about:srcdoc` 执行上下文、`event_driven` 与完整历史状态操作栏（刷新、进度；不适用的停止/补充/续跑等动作隐藏）通过。先展开真实成员抽屉，再鼠标点击可见组长按钮和关闭按钮；同一 task/instance 只有一次 load 和 close，未发送 stop/cancel，关闭后恢复同一打开按钮焦点及原阅读位置（本 fixture 为非零 scrollTop 120，关闭后仍为 120）。这不验证运行态操作或模型调用。

本轮拖动的是由目标 iframe 几何定位的右侧 auxiliarybar sash，未缩放工作台：1280×900 工作台中的目标 iframe 边界为 left 999 / right 1274 / top 68 / bottom 862，实际宽度与产品 `innerWidth` 均为 275px，完整可见；tab 边界、全层级 tooltip 和无页面溢出通过。请求侧栏约 280px 后得到该表面宽度，没有据此断言宿主最小宽度。截图为 `webview-department-dialog.png`、`webview-department-dialog-closed.png`、`webview-narrow-measured.png`、`webview-narrow-surface.png`、`webview-narrow-leader-tooltip.png`，均已目视检查。正常退出为 code 0 / signal null、`normalExit=true`、`forcedCleanup=false`、`remaining=[]`，owner marker 已释放；生产会话原名落盘仍为 Codex～Codex5。

round-117 的 `3FWefU` / `XXgudT` 以及本轮中间失败目录仍是失败诊断，不记为正常退出或弹窗通过。根因是 VS Code 的 API 注入将产品 `window.parent` 重写为本窗口，真实宿主消息来源却是外层 shell；产品现在要求同源且发送源文档的 `#active-frame.contentWindow` 精确等于当前窗口，子 frame 的 opaque origin、精确 source、channel 和 task/instance 校验保持独立。验证器固定使用 default execution world，通过 CDP 观察冻结的生产 API 函数调用，并按精确 parent-frame / target 身份附加可能不在父 Page tree 中的 srcdoc OOPIF；不能因 isolated-world trace 为空或父 frame tree 缺少 OOPIF 就断言未发送。临时宿主诊断只存在独立构建副本，最终构建不含诊断注入。

该夹具不会读取真实用户会话、配置或系统凭据，不发送模型请求，也不证明真实 CLI/模型启动、冷恢复、容量释放、跨进程 owner 恢复或完整生产组织组合。浏览器运行在 VS Code 的 Chromium/Webview 中；CDP 检查真实生产页面，不以手工 PanelState 或 mock bridge 代替宿主。主题窄屏结果只覆盖实际报告列明的平台与主题。本轮未调整布局、CSS 或交互设计；真实宿主成功证据仅覆盖本段列出的 macOS 深色历史 fixture。未变的 round-26 深浅主题和 round-27 窄屏 tooltip 结果仍是浏览器夹具证据，不是这次真实 EH 的跨主题证明。该展示修复不改变业务 ontology。
