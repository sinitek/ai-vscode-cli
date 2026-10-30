# 人机交互历史按当前项目隔离

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

人机交互历史当前统一读写全局 JSON，导致当前项目列表包含其他项目记录。对齐历史会话，使用同一 `activeWorkspaceKey` 隔离读写。

## 范围与非目标

- 修改历史文件定位、Vibe/编排记录入口、按需读取与面板状态读取、跨项目保留期清理。
- 补充项目独立读写、旧记录兼容、数量限制与清理的单元测试；同步功能清单、运行时说明和 ontology。
- 不改历史弹窗样式、不新增跨项目查看入口，不猜测旧全局记录的项目归属；项目状态变化时刷新已打开的列表并关闭已失效详情。
- 当前工作区存在其他任务未提交修改；原地最小合并，不创建分支或覆盖已有修改。

## 验收标准

- 人机交互历史读写使用与历史会话一致的工作区键，切换项目后不混入其他项目记录。
- Vibe 与 Loop/Loop+/Graph 编排澄清采用相同定位规则，每项目最多 500 条。
- 缺少项目归属的旧全局记录不自动归入当前项目；保留文件并继续按保留期清理。
- 清理覆盖所有工作区文件，密码隐藏、只读详情与超时语义保持不变。
- 相关单元测试、`npm run build` 和 ontology 校验通过。

## 影响面与风险

- 代码：`src/humanInteractionHistory.ts`、`src/extension.ts`、历史 Webview 状态同步与相关核心、Webview 单测。
- 文档：功能清单、插件能力、CLI 运行时参考、ontology。
- 风险：旧记录没有工作区键，不能可靠迁移；不导入以免错误归属，保留旧文件用于保留期维护。
- 回滚：恢复原读写入口即可，新增工作区文件不删除；不修改用户真实数据。

## 验证计划

- `npm run build`
- `node --test dist/test/core/humanInteractionHistory.test.js dist/test/core/orchestratorClarification.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/multiAgentSettingWebview.test.js dist/test/webview/viewProvider.test.js`
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- `git diff --check`；不涉及 UI 布局，补充 Chromium 原生 DOM 状态切换验证。

## 进展与测试记录

Tasklist:
- [completed] 确认全局历史文件未关联工作区键
- [completed] 统一项目文件定位并补充回归测试
- [completed] 完成验证、文档同步与计划归档

- 单元测试变化：新增四条核心测试，覆盖项目文件独立读写、不导入旧记录、项目独立数量限制、全部项目保留期清理与目录异常；新增一条 Webview 测试，覆盖打开列表和详情时切换项目、同项目状态保留及切到空记录。
- 构建结果：两轮 `npm run build` 均通过。
- 最小相关自测：`node --test dist/test/core/humanInteractionHistory.test.js dist/test/core/orchestratorClarification.test.js dist/test/webview/multiAgentSettingWebview.test.js dist/test/webview/viewProvider.test.js`，23/23 通过。
- Webview 历史自测：`node --test --test-name-pattern='interaction history' dist/test/webview/clipagescriptruntimecoverage.test.js`，3/3 通过。
- 扩展测试组：包含整个 Webview runtime coverage 的五文件测试组最终 128/129 通过，唯一失败为下述历史用例。
- 失败处理记录：`keeps the owning conversation tab errored for error bubbles through append, update, collapse, and recovery` 在未修改 Webview 时已失败；当时 `git diff --exit-code HEAD -- src/webview src/test/webview/clipagescriptruntimecoverage.test.ts` 为干净，单例重跑仍是 `undefined !== true`。属于历史错误气泡状态测试失败，不在本次扩大修复。
- 环境记录：一次验证短暂缺少 `dist/test` 文件；产物恢复后同一命令重跑 23/23 通过，未修改无关构建逻辑。
- Chromium 验证：真实 `getWebviewHtml` 生成页面，使用明确标注的隔离合成宿主桥和项目记录，运行 `node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/human-interaction-history-smoke/scenario.json --playwright-install-root /tmp/zq-playwright-smoke`；列表项目甲→项目乙→空项目、旧详情关闭均通过，浏览器/HTTP/网络错误为空，截图已人工检查。临时场景和本地服务已清理，结果保留在 ignored 的 `.tmp/human-interaction-history-smoke/results/`。
- 未执行：未启动 Extension Development Host、未操作已安装扩展或真实 CLI；本次验证覆盖文件系统、真实 Webview 生成脚本与 Chromium DOM。
- 结构校验：ontology validate、限定修改文件的空白校验、`git diff --check` 均通过；前端 mechanical detector 返回空列表。
- 功能清单与 ontology：已同步项目范围、独立存储路径和旧记录策略，并更新插件能力与 CLI 运行时参考。
- 记忆判断：本次结论写入运行时事实来源和执行计划，不写入 `ROLLING_SUMMARY.md` 或重复事件记忆。

## 最终结论

历史会话与人机交互历史共用 `activeWorkspaceKey` 作为项目边界；Vibe/编排写入、面板状态和按需读取共用一个文件定位入口。切换项目同步更新已打开的列表，旧详情不继续展示；后台保留期维护仍覆盖所有工作区和旧全局文件。无待处理的本次实现缺陷。
