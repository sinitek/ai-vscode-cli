# Loop 命名与本地存储迁移

- 日期：2026-07-14
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-14
- claim_ttl：本轮任务完成前
- handoff_to：-

## 背景

多智能体能力的用户可见名称已经改为 Loop，但运行时代码、持久化字段、本地目录、公开命令、测试和文档仍大量使用旧 Lobster 命名。其中主子任务沟通与辩论 artifact 仍写入 `~/.sinitek_cli/lobster-communications/`，与当前产品术语不一致。

## 目标

统一使用 Loop 命名，并将新任务的通信 artifact 写入 `~/.sinitek_cli/loop-communications/`。同时迁移任务存储、源码标识、命令、测试和事实来源文档中的旧命名，确保已有本地任务仍可发现、读取和继续。

## 范围

- 将源码文件、类型、函数、常量、状态字段和测试中的 Lobster 命名迁移为 Loop。
- 将新任务存储迁移为 `~/.sinitek_cli/loop-tasks/.../loop-tasks.json`。
- 将新通信 artifact 迁移为 `~/.sinitek_cli/loop-communications/<taskId>/`。
- 将公开群聊命令迁移为 `sinitek-cli-tools.openLoopGroupChat`。
- 更新中英文 i18n、产品规格、运行时参考、架构、安全、runbook、设计文档和历史计划引用。
- 对旧目录、旧存储文件、旧模式值、旧持久化字段和旧命令 ID 提供显式 `LEGACY_` 兼容读取或别名。

## 非目标

- 不改变 Loop 的调度、并发、辩论、重试或验收业务规则。
- 不替换技术栈、测试框架或持久化格式（除命名迁移外）。
- 不删除用户 Home 下的旧数据；成功读取后按现有写入链路迁移到新位置。

## 验收标准

- [x] 新 Loop 任务只在 `loop-tasks` 和 `loop-communications` 下创建文件。
- [x] 旧 `lobster-tasks` / `lobster-communications` 任务可被发现、规范化并迁移到新路径。
- [x] 生产源码、测试文件、公开命令、i18n 和事实来源文档统一使用 Loop 命名。
- [x] 全仓残留扫描只允许集中兼容层中的旧字面量和说明兼容边界的迁移文档。
- [x] 相关单元测试、TypeScript 编译和 Node build 全部通过。

## 影响面

- 代码目录：`src/`、`src/webview/`、`src/test/`
- 文档目录：`ARCHITECTURE.md`、`.ch/docs/`、`docs/`
- 配置与脚本：`package.json`、`package.nls*.json`、`.gitignore`
- 本地数据：`~/.sinitek_cli/loop-tasks/`、`~/.sinitek_cli/loop-communications/`

## 风险与缓解

- 风险：直接改目录后历史任务从最近任务列表消失或无法继续。
- 缓解：发现新旧任务存储并对旧记录做路径规范化；迁移通信目录时使用同文件系统 rename，冲突 artifact 保留 `.pre-loop-migration` 副本；不跟随符号链接，通信目录迁移失败时保留旧 Store 与旧路径等待重试。
- 风险：持久化消息字段、模式值或工作区设置改名后历史会话失真。
- 缓解：新字段优先，旧字段仅作为 `LEGACY_` 输入兼容，并补回归测试。
- 风险：大范围机械改名产生漏导入或字符串协议不一致。
- 缓解：先做 CodeGraph 影响面查询，再运行相关测试、全量 TypeScript build 和全仓残留扫描。

## 验证计划

- 最小相关验证：任务存储、Loop 调度、群聊面板、设置、历史会话和消息字段相关测试。
- 单元自测命令：编译测试后使用 `node --test dist/test/*loop*.test.js` 及受影响非 Loop 文件测试。
- 扩展验证：`npm run build`，再扫描文件路径与内容中的 `lobster` / `Lobster` / `LOBSTER` / `龙虾` 残留。

## 测试与清单同步

- 单元测试新增/更新：更新所有 Loop 测试命名；补旧任务目录和旧通信目录迁移覆盖。
- 单元自测结果：`npm run build` 通过；`node --test --test-reporter=dot dist/test/*.test.js` 通过，566/566。
- 失败处理记录：首次全量测试发现 `loopPromptQueue.test.ts` 的历史正则仍假设 orchestration 只有两个参数，而 HEAD 实现早已有第三个 ownership 回调；分类为测试断言过期，更新断言后定向测试与全量测试均通过。
- 功能清单：已新增“Loop 命名与本地存储迁移”能力行，记录新路径、自动迁移和隐藏命令别名。
- 相关文档同步：已更新架构、运行时参考、设计、产品规格、PITFALLS、本地开发 runbook、兼容入口和历史路径引用。

## 任务列表

- [x] 使用 memory recall、CodeGraph 和全仓扫描盘点旧命名影响面。
- [x] 完成源码、文件名、命令、i18n 和测试的 Loop 改名。
- [x] 实现旧本地数据、模式值和持久化字段兼容迁移。
- [x] 同步事实来源与兼容入口文档。
- [x] 运行测试、build 和残留扫描。
- [x] 记录验证结论并归档计划。

## 决策记录

- 2026-07-14：新写入统一使用 Loop 命名；旧 Lobster 字面量只允许存在于集中、可检索的 `LEGACY_` 兼容入口和说明迁移边界的事实来源文档中。
- 2026-07-14：旧公开命令 ID 保留隐藏别名，新贡献命令改为 `sinitek-cli-tools.openLoopGroupChat`。
- 2026-07-14：迁移目录拒绝符号链接；迁移失败不提前重写任务路径或删除旧 Store，避免异常环境下断链。

## 当前结论

已完成 Loop 全量命名迁移。新运行时只输出 Loop 文件名、字段、模式值和公开命令；旧数据由 `src/loopLegacyMigration.ts` 集中兼容并由任务枚举链路物理迁移。`git diff --check`、旧路径/生产源码残留扫描、官方 Skills 中文 description 检查、CodeGraph sync、Node build 和 566 项单测均通过。稳定迁移经验已写入 `.ch/docs/runbooks/PITFALLS.md`，无需额外 handoff 或热区记忆条目。
