# 对话图片输出与内容区预览

- 日期：2026-10-23
- 状态：completed
- 负责人：Codex

## 目标与范围

复用现有 Markdown 渲染，向普通对话及隐藏重试的最终回复规则补充图片格式；图片在气泡内自适应显示，点击或键盘激活后在 VS Code 内容区预览。安装用户提供的本地 `draw-ai-image` 技能包。

## 非目标

不重建聊天渲染系统，不调用付费生图服务，不读取任意本地图片文件，不修改现有 CLI 配置或技术栈。保留开始任务后发现的其他工作区改动。

## 验收标准

- 普通对话与隐藏重试提示包含 `![图片说明](图片地址)` 输出约定，不伪造图片地址。
- HTTP(S) 与受限图片 data URL 能展示；脚本协议、任意 HTML、文件协议不能用于图片加载或预览。
- 图片不超出气泡，支持鼠标及键盘打开内容区预览，不调用外部浏览器。
- 技能解包至 Codex 全局 skills 目录，保留原有技能，不安装 Python 缓存。
- 相关回归测试、`npm run build`、浏览器冒烟通过；宿主真实使用由用户验证。

## 影响面与风险

- 提示规则：`src/finalAnswerProtocol.ts`。
- 图片展示和预览：`src/webview/`。
- 规格、本体与回归测试同步；无数据库变化。
- 预览 Webview 禁用脚本、本地资源和默认网络权限，仅允许经过校验的图片源。
- 原始技能需要调用方自己的 API 环境配置，本次不探查、不写入密钥。

## 验证计划

- `npm run build`。
- `node --test dist/test/webview/chatImagePreview.test.js dist/test/webview/viewProvider.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/extensionHost/promptRuntime.test.js`。
- 对生成的实际 Webview HTML 做 headless Chromium 图片加载、点击与窄屏布局验证。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。

## 当前结论

已完成最终回复图片格式规则、Markdown 图片自适应展示、鼠标与键盘触发的内容区预览，以及指定 Codex 技能包安装。复用原有 Marked，没有引入依赖或改造渲染系统。

## 验证结果

- `npm run build`：通过。
- 上述最小相关单测：25 项通过，0 失败；另执行 `node --test dist/test/extensionHost/promptRuntimeCoreCoverage.test.js`，10 项通过。
- `node --test dist/test/webview/clipagescriptruntimecoverage.test.js`：81 项中 77 通过、4 失败。三项指令折叠摘要位置断言过期，一项隔离测试缺少 `enabledRuleCliNames`。将 HEAD 版本测试编译至临时目录、针对这四项运行，复现相同失败；对应业务源码没有本轮修改，归类为历史断言/夹具问题，不扩大修复范围。
- Chromium 冒烟使用当前构建生成的完整聊天 HTML 与模拟 VS Code bridge：1440×1000、420×900 两种视口，验证 HTTP 与 data 图片真实解码、点击请求预览、图片无裁切且不溢出；桌面另验证 Enter/Space 请求预览。独立预览 HTML 验证通过，三组均无浏览器/网络错误。截图保留在忽略目录 `.tmp/chat-image-preview/` 下的三个 `*-result/` 目录。
- 首轮截图发现全局按钮 26px 固定高度裁切图片；已通过图片按钮 `height: auto` 修复并补断言。第二轮截图确认原比例显示，记录至 `.ch/docs/runbooks/PITFALLS.md`。
- UI 静态扫描只报告原有 Markdown blockquote 的 3px 边线提醒，与本次图片样式无关，未改动。
- Ontology 校验和 `git diff --check` 通过；产品规格、功能清单与本体规则同步。

## 技能安装与人工验收边界

- 压缩包的 `draw-ai-image` 安装至 `~/.codex/skills/draw-ai-image`，三个文件与压缩包逐字节一致；跳过 `__pycache__`，未覆盖已有技能，Python 脚本语法检查通过。
- 没有调用生图 API、探查或写入用户密钥；实际生成依赖用户现有的 API 环境配置。
- 未自动重启 VS Code、启动真实 CLI 生图或覆盖已安装扩展。真实 Extension Host 内的内容区打开行为和生图端到端流程留给用户按约定验证；本轮浏览器使用模拟 bridge，宿主路由以单测覆盖。
- 安装属于用户级环境操作，不进入仓库技能 catalog。README 已有其他工作区改动保持原样；不更新滚动摘要或重复热区记忆。
