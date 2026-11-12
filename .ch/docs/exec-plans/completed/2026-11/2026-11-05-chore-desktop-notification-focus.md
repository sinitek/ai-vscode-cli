# 系统通知远端同步与本机构建依赖恢复

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：chore

## 背景与目标

恢复原 manifest 已声明的本机依赖，并整合远端通知设置变更，保留双方通知语义和冲突解决证据。

## 范围与非目标

- 维护本机构建依赖与 `origin/master` 同步；不升级依赖或改锁文件，不负责新的通知功能、测试开发或文档编写。
- 原文同步为历史行为，本轮不安装、不拉取、不发布、不提交。

## 验收标准

仅恢复已声明包；保留远端设置入口、两个独立开关与前后台通知规则，同步后构建/回归可用且冲突无遗漏。

## 风险与缓解

- 首次构建失败分类为环境依赖缺失：本机未安装 manifest 已声明的 `@iarna/toml`。完整 npm 安装因重新解析依赖树耗时而中止，改用 `npm pack @iarna/toml@2.2.5 --ignore-scripts` 仅恢复该包，未改依赖版本或锁文件；之后构建通过。
- 只恢复缺包，避免依赖树重解析与无关升级；实际文案交付见关联 docs 计划。已完成测试开发的历史结果按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-desktop-notification-focus.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，不再导航至已删除计划。

## 验证计划与历史结果

- 同步 `origin/master` 的 `65d669c` 通知设置更新，处理功能清单、能力规格和 `viewContentStrings.ts` 三处文案冲突。保留“工具设置 → 通知授权”、两个独立通知开关及远端设置说明，并合入前后台系统通知、仅后台窗口提醒的规则。
- 同步后 `npm run build` 通过；以下十个测试文件共 135 项全部通过，无跳过：

```powershell
node --test --test-reporter=spec dist/test/core/humanInteractionAttention.test.js dist/test/core/desktopAttention.test.js dist/test/core/taskCompletionAttention.test.js dist/test/core/macosDesktopNotifications.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/extensionHost/taskCompletionAttentionHost.test.js dist/test/webview/notificationAuthorization.test.js dist/test/webview/loopPlusModeHelp.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/session/sessionMessageActions.test.js
```

- ontology 校验通过，UTF-8 环境下 ontology Python 单测 9 项全部通过；`git diff --check` 通过。

## 当前状态

原依赖恢复与远端集成完成；已加载扩展仍需加载本次构建，原计划未执行安装、重载或发布；不将本轮迁移等同于重验。

## 关联计划

- [feature：系统通知独立于窗口焦点](2026-11-05-feature-desktop-notification-focus.md#背景与目标)：分别承接系统通知独立于窗口焦点，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留系统通知焦点与宿主回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-desktop-notification-focus.md`；不再作为现行测试开发责任。
- [docs：系统通知焦点规则与使用说明同步](2026-11-05-docs-desktop-notification-focus.md#背景与目标)：分别承接系统通知焦点规则与使用说明同步，共享本来源的历史背景与接口。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
