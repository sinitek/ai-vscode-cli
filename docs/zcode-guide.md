# ZCode

ZCode 在本插件中是独立 CLI，id 为 `zcode`。它使用 ZCode Protocol，不是 ACP。

## 安装

本机已安装的 `zcode` 0.17.0 是官方桌面应用附带命令：`~/.npm-global/bin/zcode` 转到 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`。插件不提供未核实的安装命令。版本检查是 `zcode --version`。

## 协议

交互启动固定为：

```text
zcode app-server --stdio --mode yolo
```

请求是一行一个 JSON 对象，字段为 `id`、`method`、`params`。不要加 `jsonrpc`。免审批模式是 `--mode yolo`。计划模式使用 `plan`。

会话方法：

- `session/create` 新建会话
- `session/resume` 恢复 `sess_` 会话
- `session/send` 发送提示
- `session/stop` 停止当前回合
- `session/close` 释放会话
- `session/setModel` 设置 `providerId/modelId`；推理模型还必须提供 `options.reasoningLevel`
- `session/setThoughtLevel` 只接受当前模型 advertised 的档位
- `session/compact` 是原生压缩，返回 `accepted` 或 `already_running`

流式事件通过 `session/event` 接收。兼容旧版 `part.delta` 的 `text` 与 `reasoning`；ZCode 0.17.0 的流式正文、思考和工具输入使用 `model.streaming`，工具生命周期通过 `tool.updated` 报告。上下文用量读取 `projection.contextUsed` 与 `projection.contextWindow`。

同一对话的连续任务复用健康的 app-server 进程和原生会话；每回合调用 `start()` 只返回现有会话及最新用量，不重复创建或订阅。只有订阅、模式和模型设置全部完成的 runner 才可复用，不能仅凭已拿到会话 ID 判断启动成功。进程重建时用 `session/resume` 恢复原生会话，已释放或退出的 runner 不可重新启动。发送提示前即注册回合监听，确保早于发送确认到达的正文、完成或失败事件不丢失。

工具输入分片按 `toolCallId` 聚合，`scheduled`、`started` 和 `result` 只更新同一条 trace 气泡。Shell 命令输出为 `exec <command>`，其它工具使用 `tool:` / `tool result:` 结构；Webview 复用 Codex 的工具标题、本地化和折叠结果样式，不另建 ZCode 专属气泡。

## 任务回放

当前回合的原生 `session/event` 同时进入聊天投影和现有回放通道：正文、思考、工具事件以及 `turn.completed` / `turn.failed` 都保留原始协议结构与顺序，回放计数随事件增加。回放不依赖调试日志开关；开启调试日志时，同一事件也写入交互事件日志。

仅记录当前会话的活动回合，忽略其他会话、回合结束后或停止后的迟到事件；复用 runner 的连续任务不会复用上一回合的回放回调。不修改已有历史存档，也无法补回旧版本未采集的事件。

## 上下文用量与压缩

ZCode 0.17.0 支持读取真实上下文用量。插件使用会话快照的 `projection.contextUsed` 和 `projection.contextWindow`，不是累计 token 数或本地估算；本机最小对话实测可取得非零用量。新建会话的 `contextUsed = 0` 是初始化占位，没有有效统计时隐藏标签，不显示 `0k` 或等待占位；收到真实正数后展示，悬停可看已用量、窗口容量和 ZCode 数据来源。用量在回合结束、健康会话复用及压缩完成后刷新，按对话标签页隔离。

- 手动压缩：ZCode 分组的“常用指令 → 压缩上下文”调用原生 `session/compact`；CLI 本身也提供 `/compact [instructions]`。运行期间禁用重复触发，运行条显示“压缩中”。
- 执行后自动压缩：在工具设置“AI任务配置”中使用全局“执行后自动压缩上下文”开关，默认开启；与其他已接入 CLI 一样，只有成功且耗时超过 5 分钟的已有会话触发，不是每次短对话都压缩。自动压缩最多等待 3 分钟，超时停止并按未压缩处理。
- 压缩前先启动或恢复当前 `sess_` 会话，保持原会话映射，不新建替代会话。
- `session/compact` 返回的 `accepted` 或 `already_running` **仅表示已接收／正在执行**，不是完成。插件在发请求前订阅终态，等待同会话 `state.updated` 的 `session_compacted` 后才确认成功并刷新用量；`session_compact_failed`、`session_compact_cancelled`、回合失败、进程退出及用户停止均不能报告为成功。

## 对话面板模型选择

普通对话显示当前 ZCode 配置中的模型下拉框；Loop、Graph 和 Loop+ 显示主／子模型下拉框。选项显示原始 `modelId`，包含命名空间的模型 ID 不截断；内部选择与执行仍使用完整 `providerId/modelId`。模型候选来自配置文件，不提供任意添加模型的管理弹窗，也不额外插入“默认”选项。配置未声明模型时，下拉框显示中文配置指引。

增加或修改模型需在配置页编辑 `personalModelIds`，并核对 `defaultModelSelection.modelId`。模型 ID 必须与服务实际提供的 ID 完全一致，不能因为范例有同名模型就认为服务已支持。保存档案和实际应用配置需要同时保持正确，否则切换／重新应用档案会把临时修好的真实配置覆盖回旧值。

保存当前激活的 ZCode 档案时，插件会同时应用到运行时配置，并在模型列表刷新后提示“已更新当前激活的配置”；保存未激活档案不会自动切换当前配置。若提示“已保存，但更新激活配置失败”，档案已保存，但运行时尚未更新，需根据错误修复后重新保存或激活。配置页以扩展宿主识别的激活档案为准，即使旧版保存曾导致档案与运行时分叉，工作区仍记录该档案时也能保留激活身份；没有可确认的激活身份时，请先手动激活目标档案。

## GLM 配置

自定义供应商写入 `~/.zcode/v2/provider_config.json`。范例模型 ID 为 `glm-5.3-flash`：

```text
model: glm-5.3-flash
base URL: http://127.0.0.1:33391/v1
api type: openai-responses
api key: your_apikey
```

最小完整范例如下；只有连接信息、模型和默认思考力度需要按实际情况填写。范例协议为 `openai-responses`，已有配置不会自动改写协议：

```json
{
  "schemaVersion": 1,
  "config": {
    "defaultModelSelection": {
      "providerId": "local-glm",
      "modelId": "glm-5.3-flash",
      "options": { "reasoningLevel": "high" }
    },
    "providerConfigRules": {
      "providerRules": [{
        "providerId": "local-glm",
        "config": {
          "group": "standard-personal",
          "access": { "type": "api-key", "apiKey": "your_apikey" },
          "api": { "type": "openai-responses", "baseUrl": "http://127.0.0.1:33391/v1" },
          "personalModelIds": ["glm-5.3-flash"]
        }
      }]
    },
    "modelConfigRules": {
      "providerModelRules": [],
      "manualProviderModelRules": []
    }
  }
}
```

`your_apikey` 是占位符。真实密钥只放在本机用户配置里，文件权限为 `0600`。该本地服务的 chat completions 可用，anthropic-messages 不被该模型接受。

范例名称不代表本地网关一定配置了同名模型。若服务提示 `Model 'glm-5.3-flash' not configured`，请使用该服务模型列表里的实际 ID；本机此次验证可用的是 `glm-5.3-flash_sub-coco`，保存的默认档案已与实际配置统一，范例仍保留 `glm-5.3-flash`。

思考力度通过 `defaultModelSelection.options.reasoningLevel` 选择，不能用能力列表 `optionSpecs.reasoningLevel.values` 代替。范例默认 `high`；本机两种 GLM 模型实际公布 `low`、`high`、`max`。无需手填上下文窗口、能力档位、显示名称、启用标记或供应商顺序；已有的高级覆写在可视化保存时保留。空模型规则数组和 `group` 是原生配置结构的一部分，不能因精简删除。

配置页默认打开 JSON，切换档案及抽屉导入也保持 JSON；可视化只展示连接信息、默认模型／思考力度和模型 ID，继续复用现有双栏组件。导入范例不会自动保存。应用配置只替换该供应商的模型规则，保留其他供应商。

创建会话先使用配置选定的档位。会话快照返回后，每个回合（含复用与恢复）都重新应用当前模型及档位：用户 UI 选择的合法档位优先于配置默认值。配置 `max`、UI 选择 `high` 时，实际模型选择和 `thoughtLevel` 都必须是 `high`。修改设置后读取原生返回快照确认，不仅更新插件缓存；切换模型后使用新模型公布的档位，不继承上一模型的能力。面板保留合法的 UI 选择，不把 `max` 自动降为 `high`，也不让配置回报覆盖已选择的 `high`。只有模型公布的思考档位才可下发：例如全局继承 `medium`、模型只公布 `low/high/max` 时，保留配置的 `max`，不把 `medium` 发给模型，也不把 `max` 自动降为 `high`。未声明思考能力的其他模型无需填写思考字段，留空时不序列化该参数。

## 报错排查

- `Model request failed.`：原生进程有时只返回概括性错误。检查本机 `~/.zcode/cli/log/` 对应会话的 `model.request.failed`；若为 HTTP 404，优先核对实际模型 ID。示例模型不是服务探测结果；修复时同步保存档案和真实配置，修改前保留备份，不自动把不存在的模型映射到其他模型。
- 看不到模型选择：普通对话应显示单模型下拉，Loop／Graph／Loop+ 应显示主／子模型行。早期版本前端遗漏了 ZCode 的单模型选择能力，需安装修复后的插件并重新加载 VS Code 窗口；仅打开配置页无法更新旧代码。
- `Reasoning level is required`：检查默认选择的 `options.reasoningLevel`，它会随模型选择进入协议；仅声明能力列表不代表已经选择档位。
- `ZCode model resolver is not configured.`：属于插件交互宿主依赖接线缺失，不是服务地址或密钥错误。更新插件代码后需重新加载扩展宿主；只重开配置 Webview 不会加载新的宿主代码。
- 第二次任务报 `ZCode runner is already started.`：属于健康 runner 的重复启动契约缺失，不需要修改模型配置或新建对话。修复后连续任务复用同一进程；更新代码后须重新加载扩展宿主。
- 配置删掉必需数组后，原生进程可能看不到个人模型。插件现会在读取／保存阶段提示缺失结构，不应继续凭空补能力参数。
- 任务有输出但“回放”始终为 0：旧版 ZCode 接入只更新聊天气泡，缺少原生事件到回放的转发。安装修复后的插件并重新加载 VS Code 窗口，再执行新任务验证；调整模型或开启调试日志不能修复旧版本，也不会补回已丢失的历史事件。
- `turn.failed` 会显示原生嵌套错误的实际原因并脱敏，不再仅显示笼统的 `ZCode turn failed.`。
