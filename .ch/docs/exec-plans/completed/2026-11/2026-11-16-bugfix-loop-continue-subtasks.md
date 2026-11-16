# Loop / Loop+ 继续执行自动恢复子任务

- 日期：2026-11-16
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

群聊“继续执行”直接唤醒主任务，而“切模型”会先恢复中断子任务。让继续执行复用同一子任务恢复协调器，保留任务已保存的模型路由、配置和思考力度。

## 范围与非目标

修改群聊协调器及对应回归测试，同步恢复设计、功能规格和 ontology。复用现有经典 Loop 与 Loop+ 恢复机制，不修改模型选择界面、调度协议或会话存储。保留工作区已有的会话消息清理改动。

## 验收标准

- 经典 Loop 继续执行自动恢复中断子任务，完成后再继续主任务，保留继续说明。
- Loop+ 继续执行恢复原开放 attempt；没有活动控制器时通过原有恢复请求重建路径续跑。
- 仍在运行、已完成或已跳过的子任务不重复启动；继续执行不修改模型路由。
- 原配置恢复失败、主模型忙、任务完成及失败上限仍受原门禁保护；重复请求去重。

## 影响面与风险

- 代码：`src/extensionHost/loopGroupChatPanelCoordinator.ts`。
- 测试：群聊协调器、子任务恢复协调器、Loop+ 集成。
- 风险：恢复回调重复进入子任务恢复、继续说明丢失、主子重复启动。通过仅续主任务的内部回调和回归用例约束。
- 回滚：撤回本次协调器接线及对应文档，不改持久化格式。

## 验证计划

- `npm run build` 后运行群聊、模型切换、恢复与 Loop+ 集成的最小相关单测。
- 按影响面执行原生 Loop+/Codex 隔离验证入口，记录证据与覆盖边界。
- ontology validate 和对应 Python 单测；`git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：新增 8 项群聊继续回归，覆盖经典原档案与旧任务回退、Loop+ 用户消息、完成/忙/失败上限/档案失效门禁及异常重试。更新真实 adapter 集成，验证原 attempt、活跃同级和模型路由。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/loop/loopGroupChatCoordinator.test.js dist/test/extensionHost/loopModelSwitchResume.test.js dist/test/loop/loopModelSwitch.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js` 共 242/242 通过；ontology validate 通过，ontology Python 测试 9/9 通过。`python3 verify_mac.py --report /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/loop-continue-macos-5kmzl_t2/verification.json` 默认三轮退出 0，71 个必要回归文件共 1209/1209；三轮 pool 与公共 runner 交接通过，四组清理确认，20 个诊断 PID 已退出，692 个源码/脚本/配置指纹一致。完整证据位于 `/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/loop-continue-macos-5kmzl_t2`。
- 失败处理记录：新增测试初次构建因闭包变量被 TypeScript 收窄为 never 失败，改用调用记录数组后通过。首轮 242 项中集成用例停止后立即检查订阅清理失败（241/242），归类为异步夹具断言时机问题；改为按现有集成约定等待完成订阅释放，重跑 242/242 通过。
- 功能清单与设计：已同步 `FEATURE_INVENTORY.md`、能力规格、`loop-crash-recovery.md`、`vscode-cli-extension-runtime.md` 及两条 ontology 规则。
- 真实图形宿主与 Windows 本机：本轮环境未覆盖；本次不修改 Webview HTML 或样式。

## 任务列表

- [completed] 核对继续执行和切模型的恢复差异
- [completed] 接入子任务恢复并补充回归
- [completed] 验证并同步文档归档

## 决策记录

- 2026-11-16：CodeGraph 定位到切模型独有的 `resumeLoopSubtasks` 接线；直接核对当前代码后复用现有恢复协调器，避免新增调度规则。

## 当前结论

实现、相关回归、macOS 原生隔离检测与语义文档同步均完成。热区记忆检查后无需追加单次任务记录，稳定结论已写入运行时设计。

覆盖边界：真实 adapter 集成使用模拟模型；macOS 原生检测使用真实 Codex 进程与本机模拟模型，不覆盖 Windows、其它 CLI 的本机真实运行、已安装扩展/图形宿主点击或真实模型任务。无需浏览器排版验证，本次未改 Webview 结构、样式或消息协议。
