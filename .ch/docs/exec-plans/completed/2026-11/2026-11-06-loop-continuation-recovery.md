# Loop / Loop+ 中断后续跑与按钮恢复

- 日期：2026-11-06
- 状态：completed
- 负责人：Codex

## 背景与目标

用户中断 Loop+ 后，以原配置继续执行时报 CLI 仍有任务，随后继续按钮不再弹窗。恢复同一档案不应重复写入原生配置；续跑失败、提前返回和异常都必须解除界面的临时禁用，允许用户重试。

## 范围与非目标

- 覆盖共享配置事务、原配置续跑入口、群聊续跑请求收尾和回归测试。
- 不清除有效进程租约，不放开任务运行时切换档案或编辑当前配置，不改调度协议，不发布扩展。

## 验收标准

- 已验收：原配置仍为已就绪的共享档案时，主 CLI 与跨 CLI 子任务续跑复用选择，不重写原生文件或版本，即使还有同档案执行租约。
- 已验收：原配置不同、共享配置未就绪时仍遵守应用与租约互斥规则。
- 已验收：续跑拒绝、恢复失败、启动异常后，继续按钮可再次打开弹窗；内容补丁相同也不会保留临时 disabled。
- 已验收：同一请求仅提交一次，同一任务续跑准备期间不重复启动；相关单测和构建通过。

## 影响面与风险

- 代码：`src/config/`、`src/extension.ts`、`src/extensionHost/loopGroupChatPanelCoordinator.ts`、`src/webview/loopGroupChatPanel.ts`。
- 文档：功能清单、能力规格、ontology、排障手册。
- 风险：跨窗口检查与应用之间存在竞态。复用判定放在共享互斥事务内；保留显式重新应用档案的原有行为。

## 验证计划

- 先补共享配置租约、配置服务、群聊宿主与 Webview 回归用例，再执行 `npm run build` 和最小相关 `node --test`。
- 用隔离临时目录验证真实文件和进程租约，不触碰用户原生配置。
- 用 headless Chromium 验证失败后重复打开继续弹窗；不调用真实付费模型。

## 测试与清单同步

- 单元测试新增/更新：共享配置同档案复用、租约保留、未就绪修复、真实独立进程互斥；配置服务原生配置与认证文件不重写；宿主拒绝/异常/任务缺失/重复请求回执；Webview 重复确认与临时禁用恢复；从真实源码抽取的主 CLI / 跨 CLI 子配置恢复链路。
- 最小自测：`npm run build && node --test dist/test/config/sharedRuntimeConfig.test.js dist/test/config/configService.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js`，114/114 通过。
- 全量自测：构建后执行 `node scripts/run_unit_tests.js`，3055 通过、3 跳过、0 失败（总计 3058）。
- 旧版复现：临时 preload 使用 `git show HEAD:src/config/sharedRuntimeConfig.ts` 的原始实现执行新增同档案续跑用例，稳定复现用户原文错误；当前实现通过同一用例。
- 浏览器验证：使用 `chromium-playwright-smoke` 的 runner 和隔离本机 HTTP 消息桥加载实际群聊 HTML、调用真实 coordinator。旧版 HTML 在配置恢复失败及五秒自动刷新后按钮仍禁用；新版依次经历恢复拒绝、恢复异常、启动异常，均可重新打开弹窗，第四次成功进入运行态。两组场景无浏览器错误、HTTP 错误或失败请求。结果位于本机 ignored 的 `.tmp/playwright-smoke/loop-continuation-baseline/` 与 `.tmp/playwright-smoke/loop-continuation-fixed/`，任务专用脚本和场景文件已清理。
- 失败处理记录：初次相关自测 97/99 通过，两处 VM 源码抽取夹具缺少新增 `continueRequestPending`，归类为夹具依赖缺失；补齐真实状态后通过。未修改无关代码或降低断言。
- 文档校验：ontology `--validate` 通过；ontology skill 的 9 项单测通过；UI 检测器无发现；改动范围尾随空白检查和 `git diff --check` 通过。
- 功能清单、能力规格、ontology、既有按钮状态避坑条目已同步。架构边界和用户配置格式未变，无需修改架构文档；稳定经验已并入 runbook，不重复写入热区或 `ROLLING_SUMMARY.md`。

## 任务列表

- [completed] 核对中断、原配置恢复与按钮状态链路
- [completed] 修复根因并补充回归测试
- [completed] 构建、浏览器验证与文档收口

## 决策记录

- 2026-11-06：复用判定放在共享互斥事务内部，只检查就绪状态和档案 ID，不比较 revision、摘要或原生文件，不清除有效执行租约；仅显式的原配置续跑启用，普通显式应用保持原行为。
- 2026-11-06：继续动作保留前端待处理状态，宿主统一在收尾发送回执，不依赖 `replaceHtml` 重新生成相同按钮。

## 当前结论

已修复并完成构建、相关/全量单测、真实独立进程租约验证和 Chromium 消息桥验证。未调用真实付费模型，未在 Extension Development Host 中执行真实 CLI 全链路，未修改用户原生配置、未发布或安装扩展。源码构建需由更新后的扩展加载后才能修复既有安装中的行为。
