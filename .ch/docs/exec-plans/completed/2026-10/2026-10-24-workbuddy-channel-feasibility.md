# WorkBuddy 渠道可行性调研

- 日期：2026-10-24
- 状态：completed
- 负责人：Codex
- owner：workbuddy-channel-feasibility
- claimed_at：2026-10-24
- claim_ttl：本轮调研结束
- handoff_to：如厂商开放免配置授权入口，再重新评估

## 背景与目标

用户希望插件增加 WorkBuddy 分组，自动发现本机安装，复用已有登录和所有官方模型，不包含自定义模型。上下文展示、压缩等不能可靠支持的功能应按渠道降级。本轮只验证可行性，可行才在 `docs/` 写设计，不实现插件功能。

## 范围与非目标

- 范围：本机安装包、CLI/本地协议、登录复用、模型枚举、最小对话验证、现有插件接入点与降级设计。
- 非目标：修改 WorkBuddy 安装或账号设置，复制凭据，绕过权限或计费，读取历史对话，实现渠道或改动现有代码。
- 保留工作区已有修改；不修改其他执行计划。

## 验收标准

- 区分已验证事实、设计建议和未验证假设，不将普通 CodeBuddy CLI 能力冒充 WorkBuddy 能力。
- 验证免插件配置的真实前提，包括安装、已有登录、可用账号权益及必要运行时。
- 识别官方模型与自定义模型的过滤依据，说明完整模型覆盖的证据边界。
- 最小对话仅使用临时空目录、固定无敏感内容，并限制时间、工具与费用风险。
- 可行时产出 `docs/` 中文设计，明确能力降级、安全边界、跨平台发现、验收与失败提示；不可行时不写实施设计。

## 影响面

- 代码：仅只读核对 CLI 注册、模型分组、会话与能力控制。
- 文档：本执行计划；可行时新增 `docs/workbuddy-channel-design.md`。
- 配置：不修改用户或应用配置，不记录令牌、客户数据或本机私有运行数据。

## 风险与缓解

- 内置入口可能是私有协议：记录具体版本与兼容门槛，不承诺长期稳定。
- 模型列表不代表账号有权限：分别验证枚举和实际推理，禁止静默替换模型。
- 自动发现不等于免登录：账号登录仍由 WorkBuddy 自己管理。
- 真实调用可能扣费：最小测试限制请求内容及工具，逐模型全量测试不作为本轮默认操作。

## 验证计划

- 使用 memory-recall、ontology 与 CodeGraph 定位既有事实来源。
- 只读检查本机 WorkBuddy 版本、打包入口与协议；使用超时限制的帮助/版本/模型与对话探针。
- 文档校验：`git diff --check`、内部文件引用检查、ontology 校验（如发生本体变更）。
- 无 TypeScript/Node 实现改动，不运行构建或运行时单测；临时探针不加入仓库。

## 测试与清单同步

- 单元测试：本轮仅调研与设计，无实现变化，暂不新增。
- 功能清单：不将设计标记为已实现；无需修改已有功能条目。
- Ontology：不将未来方案写成当前运行事实；收尾判断是否需要更新来源导航。
- 热区记忆：优先把证据和结论放在设计及本计划，不自动追加滚动摘要。

## 验证结果

### 已确认的条件

- 受控记忆召回没有找到既有 WorkBuddy 调研；本任务与工作区已有单测回归修改无关。
- 本机 macOS 安装 WorkBuddy 5.8.3；安装包内 CLI 报告 2.161.0，并包含 WorkBuddy 专用 `codebuddy-lite-wb.mjs`。
- 通过安装包 `Info.plist` 的 `CFBundleExecutable` 定位主程序，设置 `ELECTRON_RUN_AS_NODE=1` 后返回 Node v22.21.1，说明本机不需要为探针另装 Node。
- 普通内置 CLI 的 `--help` 因缺少完整 bundle 报 `MODULE_NOT_FOUND`；设置 `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1` 后帮助可以正常输出。
- 仅设置 lite-wb 不足以证明复用了 WorkBuddy：还需正确的配置目录和产品配置。探针设置了 `CODEBUDDY_CONFIG_DIR`、`WORKBUDDY_CONFIG_DIR` 和 `ACC_PRODUCT_CONFIG_PATH`，指向应用既有目录与产品缓存，没有写入配置。
- 在正确的 WorkBuddy 环境下，`--help` 可枚举官方对话模型，同时会混入自定义项。发行包静态模型表、动态产品配置、主模型可选集合并不相等，不能将整个静态表当作“所有可用官方模型”。
- 打包实现区分 `custom:`、`custom-local:`、`custom` 标签及外部模型。这里只记录识别依据，不保存本机自定义模型名称、地址或配置。

### 最小推理验证

两次探针均在独立临时空目录执行，只发送固定无敏感测试文本；使用 `--tools ''`、`--strict-mcp-config`、空 MCP 配置、`--no-session-persistence`、`--max-turns 1` 和固定系统提示，不提供工作区内容，不开启权限绕过。

