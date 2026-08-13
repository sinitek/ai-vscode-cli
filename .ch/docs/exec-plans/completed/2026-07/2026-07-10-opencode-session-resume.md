# OpenCode 会话二次执行修复

- 日期：2026-07-10
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-10
- claim_ttl：本次会话
- handoff_to：

## 背景

OpenCode 会话 tab 首次执行成功后，第二次执行稳定报错 `Error: Session not found`。本机 OpenCode 1.17.16 JSONL 实际输出使用 `sessionID`，而插件会话提取逻辑只识别 `session_id`，导致真实 `ses_*` 未被接管；首轮结束时生成的插件本地 `local_*` 占位 ID 又在第二轮被作为 `opencode run --session` 参数传入。

## 目标

让 OpenCode 普通会话和并行会话正确接管 CLI 返回的真实 session ID，并在同一 tab 第二次执行时续接该真实会话；已有 `local_*` tab 应避免继续触发 `Session not found`，同时保留插件侧消息历史。

## 范围

- OpenCode JSONL session ID 解析。
- OpenCode one-shot / 并行运行的续接 ID 边界校验。
- 旧 `local_*` 会话向新捕获真实 session ID 的消息与 tab 引用迁移。
- 单元回归测试、运行时事实文档、功能清单与踩坑记录。

## 非目标

- 不把 OpenCode 接入 Codex / Claude interactive runner。
- 不改变 OpenCode 模型、variant、权限或 runtime overlay 行为。
- 不清理或重写用户现有会话文件。

## 验收标准

- [x] 能从 OpenCode 1.17.16 的 `sessionID` JSONL 事件提取真实 `ses_*`。
- [x] 同一 OpenCode tab 第二次运行使用真实 session ID，而不是插件 `local_*` ID。
- [x] 已存在的 `local_*` tab 不再把本地 ID传给 OpenCode；捕获新真实 ID 后保留并迁移原消息历史。
- [x] OpenCode 普通 one-shot 与并行路径使用一致的会话规则。
- [x] 最小相关测试与 `npm run build` 通过；全量测试中的范围外/陈旧产物失败已分类记录。

## 影响面

- 代码目录：`src/cli/commandRunner.ts`、`src/sessionLifecycle.ts`、`src/extension.ts`
- 测试目录：`src/test/opencodeCommandRunner.test.ts`
- 文档目录：`.ch/docs/references/`、`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：无

## 风险与缓解

- 风险：旧 `local_*` tab 没有可恢复的底层 OpenCode 上下文。
- 缓解：不猜测全局 `--continue`；旧 tab 下一次运行创建新底层会话，捕获真实 ID 后迁移插件消息历史。新版本首次运行会立即捕获真实 ID，后续正常续接。
- 风险：仓库存在大量与当前任务重叠的未提交修改。
- 缓解：只追加最小逻辑和文档段落，不回退或覆盖现有改动；验证使用当前工作树基线。

## 验证计划

- 最小相关验证：OpenCode 命令构建、`sessionID` 提取、本地占位 ID过滤测试。
- 单元自测命令：`node --test dist/test/opencodeCommandRunner.test.js`
- 扩展验证：`npm test`（若脚本存在）、`npm run build`、`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：`src/test/opencodeCommandRunner.test.ts` 新增真实 `sessionID` 提取和 `local_*` 过滤回归用例。
- 单元自测结果：`node --test dist/test/opencodeCommandRunner.test.js` 26/26 通过；OpenCode/会话相关组合测试 48/48 通过；`npm run build` 通过。
- 失败处理记录：全量 `node --test dist/test/*.test.js` 为 346/369 通过。22 个失败来自无对应 `src/test` 的陈旧 `dist/test/loopBoundaryRecord.test.js`；另 1 个失败来自当前工作树已有 `media/config/assets/config-app-ui.js` 标题改动与 `src/test/configService.test.ts` 旧断言不一致。均与本次会话链路无关，未扩大修改范围。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步运行时参考、设计文档、能力规格与 `PITFALLS.md`；兼容入口文件继续指向 `.ch` 事实来源，无需新增重复正文。

## 任务列表

- [x] 定位实际错误参数和 OpenCode JSONL 字段。
- [x] 修复真实 session ID 提取与 `local_*` 续接边界。
- [x] 补充回归测试与文档。
- [x] 完成测试、build、diff 检查并归档计划。

## 决策记录

- 2026-07-10：以 OpenCode 1.17.16 实际 JSONL `sessionID` 为事实输入，不再假设 snake_case 字段。
- 2026-07-10：旧 `local_*` 不使用 `--continue` 猜测全局最近会话，避免多 tab / 并发串线；改为启动新底层会话并迁移插件消息历史。

## 当前结论

修复已完成。OpenCode JSONL `sessionID` 会在首轮流式输出中被结构化提取并接管；普通 one-shot 与并行路径只把可用的真实外部 ID传给 `--session`。旧 `local_*` tab 会启动新底层会话，并在捕获 `ses_*` 后迁移插件消息与 tab 引用。验证通过：最小测试 26/26、相关组合测试 48/48、`npm run build`、全仓与本任务文件 `git diff --check`、官方技能 description 中文检查 56/56。

记忆金字塔检查：本次真实复发原因与固定规避动作已沉淀到 `.ch/docs/runbooks/PITFALLS.md`，运行事实已进入 reference/design/product spec；无需在 L1/L2/L3 热区重复记录。
