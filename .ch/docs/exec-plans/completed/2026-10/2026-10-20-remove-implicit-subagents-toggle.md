# 移除隐式子代理全局开关

- 日期：2026-10-20
- 状态：completed
- 负责人：Codex

## 背景与目标

工具设置不再控制目标 CLI 分组的隐式子代理能力。移除设置入口、持久化与迁移、Codex 显式禁用以及 OpenCode task 权限覆盖，能力完全遵循目标配置。

## 范围与非目标

- 范围：工具设置、Webview 状态/消息、Codex runner 管理、OpenCode 运行时配置及对应测试和规格。
- 非目标：不改变 Loop/Loop+ 编排、子代理进度展示、用户 CLI 配置或现有 Claude 任务跟踪改动。

## 验收标准

- 工具设置不再显示或发送隐式子代理开关。
- 历史全局和工作区开关均被忽略，不再迁移或影响执行。
- Codex 不注入 `--disable multi_agent` 或 `features.multi_agent=false`。
- OpenCode 保留目标配置的 task 权限和环境内联配置，不注入拒绝。
- 相关回归、构建与 ontology 校验通过。

## 影响面与风险

- 影响：`src/toolSettings.ts`、工作区设置、Webview、扩展组合根、Codex 与 OpenCode 适配器。
- 风险：只隐藏 UI 会遗留默认禁用；从设置到运行时完整移除并用回归覆盖。
- 回滚：仅回退本任务补丁；保留进入任务前的 Claude 改动，不修改用户配置。

## 验证计划

- 单元自测：`npm run build` 后运行工具设置、工作区设置、消息路由、Codex runtime/runner、OpenCode overlay、Webview 相关测试。
- 浏览器：使用生成的 Webview HTML 与 headless Chromium 检查 AI 任务配置入口和剩余控件。
- 文档：同步功能清单、能力规格、CLI 参考和 ontology，执行 ontology 校验与 `git diff --check`。

## 当前进展

Tasklist:
- [completed] 定位开关和运行时干预路径
- [completed] 移除逻辑并更新回归测试
- [completed] 同步规格并完成验证归档

## 测试与清单同步

- 自测结果：`npm run build` 最终通过；以下相关回归 256 项通过，设置消息分支另测 3 项通过，共 259 项通过。
- 功能清单：将全局开关标记为 `removed`，把仍有效的子代理独立进度气泡保留为 `active`；能力规格、CLI 运行时参考与 ontology 同步完成。
- 结构校验：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 和 `git diff --check` 通过。
- 记忆：无需新增热区或事件记录；稳定行为进入规格与 ontology。

### 单元自测命令

```bash
npm run build
node --test \
  dist/test/core/toolSettings.test.js \
  dist/test/core/workspaceSettingsStore.test.js \
  dist/test/core/contextCompactionRunner.test.js \
  dist/test/session/sessionMessageActions.test.js \
  dist/test/interactive/codexRunnerRuntime.test.js \
  dist/test/interactive/codexAppServerNdjson.test.js \
  dist/test/interactive/codexRunnerLifecycle.test.js \
  dist/test/interactive/codexRunnerReuse.test.js \
  dist/test/interactive/codexRunnerSubagent.test.js \
  dist/test/interactive/codexThreadSelection.test.js \
  dist/test/cli/opencodeconfigmodels.test.js \
  dist/test/cli/opencoderuntimeconfig.test.js \
  dist/test/cli/commandRunnerCoverage.test.js \
  dist/test/core/subagentProgress.test.js \
  dist/test/core/openCodeTabStream.test.js \
  dist/test/webview/multiAgentSettingWebview.test.js \
  dist/test/webview/cliPageStaticRenderCoverage.test.js \
  dist/test/extensionHost/opencodethinkingintegration.test.js \
  dist/test/extensionHost/promptInteractiveRuntime.test.js \
  dist/test/interactive/grokRunner.test.js
node --test --test-name-pattern='cleans migrated settings|retains workspace setting fallbacks|cleans legacy setting aliases' \
  dist/test/session/sessionMessageActionsCoreCoverage.test.js
```

### 浏览器验证

- 使用实际编译后的 `getWebviewHtml`，只注入 VS Code bridge 测试替身，通过本机 HTTP 服务打开页面，不访问用户会话或修改用户设置。
- 使用 `chromium-playwright-smoke` skill runner，环境变量 `PLAYWRIGHT_MODULE_PATH=/tmp/pw-run/node_modules/playwright`，分别执行 `/tmp/implicit-subagents-desktop.json` 与 `/tmp/implicit-subagents-narrow.json` 场景。
- 1280×1000 与 480×1000 均通过：打开工具设置 / AI任务配置，确认开关和文案不存在、人工交互/自动压缩/Loop 轮次控件存在且无重叠；浏览器、HTTP 和网络错误均为空。已查看两张截图。
- 产物：`.tmp/playwright-smoke/implicit-subagents-removed-desktop/result.json`、`.tmp/playwright-smoke/implicit-subagents-removed-narrow/result.json`，各目录含 `success.png`。
- UI 机械检查：对修改的 HTML、文案和三个脚本执行 Impeccable detector，结果为 `[]`。
- 未覆盖：未在真实 Extension Development Host 中启动付费 CLI 任务；目标配置保持行为由 Codex 参数/线程配置、OpenCode overlay/环境透传与 runner 回归验证。

### 失败分类与范围外记录

- 本次夹具问题：OpenCode 权限透传回归最初缺少 provider/model 声明，模型 overlay 正常拒绝；补齐夹具后通过，未改业务校验。
- 并行工作区改动：CLI 分组启停功能实施期间短暂出现 `postCliEnabled` 等类型错误；保留该任务改动，后续 `npm run build` 已通过。
- 扩大检查时发现 6 个范围外失败：Grok assistant 文本尾空格 1 项、指令折叠摘要计数位置 3 项、非法 CLI fallback 缺少 `showWebviewError` 1 项、孤立执行规则设置函数缺少 `enabledRuleCliNames` 1 项。后两项涉及并行 CLI 分组启停功能，未在本任务中修复。
- 对照方式：从 `git show HEAD:<测试路径>` 读取这三个测试文件，用 TypeScript `transpileModule` 编译并在当前模块路径下运行相同失败用例；6 项均出现相同失败。该对照验证的是 HEAD 测试与当前依赖，不宣称完整 HEAD 基线。
- 临时证据：`/tmp/implicit-subagents-baseline.log`、`/tmp/implicit-subagents-expanded-tests.log`、`/tmp/implicit-subagents-expanded-tests-clean.log`。扩大检查尝试过滤前五项后，规则设置孤立夹具仍失败；最终本次相关测试按上面的明确列表运行且全部通过。

## 当前结论

全局开关及其从读取、迁移、消息到运行时的干预链路均已移除。保留目标分组自身能力设置、子代理观测、Loop/Loop+ 编排以及进入本任务前已有和执行期间并行产生的改动。

## 提交前独立验证

- 按用户要求仅提交本任务内容；使用临时 Git 索引，从 HEAD 单独组装共享文件中的本任务改动，未包含并行 CLI 启停和 Claude 任务跟踪功能。
- 导出该索引的完整仓库快照，复用现有依赖但独立构建输出；`npm run build` 通过。
- 在独立快照运行上面的相关回归文件，并完整执行 `sessionMessageActionsCoreCoverage.test.js`，不再按用例名过滤：274 项测试全部通过。
- 该验证证明提交不依赖其他未提交任务；原工作区中的无关修改保持不变。
