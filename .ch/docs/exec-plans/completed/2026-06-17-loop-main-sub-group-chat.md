# Loop主从群聊面板复用

- 日期：2026-06-17
- 状态：completed
- 负责人：Codex

## 背景

辩论多智能体已经有只读模拟群聊面板、任务开始气泡入口、主动刷新、5 秒兜底刷新、思考中气泡和滚动置底逻辑。用户希望经典主从多智能体也复用同一群聊 UI：群成员是“主任务”和动态加入的“子任务 1~N”，任务开始时即可从 AI 对话气泡打开。

## 目标

让 `main_sub_multi_agent` 与 `debate_multi_agent` 都能通过同一个内容区群聊面板查看任务进展；主从模式在任务创建时生成 transcript，主任务与子任务关键状态写入时间线，子任务派发/执行时动态加入群聊。

## 范围

- 复用现有 `LoopDebateChatPanel`，把展示文案和状态扩展为通用Loop群聊。
- 为主从模式增加 `group-chat.md` transcript 文件和解析支持。
- 让任务开始/恢复气泡都带“打开Loop群聊”入口。
- 主从任务运行时在主任务决策、子任务开始/完成、任务完成/需复核时刷新已打开面板。
- 更新相关测试和事实来源文档。

## 非目标

- 不改变主从多智能体的 JSON 协议、派发并发策略或子任务执行模型。
- 不新增可写入的群聊页面交互；面板仍只读。
- 不重命名已有 VS Code command id，保留兼容入口。

## 验收标准

- [x] 主从Loop任务启动气泡立即出现可点击入口。
- [x] 主从群聊面板显示主任务和子任务 1~N 成员，子任务派发后动态出现在成员列表和时间线。
- [x] 主任务或子任务运行中显示对应“思考中”气泡，已有刷新和滚动逻辑继续可用。
- [x] 辩论群聊原能力不回退。
- [x] `npm run build` 与相关 Node 测试通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/loopDebate.ts`、`src/webview/loopDebatePanel.ts`、`src/webview/viewContent.ts`、`src/webview/types.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：`package.nls*.json`

## 风险与缓解

- 风险：主从 transcript 追加重复事件。
- 缓解：启动只在文件缺失时初始化；运行时事件用明确时间戳和阶段语义，重复恢复可接受但不影响状态。
- 风险：把辩论文案泛化时破坏已有面板布局。
- 缓解：保留原数据结构兼容，新增 mode 字段和 main-sub 分支，运行现有辩论单测。

## 验证计划

- 最小相关验证：`npm run build`，`node --test dist/test/loopDebate.test.js`
- 扩展验证：如环境允许，手动启动主从Loop任务，点击气泡打开群聊面板，观察动态加入和刷新。

## 测试与清单同步

- 单元测试：扩展 transcript 解析测试覆盖主从群聊 headings。
- 功能清单：更新Loop模式与辩论群聊条目。
- 相关文档同步：更新运行时设计和 CLI runtime reference。

## 任务列表

- [x] 梳理现有Loop辩论群聊 UI 与主从任务状态结构
- [x] 增加主从群聊 transcript 路径、解析和测试
- [x] 面板通用化并支持主从成员/思考中状态
- [x] 运行时生成/追加主从群聊记录并主动刷新
- [x] 同步文档并运行验证

## 决策记录

- 2026-06-17：保留已有 command/action 类型名以兼容旧消息，用户可见文案统一为“Loop群聊”。
- 2026-06-17：主从模式 transcript 放在任务沟通目录 `group-chat.md`，不混入辩论 `debates/round-*/chat.md`。

## 当前结论

已完成。主从模式现在生成 `group-chat.md` 并复用通用Loop群聊面板；任务开始/恢复气泡带入口，子任务会按“子任务 1~N”动态加入，运行中状态会主动刷新面板。验证通过：`npm run build`、`node --test dist/test/loopDebate.test.js`、`git diff --check`。未做真实 VS Code Extension Host 手工验收。
