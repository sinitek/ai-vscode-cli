# 产研部群聊展示接口

此文档描述可选 Webview 投影、组长弹窗及记录驱动的协调器授权边界；不表示中央组合、组织任务启动或跨任务持久化已接通。已有 Loop/Loop+ 不提供 `department` 时继续使用原展示。

## 只读投影

`src/webview/loopGroupChatPanelTypes.ts` 导出 `DepartmentGroupChatProjection`，并由 `LoopGroupChatPanelState.department?` 引用。字段为：

```ts
type DepartmentGroupChatProjection = {
  role: "director" | "leader";
  rootTaskId: string;
  parentTaskId?: string;
  title: string;
  overallProgressPercent?: number;
  director: LoopGroupChatPanelParticipant;
  leaders: Array<{
    taskId: string;
    leaderNumber: number;
    participant: LoopGroupChatPanelParticipant;
    progressPercent?: number;
    employees: LoopGroupChatPanelParticipant[];
  }>;
  maxLeaders: number;
  maxEmployees: number;
  activeLeaders: number | null;
  activeEmployees: number | null;
};
```

成员投影直接消费每组 `employees`，不推断归属。总监成员面板只显示总监和组长。每个组长行展示本组执行尝试的“运行中”（`running`）、“验收中”（`reviewing`）、“待验收”（`queued_review`）、“待启动”（`pending`）、“已阻塞”（`blocked`）和“已完成”数量。运行中断且仍留在运行队列的尝试投影为 `blocked`。完成免验收执行的 `finished` 和 `reported` 尝试均投影为 `no_acceptance`。“已完成”合计 `completed`、`acceptance_passed`、`acceptance_failed` 和 `no_acceptance`，其中验收成功和失败沿用 Loop+ 的“已验收”口径。员工明细只在对应组长群聊中展示。组长 `taskId` 留空表示群聊尚未创建，入口禁用；`participant.sessionId` 是 CLI 会话 ID，不是群聊创建证据。新建产研部的额度逐项按有效工作区设置、有效全局设置、默认值取用；默认同时最多 4 名组长（无例外）、全部门共享 16 名常规并发员工。已有任务沿用启动时保存的额度。零余额时每组仍最多持有一个未释放的超额员工，员工实际执行结束且清理完成后才释放额度。成员面板只展示宿主提供的占用与状态，不在成员面板内编辑额度。

组长群聊的子任务复用 `getLoopSubtaskDisplayTitle`，按所属组长的 `subTasks` 位置显示“子任务 N：标题”。同一子任务的多次执行沿用同一编号。子任务 Tab 及悬停提示复用普通 Loop+ 路径，不投影产研部角色或姓名。任务、attempt、验收定位和权限校验继续使用各自的原有 ID。

成员面板不提供员工列表折叠交互：总监面板始终只显示状态数量标签，组长面板始终显示本组员工明细。

总监视图固定总监在首位，下方组长按模块顺序倒排。组长视图固定本人在首位，下方员工按执行尝试进入 `seenAttempts` 的顺序倒排。排序仅用于成员面板渲染。

从总监成员面板打开对应的组长群聊，在组长群聊的工具栏点击“中止”来停止该组任务。

群聊页头、Webview 标签页和组长弹窗使用短标题。总监群聊显示“产研部群聊”，组长群聊显示“组长A”“组长B”等。`leaderNumber` 取可信总监任务中关联模块的位置，从 1 开始，按组长上限循环映射为字母。上限为 4 时，第五个模块从 A 重新开始。尚未创建群聊的模块仍占用对应位置，已有组长的编号保持一致，即使可见列表变化。组长成员行、分配员工弹窗和组长 Tab 悬停均显示字母编号与完整模块名。导航和员工归属始终使用任务 ID。组长页无法匹配当前任务时显示“组长”。总监群聊副标题只显示当前任务 ID，与 Loop+ 群聊一致。组长群聊副标题显示完整模块名和任务 ID。总监和组长群聊的成员区保留“总／组／员”圆形头像。总监行只显示“总监”，组长和员工展示各自标题。初始渲染与 `contentPatch` 一致。

