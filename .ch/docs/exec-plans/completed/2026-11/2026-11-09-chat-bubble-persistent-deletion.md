# 气泡限额真正删除插件消息与存档

- 日期：2026-11-09
- 状态：completed
- 负责人：Codex

## 背景与目标

前轮仅过滤显示，原消息仍占清理区间。用户明确要求真正删除，并通过结构化确认选择删除插件内存与本地会话存档，重开不恢复；不修改外部 CLI 的日志与上下文。

## 范围与非目标

- 沿用超过 110% 触发、最早 20% 批次内跳过用户与最终答复、不向后补删的规则。
- Webview 提交候选，宿主校验 Tab/CLI/会话身份、消息快照、保护状态，先写盘再原地移除缓存及运行中数组。
- 修复删除后的流式数组索引；防止重复渲染连续补删、持久化失败假成功及会话切换误删。
- 不发布、不提交、不改 CLI 日志、不做无关布局或配置升级；保留外部并发修改的 package.json。

## 验收标准

- 插件内存和本地 JSON 均无被删消息；清缓存后重新加载仍不恢复。
- 多轮追加均按剩余消息数量触发清理，重复渲染不连续补删。
- 用户和主色边框最终答复保留，思考/指令同等清理，流式活动消息临时保护。
- 写盘失败、旧会话请求、内容已变化及受保护候选不误删。
- 正在输出的消息不因前方删除而写到错误位置；Tab 隔离、结果过滤、DOM 复用不回退。

## 影响面与风险

- 代码：Webview 渲染/消息路由、sessionLifecycle/sessionStore、运行中消息索引及相关单测。
- 文档：保留设计、功能清单、本体。
- 风险：删除不可恢复，因此写盘失败不删除内存；校验身份和快照并从宿主返回权威剩余消息。
- Claude 自动修复不能从 CLI 日志重新补回主动裁掉的过程消息，需持久化裁剪标记。

## 验证计划

- `npm run build`。
- 先执行气泡、会话生命周期、路由和流式相关最小单测，再扩大回归。
- 使用 headless Chromium 与合成宿主验证多轮清理及设置提高不复活旧消息；不等同真实 VS Code/CLI 验证。
- 本体校验、脚本单测、`git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：宿主真实缓存/运行中数组/JSON 删除及重开、Claude 自动修复抑制、草稿标记随绑定/迁移、写盘失败、过期身份和快照、主运行索引、交互流式按 ID 重定位、连续批次、重复渲染不补删、后台回复隔离、宿主路由、原子写入失败保护和中文设置文案。
- 单元自测结果：`npm run build` 通过，16 文件 328/328 单测通过；本体验证通过，本体脚本单测 9/9；`git diff --check` 通过。
- 失败处理记录：首次编译发现 TypeScript 不能根据辅助函数返回值缩窄可空索引，改为显式局部索引；首次运行时回归发现序列化函数引用导出常量会被 CommonJS 编译成 `exports.*`，改为显式传入标记；随后 3 项最小夹具失败是缺少运行状态全局变量，补齐夹具，扩大回归全部通过。没有绕开生产校验或修改无关功能。
- 功能清单与设计、本体：已同步。现有架构规定 Webview 只发协议、宿主负责文件 IO，本次遵循原边界，无需修改 ARCHITECTURE.md。稳定规则保留在设计和本体，不重复写入记忆热区或 EVENT_MEMORY。

### 最终单元验证命令

```bash
npm run build
node --test dist/test/webview/chatBubbleRetention.test.js dist/test/webview/chatBubbleRetentionWebview.test.js dist/test/session/sessionLifecycleCoreCoverage.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/shared/atomicWrite.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionStoreCoreCoverage.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/instructionGroupSummary.test.js dist/test/webview/codexThinkingPlaceholder.test.js dist/test/core/chatMessageLimit.test.js dist/test/session/sessionMessageRouter.test.js dist/test/extensionHost/primaryPromptRunController.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
git diff --check
```

日志：`.tmp/bubble-persistent-delete-build.log`、`.tmp/bubble-persistent-delete-final.log`、`.tmp/bubble-persistent-delete-ontology.log`、`.tmp/bubble-persistent-delete-ontology-tests.log`。

### 真实浏览器与本地存档证据

- 使用 skill runner：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/bubble-persistent-delete-desktop.json --install-if-missing`，窄屏场景为 `.tmp/bubble-persistent-delete-narrow.json`；临时页面/场景在验收后移除，服务已停止，不变更依赖或生产 CSP。
- 实际生成 Webview 与真实 `sessionLifecycle` 由本地适配器连接；宿主操作系统临时目录下的真实 JSON。浏览器通过携带原 nonce 的脚本消息传输，未放宽 CSP。只替代 VS Code API 与宿主传输，不把它描述为真实 VS Code Extension Development Host/CLI。
- 桌面 1280×960、窄屏 420×900 各通过 14 项页面断言与 4 项 runner 检查；浏览器错误、HTTP 错误、请求失败均为空，截图已查看。
- 551 项中最早 100 项含用户和最终答复两项，真实删除 98 项、磁盘和内存均剩 453。再追加 97 项不清理，再追加 1 项后触发第二批，继续真实删除 98 项并剩 453；保留区间外第 198 项。
- 提高上限不恢复旧消息；使用全新宿主控制器读取磁盘仍剩 453 项；结果模式只显示用户与最终答复而不改变剩余数据。
- 证据：`.tmp/bubble-persistent-delete-smoke/desktop/result.json` 和 `success.png`，窄屏同名文件在 `narrow/`。
- 未执行全仓单测/覆盖率门禁、真实扩展宿主/CLI、Windows/Linux 实机、独立长列表基准或真实 VS Code 主题验收。

## 决策记录

- 2026-11-09：用户选择“消息与本地历史都删除”，只作用插件数据，不修改外部 CLI 原始会话。
- 2026-11-09：宿主成功落盘后才确认删除；删除后重新计数，但同一批返回后的重复渲染不向后补删。

## 当前结论

真正删除已实现且针对性构建、328 项单测、双视口真实 Chromium/临时 JSON、本体验证通过。规则与文档已同步。源码未提交、未发布，未修改真实用户会话；保留外部并发改动的 package.json 版本 1.8.11。
