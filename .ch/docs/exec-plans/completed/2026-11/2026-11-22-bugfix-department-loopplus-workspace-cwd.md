# 产研部 Loop+ 员工工作目录修复

- 日期：2026-11-22
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`2026-11-22-refactor-department-loopplus-execution.md`

## 根因与范围

真实 VS Code Webview 提交三个 Java 排序模块后，三个员工将新文件写入临时链接根。链接根只能转发已有顶层项。真实工作区缺少交付文件，堆排序员工的目录清理返回 `ENOTEMPTY`，组长进入异常验收。

新产研部 Loop+ 员工使用真实工作区作为执行目录。依赖稳定隔离目录做会话续接的 CLI 沿用原目录协议。改动覆盖执行目录策略、回归、功能清单、本体与运行手册。

## 验收与验证

- 定向回归证明普通产研部 Codex 员工可用相对路径新建顶层文件，文件留在工作区。
- 运行相关 adapter 和组织回归、`npm run build`、本体校验以及 `git diff --check`。
- 使用修复构建从空目录走真实总监、三组组长和员工、验收及总监汇报。用 Java 17 独立编译并与标准库对拍。

## 验证结果

macOS 上使用隔离 VS Code 开发宿主，通过真实 Webview 提交并使用本机配置的真实 Codex 模型。三个组长各派发一名员工，三次验收均通过，总监完成汇报。组织持久化状态与群聊成员栏均显示完成，组长、员工占用均为零。群聊中的历史任务记录气泡保留了执行过程中的 `running` 快照。

对拍使用 Java 17 独立编译，三种算法各通过 1,008 个用例，与 `Arrays.sort` 一致。`npm run build`、本体校验、`git diff --check` 和 937 项相关回归通过。修复后的运行日志未出现 `ENOTEMPTY`、`DEPARTMENT_NATIVE_UNKNOWN` 或 `leader-member-not-running`。
