# 重置会话保留分组配置

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

重置会话通过替换当前 Tab 实现。Webview 将新 Tab 当成普通配置上下文切换，清空已选择配置和待应用状态，刷新返回旧配置时会覆盖用户选择。本次仅隔离会话重置和配置选择，不改变正常标签切换恢复配置的规则。

## 范围与非目标

- 范围：记录重置发起上下文；确认同 CLI 的旧 Tab 被空白新 Tab 替换时保留配置选择、待应用配置和待应用模型；补自动回归并同步功能清单与 ontology。
- 非目标：不调整重置回到 Vibe 的既有模式规则，不修改 CLI 配置格式、正常标签切换、用户真实配置或当前工作区已有的其它改动。

## 验收标准

- 重置成功后旧 Tab 被替换、新 Tab 消息清空，当前 CLI 和有效配置选择保持不变。
- 配置应用尚未完成或刷新携带旧配置时，重置不丢失用户新选择。
- 正常标签切换仍接受目标标签恢复的配置，不复用重置意图。
- 运行中及受锁定会话不能重置；构建和最小相关回归通过。

## 影响面与风险

- 代码：Webview 重置事件、面板状态合并及对应测试；复用现有扩展宿主重置行为。
- 文档：功能清单、已有配置恢复 ontology 规则。
- 风险：重置意图泄漏到后续普通切换；通过 CLI、原标签身份、旧 Tab 移除和新 Tab 空会话校验，并在上下文切换后消费意图。
- 回滚：仅撤回本计划对应的增量，不回滚工作区已有修改。

## 验证计划

- 构建：`npm run build`。
- 单元自测：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/session/conversationTabLock.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/session/conversationTabConfiguration.test.js`。
- 本机验证：使用生成的真实 Webview HTML 与 headless Chromium 点击重置，验证分组和配置选择；不调用真实 AI、不修改真实用户配置。
- 文档验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 和本次增量空白检查。

## 任务列表

- [completed] 定位会话重置影响分组配置的原因
- [completed] 修复状态隔离并补充回归测试
- [completed] 完成构建验证与必要文档同步

## 测试与清单同步

- 修复前新增的 6 项配置重置回归全部失败：预期 config-b，实际 config-a；确认是实现缺陷，再修复 Webview 的重置状态隔离。
- `npm run build`：通过。
- 新增回归共 16 项，通过：`node --test --test-name-pattern='preserves.*profile.*reset|reset profile when switching|resetting a .* conversation' dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/session/sessionTabCliSwitch.test.js`。
- 计划最小相关 4 个测试文件完整执行：144 项中 143 项通过，1 项既有错误气泡测试失败。
- 扩展验证：`node --test --test-skip-pattern='^keeps the owning conversation tab errored for error bubbles through append, update, collapse, and recovery$' dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/session/conversationTabLock.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/session/conversationTabConfiguration.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/webview/opencodedualmodelwebview.test.js`：184 项通过。
- 失败分流：`keeps the owning conversation tab errored for error bubbles through append, update, collapse, and recovery` 的 erroredRun 断言预期 true、实际 undefined；在模块加载时移除本次新增的运行时代码后单独执行同一用例，依旧同位置失败，确认为工作区已有、范围外失败。没有修改其实现或断言；基线输出保存在 `/tmp/sinitek-session-reset-baseline.log`，完整测试输出保存在 `/tmp/sinitek-session-reset-tests.log`。
- Chromium 验证：使用真实生成 Webview HTML、隔离的模拟 VS Code 消息桥，不连接真实 AI 或用户配置；Codex / Claude / OpenCode 各验证已选配置及待应用配置，6 个场景全部通过。验证点击重置后当前分组、配置 B 保留，旧消息消失，只剩新标签，且没有错误配置应用。浏览器错误、HTTP 错误、失败请求均为 0；已查看 Codex 待应用及 OpenCode 已选配置的截图。
- 浏览器首轮失败属于验证夹具问题：桥接断言误用不存在的 cliSelect，按真实 DOM 更正为 currentCli 后，全部场景重跑通过；未修改产品代码规避错误。
- 浏览器命令：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/session-reset-validation/<cli>-<0或1>.json --install-if-missing`；结果保存在 `.tmp/playwright-smoke/session-reset-<cli>-<0或1>/result.json` 和 `success.png`；任务专用消息桥、基线加载器和场景 JSON 已清理。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；本次文件 `git diff --check`：通过。
- 功能清单与既有 `plugin.rule.conversation_tab_execution_configuration` ontology 规则已同步；不涉及架构边界或跨会话未完成事项，不更新架构文档或热区记忆。
- 未执行全量单元测试、真实 VS Code Extension Development Host 或真实 CLI 联调；本次覆盖集中于配置状态合并、会话重置宿主逻辑和真实 Webview 浏览器点击流程，未修改真实配置。

## 当前结论

重置请求记录 CLI 与原标签身份；仅在同 CLI 的原标签被全新空白标签替换时保留配置选择及待应用状态。正常标签切换（包括切到已有空白标签）仍清理旧配置上下文并接受目标配置。构建、16 项新增回归、184 项相关测试与 6 个浏览器场景通过；已记录并隔离 1 项既有范围外失败，无本次任务未完成事项。
