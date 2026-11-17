# 群聊运行中子任务打开对话标签

- 日期：2026-11-17
- 类型：feature
- 关联计划：无（保留当前工作区已有 Loop+ 调度改动）
- 状态：completed
- 负责人：Codex

## 背景与目标

Loop / Loop+ 群聊成员面板仅有验收反馈定位入口。运行中的子任务也应支持鼠标与键盘激活，展开 AI 对话面板并选中该子任务现有的运行标签。

## 范围与非目标

覆盖成员按钮、Webview 消息、宿主身份匹配与既有标签切换、回归及文档。不创建新会话，不恢复已结束任务，不改变派发、调度、自动关闭和验收定位规则，不触碰已有调度改动。

## 验收标准

- 经典 Loop 与 Loop+ 运行中子任务成员均可激活；初始和增量渲染一致。
- 按父任务和子任务身份匹配当前运行标签，优先最新运行标签，不串同名或其它父任务。
- 同一子任务运行时优先打开对话；已结束成员保留已有验收定位。
- 无效身份不跳转；已结束/关闭标签给出中文提示；打开失败显示原因。
- 构建、最小相关单测与 headless Chromium 鼠标/键盘/窄屏检查通过。

## 影响面与风险

影响 `src/webview/loopGroupChatPanel*`、`src/extensionHost/loopGroupChatPanelCoordinator.ts`、`src/extensionHost/loopSubtaskTabs.ts`、`src/extension.ts` 及相应测试。通过运行态和精确身份匹配避免旧标签、跨父任务跳转；继续复用既有 CLI/配置恢复与消息展示。

## 验证计划

- `npm run build`
- `node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChatAcceptance.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/extensionHost/loopSubtaskTabs.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`
- 使用实际生成 Webview HTML 与模拟 VS Code 桥在 headless Chromium 验证，扩展宿主调用通过真实协调器与标签解析器回归覆盖；不调用真实模型。
- 同步功能清单、群聊状态边界及 ontology，运行 ontology 校验与测试、空白检查。

## 任务列表

- 已完成：查证现有实现、业务规则与状态边界。
- 已完成：实现运行成员跳转并补回归。
- 已完成：构建、浏览器验证、文档同步与归档。

## 测试与清单同步

- `npm run build`：通过。首次编译发现新增测试夹具缺少 `ConversationTabRecord.sessionIdByCli`，补全夹具后通过，属于测试数据问题。
- 计划中的六个 `node --test` 文件：164/164 通过，无失败、取消、跳过或 TODO；日志 `/tmp/sinitek-loop-member-tests.log`。包含经典 Loop / Loop+、跨父任务/子任务/CLI 匹配、失效及异常、运行优先、HTML 转义、初始/增量渲染、原有验收定位与标签切换/关闭。
- Chromium：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/loop-member-tab/<classic|plus>-<desktop|narrow>.json`，四组全部通过。桌面 1280×800、窄屏 390×844；每组鼠标点击、Enter、Space 各一次，首次点击后收到真实生成的内容补丁，其后键盘继续有效。模拟消息桥把请求发送到真实协调器，真实标签解析器通过消息身份选择 `claude` 子任务运行标签，排除旧标签和另一父任务；展示、重叠和可见范围检查通过。每组无浏览器、HTTP 或请求错误。
- 浏览器首次未发现 Playwright，通过 skill 的 `--install-if-missing` 安装到临时工具目录，未修改仓库依赖。Loop+ 首轮验收入口断言因临时夹具误写反馈标题失败，按实际协议改为“验收结果”后四组复验通过；无对应产品缺陷。结果保留 `.tmp/loop-member-tab/{classic,plus}-{desktop,narrow}/result.json`、`success.png` 与 `host-evidence.json`；任务级场景文件在验证后清理。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，143 条规则；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `node scripts/check_trailing_whitespace.js <本次代码、测试及文档路径>` 与 `git diff --check -- <本次路径>`：通过。
- impeccable detector：仅报告既有 Markdown 引用样式 `border-left: 3px solid var(--vscode-textBlockQuote-border)`，本次按钮共用主题语义样式，没有新增发现；保留范围外样式。
- 已同步 `FEATURE_INVENTORY.md`、群聊状态边界、验收锚点说明及 ontology 的运行成员规则和验收定位边界。
- 验证边界：本机 macOS 下源码构建、单测及合成 Webview + 真实协调器/解析器验证；未进行已安装扩展/图形 Extension Host、真实模型或 Windows/Linux 原生验证。不改变 CLI 执行协议、平台路径或自动关页规则，复用既有标签切换能力。
- 记忆检查：本次行为已进入产品规格、设计与 ontology，无额外跨会话风险或可复用事故，不更新 memory 热区和 runbook。

## 当前结论

已完成：复用现有运行标签，不以标题或浏览器传入 tabId/sessionId 作为跳转依据。运行中按钮优先于历史验收反馈定位；构建、164 项相关回归、四组 Chromium 及文档/ontology 校验通过。
