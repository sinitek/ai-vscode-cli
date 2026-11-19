# 产研部复用全部 CLI 的 Loop / Loop+ 执行

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-17-bugfix-department-role-cli-admission.md`（本次取代其中仅允许 Codex/OpenCode 的方案）
- 状态：completed
- 负责人：Codex

## 背景与目标

用户明确要求产研部支持 Loop / Loop+ 已有的全部七种 CLI。上轮通过限制角色选择避免 Owner 初始化失败，未满足需求。本次撤销该限制，复用既有 runner，补全产研层的执行、停止、清理与同宿主续接。

## 范围

- 角色配置、保存、Webview 及生产准入统一使用 CLI_LIST。
- 保留 Codex/OpenCode 专属接线，其余 CLI 复用普通 Loop+ 交互运行时，纳入原责任账本、Owner 清理和容量归还。
- 真实 runner 的释放与流排空作为清理证据，不以 UI 状态、任务结束记录或 kill 请求作为证据。
- 回归测试覆盖七种配置、混合路线、通用组长多轮、员工、停止与释放失败。
- 同步产品、设计、排障及 ontology。

## 非目标

不改模型/CLI 协议和调度算法，不发布插件，不覆盖工作区原有修改，不修改用户失败任务、Owner marker 或容量文件。

## 验收标准

- CLI_LIST 中全部 CLI 可配置为总监、组长、员工；已启用且配置有效即可启动。
- Grok 等路线不再触发 department-producer-role-or-task-invalid，实际调用既有 runner。
- 原任务/代次和容量仍校验，停止封闭新启动，真实清理后释放；失败保留原因。
- build、相关单测、隔离本机运行验证与 Webview smoke 通过；历史失败单独分类。

## 影响面与风险

配置/表单、extension 接线、department producer/cleanup、交互 runner 释放观察。通用路径使用稳定本地会话键关联 native mapping；冷宿主缺失原执行能力仍按既有恢复规则处理。只新增释放观察，不修改普通 Loop / Loop+ 调度行为。

## 验证计划

- `npm run build`
- 新通用执行宿主和 runner 清理回归，配置/保存/producer/cleanup/adapter/原交互策略相关 Node 测试。
- 生产生成 Webview 的 Chromium smoke；隔离临时目录和原 Owner socket 的真实运行验证，不使用用户运行数据。
- ontology validate 与工具单测、定向空白检查。

## 当前进展

已撤销产研配置、producer 和 group cleanup 的 Codex/OpenCode 白名单，全部角色以 `CLI_LIST` 为准。新增 `departmentinteractiveruntime.ts` 将其余五种 CLI 的原 runner 纳入同一责任账本和 Owner 清理，不重写 CLI 协议或 Loop / Loop+ 调度；原生会话写入及回读成功、Owner 授权后才交付提示词，真实释放与排空后才确认清理。Loop+ 管理资源的员工也等待原 Owner 清理后归还名额。

已复核上一阶段的验证日志：标准 build 通过；新增执行宿主与 runner 回归 59/59（含本机真实 Grok runner + Node ACP 子进程 + Owner socket）；配置/交互与页面回归 188/188；原 runner/策略回归 246/246。生成生产 Webview 的 Chromium smoke 通过，`errors=[]`，已检查 1280 深色和 280 浅色截图；七 CLI 选项及保存 Grok 角色均正常。报告 `/tmp/department-all-cli-smoke/result.json`，这不是安装版 CLI / Extension Host 端到端验证。

扩大范围发现原有 composition 冷 stop 的 3 项失败，以及 production capacity/wiring 的原生准备未观察与等待超时。已对未修改 HEAD 创建隔离归档并标准构建：`/tmp/department-all-cli-baseline-path` 记录目录，`/tmp/department-all-cli-baseline-composition.log` 重现相同 3 项，`/tmp/department-all-cli-baseline-capacity.log` 重现第一项 `leader-native-preparation-not-observed` / 容量 1≠0。这些失败已确认独立于本次准入改动；其余宽范围超时未逐一确认基线，不作为通过证据，也不宣称全部历史测试已通过。

最终五种 CLI 的混合员工执行及同宿主停止后继续均已通过：原代完成真实清理、持久归还容量并退役后，新代使用新 Owner，保留原生 session 与独立本地键，两代执行集合均为 CLOSED。新增续跑夹具第一次 build 将组织成员状态误写成任务状态 `stopped`，TypeScript 拒绝；改为现有组织状态 `paused` 后，重新标准构建及全部相关回归通过，未放宽运行时类型。

## 最终验证

`npm run build` 退出 0，日志 `/tmp/department-all-cli-final-build.log`。以下 16 个文件共 343/343，无失败、取消或跳过，日志 `/tmp/department-all-cli-final-tests.log`：

```bash
node --test --test-reporter=spec \
  dist/test/extensionHost/departmentinteractiveruntime.test.js \
  dist/test/extensionHost/loopPlusRuntimeAdmission.test.js \
  dist/test/extensionHost/promptInteractiveRuntime.test.js \
  dist/test/interactive/claudeRunner.test.js \
  dist/test/interactive/grokRunner.test.js \
  dist/test/interactive/dshRunner.test.js \
  dist/test/interactive/kimiRunner.test.js \
  dist/test/extensionHost/interactiveTurnStrategy.test.js \
  dist/test/extensionHost/interactiveTurnZcode.test.js \
  dist/test/core/departmentconfiguration.test.js \
  dist/test/extensionHost/departmentConfigurationHost.test.js \
  dist/test/session/sessionMessageActions.test.js \
  dist/test/webview/departmentconfigurationwebview.test.js \
  dist/test/webview/departmentmodelselectors.test.js \
  dist/test/webview/modeavailability.test.js \
  dist/test/loop/loopTaskIdentityCatalog.test.js
```

原生成页面 smoke 在最终生产源码范围内继续有效：本阶段只增加测试及记录，未再改 Webview 或执行代码；两尺寸截图已人工核对。命令为 `DEPARTMENT_ROLE_FORM_EVIDENCE=/tmp/department-all-cli-smoke node scripts/department_role_model_form_smoke.cjs`；报告见上文。ontology validate 及 9/9 工具单测通过，定向空白检查及 `git diff --check` 通过。

## 交付与边界

本次源码修复完成，现有 Loop / Loop+ 对七种 CLI 的支持由产研层完整复用；产品清单、设计、排障与 ontology 已同步。沿用原 CLI 协议、调度和未知所有权恢复规则，不给角色增加 CLI 限制。稳定结论沉淀到 PITFALLS 和设计文档，未重复扩写热区记忆。

未运行全仓单测；上文历史失败保留并有隔离基线对照，其余宽范围超时未逐项确认。未安装、打包或发布扩展，未修改用户失败任务与运行数据；实际 VS Code/EH、七种安装版 CLI / 线上模型端到端、Windows/Linux 原生未覆盖，不能用本机 Node peer 组件证据替代。使用本次新构建后再新建产研任务验证。
