# Loop辩论动态参与者

- 日期：2026-06-17
- 状态：completed
- 负责人：Codex

## 背景

当前 `debate_multi_agent` 辩论模式在运行时固定创建架构规划、实现拆分、测试验收、风险审查 4 个参与者。用户反馈这不符合“辩论模式”的预期：应先由主持人根据任务目标设计需要哪些辩论者，再让这些角色动态加入群聊后开始讨论。

## 目标

让辩论模式在普通发言前增加“主持人选角”阶段，主持人输出本轮参与者 roster，扩展校验后写入任务记录和 `chat.md`，后续发言、最终立场、共识汇总、群聊 UI 都使用动态 roster。

## 范围

- `src/extension.ts`：辩论运行流、主持人选角 prompt、参与者记录构建、artifact 读取校验、系统消息。
- `src/loopDebate.ts`：选角 artifact 路径、可解析 transcript heading、必要类型。
- `src/webview/loopDebatePanel.ts`：动态加入事件展示。
- `src/test/loopDebate.test.ts`：路径和 transcript 解析测试。
- `.ch/docs/`：同步辩论设计和产品事实来源。

## 非目标

- 不改 VS Code 设置项和外部命令名。
- 不移除现有旧记录的读取兼容。
- 不把主持人/参与者改成真正并发群聊；仍由扩展顺序推进，保证可控和可恢复。

## 验收标准

- [x] 辩论任务启动后先运行主持人选角，而不是直接固定 4 人发言。
- [x] 主持人可输出 2~6 个参与者，扩展校验唯一 id、标题、关注点和 artifact 路径。
- [x] `chat.md` 记录动态参与者加入群聊，群聊 UI 可显示这些加入事件。
- [x] 后续发言、最终立场、共识汇总、复用校验只使用动态 roster。
- [x] `npm run build` 和相关 node test 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/loopDebate.ts`、`src/webview/loopDebatePanel.ts`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无

## 风险与缓解

- 风险：主持人输出非法 roster 导致流程无法继续。
- 缓解：强制 JSON 结构、数量上限、唯一 id 校验；非法时进入人工复核，不回退固定 4 人。
- 风险：旧的已落盘辩论记录缺少选角 artifact。
- 缓解：已有 `debateRounds.participants` 仍可被读取；只有缺少 roster 且需要重跑时才要求重新选角。

## 验证计划

- 最小相关验证：`node --test dist/test/loopDebate.test.js`
- 扩展验证：`npm run build`

## 测试与清单同步

- 单元测试：补动态参与者加入 transcript 解析、选角 artifact 路径。
- 功能清单：更新辩论模式描述。
- 相关文档同步：更新辩论设计文档和 CLI runtime 参考。

## 任务列表

- [x] 梳理固定 4 人流程和默认参与者依赖点。
- [x] 新增主持人选角 artifact、prompt、读取校验。
- [x] 改造辩论主流程使用动态 roster。
- [x] 更新 UI transcript 解析和展示。
- [x] 更新测试与文档。
- [x] 运行构建和相关测试。

## 决策记录

- 2026-06-17：动态 roster 数量设为 2~6 个，主持人可根据任务复杂度选择；运行时仍保留最大群聊轮数作为安全兜底。
- 2026-06-17：主持人选角失败不回退固定 4 人，避免再次出现“看似动态实则固定”的行为。
- 2026-06-17：旧版固定 4 人 `chat.md` 缺少 `## 参与者加入` 标记，恢复时不得直接复用，必须重跑为动态参与者流程。

## 当前结论

已完成动态参与者改造。辩论轮会先由主持人生成 `moderator-participants.md`，校验通过后把参与者加入 `chat.md` 并按动态清单推进；主持人选角 sessionId 会进入任务记录以便恢复，旧版固定参与者 transcript 不再被当作完整动态群聊复用。`npm run build`、`node --test dist/test/loopDebate.test.js` 和 `git diff --check` 均通过。尚未做真实 VS Code Extension Host 端到端手工验收。
