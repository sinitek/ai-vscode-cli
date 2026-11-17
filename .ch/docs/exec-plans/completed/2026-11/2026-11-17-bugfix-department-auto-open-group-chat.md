# 产研部启动后自动打开总监群聊

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

普通 Loop/Loop+ 启动会打开群聊，产研部独立的 startDepartmentPrompt 没有接入此入口。修复为新建部门完成可信身份核验、组织注册和会话绑定后，自动打开该总监的群聊。

## 范围与影响面

- `src/extensionHost/departmentruntimecomposition.ts`：增加宿主群聊展示端口，仅在新建成功后调用。
- `src/extension.ts`：接入已有群聊协调器。
- `src/test/extensionHost/departmentruntimecomposition.test.ts`：成功、拒绝及展示失败回归。
- 同步功能清单、部门设计及 ontology 中的启动展示规则。
- 保留工作区已有未提交修改；不改变调度、容量、恢复或组长展示规则，不发布扩展。

## 验收标准

- 新部门注册并绑定成功后，恰好请求打开当前总监任务的群聊。
- 准备、组织注册或会话绑定失败时，不请求打开群聊。
- 页面打开等待或失败不阻塞、不中断总监执行。
- 相关回归、`npm run build` 及最小本机验证通过。

## 风险与缓解

群聊展示依赖可信来源索引与运行所有权。调用安排在根注册、绑定及启动所有权建立后，复用现有协调器授权；异步展示异常单独记录，不转为任务失败。工作区存在已有修改，采用局部补丁，不创建缺少这些实现的 HEAD worktree。

## 验证计划

- `npm run build`：通过。
- 新行为定向回归：`node --test --test-name-pattern='new department opens|group chat opening failure|failure does not open a group chat' dist/test/extensionHost/departmentruntimecomposition.test.js`，5/5 通过。
- 相关宿主/群聊回归：`node --test dist/test/extensionHost/departmentruntimecomposition.test.js dist/test/loop/departmentGroupChatHost.test.js dist/test/loop/loopGroupChatCoordinator.test.js` 初次 138 项中 134 通过、4 失败；其中新增展示失败测试未等待总监决策的断言错误，已修正。之后单独重跑 composition 文件为 53 项中 50 通过、3 失败；另外两个群聊测试文件在组合运行中通过。剩余未触及失败为冷停止准备次数预期 1 实际 2 两项，以及 stale session 用例预期拒绝但未拒绝一项，见结果记录。
- 本机生成页面 Chromium：`DEPARTMENT_UI_DIST=dist DEPARTMENT_UI_EVIDENCE=/tmp/department-auto-open-chat-smoke PLAYWRIGHT_MODULE=/tmp/department-role-form-playwright/node_modules/playwright node scripts/department_group_chat_host_smoke.cjs`，通过；截图经检查。该 smoke 使用模拟 VS Code 与任务记录，不代表真实 Extension Development Host 启动。
- ontology `--validate` 通过；ontology skill Python 回归 9/9 通过。涉及文件的 `node scripts/check_trailing_whitespace.js <本计划涉及文件>` 和 `git diff --check -- <本计划涉及文件>` 通过；`git diff --cached --check` 通过。
- 全工作区 `npm run validate:whitespace` 因 `AGENTS.md:8` 尾随空白失败；最终全局 `git diff --check` 另报告工作区已有修改 `src/test/webview/departmentconfigurationwebview.test.ts:143`。均未触及。本次涉及文件通过定向空白检查。
- 冷停止失败基线对照：在独立 Node 进程通过临时 `--require` loader 仅删除本次新增 `if (deps.openGroupChat)` 调用段，不改源码或 dist 文件，再用 `--test-name-pattern` 单跑三个失败用例。仍为相同 3/3 失败（两项 2 !== 1，一项缺预期拒绝），证实并非本次自动展示引入。完整命令及输出：`/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/department-auto-open-baseline-atmyroph/command.json`、`result.txt`。

## 当前结论

新建总监通过可信注册和会话绑定后，生产 composition 经现有群聊协调器异步打开精确 taskId；面板拒绝/失败不会中断总监任务。准备、注册及绑定失败均不打开。普通 Loop/Loop+ 和组长弹窗行为不变。CodeGraph 索引陈旧，已按其提示直接核对当前文件。

## 任务列表

- [x] 增加部门成功启动后的总监群聊展示端口与生产协调器接线。
- [x] 覆盖打开成功、异步展示失败和启动拒绝路径。
- [x] 更新功能清单、部门设计、ontology 并归档验证记录。

## 测试与清单同步

功能清单、设计与 ontology 已同步。三个冷停止/会话恢复失败已用去除本次运行段的基线对照复现，分类为范围外失败，记录后不扩展修复；全仓运行组合限制保留。浏览器 smoke 只覆盖协调器和生成页面，不证明真实组织启动 EH。记忆热区无需更新：本次是局部已解决缺陷，稳定产品契约已经进入功能清单和设计。
