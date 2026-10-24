# 关键单测补齐与全量回归

- 日期：2026-10-24
- 状态：completed
- 负责人：协作
- owner：loop-attempt-round-1-critical-unit-regression
- claimed_at：2026-10-24
- claim_ttl：本轮执行结束
- handoff_to：独立复核

## 背景

主复核确认仓库 HEAD 为 `e62408a` 且工作区干净，但没有任何本轮执行或测试通过证据。最近能力包括聊天图片预览与下载、VSIX 平台定向导出、模型管理弹窗生命周期、VS Code 市场一键发布。需要在既有 `node:test` 入口上做有界缺口审计，只补真实未覆盖的关键行为，并对确定缺陷先写回归再最小化修复。

## 目标

- 以 `npm run test:unit` 取得可复核的基线与最终全量结果。
- 审计图片预览/资源、VSIX 打包发布、模型管理弹窗的现有测试，只补未覆盖的成功、边界和拒绝路径。
- 发现确定缺陷时用回归用例锁定后再修。
- 用 `npm run validate:whitespace` 与 `git diff --check` 收口。

## 范围

- `src/test/` 中与上述能力及基线失败对应的测试。
- 确定缺陷的最小生产修复：Grok 空白文本片段过滤，以及一处历史行尾空白。
- 功能清单中与现行折叠摘要契约矛盾的一句。
- 本计划。

## 非目标

- 不改技术栈、不升级依赖、不引入新测试框架、不做无关重构。
- 不改变 UI 布局、颜色、间距、组件结构和交互。
- 不执行真实市场发布，不改用户配置，不消耗真实外部服务。
- 不创建或上传正式 VSIX 发行产物。
- 不把普通任务流水写入 `ROLLING_SUMMARY.md`。
- 不修改父任务记录、调度状态、active ids 或 loopPlus 快照。
- 不提交 git commit。

## 验收标准

- [x] 基线 `npm run test:unit` 有完整日志和退出码。
- [x] `node scripts/run_unit_tests.js --list` 只含 `dist/test/**/*.test.js`，不含 `src/test/**/*.ts`。
- [x] 新增测试覆盖相应成功、边界、拒绝或异常路径，且不重复已有断言。
- [x] 最终 `npm run test:unit` 正常退出并给出汇总。
- [x] `npm run validate:whitespace` 与 `git diff --check` 已执行并记录。
- [x] 契约同步范围已写明。

## 影响面

- 代码目录：`src/interactive/grokAppServerProtocol.ts`、`src/webview/viewContentStrings.ts`、`src/test/`。
- 文档目录：本计划、`.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 配置与脚本：未改 `scripts/run_unit_tests.js`、`scripts/vsix_target.js` 或导出/发布脚本。

## 风险与缓解

- 风险：`npm run build` 会清理 `dist`，并行构建会互相污染。
- 缓解：本任务内串行执行构建与测试。
- 风险：CodeGraph 索引有 14 个新增、39 个修改和 15029 条未解析引用。
- 缓解：定位后直接读取待改文件。
- 风险：为通过而放宽断言或跳过测试。
- 缓解：未跳过、删除或降低覆盖门槛。过期断言改为现行契约的精确期望。

## 验证计划

- 最小相关验证：受影响编译后测试已通过。
- 单元自测命令：`npm run test:unit`。
- 扩展验证：`npm run validate:whitespace`、`git diff --check`、`node scripts/run_unit_tests.js --list`。

## 测试与清单同步

- 单元测试新增/更新：图片格式与下载名、Grok 空白片段、Grok 选项位置、模型管理关闭、以及基线失败对应的过期断言和夹具。
- 单元自测结果：最终 `tests 1917 / pass 1917 / fail 0 / skipped 0 / cancelled 0`，退出码 0。
- 失败处理记录：基线 16 失败已按实现缺陷、过期断言、夹具和历史空白分类并处理。
- 功能清单：折叠摘要表格句与现行“(数量) 主标题”对齐。其余契约未改，ontology 未改。
- 相关文档同步：本计划。

## 任务列表

- [x] 读取 AGENTS、TESTING、execution-plan、ontology 状态与关键词。
- [x] 保存 `npm run test:unit` 基线日志与退出码。
- [x] 有界缺口审计并补关键测试或记录已有覆盖。
- [x] 确定缺陷先回归再最小化修复。
- [x] 受影响测试、全量回归、空白校验、diff check。
- [x] 判断功能清单与 ontology，归档计划。

## 决策记录

- 2026-10-24：HEAD `e62408a` 工作区干净，不能当作已验收。ontology 状态 ready，业务域 `cli-plugin-runtime`。相关规则：`plugin.rule.chat_markdown_image_preview`、`plugin.rule.marketplace_publish_authenticated_vsix`、`plugin.rule.vsix_target_preserves_runtime`。
- 2026-10-24：CodeGraph 提示待同步，结论以直接读取的源码和测试为准。
- 2026-10-24：当时记录为“Grok 纯空白 `agent_message_chunk` / `agent_thought_chunk` 按已有宿主回归忽略，含可见字符的空白保留”。该结论错误，见文末“后续更正”。上方测试数字不因更正而改写。
- 2026-10-24：折叠摘要现行文案是 `({count}) {title}`。覆盖测试和功能清单表格中的“标题 (数量)”是过期描述。
- 2026-10-24：`thinkingOptionOff` 行尾空格存在于 HEAD，位于字符串之外，删除后不改变选项文案。

## 当前结论

全量单元入口通过。最终日志：`/tmp/sinitek-loop-unit/final2-test-unit.log`，退出码 0，1917 通过，0 失败，0 跳过。空白校验与 `git diff --check` 退出码均为 0。未创建 VSIX，未执行市场发布。未提交 git commit。

## 后续更正

- 2026-10-24：独立复核证明，用 `text.trim()` 丢弃纯空白 `agent_message_chunk` / `agent_thought_chunk` 会按上游分块边界损坏正文和思考。`Hello`、一个空格、`world` 变成 `Helloworld`。宿主用例期望 `Hello world` 不能反过来定义协议；输入里的三个空格必须保留为 `Hello world   `。
- 正确契约：非空有效文本原样保留；空字符串、非文本和无效内容仍忽略；数组文本按原顺序拼接。展示层继续负责隐藏纯空白气泡，分类器不删除流式增量。
- 本文件记录的基线与最终 `tests 1917 / pass 1917 / fail 0 / skipped 0` 保持原样，只作为当时执行证据。修复与新的验证见 `.ch/docs/exec-plans/completed/2026-10/2026-10-24-grok-stream-whitespace-contract-repair.md`。
