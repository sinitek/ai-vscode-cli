# ZCode 上下文用量与原生压缩修复

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

ZCode 分组持续显示初始化的 `0k`，且常用指令未开放压缩入口。核对本机官方 ZCode 0.17.0：帮助明确列出 `/compact`，协议支持 `session/compact`；真实最小对话后 `projection.contextUsed` 为 17956，窗口为 200000。因此保留真实用量与原生压缩，不伪造统计或本地摘要。

## 范围与非目标

- 修正未知用量展示、手动压缩入口、自动压缩说明与原生压缩完成确认。
- 复用既有执行后自动压缩开关、会话映射、主题样式和测试夹具。
- 不修改用户配置、CLI 版本、其他 CLI 的能力边界或布局。

## 验收标准

- ZCode 初始化零值或缺失统计不展示标签；收到真实正数后显示，切换标签页不串值。
- ZCode 常用指令可以触发原生压缩；运行时禁用，结束后恢复。
- 执行后自动压缩覆盖 ZCode，相关说明准确。
- 压缩恢复原生会话，等待真实终态才报告成功；失败、取消不误报。
- 补充协议、runner、宿主压缩及 Webview 回归测试，构建通过。

## 影响面与风险

- 代码：`src/interactive/`、`src/contextCompactionRunner.ts`、`src/webview/`。
- 文档：ZCode 使用指南、功能清单及运行时 ontology 规则。
- 原生压缩异步返回 `accepted`，不能当作完成；需在请求前挂接终态监听，覆盖早到事件和恢复会话。
- 不读取或记录凭据、原始对话与用户私有运行数据。

## 验证计划

- 最小测试：ZCode 协议、runner、上下文压缩及页面运行时相关测试。
- 构建：`npm run build`。
- 本机验证：`zcode --version`、`zcode --help`、最小真实对话及原生压缩。
- 浏览器：使用实际 Webview 脚本进行 headless Chromium 场景验证。
- 文档：ontology 校验与相关文档契约测试。

## 任务列表

Tasklist:
- [completed] 核查 ZCode 上下文与压缩能力
- [completed] 按支持情况修正实现并补充测试
- [completed] 完成验证并同步相关文档

## 实现结论

- 协议读取器排除初始化零值；Webview 同时防御旧运行状态中的零值，其他 CLI 的合法零值展示不变。
- 两处现有常用指令可见性判断均补入 ZCode，更新全局自动压缩说明及 5 分钟门槛文案。
- 压缩前启动／恢复 runner；在请求前监听原生同会话终态，忽略接收确认、无关会话和普通回合完成事件。失败、取消、退出和释放均终止等待，防止假成功。
- 压缩完成后向原 Tab 发送真实新用量，保留原生会话映射。

## 验证结果

- `npm run build`：通过。
- `node --test dist/test/interactive/zcodeAppServerProtocol.test.js dist/test/interactive/zcodeRunner.test.js dist/test/core/contextCompactionRunner.test.js dist/test/webview/multiAgentSettingWebview.test.js dist/test/loop/loopMainAutoCompact.test.js dist/test/config/zcodeConfig.test.js dist/test/interactive/zcodeTrace.test.js`：85 项通过。
- `node --test --test-skip-pattern='keeps the owning conversation tab errored' dist/test/webview/clipagescriptruntimecoverage.test.js`：其余 103 项全部通过；连同上一组共 188 项 TypeScript 回归通过。
- 页面全量中有 1 项既有失败：`keeps the owning conversation tab errored for error bubbles through append, update, collapse, and recovery`，断言 `undefined !== true`。使用 `git show HEAD:src/webview/<module>.ts` 将本次四个修改过的 Webview 模块恢复为内存中的原版导出，再以 `node --test-name-pattern='keeps the owning conversation tab errored'` 运行同一测试，仍以相同位置和断言失败，归类为历史／范围外失败，不扩大修复。
- 首轮构建发现宿主消息端口只接受任务列表消息，已扩展为最小联合类型以支持压缩后的用量通知；工具设置既有文案契约要求“全局设置”，已保留并增加 ZCode 和门槛断言，相关测试重跑通过。
- 本机官方 `zcode --version` 为 0.17.0；真实 runner 实测初始化用量为 `null`，一轮最小对话用量为 17956 / 200000，原生压缩终态后为 7837 / 200000。独立原生协议探测也确认 `compact_started → accepted → session_compacted`，接收确认不是完成。
- headless Chromium：1440×900 与 420×900 各 7 个结构化场景，共 14 项通过。覆盖零值隐藏、真实用量及悬停来源、手动指令发送、压缩中禁用、完成刷新、失败恢复、能力不可用和工具设置入口；无页面错误、HTTP 错误或请求失败。已查看宽屏完成态、窄屏压缩态和窄屏设置截图。
- 浏览器夹具校准：首次重叠检查错误选取空闲时隐藏的状态文本，改为真实可见的提示词按钮；失败场景应恢复上一条已知真实用量，而非清空，修正夹具断言后整组重跑通过。未改动生产布局。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- Impeccable 机械检测无告警，`git diff --check` 通过。

## 文档与记忆判断

- 已同步 `docs/zcode-guide.md`、“ZCode 真实用量与原生压缩”功能清单及 `plugin.rule.zcode_context_compaction` ontology 规则。
- 稳定协议陷阱直接沉淀到 ZCode 指南，任务过程留在本计划；不新增重复热区记忆、事件记忆或 skill，不写入 `ROLLING_SUMMARY.md`。
- 未执行 Windows 真机及 Extension Development Host 端到端验证；本次未新增平台路径处理，已用真实 macOS CLI、实际 Webview HTML／脚本及宿主单测分层覆盖。
- 无未决功能问题；唯一范围外项为已基线复现的既有页面错误状态测试。
