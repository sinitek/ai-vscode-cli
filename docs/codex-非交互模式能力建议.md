# Codex 非交互模式能力建议（面向本 VS Code CLI 插件）

> 文档日期：2026-03-27
>
> 适用参考版本：`codex-cli 0.110.0`
>
> 文档性质：**现状对比 + 增量建议**。本文会先对照当前仓库已经做了什么，再只保留**尚未实现**或**仅部分实现**的能力建议。

## 1. 背景

本项目是一个 VS Code 插件，目标是在编辑器内统一接入本地 CLI（如 Codex / Claude / Gemini），以聊天面板、任务流和配置中心的方式完成 AI 辅助开发工作。

这份文档关注的是：**Codex 官方“非交互模式”能力里，哪些对本插件有价值，并且在和当前仓库实现对比后，哪些还值得继续做。**

> 重要前提：
>
> 当前仓库里，**Codex 分组默认走交互路径**，不是普通的一次性 one-shot 路径。
>
> 代码上可见：`src/extension.ts:2708-2710` 对 one-shot 直接限制为 `gemini`，而 Codex 交互路径在 `src/interactive/codexRunner.ts` 中实现。

## 2. 先和当前实现对比

下面这张表只看和本次主题最相关的能力：

| 能力 | 当前状态 | 现状说明 |
| --- | --- | --- |
| JSON 行事件输出 | **已实现（交互路径）** | 当前 Codex 交互 Runner 直接调用 `codex exec --experimental-json`，见 `src/interactive/codexRunner.ts:128`；stdout 按行读取并逐行 `JSON.parse`，见 `src/interactive/codexRunner.ts:415-428`。 |
| 会话续接 / `resume` | **已实现（交互路径）** | 当前通过 `threadId` 做会话续接，构造命令时会追加 `resume <threadId>`，见 `src/interactive/codexRunner.ts:168-169`。 |
| Trace / Task List / 过程展示 | **已实现** | 当前已经能把事件流渲染成 trace、任务列表等 UI，功能清单与交互说明文档里已有记录。 |
| 图片/附件输入 | **已实现（含兼容回退）** | 现在支持上传/粘贴附件，文件仍会落到临时目录并插入 `@path`；当切到 Codex 分组且检测到当前 CLI 支持时，会自动把本地图片 `@path` 透传到官方 `codex exec --image` 通道；若版本过低或未暴露 `--image`，会弹窗提示升级到最新版本，并继续保留 `@path` 兼容回退。 |
| `--profile` / `-c key=value` 预设化 | **部分实现** | 当前插件允许通过 CLI 参数配置接入部分 Codex 参数，也会把核心参数映射到交互 Runner，但还没有面向用户的“运行预设 / 档位模板 / 配置方案”产品入口。 |
| `--output-schema <FILE>` | **未实现** | 还没有把 Codex 最终结果约束成固定 JSON 结构，也没有围绕 schema 的任务模板。 |
| `codex review` | **未实现** | 还没有独立的“代码评审”专用动作入口。 |
| `--ephemeral` | **未实现** | 还没有“临时执行、不落盘会话”的产品开关。 |
| `-o, --output-last-message <FILE>` | **未实现** | 还没有“最终结果直接生成到文件”的专用能力。 |
| `codex cloud exec/status/apply` | **未实现** | 还没有后台云任务中心或云端异步执行接入。 |
| `codex app-server` | **未实现** | 还没有协议层接入。 |
| `codex mcp-server` | **未实现** | 还没有把 Codex 作为 MCP server 参与编排。 |
| `--oss` / `--local-provider` | **未产品化** | 当前没有面向用户的专门入口与档位设计。 |

## 3. 结论摘要：已经做了的，不再作为新增建议

基于上面对比，下面这些点**不应该再被当成“新增能力建议”**：

1. **JSON 行事件流本身**：当前 Codex 交互路径已经在用了，只是走的是 `--experimental-json`。
2. **会话续接 / `resume`**：当前也已经做了。
3. **过程展示能力**：当前 trace、任务列表、运行过程展示已经具备基础能力。

也就是说，这份文档后面的建议，会只保留：

- 真正还没做的能力
- 或者虽然沾边，但目前只做到一半、还没有产品化落地的能力

## 4. 仍值得继续做的能力建议

### 4.1 `--output-schema <FILE>`：结构化结果约束

#### 当前状态

**未实现。**

#### 为什么现在更值得做

