# 产研部角色会话验证

此入口验证已安装 VS Code 的真实 Extension Host 是否从隔离任务与会话存储恢复总监、组长、员工及普通会话，并通过正常面板状态投影到 Webview。它是展示和恢复链路检查，不启动 CLI 或模型。

## 完整提示词与组长气泡链接验证（2026-11-17）

部门组长气泡按可信 Tab 角色隐藏“打开 Loop 群聊”，历史恢复和迟到角色更新均适用。总监 ☀️、组长 🌛、员工 ⭐️ 与普通 Loop/Loop+ 入口保持原合同。本轮四个相关界面测试文件 219/219，通过恢复、实时、迟到角色和普通入口对照；证据 `/tmp/department-leader-prompt-final-webview-tests.log`。

既有 `DEPARTMENT_TABS_ROLE_ICONS_ONLY=1` 浏览器入口同时断言气泡链接：`DEPARTMENT_TABS_DIST=<仓库>/dist DEPARTMENT_TABS_EVIDENCE=/tmp/department-leader-prompt-browser PLAYWRIGHT_MODULE=/tmp/department-role-form-playwright/node_modules/playwright` 配合 `node scripts/department_conversation_tabs_smoke.cjs`，1440 深色和 280 浅色均通过，严格浏览器错误为空，部门截图已目视检查。生成页面及消息桥证据不代替真实宿主执行。

另以物理隔离生产副本运行 `node scripts/verify_department_full_eh_integration.js --product /tmp/department-leader-prompt-product-yzz5ubny --report /tmp/department-leader-prompt-public-eh-final.json`，并设置上述 `PLAYWRIGHT_MODULE`。真实 VS Code 1.144.0 公开入口和 Codex CLI 0.167.2 配合本机确定性 provider 完成两次文本大写转换，包含总监派发、两名组长/员工、Loop+ 事件验收、总监汇报、四份原 receipt、closed 集合及容量归还。17 次本机请求无 provider 失败，宿主正常 exit 0，无强制收尾；EH 报告仍保留一条 `ERR_PROXY_CONNECTION_FAILED` 资源控制台错误，不声明该 EH 浏览器零错误。该场景不验证远程模型质量、七种 CLI 线上运行或其它平台。

首次运行因 Playwright 路径不存在、第二次因驱动仍操作旧档案控件失败；驱动按现有 CLI/模型/力度表单更新后最终通过，其自身回归 39/39。提示词根因、211 项运行时回归、最终包一致性与失败分类详见[修复计划](../exec-plans/completed/2026-11/2026-11-17-bugfix-department-leader-prompt-invocation.md)。未改用户任务或锁。安装版应使用本次重新导出的 VSIX 并重载，开发宿主应重载当前构建。

## 总监 Tab 仍显示月亮时

当前图标合同为总监 ☀️、组长 🌛、员工 ⭐️。普通 Loop/Loop+ 主任务仍为 🌛。若源码映射正确而总监仍显示 🌛，先核对已安装扩展的 `dist/extensionHost/sessionTabs.js` 是否实际调用 `projectDepartmentConversationTab`；只有渲染器中的太阳字面值、没有宿主传入的 `departmentPresentation`，会退回普通主任务图标。不要将所有主任务都改成太阳，也不要按会话名称猜角色。

2026-11-17 本机启用的安装版 1.9.11 缺少上述宿主投影，当前工作区已有完整接线。重新运行 `python3 scripts/export_vscode_extension.py` 导出 VSIX，再在 VS Code 扩展菜单选择“从 VSIX 安装…”并重载窗口；只构建源码或重载旧安装包不会更新扩展内容。本次仅生成安装包，没有替换用户安装或重启窗口。

验证记录：导出流程中的 `npm run build` 与通用包资源审计通过（`/tmp/department-tab-icons-package.log`）；四个角色/Tab 相关测试文件 30/30 通过（`/tmp/department-tab-icons-tests.log`）；现有 `DEPARTMENT_TABS_ROLE_ICONS_ONLY=1` Chromium 入口在 1440 深色、280 浅色下通过，浏览器错误为空，截图已检查（`/tmp/department-tab-icons-smoke/result.json`）。包内组合根、Tab 宿主、角色投影和图标渲染器与本次构建逐字节一致，且不同于旧安装版（`/tmp/department-tab-icons-package-audit.json`）。浏览器使用生成页面与隔离状态，不代表已安装扩展已生效或真实 CLI 执行通过。此处恢复既有显示合同，功能清单已有正确图标定义，无新增业务语义，ontology 无需更新。

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


