# 系统通知显示项目名称

- 日期：2026-11-08
- 状态：completed
- 类型：feature
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-08-notification-project-prefix.md`

## 目标与范围

新增两类桌面通知的动态目录名前缀和未命名回退。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- 历史文档分工：文档/事实源交付及其历史校验。 原 docs companion `2026-11-08-docs-notification-project-prefix.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 验收标准

- 新增两类桌面通知的动态目录名前缀和未命名回退；原可观察契约、非目标和限制以以下分配的原文为准。
- 新增可见通知信息，不改权限/触发；74+15历史回归与macOS两次submitted保留，横幅可见性及Windows/Linux实机未验证。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文；原 docs companion 已退役，其完整记录未恢复；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-08-notification-project-prefix.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 背景与目标

任务完成和人机交互系统通知需要显示 `【目录名 项目】`，便于区分多个项目窗口。

### 范围与非目标

- 修改共享桌面通知正文，复用现有工作目录解析器，仅提取目录名，不显示完整路径。
- 保持通知标题、身份、权限、触发条件、去重和窗口提醒行为不变，不修改 Webview。
- 不覆盖工作区已有的 Loop 调度、样式及相关文档改动。

### 验收标准

- 人机交互和任务完成通知均显示 `【项目名 项目】 原有正文`。
- macOS、Windows、Linux 使用一致正文；项目名随当前工作目录解析结果更新。
- 未解析到项目时显示 `【未命名 项目】`；目录名中的特殊字符不作为命令执行。
- 相关回归测试、构建与 ontology 校验通过，功能清单与业务规则同步。

### 影响面与风险

- 代码：`src/desktopAttention.ts`、`src/extensionHost/humanInteractionAttentionHost.ts`、`src/extension.ts`；相关测试开发曾分配至独立 test 类型计划；该计划已移除，历史证据摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-08-notification-project-prefix.md）。
- 风险：多根工作区继续复用现有 `resolveWorkspaceCwd` 的活动编辑器/首个工作区回退规则；不新增任务归属规则。
- 缓解：在发送时读取目录名，沿用已有参数传递和 Windows XML 转义，不暴露完整路径。

### 验证计划

- `npm run build`
- 本机最小验证复用已安装的 macOS 通知助手与现有权限，临时结果文件由助手调用流程清理；不触发新的授权弹窗，不以命令成功宣称横幅已被看到。

### 本机真实验证

- 命令：使用 `node` 加载 `dist/desktopAttention`，以 `getProjectName: () => path.basename(process.cwd())` 创建 transport，复用现有 VS Code globalStorage 的 `macos-v5/携宁 CLI 提醒.app`。命令 runner 仅允许系统 `lsregister` 和 `open`，禁止创建或修改通知助手。
- 先执行 `notificationAuthorization(false)`，返回 `status=diagnostic`、`authorizationStatus=2`、`alertSetting=2`，映射为 `authorized`；未申请新权限、未打开设置。
- 再执行 `notify('human-interaction')` 与 `notify('task-completed')`，两次均返回 `status=submitted`。
- 关键正文：`【sinitek-ai-vscode-cli 项目】 有一项人机交互等待处理，请返回编辑器中的 AI 对话面板。`；`【sinitek-ai-vscode-cli 项目】 任务已完成，请返回编辑器中的 AI 对话面板查看结果。`
- 结论：本机 macOS 系统接受两类带项目名称的通知。未对系统横幅实际可见性截图或人工确认；Windows/Linux 由隔离命令回归测试覆盖，未在对应操作系统实机验证。

### 当前结论

两类通知已统一添加项目目录名前缀，保持原有通知与窗口提醒语义。构建、89 项相关测试、结构校验与 macOS 原生投递验证通过；不修改 Webview、依赖或现有 Loop 调度工作区改动。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。新增可见通知信息，不改权限/触发；74+15历史回归与macOS两次submitted保留，横幅可见性及Windows/Linux实机未验证。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