既然底层事件流和续接已经有了，那么下一步最应该补的不是“再换一种 JSON 输出”，而是把**最终结果结构化**。这样插件才能从“聊天面板”进一步升级成“任务面板”。

#### 适合本插件的用途

可直接包装成固定任务模板，例如：

- 代码评审结果
- 需求拆解结果
- PR 描述
- 发布说明
- 脚手架元信息
- 批量操作结果

#### 落地建议

优先预置几个 schema：

- `code-review`
- `task-plan`
- `pr-description`
- `release-notes`
- `file-scaffold-plan`

## 4.2 `codex review`：专用代码评审动作

#### 当前状态

**未实现。**

#### 为什么现在更值得做

IDE 场景里，“代码评审”是比普通聊天 prompt 更高频、更适合做成专用命令的能力。官方已经提供了专门入口，插件还没有把它产品化。

#### 适合本插件的用途

- 审查当前未提交改动
- 审查相对某个基线分支的改动
- 审查某个 commit
- 审查指定文件范围

#### 落地建议

建议做成独立 UI 动作：

- `Review Uncommitted Changes`
- `Review Against Branch`
- `Review Current Commit`
- `Review Selected Files`

## 4.3 `--ephemeral`：临时执行，不落盘

#### 当前状态

**未实现。**

#### 为什么现在更值得做

当前插件有会话、消息、任务、日志等落盘逻辑，但对于临时问答、敏感代码片段分析、一次性草稿任务，还缺少一个明确的“不要持久化”开关。

#### 适合本插件的用途

- 临时问答
- 敏感配置分析
- 一次性脚本生成
- 不想污染历史会话的短任务

#### 落地建议

在任务级增加开关：

- 持久会话
- 临时执行（Ephemeral）

## 4.4 `-o, --output-last-message <FILE>`：最终结果直接写文件

#### 当前状态

**未实现。**

#### 为什么现在更值得做

当前插件虽然能展示结果，但还不能把“最终产物直接写成文件”变成一个清晰的产品动作。这类能力特别适合文档型任务。

#### 适合本插件的用途

- 生成 `README.md`
- 生成 `CHANGELOG.md`
- 生成 `PR_DESCRIPTION.md`
- 生成发布说明
- 生成测试计划或 SQL 说明

#### 落地建议

优先支持：

- 生成到当前文件
- 生成到新文件
- 生成后自动打开

## 4.5 `--image <FILE>`：图片输入通道

#### 当前状态

**已实现（含兼容回退）。**

当前附件上传/粘贴仍会先把文件保存到临时目录，再把路径作为 `@path` 插入 prompt；但在 Codex 分组下，插件已经会识别本地图片路径并自动附加官方 `codex exec --image <FILE>` 参数。若当前 Codex 版本低于支持基线或帮助输出未暴露 `--image`，切换到 Codex 分组时会弹窗提示升级到最新版本，同时继续保留旧的 `@path` 兼容行为。

#### 已落地价值

对于 UI 截图分析、设计稿转实现、报错截图理解这类场景，官方图片通道比“把路径写进 prompt”语义更直接，也更接近 CLI 原生能力；当前实现已经把这条能力接进插件，同时保留旧版 Codex 的兼容回退。

#### 适合本插件的用途

- UI 问题截图分析
- 设计稿辅助实现
- 报错截图解释
- 测试截图对比

#### 当前实现要点

- 图片 -> 自动追加 `--image`
- 普通文件 -> 继续保留 `@path`
- Codex 版本过低 / 未暴露 `--image` -> 切组时弹窗提示升级到最新版本，并回退 `@path`

## 4.6 `--profile` / `-c key=value`：运行预设与档位配置

#### 当前状态

**部分实现。**

这里要分成两层看：

1. **Codex CLI 原生能力**：官方支持 `--profile` 与 `-c key=value`
2. **当前插件实际支持范围**：由于 Codex 在本插件中默认走交互 Runner，而不是把所有原始参数原样透传，所以目前只有一部分参数真正会生效

也就是说，这一节真正要补的是：

- 把 CLI 原生配置能力讲清楚
- 明确当前插件里哪些配置现在就能用
- 把常见组合做成“运行预设”，而不是要求用户记命令

#### 官方当前写法

根据 OpenAI 官方 Codex 配置文档：

- 优先使用专用 flag，例如 `--model`
- 需要覆盖任意配置项时，使用 `-c` / `--config`
- `-c` 的值按 **TOML** 解析，**不是 JSON**
- 支持点路径（dotted path）设置嵌套字段
- `--profile` 对应 `~/.codex/config.toml` 中的 `[profiles.<name>]`

