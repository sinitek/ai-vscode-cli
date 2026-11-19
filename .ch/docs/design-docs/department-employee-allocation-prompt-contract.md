# 产研部员工额度提示契约

## 范围

本文只约束总监和组长模型提示中的员工额度说明。它不实现容量 manager、持久额度存储、总监页面或生产准入逻辑。当前 Loop+ orchestration 在每次组长决策时调用现有 `getDepartmentEmployeeCapacity(rootTaskId, leaderTaskId)` reader，并将返回快照透传给提示 builder；提示是只读参考，不保留名额。

## 快照 DTO

既有快照全局字段继续表示整个部门的常规容量与全局溢出状态：

```ts
leaderAllocation?: {
  revision: number;
  source: "default" | "manual";
  desiredLimit: number;
  appliedLimit: number | null;
  activeEmployees: number;
  availableEmployees: number;
  pending: boolean;
}
```

嵌套字段由宿主针对当前 root 与 leader 提供。`activeEmployees` 是本组全部活动员工数，包含溢出员工。`availableEmployees` 必须等于 `min(global.availableEmployees, max(0, desiredLimit - activeEmployees))`，表示下一次派发可用的本组常规额度。`revision` 是宿主额度版本；`pending` 只读宿主值，不可根据全局容量 revision 变化推断。

提示仅接受安全非负整数、`default`/`manual` 来源、可空或合法整数的 `appliedLimit`、布尔 `pending`，并核对既有全局 root、leader、额度和余额一致性。本组活动员工不得超过同快照的部门活动员工数；若部门快照标记本组已有未释放溢出员工，本组活动数必须大于零。嵌套字段缺失、非法或与全局占用矛盾时显示本组额度未知；若全局快照仍有效，仍可显示全局余额和“部门常规余额是否为零”这一全局事实，但不得输出本组可派发或可超额的肯定结论。字段读取失败同样按未知处理。未知既不等于零，也不授予普通或溢出准入；宿主必须取得有效的最新本组快照并在启动前复核。

## 派发语义

总监提示说明默认额度按当前 `maxEmployees / maxLeaders` 向上取整均分；20/4 得到每组 5 只是示例，不固定任务模块、配置或所有部署的人数。总监可通过可信数字额度控制修改特殊组额度，单纯自然语言要求不能改变宿主限额。总监仍只负责派发、协调及依据汇报确认完成，不承担代码验收。

组长提示同时报告部门常规总额、部门活动数及余额、部门余额是否为零，以及有效快照下的既有溢出状态、本组来源、期望上限、已应用值、活动数、下次派发常规余额、host revision 和 host 提供的 pending。只有本组快照完整有效时，才显示本组当前可否使用既有溢出例外；本组快照未知时，全局余额为零也只作为全局事实，不能推断本组普通或溢出准入。额度是本组常规并发上限，不是预留容量；实际派发仍受部门共享 `maxEmployees` 限制。每组额度已满但部门仍有常规余额时，没有溢出例外。仅当全局余额为零且本组身份/占用快照有效时，继续遵守既有每组最多一个未释放超额员工规则。

保存额度不停止已启动员工。从该组下一次真实员工准入尝试开始读取最新期望额度；若本组活动员工（含溢出）已超过新上限，等待真实执行清理释放后再常规派发。当前提示快照不刷新已发出的模型调用，不重放旧 prompt。宿主必须在启动前原子复核当前组额度与全局余额；提示不授予授权。

总监专用说明只进入总监角色提示；额度快照只进入有效产研部组长 Loop+ 主提示。普通 Loop/Loop+ 与员工提示不出现额度授权语义。

## 后续接线

- 由员工额度策略所有者提供宿主 reader 的 `leaderAllocation`，保证 `pending`、`revision` 与上述公式来自同一权威快照。
- 由总监 UI/组织控制所有者接通可信数字额度修改端口，并验证保存不改变活动租约。
- 由中央产研部事实所有者同步功能清单、cli-plugin-runtime ontology 与 active plan；本提示任务不占用这些并行文档写域。
- 生产准入仍须在实际启动边界复核；提示单测不证明原子准入、容量持久化、生命周期清理或真实 Extension Host 行为。
