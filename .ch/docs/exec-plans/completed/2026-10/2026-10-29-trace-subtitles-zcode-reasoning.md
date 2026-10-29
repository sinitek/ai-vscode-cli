# 指令气泡去副标题与 ZCode 思考力度优先级

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-29
- claim_ttl：本次任务
- handoff_to：无

## 背景与目标

所有 CLI 共用的指令气泡重复展示命令副标题；ZCode 配置默认 max 时，用户选择 high 应覆盖配置，且所有配置范例中独立思考力度统一 high。

## 范围与非目标

- 范围：共享 trace renderer、ZCode 回合参数与会话设置、配置范例、相关回归测试及事实来源。
- 非目标：不修改用户配置、凭据、会话历史、Loop 调度状态或无关未提交改动；不改变真实能力档位与高级配置语义。

## 验收标准

- 所有 CLI 的指令气泡仅保留主标题、原有标签及内容区，不生成副标题；折叠、命令预览、展开正文与复制不退化。
- UI 选择的合法思考档位优先于配置，覆盖新建、复用和恢复会话；不支持的档位不得下发，未选择时保留配置。
- 所有用户可导入范例的独立思考参数为 high，不批量替换能力枚举或用户设置。
- 相关单测和构建通过；补充原生 ZCode 参数验证及浏览器渲染验证。

## UI 约束

复用现有 trace-header / trace-tag-row、标题与命令用途标签、VS Code 主题语义、间距和折叠组件。删除主标题与内容区之间的 trace-detail 副标题行。默认、折叠、展开、空内容和错误气泡均不增加新交互；正文保留完整命令和路径，展开/收起及键盘操作沿用现有行为。

## 风险与缓解

- 共享渲染覆盖所有 CLI，以代表性原生 trace 文本检查短命令、长命令、工具结果、文件变更与未知工具。
- ZCode 不能只检查本地缓存档位，应读取原生会话快照核对 model.options.reasoningLevel 与 thoughtLevel。
- 原生模型服务可能慢；优先不发模型请求核对设置，再用最小连续回合验证，不输出凭据。

## 验证与文档同步

- 从相关 Webview、ZCode runner / protocol / strategy、配置范例测试开始，执行 npm run build。
- 按最终改动范围同步 FEATURE_INVENTORY、CLI 运行时参考、ZCode 指南及 ontology；执行 ontology 校验。
- 本机验证脚本和截图留在临时目录，不写入仓库私有数据。

## 实现结论

- 通过 CodeGraph 定位共享 renderer 与 ZCode runner，再核对磁盘源码。共享 `renderTraceContent` 不再输出 `.trace-detail`，并删除对应无用样式；七个 CLI 共用这一改动。主标题、用途标签、折叠命令预览、完整正文和展开交互保留。
- ZCode 宿主在每回合 `start()` 后重新应用当前模型及用户档位，覆盖新建、同进程复用与跨进程恢复。runner 解析原生设置回包，校验确认档位；切换模型后使用新模型公布的能力，不继承旧模型的档位集合。临时会话设置使用 `persistAsWorkspaceLastUsed: false`，不改用户配置。
- Webview 接收按 Tab 隔离的 `zcodeThinkingOptions`，保留合法的用户选择；不再把 ZCode `max` 当成通用档位自动降为 `high`。切换 CLI、Tab、模型或档案时清除旧能力广告；空能力集合禁用选择器。
- ZCode、Codex、Grok 的可导入范例独立思考字段统一 `high`；Claude 原本已为 `high`，没有独立字段的范例不新增。ZCode 协议兼容回退的 `max` 与能力枚举不改。`GROK_KEDAYA_PROFILE` 是绑定固定来源档案的合并器，不是配置页范例，保留其原有值，避免顺带改变特定档案。
- 补充 runner、宿主策略、Webview 及范例测试，覆盖复用/恢复时 UI 优先、无合法 UI 选择时配置回退、模型切换、原生回报不一致与 RPC 失败、Tab 隔离、七 CLI 无副标题。

## 验证结果

### 构建与自动化