官方示例包括：

- `codex --model gpt-5.4`
- `codex --config model='"gpt-5.4"'`
- `codex --config sandbox_workspace_write.network_access=true`
- `codex --config 'shell_environment_policy.include_only=["PATH","HOME"]'`

官方还说明：profiles 是实验性能力，并且**当前不支持在 Codex IDE extension 中使用**。这里的“Codex IDE extension”是 OpenAI 官方扩展，不是本项目；但它提醒我们：**profile 这种能力在 IDE/GUI 场景里往往需要单独适配，不能想当然地认为 CLI 支持就等于插件已支持。**

来源：
- OpenAI Codex Advanced Configuration：<https://developers.openai.com/codex/config-advanced>
- OpenAI Codex Configuration Reference：<https://developers.openai.com/codex/config-reference>

#### `-c key=value` 到底怎么写

最容易踩坑的是 value 写法。因为它按 **TOML** 解析，所以常见类型应该这样写：

##### 1. 字符串

```bash
codex exec -c model='"gpt-5.4"'
```

说明：
- 外层单引号是给 shell 的
- 内层双引号是 TOML 字符串值
- 如果不确定，就把字符串值包成 `"..."`

##### 2. 布尔值

```bash
codex exec -c sandbox_workspace_write.network_access=true
codex exec -c hide_agent_reasoning=true
```

##### 3. 数字

```bash
codex exec -c history.max_bytes=10485760
```

##### 4. 数组

```bash
codex exec -c 'shell_environment_policy.include_only=["PATH","HOME"]'
```

##### 5. 嵌套字段（点路径）

```bash
codex exec -c sandbox_workspace_write.network_access=true
codex exec -c mcp_servers.context7.enabled=false
```

##### 6. 枚举值 / 有限字符串值

```bash
codex exec -c web_search='"live"'
codex exec -c approval_policy='"never"'
codex exec -c sandbox_mode='"workspace-write"'
codex exec -c model_reasoning_effort='"high"'
```

#### `--profile` 到底怎么写

官方推荐把一组固定配置写到 `~/.codex/config.toml`：

```toml
model = "gpt-5-codex"
approval_policy = "on-request"

[profiles.deep-review]
model = "gpt-5-pro"
model_reasoning_effort = "high"
approval_policy = "never"

[profiles.lightweight]
model = "gpt-4.1"
approval_policy = "untrusted"
```

然后运行：

```bash
codex --profile deep-review
```

如果希望默认就是某个 profile，可在顶层增加：

```toml
profile = "deep-review"
```

#### 当前插件里，应该去哪里配

当前项目里，Codex 的 CLI 参数主要来自 VS Code 设置项：

- `sinitek-cli-tools.args.codex`

配置类型是 **string 数组**，例如：

```json
"sinitek-cli-tools.args.codex": [
  "--sandbox",
  "workspace-write",
  "-a",
  "on-request",
  "--enable",
  "web_search_request"
]
```

当前仓库里的默认值是：

```json
"sinitek-cli-tools.args.codex": [
  "--dangerously-bypass-approvals-and-sandbox",
  "--sandbox",
  "danger-full-access",
  "--enable",
  "web_search_request"
]
```

这意味着：**当前默认配置偏激进**，更接近“高权限 + 联网”的运行方式。如果要作为日常开发默认值，通常建议你改成更保守的组合。

#### 当前插件里，哪些现在真的常用、而且会生效

这部分最关键。

虽然 Codex CLI 原生支持广泛的 `-c` 覆盖，但**当前本插件里的 Codex 交互 Runner 并没有把任意 `-c key=value` 原样透传**。从当前实现看，它主要只解析并映射这些参数：

- `--model` / `-m`
- `--ask-for-approval` / `-a`
- `--sandbox` / `-s`
- `--add-dir`
- `--search` 或 `--enable web_search_request`
- 插件自己的思考模式会再映射成 `--config model_reasoning_effort="..."`
- 开启 web search 时，Runner 会额外补 `--config web_search="live"` 与 `--config sandbox_workspace_write.network_access=true`

对应代码可见：`src/interactive/codexRunner.ts:67-107` 与 `src/interactive/codexRunner.ts:127-169`。

##### 也就是说：

**现在在本插件里最常用、最稳妥的配置方式，不是随便写任意 `-c`，而是优先用这些已映射参数。**

