# 避坑指南索引

这个文件用于记录仍有行动价值的真实踩坑。starter 默认不预置条目，也不为空内容预建模块分片。

历史复盘（已修复、已废弃、仅历史版本有效）先放在 [PITFALLS_HISTORY.md](./PITFALLS_HISTORY.md)。

## 记录原则

- 只记录真实发生过、已确认会复发或仍需长期防回归的问题。
- 每个条目必须写清楚“现象 → 触发条件/根因 → 长期规避 → 验证方式”。
- 如果问题已经被彻底修复或方案已废弃，不再留在主文件，迁移到历史归档。
- 条目状态尽量使用可执行语义：`有效`、`需部署时检查`、`已规避`、`需观察`。
- 同一主题超过 5 条仍有效条目，或单文件超过约 300 行时，再拆出专题文件并在本页建立索引。

## 当前有效条目

- 本地图片不能直接作为普通 URL 在 Webview 预览：见本页“本地图片由扩展宿主读取，不复用 Webview 私有 URI”。
- 聊天图片按钮继承全局固定高度会裁切图片：见本页“图片预览按钮必须覆盖全局控件高度”。
- 只有 viewBox 的 SVG 在自适应图片按钮内可能缩为零尺寸：见本页“SVG 图片需提供可确定的固有尺寸”。
- VSIX 瘦身与嵌套缓存误打包：见本页“VSIX 排除规则不能覆盖宽泛否定模式”。
- README 图片入包不代表市场可访问：见本页“市场 README 图片必须登记为可寻址资产”。
- Claude 联网工具空结果与域名检查失败：见本页“Claude 工具调用成功包装不代表获得有效数据”。
- Grok 多模型与 Responses `response.metadata` 流兼容限制：见 [grok-model-config.md](grok-model-config.md)。
- AI 对话面板自动置底只看更新前距离底部是否不超过 50px。

## 市场 README 图片必须登记为可寻址资产

- 状态：需部署时检查
- 首次发现：2026-10-29
- 适用范围：README 图片、Python 导出和市场发布脚本
- 现象：本地 README 预览正常，JPEG 也在 VSIX 内，但市场介绍页显示破图。
- 根因：`--no-rewrite-relative-links` 只阻止 vsce 猜测私有仓库 URL；普通随包文件未自动登记为 Gallery 资产，市场页面也不会按安装目录解析相对图片路径。
- 长期规避：在导出流程中将介绍图登记为标准 `Microsoft.VisualStudio.Services.Screenshots.1` 可寻址资产，只修改 VSIX 内 README 为该版本的 Gallery `assetbyname` HTTPS 地址；不改仓库 README，不依赖额外图床。新增本地图必须更新 `README_IMAGE_ASSETS`，遗漏登记或缺图阻止导出。
- 验证方式：运行导出和发布脚本单测，再真实导出检查 README、`extension.vsixmanifest` 与 JPEG 字节；维护者升级版本并发布后，匿名请求新版本图片 URL，确认 HTTP 200、图片类型和实际市场展示。本地 ZIP 验证不等于已部署生效。

## 子模型配置加载不能依赖先访问目标 CLI

- 状态：已规避
- 首次发现：2026-10-29
- 适用范围：七个 CLI 的配置保存同步、Loop／Loop+／Graph 共用子模型入口
- 现象：面板刚打开就切到多模型模式时，目标 CLI 显示正在同步或配置未加载；保存其他 CLI 的激活档案后仍显示旧模型。
- 根因：面板只完整加载当前 CLI，其他分组依赖历史身份；原生模型缓存没有档案 ID 时直接跳过。配置编辑器还重复匹配文本，Grok／KimiCode／DSH 误用 Codex 匹配规则，ZCode 主模型的共享控件注册另有遗漏。
- 长期规避：并行读取所有 CLI 的独立快照后刷新模型缓存；空身份保留 null，不能借用旧心跳。配置页统一使用宿主身份，只对激活档案自动应用。新增主 CLI 复用共享角色能力判定，不再复制容易漏项的名单。跨 CLI 没有有效档案时仍阻止派发，不自动创建档案或启动进程。
- 验证方式：配置桥接与模型宿主测试覆盖所有分组、原生无档案、读取失败和显式空身份；Webview 回归覆盖七个主 CLI × 三种模式 × 七个目标 CLI，并验证模型保存后的快照更新。浏览器使用隔离临时配置与模拟 VS Code 消息桥，不发送模型请求。
- 关联资料：`src/webviewCommandCoordinator.ts`、`src/extensionHost/modelSettings.ts`、`src/webview/viewContentScript/modelManager.ts`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`。

## 本地图片由扩展宿主读取，不复用 Webview 私有 URI

- 状态：已规避
- 首次发现：2026-10-23
- 适用范围：AI 对话本地图片、SVG 预览与下载
- 现象：AI 生成的图片并非 HTTP 可访问，点击无法预览；只测 HTTP 或浏览器模拟桥接会漏掉。
- 根因：源地址校验仅接受 HTTP/data URL；独立预览 Webview 禁止本地资源，且聊天 Webview 专属资源地址不保证在另一个 Webview 可用。
- 长期规避：宿主解析真实本地路径，校验图片字节、格式和 20 MiB 大小限制，再转换为可移植 data URL；不开放任意 localResourceRoots。下载通过宿主读取与系统另存为写入实际图片字节，不依赖浏览器跨源 download 属性；SVG 保留矢量格式。
- 验证方式：资源测试读取真实临时图片，覆盖 file URI、相对路径、Windows/UNC 及伪装文件；provider 测试覆盖预览、另存为、取消与过期 Webview；Chromium 验证图片实际解码、点击及下方下载入口，实际 VS Code 对话框由用户验收。

## 图片预览按钮必须覆盖全局控件高度

- 状态：已规避
- 首次发现：2026-10-23
- 适用范围：AI 对话气泡 Markdown 图片按钮
- 现象：图片已成功加载、宽度也正常，但只显示一条窄色带。
- 根因：全局按钮样式固定高度为 26px，图片按钮的 `overflow: hidden` 把原比例图片裁切；仅验证图片存在和位于视口内不能发现。
- 长期规避：图片按钮显式设置 `height: auto`，图片使用 `max-width: 100%; height: auto`，不修改其他按钮规则。
- 验证方式：`src/test/webview/chatImagePreview.test.ts` 覆盖高度覆盖规则；浏览器同时验证 `naturalWidth > 0` 和按钮实际高度不小于图片高度，检查桌面与窄屏截图。

## SVG 图片需提供可确定的固有尺寸

- 状态：已规避
- 首次发现：2026-10-23
- 适用范围：聊天 SVG 代码围栏及 SVG data URL 图片
- 现象：SVG 图片已解码且 `naturalWidth > 0`，但图片和按钮实际宽高均为 0，无法查看或点击。
- 根因：只有 viewBox、没有 width/height 的 SVG 在按内容收缩且图片设有 `max-width: 100%` 的按钮中缺少可确定的固有尺寸；只检查解码成功无法发现。
- 长期规避：SVG 规范化时，仅在宽高均缺失且 viewBox 为有效正尺寸时按其宽高补齐，不覆盖已有尺寸，继续保留图片自适应规则。
- 验证方式：`src/test/webview/chatImagePreview.test.ts` 覆盖尺寸补齐及原尺寸保留；Chromium 在桌面和窄屏同时断言图片实际宽高大于 0、按钮未裁切、点击及键盘可打开预览，并检查截图。

## VSIX 排除规则不能覆盖宽泛否定模式

- 状态：有效。
- 现象：VSIX 约 40 MB，包含 `.tmp` 截图与页面；执行 scaffold 的 Python 测试后，嵌套 `__pycache__` 也会进入包并被导出审计拒绝。
- 根因：未排除根级 `.tmp`；`__pycache__/**` 只覆盖根级目录；vsce 将否定规则单独处理，宽泛 `!node_modules/@anthropic-ai/**` 会重新放行 SDK 中本应排除的文件。
- 长期规避：保持 `.tmp/**`、`**/__pycache__/**` 与 `**/*.pyc`；不添加 SDK 宽泛否定规则。通用包保留运行时资源，平台包必须显式指定 target，并保留目标 sharp/libvips、rg、ripgrep.node、SDK CLI 和 WASM。
- 验证：`npm run build` 后执行 `node --test dist/test/shared/vsixPackaging.test.js`，再运行导出脚本；脚本会审计包内开发产物与平台资源。细节见 `.ch/docs/runbooks/local-development.md`。

## Claude 工具调用成功包装不代表获得有效数据

- 状态：已规避，外部工具恢复需观察
- 首次发现：2026-10-20
- 适用范围：Claude 分组、普通会话、Loop/Graph 子任务和会话续聊
- 现象：上海天气任务连续 WebSearch 后提示无法查询，宿主仍记录该回合完成；并非权限拒绝。另在多个公开站点实测 WebFetch 均因无法验证域名安全而失败，同 URL 的 Bash/curl 正常。
- 根因：空搜索包装没有可用来源与天气数据；网络工具失败不等于 `allowedTools` 缺失。手工 CLI 使用定制 curl 提示成功，不代表该提示已进入插件实际 Runner。即使 curl 成功，原始 JSON 太大而仅返回预览时，模型仍可能在未读日预报字段的情况下猜测错误的最低最高温；命令退出成功不能作为答案正确的证据。当前接入的工具集合也不包含 Glob/Grep，ToolSearch 无匹配不能推导其他环境均没有该工具。
- 长期规避：联网兼容提示在 `src/cli/claudeToolPolicy.ts` 统一构建并注入每轮 SDK 输入及单次调用；当前环境的 WebSearch/WebFetch 禁用并改用 curl。天气命令解析完整 JSON 后仅输出可核对字段，避免输出被截断；无解析器时读完整输出，不能凭预览猜测。解析脚本自身也执行成功/错误响应回归，不能依赖模型自动修正示例代码。缺失的文件搜索工具用 rg 或平台命令替代，已正常工作的原生工具不禁用；替代不绕过权限或 plan。工具恢复时重新做原生调用验证后再调整策略，不把临时兼容结论当永久能力表。
- 验证方式：真实调用 `ClaudeInteractiveRunner`，输入仅为“今天上海天气”，检查 Bash/curl 工具结果、日期和同源气温，再测续聊与隔离子任务；不要额外手工拼接 curl 提示。其他工具在临时目录实测创建、读回、修改、搜索、任务状态、子代理返回值；判定看工具结果，不只看模型声称成功。构建后执行 Claude Runner、CLI 工具策略、参数构建、任务列表和压缩相关单测。真实验证不等同于已重载的 VS Code 扩展宿主验收。

## AI 对话面板在阅读历史时被新气泡拉到底

- 状态：已规避
- 首次发现：2026-10-18
- 适用范围：Webview 聊天区 `chatArea` 的新气泡、流式增量和平滑重绘
- 现象：用户已经滚到上方查看历史气泡，新气泡或流式内容仍把滚动条置底。
- 根因：自动置底除了 `CHAT_BOTTOM_THRESHOLD_PX`（50）之外，还被 `followLatestMessages` 锁存和运行中的 Loop 主会话强制跟随接管。流式帧在内容变高之后才判断距离，锁存又会在后续帧继续置底。全量重绘清空消息节点时，滚动位置也会丢失。
- 长期规避：在改 DOM 之前读取 `scrollHeight - scrollTop - clientHeight`。只有距离小于等于 50px，且当前没有会话内搜索锚点时，才调用置底。阅读历史时恢复更新前的 `scrollTop`。跟随锁存和任务运行状态都不参与这个判断。聊天区保持 `overflow-anchor: none`，浏览器滚动锚定不会把视口拉到新气泡。
- 验证方式：`npm run build` 后执行 `node --test dist/test/webview/clipagescriptruntimecoverage.test.js`，覆盖距离大于 50、等于 50、等于 51，以及思考流在置底之后再次滚离底部的增量。

## Grok 文档示例与实际 ACP 配置参数不一致

- 状态：有效
- 首次发现：2026-10-17
- 适用范围：Grok Build 1.0.62 / 思考力度与其他 ACP select 配置
- 现象：未声明模型能力时选择思考档位无效果；补齐能力后，嵌套 value 返回 `-32602 Invalid params` / `SessionConfigOptionValue`。
- 根因：自定义模型没有广告 reasoning_effort；Grok 自带 `15-agent-mode.md` 仍展示 `value: { value: "high" }`，但实际协议需要 ACP 规范的字符串 value。
- 长期规避：参数使用 `value: "high"`；用户要求启用思考档后，spawn 前预检实际模型配置，仅补齐当前自定义模型缺失的 reasoning_efforts，保留已有列表、空列表和显式禁用。不要只显示手工配置提示，也不要覆盖用户已配置的能力限制；配置预检失败明确停止，不能继续表现为已使用思考档。最终只根据 session/new 或 session/load 的支持列表下发。
- 验证方式：`npm run build`；`node --test dist/test/config/grokReasoningConfig.test.js dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js`；临时 GROK_HOME 只定义模型但不声明思考档，经真实 GrokInteractiveRunner 启动后检查配置已补齐，session/set_config_option 回读 currentValue 与所选档一致，不发送 session/prompt。
- 事实来源：`.ch/docs/references/cli-runtime-reference.md` 的 Grok Build 节。

## LobeHub Skills 市场列表接口需要登录

- 状态：已规避
- 首次发现：2026-10-17
- 适用范围：配置页 Skills 市场搜索与下载

### 现象
- 请求 `https://market.lobehub.com/api/v1/skills` 返回 401，配置页无法列出技能。

### 根因
- 该列表接口需要 bearer token。公开搜索在 `https://lobehub.com/api/discover/skills`；下载仍使用 `https://market.lobehub.com/api/v1/skills/<identifier>/download`。

### 长期规避
- 搜索只请求 discover 接口，不接受页面传入的任意下载地址。
- 下载地址只能由已校验的 identifier 拼出，重定向最多 3 跳，且只允许对应官方主机。

### 验证方式
- `npm run build`
- `node --test dist/test/config/lobehubSkillMarket.test.js`

### 关联资料
- `src/config/lobehubSkillMarket.ts`

## LobeHub Skills 市场安装会替换同名目录

- 状态：有效
- 首次发现：2026-10-17
- 适用范围：配置页 Skills 市场下载安装

### 现象
- 再次安装同名技能后，目标 CLI 全局目录里的旧技能内容消失。
- 如果把同名路径做成指向外部目录的符号链接，错误地递归删除会连带删除链接目标。

### 根因
- 市场安装按产品要求先删除已有同名目录，再写入新技能。
- `fs.rm` 直接作用于符号链接时，可能跟随链接删除目标；安装前必须先 `lstat`，链接只 `unlink`。

### 长期规避
- 只在 `installCliSkillDirectory` 中替换同名技能。CLI 之间的 `copyCliSkill` 仍然拒绝覆盖。
- 删除已有目标时，符号链接只删除链接本身，不删除链接指向的外部目录或文件。

### 验证方式
- `npm run build`
- `node --test dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliGlobalSkills.test.js`

### 关联资料
- `src/config/cliGlobalSkills.ts`
- `src/test/config/lobehubSkillMarket.test.ts`



## Loop 群聊刷新不能整页重载

- 状态：已规避
- 首次发现：2026-10-13
- 适用范围：Loop 与 Loop+ 群聊面板，补充需求、继续执行、我要提问和澄清表单

### 现象
- 群聊内容一刷新，正在输入的补充需求被清空。

### 根因
- 已打开面板每次 `update()` 都重写 `webview.html`。文档重载会重建弹窗 DOM；即使随后用 `getState()` 恢复，连续刷新或输入法组字仍可能把草稿写成空字符串。

### 长期规避
- 首次打开才写入 HTML。之后用 `loopDebateChat:contentPatch` 只替换顶栏、侧栏、时间线和模型选择。
- 不要在补丁里改补充需求、继续执行或我要提问的输入框。同一 `interactionId` 的澄清表单保持原 DOM。
- 整页重载仍要在写入默认空文案之前恢复已保存草稿。

### 验证方式
- `npm run build`
- `node --test dist/test/loop/loopDebatePanel.test.js dist/test/loop/loopDebateCoordinator.test.js`

### 关联资料
- `src/webview/loopDebatePanel.ts`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`


## Loop+ 主任务中止子任务要关闭该 attempt 的 Tab

- 状态：已规避
- 首次发现：2026-10-09
- 适用范围：Loop+ `controls` 的 `close` / `reprompt`，子任务对话 Tab

### 现象
- 主任务用 JSON 中止正在运行的子任务后，进程停了，但该次 attempt 的子任务 Tab 仍留在对话面板。

### 根因
- 成功结束才会自动关 Tab。主任务中止把 attempt 标成 stopped，原先这条路径不关 Tab。

### 长期规避
- 只有主任务 `close` 或 `reprompt` 中止已启动的 attempt 时，在进程结束后关闭该 attempt 的 Tab。`reprompt` 的新 attempt 另开 Tab。
- 用户手动停止、父任务停止、失败，以及尚未创建 Tab 的排队子任务，都不关闭 Tab。
- 不要把经典 Loop “仅 `end` 才关 Tab”套到这条 Loop+ 中止路径上，也不要反过来让用户停止时关 Tab。

### 验证方式
- `npm run build`
- `node --test dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js`

### 关联资料
- `src/extensionHost/loopPlusRuntimeAdapter.ts`
- `src/extensionHost/loopPlusOrchestration.ts`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`

## 流式助手气泡不要反复切换 Markdown 与临时纯文本

- 状态：已规避
- 首次发现：2026-10-03
- 现象：append 内容时气泡正文突然展开或改变排版，稍后又恢复，跟随底部的页面反复上下跳动。
- 根因：普通气泡每次增量都把 Markdown 替换为整段纯文本，180ms 空闲后恢复；思考与最终回复在运行中暂停 3 秒后也会切换格式，后续增量再次替换。
- 长期规避：普通正文保持 Markdown 并按固定窗口节流；运行中的思考与最终回复复用纯文本节点，runStatus 收尾才统一格式化。不要把持续增量处理成无限延后的防抖，也不要删除实际回复来隐藏排版问题。
- 验证：`npm run build`；`node --test --test-name-pattern='keeps ordinary assistant|keeps running .* bubbles stable|batches assistant delta' dist/test/webview/clipagescriptruntimecoverage.test.js`；Chromium 回放持续追加与超过 3 秒的暂停，断言临时节点数量与气泡高度。

## Webview 内联脚本不能包含字面量 `</script>`

- 状态：已规避
- 首次发现：2026-10-02
- 适用范围：聊天面板 `getWebviewHtml` 内联的 marked、json-formatter 和运行时脚本

### 现象
- 侧栏 Webview 空白，控制台报 `Uncaught SyntaxError: Failed to execute 'write' on 'Document': Invalid or unexpected token`。
- 堆栈落在 VS Code `workbench/contrib/webview/browser/pre/index.html` 的 `contentDocument.write(newDocument)`，不是业务脚本文件名。

### 触发条件
- 聊天面板把第三方库和前端运行时直接内联进 `<script>`。
- 脚本源码里出现字面量 `</script>`，例如 JSON 树宿主 HTML 的结束标签。

### 根因
- HTML 解析器在 script data 状态遇到 `</script>` 会立刻结束当前脚本，后面的源码不再属于这段 JavaScript。
- 被截断的字符串会变成 `Invalid or unexpected token`，并由 `document.write` 同步抛出。

### 长期规避
- 写入 Webview HTML 前用 `neutralizeInlineScriptEndTags` 把 `</script>` 替换成 `<\/script>`。
- JavaScript 仍把 `\/` 解析成 `/`，字符串值保持 `</script>`；HTML 解析器则看不到结束标签。
- 不要只在某一个模板字符串里手写转义，marked、json-formatter、运行时脚本和后续内联库都要走同一出口。

### 验证方式
- `npm run build` 后执行 `node --test dist/test/webview/jsonTreeMessageRender.test.js`。
- 用例会按 HTML 规则切出三段内联脚本，并用 `vm.Script` 确认它们仍能被 `document.write` 解析。


## 我要提问不能清掉主任务 Tab 标记

- 状态：已规避
- 首次发现：2026-09-30
- 适用范围：Loop / Loop+ 群聊「我要提问」与主任务会话 Tab

### 现象
- 使用「我要提问」后，主任务完成时主任务 Tab 的 ☀️ 标记消失，会话被当成普通 Vibe。

### 触发条件
- 提问走主模型所在会话，但写入的用户消息没有 Loop 任务身份。
- 会话身份从最新消息回看时，把这条普通用户消息当成离开 Loop 的边界。
- 主任务运行中的活动记录消失后，Tab 不再能从消息恢复主任务身份。

### 根因
- 「我要提问」是旁路问答，却复用了普通 `runPrompt` 用户气泡。
- 主任务 Tab 标记、历史会话标记和 Webview 运行时标记都把无任务身份的用户消息视为 Vibe。

### 长期规避
- 提问气泡必须带 `loopAsk`，身份解析和 Tab 标记都跳过它。
- 不要把提问补写成 `taskRole: "main"`，否则会变成主任务回合。
- 普通用户消息仍然会去掉主任务标记；只有这条旁路提问不能影响主任务。

### 验证方式
- `node --test dist/test/session/historySessionTaskRole.test.js dist/test/session/loopAskConversationContext.test.js dist/test/session/conversationTabLock.test.js dist/test/loop/loopMainQuestion.test.js`


## Loop+ 完成后会话 Tab 流水动画可能残留

- 状态：已规避
- 首次发现：2026-09-30
- 适用范围：Loop / Loop+ 主任务会话 Tab 的运行中边框动画

### 现象
- 子任务和主任务记录都已经完成，会话 Tab 标题仍保持流水动画。

### 触发条件
- 任务记录已经是 `completed`、`stopped`、`error` 或 `needs-review`，但 Webview 没收到对应的 `runStatus` 结束，或宿主仍短暂把已完成任务算作运行中。

### 根因
- Tab 流水同时看本地 `runningTabStartedAtById` 和主任务 `loopTaskRunning` / `loopTaskStatus`。结束事件丢失后，本地运行标记不会自己过期。

### 长期规避
- 只要还有 Tab 处于流水状态，Webview 每 60 秒请求宿主复核。
- 宿主确认任务已结束且没有新的无关运行后，清掉本地流水标记；没有任何流水后停止这轮检测。
- 不要在任务仍是 `running` / `pending`，或当前 Tab 正在执行不带该任务 ID 的新提示时清掉流水。

### 验证方式
- `node --test dist/test/session/conversationTabRunningFlow.test.js dist/test/session/conversationTabLock.test.js`

## Loop+ 重提示的 attempt id 不能只跟调度序号

- 状态：已规避
- 首次发现：2026-09-29
- 适用范围：Loop+ 主任务 `reprompt`，以及宿主重启后继续给已有子任务开新 attempt

### 现象
- 同一轮派发了两个及以上子任务后，重新加载任务再 `reprompt` 后一个子任务，决策被拒绝，子任务没有新 attempt。

### 触发条件
- attempt id 形如 `lp<序号>-<子任务 id>`。
- 一次 `dispatch` 会连续占用多个序号，但调度快照的 `seq` 每次提交只加 1。
- 宿主重建 runtime 时如果把下一个序号重置成 `snapshot.seq`，就会重新生成已经存在的 `lpN-子任务`。

### 根因
- `snapshot.seq` 记录的是调度提交次数，不是已发出的 attempt 个数。内核会以 `duplicate_attempt` 拒绝重复 id，宿主则把整份控制决策当成协议错误。

### 长期规避
- 新 attempt 序号取 `snapshot.seq` 和已有 `lp<数字>-` attempt id 中的较大值。
- 不要改回只用 `snapshot.seq`。关闭仍走 `closed`，不要把中断后的结束回调送进验收队列。

### 验证方式
- `node --test dist/test/extensionHost/loopPlusOrchestration.test.js`


## 已完成的 Loop+ 不能按经典完成气泡缺失来恢复

- 状态：已规避
- 首次发现：2026-09-25
- 适用范围：Loop+ 主任务完成后，在同一会话再提交新目标

### 现象
- Loop+ 父任务状态已经是 `completed`，用户在当前会话提交新目标后，提示词历史有记录，但没有新的主任务运行，会话里也没有新的用户消息落盘。
- 旧任务的 `supplementalRequirements` 会多出这段新目标，`loopPlus.completed` 仍为 true，`userMessageQueue` 仍为空。

### 触发条件
- 任务是 `schedulingMode: event_driven`，并且调度快照已经完成。
- Loop+ 完成只写“Loop+ 任务已完成”系统消息，不写经典 Loop 的回答结论和最终总结气泡。
- 同一会话的后续普通 prompt 被当成可恢复任务，又因为完成快照被宿主直接结算。

### 根因
- 经典恢复规则把“状态已完成但缺少完成气泡”视为仍可恢复。Loop+ 正常完成恰好满足这个条件。
- 恢复入口会把新目标写入旧任务补充需求，随后 `tryRun` 看到 `completed` 快照只释放控制器，不启动主任务。

### 长期规避
- `event_driven` 且状态为 `completed` 的任务不是同一会话后续 prompt 的恢复候选。
- 该 prompt 必须新建并启动绑定当前 session 的 Loop+ 任务。显式继续已完成快照仍然只结算，不重新打开旧父任务。
- 不要为了让这段恢复逻辑成立，去给 Loop+ 补写经典完成气泡。

### 验证方式
- `node --test dist/test/core/panelDiagnostics.test.js` 中的 “does not resume a completed Loop+ task just because classic completion bubbles are missing”。
- 真实会话：Loop+ 完成后在同一标签提交新目标，应出现新的 Loop+ 任务启动消息，而不是只改旧任务补充需求。

### 关联资料
- `src/panelDiagnostics.ts`
- `src/extensionHost/promptRunRuntime.ts`
- `.ch/docs/design-docs/loop-plus-scheduling.md`

