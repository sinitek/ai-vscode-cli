# Loop辩论执行群聊补齐

- 日期：2026-06-17
- 状态：completed
- 负责人：Codex

## 背景

辩论多智能体已经把规划阶段渲染为模拟群聊，主从多智能体也已经复用群聊面板展示主任务和子任务执行过程。当前缺口是：当任务使用 `debate_multi_agent` 时，达成共识后的子任务执行仍走现有主从执行链路，但主从执行 transcript 被辩论任务分支跳过，导致群聊面板里只能看到辩论者发言，看不到后续子任务加入和完成。

## 目标

让辩论多智能体任务在同一个“Loop群聊”入口中同时可查看辩论规划轮次和后续任务执行群聊。子任务开始、重试、完成和批次完成事件要继续写入 `group-chat.md`，并在面板中以“子任务 1~N”动态出现。

## 范围

- 调整 `debate_multi_agent` 任务的群聊面板轮次构建，让它包含执行群聊轮次。
- 允许辩论任务写入主从执行 transcript，不再只服务 `main_sub_multi_agent`。
- 优化执行群聊轮次排序/选中，任务进入执行阶段后优先展示执行群聊。
- 更新单元测试和事实来源文档。

## 非目标

- 不改变辩论参与者流程、共识校验、主任务 JSON 协议或子任务并发策略。
- 不把子任务执行文本直接追加到 `debates/round-*/chat.md`；执行 transcript 仍保持在沟通目录根部 `group-chat.md`。
- 不新增可写入的 Webview 交互。

## 验收标准

- [x] `debate_multi_agent` 任务达成 `continue` 后，`group-chat.md` 会记录主任务派发和子任务动态加入。
- [x] 同一个“打开Loop群聊”入口能看到辩论轮次和“任务执行群聊”轮次。
- [x] 执行群聊中运行中的主任务/子任务显示思考中气泡，刷新和置底逻辑继续复用。
- [x] 相关 TypeScript build 和 loop debate 单测通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/loopDebatePanel.ts`、`src/test/loopDebate.test.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无

## 风险与缓解

- 风险：辩论任务面板默认仍选中旧辩论轮次，用户误以为没有子任务消息。
- 缓解：执行阶段或执行 transcript 有新增内容时，把“任务执行群聊”作为默认首选。
- 风险：历史辩论任务没有 `group-chat.md`。
- 缓解：面板构建时按现有任务记录懒创建初始 transcript。

## 验证计划

- 最小相关验证：`npm run build`，`node --test dist/test/loopDebate.test.js`
- 扩展验证：用现有任务记录或手工任务对象检查 `group-chat.md` 的解析与面板轮次。

## 测试与清单同步

- 单元测试：已补充辩论共识后执行群聊 transcript 解析测试。
- 功能清单：已更新辩论多智能体群聊描述。
- 相关文档同步：已更新辩论设计、运行时参考、运行时设计和能力规格。

## 任务列表

- [x] 定位辩论任务子任务执行未进群聊的早退逻辑
- [x] 修改面板轮次和 transcript 写入逻辑
- [x] 补充测试
- [x] 同步文档
- [x] 运行验证并归档计划

## 决策记录

- 2026-06-17：执行阶段不混入辩论 `chat.md`，而是在同一个面板中增加 `group-chat.md` 对应的“任务执行群聊”轮次，保持规划与执行 transcript 边界清晰。

## 当前结论

已完成。根因是 `appendLoopMainSubChatSection` 对辩论任务直接返回，并且辩论任务面板只构建 `debateRounds`。现在辩论任务也会写入根部 `group-chat.md`，群聊面板会合并展示辩论规划轮次和“任务执行群聊”轮次；任务已有子任务或子任务历史时默认优先显示执行群聊。验证通过：`npm run build`、`node --test dist/test/loopDebate.test.js`、`git diff --check`。