总监群聊在已创建的组长状态文案右侧显示 `progressPercent`。宿主从可信组长记录复用组长群聊的总体进度计算；组长状态更新后，已打开的总监页接收 `contentPatch`，无需打开组长弹窗。未创建的组长不显示百分比。

总监群聊工具栏在全部已登记模块都有有效权重时，按 `Σ(模块权重 × 可信组长进度) / 100` 实时计算总体进度。权重是整体目标的绝对份额，尚未取得可信组长进度的模块贡献 0。结果四舍五入为整数，整体仍在进行时最高显示 99%，完成门禁通过后显示 100%。

总监用 `subtasks[*].progressWeightPercent` 为新模块指定 1–100 的整数权重。范围变化时，`continue` 决策可通过 `directorProgressWeights` 和已登记模块 ID 调整既有权重，调整与新派工一并保存。总权重超过 100 或模块 ID 无效时暂停本轮派工。缺少有效模块权重时，工具栏沿用根任务的 `loopProgressPercent`。组长进度变化时，已打开的总监群聊通过 `contentPatch` 刷新工具栏。

## 浏览器到宿主

### 分配员工弹窗

总监群聊的工具栏移除“刷新”按钮，保留自动刷新。“分配员工”紧接在“我要提问”右侧。弹窗消费宿主 `employeeAllocation` 投影，每组仅提供输入框，改动由右下角唯一“保存并关闭”统一提交，不提供“恢复均分”。多个组长额度按顺序写入，并逐项等待宿主持久化回执和递增版本；全部成功后关闭。任一项失败时保持弹窗打开，保留未保存草稿并显示对应组错误以便重试；部分已确认的保存不回滚。右上角复用通用 SVG 关闭图标，关闭或按 Escape 不提交未保存编辑。`contentPatch.employeeAllocationHtml` 独立于成员树刷新，保留打开时的草稿和焦点。写入仍走既有 `updateDepartmentEmployeeLimit` 和版本核验，成功由宿主回执确认，下次派发生效。服务不可用或没有可信组长记录时不能保存；普通 Loop/Loop+、组长群聊和组长消息转发均无此编辑入口。组长群聊保留本组额度的只读状态。

```ts
type DepartmentGroupChatModalTarget = { taskId: string; instanceId: string };

// 保留目标 ID 请求，不代表授权，不另建 Webview。
{ type: "loopGroupChatChat:openDepartmentTask"; taskId?: unknown }

// load/retry 在 openDepartmentTask 之前发送，用于登记当前视图实例。
DepartmentGroupChatModalTarget & {
  type: "loopGroupChatChat:departmentModal";
  action: "load" | "retry" | "close";
}

DepartmentGroupChatModalTarget & {
  type: "loopGroupChatChat:departmentTaskMessage";
  message: DepartmentGroupChatTaskMessage;
}
```

`DepartmentGroupChatTaskMessage` 是原 `LoopGroupChatPanelBaseMessage` 去掉 `openDepartmentTask` 和四种验收方案修改消息后的类型。运行时还通过 `DEPARTMENT_GROUP_CHAT_TASK_MESSAGE_TYPES` 限制为 domReady、刷新、继续、切模型、补充需求、提问/中止/开关提问、停止、沟通文件预览、澄清以及图片/链接消息。domReady 由展示类消费，其余作为带 taskId/instanceId 的 envelope 交给宿主，绝不退化成总监的无目标消息。

组长群聊的“继续”通过部门续接入口向当前组长的 Loop+ 调度器提交需求，入队前重新校验展示绑定与组织归属。已经停止的组长由总监的组织继续入口恢复。组长群聊提问与组长的调度回合同用 Tab 队列，只有已绑定原生会话且当前代次可执行时才能由原 Owner 回答。

宿主必须验证同部门关系、当前弹窗绑定、消息白名单及各动作的参数和权限。浏览器提供的 taskId、instanceId、嵌套 message 都不是授权。

## 宿主注入 API

