# Codex 组长大型原生回调私有 IPC 修复

- 日期：2026-11-18
- 类型：bugfix
- 状态：in-progress
- 负责人：Loop+ round-2 coding attempt
- 关联计划：无；父任务本轮另有独立 scripts 宿主验证交付。

## 背景与目标

修复新建产研部任务中大型原生工具结果导致组长私有通道关闭的问题。父任务 main-task.md 确认第四组工具完成事件 67,228 字节与 worker-callback-message-rejected 吻合；前三组仅确认宿主 ACK 发送失败。重建兼容转换保留 aggregatedOutput 并新增 aggregated_output 后前三组约 103 KB，只证明机制，不确认其原私有帧或首因。修复版 dist 当时已加载。

## 范围、影响面与非目标

修改私有合同、固定 worker、宿主 bootstrap、Owner/协议夹具及相关设计、功能清单、本体。公共 Owner socket、单次 grant、原始 receipt、容量门禁、32 项窗口及 notification barrier 保持。合法输出不截断；不全局提高 64 KiB，不把 onRequest 加入通知 barrier。不改共享 dist、并行 scripts、用户任务或调度状态。

## 验收标准

- [x] 小消息沿用 callback，白名单流回调大消息使用原私有 IPC 有界分片，完整交付原 onNotification/onEvent。
- [x] 核对原 token/identity/全局 sequence/当前 invocation/分片长度数量顺序和摘要，完整消费仅一次 ACK。
- [x] 保持回调调用顺序、通知 drain、32 项门禁；限制逻辑字节、累计未确认字节和分片数。
- [x] 新增兼容字段扩展、原始 UTF-8 大输出、交错短回调、损坏/未完成分片、精确终态和原 Owner 清理回归。
- [x] 隔离目录标准 build 与受影响 Owner、协议测试通过，ontology 校验和测试通过。

## 风险与缓解

分片错序、重复、跨身份/调用、未完成及超限均固定诊断并保持 unknown；不记录正文、原错误或凭据。按初始到达顺序预约回调槽，重组后才交付，不串行等待交互请求。既有短文本宿主及 40 条普通通知突发证据按未变范围复用，新增真实 EH 长工具输出场景由父任务等双方交付后运行。

## 验证计划与测试清单

在唯一实体临时副本运行 npm run build，再串行运行受影响 Owner、私有协议、Codex 协议测试；共享 dist 不写。运行 ontology --validate 与 skill unittest，范围空白校验。记录所有中间失败、最终结果及未覆盖范围；不重跑仍有效的旧验收。

## 进展与决策

- 已读父任务现场、execution-plan/ontology、TESTING 与当前双端源码。CodeGraph 对新增文件无索引匹配，回退直接读取。
- 使用白名单流数据回调的 UTF-8 JSON/base64 分片；控制/请求帧不豁免。
- 待实现、验证及主任务整合验收，保持 active。

## 实现与证据记录

- 实现位置：`departmentleadercodexcontract.ts` 提供共享编码/重组器，worker 预约逻辑 callback 槽和字节并一次发送有序分片，bootstrap 保留原认证/调用门禁并在完整消费后仅 ACK 首序号。逻辑 args 单项 8 MiB、累计未完成及未确认 16 MiB、每片 24 KiB 原始数据、每回调最多 342 片；slot 保持 32。
- 发送前序列化一次 args 快照，大小测量与小消息/分片来自同一快照；超限、序列化、断连/发送失败使用固定阶段，正文与凭据不进入诊断。
- 小回调首次到达即预约槽；缺片期间到达的短回调按原初始顺序调用。完整回调的异步 Promise 保留，既有 notification barrier 和独立 onRequest 不变；终态/drain 不接受未完成回调或未确认消费者。
- 新增范围外最小文件：`src/test/runtime/departmentleadercallbackprotocol.test.ts`，独立承接坏片、预算、顺序、认证及唯一 ACK 测试，避免扩大原 Owner 生命周期文件；不涉及 scripts。其余改动均在建议范围内，实际清单路径为大写 `FEATURE_INVENTORY.md`（本机大小写别名）。
- 并行保留：初始磁盘上的 notification pacing、worker failure 日志及 40 条 burst 用例保持；共享 ontology 已有 roster 可见范围规则、日期和清单其它并行改动保留。`git diff` 对 HEAD 包含这些既有修改，不全部归本 attempt。

### 已执行检查（非父任务验收结论）

实体隔离副本：`/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/department-large-callback-build-4njaaj95`。源码实体复制、node_modules 只读复用链接；`npm run build` 仅清理副本 dist，不改共享 dist。

