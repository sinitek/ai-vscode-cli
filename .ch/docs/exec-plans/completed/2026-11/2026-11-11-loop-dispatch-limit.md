# Loop/Loop+ 统一单次派发与并发上限

- 日期：2026-11-11
- 状态：completed
- 负责人：Codex

## 背景与目标

用户配置单次派发上限为 10，但最多观察到 6 个子任务。经典 Loop 的主任务提示与解析固定为 6；Loop+ 虽读取派发配置，生产并发仍固定为 6。统一配置名称、派发校验和生产运行容量，保留既有配置值及冲突保护。

## 范围与非目标

- 覆盖工具设置文案、经典 Loop 主提示与解析、Loop+ 创建/继续任务及调度快照恢复。
- 继续使用 `loopPlusDecisionSubtaskMax` 存储键，默认 6、范围 1–20，不迁移或清空用户设置。
- 不修改 CLI 自身的子代理限制，不保证模型每轮必须派满，不绕过写入冲突或验收限制。
- 当前工作区已有聊天显示相关修改；只在必要文件上做保留式增量修改，不创建分支、不覆盖原有改动。

## 验收标准

- 该项显示“Loop/Loop+ 单次派发上限”，说明两种模式及实际并发语义。
- 经典 Loop 配置 10 时提示和解析均允许 10，拒绝 11；默认仍为 6。
- Loop+ 仅配置该项为 10 时，可以启动 10 个独立子任务，而不是固定 6。
- 已有 Loop+ 任务继续时刷新容量；恢复不丢失队列、验收或运行状态，不中断已运行 attempt。
- 保留冲突排队和显式宿主并发限制，构建及相关回归测试通过。

## 风险与缓解

- 调高容量会增加本机与 CLI 资源消耗：保留 1–20 的归一化边界和默认值。
- 调低容量时已有运行预留不能被取消：恢复后的有效容量至少覆盖已有运行项；提示使用真实快照容量。
- 老任务快照可能保留 6：显式恢复时由宿主当前策略覆盖容量，但先验证原始快照。

## 验证计划

- `npm run build` 后运行经典 Loop 解析/提示、Loop+ 调度器/编排/适配器与 Webview 设置相关测试。
- 验证 10 个独立任务同时启动、超限拒绝、冲突仍排队及旧快照恢复。
- 可用时用本机 headless Chromium 检查设置标签、提示与保存消息，不调用真实模型或修改用户配置。
- 更新功能清单、Loop 调度设计、能力分册和 ontology，并执行 ontology 校验与单测。

## 任务列表

Tasklist:
- [completed] 排查派发上限配置与限制来源
- [completed] 修复逻辑并统一界面文案
- [completed] 补充回归测试并完成验证

## 决策与文档同步

- 本次配置同时作为经典 Loop 每批派发上限和 Loop+ 生产并发容量；Loop+ 下一轮派发校验读取最新值，新建或继续任务刷新运行容量。
- 内部兼容标识符保留 `LoopPlus` 命名，避免不必要的设置/消息协议迁移。
- 热区记忆不重复记录本次任务；稳定规则同步到产品规格、设计和 ontology。

## 验证结果

- `npm run build`：最终通过。实施时先后发现并修复残留常量引用、测试直接调用私有提示函数的编译问题；提示回归改为走公开的主任务运行入口。
- 定向回归命令（最终同一轮构建产物）：`node --test dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopPlusDecision.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/promptRunRuntime.test.js dist/test/extensionHost/promptExecutionShared.test.js dist/test/core/toolSettings.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/loop/loopParallel.test.js`：501/501 通过，日志 `/tmp/sinitek-loop-dispatch-final-tests.log`。
- 扩大 Loop 域命令：`node --test dist/test/loop/*.test.js dist/test/extensionHost/loop*.test.js`：661 项中 657 通过、4 项失败。失败均在未修改的 `loopPlusGroupChatPanel.test.ts`，涉及群聊计数/文案断言；工作区任务前已存在群聊界面改动。本轮不修改这些范围外代码或断言。
- 基线证据：在内存模块加载器中用 `git show HEAD:src/loopPlusScheduler.ts` 的原始源码替换当前调度器，仅运行上述群聊测试，同样 15 项中 11 通过、同名 4 项失败；其它本轮生产模块未被此文件加载。没有回退、暂存或覆盖工作区文件。日志 `/tmp/sinitek-loop-dispatch-baseline-check.log`。
- 本机 headless Chromium：使用真实构建的 Webview HTML、现有状态夹具和 VS Code API shim，在 1280×960 与 420×880 验证中文标签、已配置值 10、1–20 边界归一化、兼容存储键的保存消息及标签/控件不重叠；浏览器、控制台和网络错误均为 0。产物 `.tmp/loop-dispatch-smoke/result.json` 与同目录截图。
- 上述页面验证未调用真实模型，也未修改用户设置；未启动完整 Extension Development Host，真实 CLI 的资源、限流和模型拆分数量不在自动化保证范围内。
- ontology `--validate` 通过，ontology skill 的 9 项单测通过；界面文案机械检测返回空发现；定向空白检查与 `git diff --check` 通过。
- 已同步能力分册、功能清单、Loop 调度设计与两条相关 ontology 规则。无需重复扩写架构入口或记忆热区；执行证据保存在本计划。

## 当前结论

统一配置和运行链路已交付，已有值 10 无需重设；新版本扩展加载后，Loop+ 旧任务点击继续会刷新容量。上限不是每轮必须派满的配额，冲突及显式宿主容量限制仍然有效。4 项范围外群聊断言失败已完成基线分流，不阻塞本次派发上限修复。