`LoopGroupChatPanel` 提供：

```ts
getDepartmentModalTarget(): DepartmentGroupChatModalTarget | undefined;
setDepartmentModalState(target, state: LoopGroupChatPanelState, thread?: LoopAskThread): boolean;
setDepartmentModalError(target, error: string): boolean;
publishDepartmentModalAskThread(target, thread: LoopAskThread): boolean;
postDepartmentModalCommunicationFilePreview(target, message: LoopCommunicationFilePreviewMessage): boolean;
postDepartmentModalMessage(target, message: { type: string; [key: string]: unknown }): boolean;
closeDepartmentModal(target?: DepartmentGroupChatModalTarget): boolean;
```

除无参数关闭当前弹窗外，所有更新严格匹配当前 taskId + instanceId；注入状态还要求 `state.task.id` 一致且 `department.role === "leader"`。失效目标返回 false。`postDepartmentModalMessage` 是可信宿主响应通道，可发送原 contentPatch、模型/继续 settlement、图片解析等消息；调用方负责响应白名单和业务鉴权。

首次注入生成本地 srcdoc；后续 `setDepartmentModalState` 复用 contentPatch，不重建总监 Webview 或当前组长子文档。加载失败显示宿主错误，重试重新生成实例 ID。关闭只关闭容器。

内部宿主到 Webview envelope 为 `departmentModalContent`（目标、title、初始 html 或 error）、`departmentModalMessage`（目标、message）及 `departmentModalClose`（目标），其 type 前缀均为 `loopGroupChatChat:`。这些 envelope 由上述 API 构建，不是浏览器 HTML 注入入口。

## 隔离与统一验收

弹窗复用 `modalComponents`。iframe 仅使用本地生成的 srcdoc、原 CSP nonce 和 `sandbox="allow-scripts"`，不允许同源能力或任意 URL。父页接收子消息须同时匹配窗口来源、opaque origin、目标和实例；子页只接收父窗口的绑定 envelope。子消息在捕获阶段消费，不能流入父页旧消息监听器。每个目标独立保存阅读状态、草稿和气泡窗口。

### 动态主题桥接

父页通过 `MutationObserver` 监听 html/body 的 `style`、`class`、三个 `data-vscode-theme-*` 属性，以及 head 内样式表节点/文本和 media/disabled 属性变化；不轮询。快照读取父页 body 的 computed style（包含继承自 root 的变量），仅收集 `^--vscode-[a-zA-Z0-9_-]+$` 变量。创建时通过 frame.name 初始化，iframe load 时强制补发最新快照，之后只在快照变化时发送。关闭或切换后只向当前 frame + taskId + instanceId 发送，旧 frame 的 load 回调失效；同步不重建文档或触碰草稿、焦点、滚动与提问状态。

内部父→子控制消息（不是新增的浏览器→宿主动作，也不增加宿主消息权限）为：

```ts
type DepartmentThemeMetadata = {
  classes: string[]; // 仅 vscode-light/dark/high-contrast/high-contrast-light
  attributes: Partial<Record<
    "data-vscode-theme-kind" | "data-vscode-theme-name" | "data-vscode-theme-id", string
  >>;
};
type DepartmentThemeSnapshot = {
  variables: Record<string, string>; // 仅上述 --vscode-* 名称
  root: DepartmentThemeMetadata;
  body: DepartmentThemeMetadata;
  colorScheme: string; // 仅 normal/light/dark/light dark/dark light
};
{
  channel: "department-host";
  taskId: string;
  instanceId: string;
  message: { control: "theme"; theme: DepartmentThemeSnapshot };
}
```

子桥只接受绑定的 parent 窗口、channel、taskId、instanceId，重新过滤变量名和值类型、主题 class、属性及 colorScheme，移除旧快照中已失效的变量与主题属性，保留非主题页面 class。`frame.name` 使用相同快照过滤路径；它在初始化后清空。不接受任意 HTML、URL、style 属性名或 class。现有 sandbox/CSP 与双向来源绑定不变。