1. 首次 `npm run build` exit 0；`node --test --test-name-pattern='compatible 51' dist/test/runtime/departmentleadercodexowner.test.js` 1/1 通过，证明初始大输出及原 receipt 用例。后续协议/边界修改后由后列检查替代相关范围。
2. 更新重组器终态门禁和新增协议测试后 `npm run build` exit 0。`node --test --test-concurrency=1 --test-reporter=tap dist/test/runtime/departmentleadercallbackprotocol.test.js dist/test/runtime/departmentleadercodexowner.test.js dist/test/runtime/departmentleaderinvocation.test.js dist/test/interactive/codexAppServerProtocol.test.js > large-callback-tests.tap 2>&1` exit 0，71/71：callback protocol 23、Owner 32、invocation 3、原 Codex 协议 13。
3. 随后仅补强协议测试（合法终态遇缺片、匹配摘要但非法 JSON/UTF-8/arity），标准 build exit 0，再跑单个 callback protocol 文件 `node --test --test-reporter=tap dist/test/runtime/departmentleadercallbackprotocol.test.js > large-callback-protocol-final.tap 2>&1` exit 0，24/24；其余源码当时未改，不重跑仍有效检查。
4. 最后复核将 args 编码改为一次快照（防自定义 toJSON 两次变化），并补强原始 UTF-8 >64 KiB、兼容原始 <64 KiB 的明确断言。重新 `npm run build > large-callback-build-final.log 2>&1` exit 0；`node --test --test-concurrency=1 --test-reporter=tap dist/test/runtime/departmentleadercallbackprotocol.test.js dist/test/runtime/departmentleadercodexowner.test.js > large-callback-affected-final.tap 2>&1` exit 0，56/56（24 protocol + 32 Owner），0 failed/cancelled/skipped/TODO；未修改 invocation 或 Codex 转换，原 16 项证据继续有效。
5. `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` exit 0：2 domains / 27 concepts / 24 relations / 164 rules / 4 workflows / 3 documents。`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` exit 0，9/9。之后仅 TS 与本计划证据更新，未改 ontology 或其 source_refs。
6. `node scripts/check_trailing_whitespace.js <本轮10个文件>` exit 0；最末计划记录后需范围补查。误用 `--help` 的一次调用只会忽略不存在路径，exit 0，不作为空白检查证据；随后已使用明确路径完成真实检查。

### 范围与剩余整合

没有中间编译或行为测试失败，只有 CodeGraph 新文件无索引匹配与辅助定位路径未命中，均回退当前源码。未启动/清理用户任务，未修改共享 dist、调度状态、主任务或其它 attempt 报告，未改并行 scripts。测试 teardown 只针对本次自建临时 fixture PID，不计作原 Owner 清理证据。

复用既有普通 40 条通知突发及短文本真实宿主证据的未影响范围。此 attempt 的 Owner 32 项运行也包含原 burst 和 onRequest barrier 回归。未运行全仓单测、Windows/Linux 原生、真实模型、安装版 VS Code 长工具输出或浏览器/UI；没有界面变动。大型工具实际 EH 驱动归并行交付，父任务需在双方验收后构建独立新产物并运行，不把本报告代替主审或推断后继完成。本计划保留 in-progress 等待该集成与主审。

### 本次 attempt 收尾

六个本轮 TS 与最终隔离输入 SHA-256 全匹配（`large-callback-source-fingerprints.json`）。最终有效证据为 56 项受影响测试加仍有效的 16 项未改协议/invocation，不声称它们是一次 72 项运行。构建后只写本计划和 attempt 报告，无行为变更。最后对上述十个文件和报告执行明确路径空白检查通过。本地编码及验证完成；active 状态仅保留父任务长输出 EH 集成/主审待办，不推断父任务或后继完成。

### 2026-11-20 关联发现：交互式组长本地键续接失败

此问题与本计划的大型 Codex 回调目标相互独立，不改变上述范围或验收状态；按用户要求在现有部门计划记录本次执行，避免新建重复计划。根因为通用交互续接预检只读取 session-meta 映射，而非 Codex/OpenCode 组长将 native session 单独保存在任务与部门账本中。实现从当前有效 Owner binding 或 producer 已核验的代次续接证明传递 native session；普通聊天、员工和未证明的历史仍拒绝续接。

本次新增回归位于 `src/test/extensionHost/departmentinteractiveruntime.test.ts` 与 `src/test/extensionHost/promptInteractiveRuntime.test.ts`：核验账本 binding、首轮 unbound、代次续接和缺失通用映射的组长路径，并确认普通本地历史仍只读。最终复验 `npm run build` 通过；`node --test dist/test/extensionHost/departmentinteractiveruntime.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js` 为 95/95；Ontology `--validate`、`git diff --check` 和所有本次变更文件的空白检查通过。全仓无参数空白检查另报未修改的 `AGENTS.md:8`，不属于本次变更。未运行真实 VS Code Extension Host 或用户任务；原计划仍等待大型输出 EH 集成与主审，不改变其状态。
