# 部门角色 CLI 能力准入修复

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-17-bugfix-department-source-admission.md`（来源修复后暴露的角色准入缺口）
- 状态：completed
- 负责人：Codex

## 背景与目标

用户在新建部门后遇到 `department-producer-role-or-task-invalid`。只读核对本机失败任务的结构字段，确认组长为 Codex、员工为 Grok；现有 producer/原生 Owner 仅支持 Codex/OpenCode 组长与员工，通用配置表单却允许全部 CLI。目标是在表单、保存及新根创建前统一校验现有能力，提供明确中文原因，避免启动后产生不可执行的组长和容量占用。

## 范围与非目标

新增共享角色能力约束；表单只提供已支持 CLI，旧不支持偏好保留可识别提示，不能默默切模型。保存与宿主配置解析/生产新根启动均防绕过。总监继续使用已有经典 Loop 能力。保持普通聊天/Loop+、通用候选读取、旧快照结构读取及原 Owner 的拒绝边界。不新增其它 CLI 原生 Owner，不修改用户运行数据、不清理未知租约、不发布插件。保留工作区既有未提交修改。

## 验收标准与影响面

- 支持的 Codex/OpenCode 组长、员工可配置及通过新根准入；总监不受新增角色限制。
- Grok/Claude 等不支持角色在保存及创建任务/获取容量前明确拒绝。
- UI 不提供不支持的新选项，旧偏好提示具体角色/CLI 且可重新选择；不发送候选/保存/新根请求绕过限制。
- 相关回归、`npm run build`、本机生成 Webview Chromium 检查及 ontology 校验通过。
- 代码涉及 department 配置、消息保存、生产 composition、Webview；同步功能清单、设计、ontology 和踩坑记录。

## 风险与缓解

现有配置测试曾将 Claude 组长视为成功；按实际生产能力调整成功夹具，保留总监的其它 CLI 测试。通用 storage normalizer 和候选 reader 继续接受已知 CLI，避免把旧数据误标损坏。修复仅前置准入，不绕过 owner 校验；失败历史和未知容量保留。

## 验证计划

- `npm run build`
- 配置核心、保存消息、Webview、production composition 相关定向 Node 回归；新增 Grok 拒绝及支持组合测试。
- 复用生成页面 Chromium 脚本并增加不支持 CLI 的交互断言，验证真实宿主消息桥；不声称安装版 EH 或真实模型已通过。
- ontology `--validate`、工具单测及改动空白检查。

## 当前进展

共享 `DEPARTMENT_EXECUTION_CLIS`/角色中文原因已落地；组长、员工表单只提供 Codex/OpenCode，旧 Grok 偏好保留可识别提示并阻止新根，用户可主动改选后保存。保存、两层配置解析及生产新根入口均前置拒绝，producer 复用同一能力集合。正常 Codex/OpenCode、总监独立 CLI、OpenCode 默认模型和旧快照读取合同保持。

功能清单、部门模式设计、PITFALLS 和 ontology 已同步；无需调整架构入口，未引入新层级或接口装配。稳定排障方法已进入 PITFALLS，不重复写入热区记忆，不更新 ROLLING_SUMMARY。所有原有未提交内容保留；未改用户运行数据、未安装或发布扩展。

## 验证结果（2026-11-17）

- 最终 `npm run build` 通过。最后一次构建前仅清理本次 Webview 测试中一行尾随空格，没有语义变化。
- `node --test dist/test/core/departmentconfiguration.test.js dist/test/session/sessionMessageActions.test.js dist/test/extensionHost/departmentruntimecomposition.test.js dist/test/webview/departmentconfigurationwebview.test.js`：147 项中 144 通过、3 失败，无取消/跳过/TODO；日志 `/tmp/department-role-cli-admission-unit.log`。新准入及配置、保存、页面用例全部通过。
- 另运行 `node --test --test-name-pattern='new department|typed department role save|unsupported saved employee'` 配合同上四文件：6/6 通过，属于前述用例重复定向确认，不计新增去重数。
- `node --test dist/test/extensionHost/departmentConfigurationHost.test.js dist/test/extensionHost/departmentopencodedefaultmodel.test.js`：10/10 通过，日志 `/tmp/department-role-cli-admission-extra.log`。与四文件合计 157 个不同用例，154 通过、3 个既有失败。
- `DEPARTMENT_ROLE_FORM_EVIDENCE=/tmp/department-role-cli-admission-smoke node scripts/department_role_model_form_smoke.cjs`：通过，`result.json` 中 `passed=true`、`errors=[]`。验证旧 Grok 中文提示、发送禁用、不发员工候选、不提供不支持 CLI，以及主动改选 Codex、加载模型和保存载荷；也覆盖已有初始化真实宿主消息处理器和隔离 WorkspaceSettings 保存。1280 深色/280 浅色截图已检查，未见横向溢出，角色配置仍在输入框下方。
- ontology `--validate` 通过，2 domains / 162 rules；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `git diff --check`、smoke 脚本 `node --check`、本次文件的定向 `check_trailing_whitespace.js` 通过。全仓 `npm run validate:whitespace` 仍被未修改的 `AGENTS.md:8` 尾随空格阻止，不改无关规则文件。

## 失败分类与证据边界

四文件运行的三个失败均在冷 stop：`cold stop prepares fresh routes before recovery without launching a director`、`cold stop rejects expired preparation before recovery: session`、`cold stop fences concurrent continue and duplicate stop until preparation settles`；分别为 `2 !== 1`、未按预期拒绝、`2 !== 1`。用唯一临时 `dist` 副本、`typescript.transpileModule` 编译 `git show HEAD:src/extensionHost/departmentruntimecomposition.ts` 及其 HEAD 测试，仅筛选这三项，在相同其余依赖下全部复现相同失败，日志 `/tmp/department-role-cli-admission-baseline.log`。这是修复前 composition/测试的隔离对照，不宣称 clean HEAD 全仓测试；本次未更改冷 stop 路径，不将这三项写成通过，也不扩大本次修复范围。

首次 Chromium 检查在旧空模型夹具选择 Claude 时超时，因为新角色能力约束已正确移除该选项。分类为测试断言/夹具过期，改用支持的 Codex 保留空模型拒绝断言；增加旧 Grok 主动改选成功覆盖后重跑通过。核心成功夹具同样调整为支持的执行角色，仍独立保留 Claude 总监能力覆盖。

CodeGraph 在恢复阶段已查询，索引存在较多未同步内容，结果不足以定位新文件，因此按磁盘当前实现和测试核对。memory-recall 的 focus 为“产研部 角色 CLI 准入 所有权 初始化失败”，无 anchor；命中本计划，旧记忆占位与 stale 提醒不作为运行事实。

本机验证限定为生成生产 Webview、真实消息处理器及隔离存储。没有执行已安装扩展/真实模型任务、全仓单测或 Windows/Linux 原生验证，没有修改失败历史或容量；这些结果不构成真实用户旧任务恢复证明。

## 用户恢复操作

使用包含本修复的插件后，将组长、员工 CLI 选择为 Codex 或 OpenCode，选择模型/力度并保存，在独立新会话重新发送任务。旧失败任务的固化快照仍为旧路线，修改偏好后不能直接继续它来应用新配置。源码修复已完成；安装版生效与新任务实际成功运行未在本轮验证。
