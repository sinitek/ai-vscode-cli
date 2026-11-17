# 产研部组长完整提示词调用与聊天入口修复

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-17-bugfix-department-all-cli-execution.md`（沿用全部 CLI 支持）
- 状态：completed
- 负责人：Codex

## 背景与目标

运行日志显示组长在进入 Codex 原生准备前被 `leader-invocation-invalid` 拒绝。用户消息的序列化大小已超过部门层额外的 48 KiB 限制；同类限制也存在于 OpenCode 调用及两侧 64 KiB 私有 IPC 帧校验。目标是完整复用 Loop+ 提示词，不截断、不另加部门提示词上限；同时隐藏部门组长聊天气泡中的“打开 Loop 群聊”，包括恢复的历史消息。

## 范围与非目标

修复组长 invocation 数据合同及可信宿主至固定 worker 的私有传输，复用既有 CLI runner；精确身份、token、序号、单次 grant、清理与容量合同保持。全部七种 CLI 不增加准入限制。不修改用户已有任务、锁、会话或安装版，不发布扩展。

## 验收标准

- Codex/OpenCode 完整传递超过 48 KiB 和 64 KiB 的多语言、换行及转义提示词，重复调用不重复发送，冲突拒绝。
- 普通控制和 callback 消息仍执行原大小校验；错误身份、字段、空提示词拒绝。
- 部门组长聊天气泡不展示 Loop 群聊链接；普通 Loop/Loop+ 与总监入口保留。
- 标准构建、定向单测、隔离简单产研任务与浏览器检查完成，并明确真实 CLI/本机 provider 的证据边界。

## 影响面与风险

涉及 `src/runtime/departmentleader*`、`src/extensionHost/departmentleader*`、员工准备合同、Webview 消息操作及相关测试。仅可信且精确结构的 invocation 数据帧解除额外大小限制，员工配置预算排除提示词与承载提示词的 CLI 参数文本，其余控制与公共 socket 不变。长提示词最终沿用原 CLI/模型能力与资源约束。回滚须成对恢复宿主与 worker 的合同，不单侧修改传输校验；不通过截断提示词规避错误。

## 验证计划

- 先补回归并确认旧代码失败，再 `npm run build` 和相关 Node 测试。
- 使用隔离 HOME/任务库、固定本机 provider 和真实 VS Code/Codex 执行公开入口简单任务；不访问或接管用户任务。
- 使用生产 Webview 的既有 Chromium 夹具核对链接和原有入口。
- 同步功能清单、设计/排障及 ontology，执行结构与空白校验。

## 当前进展

已完成 ontology 和 bounded memory recall；CodeGraph 对当前链路覆盖不足且索引漂移，随后核对当前源码。日志堆栈指向当前工作区 `dist/extensionHost/departmentleadercodexbootstrap.js`，本次失败不能归因于旧安装包。旧 dist 对 116000 字节提示词（JSON 132041 字节）在 Codex/OpenCode 两合同均返回 false，确认根因。

新增 `departmentleaderinvocation.ts` 共用结构校验，Codex/OpenCode 宿主和固定 worker 同步使用，完整提示词不再受 48 KiB/64 KiB 部门预算影响。员工准备的 4 MiB 配置预算不再计算提示词。部门组长气泡按宿主确认的角色隐藏 `openLoopGroupChat`，渲染缓存加入角色上下文，覆盖历史恢复和迟到元数据。全部七种 CLI 沿用已完成计划的支持，不增加角色限制。

已同步功能清单、三份设计文档、PITFALLS 和 ontology；稳定排障知识已进入 PITFALLS，无需额外更新热区记忆。未修改用户运行数据、旧任务或安装目录。

## 测试与收尾记录

### 构建和自动化回归

- 两次标准 `npm run build` 通过，最终导出再次标准构建并通过资源审计；日志为 `/tmp/department-leader-prompt-final-build.log` 和 `/tmp/department-leader-prompt-package.log`。
- `node --test --test-reporter=spec dist/test/runtime/departmentleaderinvocation.test.js dist/test/runtime/departmentleadercodexowner.test.js dist/test/runtime/departmentleaderprocessowner.test.js dist/test/extensionHost/departmentleaderproductionhost.test.js dist/test/runtime/departmentcodexbootstrap.test.js dist/test/runtime/departmentprocessbootstrap.test.js dist/test/runtime/departmentopencodesessionpreparation.test.js`：211/211，无取消、跳过或 TODO，日志 `/tmp/department-leader-prompt-final-runtime-tests-recheck.log`。覆盖超过 48 KiB、64 KiB、4 MiB 的完整提示词、错误结构、超大配置拒绝，以及宿主/真实 worker/native 子进程的两轮逐字传递、去重和清理。
- `node --test --test-reporter=spec dist/test/webview/departmentConversationTabsWebview.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/session/departmentConversationTabs.test.js dist/test/session/conversationTabLock.test.js`：219/219，无取消、跳过或 TODO，日志 `/tmp/department-leader-prompt-final-webview-tests.log`。恢复、实时与迟到角色元数据均覆盖，普通 Loop/Loop+ 和总监入口保留。
- `node --test scripts/verify_department_full_eh_integration.test.js`：39/39，日志 `/tmp/department-leader-prompt-eh-driver-tests.log`。驱动改为操作当前 CLI/模型/力度表单，沿用激活档案，并核对实际执行绑定。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、ontology 工具 9 项测试与 `git diff --check` 通过。

### 浏览器与隔离生产简单任务

`DEPARTMENT_TABS_DIST=<仓库>/dist DEPARTMENT_TABS_EVIDENCE=/tmp/department-leader-prompt-browser DEPARTMENT_TABS_ROLE_ICONS_ONLY=1 PLAYWRIGHT_MODULE=/tmp/department-role-form-playwright/node_modules/playwright node scripts/department_conversation_tabs_smoke.cjs`：1440 深色、280 浅色均通过，`browserErrors=[]`。组长气泡链接隐藏、其它角色入口及 ☀️/🌛/⭐️ 保留，无横向溢出；两张部门截图已目视检查。证据是生成生产 Webview 和夹具状态，不是实际 CLI 证据。

`PLAYWRIGHT_MODULE=/tmp/department-role-form-playwright/node_modules/playwright node scripts/verify_department_full_eh_integration.js --product /tmp/department-leader-prompt-product-yzz5ubny --report /tmp/department-leader-prompt-public-eh-final.json`：从空任务库经真实 VS Code 1.144.0 Webview 公开入口启用产研部并发送简单文本转换任务，通过总监派发、两个组长、两名员工、真实 Loop+ 事件验收、统一验收方案和总监最终汇报。使用真实 Codex CLI 0.167.2 与本机确定性 Responses provider，17 次请求、provider failures=[]。四份原 Owner receipt 的必要清理项均 confirmed，两个执行集合 closed，容量 leaders/employees 均为空；宿主 exit 0，forcedTeardown=false。报告保留一条 `ERR_PROXY_CONNECTION_FAILED` 资源控制台错误，不能表述为 EH 浏览器零错误。

本机简单任务只证明 macOS 上真实 VS Code/Codex 与生产编排协议；不证明远程模型质量、全部七种 CLI 的线上实机或 Windows/Linux。未覆盖安装版、未重启用户窗口、未接管旧任务。

### 首次失败分类

- 初次 211 项运行时回归中一个新增员工夹具漏了 `subtaskId`/`attemptId`，被正确拒绝；补齐夹具身份后重编译，七文件重跑 211/211。未放宽生产身份校验。
- 初期 Webview 夹具因 system 消息合并和 `onlyShowFinalResults` 隐藏断言目标，改为明确的独立消息和显示状态后四文件 219/219；未改生产逻辑迎合夹具。
- 首次 EH 驱动 Playwright 路径不存在，第二次等待已删除的档案控件；改用现有 Playwright 和当前三控件表单后最终公开流程通过。早期失败报告保留，不追认成功。
- 包文件一致性审计首次误写 `dist/session/departmentConversationTabs.js`；核对真实路径 `dist/extensionHost/departmentConversationTabs.js` 后通过，属审计命令路径问题。

### 交付

`python3 scripts/export_vscode_extension.py` 退出 0，通用包资源审计通过；产物 `dist/sinitek-cli-tools-1.9.11.vsix`，38130550 字节，SHA256 `5a916a0a1689d1ebeecfad1edddae91f5fb64c67d71dfeb4a4c7416cd5525598`。`/tmp/department-leader-prompt-package-audit.json` 核对 12 个关键编译文件与当前 dist、隔离真实 EH 使用的生产副本逐字节一致，包含共用 invocation、两侧 host/worker、员工准备合同、消息渲染和宿主角色投影。仅导出包，未运行发布脚本、未覆盖用户安装。开发宿主需重载；使用安装版需从该 VSIX 安装并重载窗口。