## 对话标签恢复的配置被前端旧选择反写

### 现象
- 扩展侧已经恢复目标标签的配置和模型，但面板仍显示前一标签的配置，随后又发送旧配置的 `applyConfig`。

### 根因
- Webview 的配置一致性保护会保留 `selectedConfigId` 和 pending 配置，防止同一标签的异步配置刷新回退用户选择。
- 点击标签时 Webview 会提前修改 `conversationTabs.activeTabId`；仅比较当前前端 Tab ID 与新面板状态，无法识别一次真正的标签切换。

### 长期规避
- 单独记录最后一次已应用面板状态的 CLI / Tab 上下文。上下文切换时清除上一标签的配置和 OpenCode 模型 pending 选择，接受扩展恢复的配置；同一标签手动切换配置时继续保留原有异步保护。
- `executionModel` 是展示名，不作为可靠的原始模型 ID。执行配置恢复读取任务当前路由或 `executionProfile`。

### 验证方式
- `npm run build`
- `node --test dist/test/session/conversationTabConfiguration.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`
- 使用真实 Webview HTML 的 Chromium smoke，连续切换同 CLI 的 Loop 与 Loop+ 主标签，再切到跨 CLI 子标签，核对配置、模型和思考力度。

## Loop+ 协议提示词不能从会话消息里删掉

- 状态：已规避
- 首次发现：2026-09-25
- 适用范围：Loop+ 主任务复核提示词、子任务执行提示词、对话气泡和历史展示

### 现象
- 对话气泡、历史会话或当前运行提示里出现整段 `You are the Loop+ main reviewer.` 或 `You are one independent Loop+ execution attempt.` 开头的内部协议提示词。

### 触发条件
- Loop+ 把同一段协议全文同时作为 `displayPrompt` 和 `modelPrompt` 发给 CLI。
- 子任务协议全文作为 system 消息写入子任务会话。
- 这些消息已经落盘。

### 根因
- 交互运行时用 `displayPrompt` 生成用户气泡，子任务路径再把协议全文写成系统消息。
- `isInvocationUserAnchor` 用 `message.content === query.displayPrompt` 锚定本轮助手结果，所以不能从存储删除这段全文。

### 长期规避
- 只在展示层隐藏 trim 后以上面两个前缀开头的内容，覆盖对话气泡、历史会话、当前运行提示和提示词历史。
- 不要改调度状态，也不要为了界面干净去删已落盘消息或改锚点匹配。

### 验证方式
- `node --test dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/webview/looppluswebviewintegration.test.js dist/test/webview/runPromptHistoryWebview.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`

### 关联资料
- `src/loopPlusProtocolPrompt.ts`
- `src/webview/viewContentScript/messageRendering.ts`
- `.ch/docs/design-docs/loop-plus-scheduling.md`

## vsce package 不能对 pnpm node_modules 执行 npm list

- 状态：已规避
- 首次发现：2026-09-19
- 适用范围：`scripts/export_vscode_extension.py`、`scripts/publish_vscode_extension.py`、`vsce package`、pnpm 与 npm 混用

### 现象
- `python3 scripts/export_vscode_extension.py` 在 `vscode:prepublish` 之后失败，`dist/sinitek-cli-tools-<version>.vsix` 不会生成。
- 报错为 `ERROR  Command failed: npm list --production --parseable --depth=99999 --loglevel=error`，并伴随大量 `npm error missing` / `ELSPROBLEMS`。
- 另一台从一开始就用 `npm install` 的 Mac 可以正常导出。

### 触发条件
- 本机 `node_modules` 是 pnpm 布局（存在 `node_modules/.pnpm`）。
- `vsce package` 默认通过 `npm list` 探测生产依赖。

### 根因
- pnpm 用符号链接和虚拟 store 组织依赖，顶层没有 npm 那种 hoist 结果，例如 `@dagrejs/graphlib` 不在 `node_modules/@dagrejs/graphlib`。
- npm 把这些链接包当成本地包，把它们的 `devDependencies` 也算进 `npm list`，于是 vsce 直接失败。
- 只加 `--no-dependencies` 不够：Graph 运行时仍要求 VSIX 内包含 `node_modules/@dagrejs/dagre` 和 `node_modules/@dagrejs/graphlib`。

### 长期规避
- 导出脚本检测到 pnpm 布局时，复制源码到临时目录再安装：有 pnpm 则 `pnpm install --node-linker=hoisted`，否则 `npm install`，再调用 `vsce package`。
- `.gitignore` 忽略 `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`，避免把某台机器的包管理器选择提交进仓库。
- `.vscodeignore` 同样忽略这些锁文件，避免进入 VSIX。

### 验证方式
- 在已有 pnpm `node_modules` 的工作区执行 `python3 scripts/export_vscode_extension.py`。
- 确认生成 `dist/sinitek-cli-tools-<version>.vsix`，且 ZIP 中包含 `extension/dist/extension.js` 与 `extension/node_modules/@dagrejs/(dagre|graphlib)/package.json`。

### 关联资料
- `scripts/export_vscode_extension.py`
- `.vscodeignore`
- `scripts/publish_vscode_extension.py`
- `.vscodeignore`
- `.ch/docs/runbooks/local-development.md`

## 不能在 pnpm 的 node_modules 上执行 npm install

- 状态：已规避
- 首次发现：2026-09-19
- 适用范围：`run_dev.py`、本机开发依赖安装、pnpm 与 npm 混用、无法访问 GitHub 的网络

### 现象
- 开发启动脚本卡在 `npm install`，或最终报 `ETIMEDOUT`。
- npm 日志出现 `http fetch GET https://github.com/markedjs/marked/tarball/v14.1.1 attempt N failed with ETIMEDOUT`。
- 另一台同样能访问内网 npm 源的 Mac 可以正常启动。

### 触发条件
- 本机已经用 `pnpm install` 生成了 `node_modules/.pnpm` 或未跟踪的 `pnpm-lock.yaml`。
- 旧版开发启动脚本无条件执行 `npm install`。
- 当前网络访问不到 GitHub。

### 根因
- pnpm 用符号链接组织 `node_modules`。npm 会把这些链接包当成本地包，继续安装它们的 `devDependencies`。
- `marked` 的开发依赖 `@markedjs/testutils@14.1.1-0` 依赖 `marked-repo` GitHub tarball，npm 因此离开内网 registry 去请求 GitHub 并超时。
- 官方开发路径是 `npm install`；另一台机器如果从一开始就用 npm，不会触发这条链路。

### 长期规避
- `run_dev.py` 提供开发、导出与发布共用的 Python 依赖安装策略：已有 pnpm 布局且本机有 pnpm 时用 pnpm，否则用 npm；缺少 pnpm 时删除不兼容的 `node_modules` 再 `npm install`，绝不在 pnpm 树上直接 `npm install`。
- 锁文件不入库，换机器时不会被另一台电脑的 pnpm/npm 选择带偏。

### 验证方式
- 在已有 pnpm `node_modules` 的工作区执行 `python3 run_dev.py`（Windows 用 `python run_dev.py`），确认走 `pnpm install` 且能完成 `npm run build`。
- 确认脚本不再请求 `https://github.com/markedjs/marked/tarball/v14.1.1`。

### 关联资料
- `run_dev.py`
- `.ch/docs/runbooks/local-development.md`


## Grok 会把 [final_answer] 草稿写进 Codex reasoning summary

- 状态：已规避
- 首次发现：2026-09-19
- 适用范围：Codex app-server、Grok 等兼容网关模型、thinking 气泡

### 现象
- 思考气泡突然被截断，并出现 `[final_answer]` 后跟一份不完整的中文结论，例如 `Ah! This is likely the root cause:` 后面直接拼上最终答复草稿。

### 触发条件与根因
- Codex 对 Grok 只转发 reasoning **summary**（`item/reasoning/summaryTextDelta`），完整 CoT 在 encrypted_content 里不可读。
- Grok/kedaya 的 reasoning summary 有时在约 200 字后追加 `...`。这是上游 SSE 自己结束，`summary=auto` 和 `summary=detailed` 都会出现；插件不按模型名或 200 字再裁一次，也无法从 `encrypted_content` 补回。随后模型还可能把 `[final_answer]` 草稿写进同一条 reasoning，而不是 `agent_message`。
- 插件若只消费 `item.completed`，会把这段截断摘要原样显示；若把 reasoning 当普通 assistant delta，还会污染最终答复气泡。

### 长期规避
- 实时消费 `summaryTextDelta` / `textDelta` / `summaryPartAdded`，按 item 拼接 thinking。
- `thread/start` 与 `thread/resume` 对所有模型设置 `model_reasoning_summary=detailed`，不按模型名分支。
- `sanitizeCodexReasoningContent` 截掉 `[final_answer]` 及其后草稿；完成快照不得覆盖更长的已流式思考。
- thinking delta 不计入 final-answer 观察器。

### 验证方式
- `npm run build`
- `node --test dist/test/core/codexReasoningContent.test.js dist/test/interactive/codexAppServerProtocol.test.js dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexRunnerLifecycle.test.js`



## Grok todo 输入补丁与成功计划快照的区别

- 状态：已规避
- 首次确认：2026-10-18，Grok Build 1.0.62 ACP
- 触发：`todo_write` 默认 merge，只传 `{id,status}`；工具通用标题为 `Updating plan`、kind 为 `think`。仅解析标题或把 rawInput.todos 当完整列表，会漏工具身份、丢失正文与其他条目；在开始时应用输入还可能显示失败操作。
- 规避：实时使用标准 `session/update` 的 `plan.entries` 完整快照，成功工具结果优先 `rawOutput.TodosUpdated.todos`，身份优先 `_meta["x.ai/tool"].name`。完整结果缺失时仅按当前回合内已知 ID 合并；失败/取消保留错误，成功派生计划与 native plan 去重，清空后拒绝旧终态回退。
- 排查顺序：在目标会话 `updates.jsonl` 中确认是否有 plan，再按 toolCallId 核对 todo 开始/终态；没有工具调用时检查任务复杂度和 prompt 引导。`plan.json` 用于只读核验，插件运行时不轮询。不能把后台 `list_tasks` 作为 todo 查询接口。
- 验证：隔离真实 Grok + 本地 API 同回合创建两项、ID-only 更新、全完成、非法状态与清空，四次成功各一次完整回调，失败零计划。Grok 会在回合结束时自动完成仍为 in_progress 的任务，应在同回合观察中间状态。
- 事实来源：`.ch/docs/runbooks/grok-model-config.md#任务列表来源与排查`、`src/test/interactive/grokToolCallStream.test.ts`、`src/test/interactive/grokRunner.test.ts`。

## Grok 思考片段不要按行补换行

- 状态：已规避
- 首次发现：2026-10-17
- 适用范围：Grok Build ACP、`agent_thought_chunk`、thinking 气泡

### 现象
- 思考气泡每二十多个字符就换行，例如会话存档里的 `Closeout is permitted.\n The acceptance batch\n is empty, so reviewEventId`。
- 助手正文没有这个问题。

### 根因
- `agent_thought_chunk` 是句子片段，后一段常以空格开头。
- 旧路径把每个思考 trace 都 `appendAssistantChunk(content + "\\n")`。
- 气泡 Markdown 使用 `breaks: true`，单个换行会渲染成 `<br>`。

### 规避
- Grok 思考片段直接拼进 thinking 气泡，不追加换行。
- 展示已保存内容时，`joinGrokThinkingSoftBreaks` 合并软换行，保留空行段落和列表行。
- 此函数通过 `toString()` 注入 Webview，依赖必须留在函数内部；模块级正则常量不会随函数注入，会触发 `LIST_OR_HEADING_LINE is not defined` 并中断整页 `renderMessages`。回归测试需执行序列化函数和生成后的 Webview 运行时，不能只调用模块导出函数。
- 此次作用域修复仅恢复既有展示契约，不新增功能、权限或流程，因此无需修改 `FEATURE_INVENTORY.md` 或 ontology。

### 验证方式
- `npm run build`
- `node --test dist/test/interactive/grokThinkingText.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`
- 本机 Chromium 冒烟：生成完整 Webview HTML，加载多行 Grok thinking、追加助手消息并两次切换“仅看结果”；确认软换行合并、标题与列表保留，且没有浏览器错误或 `webviewError`。


## Grok 要走 yolo，不能把终端能力声明给宿主

- 状态：已规避
- 首次发现：2026-10-16
- 适用范围：Grok Build ACP、`GrokInteractiveRunner`

### 现象
- 插件里让 Grok 查天气或执行命令时，工具结果是 `Method not found: terminal/create`，或 `failed to deserialize response`。
- 直接在终端运行 grok 可以执行同一条 curl。

### 触发条件与根因
- Grok 的 yolo 对应 OpenCode 的 `--auto`：命令行是 `--always-approve`（别名 `--yolo`），会话还要 `_meta.yoloMode: true`。只加命令行参数不够。
- `initialize` 如果声明 `clientCapabilities.terminal: true`，grok 1.0.60 不自己跑命令，而是向客户端发 `terminal/create`。宿主不实现或返回形状不对时，curl 不会执行。

### 长期规避
- `session/new` 和 `session/load` 带 `_meta.yoloMode: true`。
- `terminal`、`fs.readTextFile`、`fs.writeTextFile` 都设为 false，让 yolo 会话使用 grok 自己的终端和文件工具。

### 验证方式
- `npm run build`
- `node --test dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js`
- 本机 `grok --no-auto-update agent --always-approve stdio`，`terminal: false` 且 `yoloMode: true` 时，curl Open-Meteo 能返回上海气温。

## Grok ACP initialize 必须带 clientInfo.version，密钥在 config.toml 的 api_key

- 状态：已规避
- 首次发现：2026-10-16
- 适用范围：Grok Build `grok agent stdio`、`~/.grok/config.toml`

### 现象
- 选择 grok 后任务马上失败，日志是 `Invalid params`，执行时间接近 00:00。
- 配置页能看到模型和接口地址，但看不到密钥写在哪里。

### 触发条件与根因
- grok 1.0.60 的 `initialize.clientInfo.version` 是必填。只有 `name` 时返回 JSON-RPC `-32602`，data 为 missing field `version`。
- 自定义模型的 URL、模型和密钥都在 `[model.<id>]`：`base_url`、`model`、`api_key`。`env_key` 只是环境变量名，不是密钥。
- Codex 的同一模型把 URL 放在 `model_providers.*.base_url`，密钥放在 `~/.codex/auth.json` 的 `OPENAI_API_KEY`，不在 `config.toml`。不知道密钥时 Grok 的 `api_key` 留空，不能从 auth.json 抄。

### 长期规避
- `buildGrokInitializeParams` 始终写入非空 `clientInfo.version`。
- 可视化编辑器在接口地址后提供 API Key，映射 `[model.<id>].api_key`，空字符串也保留。
- 默认模型的 `api_key` 或可用 `env_key` 非空时，不调用 `authenticate`。否则只从当次 `authMethods` 里选。密钥不进入 RPC。

### 验证方式
- `npm run build`
- `node --test dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js dist/test/config/grokConfigMapping.test.js dist/test/config/grokConfigPage.test.js`
- 本机 `grok --no-auto-update agent --always-approve stdio` 的 `initialize` 不再返回 `missing field version`。



## Grok 自定义模型密钥不能走 grok.com 认证

- 状态：已规避
- 首次发现：2026-10-16
- 适用范围：Grok Build `grok agent stdio`、`[model.<id>].api_key`

### 现象
- 终端直接运行 grok 正常，插件选择 grok 后任务失败。
- 日志是 `error sending request for url (https://auth.x.ai/.well-known/openid-configuration)`。

### 触发条件与根因
- 自定义模型的密钥在 `config.toml` 的 `api_key`，不是进程环境变量 `XAI_API_KEY`。
- grok 1.0.60 仍会广告 `grok.com`。插件只看到没有 `XAI_API_KEY` 时会调用 `authenticate`，`methodId` 为 `grok.com`，从而去拉 `auth.x.ai` 的 OpenID 配置。
- 官方 ACP 生命周期是 `initialize` 后直接 `session/new`。模型请求按 per-model `api_key` / `env_key` 取密钥，不需要这次账号认证。

### 长期规避
- 当前默认模型的 `api_key` 非空，或 `env_key` 指向的环境变量非空时，跳过 `authenticate`。
- 没有这份密钥时仍按 `xai.api_key`、`cached_token`、`grok.com` 的原顺序认证。密钥不写入 JSON-RPC。

### 验证方式
- `npm run build`
- `node --test dist/test/interactive/grokRunner.test.js dist/test/interactive/grokAppServerProtocol.test.js dist/test/config/grokConfigMapping.test.js`
- 本机用同一 ACP 命令直接 `session/new` 和 `session/prompt`，`stopReason` 为 `end_turn`，正文来自 `agent_message_chunk.content.text`。



## Grok 回合结束和续聊不能使用 local_ 会话号

- 状态：已规避
- 首次发现：2026-10-16
- 适用范围：Grok Build ACP、`GrokInteractiveRunner`

### 现象
- Grok 已经写出正文，任务仍不结束，或结束后不能在同一会话继续。

### 触发条件与根因
- 普通对话要求显式 `[final_answer]`。Grok 的 `end_turn` 没有像 Claude 的成功结果那样被记为完成。
- `local_` 是插件临时会话号。把它传给 `session/load` 会得到 `Path not found`，冷启动时每次都新建会话。
- grok 1.0.60 的 `session/load` 成功时不回顶层 `sessionId`，id 在 `_meta.sessionId`。只读顶层字段会把成功续接当成请求失败。

### 长期规避
- 有 assistant 正文且 `stopReason` 为 `end_turn`、`end`、`stop` 或空时记为正常完成。`cancelled` 和 `refusal` 除外。
- 只把非 `local_` 的 ACP session id 交给 `session/load`。新建会话后用该 id 接管原 `local_` 会话。进程还在时，后续 prompt 复用同一个 runner。
- `session/load` 的会话 id 依次读取顶层 `sessionId`、`session.sessionId`、`_meta.sessionId`、`_meta["x.ai/sessionDetail"].sessionId`。

### 验证方式
- `npm run build`
- `node --test dist/test/interactive/grokRunner.test.js dist/test/interactive/grokAppServerProtocol.test.js dist/test/extensionHost/grokCliHostWire.test.js`

## Windows 不能把 ~/.codex 当作真实路径

- 状态：已规避，需随 CLI 安装路径 / CODEX_HOME 变化复核
- 首次发现：2026-09-15
- 适用范围：Windows 宿主、`src/shared/userHomePaths.ts`、`src/cli/commandResolution.ts`、`src/config/configPaths.ts`、Codex / Claude / OpenCode 用户级目录

### 现象
- 插件在 Windows 上找不到 CLI、读不到 `%USERPROFILE%\.codex` 配置，或把 `~/.codex/xxxxx` 当成字面量相对路径导致 ENOENT。

### 触发条件与根因
- Node `fs` 和 Windows 都不会展开 `~`。文档习惯写法 `~/.codex` 若直接进入 spawn / 读写，会变成当前工作目录下的 `~` 文件夹。
- 官方 Windows Codex 安装目录是 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`，只搜 npm 全局 bin 会漏检。
- Windows 上 `fs.rename` 覆盖已有文件可能失败，配置原子写会在已有 `config.toml` 时中断。

### 长期规避
- 所有用户级路径先经 `expandHomePath` / `resolveCodexHomeDir` 再进入文件系统。
- Windows 命令解析必须包含官方 Codex bin 与 npm 全局目录。
- 配置原子写使用 `src/shared/atomicWrite.ts`，在 Windows 上先删除再 rename。
- 不要把 `CODEX_HOME=~/.codex` 原样写入 Windows 用户环境变量。

### 验证方式
- `npm run build`
- `node --test dist/test/shared/userHomePaths.test.js dist/test/shared/atomicWrite.test.js dist/test/cli/commandResolution.test.js dist/test/config/configPaths.test.js dist/test/config/officialSkillService.test.js dist/test/extensionHost/promptRuntimeCoreCoverage.test.js`

### 关联资料
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/exec-plans/completed/2026-09/2026-09-15-windows-home-path-compatibility.md`

## Windows `spawn codex ENOENT` 可用工具设置自动修复

- 状态：已规避，需随 Codex 安装目录变化复核
- 首次发现：2026-09-23
- 适用范围：Windows 宿主、`src/cli/cliCommandRepair.ts`、工具设置“自动修复”Tab

### 现象
- 终端里 `codex` 正常，插件任务立刻失败，错误是 `spawn codex ENOENT`，耗时 `00:00`。

### 触发条件与根因
- 扩展宿主继承 VS Code 启动时的 PATH，不读取 PowerShell profile，也不吃 `terminal.integrated.env.windows`。
- macOS 解析失败会退回登录 shell；Windows 解析失败直接抛 `spawn <command> ENOENT`。
- 命令若只存在于注册表里更新后的用户 PATH、`.bun\bin`、fnm 或其他非默认目录，进程环境和固定安装目录都找不到它。

### 长期规避
- 插件初始化会对找不到的 Codex/Claude/OpenCode 裸命令自动执行一次修复，启动该 CLI 的任务会等待这次修复；已写成绝对路径的命令不会被初始化改写。工具设置“自动修复”仍列出没修好的项，一键修复读取 Windows 用户和系统 PATH，跳过 `WindowsApps` 空桩，并把绝对路径写入 `sinitek-cli-tools.commands.<cli>`。
- 只存在于 WSL 或 shell profile 的命令不能自动修复；需要安装 Windows CLI 或手填绝对路径。
- 任务执行遇到同类启动 ENOENT 会再次自动修复，成功后保留旧历史、在原任务 Tab 用新会话重发原请求一次；该次执行关闭普通 hidden retry。命令本身可解析时不能把无效 cwd 的 ENOENT 当成修复成功；找不到命令、写设置失败、第二次失败或用户停止都不继续重试。

### 验证方式
- `npm run build`
- `node --test dist/test/cli/cliCommandRepair.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`

