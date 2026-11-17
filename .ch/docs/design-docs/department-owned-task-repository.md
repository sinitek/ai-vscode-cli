# 部门受控任务 Repository 与公共存储路由

状态：中央 Extension Host 已装配专用生产来源、同步 repository 创建与公共路由；跨宿主来源冲突及限定目录恢复已通过隔离 Node 子进程回归。整体产研部仍开发中，真实 VS Code Extension Host/CLI 与冷重启尚未验收。本文描述实际仓储及同步提交边界。

## 权威输入与装配顺序

`DepartmentOwnedTaskRepository` 接收 `DepartmentOwnedTaskRepositoryPorts`：

- `descriptor`：可信宿主的 `{ version: 1, sourceId, root }`，root 为真实绝对路径。
- `isCurrent`：来源及唯一索引均已完整初始化、仍可用的同步核验。
- `readRevision(): number | null`：来源发布代次，取自 `controller.readRevision()`；不可用返回 null。每次成功提交或显式 rebuild/recover 必须递增，不能返回固定值。
- `listFiles` / `readFile`：受控来源的完整文件清单与受保护读取；读取失败返回 null，不能伪装空数组。不得把公共 `readLoopTaskStoreResult` 回注为 reader（会重入路由）。
- `locateTasks?(ids)`：当前一批身份的 `{ available: false }` 或 `{ available: true, locations: ReadonlyMap }`。生产连接 `locateLoopTaskIdentities`，每次只读一份当前 catalog、遍历一次物理贡献，不跨调用缓存。输入重复 ID 共享一个结果，文件内/文件间重复贡献必须原样保留；已删除 ID 仍返回持久墓碑文件。旧注入宿主可回退单项端口，生产不得逐条读完整 catalog。
- `locateTask`：`{ available: false }` 或 `{ available: true, files }`。空数组只表示已经证明不存在；新 ID 检查须涵盖普通任务，不能只查部门索引。重复物理贡献必须保持为多个元素，不得去重成唯一。
- `commit(updates)`：同步 owner 事务闭包，Map 的键为受控物理文件，值为该文件完整记录。controller 持有 capability 并负责事务原子性、来源/索引失效和重新发布；repository 不取得、保存或传播 token。

先初始化来源及索引，再构造 repository。构造阶段完整读取并校验所有贡献及唯一身份，成功后才注册公共路由。controller 必须在 commit 返回成功前恢复可信读取/索引；否则 repository 将封闭，而非猜测事务已成功。完整验证后的记录保存在仓储内部隔离缓存中。正常单任务 read 只重读其已知物理文件；update、append、rebind 共用一次目标文件读取和一次提交读回，不再先 read 再重复 update 全量读取。仍用一次可信批量身份查询核对所有贡献，并在内存中保留完整关系、模块、会话及方案校验；缓存不赋予新身份权威。retention/delete 可读取完整已知集合进行关系校验。

同步闭包应连接 `controller.commitSync(updates)`，不能连接 `commit(): Promise<boolean>` 或使用 fire-and-forget。commitSync 在返回 true 前完成实际 owner 事务和索引重新发布；controller 内这一次必要的完整索引 rebuild 保留，仓储不再额外重读全部文件。宿主的全局唯一身份目录也须在闭包返回前同步更新。

缓存与 `readRevision()` 绑定；构造前后、读取前后及提交核验后均检查来源。仓储之外的 controller 提交、显式重建或恢复会改变代次，旧仓储必须拒绝并重新完整初始化，不能继续沿用旧关系。关闭/失效返回 null；不能因后来 ready 恢复就使旧代次缓存自动可信。提交仅接受严格 true 和新代次，随后核对目标文件实际读回。

source 的受控 reader、事务归一化和内部索引现在保留完整记录（包括过期项）；普通 reader 默认历史过滤行为不变。repository 的公共 read/readFile 隐藏过期项，过期项不能通过 update 重新出现。retention 用完整关系校验删除集合，不能删除仍有有效组长的根；存在孤立风险时整个操作拒绝，不将过滤误认为已删除。

## 创建与修改

`create(record)` 接收完整记录，一次 owner commit 首次持久化。先验证部门 metadata、总监 classic / 组长 event_driven、显式 CLI、固化主/员工模型和思考力度/variant、根统一验收方案、组长真实 Loop+ snapshot 与现有子任务、独立会话、根/模块/workspace 关系。员工复用 attempt，不创建独立员工任务记录。

