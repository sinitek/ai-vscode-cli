# 配置模型发现与导入宿主

- 日期：2026-11-04
- 状态：completed（Grok 与其它 CLI 凭据复用修复及回归完成）
- 类型：feature
- 负责人：Codex
- owner：model-import-credential-reuse
- claimed_at：2026-11-04
- claim_ttl：本轮修复验证结束
- handoff_to：无；需真实远端或图形界面验收时另行执行

## 背景

配置编辑器需要从当前未保存草稿发现远端模型，并将用户明确选中的模型导回草稿。网络调用只由扩展宿主承担；导入不保存、不激活配置。七类 CLI 的凭据、协议和配置格式各异，DSH 另有密钥边界。

## 目标

实现安全校验的模型供应商发现、协议适配和仅修改当前草稿的导入 API，并提供与前端固定桥接契约兼容的 `config:request` action。

## 范围

- `src/config/modelimport.ts`：草稿解析、供应商识别、HTTP(S) 模型查询、结果约束和草稿合并。
- `src/webview/configProtocol.ts`、`configPanel.ts`、`configView.ts`：类型契约、宿主分发和 webview API bridge。
- 本轮补充：现有弹窗错误文案处理，不改布局或组件结构；处理器回归属于历史测试工作，仅保留验证证据，不归入 feature 开发范围。
- 实施交付不包含测试开发或事实来源文档编写；历史测试摘要见关联删除审计，文档编写原归 docs companion（已退役，仅历史分工）。

## 非目标

- 原始宿主阶段不修改并行前端资源；本轮只移除过期的 Grok 环境变量指引，不重设布局和样式。
- 不保存、激活或应用模型导入结果，不访问非用户配置地址，不执行 shell。
- 不把模拟服务、处理器测试或本机隔离 CLI 的认证核验声称为真实远端或图形界面端到端验收。

## 验收标准

- [x] 对七平台当前草稿识别配置、URL、协议及 key / env 引用；OpenCode provider 隔离。
- [x] 支持 OpenAI 兼容、Anthropic Messages、Google GenAI 的可用列表 API；不支持协议明确禁用或报错；Ollama 仅在明确原生协议时支持。
- [x] 严格校验输入、HTTP(S) 目标、编码路径/同源重定向、超时、响应/分页/结果大小及不可信文本。
- [x] 导入保留现有配置数据，只追加未配置模型；单模型需显式单选替换；Claude 可独立映射字段。
- [x] DSH key/env 边界不变，不将 env 展开回写；导入不保存或激活。
- [x] 实现满足本计划安全与草稿导入契约；历史验证证据见下文及关联删除审计，本计划不承接测试开发；产品与 ontology 文档归属原指向 docs companion（已退役，完整记录未恢复）。整体前端集成仍待主任务收口。

## 影响面

- 代码目录：`src/config/`、`src/webview/`、`src/test/config/`
- 文档目录：`.ch/docs/exec-plans/active/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`
- 配置与脚本：不变

## 关联计划

- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-config-model-import-host.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
- `.ch/docs/exec-plans/completed/2026-11/2026-11-04-docs-config-model-import-host.md`（已退役，仅历史身份）：原分工为配置管理功能清单及 `cli-plugin-runtime` ontology 的实际更新；文档以本计划已确认的产品与安全边界为事实输入。

## 风险与缓解

- 风险：各平台 schema/协议差异导致错误 endpoint 或错误供应商去重。
- 缓解：按实际 schema 显式映射协议，provider ID 绑定平台与 provider，未确认协议明确禁用。
- 风险：JSONC/TOML 注释或未知字段被重序列化丢失。
- 缓解：复用现有解析约束，只对目标结构做安全局部文本追加；不能安全定位时拒绝修改。
- 风险：服务端返回恶意文本或跨源重定向泄露凭据。
- 缓解：固定错误文案、模型 ID 校验、同源重定向约束、请求限制和密钥脱敏。

## 验证计划

- 最小相关验证：`npx tsc --noEmit --pretty false && npm run build && node --test dist/test/config/modelimport.test.js`
- 单元自测命令：覆盖平台、协议、路径、认证、分页、超时、隔离、保留与拒绝用例。
- 扩展验证：运行 `python3 /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli_2/.agents/skills/ontology/scripts/search_ontology.py --root /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli_2 --validate` 通过；工作区是符号链接，使用临时目录作为 root 会被路径越界保护拒绝。由主任务验证前后端完整集成。

## 关联交付归属

