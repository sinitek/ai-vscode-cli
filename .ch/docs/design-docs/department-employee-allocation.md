# 产研部逐组员工额度领域策略

本专题的事实来源为 `src/departmentemployeeallocation.ts` 和本模块行为测试。它交付纯领域函数，尚未接入生产容量池、组织宿主、持久化或总监页面写端口；不能据此宣称生产逐组额度已经生效。

## 状态与输入边界

持久化结构可直接 JSON 序列化：

```ts
{
  version: 1,
  rootTaskId: string,
  revision: number,
  maxLeaders: number,
  maxEmployees: number,
  leaders: [{ leaderTaskId: string, manualLimit: number | null, appliedLimit: number | null }]
}
```

- `version` 是结构版本；`revision` 是该根额度状态的全局版本。真实变更（保存、应用、配置更新、新成员登记）递增一次；同值保存、重复登记、重复应用均不递增。保存和配置更新需要精确 `expectedRevision`，即使同值请求也须通过 CAS。达到最大安全整数后拒绝后续变更，禁止回绕；幂等请求仍可返回原值。
- `rootTaskId` 不可重绑定；所有领域操作核对请求根，成员 ID 不得为空、带首尾空白、等于根或重复。登记函数接受可信宿主提供的成员身份，本模块不证明组织归属、不赋予权限。成员条目不自动删除；宿主应保留需要恢复或尚有执行责任的成员。
- `manualLimit=null` 表示恢复默认。手动保存仅接受 `0..当前maxEmployees` 的安全整数，拒绝字符串、布尔、缺失值、NaN、无穷、负数和小数。`0` 是常规上限零，绝非停止命令。
- `appliedLimit=null` 表示从未发生真实员工准入尝试；不能显示为“已生效 0”。旧应用值可高于新配置总额，是历史事实，不因降低总额而被规范化抹去。
- 严格规范化拒绝错误版本、未知/缺失持久字段、重复成员、错根和非法数字，并返回独立副本；不做容错默认、不合并或推算损坏状态。输入类型/结构失败抛出异常，CAS 冲突和版本溢出同样显式失败。

`getDepartmentDefaultEmployeeLimit` 使用固定配置的 `maxLeaders` 为分母：大于零时 `ceil(maxEmployees/maxLeaders)`，否则零；不依赖目前启动了几位组长。20/4 为 5，10/3 为 4。组额度之和可以超过共享总额，额度不会预留容量或扩大总额。

`updateDepartmentEmployeeAllocationLimits` 通过 CAS 更新配置、重算所有默认期望值；旧手动期望值若超过新 `maxEmployees`，收窄到新总额并继续保持手动来源，之后扩容也不自动恢复旧数字。此处收窄只影响期望值；任何 `appliedLimit` 和外部租约均保留，下一次该组尝试才应用。集成时应向总监返回确认后的数值；如产品需要保留扩容前的手动数字，应先协调这一配置更新策略。

## 保存、应用与判断

1. 可信宿主授权总监并核对根/成员，读取最新状态，以 `saveDepartmentEmployeeLimit` 计算新期望值。保存不应用限额、不取消员工、不释放租约、不改变责任。
2. 只读展示、提示构建、历史重放均不得调用应用函数。下一次**真实员工准入尝试开始**时，宿主以最新状态调用 `activateDepartmentEmployeeAllocation`，只更新该组的 `appliedLimit`。应保存该状态，即使随后因占用过多或未知计数而拒绝。
3. `evaluateDepartmentEmployeeAllocation` 对已应用限额和可信占用做只读判断。未首次应用则拒绝判断。`beginDepartmentEmployeeAdmission` 是上述应用和评估的纯函数组合，返回 `{state,evaluation}`；对合法但未知的占用也返回已应用的状态和拒绝结果。非法结构抛异常，宿主若分步调用应先提交应用状态再评估。
4. 宿主须在**现有同步 grant 路径**内重新读取最新额度、全局和该组占用，完成检查与实际容量保留，且不能在检查和 grant 之间插入异步空隙。单次返回 `eligible=true` 不意味着原子预留，两个只读调用可能同时看到相同余额。存储失败、CAS 冲突、成员变化或异步期间状态变化必须按宿主现有门禁处理。

