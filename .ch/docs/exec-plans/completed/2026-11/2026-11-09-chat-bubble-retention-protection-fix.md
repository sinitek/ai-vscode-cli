# 气泡清理区间与最终答复保护修复

- 日期：2026-11-09
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-09
- claim_ttl：本轮任务
- handoff_to：无

## 背景

用户反馈调整“每个标签页气泡上限”后，指令气泡消失但部分思考气泡留存。当前保留规则保守保护无最终标记的普通助手正文，与界面的主色边框最终答复判定不一致；清理还会越过最旧批次内的保护消息向后补删。

## 目标与范围

- 沿用超过基准 10% 触发、每批基准 20% 的累计清理区间。
- 只检查最旧区间；其中的用户发起、界面判定的最终答复跳过，不向后补删。
- 思考、普通过程正文、指令按时间同等处理；正在流式输出的正文临时保护。
- 只改变显示投影，原始消息、持久化、上下文与回放不变。

## 非目标

不修改 CLI 最终结论协议、配置范围、颜色布局、DOM 缓存阈值或历史自动清理；不运行发布脚本，不创建分支或提交。

## 验收标准

- [x] 最旧区间内的思考与指令均可清理，无最终标记的普通助手正文不额外保护。
- [x] 最终答复保护直接复用主色边框判定，用户发起一律保护。
- [x] 区间内保护项不向后补删，区间以外的新指令/思考保持原顺序。
- [x] 550/551/650/651、极小基准、重复渲染、流式更新与多 Tab 相关测试通过。
- [x] `npm run build`、相关单测、必要的 Chromium 页面验证及本体验证完成。

## 影响面与风险

- 代码：`src/webview/chatBubbleRetention.ts`、`src/webview/viewContentScript/messageRendering.ts`、`src/webview/viewContentScript/traceRendering.ts`、设置说明文案。
- 测试：`src/test/webview/chatBubbleRetention*.test.ts` 及相邻最终答复、指令、缓存回归。
- 文档：保留设计、功能清单、业务本体。
- 风险：旧断言包含已明确取消的保守保护与补删语义；按新契约更新并保留边界测试。暂时保护流式正文，结束后重新按最终类型计算。

## 验证计划

- 先补回归并在旧实现验证失败，再修复根因。
- 单元自测：`npm run build` 后执行 `node --test dist/test/webview/chatBubbleRetention.test.js dist/test/webview/chatBubbleRetentionWebview.test.js`，再扩展相邻回归。
- 浏览器：生成实际 Webview 页面，使用本地宿主 mock，以 headless Chromium 检查混合历史、主色边框、清理区间与原始消息完整性；不等同真实扩展宿主验收。
- 文档：本体验证及相关结构、空白检查。

## 测试与清单同步

- 单元测试新增/更新：最旧区间内保护项不补删、未标记思考与普通助手正文不额外保护、保护与最终边框判定完全一致、临时流式保护及最终升级、完整运行时与设置说明断言。
- 单元自测结果：`npm run build` 成功；气泡策略及运行时最小回归 14/14；扩大至 8 个相关测试文件后 200/200 通过。构建和回归日志分别为 `.tmp/bubble-retention-fix-build.log`、`.tmp/bubble-retention-fix-after.log`、`.tmp/bubble-retention-fix-regression.log`。
- 失败处理记录：旧实现上的新增回归出现 6 项预期失败，证明可复现。扩大回归首次有 3 项失败：2 项为旧契约/文案断言过期，已更新；1 项为收紧保护后最终标记升级触发不必要整体渲染，移除旧补删策略专属的保护状态比较后通过原流式回归。浏览器首次失败来自测试夹具尝试 `fetch` 回传证据而被 Webview CSP 拒绝，改为页面内保存结果，未放宽生产 CSP，双视口重跑通过。
- 功能清单：已同步 `FEATURE_INVENTORY.md` 的清理区间、保护范围及不补删例子；设置说明同步为中文。
- 相关文档同步：已更新现有保留设计及两条业务本体规则；无需更新架构或全局记忆，不复制相同规则到热区。

### 最终验证命令与证据

```bash
npm run build
node --test dist/test/webview/chatBubbleRetention.test.js dist/test/webview/chatBubbleRetentionWebview.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/instructionGroupSummary.test.js dist/test/webview/codexThinkingPlaceholder.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/core/chatMessageLimit.test.js
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
git diff --check
```

- 上述单测 200/200、本体验证通过、本体脚本单测 9/9，空白检查通过。
- 实际生成 Webview 页面配合本地宿主 mock，通过 skill runner 执行 headless Chromium：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/bubble-retention-fix-smoke/desktop.json --install-if-missing`；窄屏同命令改用 `narrow.json`。临时页面脚本与场景在验收后移除。
- 桌面 1280×960、窄屏 420×900 各通过 15 项页面内断言，浏览器错误、HTTP 错误及请求失败均为空；结果和截图分别保留在 `.tmp/bubble-retention-fix-smoke/desktop/` 与 `.tmp/bubble-retention-fix-smoke/narrow/`，已人工查看截图。
- 浏览器混合历史共 551 项、最早 100 项内有 5 条保护消息，实际保留 456 项；最早区间内旧思考与指令消失，区间外两种消息均保留，四种最终标记及原始历史完整性通过。覆盖设置提高/恢复、结果过滤、节点复用及旧思考流式恢复/收尾/最终升级。
- 未执行：全仓 `test:unit`、覆盖率门禁、真实 VS Code Extension Development Host/CLI、Windows/Linux 实机与主题视觉验收；本次没有改变平台路径或 CLI 协议，不把浏览器宿主 mock 等同扩展宿主端到端验证。

## 任务列表

- [x] 定位气泡上限与清理规则。
- [x] 修复类型判断并补回归测试。
- [x] 验证构建并同步相关文档。

## 决策记录

- 2026-11-09：依据用户补充，20% 是最早消息区间而非必须删除的数量；区间内跳过保护项，不向后补删。
- 2026-11-09：直接复用 `isFinalAssistantSummaryMessage`，不新增第二套最终答复识别或猜测。
- 2026-11-09：固定清理区间下，保护状态变化不会挤掉其它消息；可见流式正文不再因保护状态变化强制整体渲染，沿用现有增量 Markdown 收尾，脱离投影或结果过滤变化仍重新渲染。

## 当前结论

两处偏差已修复，相关构建、200 项回归、双视口浏览器和本体验证通过；功能清单、设计和本体已同步并归档。本次仅修正显示投影，不删除历史，不改变最终答复协议或 CLI 上下文。
