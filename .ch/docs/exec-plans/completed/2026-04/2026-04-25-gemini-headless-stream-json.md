# Gemini Headless Stream JSON 调用链路优化

- 日期：2026-04-25
- 状态：completed
- 负责人：Codex

## 背景

当前 Gemini 分组运行走一次性子进程调用，默认参数仅为 `-y`，提示词作为 positional query 传入。Gemini CLI 当前帮助与官方 headless 文档都建议自动化/脚本场景显式使用 `-p/--prompt`，并支持 `--output-format stream-json` 输出结构化事件。当前文本流解析容易导致 session_id 提取不稳定、stderr 噪声污染、分组并发体验不稳定。

## 目标

在不引入新技术栈、不实现完整 ACP runner 的前提下，让 Gemini 分组/one-shot 调用优先使用官方 headless + stream-json 形态，并在插件内解析结构化事件以稳定展示结果和保存 session_id。

## 范围

- Gemini CLI 参数构建：自动补齐 `-p <prompt>` 与 `--output-format stream-json`。
- 保持用户显式配置 `-p/--prompt`、`--output-format` 时不重复插入。
- Gemini stream-json 行解析：提取 assistant delta、session_id、错误/结果事件。
- Gemini one-shot / parallel 输出展示改为基于解析后的 assistant 文本，保留 raw stream 供调试面板观察。
- 更新运行时事实来源与功能清单。

## 非目标

- 不实现 Gemini ACP client / app-server 同类长连接协议。
- 不改 Codex / Claude 运行链路。
- 不默认替换 Gemini 权限模式为 `--approval-mode auto_edit`，避免未批准的默认行为变更。
- 不升级或锁定 Gemini CLI 版本。

## 验收标准

- [x] Gemini 构建参数在普通提示词下包含 `-p <prompt>` 与 `--output-format stream-json`。
- [x] 用户已配置 `--output-format` 或 `-p/--prompt` 时不重复插入对应参数。
- [x] Gemini stream-json 可解析 `init.session_id`、assistant `message.delta`、`result.status` 与 `error`。
- [x] Gemini one-shot 和 parallel 最终 assistant 消息不再保存完整 JSONL 原文。
- [x] `npm run build` 通过。
- [x] 相关事实来源文档已同步。

## 影响面

- 代码目录：`src/cli/`、`src/extension.ts`
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`
- 配置与脚本：`package.json` 默认配置本轮不改

## 风险与缓解

- 风险：旧版 Gemini CLI 不支持 `--output-format stream-json`。
  - 缓解：当前已在本机 `gemini 0.39.1` 验证支持；若用户旧版失败，将通过 CLI exit/error 显示，后续可补版本探测降级。
- 风险：不同版本 JSONL 事件字段变化。
  - 缓解：解析器采用宽松字段校验，未知事件进入 trace 或忽略，不阻断主流程。
- 风险：用户显式配置 prompt 参数时插件仍传入 prompt，可能语义冲突。
  - 缓解：检测到用户已配置 `-p/--prompt` 时不自动插入，保持用户优先。

## 验证计划

- 最小相关验证：新增/运行解析与拼参轻量脚本或单元式验证；`npm run build`。
- 扩展验证：本机执行一次 `gemini -y -p "Say only OK" --output-format stream-json` 验证输出形态。

## 测试与清单同步

- 单元测试：仓库当前无测试框架；使用可纳入 `scripts/` 的 Node 脚本验证导出函数，或通过 TypeScript build 校验。
- 功能清单：同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 中 Gemini 运行说明。
- 相关文档同步：同步 `.ch/docs/references/cli-runtime-reference.md`。

## 任务列表

- [x] 创建执行计划
- [x] 实现 Gemini 参数构建与 stream-json 解析
- [x] 接入 one-shot / parallel 展示逻辑
- [x] 补充验证脚本或最小测试覆盖
- [x] 同步文档
- [x] 执行构建验证并归档计划

## 决策记录

- 2026-04-25：优先采用 Gemini 官方 headless + stream-json 作为最小稳定化方案；ACP 作为后续设计项，不在本轮实现。
- 2026-04-25：本轮不改默认 `-y`，避免权限行为变化；只优化 prompt 与输出协议。

## 当前结论

已完成 Gemini one-shot / parallel 调用链路优化：

- `src/cli/commandRunner.ts` 会对 Gemini 自动补齐 `-p <prompt>` 与 `--output-format stream-json`，并保持用户显式配置优先。
- 新增 `src/cli/geminiStreamJson.ts`，集中处理 Gemini stream-json 参数与 JSONL 事件解析。
- `src/extension.ts` 的 Gemini one-shot / parallel 分支使用解析后的 assistant delta / session_id / result，而不是把 JSONL 原文作为最终回复。
- 新增 `scripts/validate_gemini_stream_json.js` 做最小回归验证。
- 已同步 `.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`。

验证结论：

- `npm run build` 通过。
- `node scripts/validate_gemini_stream_json.js` 通过。
- 本机 `gemini -y -p "Say only OK" --output-format stream-json` 返回 exit 0，并输出包含 `init.session_id` 的 JSONL。

后续可选优化：评估 Gemini `--acp` 长连接 Runner，或在用户确认后将默认权限模式从 `-y` 调整为更明确的 `--approval-mode auto_edit`。