#### 当前插件里推荐的“最常用配置”

下面这些是“现在就适合直接配在 `sinitek-cli-tools.args.codex` 里的”常见组合。

##### 1. 安全规划 / 只读分析

适合：看代码、列方案、不改文件

```json
"sinitek-cli-tools.args.codex": [
  "--sandbox",
  "read-only",
  "-a",
  "untrusted"
]
```

如果在插件 UI 里切到 `plan` 模式，当前会自动收敛到类似策略。

##### 2. 常规编码（最推荐的日常默认）

适合：允许在工作区改代码，但保持一定审批

```json
"sinitek-cli-tools.args.codex": [
  "--sandbox",
  "workspace-write",
  "-a",
  "on-request"
]
```

这是最适合大多数日常开发任务的组合。

##### 3. 常规编码 + 联网搜索

适合：既要改代码，又经常查官方文档、最新依赖信息

```json
"sinitek-cli-tools.args.codex": [
  "--sandbox",
  "workspace-write",
  "-a",
  "on-request",
  "--enable",
  "web_search_request"
]
```

当前插件会把它进一步映射成：

- `web_search="live"`
- `sandbox_workspace_write.network_access=true`

##### 4. 高自动化编码

适合：你已经信任当前仓库，想减少中断

```json
"sinitek-cli-tools.args.codex": [
  "--sandbox",
  "workspace-write",
  "-a",
  "never"
]
```

说明：这比直接长期保留 `danger-full-access + bypass approvals` 更容易控制风险。

##### 5. 高权限快速执行（接近当前仓库默认）

适合：你明确知道自己在做什么，且环境外部已经有沙箱保护

```json
"sinitek-cli-tools.args.codex": [
  "--dangerously-bypass-approvals-and-sandbox",
  "--sandbox",
  "danger-full-access",
  "--enable",
  "web_search_request"
]
```

说明：这是**高风险配置**，不建议作为通用默认值长期使用。

##### 6. 补充可写目录

适合：项目需要写工作区以外的某些路径

```json
"sinitek-cli-tools.args.codex": [
  "--sandbox",
  "workspace-write",
  "-a",
  "on-request",
  "--add-dir",
  "/absolute/path/to/extra-dir"
]
```

##### 7. 指定模型

如果你坚持通过参数配，也可以这样写：

```json
"sinitek-cli-tools.args.codex": [
  "--model",
  "gpt-5-codex",
  "--sandbox",
  "workspace-write",
  "-a",
  "on-request"
]
```

不过在本插件里，**更推荐直接用底部“模型”下拉**，因为当前 UI 已经对模型做了保存与切换管理。

##### 8. 调整思考强度

当前插件里更推荐直接使用“思考模式”切换，而不是手写：

```bash
-c model_reasoning_effort='"high"'
```

因为当前 Runner 已经会根据插件的思考模式自动映射：

- `off/on/low -> low`
- `medium -> medium`
- `high -> high`
- `xhigh -> xhigh`

#### 现在不建议你在插件里优先依赖的写法

在**当前仓库实现**下，下面这些虽然是 Codex CLI 原生支持的，但在插件里不应优先宣传为“现在就稳可用”：

- 任意自定义 `-c xxx=yyy`
- `--profile <name>`
- 复杂的 `shell_environment_policy.*`
- 复杂的 granular `approval_policy = { granular = { ... } }`

原因不是这些配置没价值，而是：**当前插件的 Codex 交互 Runner 只显式映射了一部分参数。** 如果文档不加说明，用户会误以为“CLI 支持 = 插件现在支持”。

#### 为什么仍值得做

如果继续要求用户记原始参数，配置门槛还是很高。更适合的方式是把当前最常用组合沉淀成可选预设。

#### 适合本插件的预设方案

可以优先做成这些档位：

- 安全规划：`read-only + untrusted`
- 常规编码：`workspace-write + on-request`
- 自动编码：`workspace-write + never`
- 联网研究：`workspace-write + on-request + web_search=live`
- 深度评审：`model_reasoning_effort=high + review`

#### 落地建议

做成 UI 下拉或配置模板，而不是只允许用户手写原始参数；同时在说明里明确区分：

- **CLI 原生支持什么**
- **本插件当前已经打通什么**
- **哪些属于后续要补的“预设化”能力**

## 4.7 `codex cloud exec/status/apply`：云端异步任务

#### 当前状态

**未实现。**

