# 系统通知显示项目名称

- 日期：2026-11-08
- 状态：completed
- 负责人：Codex

## 背景与目标

任务完成和人机交互系统通知需要显示 `【目录名 项目】`，便于区分多个项目窗口。

## 范围与非目标

- 修改共享桌面通知正文，复用现有工作目录解析器，仅提取目录名，不显示完整路径。
- 保持通知标题、身份、权限、触发条件、去重和窗口提醒行为不变，不修改 Webview。
- 不覆盖工作区已有的 Loop 调度、样式及相关文档改动。

## 验收标准

- 人机交互和任务完成通知均显示 `【项目名 项目】 原有正文`。
- macOS、Windows、Linux 使用一致正文；项目名随当前工作目录解析结果更新。
- 未解析到项目时显示 `【未命名 项目】`；目录名中的特殊字符不作为命令执行。
- 相关回归测试、构建与 ontology 校验通过，功能清单与业务规则同步。

## 影响面与风险

- 代码：`src/desktopAttention.ts`、`src/extensionHost/humanInteractionAttentionHost.ts`、`src/extension.ts` 及相关测试。
- 文档：功能清单、能力规格、通知 ontology 规则。
- 风险：多根工作区继续复用现有 `resolveWorkspaceCwd` 的活动编辑器/首个工作区回退规则；不新增任务归属规则。
- 缓解：在发送时读取目录名，沿用已有参数传递和 Windows XML 转义，不暴露完整路径。

## 验证计划

- `npm run build`
- `node --test dist/test/core/desktopAttention.test.js dist/test/core/macosDesktopNotifications.test.js dist/test/core/humanInteractionAttention.test.js dist/test/core/taskCompletionAttention.test.js dist/test/extensionHost/humanInteractionAttentionHost.test.js dist/test/extensionHost/taskCompletionAttentionHost.test.js`
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- 本机最小验证复用已安装的 macOS 通知助手与现有权限，临时结果文件由助手调用流程清理；不触发新的授权弹窗，不以命令成功宣称横幅已被看到。

## 测试与清单同步

- 单元测试新增/更新：两类通知的 Windows/Linux 正文、macOS 真实发送适配器与助手身份复用、发送时动态读取目录、未命名回退、Windows 盘符/UNC 与 POSIX 路径、中文及特殊字符安全传参。
- 单元自测结果：`npm run build` 通过；上述六个测试文件共 74 项通过；额外运行 `node --test --test-reporter=dot dist/test/extensionHost/extensionHostExtractionContracts.test.js`，15 项通过。
- 结构验证：ontology 校验通过（2 domains / 17 concepts / 16 relations / 113 rules / 2 workflows）；`git diff --check` 和 `node scripts/check_trailing_whitespace.js <本次文件>` 通过。
- 失败处理记录：无构建、测试或结构校验失败。
- 功能清单：已同步人工交互与完成通知正文、项目名来源及回退。
- 相关文档同步：能力规格与两条 ontology 规则已同步；本次不产生需要写入热区的长期经验，不更新 ROLLING_SUMMARY 或 EVENT_MEMORY。

## 本机真实验证

- 命令：使用 `node` 加载 `dist/desktopAttention`，以 `getProjectName: () => path.basename(process.cwd())` 创建 transport，复用现有 VS Code globalStorage 的 `macos-v5/携宁 CLI 提醒.app`。命令 runner 仅允许系统 `lsregister` 和 `open`，禁止创建或修改通知助手。
- 先执行 `notificationAuthorization(false)`，返回 `status=diagnostic`、`authorizationStatus=2`、`alertSetting=2`，映射为 `authorized`；未申请新权限、未打开设置。
- 再执行 `notify('human-interaction')` 与 `notify('task-completed')`，两次均返回 `status=submitted`。
- 关键正文：`【sinitek-ai-vscode-cli 项目】 有一项人机交互等待处理，请返回编辑器中的 AI 对话面板。`；`【sinitek-ai-vscode-cli 项目】 任务已完成，请返回编辑器中的 AI 对话面板查看结果。`
- 结论：本机 macOS 系统接受两类带项目名称的通知。未对系统横幅实际可见性截图或人工确认；Windows/Linux 由隔离命令回归测试覆盖，未在对应操作系统实机验证。

## 当前结论

两类通知已统一添加项目目录名前缀，保持原有通知与窗口提醒语义。构建、89 项相关测试、结构校验与 macOS 原生投递验证通过；不修改 Webview、依赖或现有 Loop 调度工作区改动。