纯展示投影可配置“统一验收方案”，此入口不赋予总监验收职责。记录驱动的部门协调器设置 `acceptancePlanReadOnly: true`，总监群聊移除“统一验收方案（只读）”面板，宿主拒绝四种方案修改消息。组长隐藏方案选择、编辑、覆盖入口，展示“继承产研部统一验收方案”及快照名称，保留 Loop+ 实际验收结果和定位。

弹窗 API 对纯展示投影沿用总监当前 `acceptancePlan`；记录驱动且只读的注入状态直接采用协调器从根记录读取的最新快照，避免子任务刷新被父页旧快照覆盖；总监状态更新会同步当前弹窗的展示。宿主仍需持久化根任务快照并统一传播到所有组长。UI 不自动跟随全局模板编辑，不实现跨任务写入。无快照时组长群聊展示“尚未同步统一验收方案”。

## 验证入口

专用输出 `.tmp/department-group-ui-dist/dist` 编译，专用父目录中的 media/node_modules 链接保留 Markdown 静态资源相对布局。回归范围为 departmentGroupChatPanel、loopGroupChatPanel、loopPlusGroupChatPanel、loopGroupChatAcceptance。`scripts/department_group_chat_smoke.cjs` 使用生成 HTML 和注入夹具验证浏览器展示及消息隔离，不启动组织任务。实际执行结果见 round-6 尝试报告。

增量主题验证可设置 `DEPARTMENT_UI_THEME_ONLY=1`，只在 1440px 的同一已打开弹窗执行深→浅→深，检查 computed style、失效 token 清理、主题属性及正常 contentPatch 后的目标绑定、草稿、焦点与父子滚动。可用 `DEPARTMENT_UI_DIST`、`DEPARTMENT_UI_EVIDENCE` 指向独立编译和证据目录。round-13 使用 `.tmp/department-group-ui-dist/round13/`；不重复此前四组合验证。真实 VS Code 主题事件、Extension Development Host 的 CSP/预览以及宿主组织鉴权仍需集成验收；此脚本只模拟宿主注入。


## 记录驱动的宿主边界（round-17）

`src/extensionHost/departmentGroupChatProjection.ts` 从 `LoopTaskRecord` 和 `normalizeDepartmentMetadata` 构建投影，不读取标题、模型入参或 CLI session 来决定归属。`departmentInvalid` 优先拒绝；根必须是 rootTaskId 指向自身、parentTaskId/leaderSubtaskId 均为空的总监记录。组长必须具有独立 `event_driven` 记录、相同非空 workspaceKey、rootTaskId/parentTaskId 均指向根，且 leaderSubtaskId 精确对应根 subTasks 中的真实 ID。多个记录占用同一 leaderSubtaskId 时不展示、不授权。round-23 起仅通过受信任 root/module 索引发现 ID，每个记录都重新从 readTaskRecord 读取并检查实际 ID；没有全库列表回退。

员工来自组长已校验的 Loop+ snapshot 的 seenAttempts，并与该组长 subTasks 精确关联；缺失或非法执行快照不按任务数量猜员工。participant.id 为 attemptId，新增可选 `subtaskId?: string` 保留验收定位；历史结果与当前 running/pending 状态保留在对应组长下。这里没有员工实际会话 tab 的 👶🏻 接线。

协调器新增可选 typed 依赖（不会导入尚未交付的组织控制模块）：

```ts
readDepartmentCapacity?: (rootTaskId: string) => DepartmentCapacitySnapshot | null;
readDepartmentLeaderTaskIds?: DepartmentLeaderOwnershipReader;
// Exported from extensionHost/departmentGroupChatProjection.ts:
type DepartmentLeaderOwnershipReader = (rootTaskId: string, leaderSubtaskId: string) => readonly string[] | null;
departmentOrganizationControl?: DepartmentOrganizationControl;
export type DepartmentOrganizationControl = {
  continue(root: LoopTaskRecord, prompt?: string): Promise<void>;
  stop(root: LoopTaskRecord): Promise<void>;
  complete(root: LoopTaskRecord): Promise<void>;
};
// createLoopGroupChatPanelCoordinator 的新增返回方法
completeDepartment(rootTaskId: string): Promise<void>;
```

