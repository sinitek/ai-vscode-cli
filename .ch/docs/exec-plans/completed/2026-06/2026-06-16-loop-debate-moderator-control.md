# Loop辩论主持人控场

- 日期：2026-06-16
- 状态：completed
- 负责人：Codex

## 背景

当前 `debate_multi_agent` 已改为共享 `chat.md` 的模拟群聊，但群聊固定为两轮发言，缺少一个在辩论过程中判断“继续追问、进入收束、直接阻塞”的主持人角色。实际体验更像批量报告，而不是由多角色相互回应并被主持人控场的辩论。

## 目标

让Loop辩论模式在每轮角色发言后由主持人读取完整群聊并输出控制决策，在运行时根据主持人决策决定继续讨论、进入最终立场收集、或阻塞人工复核。

## 范围

- `src/loopDebate.ts`：补充主持人 artifact 路径、主持人决策类型和最大安全轮数含义。
- `src/extension.ts`：把固定两轮循环改为主持人动态控场循环，保留最大轮数兜底；更新提示词、日志、恢复校验和共识汇总输入。
- `src/test/loopDebate.test.ts`：覆盖主持人 artifact 路径和新的最大轮数语义。
- `.ch/docs/` 相关设计、运行时参考和功能清单：同步用户可见行为。

## 非目标

- 不改变顶层 `interactiveMode=loop`。
- 不改变子任务派发、重试、并发执行和主任务最终 JSON 协议。
- 不新增 UI 配置项；本轮只把固定两轮改成主持人动态判断加运行时硬上限。

## 验收标准

- [x] 群聊不再固定两轮，主持人每轮输出 `continue / finalize / block` 控制动作。
- [x] 主持人要求继续时，会追加下一轮参与者发言；主持人要求收束或阻塞时，会进入最终立场收集。
- [x] 达到最大安全轮数时自动收束，避免无限循环。
- [x] 恢复校验要求 `chat.md` 有主持人收束标记，旧两轮产物会重跑。
- [x] `npm run build` 通过。
- [x] `node --test dist/test/loopDebate.test.js` 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/loopDebate.ts`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/references/`、`.ch/docs/product-specs/`
- 配置与脚本：无新增配置或脚本

## 风险与缓解

- 风险：主持人模型输出无法解析，导致任务卡住。
- 缓解：解析失败时进入 `needs-review`，不继续派发子任务。
- 风险：主持人持续要求继续导致无限讨论。
- 缓解：运行时保留最大安全轮数，到上限强制收束并进入最终立场收集。
- 风险：旧产物被错误复用。
- 缓解：恢复校验要求新的主持人收束标记和最终 participant artifacts。

## 验证计划

- 最小相关验证：`node --test dist/test/loopDebate.test.js`
- 扩展验证：`npm run build`

## 测试与清单同步

- 单元测试：更新 loop debate 纯函数测试。
- 功能清单：同步 `FEATURE_INVENTORY.md`。
- 相关文档同步：同步设计文档、运行时参考、产品规格。

## 任务列表

- [x] 梳理当前两轮固定实现。
- [x] 增加主持人决策模型和 artifact 路径。
- [x] 改造辩论运行循环与提示词。
- [x] 更新测试和文档。
- [x] 构建与单测验证。
- [x] 归档执行计划。

## 决策记录

- 2026-06-16：主持人是控场角色，不替代最终共识汇总器；主持人只决定辩论是否继续，最终 `decision.json` 仍由共识汇总器基于完整 `chat.md` 和最终参与者 artifact 生成。
- 2026-06-16：运行时最大轮数从固定流程上限改为安全上限，主持人可以提前收束或阻塞。

## 当前结论

已完成。辩论模式改为主持人动态控场，验证通过 `npm run build` 与 `node --test dist/test/loopDebate.test.js`。
