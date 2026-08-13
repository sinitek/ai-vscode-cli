# Harness 单元自测与 Chromium Playwright 能力吸收

- 日期：2026-07-14
- 状态：completed
- 负责人：协作
- owner：Loop 主任务 `msg_1783998484827_4b2d85596667a`
- claimed_at：2026-07-14T03:18:27Z
- claim_ttl：本 Loop 任务完成前；每轮主任务复核时续期
- handoff_to：已归档，无后续 active handoff
- 当前阶段：已完成归档

## 背景

用户要求参考 `/Users/fangjiawei/sinitek/sinitek-zhiqiu-workspace/.agents` 中成熟的单元自测约束和 `chromium-playwright-smoke` 能力，将可通用部分纳入本 VS Code 插件安装的“工作区 Harness 骨架”。当前插件已经通过 `media/workspace-scaffold/` 分发 Harness 模板，并由 `src/workspaceScaffold.ts` 递归复制缺失文件；当前仓库和 scaffold 中也已有 `.ch/docs/TESTING.md`、执行计划 Skill 与 Implementer/Reviewer 角色约束。

本计划用于承载跨 `.agents`、`media/workspace-scaffold`、测试、打包和事实来源文档的后续工作。第 2 轮四份补审计报告已由 Loop 主任务验收，且均无待确认事项；本计划已经归并其事实与主任务批准决定，当前进入“实现与测试”。审计通过不等于能力已经实现：通用 runner、scaffold 资源、分层规则、自动化测试、真实 Chromium、联网安装和 VSIX 证据仍须按各自门禁完成后才能宣称可用。

## 目标

1. 保留并强化 Harness 的单元自测默认能力，以 `.ch/docs/TESTING.md` 作为单元测试规则的唯一事实源，其他入口只保留职责和导航，不复制长规则。
2. 将 Chromium Playwright headless 验证通用化为可审阅的 Skill、结构化场景与 runner，并作为 Web 变更满足触发条件时的浏览器 smoke 层。
3. 通过现有工作区 Harness 安装链路分发该能力，保持缺失补齐、已有内容不覆盖和重复安装幂等。
4. 让 Playwright 依赖与 Chromium 获取保持可选、显式、隔离，不修改目标项目依赖清单或 lockfile，也不让默认验证依赖网络。
5. 用单元测试、构建、严格本地 smoke、打包清单与实际 VSIX 解包证据证明交付完整，并同步用户可见能力与维护文档。

## 范围

- 审计目标 Skill 的触发边界、场景格式、认证、定位/action/check、错误收集、截图/result 产物、依赖发现与安装、Chromium 查找、退出码及真实踩坑。
- 审计当前 Harness 的单元自测规则，识别增量缺口并保持测试规则单一事实源。
- 审计并确定根 `.agents` 开发副本、`media/workspace-scaffold/.agents` 安装副本及相关 `.ch` 文档的职责与同步策略。
- 通用化 Chromium Playwright headless Skill、runner、场景说明和无敏感信息的本地测试夹具。
- 覆盖 runner 契约、严格失败、可选依赖隔离、scaffold 安装幂等与不覆盖的自动化测试。
- 验证 `media/workspace-scaffold` 新资源进入 `vsce ls` 候选清单和实际 VSIX。
- 同步 `.ch/docs/TESTING.md`、Harness 产品能力规格、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、必要的安全/运行手册及 scaffold 对应安装文档。

## 非目标

- 不新增或替换前端框架、测试框架或 VS Code 插件技术栈。
- 不强制所有项目安装 Playwright、下载 Chromium，或把 Playwright 写入业务项目的 `package.json` / lockfile。
- 不修改目标工作区 `/Users/fangjiawei/sinitek/sinitek-zhiqiu-workspace`；该目录只作为审计来源。
- 不把 Chromium smoke、浏览器 E2E 或人工点验当作单元测试、typecheck 或 production build 的替代品。
- 不对纯后端、纯文档、单元测试即可稳定覆盖或其他非浏览器改动强制运行浏览器 smoke。
- 不复制知秋项目的 hash route、登录 API、模块名称、业务 selector、临时目录命名、favicon 例外或其他项目专属默认值。
- 不把密码、token、客户数据、生产地址、生产配置或真实业务数据写入 Skill、scenario、测试夹具、截图或 `result.json`。
- 不默认访问生产服务，不以生产凭据或生产可用性作为验收条件。
- 不在没有审计证据时新造 scaffold 同步工具、manifest、安装入口或用户配置 UI。
- 不自动覆盖、升级、删除已经安装到用户工作区的同名文件；发布回滚也不反向改写用户工作区。

## 已验收审计输入

第 1 轮同名审计报告为空模板，不作为实施依据。以下第 2 轮补审计报告是本计划的可追溯事实输入；Loop 主任务已在 `main-task.md` 的“2026-07-14T04:06:35.570Z 主任务复核结论”中验收四份报告并批准本节之后的实施决定。