容量只读端口复用 `src/departmentcapacity.ts` 的现有 snapshot 类型；匹配根且通过基本结构检查才读取 leaders/employees 租约计数。端口缺失、返回空、根不匹配或抛错时 activeLeaders/activeEmployees 为 null，显示“未知”，max 来自根固化 limits；不以发现的任务数量或伪造 0 代替租约。此端口不 acquire/release、不操作容量池。

round-20 将展示投影与授权分离；round-23 将 `buildDepartmentGroupChatProjection` 的实际展示刷新也改为逐个根 subtask 查询完整模块索引并构建成员树，不再枚举全部任务库。动作入口、await 后副作用、资源回调及回包前的 `validBinding` 仍逐次读取当前根和组长记录，但只通过 `readDepartmentLeaderTaskIds(rootTaskId, leaderSubtaskId)` 查询该模块完整的当前归属，不调用任务库列表、容量或员工投影。端口必须由受信任宿主提供可同步读取的归属索引，创建、删除、重新归属或 workspace/元数据变化必须在对应记录可见前同步更新或使索引失效；索引重建、过期或不可保证完整时返回 null。不得把旧 UI 投影、浏览器 ID/修订号、遗漏新组长的缓存或每次全库扫描实现充当这个端口。

查询只有恰好一个 ID 且等于已绑定组长时才继续；再次读取该 ID 的真实记录并核对根、模块、workspace、event_driven 和合法元数据。重复模块、空/异常结果、端口缺失或抛错全部拒绝加载与敏感动作。round-23 起中央组合未注入索引、查询返回 null 或抛错时，不生成部门投影且不能加载组长内容；根记录仍保持验收方案只读，不能借不可用状态恢复普通方案编辑。模块相同名称不构成重复，归属按根 subtask ID 判断。没有缓存授权结论，也不把同一轮入口成功当作异步回包授权。

现有 departmentModal load/retry 登记当前总监面板、rootTaskId、leader taskId 和 instanceId 的绑定，验证成功后复用 setDepartmentModalState 加载。openDepartmentTask 不单独授权或新建组长 Webview。departmentTaskMessage 先校验绑定、记录关系和独立白名单，再用绑定 taskId 进入既有动作处理；嵌套 payload 的 taskId/rootTaskId/instanceId 不参与选目标。展示 API 序列化只提取 taskId/instanceId，禁止将内部 panel 等绑定字段扩散到子文档或消息中。使用 AsyncLocalStorage 保留异步响应作用域，副作用端口及回包在 await 后重新检查当前绑定；不把同一 panel 以组长 ID 注册到 panelsByTaskId。

继续、停止、补充、提问/取消、澄清、切模型复用既有验证和执行路径。组长 askThread、settlement、沟通预览和资源响应通过绑定响应通道投递。没有独立 Webview 的组长仍能由 refresh/refreshOpenPanelForTask 更新当前弹窗。关闭、切换或 dispose 取消展示订阅和该展示的提问队列，不调用任务停止；已经提交给执行端的真实任务不会因关闭展示而停止。旧模型调用可能继续在执行端收尾，但其回答不能写入新实例。

沟通文件预览保留 collectLoopCommunicationPreviewRoots/readLoopCommunicationFilePreview。子页图片与链接也先按该任务许可根做 realpath/目录边界检查；网络 URL 沿用原链接处理。复用的 ChatImageHost/openChatLink 增加可选当前实例与基目录上下文，异步读取/保存对话框返回后失效实例不再执行打开/写入或响应；普通调用不传上下文，行为不变。

round-20 每个有效弹窗绑定只持有一个 ChatImageHost，图片消息和图片链接共用其预览面板；响应闭包显式捕获绑定对象，不依赖调用回调时的 AsyncLocalStorage 是否存在。基目录读取当前记录，许可根/realpath 检查继续逐消息执行。关闭、切换、重试或总监面板 dispose 调用资源宿主 dispose：使预览请求失效并关闭该绑定的图片面板；迟到读取、解析回包及保存对话框返回仍重新核对当前实例，不能打开新面板、污染另一绑定或写文件。普通会话的 invalidate 保持原语义，不自动关闭其预览。