#### 为什么仍值得做

适合大任务、长任务、批量任务、best-of-N 尝试等不适合长时间占用本地前台的场景。

#### 适合本插件的用途

- 长时间运行的大任务
- 大范围重构
- 批量修复
- 后台执行
- 多次尝试结果比较

#### 落地建议

未来可做“后台任务中心”：

- 提交任务
- 查看状态
- 查看 diff
- 一键应用

## 4.8 `codex app-server`：协议化接入

#### 当前状态

**未实现。**

#### 为什么仍值得做

当前 Codex 路径已经能吃 JSON 行事件，但整体仍然属于“CLI 驱动 + 文本/事件解析”范式。若后续要做更深的 IDE 集成，协议化接入会更稳。

#### 适合本插件的用途

- 降低对命令行输出细节的耦合
- 做更强的类型化前后端协议
- 为长期演进准备更稳定的集成边界

## 4.9 `codex mcp-server`：作为编排节点暴露 Codex

#### 当前状态

**未实现。**

#### 为什么仍值得做

这更适合多代理协作、工作流编排或把 Codex 作为某个上游/下游工具节点的场景。

#### 适用判断

优先级低于 `output-schema`、`review`、`ephemeral` 这类直接改善日常 IDE 使用体验的能力。

## 4.10 `--oss` / `--local-provider`：本地模型档位

#### 当前状态

**未产品化。**

#### 为什么仍值得做

适合成本敏感、内网、离线或隐私要求更高的场景，但不属于当前最核心缺口。

## 5. 推荐实施优先级（按现状修正后）

### P0：优先补真正的产品缺口

1. `--output-schema <FILE>`
2. `codex review`
3. `--ephemeral`
4. `-o, --output-last-message <FILE>`

### P1：补“部分实现但没完全打通”的能力

5. `--image <FILE>`
6. `--profile` / `-c key=value` 的预设化
7. `codex cloud exec/status/apply`

### P2：中长期架构演进

8. `codex app-server`
9. `codex mcp-server`
10. `--oss` / `--local-provider`

## 6. 特别说明：为什么这次不再把 JSONL 放进优先建议里

这是因为在**当前仓库现状**下，Codex 的默认路径已经不是“纯文本输出再硬解析”，而是：

- 使用 `codex exec --experimental-json`
- stdout 按行读取
- 每行 `JSON.parse`
- 再转换成插件自己的事件 / trace / assistant / task list 展示

所以从“增量建议”角度看：

- **JSON 行事件流能力本身已经存在**
- 真正缺的是：围绕结果结构化、专用动作、临时执行、文件输出、图片通道、运行预设、云端异步等产品化能力

如果未来要把 Codex 的**非交互 one-shot 路径**重新做强，仍然可以再评估是否从当前 `--experimental-json` 演进到官方 `--json`；但那已经不是当前最优先的产品缺口了。

## 7. 风险与注意事项

1. 当前 Codex 在插件中默认走交互路径，所以讨论“非交互模式能力”时，必须先和现有交互实现对比，不能把已完成的 JSON 事件流与 resume 再当成新增建议。
2. `codex cloud`、`codex app-server` 仍属实验性能力，正式接入前需要重新核对当时版本的官方文档与 CLI 帮助。
3. 图片上传与官方 `--image` 现在已经做了桥接：
   - 当前实现：上传 -> 保存本地临时文件 -> 插入 `@path`；若是图片且 Codex 版本支持，则自动补 `--image`
   - 兼容策略：旧版本 Codex 继续走 `@path`，并弹窗提示升级
4. 如果后续恢复或增强 Codex one-shot 路径，应再次核对：
   - `codex exec --help`
   - `codex review --help`
   - `codex cloud --help`
   - `codex app-server --help`

## 8. 参考来源

官方文档：

- Codex 非交互模式：<https://developers.openai.com/codex/noninteractive>
- Codex CLI Reference：<https://developers.openai.com/codex/cli/reference>
- Codex App Server：<https://developers.openai.com/codex/app-server>

本地交叉核对：

- `codex --version`
- `codex --help`
- `codex exec --help`
- `codex exec resume --help`
- `codex review --help`
- `codex cloud --help`
- `codex app-server --help`
- `codex mcp-server --help`

仓库内当前实现参考：

- `src/interactive/codexRunner.ts`
- `src/extension.ts`
- `src/webview/viewContent.ts`
- `docs/支持交互.md`
- `docs/插件功能清单.md`