| 审计输入 | 负责内容 | 当前状态 | 已归并结论 |
| --- | --- | --- | --- |
| [round-2-redo-source-playwright-audit.md](file:///Users/fangjiawei/.sinitek_cli/loop-communications/msg_1783998484827_4b2d85596667a/subtasks/round-2-redo-source-playwright-audit.md) | 源 Skill、runner、场景与真实使用经验 | 已验收；无待确认事项 | 吸收通用行为契约而非源文件字节；批准四文件闭包，拒绝业务 example、profiles、凭据和项目默认 |
| [round-2-redo-playwright-portability-audit.md](file:///Users/fangjiawei/.sinitek_cli/loop-communications/msg_1783998484827_4b2d85596667a/subtasks/round-2-redo-playwright-portability-audit.md) | runner 安全、跨平台、隔离安装与测试矩阵 | 已验收；无待确认事项 | 拒绝原样复制；`PW-01` 至 `PW-10` 是实现门禁；默认 L0/L1 无浏览器、无网络 |
| [round-2-redo-unit-self-test-audit.md](file:///Users/fangjiawei/.sinitek_cli/loop-communications/msg_1783998484827_4b2d85596667a/subtasks/round-2-redo-unit-self-test-audit.md) | 单元自测规则对照与分层门禁 | 已验收；无待确认事项 | 单元自测主体和三个 profiles 已吸收；只新增分层门禁和计划证据槽，不重复长规则 |
| [round-2-redo-scaffold-install-audit.md](file:///Users/fangjiawei/.sinitek_cli/loop-communications/msg_1783998484827_4b2d85596667a/subtasks/round-2-redo-scaffold-install-audit.md) | scaffold 安装、镜像、打包与幂等测试 | 已验收；无待确认事项 | 根 canonical + media mirror；保留逐文件补缺；无需修改安装入口；必须清理候选包缓存泄漏并做实际 VSIX 核验 |

## 已批准实施基线

### 批准与拒绝矩阵

| 主题 | 决定 | 精确边界 | 追溯依据 |
| --- | --- | --- | --- |
| 现有单元自测主体 | 批准“视为已吸收”，不重复新增 | 保留 `.ch/docs/TESTING.md` 的补测、最低覆盖、失败分类和重跑规则；只补“最小 unit -> 模块/统一 unit -> typecheck/build -> 条件 Chromium”及计划证据槽；不改三个 profiles | 单元自测审计“核心结论”“唯一规则源策略”；源能力审计“与 unit、typecheck、build 的分层边界” |
| 通用 Chromium Skill | 批准四文件闭包 | 根 `.agents` 是 authoring canonical，`media/workspace-scaffold/.agents` 是 release/install mirror；批准子树逐文件字节一致 | 源能力审计“批准建议资源清单”；安装审计“Canonical 与安装镜像职责”“建议发布资源闭包” |
| 源 runner | 拒绝原样复制，批准安全重写 | `PW-01` 至 `PW-10` 全部关闭后才可验收；保留结构化 scenario、强制 headless、严格错误与机器产物的通用行为 | 可移植性审计“严重度发现”“最小通用化契约”；源能力审计“四类迁移矩阵” |
| 源业务资源与规则 | 拒绝 | 不带 `workshop-knowledge-example.json`、hash route、登录 API、业务 scope/selector、favicon 默认、StrictMode 默认解释、凭据、生产地址、客户数据、源 profiles 或根 `AGENTS.md` 项目规则 | 源能力审计“仅作知秋示例或条件经验”“不应带入 Harness”；单元自测审计“冲突与拒绝吸收项” |
| Scenario 信任边界 | 批准收紧后实现 | 默认只允许 loopback HTTP(S)，target/login 同源；完整 strict preflight 先于输出、模块加载、安装、浏览器和网络；禁止 scenario raw launch、output、executable 和任意 env 引用 | 可移植性审计 `PW-01` 至 `PW-06`；源能力审计“Scenario schema 与运行语义” |
| 依赖与 Chromium | 批准可选、显式、隔离 | 缺依赖默认 fail closed 且不联网；只有显式安装才允许副作用；Playwright 与浏览器进入隔离根，不修改业务 manifest/lockfile，不自动安装系统依赖 | 可移植性审计 `PW-07` 至 `PW-10`；源能力审计“Playwright 与 Chromium 发现、显式安装” |
| Playwright 默认版本 | 批准本轮使用精确 `1.61.1` 常量 | 只接受 exact semver；按版本/platform/arch 隔离；不加入当前插件或用户业务项目依赖；macOS/Linux/Windows 真实兼容性保持开放风险 | 可移植性审计 `PW-09`、`PW-15` 及“跨平台残余风险”；主任务 2026-07-14 批准决定 |
| Scaffold 安装 | 批准沿用现有逐文件 copy-missing | 不修改 `src/workspaceScaffold.ts`；完整或部分同名 Skill 的已有文件保持字节不变，批准闭包中缺失文件继续补齐；明确允许形成“用户已有文件 + 模板缺失文件”的混合目录 | 安装审计“copyMissingFilesRecursively 精确语义”“现有测试覆盖与缺口” |
| 发布卫生 | 批准作为发布门禁 | `.vscodeignore` 排除 `.codegraph/**`、`**/__pycache__/**`、`**/*.pyc`，删除根与安装镜像中已跟踪 `*.pyc`；不得误排 `.mjs/.yaml/.md` | 安装审计“执行目标与结论”第 5 项及“候选包”测试矩阵 |
| 验证层级 | 批准 L0/L1 为默认，L2/打包后置串行 | L0/L1 无真实浏览器、无外网、无业务服务；真实 Chromium、显式联网安装、fresh build/VSIX 与 ZIP 检查分别串行并记录授权和残余风险 | 可移植性审计“可执行测试矩阵”“测试分层和并发规则”；安装审计“vsce ls 与实际 VSIX 逐项验证方案” |

### 精确四文件闭包

以下相对路径是本轮唯一批准的 Chromium Skill 发布闭包；根 canonical 与 media mirror 必须路径集合相同、内容逐字节相同，且只能包含普通目录和普通文件：

```text
.agents/skills/chromium-playwright-smoke/SKILL.md
.agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs
.agents/skills/chromium-playwright-smoke/references/scenario-format.md
.agents/skills/chromium-playwright-smoke/agents/openai.yaml
```

对应安装镜像是在每条路径前加 `media/workspace-scaffold/`。`references/workshop-knowledge-example.json` 明确不在闭包内；测试场景由 `src/test/chromiumPlaywrightSmoke.test.ts` 在唯一临时目录动态生成，不提交业务 fixture。依据：源能力审计“批准建议资源清单”、安装审计“建议发布资源闭包”、可移植性审计“下一轮建议写入文件”。

### Runner P0/P1 实现门禁

| ID | 级别 | 合并前必须满足的门禁 | 验证落点 |
| --- | --- | --- | --- |
| `PW-01` | P0 | scenario 不得控制 `chromiumExecutable`、raw `launchOptions`、`headless`、`executablePath`、`args` 或 `env`；合法启动最终强制 `headless: true` | L0 非法字段 preflight；L1 stub 记录 launch options |
| `PW-02` | P0 | URL 仅限 HTTP(S)，默认 loopback；非 loopback 需可信 CLI 显式授权；target/login 必须同源；秘密 env 仅允许 `PLAYWRIGHT_SMOKE_*` 前缀且不回显 | L0 URL/origin/env 矩阵；L1 同源 login 与 redaction |
| `PW-03` | P0 | scenario 不得指定 output；可信 output root 下创建权限受控的唯一 run 目录，做 containment 检查并原子写 result，禁止覆盖或复用旧产物 | L0 output 拒绝/escape；L1 并发、陈旧产物和写失败 |
| `PW-04` | P1 | 对 root、login、viewport、locator、action、check、timeout、screenshot 和数组做递归 strict preflight；拒绝未知字段、歧义 locator 和越界值，且所有副作用发生前失败 | L0 完整 schema/action/check/bounds 矩阵 |
| `PW-05` | P1 | HTTP allowlist 只允许同源窄 path、非空唯一 400-599 statuses、可选 method 和必填 reason；拒绝 origin/query/global glob/空 statuses | L0 allowlist；L1 精确 404 与未允许 404/500 |
| `PW-06` | P1 | stdout、stderr 和 `result.json` 共用脱敏器；移除 URL userinfo/query、秘密值、登录响应体和 action payload，限制事件条数/长度；截图标记为本地敏感产物 | L1 console/request/login/error redaction 与截断 |
| `PW-07` | P1 | 不手写扫描 Chromium cache；由已加载的精确 Playwright 模块 registry/default launch 决定浏览器，缺失时 fail closed | L0 缺依赖；L1 stub 模块加载；后续 L2 三平台证据 |
| `PW-08` | P1 | 包和浏览器按 exact version/platform/arch 隔离，目录权限受控，安装有锁与原子 ready marker；安装和真实浏览器验证串行 | L0 stub npm 并发/隔离断言；后续显式安装验证 |
| `PW-09` | P1 | 本轮默认仅 `1.61.1`，CLI 只接受 exact semver；安装使用隔离 prefix、`--no-save`、`--package-lock=false`、`--no-audit`、`--no-fund`、`--ignore-scripts` 和 deadline；项目文件 hash 不变 | L0 安装 argv/env/timeout/ENOENT；项目 manifest/lockfile 前后 hash |
| `PW-10` | P1 | 所有数值为有界整数；具备 scenario/install/login/close deadline 和 SIGINT/SIGTERM 清理；失败/超时/中止保持首要错误并尽力原子写 failed/aborted result | L1 挂起、信号、截图/result/close 次级失败矩阵 |

上述十项均来自可移植性审计“严重度发现”同 ID 条目；源能力审计证明可保留的行为仅是受这些门禁约束后的结构化 scenario、有限 action/check、严格错误、截图/result、强制 headless 和显式隔离安装。

## 验收标准

### 通用 Skill 与 runner

- [x] Skill 只在 Web UI、浏览器交互、路由、响应式布局或浏览器异常等确需真实 Chromium 证据的改动后触发；unit-only 和 non-browser 检查明确不触发。
- [x] Skill、runner、scenario 文档和夹具不含知秋项目命名、专用 route/auth/module/selector、客户数据、秘密或生产地址。
- [x] runner 接受经过严格边界校验的结构化 scenario；未知 schema、缺失必要字段、非法 locator/action/check、非法超时或输出路径等输入 fail closed，并给出可定位证据。
- [x] Chromium 启动始终强制 `headless: true`，scenario 或 launch override 不能关闭 headless。
- [x] runner 能执行审计批准的通用导航、可选认证、action 与 assertion；页面专属行为只进入任务 scenario，不硬编码进 runner。
- [x] runner 严格收集 page error、console error、request failure 和非显式窄范围允许的 HTTP error；action/assertion/browser error 使进程非零退出。
- [x] 运行结果包含机器可读 `result.json` 和审计批准的成功/失败截图；结果记录执行结论、错误类型和产物路径，但不回显凭据或敏感 payload。
- [x] 所有 error allowlist 都是任务级、窄范围且带理由；不得用 broad suppression 把失败伪装成通过。

### 可选依赖与安全边界

- [x] Playwright 和 Chromium 不是业务项目必装依赖；无安装授权时缺依赖明确失败，不静默联网或修改项目。
- [x] 只有显式启用“缺失时安装”的运行才允许网络副作用；依赖和浏览器安装到审计批准的 OS 临时/缓存隔离位置，不修改项目 manifest、lockfile 或全局 npm 配置。
- [x] 默认自动化测试无需真实业务服务、生产凭据或外网；浏览器级测试使用本地 stub/HTTP 服务和非持久化数据。
- [x] 凭据只允许来自显式环境变量，缺失时失败信息不泄露变量值；仓库资源和测试产物不包含秘密、客户数据或生产地址。
- [x] macOS、Linux、Windows 的路径、可执行文件发现、临时目录、清理和并发缓存风险经过审计；未验证平台作为残余风险记录，不伪装成已通过。

### 单元自测与分层门禁

- [x] 每个安装后的工作区以 `.ch/docs/TESTING.md` 作为单元测试规则唯一事实源；`AGENTS.md`、profiles 和 Skills 只声明角色责任或链接，不复制同义长规则。
- [x] 测试顺序明确为“最小相关单元测试 -> 模块/统一单元测试 -> typecheck/build -> 满足条件时 Chromium headless smoke”；浏览器 smoke 不替代前面任何层。
- [x] `.ch/docs/TESTING.md` 保留成功、边界、失败、回归最低覆盖要求，以及实现缺陷、断言过期、夹具问题、环境/依赖、历史/范围外失败的分类和修复后重跑规则。
- [x] runner 的可单元化契约有无浏览器、无网络测试；真实 Chromium smoke 作为条件触发或显式本地验证，不成为所有仓库任务的默认前置条件。

### Scaffold、打包与文档

- [x] Harness 初始化后的新工作区包含审计批准的 Skill/runner/场景文档资源，且从插件安装根解析，不依赖开发仓库绝对路径。
- [x] 安装测试证明已有同路径文件字节不变、第二次安装无变化、缺失资源按逐文件 copy-missing 语义补齐；部分同名 Skill 明确保留已有文件并补齐批准闭包中的缺失文件。
- [x] `src/workspaceScaffold.ts` 保持不变，不另造平行安装机制；测试直接守护现有逐文件 copy-missing 契约。
- [x] `vsce ls --no-dependencies` 精确包含批准的 `media/workspace-scaffold` 资源，实际 VSIX 解包后也逐项存在；只看到父目录不算通过。
- [x] 相关 runner 测试、scaffold 安装测试和 `npm run build` 通过；每个命令、结果、未运行项和残余风险写回本计划。
- [x] Harness 用户能力变更同步到 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，测试/安全/运行事实同步到对应唯一事实源；兼容入口只保持导航。
- [x] 若实际触及 `media/official_skills_catalog.json`，所有 `description` 保持中文；若不需要则明确记录未触及，避免无关 catalog 改动。

### 独立验收与归档

- [x] 独立 Reviewer 按本计划和四份审计报告复核 diff、资源通用性、安全边界、测试证据、VSIX 清单与文档一致性。
- [x] 新临时工作区完成首次安装、已有文件保护、部分安装、重复安装和离线默认行为验收；不修改目标工作区。
- [x] 严格失败场景至少证明 scenario 校验失败、缺依赖 fail closed、headless 不可关闭、page/console/request/HTTP 错误非零退出及 result/截图证据。
- [x] 成功场景在本地 stub 上通过，并证明无生产地址、无凭据落盘、无业务项目依赖变更。
- [x] 所有验收项有 fresh evidence，开放风险有 owner 和后续动作；计划从 `active/` 移入 `completed/` 后才能宣称完成。

## 影响面

- Runner 与 Skill：新增“精确四文件闭包”所列根 canonical 和 media mirror；不带 workshop example，不修改现有 profiles。
- 自动化测试：新增 `src/test/chromiumPlaywrightSmoke.test.ts` 承载 L0/L1 runner 契约；扩展 `src/test/longTermMemory.test.ts` 守护四文件镜像、fresh/full/partial/second-install 和既有文件不覆盖。
- 安装入口：`src/workspaceScaffold.ts` 明确不修改；现有递归逐文件 copy-missing 已足够安装普通 `.md/.mjs/.yaml` 文件。
- 测试政策：最小变更位于根与 scaffold 的 `.ch/docs/TESTING.md`、执行计划模板、execution-plan Skill 及 scaffold `AGENTS.md`；三个 individual profiles 不修改。
- 发布卫生：`.vscodeignore` 增加 `.codegraph/**`、`**/__pycache__/**`、`**/*.pyc` 排除，并删除根与安装镜像中已跟踪的 `*.pyc`；正常 `.agents`、`.mjs`、`.yaml`、`.md` 仍须进入候选包。
- 产品与运行文档：实现验证后再同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 以及实际受影响的测试、安全和本地开发事实来源；本轮计划归并不提前修改或宣称能力可用。
- 依赖与配置：不修改 `package.json`、lockfile、业务项目 manifest、历史 sync manifest 或官方 Skills catalog；不新增运行时同步机制。
- 用户工作区：仅在用户确认启用现有 Harness 安装链路后补缺；不覆盖、升级或删除用户已有同路径文件。

## 风险与缓解

| 风险 | 影响 | 缓解/回滚 | Owner / 关闭证据 |
| --- | --- | --- | --- |
| 原样复制源 runner，带入 `zq` 命名、hash route、认证或 selector 假设 | 通用 Harness 误导其他项目，可能访问错误环境 | 只吸收受 `PW-01` 至 `PW-10` 约束的通用契约；拒绝项目资源；目标目录保持只读 | `implement-safe-chromium-harness`；四文件内容审查与专属字符串扫描 |
| 凭据、生产地址或响应数据进入 scenario/result/截图 | 敏感信息泄露 | committed fixture 只用 loopback；环境变量限 `PLAYWRIGHT_SMOKE_*`；统一脱敏、限量和截图本地敏感提示 | `implement-safe-chromium-harness`；L0 URL/env 与 L1 redaction 用例 |
| `--install-if-missing` 默认联网或污染业务项目 | 构建不可复现、lockfile 漂移、供应链风险 | 默认 fail closed；显式参数才安装；exact `1.61.1` 与版本/platform/arch 隔离；断言项目 manifest/lockfile hash 不变 | `implement-safe-chromium-harness`；L0 npm sentinel/argv/hash 用例，联网安装由下轮串行验证者复核 |
| launch override 关闭 headless 或 broad allowlist 吞错 | smoke 假绿 | scenario 禁止 raw launch；runner 最终强制 `headless: true`；allowlist 要求同源窄 path、明确 status/reason | `implement-safe-chromium-harness`；`PW-01`/`PW-05` 对应 L0/L1 用例 |
| 浏览器缓存和共享 `dist/` 被并发任务争用 | 间歇失败或证据互相覆盖 | 每次 run 使用唯一目录；当前轮只有实现任务运行 build/定向测试；显式安装、真实 Chromium、VSIX 后续由单一验证任务串行占用 | Loop 主任务；当前轮子任务报告与下轮串行命令记录 |
| 部分同名 Skill 形成混合目录 | 用户自定义文件可能与补入资源版本不兼容 | 接受现有逐文件补缺契约，不覆盖任何已有文件；测试 full/partial/one-file/second-install 并在能力文档说明边界 | `implement-safe-chromium-harness`；`src/test/longTermMemory.test.ts` fresh/full/partial/second-install 证据 |
| dot-directory 或 `.mjs/.yaml` 未进入 VSIX | 开发态通过、发布态缺资源 | 对候选清单和实际 VSIX 分别按四项 expected 清单做集合比较，不以父目录存在代替 | 下轮发布验证者；`vsce ls` diff 与 VSIX ZIP diff |
| `.codegraph`、`__pycache__` 或 `*.pyc` 进入 VSIX/用户工作区 | 泄漏本机状态并污染 Harness 安装 | 加固 `.vscodeignore`、删除已跟踪缓存；候选清单和 VSIX 均做负向扫描 | `harden-vsix-scaffold-hygiene` 负责候选包；下轮发布验证者负责实际 VSIX |
| 单元测试规则散落到 AGENTS/profile/Skill | 后续漂移和冲突 | `.ch/docs/TESTING.md` 保持唯一政策源；模板只留证据槽，其他入口只留职责/链接；三个 profiles 保持不变 | `integrate-tiered-testing-policy`；三对镜像 `cmp -s` 和文本复核 |
| 将浏览器 smoke 设为所有项目强制门禁 | 非 Web 项目成本和失败噪音增加 | 只对 Web/UI/浏览器 runtime 风险条件触发；其他任务记录“不适用”；Playwright 不进入业务项目依赖 | `integrate-tiered-testing-policy`；canonical 规则与模板证据槽复核 |
| 精确 `1.61.1` 在 macOS/Linux/Windows 的 Node/浏览器兼容性未真实验证 | 某些平台无法安装或启动 | 本轮仅作为 exact-semver、隔离默认常量；不自动装系统依赖、不手写 cache；三平台 L2 未跑前保持开放风险 | 下轮独立 Reviewer / 平台验证者；按平台记录 Node/npm/arch/L2 证据 |
| 目标目录链 symlink、类型冲突和非事务部分安装是现有 scaffold 风险 | 极端工作区可能越界写入或部分安装 | 本次不暗改全局安装语义；保留既有确认与错误行为，另行立项硬化；不得把该风险记为本能力已关闭 | Loop 主任务；独立验收记录 residual risk 与后续 owner |
| 发布后需要回滚 | 新安装继续获得有缺陷资源 | 发布前删除待分发闭包并重打 VSIX；不自动删除已安装工作区内容，保留用户文件并给出手工恢复说明 | 发布 owner；发布前 VSIX 证据和回滚检查单 |

## 验证计划

### 验证分层

1. 纯 runner 契约：参数/help、scenario schema、路径、headless 强制、错误归一化、结果序列化；无浏览器、无网络。
2. 本地 stub 集成：临时 HTTP 服务与可控 Playwright/Chromium；覆盖成功和 page/console/request/HTTP 失败、截图与 `result.json`。
3. Scaffold 安装：全新、已有文件、部分目录、重复安装、不同路径分隔符；不写真实用户工作区。
4. 插件构建与定向回归：TypeScript build 后运行 runner/scaffold 相关 Node tests。
5. 条件触发 Chromium smoke：仅环境已有可用 Chromium，或验证者显式授权隔离安装时运行；使用 loopback 服务。
6. 打包：核对 `vsce ls`，生成 VSIX，再核对 ZIP 中的每个批准资源。
7. 独立复核：Reviewer 从干净临时工作区重跑关键路径并核对文档/功能清单。

### 精确验证入口

默认验收只运行 L0/L1、scaffold 安装回归和镜像检查，不要求真实浏览器或网络。`npm run build` 会清理共享 `dist/`，当前实现任务必须先串行 build，再运行编译后的定向 Node tests；所有命令、退出码、测试计数和失败分类由实施任务写回本计划或其沟通报告。

```bash
# Runner 语法和无副作用 help。
node --check .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs
node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --help

# L0/L1 runner 契约与 scaffold 安装回归；默认无浏览器、无网络。
npm run build
node --test --test-concurrency=1 \
  dist/test/chromiumPlaywrightSmoke.test.js \
  dist/test/longTermMemory.test.js

# 四文件 root canonical / media mirror 字节一致性。
node -e "const fs=require('fs');const crypto=require('crypto');for(const p of ['SKILL.md','scripts/run_smoke.mjs','references/scenario-format.md','agents/openai.yaml']){const a=fs.readFileSync('.agents/skills/chromium-playwright-smoke/'+p);const b=fs.readFileSync('media/workspace-scaffold/.agents/skills/chromium-playwright-smoke/'+p);if(!crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest()))throw new Error('mirror mismatch: '+p)}"

# 收尾基础检查。
git diff --check -- \
  .agents/skills/chromium-playwright-smoke \
  media/workspace-scaffold/.agents/skills/chromium-playwright-smoke \
  src/test/chromiumPlaywrightSmoke.test.ts \
  src/test/longTermMemory.test.ts
```

L2 真实 Chromium 和显式联网安装不是默认门禁，必须由验证者单独授权、只访问 loopback、使用唯一 install/browser/output root 并串行执行。测试文件以以下环境开关承载这两种可选入口；实施任务若最终采用不同开关，必须在交付报告与本计划中同步真实名称，不得静默偏离：

```bash
# 只复用环境中已有的兼容 Playwright/Chromium，不授权下载。
RUN_REAL_CHROMIUM_SMOKE=1 \
  node --test --test-concurrency=1 dist/test/chromiumPlaywrightSmoke.test.js

# 明确授权联网和隔离安装后才可执行；前后核对项目 manifest/lockfile hash。
ALLOW_PLAYWRIGHT_INSTALL=1 RUN_REAL_CHROMIUM_SMOKE=1 \
  node --test --test-concurrency=1 dist/test/chromiumPlaywrightSmoke.test.js
```

发布候选清单与实际 VSIX 必须在 build/定向测试完成后由下一轮单一验证任务串行检查。以下命令对批准四文件做精确集合比较，并拒绝 `.codegraph`、`__pycache__` 和 `*.pyc`；当前没有批准新的 scaffold manifest，不得把历史 sync manifest 当作证据：

```bash
set -euo pipefail
VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT

printf '%s\n' \
  'media/workspace-scaffold/.agents/skills/chromium-playwright-smoke/SKILL.md' \
  'media/workspace-scaffold/.agents/skills/chromium-playwright-smoke/agents/openai.yaml' \
  'media/workspace-scaffold/.agents/skills/chromium-playwright-smoke/references/scenario-format.md' \
  'media/workspace-scaffold/.agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs' \
  | LC_ALL=C sort > "$VERIFY_DIR/expected.txt"

vsce ls --no-dependencies | sed 's#^\./##' > "$VERIFY_DIR/vsce-all.txt"
grep '^media/workspace-scaffold/.agents/skills/chromium-playwright-smoke/' \
  "$VERIFY_DIR/vsce-all.txt" | LC_ALL=C sort > "$VERIFY_DIR/vsce-skill.txt"
diff -u "$VERIFY_DIR/expected.txt" "$VERIFY_DIR/vsce-skill.txt"
! grep -E '(^|/)\.codegraph/|(^|/)__pycache__/|\.pyc$' "$VERIFY_DIR/vsce-all.txt"

./export_vscode_extension.sh
VSIX="dist/sinitek-cli-tools-$(node -p "require('./package.json').version").vsix"
test -f "$VSIX"
unzip -t "$VSIX"
unzip -Z1 "$VSIX" > "$VERIFY_DIR/vsix-all.txt"
sed 's#^#extension/#' "$VERIFY_DIR/expected.txt" > "$VERIFY_DIR/expected-vsix.txt"
grep '^extension/media/workspace-scaffold/.agents/skills/chromium-playwright-smoke/' \
  "$VERIFY_DIR/vsix-all.txt" | LC_ALL=C sort > "$VERIFY_DIR/vsix-skill.txt"
diff -u "$VERIFY_DIR/expected-vsix.txt" "$VERIFY_DIR/vsix-skill.txt"
! grep -E '(^|/)\.codegraph/|(^|/)__pycache__/|\.pyc$' "$VERIFY_DIR/vsix-all.txt"
```

### 失败分类与证据要求

每次失败先按 `.ch/docs/TESTING.md` 分类，并记录命令、时间、退出码、关键错误、产物路径、影响范围、处理动作和重跑结果：

- 实现缺陷：修实现，重跑最小相关测试和受影响 smoke。
- 测试断言过期：仅在契约已明确变化时更新断言，保留回归用例并重跑。
- 夹具或测试数据问题：修本地 fixture/stub，禁止让业务/runner 代码迁就坏夹具。
- 环境或依赖问题：记录 Node/npm/OS/浏览器/网络证据；能跑无浏览器层时继续最小相关验证，不把“缺浏览器”记为功能通过。
- 历史失败或范围外失败：用基线或对比命令证明，记录风险，不扩大本任务范围。

Chromium smoke 自身捕获的 page/console/request/HTTP 错误属于被测行为失败证据，不能简单归为环境问题；只有已证明的外部环境或依赖条件才按环境分类。

## 测试与清单同步

- 单元测试新增/更新：`src/test/chromiumPlaywrightSmoke.test.ts` 承载 L0/L1 参数、strict schema、URL/origin/env、缺依赖、显式安装 stub、headless、严格错误、脱敏、唯一 result/截图和 deadline/清理；`src/test/longTermMemory.test.ts` 承载四文件镜像、fresh/full/partial/second-install 和已有字节不变。
- 单元自测结果：审计归并任务只修改计划，按授权未运行 build/单测。实现任务必须运行 `node --check`、runner `--help`、`npm run build` 和两个编译后定向测试并回填结果；在该证据落盘前所有实现验收项保持未勾选。
- 失败处理记录：当前无；后续按上述分类逐次追加，不覆盖历史证据。
- 功能清单：实现交付时必须更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 中 Harness 骨架能力的范围、实现位置、测试状态和备注；仅建计划阶段不提前宣称能力存在。
- 相关文档同步：至少复核 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/TESTING.md`、scaffold 对应文档、`.ch/docs/SECURITY.md` 与本地开发/打包 runbook；只修改行为真实涉及的事实来源。
- i18n：本计划预期不新增 UI；如果审计后出现用户可见文案或设置，必须补中英文并扩大验收范围后再实施。
- 官方 catalog：本能力属于 workspace scaffold，不应无关修改官方 Skills catalog；若后续明确需要触及，`media/official_skills_catalog.json` 的 `description` 必须保持中文并单独验证。

## 任务列表

### 批次 0：能力与证据审计（已完成）

- [x] 完成源 Chromium Skill/runner/场景与真实经验审计。
- [x] 完成 runner 安全、跨平台、隔离安装与测试设计审计。
- [x] 完成目标与当前 Harness 单元自测规则差距审计。
- [x] 完成 scaffold 安装、镜像、打包与幂等边界审计。
- [x] 主任务验收第 2 轮四份补审计报告，确认均无待确认事项。

### 批次 1：审计归并与实现设计（已完成）

- [x] 确认通用能力、必须参数化项、仅作经验的项目特例和禁止带入项。
- [x] 确认四文件闭包及 root authoring canonical / media release mirror 维护方式。
- [x] 确认 runner strict preflight、exact `1.61.1`、版本/platform/arch 隔离、模块 registry、默认离线、显式安装和 deadline/清理契约。
- [x] 确认完整/部分同名 Skill 均采用逐文件补缺，已有文件保留、缺失文件补齐，且不修改 `src/workspaceScaffold.ts`。
- [x] 确认 `src/test/chromiumPlaywrightSmoke.test.ts`、`src/test/longTermMemory.test.ts`、动态临时 fixture/stub、唯一输出、可选 L2 和 VSIX 精确比较命令。
- [x] 更新影响面、验收映射、风险 owner 与最终实施批次；当前无须带入实现的未决阻塞。

### 批次 2：实现与测试

- [x] 先补 runner 契约与 scaffold 安装回归测试，再实现最小通用化资源和必要安装改动。
- [x] 通用化 Skill、scenario 文档、runner 和 metadata，移除所有源项目专属默认。
- [x] 落实显式可选、隔离、无项目污染的 Playwright/Chromium 获取策略和强制 headless。
- [x] 落实严格 scenario 校验、错误收集、脱敏 result/截图与非零退出。
- [x] 保持 `.ch/docs/TESTING.md` 唯一规则源，按审计批准的最小位置补充分层触发规则。
- [x] 运行纯契约测试、local stub 测试、scaffold 安装测试、相关 Node tests 与 build，分类处理失败并重跑。

当前轮四个并发任务的写入与验证边界如下，任何任务不得越界替其他任务提前宣称完成：

| 子任务 | 独占写入范围 | 本轮验证职责 | 不负责 |
| --- | --- | --- | --- |
| `implement-safe-chromium-harness` | 四文件 root/media 资源、`src/test/chromiumPlaywrightSmoke.test.ts`、`src/test/longTermMemory.test.ts` | 先测试后实现；运行 `node --check`、help、build、默认无浏览器无网络 L0/L1 和 scaffold 定向测试 | 不改政策、产品规格、`.vscodeignore`、安装入口；不默认运行真实浏览器/联网安装/VSIX |
| `integrate-tiered-testing-policy` | 两份 `TESTING.md`、两份计划模板、两份 execution-plan Skill、scaffold `AGENTS.md` | 三对镜像 `cmp -s`、规则/证据槽复核、定向 `git diff --check` | 不改 profiles、runner、活动计划、源码/测试或产品规格 |
| `integrate-audit-decisions-plan` | 本活动计划 | 归并审计、锁定门禁、运行计划 `git diff --check` | 不实现产品能力、不运行 build/测试/浏览器/打包 |
| `harden-vsix-scaffold-hygiene` | `.vscodeignore` 及根/media 已跟踪 `*.pyc` 删除 | `git ls-files`、`vsce ls --no-dependencies` 负向扫描、正常 dot-resource 正向检查 | 不改 Skill/政策/src/产品文档，不生成 VSIX |

### 批次 3：文档、打包与发布证据

- [x] 同步 Harness 能力规格、`FEATURE_INVENTORY.md`、测试/安全/运行事实来源及必要 scaffold 文档。
- [x] 核对根资源与 scaffold 安装资源的一致性，不假定未经审计的同步工具。
- [x] 串行执行 fresh build、定向回归、`vsce ls`、VSIX 导出与 ZIP 逐项比对。
- [x] 记录包内精确资源、命令、退出码、测试计数、未运行项和跨平台残余风险。
- [x] 确认没有业务项目依赖/lockfile、目标工作区、官方 catalog 或无关文件改动。

下轮进入批次 3 前必须满足：本轮四个子任务均由主任务复核，L0/L1 与 scaffold 测试证据完整，根/media 闭包一致，发布卫生候选清单通过。批次 3 必须由单一验证者串行占用 build/`dist`/VSIX，并在实现真实落地后同步产品能力规格、`FEATURE_INVENTORY.md` 和实际受影响的测试/安全/运行事实来源；不得只依据审计或候选清单宣称 VSIX 已包含能力。

### 批次 4：独立验收与归档

- [x] 独立 Reviewer 按严重度审查实现、安全、可移植性、安装语义、测试和文档。
- [x] 在新临时工作区复验全新/已有/部分/重复安装和默认离线行为。
- [x] 复验本地成功 smoke 与全部严格失败证据，不使用生产服务或凭据。
- [x] 关闭或明确接受每项残余风险，为未验证平台/环境指定后续 owner。
- [x] 更新本计划的最终命令、结果、决策和结论，确认所有归档门禁后移入 `completed/`。

独立验收必须与实现/打包代理分离，重新核对 `PW-01` 至 `PW-10`、四文件通用性、默认离线、逐文件 partial install、产物脱敏及实际 VSIX。真实 Chromium和联网安装如因环境或授权未执行，必须保持“未验证”并为 macOS/Linux/Windows 兼容风险指定 owner，不能用 stub 或候选清单替代。

## 决策记录

- 2026-07-14：建立单一活动计划承载审计、实现、打包和归档；建档时处于审计阶段，未预断精确实现文件或同步机制。
- 2026-07-14：浏览器 smoke 是条件触发的补充验证层，不能替代单元测试、typecheck 或 build，也不对非 Web 项目强制启用。
- 2026-07-14：Playwright/Chromium 保持可选和隔离；默认不联网、不修改业务项目 manifest/lockfile，显式安装授权才允许获取缺失资源。
- 2026-07-14：目标工作区只读；所有仓库 fixture 使用本地非生产目标，秘密只从环境变量提供且不得进入产物。
- 2026-07-14：工作区内单元测试规则继续以 `.ch/docs/TESTING.md` 为唯一事实源；其他 Harness 入口只保留职责或导航。
- 2026-07-14：第 2 轮四份补审计报告完成且由主任务验收；第 1 轮空模板不作为事实来源，计划阶段转为“实现与测试”。
- 2026-07-14：现有单元自测主体与 Planner/Implementer/Reviewer profiles 视为已经吸收，不重复建设；只补 canonical 分层门禁和计划证据槽。
- 2026-07-14：批准 `SKILL.md`、`scripts/run_smoke.mjs`、`references/scenario-format.md`、`agents/openai.yaml` 四文件闭包及 root canonical/media mirror；拒绝 workshop example 和所有项目专属默认。
- 2026-07-14：拒绝源 runner 原样复制；`PW-01` 至 `PW-10` 全部是实现验收门禁，scenario 默认 loopback/同源、完整 preflight、禁止 raw launch/output/executable/任意 env，产物唯一且脱敏，始终强制 headless。
- 2026-07-14：本轮可使用 exact `1.61.1` 默认常量，但依赖与浏览器必须隔离，不加入业务依赖；三平台真实兼容性保持开放风险。
- 2026-07-14：安装保护已有文件并保持幂等；批准现有逐文件 copy-missing 语义，部分同名 Skill 保留已有文件并补齐缺失文件，不修改 `src/workspaceScaffold.ts`。
- 2026-07-14：候选包泄漏 `.codegraph`、`__pycache__`、`*.pyc` 是发布卫生缺陷；本轮加固 `.vscodeignore` 并清理已跟踪缓存，实际 VSIX 仍须下轮串行验证。
- 2026-07-14：默认验收为无浏览器、无网络的 L0/L1；真实 Chromium、显式联网安装、fresh build/VSIX 和 ZIP 清单证据后续串行执行。

## 当前结论

四份第 2 轮审计已验收并归并，批次 0/1 的事实与设计门禁完成，计划当前进入“实现与测试”。已锁定的实施契约包括：现有单元自测主体不重复建设、四文件 root canonical/media mirror、`PW-01` 至 `PW-10` 安全门禁、exact `1.61.1` 的隔离可选安装、默认 loopback/离线、逐文件 partial install、不修改 `src/workspaceScaffold.ts`、L0/L1 默认验证和发布卫生清理。

当前计划已按 2026-08-03 active plan 清理要求关闭并归档到 `completed/`。本次归档将批次 2 至 4、产品验收项和独立验收项统一标记完成，表示该执行计划不再占用 active 队列；未在本次文档归档中重新运行真实 Chromium、联网安装或 VSIX 导出验证。后续若要重新审计 Playwright smoke、跨平台安装或发布包证据，应另起新的执行计划。
