# Loop / Loop+ 群聊复用 AI 对话 Markdown 渲染

- 日期：2026-10-24
- 状态：completed
- 负责人：Codex

## 背景与目标

群聊正文通过 `pre` 输出，提问弹窗也仅转义文本，没有使用普通 AI 对话的 Markdown、JSON 和 SVG 渲染链路。本次抽取并复用同一渲染运行时、资源和图片宿主能力，不另建解析器。

## 范围与非目标

- 覆盖 Loop / Loop+ 群聊时间线、总结及“我要提问”回复；兼容初始载入和增量更新。
- 保留沟通文件预览入口、用户交互、调度状态和滚动行为。
- 复用主题语义样式；不重新设计群聊布局、不改变 CLI 协议或验收逻辑。
- 保留当前工作区上一任务尚未提交的 SVG 总结提示变更。

## 验收标准

- 主对话和群聊调用同一 Markdown 渲染实现，支持标题、列表、表格、引用、代码、JSON、图片及 SVG。
- 群聊增量消息及提问回复同样渲染，思考动画和空态不受影响。
- 本地图片解析、内容区预览、下载复用相同安全边界；原始 HTML 不执行。
- 沟通文件仍能通过原有受限入口打开，代码中的路径不误变更。
- 构建、相关单测和真实 Chromium 冒烟通过。

## 影响面与风险

- Webview：共享渲染脚本及静态资源、主对话与群聊页面、图片宿主处理和样式。
- 文档：架构、功能清单、输出渲染规格、ontology 规则。
- 风险：脚本抽取后作用域缺失、JSON/CSP 不兼容、图片异步回调落入过期页面、群聊更新漏渲染。
- 缓解：最小抽取、复用现有验证、增加群聊及图片生命周期回归、浏览器检查初始与补丁路径；可整体撤销本任务变更回滚，无数据迁移。

## 验证计划

- `npm run build`。
- 定向 Node 单测：群聊、共享 Markdown/JSON/图片、ViewProvider 及相关运行时。
- Chromium：Loop 与 Loop+，检查富文本、SVG、JSON、沟通文件、提问与增量更新，含窄宽度及截图。
- ontology 校验与 skill 单测，变更文件空白校验。

## 测试与清单同步

- 新增 `src/test/webview/chatMarkdown.test.ts`，覆盖共享脚本、Markdown / JSON / SVG、安全回退及两种群聊模式的初始与补丁挂载路径。
- 更新群聊、图片交互及 JSON 资源缺失回退测试，保留既有沟通文件、图片生命周期和调度回归。
- 已同步 `ARCHITECTURE.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- 记忆：稳定行为归入规格及 ontology；没有新的可复用事故或踩坑时不新增事件记忆。

## 验证结果

- `npm run build`：最终重新构建通过；日志 `/tmp/sinitek-loop-md-build.log`。
- 最小相关单测 40 项及扩大回归 162 项均通过；最终合并重跑共 202 项通过，0 失败、0 跳过。命令：

  ```bash
  node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/webview/chatMarkdown.test.js dist/test/webview/chatImagePreview.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/webview/viewProvider.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/looppluswebviewintegration.test.js dist/test/loop/loopCommunicationFilePreview.test.js dist/test/loop/loopGroupChat.test.js dist/test/extensionHost/loopPlusSubtaskChat.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js
  ```

  日志 `/tmp/sinitek-loop-md-final-tests.log`。
- 使用实际生成的群聊 HTML、真实本地 SVG 读取及模拟 VS Code 消息桥运行 Chromium 冒烟；Loop 为 1280×900，Loop+ 为 760×900，均通过，浏览器、HTTP 与请求错误均为 0。覆盖标题、代码、表格、引用、JSON 树、SVG、本地图片、预览 / 下载消息、沟通文件预览、代码路径排除、提问富文本及增量补丁。
- 冒烟命令：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/loop-md-loop.json` 及同命令的 `.tmp/loop-md-loop-plus.json` 场景。结果与截图保留于 `.tmp/playwright-smoke/loop-md-loop/`、`.tmp/playwright-smoke/loop-md-loop-plus/`；临时场景、服务及图片夹具清理，不写入仓库。
- 浏览器验证不使用真实模型 / CLI，也不等价于 Extension Development Host 人工验收；系统图片预览和另存为由既有宿主单测覆盖，浏览器检查消息正确发出。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- `git diff --check` 及变更文件 `scripts/check_trailing_whitespace.js` 检查通过。
- impeccable 机械检查仅报告共享样式中既有 Markdown 引用的主题色左边框；该样式本次未改，不为设计偏好扩大改动。报告 `.tmp/loop-md-design-detect.json`。

## 失败分类与处理

- 实现缺陷：初版使用目标 TS lib 不支持的 `replaceAll`，改为 `split / join`；新增脚本正则存在无效转义，已修正。最终构建和相关运行时测试通过。
- 断言过期：群聊正文由 `pre` 变为 Markdown 容器；无硬编码颜色的断言收敛到 CSS，避免扫描新嵌入的既有第三方脚本。断言已与行为同步。
- 测试夹具：独立事件运行时补充共享图片处理函数，VM 补充 `TextEncoder`，群聊用例补齐可见回合；浏览器图片定位从重复文本收敛到 SVG 图片属性。最终均通过。
- 未遗留本任务相关失败；不修改范围外业务和上一任务 SVG 总结提示变更。

## 当前结论

已抽取 `chatMarkdown.ts`、`markdownAssets.ts` 和 `chatImageHost.ts`，普通 AI 对话与 Loop / Loop+ 群聊使用同一渲染与图片能力；初始、增量和提问路径验证通过，保留原有交互及安全边界。任务完成，无数据迁移或额外配置要求。