总监根继续/停止/完成只调用显式组织控制端口。缺失时中文拒绝，不退回 runLoopPrompt/stopRunsForTask/单任务完成；切模型只更新根模型，不直接恢复根的旧单任务子调度。组长仍保留完整 Loop+ 动作栏与验收结果。根固化 loopPlusAcceptancePlan 是只读展示源，组长不能覆盖；无 department 的普通 Loop+ 仍可编辑。

round-20 澄清保留活跃 waiter 的正式提交/拒绝路径；无 waiter 时先成功保存答案、清除 pendingClarification，再重读当前根记录并验证原角色及根关系，通过组织 continue 恢复。端口缺失时明确提示“澄清已保存，无法继续产研部”；保存失败、关联失效或角色变化均拒绝，不调用 resolveMainPromptTarget 的创建路径或 runLoopPrompt。拒绝澄清及继续也先验证 departmentInvalid 和根关联；无 waiter 拒绝仅暂停记录，不启动任务。runLoopPrompt 副作用端额外重读目标，防止延迟的普通/组长恢复在角色已变成总监或元数据失效后回落单任务执行。普通 Loop+ 无 waiter 澄清继续沿用原执行路径。

### 中央组合与验收门禁

群聊边界不修改 extension.ts，不接管组织创建或执行控制；round-23 另提供索引定位的真实文件读取端口。已有中央组合提供的读取端口驱动记录投影；round-23 已交付生产归属索引及真实存储事件适配器，但其唯一实例、来源生命周期、容量和组织控制端口仍须由中央组合显式挂载。实际任务记录的元数据生成/leaderSubtaskId 写入必须与以上契约一致；不符合即拒绝，不能根据名称“修复”。跨任务方案持久化传播、真实 VS Code/CLI 执行、员工会话 tab 图标仍待中央集成。Chromium 和 coordinator 测试中的任务与宿主均为夹具，不声称真实扩展组织导航成功。

Ontology 后续同步项：部门根/组长/员工 attempt 的身份与关系证据；展示实例与任务权限的区分；只读租约未知状态；组织生命周期端口禁止单任务回落；根验收快照的只读事实来源；关闭展示与停止任务的不同生命周期。由拥有部门领域本体的中央集成统一同步，本轮不更改其执行/调度事实。

round-20 追加 ontology 交接：展示投影不作为归属授权缓存；受信任完整模块归属索引及其同步失效责任；无 waiter 澄清持久化后通过组织端口恢复；绑定资源面板与任务执行的独立生命周期。本轮不修改领域 ontology 或容量/调度实现。


round-17 新增 `scripts/department_group_chat_host_smoke.cjs`：真实 Chromium 使用真实渲染器与协调器、模拟 VS Code 和任务记录端口，验证未知占用、根只读快照、当前组长提问的实际按钮点击、子任务刷新及返回关闭后的父页 120px 阅读位置和入口焦点。嵌入页发送按钮使用 type=button 调用原 submitAskChat（兼容键盘点击/Ctrl+Enter），避免 sandbox 未授予 allow-forms 时原生 submit 被浏览器阻止；无嵌入的普通群聊保留原 type=submit。没有添加 allow-forms 或修改 CSP/主题桥接。


## 生产归属索引与存储接入（round-23，尚未中央装配）

`src/extensionHost/departmentOwnershipIndex.ts` 导出 `DepartmentOwnershipIndex`、`DepartmentOwnershipSource`、`DepartmentOwnershipSourceLifecycle` 及 `createLoopTaskStoreDepartmentOwnershipIndex(lifecycle)`。初始状态 new，不自动枚举或授权。`rebuild(): boolean` 同步严格枚举一次持久化文件，所有文件读取成功且来源租约在前后持续有效才发布 ready；重建期间查询拒绝，变更打断或失败使旧完整性声明永久失效，必须显式再次完整重建。`invalidate(): void`、`dispose(): void` 幂等拒绝后续查询，dispose 同时释放两个订阅及内存贡献。`state` 只读，值为 new/rebuilding/ready/invalid/disposed，不属于浏览器授权协议。