全局 revision 也随应用递增，保存端口应对冲突重新读取并明确反馈。宿主必须串行提交同一根额度操作，不能拿旧状态副本覆盖新应用或其他组保存结果。本模块不实现磁盘 CAS、锁或消息重试。

每组 `pending` 根据该组期望数字与 `appliedLimit` 比较，首次 null 为 pending；修改 A 不会因为全局 revision 改变而误标未变化 B。相同数字已应用时，仅将来源由默认改为手动或反向恢复不需要重新等待应用，但来源变更仍递增保存版本。

## 占用、常规准入与例外

`DepartmentEmployeeAdmissionOccupancy` 由可信宿主提供 `{rootTaskId,leaderTaskId,globalActiveEmployees,activeEmployees,leaderOverflowActive}`。两个计数都包括 overflow；拒绝负数、小数、字符串等非法输入，也拒绝本组人数超过全部门人数、存在 overflow 却本组人数为零等矛盾。任意字段为 null 都表示未知，拒绝常规及 overflow 判断，不能从聊天历史估算、将未知当零或用全局余额替代本组余额。

常规余额为 `min(max(0,maxEmployees-globalActiveEmployees),max(0,appliedLimit-activeEmployees))`。必须全局和本组都有余额才允许常规准入；调低后即使现有占用超过上限，也只等待真实释放，不改写员工或租约。

与现有 `DepartmentCapacityPool` 一致：仅当**全局余额为零**时，可按显式 overflow 路径允许该组最多一个未释放 overflow，即使该组常规上限为零或已满。全局仍有余额而只有本组耗尽不能触发例外。已有 overflow 仍计入本组占用；余额回正后若全局和本组有常规余额，可获常规名额，不清除原 overflow 标记。

本模块只返回资格/拒绝原因；不产生 `CapacityLease`、receipt、CLOSED，不修改 pool、不宣称执行结束或实际清理。本模块仅用类型导入共享容量配置，运行时没有外部依赖。

## 只读 DTO

`projectDepartmentEmployeeAllocation` 保持并行 UI/提示约定：

```ts
{ rootTaskId, revision, defaultLimit, leaders: [
  { leaderTaskId, source: 'default' | 'manual', desiredLimit,
    appliedLimit: number | null, activeEmployees: number | null, pending }
] }
```

计数参数为可信宿主的根绑定成员列表；缺参、缺组或该组 null 时只展示未知，拒绝重复/未知成员及错根计数。DTO 为独立副本，TypeScript readonly；不使用运行时冻结，因此 UI 改写副本也不能改写持久状态。读取没有激活、准入或预留副作用。

## 验证与待集成边界

本模块验证入口：`npm run build` 后执行 `node --test dist/test/departmentemployeeallocation.test.js`。测试覆盖均分/非整除/零、手动及恢复、降低与保留占用、拒绝时仍应用、跨组版本隔离、非法输入、未知计数、序列化往返及版本溢出。

本次不重跑旧 UI、CLI、EH 或全量矩阵，旧 71 项 UI 和浏览器结果不覆盖本策略。后续集成任务仍需完成：

- 在当前同步容量授予路径实现最新逐组与全局额度的联合检查及实际保留，保持原身份幂等、取消、溢出、租约恢复和清理门禁；补并发竞态及真实宿主测试。
- 将版本化状态接入 runtime state/store、冷恢复，序列化同根操作并处理保存确认及持久失败；配置/成员变化通过可信宿主调用领域函数。
- 给 UI 写端口安装授权保存服务和确认 revision；给投影及提示 reader 提供可信实时计数，应用后刷新读取；不将提示或浏览器 DTO 当作授权。
- 与冷恢复交付协调更新中央功能清单、`.ch/docs/ontology/domains/cli-plugin-runtime.json` 相关共享容量规则/场景和 `.ch/docs/exec-plans/active/2026-11-13-feature-department-mode.md`，以及必要的设计文档索引。这些中央文件本次按明确写域边界不修改。