ID 已存在、唯一索引不可用、已有普通记录、重复模块、已有物理路径（包括空文件和链接）、非法方案或快照均在写前拒绝。不得先发布普通记录再补 department。新任务及 update 的时间戳不能触发普通来源的隐式保留期过滤。

`update(id, patch, options)` 复用 `mergeLoopTaskRecordPatch`（包括 completed→running 保护），保留身份、workspace、角色 metadata、CLI、调度模式、物理路径、模型路由、origin profile 与根方案。运行配置修改需另行设计显式协议，不能靠普通 patch 漂移。

`append(id, round)` 复用 `mergeLoopTaskRound`：round + role + subtaskId 为替换键，保留 currentRound 最大值。`rebind(id, sessionId, cli?)` 仅变更会话绑定，物理文件稳定；不允许切换固化角色 CLI 或迁出来源。不改变普通任务的 session 路径行为。

所有 API 返回 `DepartmentRepositoryResult<T>`（`ok/value` 或 `ok/error`）。成功提交后从受控 reader 重读核对，不能返回未落盘的成功对象。commit 失败、异常或读回不符使当前实例封闭；保留已知 ID 拒绝边界，恢复需新的核验实例，不能自动退回普通 writer。

## 删除、保留与迁移

`delete(id)` 和 `retention(now?)` 用 owner 事务逻辑删除，文件写入剩余记录（无记录为 `tasks: []`）。删除根或模块造成孤立组长时拒绝。保留期删除多个文件以一次 Map 提交，不进行先迁目标再删源。已删除 ID 保持拒绝墓碑，不能重新提升或覆盖。

`importRecords`、`restoreRecords`、`migrateLegacy` 当前明确返回拒绝；不会写磁盘。未来显式迁移必须提供完整来源身份及重复 ID 证明。公共 legacy 自动迁移在移动任务/communication 之前预检全部 legacy 文件：部门 metadata/非法标志、受控 ID/路径或不可解析输入均保留原数据，不自动提升。普通 legacy 仍沿用原流程。

## 公共 host-only Router

`registerLoopTaskStoreHostRouter({ root, knownTaskIds, route })` 只给可信宿主调用。`knownTaskIds` 必须来自完整来源映射，不能来自 browser、模型或待写 department 字段。返回 `rememberTask(id)` 和 `dispose()`；新增 ID 在首次 commit 前纳入拒绝边界。来源根不允许活跃重叠，跨根 ID 冲突拒绝。

`LoopTaskHostRequest` 覆盖 read、update、append、rebind、readFile、deleteFile 和 retention。`LoopTaskHostResult` 区分 `{ handled: false }` 与 `{ handled: true, ok: false }` / 成功；一旦根或 ID 已归属，即使 handler 返回未处理或抛异常，也转为拒绝。注销仍保留根与 ID 墓碑；重新注册同根继承墓碑。不同根不能复用已知 ID。

公共 `readLoopTaskRecord`、`updateLoopTaskRecord`、`appendLoopRound`、bind 两入口、结果式文件读取、文件删除及 retention 已路由。低层 `tryWriteLoopTaskStore` 保持普通 writer：在首次磁盘修改前拒绝受控根和受控 ID，不通过该 bulk 入口获得 owner 权限。`appendLoopRound` 保留 void 兼容；需确认写入时使用新增 `tryAppendLoopRound(): boolean`。旧 void/空 store 包装不具备成功证明，应使用结果式端口。

中央 `extension.ts` 在 activate 装配 `createDepartmentProductionTaskStoreForHost`，优先复用未被占用的 `department-tasks-v1`。只有原根无法取得独占 claim 时，宿主才尝试其它已登记、非重叠来源；都被有效 owner 持有时，在 `department-task-sources-v1` 下创建全新的独立空目录。该分支只处理明确的 owner 冲突，不接管旧 marker、不读取/重放其它来源任务、不改变其身份或删除墓碑。新来源必须在共享 writer gate 下以空来源追加到现有身份目录。未知锁、损坏 catalog、尚需恢复的 owner 来源或其它初始化错误继续拒绝启动，不触发来源切换。总监、组长经 `prepareDepartmentTaskRecord` 组装固化字段，再 `source.create` 一次 owner 事务首次落盘。adapter 的 createTask 端口接收 host-only `departmentMetadata`，不再事后补 metadata 提升普通记录；主会话、任务 ID、classic/event_driven 模式与员工 attempt 复用不变。普通任务仍使用原 writer。deactivate 返回异步关闭结果；来源 admission 先撤销，已知根/ID 路由墓碑继续拒绝回退。

