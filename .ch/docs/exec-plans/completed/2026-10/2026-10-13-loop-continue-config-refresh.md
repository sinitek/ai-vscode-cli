# Loop 继续弹窗运行配置实时刷新

- 日期：2026-10-13
- 状态：completed
- 负责人：Codex

## 背景与目标

用户修改主子模型后，Loop / Loop+ 群聊继续弹窗仍经常显示旧配置。CodeGraph 定位 `continueModelChoice` 与群聊协调器后，源码确认当前模型每次从当前配置读取，但 Webview 在继续弹窗模式下跳过配置补丁，打开弹窗也不主动刷新。

## 范围与非目标

- 修复 Loop / Loop+ 共用继续弹窗打开与持续刷新，不修改 Graph、模型存储、原配置恢复或续跑路由。
- 保持补充需求不展示运行配置的既有约定，不增加文案或修改视觉设计。
- 当前工作树干净；在原工作区完成定向修复，不创建分支或工作树。

## 验收标准

- 打开继续弹窗立即请求宿主刷新当前主子模型。
- 弹窗打开期间仍接收配置更新，保留输入、运行配置选择和单选焦点。
- 原配置不可用时选择有效的当前配置；补充需求弹窗中的配置区域持续隐藏。
- 回归测试、构建和真实 Chromium Webview 脚本验证通过。

## 影响面与风险

- 代码：`src/webview/loopGroupChatPanel.ts`。
- 测试：`src/test/loop/loopGroupChatPanel.test.ts`。
- 文档：功能清单、能力说明、ontology 和现有弹窗刷新排障记录。
- 风险：替换单选区域时重置选项或丢失 hidden；通过保留状态与回归用例约束，不整页重载。
- 回滚：撤销本任务对 Webview 局部刷新逻辑的修改。

## 验证计划与进展

- 单元自测：`npm run build`；`node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/continueModelChoice.test.js`。
- 浏览器：使用已有临时 Playwright 安装与 headless Chromium，加载实际生成的 Webview HTML，模拟 VS Code 消息桥验证配置刷新和状态保留；不启动 CLI 或改写用户配置。
- 文档：ontology 校验与单测；`git diff --check`。
- 当前阶段：实现、回归测试、浏览器验证及文档同步完成。

## 测试与文档同步

- 新增配置补丁在继续弹窗打开时仍生效的回归测试，覆盖选择保留、不可用选择回退与补充需求隐藏状态。
- 同步功能清单和既有本体规则；不改用户文案，因此无需新增中英文翻译。
- 根因与规避方式补充到既有弹窗刷新排障记录；不写入滚动摘要。

## 验证结果

- `npm run build`：通过。首次编译在新增测试的自引用夹具类型上报 TS7023，明确返回类型后重跑通过，属于本任务测试实现缺陷，已修复。
- `node --test dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/continueModelChoice.test.js`：32/32 通过，其中新增 6 条回归用例。
- `node --test dist/test/core/panelDiagnostics.test.js dist/test/loop/loopGroupChat.test.js dist/test/graph/graphRunPanel.test.js`：66/66 通过。
- 使用已有 `/tmp/iop-playwright/node_modules/playwright` 与缓存 Chromium，运行任务临时脚本加载实际 `LoopGroupChatPanel` 生成的 HTML，并注入 VS Code 消息桥。5 类检查全部通过：打开立即刷新、最新主子模型更新、说明/选择/焦点保留、原配置失效回退、补充需求区域隐藏与草稿保留；浏览器 console/page error 为 0。截图人工检查通过。任务临时脚本已移除，结果与截图移到仓库外的 `/tmp/sinitek-loop-continue-config-smoke/result.json` / `/tmp/sinitek-loop-continue-config-smoke/screenshot.png`，不提交运行产物。
- Impeccable 机械检测：`node /Users/fangjiawei/.codex/skills/impeccable/scripts/detect.mjs --json src/webview/loopGroupChatPanel.ts` 返回 `[]`。
- 定向空白校验与 `git diff --check`：通过。
- ontology `--validate`：仍有 15 条失效 `source_refs`，均指向仓库已有缺失的三份设计文档。与 `git show HEAD:.ch/docs/ontology/domains/cli-plugin-runtime.json` 逐条对比，当前和 HEAD 的缺失引用完全一致，本次没有新增失效引用。ontology 单测 8/9 通过，唯一失败为依赖该全量校验的 `test_validate_current_ontology`，分类为历史文档失败，本次不做范围外修复。
- 未运行全量单测或 Extension Development Host：本次仅修改共享 Webview 的局部更新逻辑，已覆盖 98 条相关测试和真实 Chromium 脚本执行；未修改 CLI、用户配置或宿主业务路由，不启动真实任务。

## 收尾判断

- 功能清单、能力说明、既有 ontology 规则和弹窗刷新 runbook 已同步；无需改架构入口、国际化文案或 scaffold。
- 可复用根因已放入既有 runbook；不再重复写入热区或事件记忆。
- 计划归档路径：`.ch/docs/exec-plans/completed/2026-10/2026-10-13-loop-continue-config-refresh.md`。