- 删除审计仅保留历史测试摘要，不承接测试开发或补存完整正文；下方历次结果、夹具失败/修正和未决前端复测仍作为既有历史记录保留，前端整体集成由主任务收口。本计划不将测试开发列为 feature 范围。
- 功能清单与配置档案 ontology 的实际编写由 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-docs-config-model-import-host.md` 当时承担（已退役，仅历史分工）；本计划不把文档写作作为实现收尾。

## 任务列表

- [x] 校准平台 schema 与安全策略
- [x] 实现协议发现和草稿导入
- [x] 接入 webview 宿主桥接（host side；前端资源接入待主任务验证）
- [x] 完成宿主实现；历史测试摘要见关联删除审计，文档交付状态原指向 docs companion（已退役，完整记录未恢复）
- [x] 验证并记录集成待办
- [ ] 主任务完成前端资源集成与整体验收

## 决策记录

- 2026-11-04：对无法从配置明确判定的协议返回禁用原因；不得猜测或回退到 OpenAI 协议。
- 2026-11-04：当前草稿是唯一导入目标；宿主只返回新草稿，不保存或激活。

## 当前结论

原始宿主与前端功能已经集成，上一轮功能清单记录完整配置测试 419/419。本轮用户指出：可执行的 Grok 配置被导入层额外要求环境变量，且多个模型的 URL/密钥来源被错误收窄为默认项。以下旧轮次记录仅保留历史；第十一轮的环境变量强制约束已撤销，以本轮凭据复用规则为准。

## 第八轮宿主兼容修复（已完成，整体验收待主任务）

- 修复 Kimi Code 导入缺少必需正数 `max_context_size`，仅从同供应商有效模型模板继承适用配置；无模板时拒绝，继承值不代表服务端发现的能力。
- 保留 OpenCode 空 models 对象内 JSONC 注释，批量追加并维持供应商隔离；区分 Claude AUTH_TOKEN 与 API_KEY 的请求头，保持凭据优先级和安全边界。
- 补充模拟请求与配置回归，运行模型导入、桥接和相关配置测试、build、diff 检查及 ontology 校验；前端并行修改与整体集成由主任务验收。
- `npm run build --silent` 通过；`node --test` 覆盖模型导入、桥接、Kimi、Grok、DSH、Codex、OpenCode 配置及 OpenCode 示例，共 156/156 通过。首轮新增 Kimi 测试因夹具使用无效 capability 而 20/21 通过，改为有效的 `image_in` 后重跑通过；未访问真实服务或密钥。
- ontology 校验通过（2 domains、16 concepts、15 relations、99 rules、2 workflows、3 documents）；`git diff --check` 通过。第八轮没有修改前端资源或其测试，整体集成仍待主任务验收。

## 第九轮 Kimi 用户指引（已完成，整体验收待主任务）

- 在现有弹窗页脚提示模板继承及核对要求；仅将 Kimi 已知缺模板宿主错误首行精确映射为固定修复文案，其他错误继续泛化，不显示或记录原始异常。
- 保持已有状态、布局和草稿并发保护；补充真实弹窗处理器与桥接错误日志回归，验证构建、前后端模型导入、完整配置测试、JS 语法和 diff 检查；整体集成由主任务验收。
- 前端实现位于 `media/config/assets/config-app-ui.js`，桥接错误日志安全修复位于 `media/config/assets/config-app-api.js`（该文件超出建议范围，原因是同步/异步桥接异常原先会把宿主原始错误写入日志）。测试位于 `src/test/config/modelimportui.test.ts`。
- `npm run build --silent` 通过；模型导入宿主和弹窗测试 45/45 通过；完整 `node --test dist/test/config/*.test.js` 通过（415 tests、2 suites）；`node --check` 两个配置资源通过；Impeccable detector 返回 `[]`；ontology 校验及 `git diff --check` 通过。

## 第十一轮 Grok 凭据一致性（历史方案，强制环境变量约束已撤销）

- 新模型使用实际解析的环境变量引用；字面密钥必须与显式环境变量的当前值一致，供应商查询、发现及导入各自重新校验并使用固定失败提示。
- 仅修改宿主、回归测试及文档，不修改并行前端；主任务负责前端展示与完整集成验收。
- `npm run build` 通过；模型导入与桥接回归 61/61 通过。完整配置回归首次 416/416 通过；并行前端新增用例后重跑为 416/417，其 Grok 指引弹窗用例失败，单独复现 24/25，须由并行前端和主任务复测。未访问真实服务或密钥。

## 用户反馈修复：复用可执行配置的凭据

### 范围与决策

- Grok 从每个 `[model.<配置名>]` 列出可选来源，优先显示默认项但不强制依赖默认项；解析使用所选项的 URL、协议与有效凭据，不再要求字面 API Key 配套环境变量。
- Grok 新模型按所选来源保留字面 `api_key` 或 `env_key`；导入器识别的 api_key 环境引用归一为 env_key，不展开密钥，也不使用无关 env_key。去重按 URL、协议和有效密钥隔离；配置表键冲突时生成别名，不覆盖旧配置或切换默认模型。
- Codex 显式 `env_key` 优先且缺失时不借用 auth.json 同名字段；支持 `experimental_bearer_token`、显式 OpenAI auth 与未要求认证的自定义服务，保持 Responses 单模型模式。
- Claude 合并宿主环境与 settings.env，以配置覆盖为准；Kimi 读取 provider.env 的协议对应凭据与 URL，显式 api_key_env 缺失时不跨来源降级；OpenCode 支持 baseURL 与 apiKey 一起引用环境变量。
- DSH 与 ZCode 原有字面/环境凭据和供应商隔离已通过代码核对，保留既有安全约束，不增加 Grok 式环境变量等值要求。
- 不改变弹窗布局、主题、草稿并发保护、保存或激活流程；删除已经不成立的 Grok 环境变量修复指引，未知异常继续泛化。

### 本轮验收

- [x] 覆盖 Grok 字面密钥、环境引用、多 URL/密钥、非默认项、别名冲突及重复导入。
- [x] 覆盖其它 CLI 的凭据优先级与来源，不把解析出的环境密钥写回草稿。
- [x] 弹窗真实处理器与宿主逻辑联合回归覆盖 Grok 非默认字面密钥导入。
- [x] 构建、完整配置回归、语法和 ontology 校验通过。
- [x] 功能清单、ontology 与本计划同步并归档。

### 验证证据与边界

- 本机隔离 Codex 验证：使用系统临时 CODEX_HOME、合成凭据及 127.0.0.1 HTTP 接收端，真实执行 `codex exec --skip-git-repo-check --ephemeral --json`；env_key 胜过 auth.json、Bearer 配置及 requires_openai_auth，缺失显式环境变量时不发请求；无认证配置不带 Authorization。未读取用户配置或使用真实密钥，临时目录已删除。
- 本机 Grok 1.0.62 隔离核验：使用系统临时 GROK_HOME、独立 leader socket、合成凭据及本机 HTTP 接收端，把第二个模型配置通过真实 applyModelImport 导入为新模型，再以 `grok --model new-imported-model --no-subagents --disable-web-search --max-turns 1 --verbatim -p` 读取产物。接收端确认 `/v1/responses` 请求使用第二项的字面密钥（而非不同值的 env_key 或第一项密钥），最终模型为 new-imported-model。接收端故意返回 401 终止，不代表远端模型执行成功。首次仅收到健康检查 GET /，改为响应健康检查后才取得模型请求证据；未接触真实服务或密钥，临时目录已删除。
- 核对本机安装 Kimi Code 的 `declaredProviderCredential`、`resolveModelAuthMaterial` 和 `explainProviderEndpoint`：字面/API 环境声明优先，provider.env 为协议内的回退，不取无关宿主凭据。
- 首次构建通过；定向回归 91/95：两项旧 Codex 夹具错误依赖 auth.json 的同名字段，一项 Google 测试漏掉既有 pageSize 参数，一项 UI 测试未等待真实异步发现结束；均按断言/夹具问题修正，等待重跑。
- 修正后定向 `node --test dist/test/config/modelimport.test.js dist/test/config/modelimportui.test.js dist/test/config/cliPageConfigCoverage.test.js` 为 95/95 通过。最终 `npm run build --silent` 通过，完整 `node --test dist/test/config/*.test.js` 426/426 通过（2 suites），`node --test dist/test/cli/grokConfigModels.test.js dist/test/cli/codexConfigModel.test.js` 6/6 通过。
- `node --check media/config/assets/config-app-ui.js`、`node --check media/config/assets/config-app-api.js`、`git diff --check` 与 ontology `--validate` 均通过；功能清单和 ontology 已同步新规则，计划归档后同步 source_refs 并复核。长期规则已有这两个事实来源，不额外向热区记忆写入重复流水。
- 未使用真实远端服务、浏览器或图形 Extension Development Host；本轮不修改布局，UI 交互由真实弹窗处理器测试覆盖。外部服务仍须提供模型列表接口，执行模型成功不保证服务端实现了列表接口。