| 探针 | 关键差异 | 实际结果 |
| --- | --- | --- |
| 一 | WorkBuddy 专属 bundle、既有产品缓存和配置目录，显式选择官方快速模型 | 返回 `Authentication required. Please use /login command to sign in to your account`；`result.is_error=true`、`subtype=error_during_execution` |
| 二 | 增加 `CODEBUDDY_HOST=workbuddy-desktop`、关闭独立产品缓存，显式选择另一官方模型 `glm-5.3` | 仍返回相同登录要求；`result.is_error=true`、`subtype=error_during_execution` |

- 两次进程退出码均为 0，但业务结果均为失败。因此不能以退出码、帮助正常、能看见模型或磁盘存在认证文件，宣称接入成功。
- 两次结果字段均报告 `total_cost_usd=0`；这只是 CLI 返回值，不替代账号账单核验。
- 另外尝试了 `--acp` 的无推理握手，进程退出但没有返回 `initialize` 响应；没有将 bundle 内存在 ACP 代码视作本机 stdio 协议已验证。

### 登录复用的阻断证据

- 只核对认证文件的存在性、JSON 键名及字段类型，确认已有认证存储使用受保护对象保存令牌；未输出、复制或解密任何令牌。
- 打包 `main/file-authentication-storage.js` 与 CLI 中的 `FileAuthenticationStorage` 使用受保护字段 codec；CLI codec 依赖运行时已初始化的凭据保护状态。
- CLI 启动代码区分 `standalone` 与 `managed-ready`；受管 sidecar 的凭据保护通过宿主 bootstrap socket、就绪令牌及运行时身份进行初始化，而普通独立进程没有这条宿主链路。
- `main/sidecar-manager.js` 为宿主网关生成进程内随机密码，并通过 `Authorization` 头访问；本轮未寻找、导出或绕过此密码，也未复用运行中应用的私有进程环境。
- 上述结构可解释普通 CLI 不能直接读取桌面端登录态的现象，但不应被夸大为“所有版本、所有接入方式都不可能”。

### 官方外部接入的交叉核对

- 2026-10-24 查阅 [WorkBuddy 开放平台 OpenAPI 文档](https://open.workbuddy.cn/docs/openapi)：公开路径需要创建开发者应用、OAuth 授权或账号认证，并获取本地助理所用 CLI token；不是“发现本机安装即可复用桌面端登录”。
- 该文档当前展示的本地助理发送参数为 `text`、`workDir`、`taskId`，并未在此接口公开主模型选择参数。不能据此承诺从插件切换全部官方模型。
- 云端助理属于另一种应用与授权方案，不能冒充本机 WorkBuddy 的免配置渠道。

## 现有插件接入点核对

- CodeGraph 定位到 `src/cli/types.ts`、`src/cli/commandRunner.ts`、`src/cli/commandResolution.ts`；图谱提示陈旧与部分边未完成，关键定义已直接核对当前源码。
- `src/cli/types.ts` 的 `CLI_LIST` 与 `CliName` 是统一提供方入口；模型策略集中在 `src/extensionHost/cliModelSelectionStrategies.ts`。
- 本轮没有修改上述代码，没有新增 WorkBuddy 枚举、分组、配置项、自动登录或能力开关。上下文压缩、上下文展示等降级不是当前阻断点；先要有可靠的登录复用及模型调用链路。

## 决策记录与当前结论

- 2026-10-24：**在用户当前条件下未验证到可靠方案，不编写接入设计，也不实现渠道。** 已确认安装、运行时、帮助及模型枚举，但最小推理没有成功。
- 不为满足“免配置”而引入凭据解密、私有 bootstrap 仿冒、进程令牌抓取、固定网关密码或桌面 UI 自动点击。
- 如果将来厂商提供稳定的桌面登录委托及官方模型枚举/选择接口，或用户明确接受另一种授权方案，再独立立项；本记录不预先替用户放宽要求。
- 按用户“可行才在 `/docs` 写设计，不行就算了”的要求，没有创建 `docs/workbuddy-channel-design.md` 或其他替代设计稿。

## 收尾与验证记录

- 所有临时探针目录均由临时目录上下文清理；子进程有超时及进程组终止保护。
- 仅新增本归档调研记录；没有修改产品源码、`package.json`、用户配置或 WorkBuddy 安装包。CLI 自身可能生成诊断日志或运行缓存。
- 无 Node/TypeScript 代码变更，不运行 `npm run build` 或运行时单测；本任务完成文档空白检查、结构与相对路径核验。
- 功能清单不更新：没有新增、变更或交付用户可见功能；工作区已有的功能清单修改保留。
- Ontology 不更新：没有改变当前概念、关系、权限、状态机、流程或事实来源路径；不能把受阻的未来渠道写成既有能力。
- 热区记忆、事件记忆不更新：单次第三方接入调研的证据保留在本计划，避免污染当前运行时事实。
