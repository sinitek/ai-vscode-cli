# Loop 群聊状态职责拆分

- 日期：2026-11-13
- 类型：refactor
- 状态：completed
- 负责人：Loop+ fullstack coding attempt
- 关联计划：无

## 背景与目标

`panelStateBuilder.ts` 混合编辑器面板、群聊状态、transcript 协调和 Loop+ 展示投影。本计划将群聊状态及 Loop+ 投影移入职责模块，以兼容 Facade 保持公开调用契约和行为。

## 范围与非目标

- 范围：新增群聊状态/投影模块、协调器局部导入调整、直接模块测试及边界设计文档。
- 非目标：调度算法、任务记录、UI、协议、`extension.ts` 和共享构建目录。

## 验收标准

- [x] classic 返回无投影；非法 snapshot 保持 invalid 形状；投影只读取 scheduler snapshot 副本。
- [x] 群聊/transcript 与投影职责拆分，展示类型通过 type-only import 引入。
- [x] Facade 保留函数身份、参数及返回结构；群聊协调器依赖职责模块。
- [x] 增加直接导入、Facade 身份、成功/非法 snapshot、transcript 缺失边界测试。

## 影响面

- 代码：`src/panelStateBuilder.ts`、`src/loopGroupChatPanelState.ts`、`src/loopPlusPanelProjection.ts`、`src/extensionHost/loopGroupChatPanelCoordinator.ts`、`src/test/loop/loopGroupChatPanelState.test.ts`
- 文档：`.ch/docs/design-docs/loop-group-chat-state-boundaries.md` 与本归档计划。

## 风险与缓解

- 风险：提取跨成员状态和 transcript helper 时改变格式或时序。
- 缓解：实现区段原样机械迁移；新增直接模块边界测试。剩余集成审查见 attempt report。

## 验证计划与结果

- `npx tsc -p tsconfig.json --outDir .tmp/loop-refactor-group-chat --sourceMap false --incremental false --pretty false`：通过。
- `node --test .tmp/loop-refactor-group-chat/test/loop/loopGroupChatPanelState.test.js .tmp/loop-refactor-group-chat/test/loop/loopPlusPanelState.test.js`：18 通过，0 失败。
- `node -e "require('./.tmp/loop-refactor-group-chat/loopGroupChatPanelState'); require('./.tmp/loop-refactor-group-chat/loopPlusPanelProjection'); console.log('direct module imports: ok without vscode mock')"`：通过。
- `node --test .tmp/loop-refactor-group-chat/test/loop/loopGroupChatPanel.test.js`：53 通过，1 失败（ask bubble Markdown renderer 呈现断言）。
- `node --test .tmp/loop-refactor-group-chat/test/loop/loopPlusGroupChatPanel.test.js`：25 通过，4 失败（现有 DOM count/验收文案呈现断言）。
- 完整命令输出和失败细节见 attempt report。未运行共享 `dist` 构建、真实模型调用、浏览器或扩展宿主验证。

## 测试与清单同步

- 本计划覆盖测试新增；不新建独立 test 计划。
- 功能清单不改：仅内部职责重构，用户可见能力和行为不变。
- `ARCHITECTURE.md` 与 ontology 不改：稳定业务边界和事实引用仍成立；新模块边界由独立设计文档记录。

## 当前结论

- 实现和隔离编译完成，直接模块及 Loop+ 状态回归通过。
- 两个既有呈现套件各有与页面断言相关的失败，主任务需在集成验收时确认其基线归属；不应据此宣称呈现套件全绿。
- 共享工作区另有 session lifecycle/repository 并行改动，本尝试未编辑这些文件。
