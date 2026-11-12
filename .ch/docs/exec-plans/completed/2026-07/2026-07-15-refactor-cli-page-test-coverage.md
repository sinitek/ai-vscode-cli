# 页面覆盖率暴露的源码等价清理

- 日期：2026-07-15
- 状态：completed
- owner：cli-page-coverage-integration
- 类型：refactor

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景与目标

承接原页面覆盖率任务中明确实际实施的生产源码等价改动，保持外部行为不变，使类型约束和运行时边界一致。测试入口、补测、c8阈值均不归本重构；原test记录已删除，历史验证证据留存删除审计。

## 范围与非目标

- `src/webview/configProtocol.ts`：协议action列表收敛为运行时`CONFIG_ACTIONS`常量。
- `src/webview/loopGroupChatPanel.ts`：getSegmentSpeaker最终fallback、getActiveSpeakerFromRound不可达undefined分支、getAvatarLabel非空归一后兜底的等价清理。
- 非目标：不改用户能力、CLI协议、覆盖率白名单/阈值，不开发测试或编写额外产品文档。

## 验收标准

- [x] 上述源码分支等价改动按原实施/决策完成，未新增用户行为。
- [x] 删除审计保留的原类型检查、构建和严格覆盖率为回归证据；保留各自范围外失败及未覆盖边界。

## 影响面

- `src/webview/configProtocol.ts`：协议action列表收敛为运行时`CONFIG_ACTIONS`常量。
- `src/webview/loopGroupChatPanel.ts`：getSegmentSpeaker最终fallback、getActiveSpeakerFromRound不可达undefined分支、getAvatarLabel非空归一后兜底的等价清理。

## 风险与缓解

仅继承本源已记载的交付与证据；不把构建/单测通过扩展成真实CLI、浏览器或真机通过。跨计划出现失败时保留原归因，不为迁移补跑历史命令或改写历史结论。

## 验证计划与历史结果

原历史命令`./node_modules/.bin/tsc --noEmit -p ./`、`npm run build`、`npm run test:page`、`npm run test:page-coverage`均exit0；两页面命令均151/151，四项100%。不启动真实VS Code Webview、浏览器、CLI或网络；vendor bundle/后端桥接不在白名单。

## 测试与清单同步

本计划不新增测试代码；验证复用删除审计留存的历史证据，不建立新的通过声明。
本轮仅拆分历史计划，无用户可见运行时变化，FEATURE_INVENTORY无需新增条目。

## 任务列表与当前结论

- [x] 完成范围内源码等价收敛。
- [x] 不接回已删除test记录的独立测试开发责任；历史验收结果不迁移为本轮重新运行。

状态completed继承原记录的完成口径；未执行与范围外失败仍按上面的具体说明保留。本分区中央映射已同步删除 test 目标；本分区 test 计划已按授权删除，外部引用仍待后续集成；未删除实际测试代码。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