身份目录 `loop-task-identities/catalog.json` 的 `owned` 映射持久保留部门 ID 与原物理文件，包括已逻辑删除/保留期删除的 ID。未取得 source/router 的另一宿主也先查此映射，拒绝将部门任务降级为普通发现或写入；目录不可用时同样拒绝，不扫描目录补授权。删除不回收部门 ID，来源关闭不清除此边界。该目录损坏、未提交或未知锁的管理恢复尚未交付。

`createDepartmentProductionTaskStore(rootPath)` 暴露 descriptor、ready、create、readTaskRecord、readDepartmentLeaderTaskIds、listTaskStoreFiles（仅 UI 文件清单）、revokeBeforeExternalChange、close。capability、controller、repository 原始 commit 不向外暴露。已知文件清单来自 repository 映射，不在正常归属查询时枚举任务库。

全局普通/部门唯一身份目录由 `loopTaskIdentityCatalog.ts` 实际持久化到 `~/.sinitek_cli/loop-task-identities/catalog.json`。首次在共享 writer gate 下严格完整初始化（含普通/legacy 的过期身份），后续 locate 仅读身份目录，不扫描目录、不读取所有任务记录。所有本版本普通 write/delete 与 owner commit 使用同一 wx 事务锁；先撤销目录 ready，再执行磁盘操作，最后同步发布完整位置贡献。owner 闭包实际调用 controller.commitSync，身份目录和内部索引均发布后才能返回成功。普通重复贡献保留歧义，任何涉及部门的重复 ID 拒绝；其他当前版本 Node 进程也受普通 writer 检查约束。append 不增加一轮全量受控读取。

身份目录锁定、损坏或无法解析均拒绝，不按 PID/mtime/年龄清锁。对结构有效但 `ready=false` 的未发布目录，仅当每个已登记来源根都已消失、待注册来源为空且不重叠时，生产首次装配可在共享 writer gate 下重建完整目录；保留旧 roots、owned 删除墓碑及普通迁移记录，不能据此恢复旧任务。任一已登记根仍存在、目录内容未知或新来源含业务文件时继续拒绝。此限定恢复不提供通用管理恢复入口。未知直接文件写者、旧版绕过协议的 writer 不在证明范围；受控 import/restore/move 在公开变化前须 revokeBeforeExternalChange，当前这些写入不获授权。不能凭目录存在或 watcher 授予权威。

组合测试覆盖实际生产来源/仓储/controller/身份目录、中央 runtime composition、真实 Loop+ adapter/host 与共享 pool，仅替换模型输出和底层 runner。另一个真实 Node 进程验证普通 writer 不可复用部门 ID，并同步发布普通身份。它不证明 VS Code activate 已在真实扩展进程执行，也不证明实际 CLI、旧版本跨进程写者或冷重启完成。

## 跨宿主通信保留边界

普通 `cleanupLoopCommunicationRetention()` 在独立 Node 宿主也必须服从持久 `owned` 映射，不能仅依赖进程内 router。`withLoopTaskIdentityRetention(action)` 持有同一支持写者的独占 gate，从一次当前 catalog 读取到通信删除结束；保留 `owned` 墓碑及受控根内的所有贡献 ID。活跃或逻辑删除的部门通信均不由普通 GC 删除。锁定、损坏、未发布或缺失 catalog 时整次删除拒绝，不能把不可判定身份当普通垃圾；未初始化目录也不授予 GC 权限。已初始化来源旁的普通过期孤立通信仍按原保留期清理。部门通信的 owner-aware GC 与墓碑回收仍未交付。

批量查询不改变 `readRevision` 缓存撤销、来源/关系验证或普通/部门冲突拒绝。生产 isCurrent 只核验来源所有权/代次，完整快照内的一次批量查询负责当前全局身份权威；ready/关闭仍独立核验身份目录。没有长期授权缓存，也不以扫描任务目录补授权。
