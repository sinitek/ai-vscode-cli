# CLI 原生压缩与上下文用量适配

- 日期：2026-11-10
- 状态：completed
- 类型：feature
- 负责人：Loop+ 四个交付边界协作
- owner：各实现边界独立交付；主审已完成 Kimi 修复后的串行构建与相关复验，文档边界归档仓库实施计划；宿主父任务最终状态仍由主模型验收决定
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-10-cli-compaction-context-adaptation.md`

## 目标与范围

接入Kimi原生compact及Claude/OpenCode普通回合用量和Webview呈现。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- [2026-11-10-docs-cli-compaction-context-adaptation.md](2026-11-10-docs-cli-compaction-context-adaptation.md)：独立承接文档/事实源交付及其历史校验。

## 验收标准

- 接入Kimi原生compact及Claude/OpenCode普通回合用量和Webview呈现；原可观察契约、非目标和限制以以下分配的原文为准。
- Kimi收尾身份/中文提示是在新能力交付内的实现修正，不凭措辞补造发布bugfix；Node升级属独立交付非本计划chore；145/481/509阶段、7基线失败和OpenCode停顿/未实现即时刷新保留。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文或关联 docs 计划；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-10-cli-compaction-context-adaptation.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 来源头部说明

- 完成日期：2026-11-10

### 背景与目标

依据 `../../../references/cli-context-compaction-audit.md` 的隔离 ACP 实测，Kimi 2.5.2 支持经 `session/prompt` 发送 `/compact`，但没有 `session/compact` RPC。把已有原生能力接入插件，同时补齐 CLI 已提供的上下文用量和窗口真值。

### 四个交付边界与验收标准

- [x] Kimi 后台修复后复验：收尾用量核对真实标签、当前 CLI/UI 会话、持久运行代际、原生映射及 manager 中的 runner 身份；同标签换绑或新运行接管拒绝旧用量，另一标签开始运行仍允许原标签合法迟到用量。隔离压缩保留显式 tabId，新增反馈使用中文；修复定向169项通过，主审当前产物冷热压缩回放通过。同会话、当前操作真实完成才成功，失败隔离、冷恢复不新建、配置凭据隔离与自动压缩条件不变。
- [x] Claude 普通提示用量链路：最近主请求口径及精确响应模型窗口已验收，69项和两种本机 CLI/SDK 模拟协议回放通过；不是付费模型计数验收。
- [x] OpenCode 普通提示用量链路：最新主步骤口径、冻结模型元数据及宿主接线已验收，59项及真实 models --verbose 探针通过；真实 run 未产出步骤，不算端到端成功。
- [x] Webview 既有入口与用量呈现：专项183项通过，12张 Chromium 生成页面/模拟 VS Code 桥截图；不代表真实 Extension Development Host 点击。
- [x] Kimi 修复后的仓库验收：Node v24.22.2 / npm11.19.1 标准构建 exit 0，当前产物两组相关测试448项和61项，共509通过、0失败、0跳过；ontology、引用及差异检查通过。未验证真实环境边界明确保留，不将仓库计划归档等同宿主父任务状态变更。

### 范围与非目标

范围为runner、压缩策略与扩展接线；独立回归开发曾由 test 类型计划承接；该计划已移除，历史测试摘要与限制见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-10-cli-compaction-context-adaptation.md）。资料同步由关联 docs 计划承接。不修改Loop调度状态、任务记录、active ids或通信主文件，不发布、不升级SDK或项目依赖，不用摘要换新会话冒充原生压缩。Node环境升级由独立任务交付，见`../../../references/node24-local-runtime-upgrade.md`，这里只登记验证边界。

### 风险与缓解

- ACP 完成信号是官方文本而非带操作 ID 的结构化事件：要求同会话、操作已开始、RPC 正常结束以及真实完成信号；失败或取消后淘汰进程，避免迟到通知污染后续操作。
- 保留普通回合结束后的 usage_update；压缩文本不作为最终答案；停止后禁止策略继续写会话状态。
- 共享工作区保留并发改动；子任务禁止执行清理 dist 的 `npm run build`，定向编译到独立临时输出；标准构建由父任务串行执行。

### 任务与当前结论

- [x] 读取审计、execution-plan / ontology / CodeGraph 规则及当前接线。
- [x] Kimi 初版实现与历史定向验证（不等于当前最终验收）。
- [x] Claude / OpenCode 普通提示与 Webview 局部证据由父任务核验。

仓库实施计划已完成并归档；此前481项是历史阶段证据，当前主审相关回归为509项。这不是全部仓库测试或真实付费模型端到端验收，也不修改宿主父任务状态。收尾任务不改写 central runner。

### 最终主审复验与能力边界（2026-11-10）

- 当前产物实际运行 `/tmp/kimi-native-compaction-live.cjs`，`kimi-live.log` 确认真实 Kimi2.5.2 热压缩和冷恢复压缩成功且同会话。三个请求均到隔离 loopback 模型 offline-test，实际 usage 为2205/32768，未调用用户付费模型。
- Claude 两种本机模拟协议回放不是付费模型计数验收；OpenCode models 元数据探针通过，但两次真实 run 停顿且无真实步骤，不称真实回合端到端成功。Chromium 生成页面与模拟 VS Code 桥不是实际 Extension Development Host 点击。Windows 实跑、真实模型摘要质量和 token 降幅均未验证。
- OpenCode 当前能力边界：普通主回合用量已接通；摘要生成步骤的账单不等于压缩后占用，没有可信新测量时等待下一主回合是既定契约。即时刷新未实现；后续增强须先取得可归属压缩后主会话的可靠新测量，不能伪造0、复用旧步骤或推测接线。当前证据未显示 CLI 已提供被遗漏的可靠压缩后测量。
- Node 仅新登录 shell 默认切换，旧进程与 VS Code 内嵌 Node 不即时改变；十个全局工具精确版本保留。无私有备份内容进入公共文档。

### 主审批次历史证据与当时剩余边界（2026-11-10）

以下保留前轮原始阶段结论；其中“待修复/复验”是当时状态，当前结论以最终主审复验节为准。

- Webview 专项183项及12张 Chromium 截图来自真实生成页面、模拟 VS Code 桥，不是真实 Extension Development Host 点击。广域7项失败已由主审在修改前快照复现为基线，不在本轮扩大修复。
- Kimi 隔离冷热压缩回放见 `/tmp/loopplus-batch-review.gg8wAs/kimi-live.log`：2.5.2、同会话、三个 loopback 请求、usage 2205/32768；不代表当前收尾身份防护与中文提示验收通过，两项问题交由独立修复任务，父任务需在合入后复验。
- Node 独立交付为新登录 shell 默认 v24.22.2 / npm11.19.1，十个全局工具精确版本保留；已启动进程及 VS Code 内嵌 Node 不会即时切换。这里只导航独立参考，不改环境或公开私有备份。
- 压缩摘要生成步骤账单不等于压缩后占用；无可信新测量则等下一主回合。压缩后立即刷新仍未完成，不用本轮公共登记替代后续可信测量接线。真实模型计数/摘要质量、Windows 实跑和真实宿主点击仍无本轮完成证据。

### Kimi 初版后台验证记录（2026-11-10，历史阶段证据）

以下保留原交付记录，不覆盖历史审计结论；其中局部通过及当时未验证项不替代上述当前主审结论。

- ontology validate、改动文件 trailing-whitespace 与 canonical 仓库 `git diff --check` 通过。
- 未验证：真实模型摘要质量及 token 降幅、Windows 实跑、真实 VS Code 点击、Claude/OpenCode/Webview 边界集成；常规 build 由父任务串行执行。

### 关键接线与兼容性

- 不发送 `session/compact`；不通过摘要换新会话。没有命令广告时等待广告或超时，不把 `/compact` 当普通模型 prompt 试探支持。
- 完成依据是串行同会话的官方开始/完成文本及正常 RPC 结果，不是带操作 ID 的结构化事件。失败、停止、取消或超时后关闭 runner，避免迟到终态污染新操作；正常结束后仍接收真实 usage_update。
- 复用现有 manager 与 `prepareKimiInteractiveLaunch`，无需改写其实现；热 runner 在压缩前重新确认当前模型、模式和思考快照。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。Kimi收尾身份/中文提示是在新能力交付内的实现修正，不凭措辞补造发布bugfix；Node升级属独立交付非本计划chore；145/481/509阶段、7基线失败和OpenCode停顿/未实现即时刷新保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