- `npm run build` 通过；收尾重跑日志为 `/tmp/sinitek-trace-reasoning-closeout-build.log`。
- 实现阶段相关回归覆盖 12 个测试文件，124/124 通过，日志为 `/tmp/sinitek-trace-reasoning-expanded.log`。收尾在当前工作树重新执行以下命令，100/100 通过，日志为 `/tmp/sinitek-trace-reasoning-closeout-targeted.log`：

  ```bash
  node --test \
    dist/test/interactive/zcodeRunner.test.js \
    dist/test/interactive/zcodeAppServerProtocol.test.js \
    dist/test/interactive/zcodeTrace.test.js \
    dist/test/extensionHost/promptInteractiveRuntime.test.js \
    dist/test/extensionHost/interactiveTurnStrategy.test.js \
    dist/test/config/zcodeConfig.test.js \
    dist/test/config/cliPageConfigCoverage.test.js \
    dist/test/config/codexConfigVisualEditor.test.js \
    dist/test/webview/traceToolTitleLocalization.test.js
  ```

- `npm run test:page` 收尾重跑为 315 项，311 通过、4 失败，日志为 `/tmp/sinitek-trace-reasoning-closeout-page.log`。失败与此前交接中的四项基线一致，按历史夹具/范围外失败保留，不为绿灯修改无关实现：
  - `historySessionLoop` 两项：夹具缺少 `formatCliDisplayName`。
  - `cliPageStaticRenderCoverage` 一项：静态页缺少 `<option value="grok">grok</option>`。
  - `clipagescriptruntimecoverage` 一项：Codex 会话标签的 `errored` 实际为 `undefined`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `node --check media/config/assets/config-app-ui.js` 和 `git diff --check` 通过。
- Impeccable 检测仅报告既有 `border-left: 3px` 样式警告；本轮要求复用现有主题和组件，因此不改变原有强调边框。

### 本机原生 ZCode

- 修改前诊断表明，新会话的 `high` 已能生效，未复现用户描述的所有情形；确认的代码缺口是复用回合未重新应用模型，以及 Webview 未消费原生档位广告并自动降级 `max`。诊断日志为 `/tmp/sinitek-zcode-reasoning-before.log`。
- `node /tmp/sinitek-zcode-reasoning-live.cjs` 经项目实际宿主策略、管理器与 ZCode 0.17.0 验证三轮：配置默认 `max`，新建时 UI `high`，同 runner 复用时 UI `low`，新进程恢复同一会话时 UI `high`。
- 每轮均读取原生 `session/read`，确认 `settings.model.current.options.reasoningLevel` 和 `settings.thoughtLevel.current` 与该轮 UI 档位一致；复用与恢复后均能正确回忆随机口令。
- 最终日志 `/tmp/sinitek-zcode-reasoning-live-retry.log` 以 `ZCODE_REASONING_PRIORITY_OK; user config unchanged` 结束；用户配置前后 SHA256 一致。
- 初次真实验证曾要求写临时文件，但模型只返回文本、未调用工具，文件断言失败，记录为未通过，见 `/tmp/sinitek-zcode-reasoning-live.log`。随后改用直接对应本轮目标的真实档位与连续上下文验证并通过；本轮不宣称真实写文件验证通过。

### Chromium 渲染

- 使用实际共享 renderer 和 CSS 构建隔离 fixture，通过 Chromium 验证桌面和窄屏两种视口；不是图形 VS Code Extension Host 的完整点击测试。
- 检查七 CLI 的标题、用途标签、无 `.trace-detail`、折叠组件、展开正文及无重叠布局；两种视口均无浏览器错误、HTTP 错误或请求失败，截图已经人工查看。
- 结果：`/tmp/sinitek-trace-subtitle-desktop/result.json`、`/tmp/sinitek-trace-subtitle-mobile/result.json`；截图为相同目录中的 `success.png`。
- 本轮隔离 fixture 服务已停止，端口已关闭；原生测试进程和临时任务目录已清理，不终止用户自己的 CLI 进程。

## 文档、记忆与收尾

- 已同步 `docs/zcode-guide.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- 本轮未改变架构分层或服务边界，无需追加修改 `ARCHITECTURE.md`。稳定行为及排障依据已进入对应事实来源，不重复追加热区记忆或任务事件。
- 保留工作树原有未提交和未跟踪内容，不提交、不清理、不修改用户凭据、配置或 Loop 调度记录。临时日志及截图不写入仓库。
- 重新加载扩展需要执行 VS Code 的“开发人员：重新加载窗口”；仅重新打开配置 Webview 不会重载扩展宿主代码。
- 当前无本轮待办；上述四项既有页面测试失败和未进行完整 Extension Host 点击验证的边界保持可见。
