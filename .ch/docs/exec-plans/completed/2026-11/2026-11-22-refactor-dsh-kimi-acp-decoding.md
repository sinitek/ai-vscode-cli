# DSH 与 Kimi Code 共用 ACP 会话解码

- 日期：2026-11-22
- 类型：refactor
- 关联计划：无
- 状态：completed
- 负责人：Loop+ round-3-dsh-kimi-acp-decoding

## 背景与目标

DSH 和 Kimi Code 重复实现了 ACP 帧解码、会话更新读取、文本提取与增量跟踪。提取一个纯模块并从两条现有适配器入口复用。

## 范围与非目标

范围包括共享函数、两个适配器的现有导出，以及对应协议和 Runner 回归。Grok 帧契约、各适配器的工具事件、权限、回合结束、会话隔离和脱敏逻辑都沿用原实现。

## 验收标准

- [x] 保留空白与非法帧的区别、校验规则、错误结果和六字段投影。
- [x] 保留会话 ID 优先顺序、嵌套与扁平更新选择，以及空值处理。
- [x] 保留递归文本顺序、内容优先级和调用者持有的增量跟踪 Map。
- [x] 使用 `534095ff` 临时源码副本完成构建及两组协议和 Runner 单测。

## 影响面与风险

改动限于 `src/interactive/`、`src/test/interactive/` 和本计划。细微的帧和增量语义差异可能影响 Runner 输出，通过两条入口的回归用例保护。回滚可恢复两个适配器的独立实现。

## 验证计划

- 从 `534095ff` 导出独立临时源码，只复制本项源码和测试改动，链接已安装的 `node_modules`。
- `npm run build`
- `node --test dist/test/interactive/dshAppServerProtocol.test.js dist/test/interactive/kimiAppServerProtocol.test.js dist/test/interactive/dshRunner.test.js dist/test/interactive/kimiRunner.test.js`

## 测试与清单同步

两个协议测试文件覆盖坏帧、更新结构、ID 优先级、空值、重复、累计快照和追加文本。功能清单、业务本体和架构说明沿用现有记录，本项保持公开行为与事实来源路径。

`npm run build` 成功，指定的 4 个测试文件共 89 项通过，0 失败、0 跳过。验证范围为 `534095ff` 与本项五个源码和测试文件。全量单测、真实 CLI、扩展宿主和并行改动合并后的构建留待集成阶段按需验证。

## 任务列表

- [x] 核对仓库规则、现有实现及调用边界。
- [x] 提取共享实现并补充入口用例。
- [x] 完成隔离验证并归档计划。

## 决策记录

- 两个公开入口保留原有的具名函数和消息类型名称。通用函数放在 `src/interactive/acpSessionProtocol.ts`，文件名与同目录模块的大小写风格一致。

## 当前结论

本轮代码与隔离验证已完成。主任务依据执行报告审查兼容性及并行改动的集成范围。
