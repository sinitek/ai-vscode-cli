# 设置消息局部 Command 分派

- 日期：2026-11-12
- 类型：refactor
- 状态：completed
- 负责人：Loop+ fullstack coding attempt
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-12-docs-setting-message-commands.md` 同步实际模块边界；`.ch/docs/exec-plans/completed/2026-11/2026-11-12-test-setting-message-contracts.md` 由并行测试负责人补充公开入口契约，本计划不编辑其测试或计划，其归档状态独立维护。

## 背景与目标

`handleUpdateSettingMessage` 混合模型、Loop 角色、偏好、通知、CLI 启停和重复刷新。以兼容 Facade、显式静态命令及最小依赖隔离维护职责，不改变外部行为。

## 范围与非目标

- 范围：`src/sessionMessageActions.ts` 的设置入口、新 router、model/preferences/types 领域模块。
- 非目标：提示词解析、OpenCode variant、UI/Webview 协议、配置格式、真实用户数据、Loop 调度与真实模型验收；不修改 2026-11-03 blocked 计划。

## 验收标准

- [x] 原 28 个分支迁移为 11 条模型命令与 17 条偏好命令；静态表不捕获调用状态，领域接收显式窄端口投影。
- [x] 保留快照读取、精确匹配、校验、可选回调、保存/异常/刷新顺序。
- [x] 构建和指定范围七个套件通过（grokmodelselection 同时覆盖 CLI/Webview），记录摘要与并行改动纳入情况。

## 影响面与风险

- 只改变宿主内部设置消息分派；主要风险为 guard 与副作用时序变化。
- 缓解：原条件/归一化保持，命中正常返回后统一刷新，不用 finally；公开入口契约回归。
- 回滚：整体撤销本次生产文件改动，保留并行测试与他人变更。

## 验证计划

- `npm run build`（本批唯一共享 dist 构建者）。
- `node --test` 显式列出 sessionMessageActions、sessionMessageActionsCoreCoverage、sessionMessageHandlersCoreCoverage、sessionMessageRouter、toolSettings、grokmodelselection 编译后套件。
- 记录每次命令与结果；无真实模型、CLI、浏览器或发布验证，因外部协议和 UI 均不变。

## 测试与清单同步

- 测试开发属于关联 test 计划，本计划只运行并核对，不接管测试文件。
- 功能清单不改：没有用户行为或能力增减。
- 架构、设计与 ontology 来源同步属于关联 docs 计划。

## 当前进展

- 已读工程与 ontology 流程并查询业务本体；CodeGraph 两次未提供源码，回退当前源码及既有测试核对。
- 兼容 Facade、Router、两个领域表与局部类型已接线；普通依赖异常继续传播，通知独立 catch，刷新只由 Router 正常完成路径触发。
- `npm run build` 成功，构建时已纳入并行两个 CoreCoverage 文件增量（当时差异分别为 +284/-2 与 +34/-0）；构建前后及测试后的 12 文件 SHA-256 一致。
- `node --test dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageRouter.test.js dist/test/core/toolSettings.test.js dist/test/cli/grokmodelselection.test.js dist/test/webview/grokmodelselection.test.js`：139 通过，0 失败/取消/跳过/todo。
- 补充 Node/TypeScript AST 静态检查：10 个非设置函数与 HEAD 原文字节一致；28 原分支对应 28 命令；原型/退役键不命中；编译产物无对 Facade/宿主的反向 require。
- 完整哈希、命令及适用快照见本 attempt report；后续只修改文档/计划，不使构建与契约测试失效，未重复执行仍有效的检查。
- 无失败需要分类修复；未执行无关全量/严格覆盖率、真实 CLI/模型/通知系统、浏览器、扩展宿主和发布，不能据此改判旧 Loop 模型路由真实验收。主模型仍需独立集成审查。