### 关联资料
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`

## Windows Loop 子任务不要对顶层文件做 symlink

- 状态：已规避，需随 Loop 隔离根 / 临时目录清理变化复核
- 首次发现：2026-09-20
- 适用范围：Windows 宿主、`src/loopSubtaskExecutionRoot.ts`、`src/shared/fsCleanup.ts`、`src/cli/opencoderuntimeconfig.ts`

### 现象
- Loop 子任务在 Windows 上启动即失败，错误为 `EPERM` / `A required privilege is not held by the client`。
- 子任务实际已经跑完，但插件仍报错，或 `%TEMP%\sinitek-loop-subtask-*`、`sinitek-opencode-*` 残留。

### 触发条件与根因
- Windows 创建文件符号链接默认需要 Developer Mode 或管理员权限；真实项目根目录几乎都有 `package.json` / `README.md`。
- 目录 junction 不需要该权限；文件 hardlink 在同卷 NTFS 上也不需要。
- `os.tmpdir()` 常在 `C:`，工作区在 `D:` 时 hardlink 会 `EXDEV`。
- Windows 不能删除仍被进程或杀毒软件占用的目录，`rmSync` 默认会把成功任务打成失败。

### 长期规避
- 目录用 junction，顶层文件优先 `fs.linkSync`；跨盘把临时根放到工作区 `.sinitek-loop-tmp`。
- 链接失败再回退文件 symlink，仍失败则返回可读错误。
- Loop 临时根必须先按登记身份撤销链接，再非递归删除空目录；不得调用通用的递归 `removePathBestEffort`。Windows junction 使用非递归 `rmdirSync`，文件硬链接和其他符号链接使用 `unlinkSync`。未知内容或身份变化保留现场并记录 `loop-subtask-execution-root-cleanup-skipped`。OpenCode overlay 仍使用原有 best-effort 清理；占用中的路径不得抛出到任务结果。
- 不假设所有 Node/Electron 版本的递归删除都会把 junction 当成不可遍历链接。清理测试必须在销毁源夹具之前断言真实源目录、文件内容和本轮修改仍存在，并覆盖根替换、链接替换、并发根和启动中途失败。
- 旧版遗留临时根可能仍含指向真实项目的 junction，不要直接递归删除 `.sinitek-loop-tmp`。本次修复不自动迁移或清扫旧残留，也不提供文件恢复功能。

### 验证方式
- `npm run build`
- `node --test dist/test/loop/loopSubtaskExecutionRoot.test.js dist/test/shared/fsCleanup.test.js dist/test/cli/opencoderuntimeconfig.test.js dist/test/cli/commandResolution.test.js`

### 关联资料
- `.ch/docs/exec-plans/completed/2026-09/2026-09-20-windows-loop-cli-compat.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`


## 配置切换下拉显示不能先于宿主提交完成

- 状态：已规避，需随配置提交 / 发送链路变化复核
- 首次发现：2026-08-28
- 适用范围：AI 对话面板配置档案下拉、`src/extension.ts`、`src/sessionMessageHandlers.ts`、`src/sessionMessageActions.ts`、`src/webview/viewContentScript/*`

### 现象
- 用户在 AI 对话里切换配置后，下拉选项已经显示为新配置，但紧接着发送 prompt 时，实际运行偶发仍使用旧配置。
- 如果切换失败，界面还可能短暂保持新选择，直到后续状态刷新才回到真实 active config。

### 触发条件与根因
- Webview 先乐观更新 `selectedConfigId`，而宿主侧 `applyConfig` 是异步提交，`activeConfigIdByCli` 只有在提交成功后才会写回。
- 早期发送路径或队列出队会直接读取 active config / heartbeat 快照，导致“下拉已切过去、实际还没切”的窗口被命中。
- 快速连续切换时，晚到的旧请求如果没有被显式标记为 superseded，可能把新选择覆盖回旧提交结果。
- 配置下拉保留用户刚选的 ID，但 `applyState` 无条件接收其他配置的非空模型快照时，会出现“刚切换正常、后台刷新后模型串配置”；只防御空列表无法阻止这种覆盖。

### 长期规避
- 配置切换必须先进入待生效态，只有宿主完成提交并回写 active config 后，才允许新的 prompt 发送或队列出队。
- 同一 CLI 的配置应用采用 latest-selection-wins；被新选择覆盖的旧请求必须返回 `superseded`，不得提交过期 active config。
- 配置应用失败后要把 Webview 回滚到当前真实 active config，并保留用户输入，不要伪装成已切换成功。
- 成功或失败回包都要按 `cli + configId` 清理对应 pending 状态；不能只在当前 CLI 匹配时清理，否则用户切到其他 CLI 后再回来会被旧 pending 卡住。
- 任何读取 `activeConfigIdByCli` 的发送、队列和模型解析逻辑，都应优先判断是否仍存在 pending 配置应用。
- Webview 合并状态时，模型候选、选中值、主/子模型、OpenCode variants 和思考选项必须统一校验快照的 `activeConfigId` 与 `selectedConfigId`；不匹配时跳过这些字段，其他面板状态仍正常刷新。匹配的空列表、无配置状态和失败回滚不得被过滤。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/config/configApplyQueue.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`。
- 手动复现：快速切到新配置后立刻发送 prompt，确认下拉先显示待生效项、发送被暂缓，提交完成后才真正运行；失败时回滚到旧 active config。

### 关联资料
- `src/config/configApplyQueue.ts`
- `src/extension.ts`
- `src/extensionHost/modelSettings.ts`
- `src/sessionMessageActions.ts`
- `src/sessionMessageHandlers.ts`
- `src/webview/viewContentScript/modelAndPanelState.ts`
- `src/webview/viewContentScript/runStreamAndQueue.ts`
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/webview/viewContentScript/windowMessageDispatch.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## OpenCode 模型选择消息必须绑定配置 ID

- 状态：已规避，需随 OpenCode 模型选择或配置心跳链路变化复核
- 首次发现：2026-08-25
- 适用范围：AI 对话面板 OpenCode 主/子模型选择、Webview 消息、配置心跳与 `src/sessionMessageHandlers.ts`

### 现象
- 用户在 AI 对话面板切换 OpenCode 模型后，选择偶发失败，面板刷新后又显示配置默认模型。

### 触发条件与根因
- Webview 原先只发送模型引用，不携带用户当前选择的配置 ID。
- 扩展端异步处理消息时重新读取 active config；配置切换或心跳刷新竞争会让同一个模型选择被校验/写入另一个配置，随后状态回显为默认模型。

### 长期规避
- OpenCode 主/子模型选择消息必须携带 `state.selectedConfigId`，扩展端优先使用消息中的配置 ID；仅对旧消息回退到 active config。
- Webview 必须按配置 ID、模型角色和有效模型引用暂存未确认选择；同一配置的旧状态快照在尚未回显该引用前不得覆盖本地选择。选择配置默认值时暂存其有效默认引用，而不是已清除的 `null` 覆盖值。
- 仍须使用当前配置的 `validateOpenCodeModelOverride` 校验 exact provider/model 引用，不把模型名写入全局或通用 Codex 选择存储。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/openCodeThinkingWebview.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/extensionHost/opencoderolemodelruntime.test.js`。
- 检查选择消息包含 `configId`，确认宿主显式配置 ID 优先于 active config fallback，并断言旧快照不会把刚选择的 `gpt-5.5` 覆盖为 `gpt-5.6-sol`。

### 关联资料
- `src/webview/viewContentScript/eventBindings.ts`
- `src/sessionMessageHandlers.ts`
- `src/extensionHost/modelSettings.ts`
- `src/test/session/sessionMessageActions.test.ts`
- `src/test/webview/opencodedualmodelwebview.test.ts`

## Codex app-server 残留进程会把 spawn 失败放大成 EAGAIN

- 状态：已规避，需随 Codex app-server 启动/停止策略变化复核
- 首次发现：2026-08-20
- 适用范围：`src/interactive/codexRunner.ts`、Codex app-server、Loop/Graph 子任务、Extension Host 停止与 reload

### 现象
- 插件长时间使用后，Codex 运行开始报 `spawn /Users/fangjiawei/.npm-global/bin/codex EAGAIN`。
- 重启电脑后恢复；只 reload 或重新发起任务不一定释放所有旧资源。
- 本机只读排查能看到多个旧 `codex app-server --listen stdio://` 进程仍挂在 VS Code 相关父进程下，其中包括临时 Loop 子任务工作目录对应的进程。

### 触发条件
- 同一 Codex runner 在边界状态下同时存在多个 app-server child，或停止/扩展停用时只记住最后一个 child。
- Codex CLI 的 Node wrapper 还会派生 vendor binary；仅杀直接子进程时，后代或同 runner 早期 child 可能残留。
- 残留进程、pipe 和文件描述符累计后，系统拒绝继续创建新进程，Node 最终把失败表现为 `EAGAIN`。

### 根因
- 早期 `CodexInteractiveRunner` 只保存单个 `activeChild`，新 run 会覆盖旧 child 引用，停止时无法遍历所有活跃 app-server。
- Codex app-server 以非独立进程组运行，`requestChildShutdown` 主要向直接 child 发信号，不能稳定清理 Node wrapper 及其 vendor 子进程树。
- `spawn` 失败路径若只触发 `error` 而没有及时收口 exit/readline，相关 promise 和句柄也可能继续悬挂。

### 长期规避
- Codex app-server child 必须以集合跟踪，`stopAndRebuild()` / `dispose()` 对所有活跃 child 发起 shutdown。
- macOS/Linux 下 Codex app-server 应使用独立 process group；关闭时先结束 stdin，再升级到 `SIGTERM` / `SIGKILL` 清理进程组。
- `EAGAIN` 要转换为可诊断的资源耗尽错误，并记录 command、pid、active child 数，不能只透传裸 `spawn ... EAGAIN`。
- 本机排查优先只读运行 `ps -axo pid,ppid,pgid,stat,etime,command | rg "codex app-server"`，确认是否有旧工作区或临时目录残留进程；不要默认要求用户重启电脑。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/interactive/codexRunnerLifecycle.test.js dist/test/interactive/codexRunnerSubagent.test.js`。
- 本机只读验证 `codex --version` 与 `ps` 中 Codex app-server 进程列表；如仍有旧版本遗留进程，需区分历史残留和本次修复后的新进程。

### 关联资料
- `src/interactive/codexRunner.ts`
- `src/interactive/codexRunnerProcess.ts`
- `src/test/interactive/codexRunnerLifecycle.test.ts`

## Codex app-server 不能用 readline 拆 NDJSON

- 状态：已规避，需随 app-server stdout 读取实现变化复核
- 首次发现：2026-09-26
- 适用范围：`src/interactive/codexRunner.ts`、`src/interactive/codexAppServerNdjson.ts`、VS Code Extension Host

### 现象
- 提示词里只要带上从网页或文档粘贴来的行分隔符，AI 对话一发起就失败：`解析 Codex app-server 消息失败：Unterminated string in JSON`。
- 普通换行、引号和反斜杠本身可以被 `JSON.stringify` 正确转义；失败位置会落在 U+2028 第一次出现的地方。

### 触发条件
- VS Code 1.138 的 Extension Host 是 Node 24。`readline.createInterface` 会把 U+2028 LINE SEPARATOR 和 U+2029 PARAGRAPH SEPARATOR 当成换行。
- Codex app-server 把用户提示词原样放进 `item/started` 等单行 JSON 后，这些字符仍留在字符串里。readline 先把消息截断，`JSON.parse` 才报未闭合字符串。

### 根因
- `JSON.stringify` 不转义 U+2028/U+2029，而 Node 24 readline 把它们当行边界。NDJSON 的真实边界只有 LF/CRLF。

### 长期规避
- 读取 Codex app-server stdout 只能按 LF/CRLF 拆帧，不能使用 `readline`。
- 写往 stdin 的 JSON-RPC 要把 U+2028/U+2029 转义成 `\u2028` / `\u2029`。
- 多字节字符被拆到两个 chunk 时要用 `StringDecoder`，避免把行分隔符的 UTF-8 截断。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/interactive/codexAppServerNdjson.test.js dist/test/interactive/codexRunnerLifecycle.test.js`。

### 关联资料
- `src/interactive/codexAppServerNdjson.ts`
- `src/interactive/codexRunner.ts`
- `src/test/interactive/codexAppServerNdjson.test.ts`

## LoopMainDecision 解析不能优先采用 prompt 内 fenced JSON 示例

- 状态：已规避，需随 Loop 主任务协议和 prompt 模板变化复核
- 首次发现：2026-08-11
- 适用范围：Loop 主任务 `LoopMainDecision` 解析、`src/extensionHost/promptRunRuntime.ts`、主任务 prompt 中的子任务 JSON 示例

### 现象
- Loop 主任务最后返回看似合法的 `{"status":"continue","subtasks":[...]}` JSON，但运行被置为 `needs-review`。
- UI 中断说明为 `Main task did not return a valid loop decision JSON.`，最新任务记录里 round-2 子任务仍停留在 `pending`，没有被真正派发。

### 触发条件与根因
- 外层 `LoopMainDecision` JSON 的 `subtasks[].prompt` 字符串里包含 fenced `json` 示例，例如业务规则 DSL 示例。
- 早期 `extractJsonObjectText` 优先匹配第一个 ```json fenced block```，没有判断该 fenced block 是否位于 JSON 字符串内部。
- 解析器因此拿到 prompt 内的业务规则示例对象，而不是外层 `LoopMainDecision`，`normalizeLoopMainDecision` 返回 null 后触发 `loop-main-decision-invalid`。

### 长期规避
- Loop 主任务解析应扫描候选 JSON 对象，并用 `normalizeLoopMainDecision` 选择第一个合法决策对象，不能仅凭第一个 fenced block 判定。
- 子任务 prompt 允许包含 JSON 示例、DSL 示例和 markdown code fence；这些内容不应影响外层机器协议解析。
- 真实日志排查时同时看 `loop-main-decision-invalid` 附近的 assistant content 和 `loop-tasks.json` 中 `subTasks` 状态，确认是解析失败还是模型确实没返回协议。

### 验证方式
- 运行 `npm run build`。
- 运行 `node --test dist/test/extensionHost/loopMainDecisionParsing.test.js`。
- 用包含 `subtasks[].prompt` fenced `json` 示例的外层 `LoopMainDecision` 回归样例，确认能解析出 `status=continue` 和完整子任务。

### 关联资料
- `src/extensionHost/promptRunRuntime.ts`
- `src/test/extensionHost/loopMainDecisionParsing.test.ts`

## 终态 Loop 群聊刷新不能重建已关闭主 Tab

- 状态：已规避，需随 Loop 群聊刷新和主 Tab 生命周期变化复核
- 首次发现：2026-09-25
- 适用范围：Loop 群聊面板、`src/extensionHost/promptRunRuntime.ts`、`src/panelDiagnostics.ts`

### 现象
- `needs-review` 主任务已经没有活动子任务，关闭主任务 Tab 后 Tab 仍会自动出现，并可反复发生。
- 同时存在其他 Loop 主任务或子任务时更容易被误认为是那些任务把已结束任务唤醒。

### 触发条件与根因
- Loop 群聊面板可见时每 5 秒发送 `loopDebateChat:refresh`。
- 刷新构建面板状态会解析主任务目标；旧实现在找不到主 Tab 时直接创建新 Tab，并绑定原 session。
- 其他任务的子任务完成只会在该任务自身仍为 `running` 时恢复它自己的主 Tab，不会把 `needs-review` 任务改回运行。

### 长期规避
- `needs-review`、`error`、`stopped`、`completed` 默认只查找现有主 Tab，不创建。
- 只有用户明确继续或恢复原始运行时，才传入 `createIfMissing: true`。
- 群聊面板渲染必须使用 `createIfMissing: false`。

### 验证方式
- 运行 `npm run build`。
- 运行 `node --test dist/test/loop/loopDebateCoordinator.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js`。

### 关联资料
- `src/webview/loopDebatePanel.ts`
- `src/extensionHost/promptRunRuntime.ts`
- `src/panelDiagnostics.ts`

## 人工交互自然语言兜底不能只识别“可选：”候选项

- 状态：已规避，需随 Codex / Claude / OpenCode 澄清回复样式变化复核
- 首次发现：2026-08-08
- 适用范围：Codex / Claude / OpenCode Vibe/coding 人工交互兜底、`src/humanInteraction.ts`、Webview 表单渲染

### 现象
- 用户执行“写一首诗，你来问我一些要求帮你更精准写出我想要的诗”时，Codex 没有发结构化 `requestUserInput`，而是输出普通最终答复里的问题和选项。
- 弹窗出现后，本应展示选项的字段仍是多行 textarea。

### 触发条件与根因
- 真实 Codex 回复常用 `1. 问题` 后紧跟 `A. 选项一 / 选项二`、`B. ...` 的字母选项列表。
- 早期 parser 只识别“可选 / 选项 / 例如 / 如”这类显式提示词，丢掉了紧随问题的 `A.` / `B.` / `C.` 选项行，导致字段没有 `options` 并回退为 textarea。

### 长期规避
- 自然语言人工交互兜底必须覆盖至少两类真实样式：显式提示词候选项，以及紧随问题的字母选项列表。
- Webview 层要保留“有 `options` 且无显式 type 时默认 radio”的归一化，并用前端脚本级 smoke 验证 `createHumanInteractionInput` 实际生成 radio/checkbox 控件。
- 回归用例要使用真实诗歌提示样例，不能只覆盖人工构造的“可选：爱情、自然、人生”。

### 验证方式
- 运行 `npm run build`。
- 运行 `node --test dist/test/core/humanInteraction.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/webview/multiAgentSettingWebview.test.js`。
- 用 `buildNaturalLanguageHumanInteractionRequest` 喂入含 `A.` / `B.` / `C.` 选项的诗歌澄清文本，确认输出字段 `type=radio` 或 `checkbox` 且 `options` 非空。

### 关联资料
- `src/humanInteraction.ts`
- `src/test/core/humanInteraction.test.ts`
- `src/test/extensionHost/promptInteractiveRuntime.test.ts`
- `src/test/webview/multiAgentSettingWebview.test.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## Codex Default mode 的 `request_user_input` 需要显式 feature flag

- 状态：已规避，需随 Codex app-server feature flag 变更复核
- 首次发现：2026-09-13
- 适用范围：Codex Vibe/coding 人工交互、`codex app-server` 启动参数、app-server `initialize` capabilities

### 现象
- 2026-09-13 本地排查中，Codex 任务需要澄清时调用 `request_user_input`，但 UI 中出现“当前环境不支持 request_user_input”。
- 对应 Codex JSONL 日志包含 `function_call request_user_input` 后跟 `request_user_input is unavailable in Default mode`，说明请求没有进入插件侧 app-server 人工交互处理链。

### 触发条件与根因
- Codex Default mode 默认未启用 `default_mode_request_user_input` feature；即使 prompt 写了 Vibe 人工交互要求，CLI 也会先在模型工具层拒绝 `request_user_input`。
- 仅有插件侧 `onRequest` 拦截不够，app-server 初始化也必须声明 experimental request 能力，否则 Codex 不会把该请求作为可处理的 host 交互发给插件。

### 长期规避
- Codex Vibe/coding 且全局 `humanInteractionEnabled=true` 时，`codexRunner` 启动 app-server 必须追加 `--enable default_mode_request_user_input`。
- 同一条件下，app-server `initialize.capabilities.experimentalApi` 必须为 `true`，并继续只在 `promptInteractiveRuntime` 可处理结构化人工交互时开启。
- Loop/Graph 和关闭全局人工交互开关时不启用该 Codex Default mode user-input 能力，避免非 Vibe 编排误弹窗。

### 验证方式
- 运行 `npm run build`。
- 运行 `node --test dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/core/humanInteraction.test.js`。
- 断言 `requestUserInputEnabled=true` 时 app-server argv 包含 `--enable default_mode_request_user_input`，initialize capabilities 中 `experimentalApi=true`；全局人工交互关闭时该能力保持关闭。

### 关联资料
- `src/interactive/codexRunnerRuntime.ts`
- `src/interactive/codexRunner.ts`
- `src/extensionHost/promptInteractiveRuntime.ts`
- `src/test/interactive/codexRunnerRuntime.test.ts`
- `src/test/interactive/codexRunnerLifecycle.test.ts`
- `src/test/extensionHost/promptInteractiveRuntime.test.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## Extension Host 拆分时同名包装函数不能回注自身

- 状态：已规避，需随后续 `extensionHost/*` 拆分和依赖注入变更复核
- 首次发现：2026-08-02
- 适用范围：`src/extension.ts`、`src/extensionHost/*` host wrapper、controller dependency injection

### 现象
- VS Code Extension Host 反复输出 `RangeError: Maximum call stack size exceeded`，堆栈集中在 `dist/extensionHost/sessionTabs.js` 的 `wrap(...).finally(syncToDeps)` 和 `persistSessionStore`。
- 报错出现在 Promise reject callback 中，表面看像异步清理问题，实际是 host 方法通过依赖闭包调用回同名包装方法。

### 触发条件与根因
- `extension.ts` 创建 host 时传入形如 `persistSessionStore: (store) => persistSessionStore(store)` 的依赖。
- 同一作用域随后又从 `sessionTabsHost` 解构出同名 `persistSessionStore` 包装函数，闭包最终捕获的是 host wrapper，不是原始存储实现。
- host 内部 `persistSessionStore -> deps.persistSessionStore -> persistSessionStore` 自递归，Promise `finally(syncToDeps)` 反复排队后触发栈溢出。

### 长期规避
- 拆分 `extensionHost/*` 时，注入依赖必须指向命名清晰的原始实现，例如 `persistSessionStoreToStorage`，不要用与 host 返回方法同名的闭包转发。
- 如果 host 返回对象需要暴露同名方法，`extension.ts` 解构时不要再绑定成会被依赖闭包捕获的同名局部变量。
- 对关键依赖注入边界加源码契约测试，断言不会出现 `name: (args) => name(args)` 这类自引用 wiring。

### 验证方式
- 运行 `npm run build`。
- 运行 `node --test dist/test/session/sessionPersistenceWiring.test.js dist/test/session/sessionLifecycleCoreCoverage.test.js dist/test/session/sessionStoreCoreCoverage.test.js`。
- 编译后用 `rg "persistSessionStoreToStorage|persistSessionStore: persistSessionStoreToStorage" dist/extension.js src/extension.ts` 确认宿主注入指向原始实现。

### 关联资料
- `src/extension.ts`
- `src/extensionHost/sessionTabs.ts`
- `src/test/session/sessionPersistenceWiring.test.ts`

## Graph 全量验证节点不能默认硬阻断交付收束

- 状态：已规避，需随 Graph planner / scheduler / summary 变更复核
- 首次发现：2026-08-02
- 适用范围：Graph AI planner、验证节点规划、scheduler 结构依赖、summary 未解决事项

### 现象
- Graph 运行中相关 focused 回归已经通过，但 `npm run test:unit` 等完整单测失败少量历史/范围外 subtests 后，整个 run 进入 `needs-review`，后续 review / summary 未执行。
- 用户看到的是“Graph 中断”，而不是“相关验证已通过，全量验证存在遗留失败”。

### 触发条件与根因
- AI planner 把完整单测节点规划成普通 blocking `depends_on`，并让 review/summary 结构依赖该节点。
- 完整单测节点 `maxAttempts=1` 且失败后没有可用 `if_fail` 返工路径，scheduler 后续无可运行节点，宿主 idle 后置为 `needs-review`。
- 全量测试输出常引用 `dist/test/*.test.js`，如果失败分类不映射回 `src/test/*.test.ts`，会误判真实修复范围。

### 长期规避
- 完整单测、全仓测试、全量 lint 等覆盖面大且可能包含历史/范围外失败的验证节点，默认规划为 `blocking:false` advisory 节点，并用 `evidence_for` 连到 review/summary。
- 相关 focused 验证仍必须使用普通 blocking dependency 或 `if_pass`，确保真实相关失败能阻断交付。
- Summary 必须把 advisory failed 节点列入 unresolved，不能把失败命令描述为已成功通过。
- failure classifier 必须把 `dist/test/*.test.js` 候选映射回 `src/test/*.test.ts`，再判断是否需要测试适配或源码返工。

### 验证方式
- 覆盖 failed `blocking:false` 结构依赖可继续调度 review/summary，但 `if_pass` 仍不满足。
- 覆盖 planner/store 保留 `blocking:false`，prompt 明确完整单测默认 advisory。
- 覆盖 `dist/test/webview/codexdualmodelwebview.test.js` 能映射到 `src/test/webview/codexdualmodelwebview.test.ts`。
- 运行 `npm run build` 与 `node --test dist/test/graph*.test.js`。

### 关联资料
- `src/graph/types.ts`
- `src/graph/graphScheduler.ts`
- `src/graph/graphPromptBuilders.ts`
- `src/graph/graphFailureClassification.ts`
- `.ch/docs/exec-plans/completed/2026-08/2026-08-02-graph-advisory-validation.md`

## Graph Tab 元数据不能覆盖前台模式选择

- 状态：已规避，需随 Graph / Loop / Vibe 入口变更复核
- 首次发现：2026-07-31
- 适用范围：AI 对话 Webview 模式选择、Graph tab 恢复元数据、前台发送与后台队列分发

### 现象
- 同一 conversation tab 先执行 Graph 后，用户切换到 Vibe/coding 或 Loop 再发送新提示，仍会被自动按 Graph 执行。
- 视觉上模式选择已经改变，但运行路径没有跟随用户当前选择。

### 触发条件与根因
- Graph run 会在 tab 上保留 `graphRunId` / `openGraphRun` 等元数据，用于展示图入口、状态和历史恢复。
- 前台发送路径若先根据 tab 元数据调用 auto mode 解析，再读取当前 UI 模式，就会把普通前台输入误判为 Graph 续跑。

### 长期规避
- 前台发送没有显式 `interactiveMode` 时，必须以当前 `state.interactiveMode` 为权威。
- Graph 元数据只能用于图入口、展示、历史恢复，以及后台派发或 Graph 续跑的自动归类，不能覆盖用户在同一 tab 中切换后的 Vibe/coding 或 Loop 前台发送。
- 修改 `resolveDispatchInteractiveMode`、tab 自动模式、队列出队或 Graph 恢复逻辑时，要同时覆盖“Graph 后切 Vibe”和“Graph 后切 Loop”回归测试。

### 验证方式
- 在带 `graphRunId` 的 active tab 上断言前台 `dispatchPrompt` 会随 `state.interactiveMode="coding"` 发送 coding/Vibe，并随 `state.interactiveMode="loop"` 发送 Loop。
- 保留后台派发 Graph tab 自动使用 `graph` 的覆盖。
- 运行 `npm run build` 与 `node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/graph/graphMainWebview.test.js`。

### 关联资料
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/test/webview/clipagescriptruntimecoverage.test.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `.ch/docs/references/cli-runtime-reference.md`

## VSIX 新增运行时依赖必须同步 `.vscodeignore` 放行

- 状态：已规避，需发布时检查
- 首次发现：2026-07-26
- 适用范围：VS Code 插件打包、`.vscodeignore`、运行时 `node_modules` 依赖

### 现象
- 开发态和本地 `dist/` 加载正常，但安装新打出的 VSIX 后插件激活失败。
- VS Code Extension Host 报错：`Cannot find module '@dagrejs/dagre'`，require stack 指向 `dist/webview/graphRunPanel.js -> dist/panelDiagnostics.js -> dist/extension.js`。
- 2026-09-25 复发：`src/loopCommunicationFilePreview.ts` 在扩展宿主执行 `require("marked")`，安装目录没有 `node_modules/marked`。激活失败报 `Cannot find module 'marked'`，调用栈经过 `dist/loopCommunicationFilePreview.js -> dist/webview/loopDebatePanel.js -> dist/extension.js`。

### 触发条件
- 源码新增了扩展宿主运行时的第三方依赖，并已写入 `package.json` / `package-lock.json`。
- `.vscodeignore` 先用 `node_modules/**` 排除了全部依赖，但没有同步增加对应 `!node_modules/<scope-or-package>/**` 放行规则。

### 根因
- `vsce package` 按 `.vscodeignore` 生成安装包；`package.json.dependencies` 只能表达依赖关系，不能覆盖显式 ignore 规则。
- 因此 `dist/*.js` 中保留的 `require("@dagrejs/dagre")` 在用户安装目录找不到实际包，插件在激活阶段直接失败。

### 长期规避
- 新增任何扩展宿主运行时依赖时，必须同时检查 `package.json.dependencies`、`.vscodeignore` 放行规则和实际 VSIX ZIP 清单。
- 对有传递依赖的 scope 包，优先放行整个作用域，例如 `!node_modules/@dagrejs/**`，避免只带主包漏掉子依赖。
- 单元测试至少覆盖关键依赖的声明和 `.vscodeignore` 放行；发布前仍必须以实际 VSIX 解包验证为准。

### 验证方式
- 执行 `npm run build` 和相关定向测试，例如 `node --test dist/test/graph/graphRunPanel.test.js dist/test/loop/loopCommunicationFilePreview.test.js`。
- 执行 `python3 scripts/export_vscode_extension.py` 后，用 Python ZIP 审计确认主依赖和传递依赖都进入包。
- 可进一步解包到临时目录并加载对应 `dist` 模块，确认不会再因缺少依赖抛错。

### 关联资料
- `.vscodeignore`
- `package.json`
- `src/webview/graphRunPanel.ts`
- `src/test/graph/graphRunPanel.test.ts`
- `scripts/export_vscode_extension.py`

## VSIX 打包脚本不能只依赖全局 `vsce`

- 状态：已规避，需发布时检查
- 首次发现：2026-08-20
- 适用范围：VS Code 插件打包、`scripts/export_vscode_extension.py`、`scripts/publish_vscode_extension.py`、本机开发环境

### 现象
- 执行 `python3 scripts/export_vscode_extension.py` 立即失败并提示找不到 vsce。
- 同一仓库之前可用，但换机器、清理全局 npm 包或 PATH 变化后突然失败。

### 触发条件
- 打包脚本只检查 `command -v vsce`，没有优先使用项目内 devDependency。
- 当前 shell 环境没有全局 `vsce`，即使项目代码和构建产物本身没有问题也会在入口预检失败。

### 根因
- `vsce` 属于本项目打包工具链，放在全局 npm 环境会让脚本依赖不可复现的机器状态。
- 本地依赖和脚本命令解析没有对齐，导致 `npm install` 后仍可能因为 PATH 缺少全局命令而失败。

### 长期规避
- 将 `@vscode/vsce` 放入 `devDependencies`。
- 打包和发布脚本优先调用 `node_modules/.bin/vsce`，仅在本地依赖不存在时回退到全局 `vsce`。
- 文档以 `npm install` + `python3 scripts/export_vscode_extension.py` 为默认流程，不再要求全局安装。

### 验证方式
- 执行 `npm run build`。
- 执行 `python3 scripts/export_vscode_extension.py`，确认无全局 `vsce` 时也能生成 VSIX 并通过 ZIP 清单检查。

### 关联资料
- `package.json`
- `package-lock.json`
- `scripts/export_vscode_extension.py`
- `scripts/publish_vscode_extension.py`
- `.ch/docs/runbooks/local-development.md`

## macOS 自带 rsync 不能复制 CodeGraph Unix socket

- 状态：已规避
- 首次发现：2026-10-03
- 适用范围：macOS 上使用 `scripts/export_vscode_extension.py` 临时目录打包

### 现象
- 导出在复制源码到临时 staging 目录时失败，输出 `rsync: error: mkstempsock: Invalid argument`。
- 同仓库在另一台 macOS 电脑可以打包，因为该电脑没有运行中的 CodeGraph daemon socket。

### 根因
- 仓库根目录 `.codegraph/daemon.sock` 是 Unix socket，不是扩展源码。
- macOS 自带 `openrsync` 在复制该 socket 时失败；即使改用 tar 回退，也不应把运行时 CodeGraph 状态复制到 staging。

### 长期规避
- `scripts/export_vscode_extension.py` 使用 Python 复制源码到临时目录，并排除根目录 `.codegraph`。
- 打包只使用扩展源码，不复制 CodeGraph 数据库、daemon 状态或 socket。

### 验证方式
- 在含有 `.codegraph/daemon.sock` 的 macOS 工作区执行 `python3 scripts/export_vscode_extension.py`。
- 确认 VSIX 内容检查通过，且 VSIX 不包含 `extension/.codegraph/`。

## Codex 可见 Tasklist 不能只识别括号状态

- 状态：已规避，需随 Codex 日志表达复核
- 首次发现：2026-07-20
- 适用范围：Codex `agent_message` commentary、Webview task list overlay、`Tasklist` / `任务列表` 文本解析

### 现象
- Codex 今天的执行日志中，很多可见任务列表不会写成统一的 `Tasklist: [pending] ...` 格式，而是使用无状态中文分隔、编号、checkbox、反引号包裹状态，或把“已完成 / 正在 / 待执行”等状态词直接嵌在条目文本里。
- 只识别 `[pending]` / `[in_progress]` / `[completed]` 会导致部分 Tasklist 完全不显示，或已完成项被当成未完成项。

### 触发条件与根因
- 真实日志里出现过 `Tasklist：事项1、事项2`、`Tasklist: \`[completed]\` ...`、`任务列表：1) ...已完成；2) ...进行中`、`Tasklist 更新：定位完成，开始修改` 等多种写法。
- Parser 早期把状态视为方括号里的结构化 token，没有从明确 Tasklist section 内的普通文本提炼有限状态词，也没有识别中文 `任务列表` / `任务列表状态` 头。

### 长期规避
- Tasklist parser 应先锚定明确标题，再在该 section 内兼容少量真实出现的格式：括号/checkbox 状态、反引号括号状态、编号/项目符号、中文/英文分隔符，以及“已/正在/待/最后”等进度短句。
- 不要把任意正文里的“完成”“待办”全局升级成任务；只有明确 Tasklist 标题后的内容才走兼容解析。
- 无状态但明确位于 Tasklist 标题后的事项仍按未完成处理；从文本提炼出的完成状态需要清洗掉状态词，避免面板显示“定位完成”这类混合状态文本。

### 验证方式
- 用当天真实样例覆盖：反引号状态、中文 `任务列表` 标题、编号条目后缀状态、`Tasklist 更新` 进度短句和无状态中文分隔清单。
- 运行 `npm run build` 和 `node --test dist/test/webview/clipagescriptruntimecoverage.test.js`。

### 关联资料
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/test/webview/clipagescriptruntimecoverage.test.ts`

## Codex Tasklist 全完成更新不能立即清空浮层

- 状态：已规避，需随 Codex `turn.plan.updated` / `todo_list` 事件和普通可见 Tasklist 文本复核
- 首次发现：2026-07-21
- 适用范围：Codex App Server plan 事件、普通 Codex stdout/assistant 文本、Webview task list overlay、外部 taskListUpdate

### 现象
- 最新 Codex 日志已经收到 `turn.plan.updated`，plan item 会输出 `completed` / `inProgress` / `pending` 的混合状态，长任务中会多次渐进更新。
- 2026-07-22 最新日志也出现另一类来源：没有 `turn.plan.updated` / `todo_list`，只有普通 stdout/assistant 文本里的 `Tasklist：...` 或 `任务列表更新：...`。
- 前端也能把任务列表解析成列表，但用户看不到逐步完成过程；当最后一个任务完成时，也几乎看不到复选框被打勾。

### 触发条件与根因
- `turn.plan.updated` 已经作为 raw event 进入日志/运行流，但如果只依赖 runner 内部专用 `onTaskListUpdate` 分支，协议形态变化或转发路径差异会让“日志有过程、浮层不刷新”。
- 普通 assistant 文本增量更新常走 `appendAssistantDelta -> updateRenderedAssistantMessage` 的局部 DOM 路径，不一定触发 `renderMessages()`；如果不在该路径上主动 `updateTaskList()`，文本里的 Tasklist 会进入聊天正文但不会刷新浮层。
- `setTaskListItems` 曾通过 `shouldDisplayTaskListItems(items.some(done !== true))` 判断显示条件。
- 当 Codex 发来“全部 completed”的列表时，解析结果正确，但显示条件判定为 false，随后把 `taskListState.items` 清空并关闭浮层，所以完成态没有机会渲染成 checked checkbox。

### 长期规避
- Codex `turn.plan.updated` / `todo_list` 的转发 raw event 也必须提取 taskList 并发送 Webview `taskListUpdate`，不能只把它写入 raw stream 日志。
- 普通 assistant 文本流式追加后必须同步重算 taskList；如果该消息只包含 Tasklist，要触发完整渲染以隐藏正文并显示浮层。
- 任务列表显示条件只能判断是否存在有效条目，不能用“是否还有未完成项”作为显示条件。
- 全部完成的列表应保留并显示 `N/N` 与已勾选项；运行结束后再由 `closeTaskListForRunCompletion` 统一收起，避免把最终状态吞掉。
- 空数组或运行结束后的迟到更新仍应重置/隐藏，避免历史任务列表泄漏到下一次运行。

### 验证方式
- 用真实日志形态 `turn.plan.updated` / taskListUpdate 中的混合状态、全 `completed` 状态，以及普通 assistantDelta 文本 `Tasklist: [completed] ... [inProgress] ... [pending] ...` 覆盖过程刷新与最终勾选。
- 运行 `npm run build`、`node --test dist/test/interactive/codexAppServerProtocol.test.js dist/test/webview/openCodeTaskListOverlay.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`。

### 关联资料
- `src/interactive/codexAppServerProtocol.ts`
- `src/extension.ts`
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/webview/viewContentScript/traceRendering.ts`
- `src/test/interactive/codexAppServerProtocol.test.ts`
- `src/test/webview/openCodeTaskListOverlay.test.ts`
- `src/test/webview/clipagescriptruntimecoverage.test.ts`

## Loop 主任务不能一直显示旧任务列表

- 状态：已规避，需随 Loop / Loop+ 主任务会话续接复核
- 首次发现：2026-09-26
- 适用范围：Loop 主任务 Tab、Loop+ 主任务 Tab、Webview task list overlay、external `taskListUpdate`

### 现象
- 主任务面板一直显示早先的任务列表，但当前实际执行的是编排决策或子任务，已经不是那张清单里的事项。

### 触发条件与根因
- Loop / Loop+ 主任务 Tab 在父任务 `running` 或子任务仍在执行时被视为 busy。
- `setMessagesForTab` 因此一直保留 external 任务列表；`shouldDisplayTaskListForTab` 也继续显示浮层。
- 同一 Codex / Claude / OpenCode 会话里的历史 `Tasklist` 会在消息刷新后被重新解析出来。主任务后续轮次做的是复核、派发或等待，不会自然替换这张旧清单。

### 长期规避
- 主任务 Tab 不展示任务列表浮层，消息刷新也不保留它的 external 列表。
- 子任务和普通对话仍只展示当前 run 的任务列表。
- Loop 与 Loop+ 主任务提示必须禁止复述、续写或调用计划/待办工具去维护旧 Tasklist。

### 验证方式
- 运行 `npm run build`。
- 运行 `node --test dist/test/webview/loopMainTaskList.test.js dist/test/webview/openCodeTaskListOverlay.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/loop/loopMainTaskListPolicy.test.js`。

### 关联资料
- `src/loopMainTaskListPolicy.ts`
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/webview/viewContentScript/coreRuntimeState.ts`
- `src/extensionHost/loopOrchestration.ts`
- `src/extensionHost/loopPlusPromptBuilders.ts`

## Codex 同一 UI 分组切换模型/配置时必须 resume 已映射 thread

- 状态：已规避，需随 Codex app-server provider 恢复语义复核
- 首次发现：2026-07-16；规则修正：2026-08-25
- 适用范围：Codex app-server interactive runner、模型配置切换、conversation tab / group 到 Codex thread 的映射、自动上下文压缩

### 现象
- 同一个 AI 对话分组中，先用配置 A / 模型 A 完成任务，再不切换分组只切换到配置 B 或模型 B 后继续执行，插件若主动新建 thread，模型将看不到已有会话上下文。
- 跨 provider/account 的历史若含目标端不能解密的 reasoning/compaction 内容，app-server 可能返回 `invalid_encrypted_content`；这不是通过重放旧工具调用能够修复的客户端问题。

### 触发条件与根因
- 旧实现把模型或配置变化直接解释为“必须新建 thread”，并冻结旧 mapping；这会绕过 app-server 的服务端会话恢复。
- 旧 runner 只向 thread 请求传 `model`，没有从当前 `~/.codex/config.toml` 读取根级 `model_provider` 并传入 `modelProvider`，使跨 provider resume 不能按 app-server 官方路径选择目标 provider。
- app-server 只在 `thread/start` / `thread/resume` 接收 `modelProvider`；把它错误传给 `turn/start` 或使用已废弃 `persistExtendedHistory` 都不能恢复上下文。

### 长期规避
- Codex runner 缓存身份仍须包含 active config ID 和 selected model，以便重建本地 process 配置；但模型或配置变化后必须继续将已映射 `threadId` 传给 `thread/resume`，不得主动冻结并创建新 thread。
- 从当前生效 `~/.codex/config.toml` 读取根级 `model_provider`，仅在 `thread/start` / `thread/resume` 传入 `modelProvider`；没有该设置时省略字段，让 app-server 自动恢复。
- app-server 恢复服务端 thread，不重新执行旧工具调用或重发完整历史事件。若返回不兼容的加密历史错误，保留原始错误并要求用户按服务端限制新建会话；不得伪造完整历史重放。
- 自动上下文压缩还必须有有界超时；Codex app-server `thread/compact/start` 可能长时间没有完成事件，自动路径最多等待 3 分钟，超时直接停止并按未压缩处理。

### 验证方式
- 断言相同 config/model 及模型或 config 任一变化时均继续复用 mapped thread。
- 用临时 `config.toml` 断言 runner 发出的 `thread/resume` 同时包含原 `threadId`、当前模型和 `modelProvider`，且 `turn/start` 不含 provider。
- 运行 `npm run build` 和 `node --test dist/test/interactive/codexThreadSelection.test.js dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexRuntimeConfig.test.js dist/test/interactive/codexRunnerLifecycle.test.js`。

### 关联资料
- `src/interactive/codexThreadSelection.ts`
- `src/interactive/manager.ts`
- `src/interactive/codexRuntimeConfig.ts`
- `src/interactive/codexRunner.ts`
- `src/contextCompactionRunner.ts`
- `src/test/interactive/codexThreadSelection.test.ts`
- `.ch/docs/exec-plans/completed/2026-08/2026-08-25-codex-app-server-provider-resume.md`

## Codex Graph 子任务报 `spawn <codex> ENOENT` 不一定是命令丢失

- 状态：已规避，需随 Codex interactive runner 复用策略复核
- 首次发现：2026-07-24
- 适用范围：Codex app-server interactive runner、Graph 节点执行、Loop/Graph 子任务临时执行根

### 现象
- Graph 节点运行日志显示 `spawn /Users/.../.npm-global/bin/codex ENOENT`，但同一终端里 `codex --version` 正常，symlink 和目标 `codex.js` 都存在。
- 插件日志中同一个 Graph run 的后续节点快速失败，但 Graph store 曾继续把节点记为 passed 并生成 `Graph run completed`。

### 触发条件与根因
- 早期 Graph 节点通过 `taskRole="subtask"` 创建临时执行根，节点结束后会清理该目录。2026-07-24 起 Graph 节点改为使用 run 级独立 git worktree；Loop 子任务仍可能使用临时执行根。
- `InteractiveRunnerManager` 只按 session/config/model 等维度复用 Codex runner，未把 `command`、`args`、`cwd` 作为 runner 身份的一部分时，后续 Graph 节点可能复用仍指向已删除临时 `cwd` 的旧 runner。
- Node `spawn` 在 `cwd` 不存在时也会报 `ENOENT`，错误文本仍形如 `spawn <command> ENOENT`，容易误判为 CLI 可执行文件缺失。
- Graph executor 如果不要求 `runPrompt` 错误回传，会把已展示到 UI 的节点执行失败吞掉，导致 kernel 收到 passed 结果并继续 summary。

### 长期规避
- Codex runner 缓存身份必须同时包含 `command`、`args` 和 `cwd`；任何执行根变化都要重建 runner。
- Graph 节点调用 `runPrompt` 必须使用内部错误回传路径，并在节点结束后解析 communication file 的 `## JSON`；CLI 启动失败、最终答复失败、artifact 缺失/非法或 runner 异常要进入 `failed/blocked/needs-review`，不能继续生成 completed summary。
- 排查 `spawn <cli> ENOENT` 时同时检查 `cwd` 是否存在，不能只检查 `command -v` 或 symlink。

### 验证方式
- 断言 `InteractiveRunnerManager` 在相同 session/config/model 但不同 `cwd` 时不会复用 Codex runner。
- 断言 Graph 节点执行路径设置错误回传，`runPrompt` interactive 失败时会 throw 给 Graph kernel；断言 artifact JSON 的 failed/blocked 不会被 executor 改写成 passed。
- 用真实日志核对：失败 run 的 `codex-app-server-spawn.cwd` 指向临时执行根，且该根可能已被清理。

### 关联资料
- `src/interactive/manager.ts`
- `src/extension.ts`
- `src/test/interactive/codexThreadSelection.test.ts`
- `src/test/graph/graphExtensionRuntime.test.ts`

## 不能只依赖 CLI 结构化 `final_answer`，也不能把 `turn.completed` 当成最终回复气泡

- 状态：已规避，需随 Codex app-server 事件协议复核
- 首次发现：2026-06-14；再次确认：2026-07-10、2026-09-12、2026-09-13
- 适用范围：Codex / Claude / OpenCode prompt、Codex app-server `agent_message` / `turn.completed`、最终结论气泡与 hidden retry

### 现象
- Codex 已在 AI 对话中输出非空 assistant 答复，并以 `turn.completed status:"completed"` 正常结束，但该回合所有 `agent_message` 都是 `phase:"commentary"` 或 `phase:null`，没有 `phase:"final_answer"`。
- 2026-09-12 的 `glm-5.3_sub-coco` 复现显示：请求成功、收到 `item.completed agent_message phase:null` 和主 `turn.completed status:"completed"`，但因没有 `[final_answer]` 文本被误判为缺少最终结论并触发 hidden retry。
- 2026-09-13 的 `grok-4.6-kedaya` 会话 `01a09864-b418-7fd3-ba67-94486151557a` 显示相反误判：最后一条只是被截断的 reasoning/thinking（`The abort on cleanup of fetch effects... tenan...`），182ms 后 Codex 发出 `turn.completed status:"completed"` 且进程 `exitCode=0`，插件立即记为“任务已完成”并可能触发自动压缩。用户体感是任务莫名中断，界面也没有最终回复气泡。
- 2026-09-17 的 `deepseek-v4.1-flash_sub-coco` 会话 `01a0acf8-bf5a-7d13-b3b0-ec950f8abe29` 再次复现 phase-null 漏判：用户只输入 `hi`，模型返回非 thinking 问候正文，rollout `agent_message.phase` 为 `null` 且没有 `[final_answer]`，随后 `task_complete`；插件追加“没有产生最终结论气泡，自动继续”并 hidden retry。

### 触发条件与根因
- 真实日志中的会话 `019f4b72-86f8-72b3-80f0-860bf9b467c4` 在收到 `hi` 后输出 commentary assistant 文本，随后成功完成；自动继续后的第二回合再次出现相同事件序列。会话 `01a090d4-f86c-7cc0-b998-3b59913a5b13` 则以 `glm-5.3_sub-coco` 输出 `phase:null` 的普通 assistant 正文后成功完成。会话 `01a0acf8-bf5a-7d13-b3b0-ec950f8abe29` 的 DeepSeek 4.1 flash 问候同样是 `phase:null` 的完整 assistant 正文，不是 thinking，也没有后续工具调用。
- `phase` 描述消息阶段，`turn.completed status:"completed"` 描述结构化回合终态。Grok 等模型可能在只产出 reasoning、尚未写出最终 assistant 正文时就结束 turn；把 completed turn 直接当最终结论，会把过程 thinking 收成成功完成。
- 直接把“成功退出前最后一段普通正文”默认当最终答复会反向引入过程性 commentary 误判，无法成为所有 CLI 的严格语义。

### 长期规避
- 所有普通任务和 hidden retry 的实际模型 prompt 都追加统一约定：任务完成后的最终回复必须以 `[final_answer]` 开头，过程更新不得使用该标记；不要改写界面里的原始用户消息。
- Loop 主任务/子任务等已有纯 JSON 或专用结构化终态的机器协议必须显式关闭文本标记注入和严格文本判定，否则 `[final_answer]` 前缀会破坏 JSON 解析；这些路径继续按自己的完成气泡验收。
- 普通任务最终回复气泡只认两类信号：消息类型带着 `final_answer`（Codex `phase:"final_answer"` / `codexFinalAnswer=true`），或非 thinking assistant 正文包含 `[final_answer]`。thinking、trace、system、user 文本中的标记不算。
- Codex 主 turn 的 `turn.completed status:"completed"` 只表示回合结束，不能单独收口。reasoning/thinking-only 或 `phase:"commentary"` 后的 completed turn 必须进入 hidden retry。
- 对部分代理模型（如 DeepSeek 4.1 flash / GLM）永远不写 `phase:"final_answer"` 的情况：若主 turn 已 completed，最后一条主线程 `agent_message` 是 `phase:null` / 缺省 phase，且其后没有工具活动，则把该条非 thinking assistant 正文提升为 `codexFinalAnswer=true`。不要把 completed turn 本身、commentary 或 thinking-only 提升为最终结论。
- `[final_answer]` 只能在 Webview assistant 气泡展示时移除开头的协议前缀，行内标记必须保持可见；不能提前改写 `message.content` 或会话存档，否则固定严格协议、历史恢复和 hidden retry 会丢失兜底终态信号。thinking 气泡即使后面紧跟“任务已完成”也不渲染成最终回复样式。
- 普通任务固定使用协议/结构化收口；工具设置不提供切换项，遗留 `finalAnswerPolicy` / `codexFinalAnswerPolicy` 字段会被忽略。完成措辞、`Task completed` 或成功退出都不能替代显式最终信号。
- 子代理 `turn.completed`、failed、interrupted、主动停止、Claude/OpenCode 普通成功退出都不得借 Codex completed-turn 收口。禁止扫描当前用户锚点之前的历史消息，也禁止把所有 commentary 无条件当最终答复。

### 验证方式
- 对 Codex / Claude / OpenCode 的首轮和 hidden retry prompt 断言都含最终回复标记约定。
- 对 Loop 机器协议断言首轮和 hidden retry prompt 都不含 `[final_answer]`，且普通任务的固定严格协议不会覆盖其专用终态规则。
- 断言结构化 final 和 `[final_answer]` assistant 文本通过；普通正文、thinking 中的标记、当前用户锚点之前的旧标记，以及 thinking-only / commentary-only 的 `turn.completed` 不通过。
- 用 `item.completed agent_message phase:null` 且无后续工具、再跟主 `turn.completed completed` 断言会提升为 `codexFinalAnswer=true`；`phase:"commentary"` 或 unspecified 后再跟工具活动不得提升。
- 用 `reasoning item.completed -> turn.completed completed` 断言交互运行时进入 missing-final-conclusion retry，而不是“任务已完成”。
- 用子线程 `turn.completed completed` 断言不会触发父任务 completed-turn 回调。
- 断言工具设置中的遗留策略字段和旧消息键都不会改变运行时行为。

### 关联资料
- `src/toolSettings.ts`
- `src/interactive/codexRunner.ts`
- `src/interactive/codexRunnerRuntime.ts`
- `src/finalConclusion.ts`
- `src/test/webview/finalAnswerPolicy.test.ts`
- `src/test/extensionHost/promptRuntime.test.ts`
- `src/test/interactive/codexRunnerRuntime.test.ts`

## 子代理事件必须按子会话身份分流，不能只观察父进程输出

- 状态：已规避，需随 OpenCode / Codex 协议版本复核
- 首次发现：2026-07-13
- 适用范围：OpenCode 1.17.18 本地服务、Codex App Server 0.144.1、Loop 独立子任务、多子代理对话气泡与父任务收口

### 现象
- OpenCode 父 `run --format json` 等待内部子代理时可以长时间没有新 JSONL，子代理实际仍在读文件、调用工具和输出文本；只显示一次“请等待”仍会让用户误判卡死。
- Loop 主从模式的子任务是扩展启动的独立 CLI 进程和 conversation tab，不是 OpenCode/Codex provider 内部 child session。只监控 provider 的 parent/child API 时，Loop 主任务 tab 在整个子任务执行期间仍不会出现新气泡。
- Codex App Server 的子代理通知与父通知共用一个连接。若忽略 `params.threadId`，子代理正文会并入父 assistant 气泡，子线程 `thread/started` 会覆盖父 threadId，子线程 `turn/completed` 甚至会提前结束父任务。

### 触发条件与根因
- OpenCode 子代理有独立 session，父 CLI stdout 不承担子 session 事件转发；本机 1.17.18 对较大 session 执行 `opencode export` 还观察到 JSON 在字符串中途截断，不能把活跃任务轮询建立在该命令输出上。
- OpenCode 1.17.18 的 `run --help` 虽声明 `--port`，实际执行 `run --port <port>` 后该端口可持续 `ECONNREFUSED`，不能把“参数被接受”当作服务已经监听。`opencode serve` 才提供经过 `/global/health` 验证的 HTTP 服务，并公开 children/message/status 与 SSE event；父子关系由 child `parentID` 表达。
- Loop 子任务的可见输出已经进入插件自身的子任务 tab 消息存储；继续从 OpenCode child API 查找它们属于身份模型错误，应从插件拥有的消息流生成主任务进度快照。
- Codex `item/agentMessage/delta`、`item/started|completed`、`turn/completed` 都携带 `threadId`，初始化连接还会自动订阅新建子线程。把连接等同于单线程是错误假设。

### 长期规避
- OpenCode 由插件先启动受管 `opencode serve`，健康检查通过后再用 `run --attach`；不得恢复为未经监听验证的 `run --port`。SSE 只作为低延迟刷新触发器，正文始终读取 child message 完整快照并做前缀增量，另以 60 秒 children/status/messages 全量轮询兜底。服务、订阅与轮询必须由单次尝试统一释放；连接失败使用指数退避且只周期性记录错误。禁止直接读取私有 SQLite。
- OpenCode 只接纳当前运行尝试中新建的直接 child session，避免恢复旧父会话时把历史子代理正文重新插入当前回合。
- Loop 子任务启动后立即在主任务 tab 建立稳定 `taskId + round + subtaskId` 进度气泡，并从子任务 tab 的非 thinking、非内部子代理 assistant 消息做快照同步；子任务自己的完整消息流继续留在原 tab。
- Codex 所有 assistant delta、item、plan 和 turn 完成事件先比较主 `threadId`；子线程生命周期和正文走独立 handler，只有主 threadId 且 active turnId 匹配的完成通知可以收口父 turn。
- 子代理气泡必须带稳定 `subagentId`、禁止自动合并，并从父任务 final-answer 与 successful-reply fallback 中排除。

### 验证方式
- OpenCode 用模拟 serve 健康检查、children/status/messages 与分片 SSE 覆盖：`run --attach` 参数、60 秒 interval、当前尝试过滤、快照增量、重连退避、无用户 prompt/tool output 泄漏、dispose 后不再更新。
- Loop 用多条匹配/不匹配消息覆盖：启动即有等待气泡、每秒快照去重、过滤 thinking/内部子代理/其他轮次、完成/失败/中断状态映射和主 tab 定向接线。
- Codex 用 parent/child threadId 覆盖：child delta 不进入 `onAssistantDelta`，child completion 不通过父 turn settle，collab/subAgentActivity 状态能映射到独立气泡。
- Webview 用两个交错子代理断言旧气泡仍按原 message ID 原位更新，不重定向成新的末尾 assistant 气泡。

### 关联资料
- `src/cli/openCodeSubagentMonitor.ts`
- `src/interactive/codexRunner.ts`
- `src/interactive/codexRunnerRuntime.ts`
- `src/subagentProgress.ts`
- `src/finalConclusion.ts`
- `src/test/cli/openCodeSubagentMonitor.test.ts`
- `src/test/interactive/codexAppServerEvents.test.ts`
- `src/test/core/subagentProgress.test.ts`

## Codex reasoning 摘要不能按普通 assistant 正文直接落盘

- 状态：已规避，需随 Codex app-server 事件协议复核
- 首次发现：2026-07-10
- 适用范围：Codex `item.completed` reasoning 事件、thinking 气泡、历史会话存档

### 现象
- 部分 Codex 模型的 reasoning `summary` / `text` 会输出 `**Planning ...**`，并在其后附加独占一行的空 HTML 注释 `<!-- -->`。
- 插件把 reasoning 作为 thinking assistant 消息持久化后，空注释残片会反复出现在对话和历史会话中。

### 触发条件与根因
- Codex app-server 原始事件为 `item.completed` 且 `item.type=reasoning`，与正常最终回答的 `agent_message` 不是同一事件类型。
- reasoning 提取器此前只做片段扁平化和去重，没有对该模型特有的空分隔标记做边界清洗。

### 长期规避
- 只在 Codex reasoning/thinking 边界清洗独占一行的空 HTML 注释，禁止对全部消息做全局 HTML 注释正则替换。
- 行内 `<!-- -->`、非空 `<!-- explanation -->`、普通 assistant/user 消息必须保持原样。
- 会话加载和保存使用同一清洗函数修复历史 Codex thinking 消息；清洗后为空的 thinking 消息直接移除。

### 验证方式
- 用真实日志形态 `**Planning ...**\n\n<!-- -->` 断言 reasoning trace 只保留标题。
- 断言普通 assistant 消息中的 `<!-- -->`、行内空注释和非空注释不变。
- 断言历史 Codex thinking 消息加载后被清洗，而 Claude thinking 消息不受影响。

### 关联资料
- `src/codexReasoningContent.ts`
- `src/interactive/codexAppServerProtocol.ts`
- `src/sessionStore.ts`
- `src/test/core/codexReasoningContent.test.ts`

## 空消息存档不能证明实时思考气泡有正文

- 状态：已规避
- 首次发现：2026-10-02
- Codex rollout 可能记录只有 `encrypted_content` 且 `summary: []` 的 reasoning；这表示没有公开下发的摘要，不能猜测或解密补出思考正文。插件启动日志也不一定含 app-server 原始事件，需要交叉检查本机 rollout 与消息存档。
- 交互宿主先发送空 `appendMessage` 占位，再发送 `assistantDelta`；纯空白也是非空字符串。Webview 若仅按消息角色/结果模式过滤，会把占位或空白渲染成空泡，而 `sanitizeMessages` 在落盘时已经删除空消息，所以重开后与实时现象可能不同。
- 规避：Codex reasoning 在首段实际正文前仅缓存空白；Webview 按展示正文过滤空 assistant 和无正文 thinking trace，保留状态与 ID 关联、有效操作按钮，并让后续正文恢复原消息可见性。禁止直接丢弃所有空增量或删除流式占位，否则可能丢失换行或后续文字。
- 回归：`src/test/interactive/codexRunnerRuntime.test.ts` 和 `src/test/webview/clipagescriptruntimecoverage.test.ts`；覆盖空摘要、空白前缀、思考占位、工具插入后的正文、历史空 trace、空最终标记及操作按钮。

## OpenCode 真实会话字段是 `sessionID`，不能把插件 `local_*` 当作 CLI session

- 状态：已规避，需随 OpenCode JSONL 协议复核
- 首次发现：2026-07-10
- 适用范围：OpenCode 1.17.16、one-shot / 并行执行、会话 tab 二次执行

### 现象
- 同一个 OpenCode 会话 tab 第一次执行成功，第二次稳定报 `Error: Session not found`。
- CLI 启动参数出现 `--session local_<timestamp>_<random>`，而不是 OpenCode 返回的 `ses_*`。

### 触发条件
- 会话提取器只识别 `session_id`，没有识别 OpenCode JSONL 的 `sessionID`。
- 首轮未捕获真实 ID后，插件为消息落盘创建 `local_*` 占位会话，下一轮又没有在 CLI 边界过滤该占位 ID。

### 根因
- OpenCode 1.17.16 的 `step_start`、`text`、`step_finish` 和 `error` JSONL 事件在顶层及 `part` 中使用 `sessionID`。
- `local_*` 是插件内部存储身份，不存在于 OpenCode session store；把它传入 `opencode run --session` 必然找不到会话。

### 长期规避
- OpenCode 输出优先按 JSONL 结构读取 `sessionID`，同时兼容 `sessionId` / `session_id`，不要只依赖单一正则字段名。
- OpenCode 运行边界必须拒绝插件 `local_*`，只把真实外部 ID传给 `--session`。
- 修复前已有 `local_*` tab 不使用 `--continue` 猜测全局最近会话；启动新底层会话并捕获 `ses_*` 后，先迁移本地消息和 tab 引用再接管真实 ID，避免多 tab 或并发串线。

### 验证方式
- 用真实 OpenCode JSONL 样例断言 `sessionID` 可提取为 `ses_*`。
- 断言 `resolveCliSessionIdForResume("opencode", "local_...")` 返回空，最终 argv 不含 `--session local_*`。
- 在同一 tab 连续运行两次，第二次日志应包含 `--session ses_*`，且不再出现 `Session not found`。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/sessionLifecycle.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode 空配置档案不能按运行完整性阻断保存

- 状态：有效
- 首次发现：2026-07-12
- 适用范围：OpenCode 配置中心、配置档案保存、运行前校验

### 现象
- 点击“添加 OpenCode 配置”时，空档案使用 `{}` 初始化，却立即报错 `OpenCode primary model is missing`，导致用户无法先创建档案再填写 Provider 和模型。

### 根因
- 配置档案保存直接复用了运行前完整性校验；顶层 `model` 对运行是必需项，但对尚未填写的草稿不是保存前提。

### 长期规避
- 保存档案时允许缺少顶层 `model` 的草稿落盘，但继续阻止无效 JSON、错误模型引用、占位配置和不完整的兼容网关配置。
- 应用或运行 OpenCode 前仍执行完整校验，缺少主模型必须阻断执行。

### 验证方式
- `saveConfig` 可以保存内容为 `{}` 的 OpenCode 档案。
- `validateOpenCodeConfigForRun("{}")` 仍返回 `role-model-missing`。

### 关联资料
- `src/config/configService.ts`
- `src/test/config/configService.test.ts`

## OpenCode provider `npm` 不能按模型品牌推断

- 状态：有效
- 首次发现：2026-07-10
- 适用范围：OpenCode 配置中心、自定义 provider、配置校验与文档范例

### 现象
- 配置范例如果使用 Claude、Gemini 或 DeepSeek 型号名，同时写 `npm: "@ai-sdk/openai-compatible"`，用户容易认为适配器包和模型品牌冲突。
- 反过来，如果代码按模型 id 中的 `claude` / `gemini` / `deepseek` 自动替换或拒绝 npm 包，会误伤通过 OpenAI-compatible 网关合法代理这些模型的配置。

### 触发条件
- 把 `provider.<id>.npm` 理解成“模型厂商品牌”，而不是请求所使用的 API 协议适配器。
- 配置页只展示 JSON 范例，但没有说明内置 provider、原生 API 自定义 provider、兼容网关三种场景的差异。

### 根因
- OpenCode 的 `npm` 指定 provider 使用的 AI SDK 包。官方 provider 目录中 Anthropic、Google、OpenAI 分别使用 `@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai`；官方自定义 provider 文档说明 `@ai-sdk/openai-compatible` 用于任何 OpenAI-compatible API。
- 网关可以通过统一 OpenAI-compatible endpoint 承载多个品牌模型，因此模型 id 或展示名称不能可靠推断底层协议。

### 长期规避
- 优先使用 OpenCode 内置 provider 和 `/connect` 鉴权；这种场景通常无需手写 `provider.<id>.npm`。
- 只有手写自定义 provider 时才按真实 API 协议选择 SDK：原生 Anthropic / Google / OpenAI API 使用对应 `@ai-sdk/*` 包，兼容网关使用 `@ai-sdk/openai-compatible`。
- 校验只检查可证实的协议要求，例如 OpenAI-compatible 自定义 provider 必须有 `options.baseURL`；禁止根据模型名称自动换包或报错。
- 配置页范例使用中性网关模型名，并明确标记为 OpenAI-compatible 网关范例；provider 名称继续使用 `myAPI`。范例模型 id 和示例 `baseURL` 作为占位值参与 preflight，用户必须替换为真实值。

### 验证方式
- `validateOpenCodeConfigForRun` 应允许 `@ai-sdk/openai-compatible` 承载包含 Claude、Gemini、DeepSeek 名称的网关模型。
- `@ai-sdk/openai-compatible` 缺少 `options.baseURL` 时应返回明确阻断问题；`@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai` 不应被强制要求兼容网关 baseURL。
- 配置页示例 JSON 可解析，标题和说明必须明确“OpenAI-compatible 网关”以及“按 API 协议选择 npm”。

### 关联资料
- OpenCode Providers：`https://opencode.ai/docs/providers/`
- models.dev provider directory：`https://models.dev/api.json`
- `src/config/configService.ts`
- `src/test/config/openCodeConfigService.test.ts`

## OpenCode `.env` 与 `config.json` 双配置会误导用户

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode 配置中心、配置文档、示例配置

### 现象
- 用户会误以为 OpenCode 需要同时维护 `config.json` 和 `.env` 两个配置文件。
- 配置页如果出现多个 OpenCode 保存按钮，会让用户不清楚哪个文件才是当前运行配置来源。

### 触发条件
- 文档或 UI 把 OpenCode `.env` 描述为当前配置要求。
- OpenCode 示例把 provider 名称写成具体历史供应商名，导致用户把示例名当作固定平台。

### 根因
- OpenCode 当前配置收口为单 `~/.opencode/config.json`，`.env` 不应再作为当前配置中心的保存对象。
- 历史调试中的 provider 示例名混入入口文档，容易被用户理解为推荐默认名称。

### 长期规避
- OpenCode 配置中心和文档只暴露一个 `config.json` 保存入口，不再要求或生成 `~/.opencode/.env`。
- OpenCode 配置范例中的 provider 名称统一使用 `myAPI`，不使用历史供应商名作为当前示例名称。
- 只有历史踩坑、兼容迁移或外部 endpoint 调试说明可以提到旧 `.env` / 具体供应商名，并且必须明确不是当前配置要求。

### 验证方式
- 在入口文档和 `.ch` 事实来源中运行 `rg -n "PackyAPI|OpenCode.*\\.env|\\.opencode/\\.env"`，当前配置口径不得命中；若命中只能是历史踩坑说明。
- 在配置中心验收 OpenCode 页面只有 `config.json` 保存入口，保存后不创建或更新 `~/.opencode/.env`。

### 关联资料
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `docs/cli-reference.md`

## OpenCode OpenAI-compatible 自定义 provider 裸 baseURL 会空响应

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode 1.17.15、`@ai-sdk/openai-compatible` 自定义 provider、PackyAPI/OpenAI-compatible endpoint

### 现象
- VS Code 插件发起 `opencode run --format json <prompt>` 后，OpenCode 进程 `code=0` 成功退出，但 stdout 只有 `step_start` / `step_finish`，tokens input/output/reasoning 全为 0，没有 assistant 文本。
- 用户侧看到 `OpenCode exited successfully, but did not return an assistant answer...`，且可能重复显示同一句空响应错误。

### 触发条件
- `opencode.json` 使用示例占位配置，例如 `model=myprovider/my-model-name`、provider `myprovider`、models alias `my-model-name`。
- PackyAPI 这类 OpenAI-compatible provider 的 `options.baseURL` 配成裸域名 `https://www.packyapi.com`，而不是实际兼容接口 `https://www.packyapi.com/v1`。

### 根因
- OpenCode 官方 schema 中 `model` 是 `provider/model`，`provider.<id>.models.<id>.name` 是展示元数据，不能把 `my-model-name` alias 自动改写成真实供应商模型名。
- `@ai-sdk/openai-compatible` 需要指向实际 OpenAI-compatible endpoint；PackyAPI 裸域名会导致 OpenCode 1.17.15 空事件成功退出，`/v1` endpoint 则返回明确 provider/API 错误或正常 assistant。

### 长期规避
- 产品配置示例保持中性 `myAPI` 网关，不绑定具体供应商；真实排障或 smoke 必须替换为实际 provider/model、兼容 endpoint 和鉴权信息。
- 运行前 preflight 必须阻止 `myprovider`、`my-model-name`、`my-small-model-name`、示例 baseURL、缺失 `{env:NAME}`；JSON error 事件必须展示 provider/API message，不能只显示泛化空响应。
- OpenCode `code!=0` 且 stderr 为空时，仍要解析 stdout JSON `error` 事件；PackyAPI 403 这类错误气泡应包含 `APIError`、`403`、`access_denied` 或 provider message，不能只显示 `CLI 退出码: 1`。
- OpenCode one-shot 只在启动后完全没有 assistant / error / status / progress 活动的 60 秒内按空输出超时进入 hidden retry；收到首个有效事件后必须解除外层 watchdog。重试耗尽时要追加可见 system 错误气泡并写入会话存档，不能只停在运行态或只留下 trace。
- OpenCode `--format json` 的 `step_start`、`tool_use`、reasoning 和 `text` 事件主要出现在 stdout；可见气泡解析必须消费 stdout JSONL，不能只依赖 stderr trace，否则用户会只看到最终答复，看不到思考/工具/中间 AI 气泡。
- 普通 one-shot 与并行/Loop 子任务必须走同一套 visible-event 语义。`rawStreamDelta` 只更新原始流诊断面，不能替代 `appendMessage` / `assistantDelta` / `traceSegment`；否则并行子任务会持续显示流记录，却在进程退出前没有任何对话气泡。退出时还必须按本轮已展示 assistant 文本去重完整 final text。

### 验证方式
- 回放 OpenCode `text` 事件且正文为独占 `...` / `…` 时，不应追加 assistant 气泡；包含实际正文的文本仍应正常展示。
- 对占位配置运行 `validateOpenCodeConfigForRun`，应返回 placeholder / missing env 等阻断问题。
- 对修正后的 PackyAPI `/v1` 配置运行 `OPENCODE_CONFIG=... opencode run --format json 'Reply with exactly: OK_OPENCODE_CONFIG_TEST'`，应返回 assistant 文本，或返回明确 provider/API 错误；不得再出现 `code=0` 且 tokens=0 的空 assistant。
- 对 PackyAPI 返回非零退出的场景，stdout JSON `error` 中的 provider/API 详情应进入 AI 对话错误气泡；无 JSON error 时才允许回退通用退出码。
- 对 OpenCode 启动后无 stdout/stderr 的场景，最终错误气泡应包含 OpenCode 空输出/超时诊断；hidden retry 最终失败后仍应有可见 system 错误消息。
- 回放并行 OpenCode 的 `step_start -> tool_use -> text` JSONL 时，应在对应 `tabId` 依次产生 thinking、trace、assistant 消息；完整 final text 与已流式展示文本相同时不得再追加重复 assistant 气泡。

### 关联资料
- `src/config/configService.ts`
- `src/cli/commandRunner.ts`
- `src/openCodeTabStream.ts`
- `src/test/core/openCodeTabStream.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`

## OpenCode Loop 后续轮次不能用历史回答判定当前回合成功

- 状态：有效
- 首次发现：2026-07-14
- 适用范围：OpenCode one-shot / parallel、Loop 主任务多轮复核、成功退出判定

### 现象
- Loop 子任务批次全部 completed 后，主任务确实被下一轮唤醒；OpenCode 运行约几十秒并以 `code=0` 退出，但 JSONL 只有 `step_start`、纯 thinking 和 `step_finish(reason=unknown)`，没有 assistant 正文。
- 任务随即进入 `needs-review` 并显示 `Main task did not return a valid loop decision JSON.`，看起来像主任务没有被唤醒或卡住。

### 根因
- Loop 后续轮次复用初始用户消息 ID；旧完成判定只检查“该用户消息之后是否存在任意 assistant 正文”，因此上一轮合法 `LoopMainDecision` 会把当前空响应误判为成功。
- 轮次级 JSON 解析只读取带当前 `loopTaskId + loopRound + taskRole=main` 的正文，不会读取旧轮次，于是成功判定与决策解析使用了不同时间边界。
- `code=0` 缺少当前正文的分支此前直接错误收口，没有进入非零退出已使用的 hidden retry。

### 现场判定
- 同一 provider/model 的新 session 能正常得到 `finish=stop` 和非零 input/output token；旧 session 及其 fork 都持续返回 `step_start -> step_finish(reason=unknown)`，`input=0/output=0`。因此先排除 provider/model 配置，再按会话级故障处理。
- 旧 session 现场累计约 919k input token、6.7m cache-read token；OpenCode SQLite 中 message/part JSON 有效。`opencode export` 恰在 128 KiB 截断是 CLI stdout 限制，不是持久化 JSON 损坏。
- 对 disposable fork 发送字面 `/compact` 也返回零 token；`--command compact` 只查找用户自定义 command，不是 OpenCode 原生 compact 调用，不能作为自动恢复依据。

### 长期规避
- 普通任务可继续使用当前用户消息锚点；Loop 内部回合必须只依据当前 OpenCode 进程尝试是否产生非 thinking assistant 正文。
- one-shot 与 parallel 的 `code=0` 空正文统一进入既有 hidden retry；重试耗尽后才落可见错误与任务失败记录。
- 只有已有远端 session、无 provider JSON error 的 Loop 主任务才允许一次 fresh-session retry。恢复尝试不传旧 `--session`、重发完整主任务 prompt；捕获新 `sessionID` 后保留旧 session、复制 UI 消息并用 `bindLoopTaskToSession` 移动任务记录。新 session 再次空响应不得继续 rollover。
- 可恢复的会话级空响应使用本地化 system 恢复提示，不追加看起来像最终 provider/model 配置错误的 trace；真实 provider JSON error 保持原错误展示和重试语义。
- 日志只记录 task/round、当前正文布尔值与长度、结构化终态和 stdout/stderr 长度，不记录完整模型正文或提示词。

### 验证方式
- 当 `conversationHasFinalConclusion=true`、`isLoopRun=true`、`currentAttemptHasAssistantAnswer=false` 时，`resolveOpenCodeSuccessfulExitOutcome` 必须返回 `retry`。
- 当前尝试出现非 thinking assistant 正文时返回 `complete`；重试计数达到上限后空响应返回 `fail`。
- 回放只有 `step_start` / thinking / `step_finish(reason=unknown)` 的当前轮 JSONL，即使历史会话已有合法 JSON，也不得把当前轮标记为 `end`。
- `shouldRecoverOpenCodeLoopMainSessionInFreshSession` 仅对 provider-clean、已有远端 session、未 rollover 的主任务返回 true；Loop 子任务、普通任务、provider error 和二次恢复必须返回 false。
- `bindLoopTaskToSession` 后源 task store 删除（无其他任务时），目标 session store 保留相同任务和新 `sessionId`。

### 关联资料
- `src/openCodeRunCompletion.ts`
- `src/extension.ts`
- `src/test/core/openCodeRunCompletion.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode 分组/子代理执行不能用父 JSONL 静默判断卡死

- 状态：有效
- 首次发现：2026-07-12
- 适用范围：OpenCode 1.17.18、`opencode run --format json`、分组/子代理任务、one-shot hidden retry

### 现象
- 父 `opencode run --format json` 已返回 `step_start`、assistant 文本和工具事件，之后连续 300 秒没有新的 stdout/stderr，插件报“kept returning progress”并终止本次尝试。
- 同一时间 OpenCode 自身日志仍持续记录子代理的文件读取、搜索、模型 stream 和 loop step；超时前 1 秒仍有活动，说明任务并未卡死。

### 根因
- OpenCode 分组/子代理在内部 session 中执行时，不保证把每个子代理活动实时转发到父 `run --format json` JSONL。
- 父 stdout/stderr 的静默只表示“当前没有父事件”，不能作为整个 OpenCode 任务的可靠心跳。固定 5 分钟活跃空闲超时会误杀正常长任务，并错误触发 hidden retry。

### 长期规避
- 只保留 60 秒启动 watchdog，用于识别进程启动后完全没有 assistant / error / status / progress 的配置或启动异常。
- 首个有效事件到达后立即解除外层 watchdog；后续生命周期只由 CLI exit/error、用户停止和扩展进程管理收口，不再根据父 JSONL 静默时长自动杀进程。
- 不通过读取 OpenCode 私有数据库或日志文件来补造心跳。OpenCode 1.18.32 在 provider 返回前没有 stdout JSON，插件只追加官方 `--print-logs`，把 CLI 写到 stderr 的 `timestamp=... level=` 行当作启动活动，并且不把它显示成 trace。

### 验证方式
- `resolveOpenCodeOneShotWatchdogTimeoutMs(false)` 返回 60 秒，传入已检测到的 `step_start`/progress 活动后返回 `null`。
- 回放包含首个 JSONL 活动、随后超过 5 分钟父流静默的分组任务时，不应再出现 `runPrompt-one-shot-idle-timeout`，任务应继续等待 OpenCode 自身退出或用户停止。
- 启动后 60 秒完全没有 stdout/stderr 的场景仍应进入 hidden retry，并保留可见 system 错误消息与日志。
- OpenCode 1.18.32 的真实任务可能在 60 秒后才写出第一条 stdout JSON。`--print-logs` 日志必须算 progress 并解除 watchdog，不能把这种静默误判成启动失败；最终 provider 错误仍以 stdout JSON `error` 为准。


### 关联资料
- `src/cli/opencodewatchdog.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode `UnknownError` 要保留 server ref

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode `opencode run --format json`、自定义 OpenAI-compatible provider、hidden retry 错误展示

### 现象
- OpenCode stdout JSON 返回 `{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_xxx"}}}`。
- 用户侧如果只看到通用退出码或只看到 `Unexpected server error`，无法把插件日志、OpenCode server 日志和 provider 侧请求串起来。

### 触发条件
- Provider/server 返回 OpenCode JSON error，但 stderr 为空、退出码为 1。
- hidden retry 已经记录 provider error 后，用户在下一次重试等待期间点击停止。

### 根因
- OpenCode 把部分 provider/server 失败写入 stdout JSON `error.data.ref`，这个 ref 是继续查 server 日志的关键线索。
- 停止动作是本地运行控制事件，不能反向覆盖或伪造成 provider 错误。

### 长期规避
- 非零退出时优先解析 stdout JSON `error`，错误气泡必须保留 `error.name`、`data.message`、`data.ref`，并继续保留可用的 `statusCode`、`metadata.url`、`responseBody`。
- 用户在 hidden retry 等待期间点击停止时，只记录为本地 stopRun，不要把停止动作误判成 provider `UnknownError`；已经落入 stdout 的 provider error 仍留在 OpenCode 日志用于诊断。
- 当前配置排查时只摘要 provider、model、baseURL host，不输出 `apiKey`。

### 验证方式
- `parseOpenCodeRunOutput` 覆盖 `UnknownError` / `Unexpected server error` / `ref`，`buildOpenCodeRunFailureMessage` 不应回退到 `CLI exit code`。
- AI 对话层最终 system message 应包含 `UnknownError`、provider message 和 `err_xxx`；空 stdout/stderr 仍应有可见 fallback 错误；`stopRun` 不应创建 provider 错误。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `src/test/session/sessionMessageActions.test.ts`

## OpenCode 自定义 provider 不能传裸 `--model`

- 状态：有效
- 首次发现：2026-07-09
- 适用范围：OpenCode `opencode run --format json`、自定义 OpenAI-compatible provider、UI 托管模型选择

### 现象
- `~/.opencode/config.json` 顶层 `model` 为 `myAPI/gpt-5.5` 时，终端直接运行默认 `opencode run --format json` 能成功，显式 `--model myAPI/gpt-5.5` 也能成功。
- 插件如果传 `opencode run --format json --model gpt-5.5 ...`，OpenCode 会绕开 provider-qualified 默认配置，返回 `UnknownError / Unexpected server error / err_xxx`。

### 触发条件
- OpenCode 配置使用自定义 provider，且 provider id 不是官方内置模型前缀。
- UI 或 managed model store 保存的是 provider 内部裸模型 key，例如 `gpt-5.5`。

### 根因
- OpenCode CLI 层使用 `provider/model` 选择 provider；本地 OpenAI-compatible endpoint 自身可能接受裸模型 `gpt-5.5`，但这不等于 OpenCode CLI 的 `--model gpt-5.5` 可定位到自定义 provider。
- Codex 能跑通是因为 Codex 走自己的 CLI/配置和模型选择逻辑，不复用 OpenCode 的 provider-qualified model 规则。

### 长期规避
- OpenCode 运行前应基于已生效 `config.json` 顶层 `model=provider/model` 和 `provider.<id>.models` 规范化 UI 选择：裸模型存在于 active provider 时传 `provider/model`。
- 裸模型不在 active provider 的 `models` 中时，应显示配置/模型不匹配诊断，不能把裸模型继续传给 `opencode run --model`。
- 不要把 `provider/model` 直接拿去调用底层 OpenAI-compatible endpoint；该写法只属于 OpenCode CLI provider 选择层。

### 验证方式
- `buildCliArgs("opencode", { model: "gpt-5.5", openCodeConfigContent }, "hello")` 应生成 `--model myAPI/gpt-5.5`。
- provider-qualified `myAPI/gpt-5.5` 应保持不变。
- 不在 active provider models 中的裸 `glm-5.2` 应产生可诊断错误，不应被错误映射或传入 OpenCode。

### 关联资料
- `src/cli/modelArgs.ts`
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode 推理力度不能按 adapter 或模型名猜测

- 状态：已规避
- 首次发现：2026-07-10
- 适用范围：OpenCode 模型选择、PanelState、`opencode run` 参数、配置切换

### 现象
- 同为 `@ai-sdk/openai-compatible` 的模型可能有不同 variants，也可能完全没有可调档位；把 OpenCode 固定显示为 low/high 会展示无效选项。
- 把 `--thinking` 或 `thinkingArgs.opencode.*` 当成推理力度会与 OpenCode 官方语义不一致；配置/模型切换后复用旧选择还会把无效 `--variant` 传给新模型。

### 触发条件
- 仅根据 provider `npm`、provider 名或模型名推断能力。
- PanelState 只增量更新 options，没有在 CLI、配置或模型变化时发送完整 Default-only 快照。
- 持久化键未包含 active config id 和精确 `provider/model`，或运行时未重新校验选择是否属于当前 options。

### 根因
- OpenCode 的 variant 集合由精确模型 metadata、模型版本和用户显式配置共同决定，adapter 只是协议层输入，不能证明后端接受哪些推理参数。
- `--thinking` 控制 thinking blocks 展示；实际力度参数是 `--variant <name>`，且不传 variant 才表示跟随 OpenCode 默认。

### 长期规避
- 优先读取 `opencode models <provider> --verbose` 的精确模型 metadata；失败时仅回退当前激活配置显式 variants，再失败则 Default-only。
- 能力身份至少包含命令/version、active config id、配置内容 hash、provider 和 model；异步结果应用前校验请求序号和完整身份。
- 选择按配置和精确模型隔离；null 删除持久值，失效选择自动清理。运行时只传当前有效非空值，且用户显式 `--variant` 优先。
- 不恢复固定 `thinkingModeOpencode` 或 `thinkingArgs.opencode.*`；不得从 legacy ThinkingMode 迁移或映射成 variant。

### 验证方式
- 覆盖 CLI metadata 优先、配置 variants 回退、未知模型 Default-only、配置/模型隔离、失效清理和异步竞态。
- 覆盖 Default 不传 `--variant`、有效值追加、`--variant value` / `--variant=value` 显式参数优先，以及 Codex / Claude 原行为。
- 脱敏 smoke 只使用 `opencode models <provider> --verbose` 实际返回的 variant；返回空 variants 时验证命令不带 `--variant`，不得臆造档位。

### 关联资料
- `src/cli/openCodeModelCapabilities.ts`
- `src/modelSelectionStore.ts`
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## OpenCode `--auto` 不能写成“禁用权限系统”

- 状态：有效
- 首次发现：2026-07-10
- 适用范围：OpenCode 1.17.16、`src/cli/commandRunner.ts`、普通消息与 Loop 任务执行

### 现象
- 加入 `opencode --auto` 或 `opencode run --auto` 后，默认 `external_directory: ask` 的跨目录读写可以自动执行，容易被误写成“完全跳过权限”或“禁用权限系统”。
- 当用户配置、agent 配置或 OpenCode 默认规则显式拒绝某项权限时，请求仍会被阻止；例如 `.env` 等文件的显式 `read: deny` 保护不会被 `--auto` 绕过。

### 触发条件
- 把 OpenCode `--auto` 直接类比为 Claude `--dangerously-skip-permissions` 或 Codex `--dangerously-bypass-approvals-and-sandbox`，但没有核对 OpenCode 的 `ask` / `allow` / `deny` 语义。
- 为了“全部目录可读写”而在 runtime overlay 中无条件写入全局 `permission: "allow"`，覆盖用户已有的显式拒绝规则。

### 根因
- OpenCode `--auto` 的官方语义是自动批准**未被显式拒绝**的权限请求；它处理的是 `ask`，不是把 `deny` 改成 `allow`。
- `external_directory` 默认通常为 `ask`，所以 `--auto` 足以覆盖默认跨目录请求；但用户级、agent 级和内置显式拒绝仍属于独立安全边界。

### 长期规避
- 文档、UI 和代码注释统一使用“自动批准未被显式拒绝的请求”，不得写成“关闭权限”“绕过所有权限”或“所有文件无条件可读写”。
- 插件只在共享参数构建器集中注入并去重 `--auto`；runtime overlay 保留用户 `permission`，不得静默覆盖显式 `deny`。
- 若未来产品确需覆盖某一权限，只允许基于明确需求做最小范围规则（例如单独处理 `external_directory`），并单独评审安全影响；禁止顺带移除 `.env` 等保护。

### 验证方式
- 默认配置下，以工作目录 A 运行 `opencode run --auto`，验证可以读取并写入外部目录 B。
- 显式设置 `external_directory: deny` 后重复测试，确认请求被阻止；对 `.env` 等显式拒绝文件确认仍不可读取。
- 回归检查普通消息、并行任务、Loop 主任务/子任务与无 prompt 终端启动都只包含一次 `--auto`。

### 关联资料
- `src/cli/commandRunner.ts`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`

## 配置中心不再安装或卸载 OpenCode MCP

- 状态：已下线。配置中心不再安装或卸载 MCP。模型档案 `~/.opencode/config.json` 不是官方全局 MCP 文件 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json`。CodeGraph 只读取用户磁盘上已有的 MCP 配置，不写回。

## npx 缓存损坏会把可用 MCP 误报为健康检查超时

- 状态：已确认，需在 MCP 排障时优先排除
- 首次发现：2026-07-11
- 适用范围：Claude/Codex/OpenCode 通过 `npx -y` 启动的 stdio MCP，尤其是 Context7 等频繁更新的 npm 包

### 现象
- `claude mcp list` 的健康检查出现单个 MCP 连接失败或超时。
- 直接执行对应 `npx -y <package>` 可能报 `ENOTEMPTY: directory not empty, rename .../.<package>-*`。
- MCP 包本身在 npm 或官方 Registry 中仍然存在，且删除损坏缓存后健康检查恢复。

### 触发条件
- `~/.npm/_npx/<hash>/node_modules/<scope>/<package>` 下同时存在旧包目录和 npm 临时 rename 目录。
- 上一次 `npx` 安装或更新被中断，留下半更新状态。

### 根因
- npm 在 `_npx` 缓存目录中更新包时需要 rename 临时目录；残留目录导致 rename 失败。
- 健康检查只看到 MCP 进程未按时完成初始化，容易误判为 MCP 服务或配置已经失效。

### 长期规避
- 对 `npx -y` MCP 的单点失败先运行对应 `npx -y <package> --help` 或等价启动探针。
- 如果看到 `ENOTEMPTY` / `rename`，删除对应 `~/.npm/_npx/<hash>` 损坏缓存目录后复测。
- 只有 npm/PyPI/官方 Registry 或供应商官方文档确认包名/端点失效时，才从用户自己的全局 MCP 配置删除。

### 验证方式
- 清理损坏 `_npx` 目录后重新运行 `claude mcp list`，确认失败项变为 `Connected`。

## TypeScript 构建不会自动删除已移除源码对应的 dist 产物

- 状态：已规避
- 首次发现：2026-07-11
- 适用范围：`npm run build`、`node --test dist/test/*.test.js`、已删除或重命名的 `src/test/*.ts`

### 现象
- 仓库根目录出现多个未跟踪的 `.tmp-loop-launch-*` 空目录。
- 当前源码已没有 `loopBoundaryRecord.test.ts`，但 `dist/test/loopBoundaryRecord.test.js` 仍存在并可被全量 `node --test dist/test/*.test.js` 执行。
- 旧测试使用 `fs.mkdtempSync(path.join(process.cwd(), ".tmp-loop-launch-"))`，测试进程异常退出或被中止时会把空目录留在仓库根目录。

### 触发条件
- 测试源码被删除或重命名后，只运行 `tsc -p ./` 增量覆盖输出，不先清理 `dist`。
- 后续直接按 `dist/test/*.test.js` 跑全量测试，导致陈旧 JS 测试产物继续参与执行。
- 测试 helper 把临时目录建在 `process.cwd()` 下，而不是系统临时目录；进程未进入 `finally` 清理路径时就会污染仓库根目录。

### 根因
- `tsc` 不负责删除 `outDir` 里已经没有源文件对应的旧输出。
- 旧 `dist/test/loopBoundaryRecord.test.js` 保留了仓库根目录临时目录创建逻辑。

### 长期规避
- `npm run build` 必须先清理 `dist`，再执行 `tsc -p ./`。
- 新增测试临时目录默认使用 `os.tmpdir()`；如确需建在仓库内，目录前缀必须加入 `.gitignore`，并确保异常路径可清理。
- 发现无对应 `src/test` 的 `dist/test/*.test.js` 时，优先清理 `dist` 后重建，不要按旧产物继续解释失败。

### 验证方式
- 运行 `npm run build` 后确认 `dist/test/loopBoundaryRecord.test.js` 不再存在。
- 运行 `find . -maxdepth 1 -type d -name '.tmp-loop-launch-*'`，确认仓库根目录没有残留临时目录。

### 关联资料
- `package.json`
- `.gitignore`
- `dist/test/loopBoundaryRecord.test.js`（已清理的历史生成物）

## Loop `running` 状态不能脱离当前运行所有权永久锁定 Tab

- 状态：已规避
- 首次发现：2026-07-13
- 适用范围：Loop 主任务 conversation tab、关闭 Tab、重置当前会话、任务队列、Extension Host 异常或重载后的任务记录

### 现象

- 任务 tab 已不再有主任务、子任务、裁判或参与者 CLI 进程，但任务记录仍为 `running`，关闭和重置会被静默拒绝。
- 任务记录已经是 `needs-review`、`error` 或 `stopped`，群聊已经显示“任务已中断，需要人工复核或继续”，但尚未异步退出的旧编排所有权仍让主 Tab 显示执行中。
- 旧 Webview 在重置请求发出时先清空本地消息；扩展端随后因同一锁定条件拒绝操作，用户切回原 tab 后又看到原会话，形成“重置无效”的假成功体验。

### 触发条件与根因

- Loop 的持久化 `running` 状态原本用于保护主任务与子任务、裁判主持人与参与者之间没有单个 CLI 进程的编排空档。
- 如果编排路径出现未捕获异常，或 Extension Host 已不再拥有该任务的执行上下文，记录没有被写入 `error` / `stopped`，仅用持久化状态判断会把残留记录永久视为运行中。
- 如果运行所有权能覆盖明确中断终态，或者所有权只用任务 ID Set 表示，终止后立即恢复会出现两类竞态：旧运行仍显示执行中；旧运行的 `finally` 删除同一 task ID 时误删新恢复运行的所有权。子任务处于重试等待期时，缺少派发前终态门禁还会在等待结束后把 stopped 任务重新写回 `running`。
- 前端乐观清空会话并不能证明“新建空白 Tab + 关闭旧 Tab”已经在扩展端成功完成；前后端锁定状态短暂不同步时会放大这个问题。

### 长期规避

- 运行态必须由持久化任务状态和当前 Extension Host 的运行所有权共同判定。`runLoopPrompt` 从任务创建/恢复到收尾期间通过 `loopOrchestrationOwnership` 引用计数维护所有权，并与主、并行和交互 CLI 运行集合合并；`status=running` 且存在所有权时仍要保护编排空档，每个运行只能释放自己的句柄。
- `needs-review`、`error`、`stopped` 是明确中断终态，必须优先于残留所有权结束视觉运行态和关闭锁；每次主轮次、子任务轮次和重试派发前重新读取 Store，发现中断终态立即返回，禁止复活任务。
- 任务记录为 `running` 但没有任何当前运行所有权时，收敛为 `stopped`，清空活跃子任务 ID，并把仍为 `pending` / `running` 的子任务和辩论参与者写入终态；不要继续保留关闭锁。
- `runLoopPrompt` 的未捕获异常必须把仍为 `running` 的任务写成 `error`，然后再释放运行所有权。
- 重置当前会话只能由扩展端成功完成新建空白 Tab、关闭旧 Tab 后通过 PanelState 和 `setMessages` 更新 Webview；请求发送前不得清空旧 Tab 消息或强制切换交互模式。编辑器上下文的下一次提示意图可以保留，但不能替代成功确认。

### 验证方式

- 构造 `status="running"` 且运行所有权集合为空的任务，确认状态收敛为 `stopped`，主任务 Tab 解除关闭和重置锁；同一任务存在主/并行/交互运行或编排所有权时仍保持锁定。
- 构造 `status="stopped" / "error" / "needs-review"` 且仍有旧所有权的任务，确认不再显示运行中；同一 task ID 先后获取两份所有权，释放旧句柄后新句柄仍存在。
- 断言 SessionTabs 在运行态判定后再读取任务状态，避免本轮已经收敛为 `stopped` 却把旧 `running` 回传给 Webview。
- 断言 Webview 的重置请求只发送消息并保留旧视图，Extension Host 拒绝时不会出现空白会话；成功时由回推状态切换到空白 Tab。
- 运行 `npm run build && node --test dist/test/session/conversationTabLock.test.js dist/test/loop/loopDebate.test.js dist/test/loop/loopOrchestrationOwnership.test.js dist/test/session/sessionMessageActions.test.js`。

### 关联资料

- `src/extension.ts`
- `src/loopDebate.ts`
- `src/loopOrchestrationOwnership.ts`
- `src/sessionTabs.ts`
- `src/webview/viewContentScript/eventBindings.ts`
- `src/test/session/conversationTabLock.test.ts`
- `src/test/loop/loopDebate.test.ts`

## Loop 编排角色不能复用为模型角色

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：Loop Webview、模型持久化、`sendPrompt`、主从执行、红蓝辩论、续跑与自动唤醒

### 现象
- Codex Loop 同时展示“主任务模型 / 子任务模型”，同一任务不同角色可能收到不同模型。
- Claude 明明不支持插件侧模型选择，Loop 区域仍容易被通用模型 UI 逻辑误伤。
- OpenCode 的 `small_model` 容易被误解为 Loop 子任务模型，进而错误删除或映射。

### 根因
- 把 Loop 的主任务、子任务、裁判主持人、参与者等编排角色，错误建模成通用模型角色。
- OpenCode primary/small 是 CLI 自身能力，与 Loop 主从编排无直接对应关系。

### 长期规避
- Claude 在 Coding/Loop 均不展示插件侧模型选择。
- Codex 在 Coding/Loop 复用同一个模型下拉，消息只传 `model`；普通轮次、子任务、裁判、参与者、共识汇总、续跑和唤醒全部沿用该值。
- OpenCode 在 Coding/Loop 均保留 primary/small 和各自思考力度；所有 Loop 对话角色使用 effective primary，small 只用于 OpenCode 内部请求。
- 历史 `selectedLoopByConfigId` / `loopRolesByConfigId` 可以继续归一化读取，避免旧文件崩溃，但不得进入 PanelState、Webview payload 或运行时选择。

### 验证方式
- Webview 覆盖 OpenCode 双模型、Codex 单模型、Claude 无模型三种 Coding/Loop 组合。
- 用带旧 `loopMainModel` / `loopSubtaskModel` 的兼容消息回放，确认运行输入只保留统一 `model`。
- 构造包含旧主/子选择的模型存储，确认 PanelState 只暴露通用 Codex 选择。

### 关联资料
- `src/webview/viewContentScript/modelManager.ts`
- `src/sessionMessageActions.ts`
- `src/extension.ts`
- `src/loopDebateRunner.ts`
- `src/test/webview/opencodedualmodelwebview.test.ts`
- `src/test/session/sessionMessageActions.test.ts`

## 内部思考 wrapper 不能用通用 HTML 清洗

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：OpenCode JSONL text/reasoning、Codex reasoning、历史消息清洗

### 现象
- OpenCode `text` 事件可能直接返回 `<thinking>...</thinking>`，标签会原样显示在气泡中；同一事件还可能在思考块后继续包含可见正文。
- 如果简单删除所有尖括号内容，会破坏用户问题、代码片段和普通 `<div>` 等合法内容。

### 根因
- 外部 CLI 的内部思考协议与 assistant 正文共用 text 通道，旧解析器把整段都当作可见 assistant 文本。
- 通用 HTML sanitizer 无法区分协议 wrapper 与用户内容。

### 长期规避
- 只识别 `<thinking>`、`<think>`、`<analysis>`、`<reasoning>` 四类 wrapper，大小写不敏感。
- OpenCode 混合 text 按原顺序拆成 thinking 与 assistant；最终答复只收集 assistant 段。
- reasoning、Codex thinking 和历史消息只去除 wrapper 标签，不删除普通 HTML 或代码标签。

### 验证方式
- 回放 `~/.sinitek_cli/logs/sinitek-cli.opencode.2026-07-12.log` 中的 `<thinking>Mapping Codex loop model controls and execution flow</thinking>` 样本，确认可见文本无尖括号 wrapper。
- 覆盖混合思考+正文、纯思考、历史消息修复和普通 `<div>` 保留。

### 关联资料
- `src/thinkingMarkup.ts`
- `src/cli/commandRunner.ts`
- `src/codexReasoningContent.ts`
- `src/sessionStore.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `src/test/core/codexReasoningContent.test.ts`

## OpenCode 最终回复不能只靠 `[final_answer]` 文本标记识别

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：OpenCode `run --format json`、固定严格最终答复协议、one-shot / 并行 conversation tab

### 现象
- OpenCode 已返回非空助手答复并正常退出，界面仍追加“正文未包含 `[final_answer]`，严格最终答复判定拒绝”的 system 错误和任务失败气泡。
- 真实会话 `ses_0aaa0f435ffenK9Zu7ID3cpsL3` 的最终助手消息是在等待用户选择项目序号；OpenCode 导出显示该消息 `finish="stop"`，对应 parts 同时包含非空 `text` 与 `step-finish reason="stop"`。

### 触发条件
- 普通 OpenCode 任务使用固定严格最终答复协议。
- OpenCode 返回面向用户的最终回复，但没有遵循插件追加的 `[final_answer]` 文本约定。
- 运行时只检查正文标记，没有消费 OpenCode 自带的结构化终态。

### 根因
- 严格策略设计允许“结构化 final 或文本标记”，但实现只接入了 Codex `phase="final_answer"`，遗漏了 OpenCode JSONL 的 `step_finish.reason="stop"`。
- 单独看到 `text` 不能证明它是最终回复，因为 OpenCode 在 `tool-calls` 阶段也可能输出过程文本；单独看到 `stop` 也不能证明存在可见答案。

### 长期规避
- 解析 OpenCode JSONL 时按 `messageID` 关联非 thinking assistant `text` 与 `step_finish.reason="stop"`，二者属于同一消息才视为结构化最终答复。
- `step_finish.reason="tool-calls"`、跨 message ID 的正文与终态、无正文 `stop`、thinking-only 文本继续拒绝，不得根据问号或“请回复”等自然语言猜测终态。
- one-shot 与并行 tab 的成功退出路径必须传入同一个结构化终态信号，避免两条链路行为漂移。

### 验证方式
- 构造同 message ID 的 `text` + `step_finish reason="stop"`，确认严格策略成功收口。
- 构造 `tool-calls`、跨 message ID 和无正文 `stop`，确认均不产生结构化最终答复信号。
- 运行 `npm run build && node --test dist/test/cli/opencodeCommandRunner.test.js dist/test/core/finalConclusion.test.js`。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`

## Loop 子任务不能在用户可见回复中直接提问

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：Loop 主从执行、子任务沟通文件、独立子任务 conversation tab

### 现象
- 子任务遇到需求不明、授权不足或依赖冲突时停止推进，却直接在 assistant 气泡里向用户提问。
- 主任务虽然会读取子任务沟通文件，但文件没有固定的待确认结构，难以稳定区分普通遗留问题与必须确认的阻塞事项。

### 触发条件
- 子任务提示词只要求结束前写执行报告，没有明确规定“有疑问立即结束”和“不得向用户提问”。
- 子任务运行在独立可见标签页，assistant 输出会正常形成气泡，因此任何直接提问都会绕过主任务统一复核。

### 根因
- 主从协议缺少疑问转交契约：没有定义触发边界、沟通文件字段、任务记录收口方式和唯一允许的最终回复。
- 现有 `end -> completed -> 唤醒主任务` 已能完成交接，问题不在调度状态，而在模型职责约束不足。

### 长期规避
- 仅当问题必须由主任务或用户确认后才能安全继续时，子任务立即停止；能依据现有事实和仓库规则判断的问题仍应自行处理。
- 待确认内容只写入沟通文件的 `## 待主任务确认`，至少包含问题、已知事实、影响/阻塞步骤、选项和推荐方案。
- 子任务按 completed 正常收口并使用固定中性 assistant 文本，不提问、不复述问题、不等待回复；主任务读取后自行决策，确需人工确认时走 blocked。
- 不使用问号、疑问词等启发式隐藏或替换流式消息，避免误伤正常技术说明和已经可见的子任务 assistant 气泡。

### 验证方式
- 断言子任务 model prompt 同时包含触发条件、沟通章节、任务记录更新、禁止提问和固定收口文本。
- 断言主任务 model prompt 必须处理待确认章节，并在确需人工确认时返回 blocked。
- 新建子任务沟通文件，确认默认包含状态为“无”的结构化 `## 待主任务确认` 章节。
- 运行 `npm run build && node --test dist/test/loopSkillIntegration.test.js dist/test/loop/loopTaskStore.test.js`。

### 关联资料
- `src/extension.ts`
- `src/loopTaskStore.ts`
- `src/test/loopSkillIntegration.test.ts`
- `src/test/loop/loopTaskStore.test.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## Loop 子任务手动恢复必须复用自动重试的完成收尾

- 状态：已规避
- 首次发现：2026-07-13
- 适用范围：Loop 主从子任务、子任务 Tab、自动重试、用户手动恢复和主任务自动唤醒

### 现象
- 子任务在运行中被用户中止后，用户在该子任务 Tab 手动继续并成功完成，主任务可以被唤醒，但子任务 Tab 没有按统一成功收尾自动关闭。
- 相同子任务因执行错误触发自动重试并成功时，状态、Tab 关闭和主任务后续编排均正常，导致两种恢复方式的体验和资源清理不一致。

### 根因
- 自动重试在 `runLoopSubtaskWithRetry` 中直接执行子任务状态收尾和 Tab 自动关闭。
- 手动恢复在 `maybeWakeLoopMainAfterSubtaskContinuation` 中单独更新状态并唤醒主任务，遗漏了同一 Tab 生命周期收尾。

### 长期规避
- 自动重试和手动恢复成功都必须调用同一个子任务完成生命周期函数；先更新子任务记录和沟通记录，再固定关闭成功结束的子任务 Tab。
- 只在 `TaskRunStatus === "end"` 且存在目标 Tab 时关闭子任务 Tab；错误、停止或未找到目标 Tab 时不得关闭。这条规则只覆盖经典 Loop 的 `finalizeLoopSubtaskRun`，不覆盖 Loop+ 主任务中止已启动 attempt 后关闭该 Tab。
- 主任务是否继续仍由既有可恢复状态和主任务连续 AI 失败上限决定；Tab 收尾不得绕过或放宽这些守卫。

### 验证方式
- 单测覆盖成功结束时的状态更新先于 Tab 关闭、成功但无目标 Tab、错误/停止不关闭三种边界。
- 断言 `runLoopSubtaskWithRetry` 与 `maybeWakeLoopMainAfterSubtaskContinuation` 都接入共享收尾函数，且既有手动子任务 coding 路由仍会调用恢复唤醒。
- 运行 `npm run build && node --test dist/test/loop/loopSubtaskLifecycle.test.js dist/test/session/sessionMessageActions.test.js`。

### 关联资料
- `src/loopSubtaskLifecycle.ts`
- `src/extension.ts`
- `src/test/loop/loopSubtaskLifecycle.test.ts`
- `src/test/session/sessionMessageActions.test.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## OpenCode 的 spawn cwd 正确但会话仍可能落到 `/`

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：OpenCode 1.17.18、VS Code extension host、`opencode run` one-shot / 并行 / Loop 路径

### 现象
- 插件 `cli-startup` 日志中的 cwd 是目标项目，但 OpenCode export 与数据库中的 session `directory`、assistant `path.cwd/root` 都是 `/`，`projectID` 为 `global`。
- 模型从文件系统根目录搜索，可能找到多个包含相同相对目录的仓库，并要求用户重新选择当前项目。

### 触发条件
- VS Code extension host 的环境变量继承了 `PWD=/`。
- child process 只通过 spawn option 设置正确 cwd，但继续原样继承旧 `PWD`。
- 使用 OpenCode `run` 创建或续接任务；普通 `debug info` 不一定暴露该问题。

### 根因
- OpenCode `run` 先按真实进程 cwd 创建 CLI 实例，随后其内部请求还会读取 `PWD` 解析工作目录。
- 当真实 cwd 是项目、`PWD` 却是 `/` 时，同一 OpenCode 进程会先记录项目实例，再创建一个根目录实例；新会话最终绑定到 `/`。
- 这不是 child process 忽略 spawn cwd，也不是插件 workspace key 本身丢失，因此只检查插件 cwd 日志会得到误导性结论。

### 长期规避
- 所有带 cwd 的 CLI child process 环境都应把 `PWD` 最后收敛为同一路径，调用方 env override 和 runtime overlay 不得再次覆盖它。
- OpenCode 并行启动日志必须包含 cwd，排查时同时核对插件日志、OpenCode `creating instance/fromDirectory` 日志和 session export 的 `directory/path`。
- 不通过直接修改 OpenCode 数据库修复历史会话；保证后续实际进程 cwd/PWD 正确，必要时新建底层会话。

### 验证方式
- 使用 mock child 同时记录 `process.cwd()` 与 `process.env.PWD`，传入错误 `PWD=/` 后断言两者仍等于目标 workspace cwd。
- 可在隔离 HOME/XDG 目录中用 OpenCode 1.17.18 和无效模型复现：stale `PWD=/` 会出现第二个 `directory=/` 实例，同步 `PWD` 后只创建目标项目实例。
- 运行 `npm run build && node --test dist/test/cli/opencodeCommandRunner.test.js`。

### 关联资料
- `src/cli/commandRunner.ts`
- `src/extension.ts`
- `src/test/cli/opencodeCommandRunner.test.ts`
- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/exec-plans/completed/2026-07/2026-07-12-opencode-workspace-cwd.md`

## 历史：已移除的 Loop Workflow Skill 根分类

- 状态：已于 2026-07-15 下线。不再加载或注入内置 Workflow Skills，旧兼容字段不触发加载。

## 历史：已移除的 Loop Workflow Skill 选择

- 状态：已于 2026-07-15 下线。不再加载或注入内置 Workflow Skills，旧兼容字段不触发加载。

## 历史：已移除的 Loop Workflow Skill 红蓝共识与自动重试

- 状态：已于 2026-07-15 下线。不再加载或注入内置 Workflow Skills，旧兼容字段不触发加载。

## OpenCode 已解析 `todowrite` 但任务浮层仍可能被消息刷新覆盖

- 状态：已规避
- 首次发现：2026-07-12
- 适用范围：OpenCode one-shot、并行 tab、Loop 子任务、Webview 重载与会话消息刷新

### 现象
- `~/.sinitek_cli/logs/sinitek-cli.opencode.*.log` 中能看到完整 `tool_use/todowrite` 和 `state.input.todos`，工具 trace 也可能已经出现，但任务列表浮层没有显示或在切换/刷新后消失。
- 只验证 OpenCode JSONL 解析器会得到“任务已识别”的假阳性，不能证明对应 tab 的 Webview 浮层真正收到并保留了列表。

### 触发条件
- 任务列表和工具 trace 使用两条独立 Webview 消息，专用任务消息丢失、Webview 重建或 tab 刷新时没有回放来源。
- `setMessagesForTab` 在运行中无条件重置 task-list runtime state，而 OpenCode 的 `todowrite` 更新通常比 Codex 稀疏，清空后可能长时间没有下一条事件补回。

### 根因
- 任务解析、tab 定向消息和浮层状态原先只有分层单测，没有覆盖“真实工具事件 -> trace/message -> Webview task-list DOM”的完整可见链路。
- external 任务列表被当作可由历史 assistant 文本重新推导的自动列表处理，但 OpenCode 明细只存在于结构化工具事件，普通消息刷新无法重建。

### 长期规避
- 保留 `taskListUpdate` 主通道，同时让同一 `traceSegment` 携带 `taskListItems`，只要对应 tool trace 能送达，活动 tab 就能原子恢复浮层。
- 扩展宿主按 tab 缓存仍在运行的最新 OpenCode 列表；panel state 重建后定向重放，运行结束时立即释放。
- Webview 的 `setMessagesForTab` 仅在 tab 空闲或列表不是 external 来源时重置任务状态；`runStatus` 完成路径继续负责关闭浮层。
- 记录 `opencode-task-list-forwarded` 调试日志，现场至少核对 `source`、`tabId`、`itemCount`、`completedCount`，不要只看原始 CLI 日志。

### 验证方式
- 使用真实 `part.state.input.todos` 形状确认 parser 同时产出 tool trace 与 `{ text, done }[]`。
- 断言专用任务消息和 trace 元数据都调用同一 Webview 更新函数，并实际检查 panel display、details open、任务数量和完成状态。
- 在 external 列表显示期间模拟运行中的 `setMessagesForTab`，确认列表保留；将 tab 切为空闲后再次刷新，确认列表按既有规则清空。
- 执行 `node --test dist/test/cli/openCodeTaskList.test.js dist/test/core/openCodeTabStream.test.js dist/test/webview/openCodeTaskListOverlay.test.js dist/test/cli/opencodeCommandRunner.test.js`。

### 关联资料
- `src/cli/openCodeTaskList.ts`
- `src/openCodeTabStream.ts`
- `src/extension.ts`
- `src/webview/viewContentScript/taskListAndUi.ts`
- `src/webview/viewContentScript/coreRuntimeState.ts`
- `src/webview/viewContentScript/traceRendering.ts`
- `src/test/webview/openCodeTaskListOverlay.test.ts`

## 产品改名不能只机械替换持久化键和本地目录

- 状态：已规避
- 首次发现：2026-07-14
- 适用范围：Loop 任务存储、通信 artifact、设置、模型选择、任务运行记录、会话消息与公开命令

### 现象
- UI 已经显示 Loop，但新旧版本分别使用 `loop-*` 与 `lobster-*` 目录，直接改常量会让历史任务从列表消失、沟通 artifact 断链。
- TypeScript 全量改名仍可顺利编译，但旧 JSON 中的 `lobsterTaskId`、模式值、设置键和模型字段不会自动变成新的 `loop*` 字段。

### 触发条件
- 只做标识符、文件名和字符串的全仓替换，没有先枚举所有 JSON/本地文件读取边界。
- 只让新路径可写，没有在任务列表、恢复和清理之前迁移旧任务存储与通信树。
- 删除旧公开命令 ID，导致用户已有快捷键或外部调用失效。

### 根因
- 本地目录、JSON key、枚举值和命令 ID 都是跨版本契约，不是纯内部实现名。
- 编译器只能验证新源码内部一致，无法证明历史磁盘数据仍能被发现和规范化。

### 长期规避
- 新写入统一使用 Loop；旧 Lobster 字面量只集中在 `src/loopLegacyMigration.ts` 和迁移事实文档，不允许散回业务模块。
- 读取 JSON 时先递归迁移旧前缀键，新键与旧键同时存在时始终以新键为准；仅对已知协议值迁移旧模式与群聊动作，不改写用户正文。
- 首次枚举任务时先迁移通信目录，再按 workspace、CLI、session 将旧任务写入新 Store；目标冲突时保留 `.pre-loop-migration` artifact，验证新记录可读后才删除旧 Store 文件。
- 新命令进入 `package.json` 和命令面板，旧命令只在运行时注册隐藏别名。

### 验证方式
- 构造旧目录、旧 Store、旧通信文件和旧 JSON 字段，执行迁移后确认新路径存在、旧路径消失、任务可恢复且新写回不再包含旧键。
- 扫描全仓旧术语，结果只允许命中集中兼容模块与说明迁移边界的事实文档。
- 执行 `npm run build` 和 `node --test dist/test/loop/loopLegacyMigration.test.js dist/test/loop/loopTaskStore.test.js dist/test/core/toolSettings.test.js dist/test/core/workspaceSettingsStore.test.js dist/test/extensionHost/opencoderolemodelruntime.test.js dist/test/core/codexReasoningContent.test.js`。

### 关联资料
- `src/loopLegacyMigration.ts`
- `src/loopTaskStore.ts`
- `src/test/loop/loopLegacyMigration.test.ts`
- `src/test/loop/loopTaskStore.test.ts`
- `.ch/docs/exec-plans/completed/2026-07/2026-07-14-loop-naming-migration.md`

## 计费终态错误不能进入隐藏重试或充当恢复进度

- 状态：已规避
- 首次发现：2026-07-14
- 适用范围：Codex app-server 可见错误、通用 hidden retry、one-shot / 并行 / 交互运行

### 现象
- LLM proxy 返回 `402 Payment Required: model pool ... requires 1 points, remaining 0` 后，插件不断重试；界面长期停在 `1/5`，不会推进到 `2/5` 或耗尽上限。
- 同一故障在四个会话约十分钟内排队 110 次，日志反复出现 `failedAttempt=2`、`nextAttempt=3`、`retryCount=1`。

### 触发条件
- provider 返回 HTTP 402、Payment Required 或明确余额/积分耗尽。
- Codex Runner 先把错误文本通过普通 trace 展示，随后以失败结束回合。
- 外层交互重试把所有非 thinking trace 当作正常进度，并在异常处理前据此清零累计次数。

### 根因
- 通用错误资格判断过去只排除取消、Runner 释放和 ENOENT，未区分不可自行恢复的计费终态错误。
- 可见错误和正常工具 trace 共用 `normal` 类型；错误文本本身把 `attemptHadNormalReply` 置为 true，第二次失败时先把计数从 1 清零，再重新加到 1，形成无限循环。

### 长期规避
- Runner 的可见错误必须使用结构化 `error` trace；展示层可以继续使用普通错误气泡，但恢复计数只能消费 assistant 正文或非错误进度。
- HTTP 402、Payment Required、明确 insufficient credits/balance/points、积分需求大于零且 remaining 为零必须直接收口；不得依赖退避等待余额自行恢复。
- 429、连接中断和其他暂时性错误仍可按既有上限退避，不能用宽泛的 `remaining 0` 文本匹配误杀并发槽位等非计费错误。

### 验证方式
- 断言精确样本 `unexpected status 402 Payment Required: llm proxy error: model pool gpt-5.6-sol requires 1 points, remaining 0` 不具备 hidden retry 资格。
- 断言 Codex 可见错误 trace 的 kind 为 `error`，429、ECONNRESET 和普通网络错误仍可重试。
- 执行 `npm run build && node --test dist/test/core/hiddenRetry.test.js dist/test/core/panelDiagnostics.test.js dist/test/interactive/codexRunnerRuntime.test.js`，再运行 `npm run test:unit`。

### 关联资料
- `src/panelDiagnostics.ts`
- `src/interactive/codexRunner.ts`
- `src/interactive/codexRunnerRuntime.ts`
- `src/extension.ts`
- `src/test/core/panelDiagnostics.test.ts`
- `src/test/interactive/codexRunnerRuntime.test.ts`
- `.ch/docs/exec-plans/completed/2026-07/2026-07-14-codex-402-terminal-retry.md`

## Loop 自动睡眠与定时唤醒已下线

- 状态：已下线。不得返回 `status=sleep`、`wakeAfterSeconds` 或 `sleepReason`。旧 `sleeping` 读取时降级为 `needs-review`，并丢弃自动唤醒字段。不要恢复定时器、群聊倒计时、`src/loopAutoWake.ts` 或已删除的执行计划链接。

## npm 启动的命令解析测试必须隔离 npm 前缀变量

- 状态：已规避
- 首次发现：2026-07-17
- 适用范围：`commandResolution.test.ts`、用户级 npm/pnpm bin 优先级测试

### 现象
- 直接运行 `node --test` 通过，但 `npm test` 中“优先 npm user bin”和“回退 PATH”的测试解析到开发机器真实的 npm global bin。

### 根因
- npm 会向子进程注入 `npm_config_prefix`；命令解析器按设计优先它而非 `HOME/.npm-global/bin`。测试只覆写 `HOME` 和 `PATH`，没有清空 `npm_config_prefix`、`NPM_CONFIG_PREFIX`、`PNPM_HOME`，所以夹具不再代表预期环境。

### 长期规避
- 所有模拟用户级命令路径的测试都必须快照、清空并在 `finally` 恢复 `HOME`、`PATH`、`npm_config_prefix`、`NPM_CONFIG_PREFIX`、`PNPM_HOME`。不要为了测试而降低生产解析器对显式 npm/pnpm 前缀的优先级。

### 验证方式
- 执行 `npm run build && node --test dist/test/cli/commandResolution.test.js`，再执行 `npm test`。

## Graph tab 识别不能只依赖完成消息

- 状态：已规避
- 首次发现：2026-07-24
- 适用范围：Graph runtime、tab 运行状态、Webview Graph 图标和“打开 Graph 图”入口

### 现象
- Graph 任务开始运行后，conversation tab 仍显示为普通 tab，底部运行状态行没有“打开 Graph 图”按钮；等 Graph run 结束或再次追加带 `openGraphRun` action 的系统消息后，tab 才显示地图图标和 Graph 入口。

### 触发条件
- Graph run 创建时先通过系统消息写入 `openGraphRun` action，但随后 Graph 节点用现有 `runPrompt` 在同一 tab 运行。
- 节点启动发出的 `runStatus:start` 没有携带 `graphRunId` / `graphNodeId`，Webview 将该 start 状态视为普通运行并清掉运行时 Graph meta。

### 根因
- Webview 的 Graph tab 标识依赖 `graphRunId`。Graph started/completed 消息能提供该 id，但运行中的节点 start 状态也会参与 tab 元数据同步；如果 start payload 缺少 Graph id，就会覆盖掉刚识别出的 Graph tab。

### 长期规避
- 任何 Graph 节点执行路径调用 `runPrompt` 时，都必须把 `graphRunId` / `graphNodeId` 透传到 tab 级 `runStatus:start` 和 assistant message metadata。
- 新增 Graph 运行状态入口时，不能只验证最终系统消息；必须验证任务运行中 tab label、Graph 图按钮和自动 Graph mode 选择都已经生效。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/graph/graphExtensionRuntime.test.js dist/test/graph/graphMainWebview.test.js dist/test/core/openCodeTabStream.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/loop/loopmaingroupchatbutton.test.js`。

## Graph planned parallel 节点不能被未声明 scope 隐式串行化

- 状态：已规避，需随 Graph scheduler / planner 并发语义变化复核
- 首次发现：2026-08-29
- 适用范围：Graph scheduler、Graph runtime、AI planner 并行 DAG、review/test/summary 节点调度

### 现象
- AI planner 已生成 4 个同层并行 `review` 节点且 `plannedGraph.maxConcurrent=4`，但运行日志中节点仍按单个或少量串行执行。
- 看起来像 executor 并发数没有生效，实际是 scheduler 在 batch selection 阶段提前把 ready 节点延后。

### 触发条件与根因
- 多个 ready 节点属于写入类节点，但没有声明 `writeFiles` 或 `conflictGroup`。
- 旧 scheduler 把这类节点归为隐式 `unscopedWrite` 全局冲突组，因此即使 DAG 和 `maxConcurrent` 允许并行，也只选中一个写入类节点。
- runtime 还有次要触发点：一次成功推进 tick 没有失败或阻塞节点时，也可能用空触发列表误追加 `replan-*`。

### 长期规避
- Graph 调度冲突只应来自显式 `conflictGroup` 或重叠 `writeFiles`；未声明 scope 的 ready 节点不应被 scheduler 自动当作全局写锁。
- 会修改文件的节点仍必须在 planner prompt / 节点约束中声明 `writeFiles` 或 `conflictGroup`；未声明 scope 的节点必须被视为不写文件。
- 动态 replan 只在 failed/blocked 触发节点存在，或真正 idle/no-progress 时尝试；普通成功推进 tick 不得追加 `replan-*`。

### 验证方式
- 执行 `node --test dist/test/graph/graphScheduler.test.js dist/test/graph/graphExtensionRuntime.test.js dist/test/graph/graphPlanner.test.js`。
- 检查 `graphScheduler` 回归用例中 4 个无 `writeFiles` 的 planned parallel `review` 节点会全部进入 `selectedNodeIds`。
- 检查 `graphExtensionRuntime` 回归用例中成功推进 `review -> summary` 后不会生成 `replan-*` 节点。

## Graph 重构后验证节点不能无写入授权地承担测试契约迁移

- 状态：已规避，需随 Graph planner / failure classification 变更复核
- 首次发现：2026-08-02
- 适用范围：Graph planner、Graph test/review 节点、source-contract / canonical source 测试、重构/迁移/拆模块任务

### 现象
- Graph run `graph_msg_1785661781962_abd923233c4068` 执行到 `test-schema-definitions` 后失败并进入 `needs-review`，attempts 达到 2/2。
- 失败看起来像 SQL schema 实现继续出错，但实际测试 `apps/server/test/performance/performance-observation-schema.test.js` 仍读取旧 `apps/server/src/db.js` 文本 source-contract，查找已经迁入 `apps/server/src/db/schema/observability.js` 的 SQL 定义。
- `test-schema-definitions` 节点没有测试文件 `writeFiles` 授权，只能重复失败，Retry 也不能新增授权范围。

### 触发条件
- 重构、迁移或拆模块移动 canonical source，例如把 SQL 常量从聚合文件移到子模块。
- 现有测试用 source-contract、文本快照、路径断言或 “canonical source” 读取旧文件，而 planner 只规划实现节点和只读验证节点。
- 验证节点没有声明受影响测试文件的 `writeFiles`，`if_fail` / `review_feedback` 又只回到原实现节点。

### 根因
- planner 过去没有把“实现迁移”和“测试契约迁移”拆成两个有写入授权的节点。
- runtime 过去只保留 `lastError`，缺少 `missing_write_scope` / `stale_test_contract` 分类与 recommendedWriteFiles，主 tab 难以看出失败应返工到测试适配节点。

### 长期规避
- planner 遇到重构/迁移/拆模块时，必须检查 source-contract、文本快照、路径断言和测试 canonical source；风险存在时规划独立 test adaptation / 契约更新节点，并声明具体测试 `writeFiles`。
- 验证节点发现旧测试契约失败时，应通过 `if_fail` / `review_feedback` 返工到测试适配节点，而不是只回到原实现节点。
- runtime 需要把该类失败分类为 `missing_write_scope`，signals 保留 `stale_test_contract`，recommendedRecovery 使用 `add_rework_node`，recommendedWriteFiles 指向需要授权的测试文件；不得建议单纯 Retry 作为主要恢复路径。
- needs-review / idle 文案必须展示 category、confidence、signals、recommendedRecovery、recommendedWriteFiles 和 nodeDraft，确保主任务或用户不用翻 artifact 才能理解下一步。

### 验证方式
- 用 `test-schema-definitions` 失败样本文本验证分类结果：category 为 `missing_write_scope`，signals 包含 `stale_test_contract`，recommendedWriteFiles 包含 `apps/server/test/performance/performance-observation-schema.test.js`。
- 检查 planner prompt 覆盖 stale/source-contract/writeFiles/test adaptation 要求。
- 执行 `node --test dist/test/graph/graphFailureClassification.test.js dist/test/graph/graphNodeLifecycle.test.js dist/test/graph/graphStore.test.js dist/test/graph/graphNodeArtifact.test.js dist/test/graph/graphExtensionRuntime.test.js dist/test/graph/graphPromptBuilders.test.js`，并在需要时执行 `npm run build`。

### 关联资料
- `.ch/docs/design-docs/graph-orchestration-mode.md`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `src/graph/graphFailureClassification.ts`
- `src/graph/graphPromptBuilders.ts`
- `src/extension.ts`
- `/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1785666611389_ecabb047f2973/subtasks/round-1-planner-stale-contract-guards.md`
- `/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1785666611389_ecabb047f2973/subtasks/round-2-graph-failure-classification-core.md`

## 同版本 VSIX 强装后人工交互弹窗可能卡在运行时 / webview 版本边界

- 状态：需部署时检查
- 首次发现：2026-08-10
- 适用范围：Codex / Claude / OpenCode Vibe 人工交互弹窗、VS Code extension 同版本本地强装、webview runtime

### 现象
- OpenCode 已按人工交互要求输出 2-3 个问题和选项，但界面只显示普通 assistant 气泡，没有弹出表单。
- OpenCode one-shot 日志可能已出现 `assistant-chunk` 和 `runPrompt-exit`，但用户看不到 `humanInteractionOverlay`。

### 触发条件
- 修改扩展后用同一版本号执行 `code --install-extension dist/sinitek-cli-tools-<version>.vsix --force`。
- 当前 VS Code 窗口或 webview 没有重新加载，导致后端 extension host、安装目录代码、已打开 webview script 可能不在同一版本。
- 人工交互链路缺少分段日志时，无法快速区分“未解析出表单”“后端已发请求但前端未收到”“前端收到但 DOM/CSS 未显示”。

### 根因
- VS Code 同版本强装只替换安装目录，不保证已经打开的窗口和 webview 立即加载新 HTML/script。
- OpenCode 自然语言 fallback 依赖后端解析 assistant 文本并向 webview 发送 `humanInteractionRequest`，任一侧版本不一致都会表现为普通消息而非表单。
- OpenCode one-shot 在 stdout 中检测到真实 `sessionID` 后会把本地 draft 消息迁移到真实 session；如果运行态仍拿旧 draft 数组做自然语言人工交互判断，就会出现 `assistant-chunk` 已写出、但 `runPrompt-one-shot-natural-human-interaction-skip` 报 `reason:"no-assistant-message"` 的假阴性。

### 长期规避
- 本地强装同版本 VSIX 后，必须执行 `Developer: Reload Window`，再重测人工交互弹窗。
- 排查时按日志事件分段判断：`runPrompt-one-shot-session-target-synced` 表示 OpenCode 真实 session 已同步到 one-shot 运行态；`runPrompt-one-shot-natural-human-interaction-prepared` 表示后端已解析表单并准备请求；`humanInteraction-request` 表示后端已发请求；`human-interaction-request-received` 表示 webview 已收到并尝试显示；`runPrompt-one-shot-natural-human-interaction-skip` 表示 one-shot 后端未能从最终助手消息构建表单。
- OpenCode one-shot/parallel 改动后，用包含 A/B/C 选项的问题输出做回归，确保能生成 radio 字段并移除普通 assistant 提问气泡。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/core/humanInteraction.test.js dist/test/webview/multiAgentSettingWebview.test.js`。
- 重新打包并强装 VSIX 后，检查安装目录包含 `runPrompt-one-shot-session-target-synced`、`runPrompt-one-shot-natural-human-interaction-prepared`、`humanInteraction-request`、`human-interaction-request-received`、`runPrompt-one-shot-natural-human-interaction-skip`。
- 重载 VS Code 窗口后，用 OpenCode 发送“写一首诗，你来问我一些要求帮你更精准写出我想要的诗”，确认出现表单弹窗。

### 关联资料
- `src/extension.ts`
- `src/extensionHost/promptOneShotRuntime.ts`
- `src/webview/viewContentScript/settingsAndOverlays.ts`
- `src/test/extensionHost/promptOneShotRuntime.test.ts`
- `src/test/core/humanInteraction.test.ts`
- `src/test/webview/multiAgentSettingWebview.test.ts`

## Webview 行级 label 包多个 select 会导致后一个下拉无法打开

- 状态：已规避
- 首次发现：2026-08-10
- 适用范围：主聊天面板模型/思考力度选择器、配置视觉编辑器中的 Ant Design Select

### 现象
- OpenCode 主/子模型旁的“思考力度”下拉点击后没有展开，看起来像配置已存在但 UI 不响应。
- 配置页日志只出现 `config-view-debug` 同步事件，没有进入对应控件的点击诊断，容易误判为配置数据问题。

### 触发条件
- 使用 `<label for="modelSelect">` 包住整行，并在同一 label 内同时放模型 `<select>` 和思考力度 `<select>`。
- Ant Design tags/multi Select 也放在外层 `<label>` 容器内时，点击/焦点行为可能被 label 转发或干扰。

### 根因
- HTML label 的点击会关联到 `for` 指向的控件；当一个 label 内包含多个交互控件时，点击非目标控件也可能被转发到目标控件。
- 对 OpenCode 主模型行来说，点击思考力度 select 会被转发到模型 select，因此思考力度自己的下拉无法稳定打开。

### 长期规避
- 不要用行级 label 包多个交互控件；行容器用 `div`，只给文字标签使用 `<label class="... " for="目标控件">`。
- 新增模型/思考力度组合控件时，测试中断言不存在 `<label class="open-code-model-row"` 这类整行 label。
- 配置页非 hash app 脚本变更后要带版本参数，避免 Webview 缓存继续执行旧 `config-app-ui.js`。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/openCodeThinkingWebview.test.js`。
- 配置页相关变更还需执行 `node --test dist/test/config/opencodeconfigvisualeditor.test.js dist/test/config/cliPageConfigCoverage.test.js`。

### 关联资料
- `src/webview/viewContentHtml.ts`
- `src/webview/configView.ts`
- `media/config/assets/config-app-ui.js`
- `src/test/webview/opencodedualmodelwebview.test.ts`
- `src/test/webview/codexdualmodelwebview.test.ts`
- `src/test/webview/cliPageStaticRenderCoverage.test.ts`

## OpenCode 配置正确但主面板 variants 为空时要检查 role override

- 状态：已规避
- 首次发现：2026-08-10
- 适用范围：OpenCode 主面板模型选择、动态 thinking variants、`~/.sinitek_cli/models.json`

### 现象
- `~/.opencode/config.json` 或 `~/.opencode/__config/<id>.json` 中主模型已经声明 `variants`，但主面板“思考力度”下拉点开仍没有选项。
- 日志里 `opencode run` 可能实际使用配置默认主模型，但 UI store 仍保留旧的 `openCodeRoleModelsByConfigId.<configId>.main`。

### 触发条件
- 旧 Webview label 转发或其它 UI 状态错误把 OpenCode main role override 写成了当前配置的 `small_model`。
- 后续配置文件已经恢复为 `model=<主模型>`、`small_model=<子模型>`，但 role override 仍优先覆盖配置默认主模型。

### 根因
- `resolveOpenCodeRoleModelsForConfig` 会优先读取 `openCodeRoleModelsByConfigId`，导致主面板使用 stale override 对应模型的 variants。
- 如果 stale override 指向子模型，而子模型没有主模型的 `xhigh/max/ultra` variants，thinking select 会被同步为空或只显示错误档位。

### 长期规避
- 当 OpenCode 配置文件与主面板表现不一致时，同时检查 `~/.sinitek_cli/models.json` 的 `openCodeRoleModelsByConfigId`。
- 解析 OpenCode role model 时，若某个 role override 正好镜像到当前配置的相反默认 role，自动清理该 stale override，回到配置默认模型。
- 回归测试要覆盖 `model=provider/sol`、`small_model=provider/luna`，但 store 中旧 `main=provider/luna` 的场景。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/openCodeThinkingWebview.test.js`。
- 复测 OpenCode 主面板时，切换到 OpenCode 或重载窗口后确认主模型 thinking 下拉出现配置中的 variants。

### 关联资料
- `src/extensionHost/modelSettings.ts`
- `src/test/extensionHost/opencodethinkingintegration.test.ts`
- `src/cli/openCodeModelCapabilities.ts`
- `~/.sinitek_cli/models.json`

## OpenCode thinking capability 异步回调要先同步 host 状态再刷新面板

- 状态：已规避
- 首次发现：2026-08-10
- 适用范围：OpenCode 主面板动态 thinking variants、`createModelSettingsHost`、异步 capability 解析

### 现象
- 本机 `~/.opencode/__config/<id>.json` 已配置模型 `variants`，直接解析 capability 能得到 `xhigh/max/ultra`，但主面板“思考力度”下拉仍为空。
- 日志里 OpenCode 运行路径已经使用正确主模型，排除配置文件和 role override 后仍复现。

### 触发条件
- `refreshOpenCodeThinkingState` 启动异步 `resolveOpenCodeThinkingCapability(...).then(...)`。
- 异步回调只更新 `createModelSettingsHost` 闭包里的 `openCodeThinkingState`，随后直接调用 `postPanelState()`。
- `postPanelState()` 内部重新进入 wrapped host 方法时会先 `syncFromDeps()`，从 extension 全局状态读回旧的 loading/空状态，覆盖刚解析出的 variants。

### 根因
- `createModelSettingsHost` 的 wrapper 只会在同步函数返回或 awaited promise finally 时自动 `syncToDeps()`；异步 fire-and-forget 回调不在 wrapper 生命周期内。
- capability 回调中如果没有显式 `syncToDeps()`，解析结果不会进入真实 panel state，刷新面板时仍看到旧状态。

### 长期规避
- 在 host 内部 fire-and-forget 异步回调里修改闭包状态后，若马上触发 `postPanelState()` 或其它依赖 deps getter 的流程，必须先显式 `syncToDeps()`。
- 回归测试要覆盖完整 `refreshOpenCodeThinkingState` 异步路径，而不是只测 capability parser 或纯 webview select 同步。
- 本机复现可用真实 OpenCode config 跑 host refresh，确认 `openCodeThinkingState.disabled=false` 且 `options` 非空。

### 验证方式
- 执行 `npm run build`。
- 执行 `node --test dist/test/extensionHost/opencodethinkingrefreshstate.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/openCodeThinkingWebview.test.js`。
- 用真实 `~/.opencode` 配置调用 `resolveOpenCodeThinkingCapability` 与 `refreshOpenCodeThinkingState`，确认主模型 variants 均为非空。

### 关联资料
- `src/extensionHost/modelSettings.ts`
- `src/test/extensionHost/opencodethinkingrefreshstate.test.ts`
- `src/cli/openCodeModelCapabilities.ts`

## Webview 的 display 规则会盖住 hidden，模型选择会在“补充需求”里露出来

- 状态：已规避
- 首次发现：2026-09-25
- 适用范围：Loop / Loop+ 群聊面板、Graph 运行图面板、使用 `hidden` 切换可见性的 Webview

### 现象
- Loop 与 Loop+ 群聊点击“补充需求”时，确认框仍然显示“继续使用的运行配置 / 主子模型”选择。
- 该选择本应只在点击“继续”时出现。“我要提问”已经改成独立对话弹窗，不再进入这个确认框。

### 触发条件
- 同一个弹窗用 `element.hidden` 隐藏 `#continueModelChoice`。
- 样式里有 `.model-choice { display: flex; }`，且没有让 `[hidden]` 使用 `display: none !important`。

### 根因
- 当前 Chrome / VS Code Webview 里，作者样式的 `display: flex` 会覆盖 `[hidden]` 的默认 `display: none`。
- `hidden=true` 时计算样式仍是 `display: flex`，所以模型选择继续可见。

### 长期规避
- 使用 `hidden` 控制显隐的 Webview 必须声明 `[hidden], .model-choice[hidden] { display: none !important; }`。
- 不要给会被 `hidden` 隐藏的元素写 `display: ... !important`，除非选择器同时包含 `[hidden]` 且优先级更高。
- “补充需求”只调用 `setContinueModelChoiceVisible(false)`；只有“继续”调用 `setContinueModelChoiceVisible(true)`。“我要提问”不再复用这个弹窗。

### 验证方式
- `npm run build`
- `node --test dist/test/loop/loopDebatePanel.test.js`
- 用 Chrome 计算样式确认 `hidden` 的 `.model-choice` 为 `display: none`。

### 关联资料
- `src/webview/loopDebatePanelStyles.ts`
- `src/webview/loopDebatePanel.ts`
- `src/webview/graphRunPanelStyles.ts`

## 主任务刷新会在补充需求弹窗恢复前把它写成已关闭

- 状态：已规避
- 首次发现：2026-09-30
- 适用范围：Loop / Loop+ 群聊“补充需求”“继续执行”弹窗

### 现象
- 群聊里打开“补充需求”后，弹窗有时自己关掉，已输入内容也丢了。
- “继续执行”仍和“补充需求”共用这套弹窗状态。“我要提问”已改成独立对话弹窗，并用自己的 `askDialog` 状态恢复草稿，不再受这段状态影响。

### 触发条件
- 弹窗还开着时，主任务、子任务或主持人状态落盘，宿主调用 `refreshOpenLoopGroupChatPanelForTask`。
- 这次刷新会整页重写 Webview HTML。页面可见性变化或卸载也可能赶在下一帧之前发生。

### 根因
- 新页面先把 `continueDialogOpen` 设为 `false`，真正的 `restoreDialogState()` 放在 `requestAnimationFrame` 里。
- `visibilitychange` 和 `beforeunload` 会先调用 `saveDialogState()`，把尚未恢复的关闭状态写回 `vscode.getState()`。
- 主任务连续刷新时，下一次页面就读到 `open: false`，弹窗不再出现。

### 长期规避
- 在注册 `visibilitychange`、`beforeunload` 和自动刷新之前，同步调用 `restoreDialogState()`。
- `dialogStateRestored` 变成 `true` 之前，`saveDialogState()` 必须直接返回，不能覆盖已保存的打开状态。
- 不要再把弹窗恢复留到下一帧；滚动位置恢复可以继续留在 `requestAnimationFrame`。
- 2026-10-13 补充：继续弹窗打开时必须主动请求刷新；不能因 `continueDialogMode === "continue"` 跳过运行配置区域的局部补丁，否则修改主子模型后弹窗一直显示旧值。替换区域时保留原/新配置选择、单选焦点和 `hidden`，避免定时刷新把选择重置，或让模型区域在补充需求弹窗重新露出。

### 验证方式
- `npm run build`
- `node --test dist/test/loop/loopDebatePanel.test.js`
- 主任务运行中打开“补充需求”，等待群聊因主任务事件刷新后，弹窗和已输入内容仍在。
- 在继续弹窗打开期间更改当前主子模型，确认配置摘要更新且说明、选择和焦点保留；原配置不可用时回退新配置。

### 关联资料
- `src/webview/loopDebatePanel.ts`
- `src/test/loop/loopDebatePanel.test.ts`
- `src/extension.ts` 中的 `refreshOpenLoopGroupChatPanelForTask`

## 建议模板


```md
## <坑点标题>

- 状态：有效 / 需部署时检查 / 已规避 / 需观察
- 首次发现：YYYY-MM-DD
- 适用范围：模块 / 环境 / 脚本 / 版本

### 现象
- 看到什么报错、错误行为或异常结果？

### 触发条件
- 在什么前提下会出现？

### 根因
- 已确认的根因是什么？如果只是推断，要明确写“推断”。

### 长期规避
- 以后应该怎么做，才能避免再次踩坑？

### 验证方式
- 修改后如何确认这个坑已被规避？

### 关联资料
- 相关代码路径、runbook、issue、设计文档、外部链接
```

## 历史归档入口

- [PITFALLS_HISTORY.md](./PITFALLS_HISTORY.md)：已修复、已废弃、仅历史版本有效条目，保留完整追溯信息。

## Loop+ 群聊不能把调度 attempt 显示成验收状态

- 状态：已规避
- 首次发现：2026-09-25
- 适用范围：Loop+ 群聊侧栏的已确认验收

### 现象
- 已确认的子任务整列显示“已验收尝试”，每一行还带内部 attempt id。用户无法判断这项验收是成功还是失败。

### 触发条件
- `seenAttempts` 里 `disposition` 为 `reviewed` 的记录被直接渲染成尝试列表。
- 执行结果 `outcome` 在确认验收后没有留给展示层。

### 根因
- attempt 是调度身份，不是验收结论。确认验收只表示主任务已经处理这条完成事件。

### 长期规避
- 群聊已确认项只显示验收成功或验收失败。执行结果为 `failed` 或 `stopped` 是失败。`accept.reviews` 把该条标成 `passed`，且执行结果不是 `failed` 或 `stopped` 时才是成功。
- 同一次 accept 可以既确认成功项，又给失败项发起子任务。`subtaskIds` 只标出那一条发起的子任务，不能把同批其它成功项的 `acceptance` 记为 `failed`。
- `completed` 确认记为 `passed`；若 outcome 已是 `failed` 或 `stopped`，仍显示验收失败。模型把这种执行标成 `passed` 时，宿主仍记为失败。
- 旧快照没有 `outcome` 或 `acceptance` 时，不要发明第三种“尝试”状态；只有子任务记录为 `blocked` 才显示失败，否则显示成功。
- 还在队列里、尚未确认的项继续显示待验收，不要提前写成验收失败。
- 验收成功用主题绿色，验收失败用主题橙色，不要写死颜色。
- 内部 attempt id 可以留在数据属性里，不写进用户可见文案。

### 验证方式
- `node --test dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopPlusScheduler.test.js`

## 热 thread 上不要重复 thread/resume

- 状态：已规避
- 首次发现：2026-09-26
- 适用范围：Codex app-server 长连接

### 现象
- 同一会话的后续回合、hidden retry 或 Loop 子任务重试启动很慢。
- 日志里每个回合都有新的 `codex app-server` 进程，以及 `initialize` 和 `thread/resume`。

### 触发条件
- 回合结束关闭了 app-server，下一次又从冷进程恢复 thread。
- 或者连接还活着、thread 已被当前连接订阅，却再次 `thread/resume` 并指望它应用新的 provider/cwd override。

### 根因
- `thread/start` / `thread/resume` 会重载 config、创建 session、固定 MCP profile 并 websocket prewarm。
- app-server 对已加载且仍有订阅者的 thread 会忽略 resume override，并保留旧 session。

### 长期规避
- 每条连接只 `initialize` 一次。当前进程里已加载的 thread 只发 `turn/start`。
- 模型、effort、cwd、sandbox、approval 走 `turn/start`。`modelProvider` 放进连接键；要改 provider 就换连接，再冷 `thread/resume`。
- 已加载回合停止用 `turn/interrupt`。只有冷启动、dispose 或进程退出才杀进程。
- Loop 子任务重试复用原来的 tab 和 thread，不要每轮新建会话。

### 验证方式
- `node --test dist/test/interactive/codexRunnerReuse.test.js dist/test/interactive/codexRunnerLifecycle.test.js`

## 最终回复已经出现，但 Codex 任务仍停在运行中

- 状态：已规避，需随 Codex app-server `turn/start` 与 `turn/completed` 时序复核
- 首次发现：2026-09-27
- 适用范围：Codex app-server 长连接、Grok 等代理模型、hidden retry 与界面运行状态

### 现象
- 2026-09-27 会话 `01a0dcad-17b3-7010-9b55-7735d3fbd7e3` 使用 `grok-4.7`。界面已经写出带 `[final_answer]` 的 assistant 回复，rollout 在 `2026-09-26T16:16:45.237Z` 记录 `task_complete`，app-server 也发出 `turn/completed targeted_connections=1`。插件消息停在这条最终回复，没有“任务已完成”，界面仍是运行中，不是压缩上下文。

### 触发条件与根因
- 长连接下回合结束不退出进程，运行状态只随当前 operation 结束。`runStreamedOnce` 先等待 `turn/start` 响应，再等待 `turn/completed`。
- 本次 hidden retry 的 `turn/start`（提示为“继续”）发生时，同一 thread 的真实 turn 已经在跑。服务端把这次输入并进正在运行的 turn，`turn/start` 响应没有在 turn 完成后返回。
- 真实 `turn/completed` 的 turn id 与 `turn/start` 响应里的 id 也可能不一致。旧逻辑只在 id 完全一致时收口，于是 operation 一直不结束，最终回复已经显示，任务状态仍是运行中。

### 长期规避
- 主线程 `turn/completed` 到达时，如果 `turn/start` 还没返回，立即结束这次运行，不能继续空等 RPC。已经被暂停打断并记为过期的 turn 除外，见下一节。
- 如果响应里的 turn id 从未出现在本回合流式事件里，而完成通知对应的 turn 已经流过 assistant 输出，仍按该完成通知收口。
- 已经在本回合流式事件里出现过的当前 turn，不能被另一个也出现过的旧 turn 完成通知提前结束。子线程完成通知仍然不得结束父任务。
- `turn.completed` 仍然只表示回合结束。最终气泡继续只认 `final_answer` phase、`[final_answer]` 正文，或符合条件的 phase-null 提升。

### 验证方式
- `turn/start` 不返回、但主线程先收到 assistant delta 和匹配的 `turn/completed` 时，`runStreamed` 必须返回。
- `turn/start` 返回的 id 与随后流式事件 / `turn/completed` 的 id 不同，且旧 turn 的完成通知先到时，只在真实 turn 完成后返回一次。
- 子线程 turn id 即使被记入观察集合，也不能收口父任务。

### 关联资料
- `src/interactive/codexRunner.ts`
- `src/interactive/codexAppServerEvents.ts`
- `src/test/interactive/codexRunnerLifecycle.test.ts`
- `src/test/interactive/codexAppServerEvents.test.ts`

## 暂停并发送后出现“没有最终结论”自动重试

- 状态：已规避，需随 Codex app-server `turn/interrupt` 与下一条 `turn/start` 的时序复核
- 首次发现：2026-09-28
- 适用范围：Codex 长连接、任务执行中的“暂停并发送”

### 现象
- 当前任务还在执行时选择“暂停并发送”，对话里先出现错误气泡“任务已退出，但没有产生最终结论气泡，自动继续。”
- 随后自动重试又能正常完成，看起来像偶发错误，但暂停动作本身不应报这条失败。

### 触发条件与根因
- 暂停会 `turn/interrupt` 当前 turn，并立刻对同一 thread 发送下一条 `turn/start`。
- 被打断 turn 的 `turn/completed` 可能在下一条 `turn/start` 返回前到达。新 operation 这时还没有自己的 turn id。
- 旧逻辑把“当前 turn id 仍为空”当成可以收口。新回合因此被立即结束，运行时认为没有最终结论并自动重试。

### 长期规避
- `stopAndRebuild` 记录被打断 turn 的 id。这些 id 的后续 delta、item 和 `turn/completed` 不得进入下一条回合，也不得把它收口。
- 当前 turn 自己的完成通知仍按原规则收口：`turn/start` 还没返回时，这条 turn 的 `turn/completed` 可以结束本次运行。只有已标记过期的 turn 不能借用这条规则结束下一条提示词。
- 当前 turn 的 `interrupted` 完成通知仍然结束这一次运行，但不产生最终结论气泡。

### 验证方式
- 已加载 turn 被暂停后，下一条 `turn/start` 收到旧 turn 的正文和 `turn/completed` 时，新回合保持 pending，直到自己的 assistant 输出和完成通知到达。
- `node --test dist/test/interactive/codexRunnerReuse.test.js dist/test/interactive/codexAppServerEvents.test.js dist/test/interactive/codexRunnerLifecycle.test.js`

### 关联资料
- `src/interactive/codexRunner.ts`
- `src/interactive/codexAppServerEvents.ts`
- `src/test/interactive/codexRunnerReuse.test.ts`


## 短问候被严格最终答复判定拒绝

- 状态：已规避
- 首次发现：2026-09-27
- 适用范围：OpenCode `run --format json --print-logs`、Claude 交互式分组、普通非 Loop 任务

### 现象
- `hi` 这类短回复已经出现在助手气泡里，任务仍报“正文未包含 `[final_answer]`”或“没有产生最终结论气泡”。复杂任务因为模型自己写了 `[final_answer]` 所以能过。
- OpenCode 1.18.25 用当前 `default/claude-sonnet-5` 实跑短提示时，stdout 是同一 `messageID` 的 `text`（带 `time.end`）和 `step_finish reason=stop`；`--print-logs` 的 stderr 是 `timestamp=... level=`，不是 provider 失败。
- 插件解析的是 `~/.npm-global/bin/opencode` 1.18.25。短 `hi` 在上游先返回 `AI_APICallError: Upstream access forbidden` 后仍可能成功落库，但父进程 stdout 为空；`opencode export` 里已有 `Hello! I'm OpenCode...` 和 `step-finish reason=stop`。这时界面报“已成功退出，但没有返回助手回答”。

### 根因
- 严格收口只把显式 `[final_answer]` 或同一消息的 `step_finish reason=stop` 当成终态。短回复经常不写标记；如果最后一块 `step_finish` 没进 stdout，完成正文也被拒绝。
- `--print-logs` 整段 stderr 被 `cleanOpenCodeStatusOutput` 留成 `errorText`，会盖住真实助手答复。
- Claude Code 2.1.283 的短回合可以只有 assistant `stop_reason=end_turn` 和 `system subtype=turn_duration`，不再输出 `result`。成功 `result` 也没有 Codex 那种 phase 提升。

### 长期规避
- OpenCode：同一消息的非 thinking 正文加 `stop` 继续通过；没有后续 tool / `tool-calls`、也没有其他 message 的 `stop` 时，`time.end` 完成正文也算结构化终态。
- `tool-calls`、跨 message、无正文 `stop`、纯 thinking 仍然拒绝。用户 prompt 里的 `[final_answer]` 不是助手终态。
- `--print-logs` 的 INFO/WARN/DEBUG 只算 progress，不进 trace，也不进 provider error。没有助手正文时，`level=ERROR` 的 `error.error` 要进入 `errorText`，不能再被内部日志过滤吞掉。
- 原生完成信号优先，`[final_answer]` 只是替补：OpenCode 认同一消息的非 thinking 正文加 `stop`（或无后续 tool 的 `time.end`）；Claude 认成功 `result`（subtype 为空或 success，且 is_error 不为真），或 assistant `stop_reason=end_turn`；两者都还要求本轮已有非 thinking 正文，且该正文之后没有工具。查询正常返回或进程退出本身不算完成。Codex 认 `phase="final_answer"`，或主 turn `turn.completed` 后把最后一条无工具的 `phase:null` 正文提升为终态。都没有这些信号时，才用助手正文里的 `[final_answer]`。
- 进程 `code=0` 但 stdout 没有上述 OpenCode 原生终态时，即使已经有 `tool-calls` 过程正文，也只调用一次官方 `opencode export <sessionID>`。会话 ID 来自 stdout `sessionID` 或 stderr `session.id`。已知 message 本身是 `finish=stop` 就用它；否则只用它之后的下一条 `finish=stop` 助手正文，不把更早的历史回复当成这次答案。没有 messageID 且有多条 assistant 时不猜测。`tool-calls` 导出不能收口。不读私有数据库，也不轮询。
- Claude 错误 `result`、只停在工具上的回合仍然不收口。Loop 仍不靠进程退出收口。

### 验证方式
- 回放带 `step_finish reason=stop` 的短回复 JSON，确认 `hasStructuredFinalAnswer=true`，且不要求正文包含 `[final_answer]`。
- stdout 只有 `tool-calls` 时必须再 export 一次，并采用已知 message 之后的 `finish=stop` 正文；导出仍是 `tool-calls` 时保持未收口。空 stdout 且没有 messageID、导出里有多条 assistant 时不猜测。已有原生 `stop` 时不得再 export。
- `node --test dist/test/cli/opencodeCommandRunner.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js`

### 关联资料
- `src/cli/commandRunner.ts`
- `src/extensionHost/promptInteractiveRuntime.ts`
- `src/interactive/claudeRunner.ts`


## Grok 原生提问方法未桥接且错误详情被隐藏

- 状态：已规避
- 首次发现：2026-10-21
- 适用范围：Grok ACP Vibe 人工交互、工具错误摘要

### 现象与根因

- `ask_user_question` 显示 `failed / tool_execution_failed`，实际 `rawOutput.message` 为 `Method not found: _x.ai/ask_user_question`。
- 原生提问是 ACP 客户端扩展请求，不能当成 `session/request_permission` 自动审批。仅接终端、文件和权限方法不足以完成提问。
- 错误摘要不能因 `error` 是通用字符串就丢弃同时存在的 `message`。无 error/message 时仍需回退 stderr/output，保持长日志首尾。

### 长期规避与验证

- Grok 原生回答采用 `{ outcome: "accepted", answers: { [question]: string[] } }` 或 `{ outcome: "cancelled" }`，不是 Codex questionId 结构，也不是按问题顺序排列的二维数组。契约与官方 `xai-grok-test-support/src/acp_ask_user_question.rs` 核对，并用本机 CLI 验证。
- 复用已有开关、超时和表单；拒绝必须传播为宿主停止，不让 CLI 的通用工具错误吞掉拒绝并继续执行。
- 逐回合绑定处理器；旧表单的迟到结果不能复用下一回合处理器。
- `npm run build`；`node --test dist/test/interactive/grokUserQuestion.test.js dist/test/interactive/grokAcpClient.test.js dist/test/interactive/grokRunner.test.js dist/test/interactive/grokToolCallStream.test.js`。

## 主任务澄清表单被当成通过或写两次

- 状态：已规避
- 首次发现：2026-09-30
- 适用范围：经典 Loop、Loop+、Graph planner / replanner

### 现象
- Graph tick 把 `clarify` 算进完成节点后，plan 节点看起来已经通过，运行图却不再等用户。
- 子任务或非 plan 节点返回 `clarify` 时弹出了主任务表单。
- 群聊提交一次澄清后，补充要求里出现两份相同答案，或正在运行的主任务和冷恢复同时继续。

### 根因
- `clarify` 只表示主任务要等用户。Graph plan 节点应回到 `ready`，真正的等待信号是 `pendingClarification`，不是 `passed`。
- Loop+ 的 `applyClarifyDecision` 只是策略表占位并返回 `stop`。真正等待发生在 consumer 解析到 `clarify` 时。
- 进程内 waiter 还在时，面板提交只能 resolve waiter；只有 waiter 已经不在时，才把答案写入补充要求并冷恢复。

### 长期规避
- 非 plan 节点的 `clarify` 按失败处理，不保存表单。
- 同一任务最多主动澄清 8 次。拒绝进入 `needs-review`，停止必须清表单并 abort waiter。
- 热恢复不要再写一次答案，冷恢复不要只 resolve 一个已经不存在的 waiter。

### 验证方式
- `npm run build`
- `node --test dist/test/core/orchestratorClarification.test.js dist/test/graph/graphKernel.test.js dist/test/extensionHost/loopPlusOrchestration.test.js`

### 关联资料
- `src/orchestratorClarification.ts`
- `src/graph/graphKernel.ts`
- `src/graph/graphNodeLifecycle.ts`
- `src/panelDiagnostics.ts`

## Grok 分类器不能按 trim 丢弃纯空白分块

- 状态：已规避
- 首次发现：2026-10-24
- 适用范围：Grok ACP `agent_message_chunk` / `agent_thought_chunk`

### 现象
- 同一句话按不同分块边界输出不同正文。`Hello`、一个空格、`world` 变成 `Helloworld`；换行、连续空行、制表符和代码缩进同样消失。单个完整分块却保留原文。正文和思考都会中招。

### 触发条件与根因
- 分类器用 `text.trim()` 判断片段是否有内容。纯空白增量被当成无内容忽略。
- 宿主旧断言把 `Hello `、`world` 和三个空格期望成 `Hello world`。这个期望不能证明协议应该丢空白。

### 长期规避
- 非空字符串原样进入 assistant 或 thinking。空字符串、非文本和无效内容仍忽略。数组文本按原顺序拼接。
- 不在分类器里缓冲、补空格、统一 trim、去重或清理尾部。
- 避免纯空白气泡留在展示层。落盘 `sanitizeMessages` 仍可去掉整段没有可见字符的消息，但不能提前删掉流式增量。

### 验证方式
- `npm run build`
- `node --test dist/test/interactive/grokAppServerProtocol.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/interactive/grokRunner.test.js dist/test/interactive/grokReplayStream.test.js`

### 关联资料
- `src/interactive/grokAppServerProtocol.ts`
- `src/interactive/grokRunner.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `.ch/docs/exec-plans/completed/2026-10/2026-10-24-grok-stream-whitespace-contract-repair.md`