## Round-675：新角色图标显示后继

本节是当前显示合同，覆盖前述历史段落中的旧emoji要求；原命令、截图及旧运行段落保留原时点事实，不追认为新emoji通过。部门总监☀️、组长🌛、员工⭐️；普通Loop/Loop+主任务🌛、子任务⭐️。原部门优先及main/subtask、模式判断不变，不按名称猜角色，无角色普通会话不装饰。Tab原名（Codex2等）、完整层级tooltip、身份和持久会话值不迁移。成员树头像仍总/组/员，28px圆形、12px居中、8px gap、4px行内边距及主题/布局/省略/状态/导航/关闭归焦结构均保留。

独立后继从已审e0ec605fc0b38ab0a59bb2268faac84efbeb3668建立于 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-role-icons-round675`，分支 `codex/department-role-icons-round675`。没有重做e9fea旧合并或刷新其build。round-443报告的具体完成事实和后附配置操作等待超时outcome=failed并存，本轮不改旧报告，不删除配置锁、改用户配置或路由。最终commit/tree及完整源码hash在round-675报告，sources.json仅追加后继事实。

### 本轮范围与首错

只替换现有显示字面值，并同步既有测试/smoke。公开面板观察器仍精确要求“产研部 · 总监 ☀️”和合法root字幕，保留foreign/unbound/duplicate/missing拒绝；在原负例中增加仅图标、组长caption加合法root和非法root验证，不能用图标授予权限。没有改部门授权、执行、CAS/联合准入、Owner/Ledger/receipt/CLOSED、冷恢复能力链或共享full EH driver。

- 两次后继标准build均exit0：第一次对应最初图标/测试输入；随后补齐观察器精确caption负例和测试标题后再做标准build。不是重跑已审e0ec旧build。新增负例后生产TS未再改变。
- 首轮既有定向14项：12通过、2失败，完整日志保留。根因是既有VM FakeElement缺少HTMLSelectElement.options，状态消息处理提前抛错，导致Tab/历史checkbox未渲染；没有为适配测试改生产模式逻辑。在原测试夹具补动态option后代集合，并在群聊定向用例断言没有webviewError。
- 仅重新编译测试夹具后重跑受影响的3项，3/3通过且无原窗口消息异常；其它11项的通过结果输入未变，直接复用。因此最终14个不同定向用例由未变11项+修复后3项覆盖，不是一次14/14全绿命令。未扩展到该大文件的全量用例。
- 成员树有界浏览器首次即通过1440深色/280浅色，browserErrors=[]。Tabs有界首轮在同活动director重复发送coding模式快照后等待auto-mode超时；这是场景重复身份未触发模式key变化，截图/日志/errors=[]均保留。场景改为每视口先切普通Tab，再按八个真实角色元数据身份切换；不改变生产模式判断。只重跑Tabs有界入口，最终两视口通过，browserErrors=[]。

### 实际命令与结果

以下cwd均为本轮新实体树。依赖用临时node_modules链接复用已有安装，未安装升级；dist为本树自产物。

```sh
npm run build > /private/tmp/department-role-icons-round675-evidence/build.log 2>&1
npm run build > /private/tmp/department-role-icons-round675-evidence/build-final.log 2>&1
node --test --test-reporter=spec --test-name-pattern='department tab labels|trusted department projection|moon and star|keeps the moon icon|prefixes non-vibe|opens the Loop group chat when|默认过滤子任务|子任务过滤叠加|initial HTML and content patch|role identity is reusable|department host loads in-page|cold public observer' dist/test/webview/departmentConversationTabsWebview.test.js dist/test/session/conversationTabLock.test.js dist/test/session/historySessionLoop.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/loop/departmentGroupChatPanel.test.js dist/test/loop/departmentGroupChatHost.test.js dist/test/extensionHost/departmentcoldstartproductionhost.test.js > /private/tmp/department-role-icons-round675-evidence/directed-tests.log 2>&1
./node_modules/.bin/tsc -p ./ > /private/tmp/department-role-icons-round675-evidence/fixture-recompile.log 2>&1
node --test --test-reporter=spec --test-name-pattern='opens the Loop group chat when|默认过滤子任务|子任务过滤叠加' dist/test/webview/clipagescriptruntimecoverage.test.js > /private/tmp/department-role-icons-round675-evidence/runtime-tests-final.log 2>&1
```

前两次标准build均通过；首轮定向命令exit1（12/14），最后重编译exit0、3/3命令exit0。只有测试假DOM在标准build之后改变，最后tsc覆盖其编译；生产TS及模板未改，不再刷新有效build或11项结果。JS语法通过：node --check分别检查department_conversation_tabs_smoke.cjs、department_group_chat_smoke.cjs、department_member_role_avatar_scenario.cjs、department_group_chat_host_smoke.cjs、verify_department_conversation_host.js；Tabs场景修正后仅重新检查该脚本语法。

浏览器复用仓库chromium-playwright-smoke严格错误采集原则及原专用Webview入口（无登录或用户凭据）。实际命令：

```sh
NODE_PATH=/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/node_modules \
DEPARTMENT_UI_DIST=/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-role-icons-round675/dist \
DEPARTMENT_UI_EVIDENCE=/private/tmp/department-role-icons-round675-evidence/group-browser \
DEPARTMENT_UI_ROLE_AVATAR_ONLY=1 \
PLAYWRIGHT_MODULE=/tmp/zq-playwright-smoke/node_modules/playwright \
CHROMIUM_PATH='/Users/fangjiawei/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
node scripts/department_group_chat_smoke.cjs

