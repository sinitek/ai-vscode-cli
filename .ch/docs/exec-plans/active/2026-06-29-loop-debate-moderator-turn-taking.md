# Loop 红蓝辩论主持人轮流点名调度

- 日期：2026-06-29
- 状态：in-progress
- 负责人：Codex

## 背景

当前 `debate_multi_agent` 虽然具备裁判主持人、红蓝参与者和共识汇总器，但实际调度仍是“同一发言批次内所有参与者并行发言，再由主持人决定 continue / finalize / block”。这更接近批处理式多智能体，而不是用户期望的群聊式辩论。用户要求改成主持人先点名某人发言，发言后再唤醒主持人，由主持人根据局势继续安排下一位或下一批参与者，直到辩论结束。

## 目标

把红蓝辩论流程改成主持人驱动的轮流点名调度，同时保留现有红蓝角色约束、共识汇总、主决策复用、任务恢复和群聊展示链路。

## 范围

- `src/extension.ts` 中红蓝辩论调度、主持人 artifact 解析、提示词与 transcript 追加逻辑。
- `src/loopDebate.ts` 中主持人决策类型定义与相关纯函数。
- `src/test/loopDebate.test.ts` 中协议解析与 transcript 兼容测试。
- `.ch/docs/design-docs/loop-debate-multi-agent-mode.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`

## 非目标

- 不改变 `main_sub_multi_agent` 行为。
- 不重写共识汇总器或子任务执行/重试机制。
- 不改 VS Code 群聊 UI 的整体交互结构，只做必要的状态兼容。

## 验收标准

- [x] 主持人 artifact 能指定下一位或下一批发言参与者，调度循环按主持人指定执行。
- [x] 首批发言者由主持人组队阶段指定；后续每批发言后都先回到主持人控场，再决定下一批或收束。
- [x] 现有共识汇总、任务恢复、群聊 transcript 解析和 build 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/loopDebate.ts`、`src/test/loopDebate.test.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`
- 配置与脚本：无新增配置；沿用现有 `npm run build`

## 风险与缓解

- 风险：新主持人决策协议与旧 artifact/恢复产物兼容性不足。
- 缓解：保留旧 `continue/finalize/block` 解析路径；未指定参与者时回退到“全体参与者”以兼容旧记录。
- 风险：群聊 transcript 结构变化导致面板解析退化。
- 缓解：尽量保持原有 heading 结构，仅在正文和主持人 JSON 中增加“下一批发言人”信息；补测试覆盖。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：`node --test dist/test/loopDebate.test.js`

## 测试与清单同步

- 单元测试：已补充主持人点名发言辅助逻辑测试，并保持 `loopDebate` 解析测试通过
- 功能清单：已更新红蓝辩论多智能体行为描述
- 相关文档同步：已更新辩论设计与能力规格

## 任务列表

- [x] 定位现有辩论调度与文档事实来源
- [x] 改造主持人决策协议与轮流点名调度实现
- [x] 更新测试、规格与设计文档并执行验证

## 决策记录

- 2026-06-29：保留“同批可多人发言”的能力，但改为必须由主持人显式点名；这样既满足群聊控场，也保留必要时的并行回应能力。

## 当前结论

已完成。`debate_multi_agent` 现改为主持人驱动的轮流点名调度：组队阶段指定首批发言者，后续每个发言批次都由主持人用 `nextSpeakerIds` 指定 1-3 位下一批发言者；只有被点名的参与者进入该批次。验证通过：`npm run build`、`node --test dist/test/loopDebate.test.js`。