```ts
export type DepartmentOwnershipSourceLifecycle = {
  isCurrent(): boolean;
  subscribe(invalidate: () => void): { dispose(): void };
};
export type DepartmentOwnershipSource = {
  listFiles(): readonly string[];
  readFile(filePath: string): readonly LoopTaskRecord[] | null;
  subscribe(listener: (event: LoopTaskStoreChange) => void): { dispose(): void };
  lifecycle: DepartmentOwnershipSourceLifecycle;
};
// 实例字段可直接作为绑定回调传入，无需重新 bind：
index.readDepartmentLeaderTaskIds: DepartmentLeaderOwnershipReader;
index.readTaskRecord: (taskId: string) => LoopTaskRecord | null;
```

归属贡献按规范化物理文件路径替换，按 workspace/root/module 分区，记录 ID 和文件位置同时索引；重复读取不追加成员。相同模块不同任务以及相同任务出现在不同文件都保留歧义，不使用最后写入覆盖。查询按唯一根的 workspace 选择模块；必须由 authorizeDepartmentLeader 恰好匹配一个 ID 后再读当前真实记录，继续验证 root/parent/module/workspace/event_driven/departmentInvalid，不改变原授权强度。非法部门记录因无法保证原归属影响范围，保守使模块查询不可用，不能忽略它后声称穷尽。

`readTaskRecord` 使用唯一物理文件定位重新读取当前任务，不做全库发现；读取失败、任务重复、同文件归属字段与索引不一致时拒绝并失效。仅正文/结果更新不缓存旧内容。来源 `readFile` 读取本文件所含任务，不代表重新扫描任务目录；大共享单文件的读放大仍遵循现有存储布局，本轮不重构持久化格式。中央应同时注入这两个字段，不能在失败时回退到扫描整个任务库的 reader。

LoopTaskStore 新增窄合同（原 void 写入 API 保留）：

```ts
export type LoopTaskStoreChange =
  | { type: 'replace'; filePath: string; tasks: readonly LoopTaskRecord[] }
  | { type: 'invalidate'; filePath?: string };
subscribeLoopTaskStoreChanges(listener): { dispose(): void };
tryWriteLoopTaskStore(filePath, store): boolean;
deleteLoopTaskStoreFile(filePath): boolean;
readLoopTaskStoreResult(filePath, requireExisting = false, requireComplete = false):
  { ok: true; store: LoopTaskStore } | { ok: false };
listLoopTaskStoreFilesStrict(): string[];
```

原 `writeLoopTaskStore(): void` 代理到已确认写接口，仍记录错误且不抛出；索引只订阅实际 writeFileSync 成功后的规范化数据，不依据旧 void 返回值发布归属。失败读/写/删除先同步通知失效；随后成功写不自行恢复完整性。updateLoopTaskRecord 使用结果接口，失败返回 null；路径迁移先确认目标，再确认源删除/重写，二者均成功才返回身份。部分失败保留可恢复文件，索引失效，不伪称事务回滚。迁移中的重复物理贡献会拒绝授权。旧 departmentDeliveries、根固化验收快照和其他规范化字段保持原逻辑。

所有已知 write、append、更新、legacy 迁移、删除与保留清理通过同一同步事件通道。普通兼容读取仍容忍单个无效记录；生产重建使用 requireExisting+requireComplete，任何格式错误或已枚举文件消失都不能变成空索引。严格发现包含当前及遗留存储，拒绝 symlink 与目录读取错误，不自行执行迁移。删除成功发布空文件贡献；保留清理读取失败不会错误删除该文件。

### 中央唯一装配责任

