# AI 对话配置切换后的模型快照隔离

- 日期：2026-09-21
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈同一 AI 对话分组切换配置后，模型列表最初正确，随后自行变成另一配置的模型。当前 `applyState` 会保留用户选择的配置 ID，却仍接收不同配置快照的非空模型列表、角色模型和思考状态，形成配置名与模型来源不一致。

## 范围与非目标

- 为 Webview 配置相关状态增加统一的配置归属校验，复用现有配置提交和发送门禁。
- 补充完整 Webview 运行时回归用例，覆盖 Codex、Claude、OpenCode。
- 不修改用户配置文件、模型存储格式、配置应用队列或界面样式；保留工作区已有未提交改动。

## 验收标准

- 切换尚未提交时，旧配置的非空模型快照不能重新填入已清空的模型列表。
- 切换成功后，延迟到达的另一配置快照不得覆盖当前模型候选、选中值、主/子模型和思考选项。
- 同一配置的合法刷新、空模型列表、配置删除以及切换失败后的回滚仍可正常更新。
- 相关单测与 `npm run build` 通过；补充本机浏览器运行时验证或明确验证限制。

## 影响面与风险

- 代码：`src/webview/viewContentScript/modelAndPanelState.ts`。
- 测试：`src/test/webview/clipagescriptruntimecoverage.test.ts`。
- 文档：功能清单、配置切换相关 runbook；收尾判断 ontology 是否需要更新。
- 风险：过度过滤可能冻结合法空状态或配置删除；通过正向与边界用例验证。

## 验证计划

- 先新增回归测试，运行构建和最小测试，确认原实现失败。
- 修复后运行 `node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/webview/opencodedualmodelwebview.test.js`。
- 按风险扩大至 `npm run test:page`，执行定向空白校验和 Chromium Webview smoke。

## 实现与验证结果

- `applyState` 完成配置选择协调后，统一校验快照 `activeConfigId` 与界面 `selectedConfigId`。不匹配时不接收模型列表、模型选择、角色模型与思考选项，但不阻止其余面板状态刷新。
- 新增 6 个完整运行时回归用例，覆盖三个 CLI 的切换待提交、提交后旧快照、同配置刷新、合法空列表、配置删除和切换失败回滚；Codex/OpenCode 校验实际下拉候选，Claude 保持原有不展示模型入口的行为。
- 修复前运行 `npm run build` 及 `node --test --test-name-pattern='isolates model snapshots' dist/test/webview/clipagescriptruntimecoverage.test.js`：构建通过，3 个回归用例均失败，旧配置 `config-b-model` 被填入应为空的候选列表，确认实现缺陷。
- 修复后 `npm run build` 通过；初轮 Webview 定向测试 42/42 通过。
- 完成边界用例后，使用隔离用户目录运行 `HOME="$isolated_home" node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/config/configApplyQueue.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js`：91/91 通过。
- `HOME="$isolated_home" npm run test:page`：构建通过，196/196 通过。`isolated_home` 使用 `mktemp -d /tmp/sinitek-model-profile-home.XXXXXX` 创建，不修改真实用户配置。
- 首轮未隔离用户目录的 `npm run test:page`：190/193 通过；`cliPageConfigCoverage` 两项和 `loopDebatePanel` 一项期待英文，但 `resolveLocale` 优先读取真实工具设置得到中文。分类为环境/夹具隔离问题，同一代码在空用户目录下全部通过，未扩大范围修改这些测试或用户设置。
- 本机 Chromium：以仓库编译后的真实 Webview HTML、脚本和样式，复用单测配置数据并模拟 VS Code 消息桥；选择 A 后先确认 A，再于 250/500/750ms 连续投递 B 快照，检查配置、模型和思考下拉仍为 A。Codex 与 OpenCode 的 Vibe/Loop/Graph，以及 Claude Vibe 共 7 个中英文场景全部通过；console、page、HTTP 与请求失败均为 0。已查看 Codex Loop 中文和 OpenCode Graph 中文截图。
- 浏览器命令：`node /tmp/sinitek-model-profile-smoke.cjs` 启动临时 loopback 服务，然后按场景执行 `node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario <scenario.json>`；复用本机 Playwright/Chromium 缓存，未安装依赖。结果与截图位于 `/tmp/sinitek-model-profile-smoke/<scenario>/`，任务场景文件已清理。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 ontology 单测 9/9 通过。
- `git diff --check`、定向 `scripts/check_trailing_whitespace.js` 通过；Impeccable 对改动 Webview 文件的检测结果为 `[]`。

## 文档与记忆判断

- 已同步 `FEATURE_INVENTORY.md`、能力规格、配置切换 runbook，以及 ontology 中的配置提交规则。
- i18n：没有新增或修改用户可见文案，不需要改动翻译。
- 未改变模型持久化格式、平台路径、扩展宿主接口或架构；无需更新 `ARCHITECTURE.md`。
- 复发风险已进入现有 runbook，稳定规则已进入规格与 ontology；无需扩写热区记忆、新增 skill 或维护 generated 索引。

## 结论与验证边界

根因由 CodeGraph 导航后的当前源码及失败回归确认，修复与验证完成。浏览器验证使用模拟宿主消息，不代表已在真实 Extension Development Host、用户当前安装的扩展或真实 CLI 会话中复测；未打包、安装或发布扩展。保留任务开始前工作区已有的其他改动。

Tasklist:
- [completed] 定位配置名保留与模型快照覆盖的归属不一致
- [completed] 增加回归测试并修复配置相关状态更新
- [completed] 完成验证和文档同步后归档
