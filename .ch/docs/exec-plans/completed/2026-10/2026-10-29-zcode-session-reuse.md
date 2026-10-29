# ZCode 连续回合会话复用修复

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

用户会话记录显示首条 `hi` 正常完成，第二条任务及自动重试均报 `ZCode runner is already started.`。管理器复用了健康 runner，但每回合宿主都会调用 `start()`，ZCode 尚未遵循其他 CLI 的可重复启动契约。

## 范围与非目标

- 检查并修复 ZCode runner 的连续回合生命周期，补齐回归测试。
- 以当前默认配置进行同一进程连续任务及进程重建后的会话恢复验证。
- 同步运行时事实、功能清单和本体；不改变配置页、模型配置、用户历史或 Loop 调度记录。
- 保留工作区原有未提交改动；不提交、不切分支、不清理其他修改。

## 验收标准

- 仅完整初始化的健康 runner 可复用；多次 `start()` 返回同一原生会话，不重复创建或订阅，也不重启子进程。
- 已退出、失败或已释放的 runner 不作为健康会话继续使用。
- 连续任务均获得独立正文、完成事件和上下文用量，快速事件不丢失。
- 默认配置真实执行至少两个连续任务；关闭后能恢复同一原生会话继续执行。
- `npm run build` 和最小相关单元测试通过，额外失败分类记录。

## 影响面与风险

- 代码：`src/interactive/zcodeRunner.ts`；测试：`src/test/interactive/zcodeRunner.test.ts`。
- 文档：运行时参考、功能清单、ZCode 指南及运行时本体。
- 风险：重用失效进程、重复注册事件、发送确认前到达的事件丢失；通过失败边界、连续回合夹具与真实 CLI 验证。
- 凭据仅从现有用户配置读取，不输出或复制到仓库；真实任务使用临时目录。

## 验证计划

- 先补回归测试，验证旧实现在第二次启动时报错。
- `npm run build`；`node --test dist/test/interactive/zcodeRunner.test.js`。
- 扩展到协议、管理器、会话生命周期和交互宿主测试。
- 本机真实 CLI 使用默认模型和思考档位，在临时目录创建文件、第二回合修改，并在新进程恢复会话后检查仅存于历史消息中的随机口令。
- `git diff --check` 和 ontology 校验。

## 测试与清单同步

- 单元测试新增/更新：覆盖重复启动、管理器返回同一 runner、恢复后复用、初始化失败、失效/释放边界、发送确认前的正文和终态、发送拒绝清理、取消及并发提示拒绝；同时验证最新设置和用量。ZCode runner 共 14 项用例。
- 单元自测结果：`npm run build` 通过；协议、runner、trace、管理器、会话生命周期、交互策略、提示运行时和配置共 8 个测试文件、100 项全部通过。ontology 校验及其 9 项单测通过；`git diff --check` 通过。
- 单元命令：`node --test dist/test/interactive/zcodeRunner.test.js dist/test/interactive/zcodeAppServerProtocol.test.js dist/test/interactive/zcodeTrace.test.js dist/test/interactive/manager.test.js dist/test/session/sessionLifecycleCoreCoverage.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/config/zcodeConfig.test.js`。
- 失败处理记录：旧实现下新增 6 项回归均失败，包含用户同款 `already started` 和提前到达的事件丢失。扩展用量断言时曾因夹具漏写快照 `protocol` 元数据失败，按协议修正夹具后通过，未放宽断言。补充初始化失败测试又暴露订阅/模型设置失败后仍被标为可复用，新增初始化完成标记后 100 项全过。
- 功能清单及事实文档：已同步 `FEATURE_INVENTORY.md`、运行时参考、ZCode 指南和运行时 ontology。修复遵循现有管理器/宿主边界，不改变架构或 UI，故无需改架构文档或运行浏览器测试。

## 本机验证记录

- 使用当前默认配置的 `glm-5.3-flash_sub-coco` / `max`，经过实际 `createZcodeInteractiveTurnStrategy` 和 `InteractiveRunnerManager` 驱动真实 CLI；仅 VS Code 模块使用仓库 mock，不代表图形 Extension Host 点击验证。
- 已验证首回合创建文件，第二回合在同一 runner、进程与会话下追加内容，文件断言通过，且模型正确复述仅在上一回合消息中给出的随机口令。
- 首次真实脚本总预算为 180 秒，前两回合成功，第三回合因脚本超时主动取消；这是验证时间预算不足，不是第二回合的生命周期错误。已用已存在的测试会话续接后续验证，预算调整为 600 秒，避免重跑已通过的文件任务。
- 恢复验证通过：在新进程恢复同一测试会话，模型正确复述历史口令；恢复后的第二个任务继续复用同一 runner，并再次正确回复口令。
- 最终构建额外复测也通过：再次恢复同一会话并连续执行两个任务，均返回正确历史口令，`ZCODE_SESSION_REUSE_OK`，配置内容保持不变。一次模型请求返回较慢，原生日志显示已进入 `model.request.started` 而非会话启动失败，最终正常完成。
- 脚本与证据：`/tmp/sinitek-zcode-reuse-live.cjs`、`/tmp/sinitek-zcode-reuse-live.log`、`/tmp/sinitek-zcode-reuse-resume-live.log`、`/tmp/sinitek-zcode-reuse-final-live.log`、`/tmp/sinitek-zcode-reuse-before.log`、`/tmp/sinitek-zcode-reuse-partial-before.log`、`/tmp/sinitek-zcode-reuse-build.log`、`/tmp/sinitek-zcode-reuse-regression.log`。

## 收尾与知识沉淀

- 真实任务的临时目录已删除，测试 runner 已释放；不删除原有用户会话、不修改用户配置、不改 Loop 调度状态。
- 可复用的根因和使用前提已沉淀到 ZCode 指南、运行时参考及 ontology，不重复追加到热区或 `ROLLING_SUMMARY.md`。
- 用户需执行“开发人员：重新加载窗口”加载修复后的扩展宿主，然后可在原会话继续；仅重开配置 Webview 不会加载宿主代码。

## 当前结论

根因已修复，最终构建及 100 项相关回归通过；ontology 的 9 项单测与结构、空白校验通过。默认配置的真实同进程连续文件任务、进程重建后的原生恢复及恢复后再次复用均已跑通，最终构建复测通过。用户配置和原有历史没有修改；只创建独立临时测试会话。