1. 在首次记录可见前挂载来源生命周期并创建索引；首次/重启/导入/恢复后显式 rebuild，失败拒绝部门操作。随后向 coordinator 注入 readDepartmentLeaderTaskIds 与不扫描目录的 readTaskRecord。普通非部门 reader 的组合及唯一实例注册由中央负责，本轮未修改 extension.ts。
2. 正常同进程持久化由真实存储订阅增量同步。外部写者、路径移动、导入、恢复等不经过存储端口的变化必须在公开变更前撤销 isCurrent 并触发 invalidate；Watcher 错误/溢出/未知事件也触发失效。仅有异步 fs.watch 通知无法证明同步新鲜性，不可用恒真租约冒充生产保证。中央须独占/协调写者或提供可同步查询的可信来源修订；无法保证时维持 unavailable。没有在消息热路径轮询全目录，也没有自动依赖浏览器修订。
3. 未知变化可能迁入任何 root/workspace，所以失效采用整个来源范围；不尝试用未知文件的旧归属猜测较小范围。来源重新可信后显式完整 rebuild，不自动使用旧完整性或单次成功写恢复。工作区/扩展卸载释放索引与来源租约；已关闭弹窗不影响索引或任务生命周期。

本轮仅提供可调用生产数据源与真实存储接入点，不声称部门功能已上线。仍保留真实 Extension Development Host/CLI、中央组织控制/容量装配、标准 build、根方案传播及员工真实 tab 接线门禁；本轮无 UI 源码变化，不重跑原浏览器矩阵。Ontology 交接新增：文件贡献与模块归属分区、真实写入确认及部分迁移失败、来源租约/全局失效/显式重建、索引发现与真实记录重读的不同证据责任。由中央统一同步领域本体。


## 总监组织停止反馈（round-3）

总监工具栏复用总体进度旁的原 `stopTask` 按钮位、`progress-controls` 对齐/间距及 VS Code 主题按钮样式，不新增弹窗。仅显示反馈，不推断或清理调度责任：

| 当前可信组织状态 | 原按钮区域 | 继续执行 |
| --- | --- | --- |
| 正常运行、尚未请求停止 | 原“中止” | 原门槛 |
| 当前停止请求尚未结算 | 禁用“正在停止…” | 禁止 |
| 总监已停止派发，原执行退出仍待确认 | 隐藏中止，显示已中止及原执行退出待确认 | 可见且禁用，清理确认后按原门槛恢复 |
| 可信根已停止，且无待清理责任 | 移除停止按钮 | 按原失败上限、状态及运行门槛恢复 |

群聊以可信总监任务状态显示是否已中止。带 `runtimeInterrupted` 的历史运行记录显示为已中止。`task.departmentStopState` 单独反映原执行清理状态。`readDepartmentOrganizationStopFeedback` 结合可信根、工作区、实际执行占用和当前中止结果判断能否继续。占用归零后仍需等在途的清理和状态保存结束。重开群聊、刷新页面和中止回执均沿用同一显示逻辑。

“中止”通过 `loopGroupChatChat:stopTask` 调用 `organizationControl.stop`。同一组织的在途停止会合并。一次请求关闭派发并停止总监、所有组长 Loop+ 和其活动员工，原 Owner 清理由宿主处理。正常结束或失败后刷新对应组织，刷新失败时仍显示原停止错误。刷新及迟到结果继续核对根、工作区和物理记录归属。

成员和总监收尾后，当前停止请求从可信仓储读取同根、同物理记录、同工作区及会话身份的 `stopped` 状态。记录缺失、身份变化或保存失败时会显示停止错误。

群聊和组织续接入口都在准备路由前及异步交接中核对可信根、物理记录、工作区和未清理执行。清理未完成时可以保存澄清答案，恢复执行要等待清理完成。

`DEPARTMENT_UI_DIST=dist DEPARTMENT_STOP_FEEDBACK=1` 的 `scripts/department_group_chat_host_smoke.cjs` 使用四组长夹具验证 Chromium 的中止点击、在途禁用、已中止后的退出待确认提示、继续入口及刷新后恢复。运行时回归覆盖组长 Loop+、活动员工停止与原 Owner 清理。