NODE_PATH=/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/node_modules \
DEPARTMENT_TABS_DIST=/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-role-icons-round675/dist \
DEPARTMENT_TABS_EVIDENCE=/private/tmp/department-role-icons-round675-evidence/tabs-browser-final \
DEPARTMENT_TABS_ROLE_ICONS_ONLY=1 \
PLAYWRIGHT_MODULE=/tmp/zq-playwright-smoke/node_modules/playwright \
CHROMIUM_PATH='/Users/fangjiawei/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
node scripts/department_conversation_tabs_smoke.cjs
```

首轮Tabs相同环境命令的输出目录为tabs-browser，日志tabs-browser.log，exit1；最终为tabs-browser-final，exit0；成员树为group-browser，exit0。均位于本轮独立evidence根，未覆盖旧证据。两个入口仅执行1440深色、280浅色；动态端口、结果、生成HTML、实际输入hash、截图分别留在其目录。pageerror、console error、requestfailed及HTTP>=400严格收集，不加忽略项。

成员树两表面初始HTML及真实contentPatch均核对☀️/🌛/⭐️，圆形头像顺序仍[总,组,员,组,员,组]、尺寸/对齐/间距不变；总监heading、群聊title、组长modal标题和子iframe heading、原验收定位/关闭归焦及窄屏无溢出通过。Tabs两视口核对[☀️ Codex,🌛 Codex2,⭐️ Codex3,Codex4,🌛 Codex5,⭐️ Codex6,🌛 Codex7,⭐️ Codex8]，覆盖部门优先、无角色、普通Loop和Loop+主/子、既有模式与完整tooltip、Tab/根无横向溢出。查看最终桌面部门Tab与窄屏普通子Tab、总监patch与组长patch截图确认可读；没有重做设计。

### 复用与开放门禁

e0ec旧组合/源码检查/build、额度纯策略13、845新增13及真实run4只读复核、5e5头像3渲染和双视口结果按未变输入继续复用；旧emoji显示部分由本轮结果更新，旧运行段落/截图不追认新emoji。run4原driver仍failed，修正完整driver未第五次运行；run1/2清理未知，不由run4成功背书。本轮浏览器只属生成HTML+显示fixture，不宣称新的真实CLI、额度EH、冷恢复或生产执行证明；并未启动这些场景。

仅字符显示改变，无新业务语义、权限或生命周期，因此无需更新ontology，不竞争并行任务文件。根feature保持active/in_progress。冷恢复已有开放所有者，不接管或重复派发；统一产品及最终组合验证依赖两项交付。必要异平台缺真实授权执行端口，Git同步合理合并与最终合并树全量回归须在实现测试完成后继续推进。本轮不fetch/pull/push、不发布，不改调度/active ids/Loop+快照或父记录。
