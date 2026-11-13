# DSH 会话关闭后恢复修复

- 日期：2026-11-01
- 状态：completed
- 类型：bugfix
- owner：Codex
- claimed_at：2026-11-01
- claim_ttl：本次会话
- handoff_to：

## 关联计划

- markerless / cross-Tab / unknown-session 安全回归开发见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-01-dsh-session-resume-after-close.md`）。
- 原文记录的历史文档分工：CLI runtime reference、FEATURE_INVENTORY、PITFALLS 与 ontology 的历史同步原归 `2026-11-01-docs-dsh-session-resume-after-close.md`。 该 companion 已退役；完整写作及校验记录无法由索引复核。[references 索引](../../../references/index.md)仅作导航。

## 背景与目标

DSH 的持久化会话保存在隔离 `DSH_HOME` 下。原宿主使用 Tab ID 选择隔离目录，关闭会话后在新 Tab 重新加载，相同 ACP session ID 被传入另一个空目录中的 DSH 进程，导致 `session/resume` 报 `session is not resumable`。目标是恢复原目录，而非修改 Loop+ 分配规则或关闭协议。

本机 DSH 0.2.1-rc.2 源码确认：`session/close` 会刷盘并释放会话，不会删除其持久化恢复资格；`session/resume` 在当前持久化根目录找不到会话头时才会产生本次错误。早期关于 close 会永久终止会话的推测已否定，相关 runner 修改已撤回。

## 范围与非目标

- 宿主按 ACP session ID 找回启动目录，成功启动后绑定会话标记。
- 兼容修复前没有标记的历史隔离目录，按 DSH 原生项目/会话/日志层级有界查找，不读取会话正文或跟随符号链接。
- 对跨 Tab、旧目录兼容、未知会话隔离和安全路径的独立回归开发已从计划目录移除；其历史职责与结果见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-01-dsh-session-resume-after-close.md`）。本计划保留修复验收结果。
- 不改动 Loop/Loop+ 调度、`session/cancel`、`session/close`；恢复失败仍报错，不静默新建上下文。
- 不恢复已被系统删除的临时目录或 DSH 本身禁止恢复的子代理会话。

## 验收标准

- [x] 新会话绑定 ACP ID 后，不同 Tab 恢复得到相同 `DSH_HOME`。
- [x] 修复前无标记会话可找回原目录，不误用未知会话或符号链接。
- [x] 本机真实 DSH 新建、关闭进程、重启后严格 resume 验证通过，且不调用模型。
- [x] 修复的最小回归与构建通过；独立回归开发的历史记录见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-01-dsh-session-resume-after-close.md`），文档同步验收原指向已退役 docs companion（完整记录未恢复）。

## 影响面与风险

- 实现：`src/extensionHost/dshInteractiveLaunch.ts`、`promptInteractiveRuntime.ts`、`interactiveTurnDsh.ts` 及对应类型端口。
- 测试：DSH launch、host wiring、plugin boundary；扩展验证 runner、manager、生命周期策略。
- 文档交付：原由已退役 docs companion 负责（仅历史分工）CLI运行时参考、功能清单、PITFALLS与ontology，不属于本修复的实现范围。
- 兼容扫描固定为隔离 home / sessions / project / session / 规范日志，不遍历任意深度，不复制或解析历史正文。
- 临时目录保留策略未改变；已删除的数据无法由本次修复重建。回滚仅撤回启动目录绑定，不修改用户历史日志。

## 验证记录

- 已执行 `npm run build` 和 DSH runner/host/manager/生命周期回归：66 通过、1 个需模型环境的 live 用例跳过、0 失败。
- 已执行 `npm run validate:whitespace` 和 ontology `--validate`，均通过。
- 已执行 host wiring 的 markerless 历史目录回归，未知 session ID 不借用旧目录。
- 已使用本机 `dsh 0.2.1-rc.2` 完成真实无模型 smoke：`session/new` 后释放进程，删除绑定 marker，再由新 Runner 严格 `session/resume` 成功；测试临时目录已清理。
- 已同步 CLI runtime reference、FEATURE_INVENTORY、PITFALLS 和 ontology；未修改 Loop/Loop+ 调度逻辑。

## 任务列表

- [completed] 确认跨 Tab 加载时 DSH_HOME 变化是故障根因
- [completed] 执行恢复功能修复与真实 DSH 验证；回归开发和文档同步见关联计划

## 验证计划

本轮仅核对本记录与关联来源的历史证据、职责分配及具体链接；原业务命令与执行结果以本记录和关联计划的历史记录为准，不重跑测试、构建、浏览器或真实CLI。
