# 部门运行绑定：单次同步操作内的线性校验

事实来源：`src/extensionHost/departmentruntimestore.ts`、`departmentruntimestate.ts`、`departmentexecutionrecovery.ts` 和 `src/runtime/departmentexecutionidentity.ts`。

## 不变的格式与权限

`DepartmentRuntimeStore` 继续公开构造器、`read(root, workspace)`、`write(value)`、`bindExecution(root, workspace, binding)`，结果仍为原有可判别成功/失败类型。持久化保持 `version=1`、有序 `executionBindings` 数组及完整 append-only 身份历史，没有迁移或新授权入口。旧控制器省略绑定字段时继承磁盘历史；显式删除、替换身份或 requirements 仍拒绝。执行 ID 相同仅用于定位，之后必须比较完整 canonical identity 与每项 cleanup requirements。selection 仍完整验证结构并重算指纹，session 必须 bound。

当前代次的新绑定仍须对应精确 taskId/moduleId 组长关系及现有容量租约；同 slot 同 generation 的另一 execution 不允许替代。较旧且完全一致的绑定保留幂等行为，不借重试新增租约或清理证明。此优化不改变产品行为、本体概念、状态机或事实来源，因此不更新共享功能清单、runtime ontology 或 execution-owner 设计文档。

## 每次调用的工作量

令 B 为历史绑定数量、L 为组织组长数量。输入的组织结构和容量先完整校验，成员以 JSON 二元组 `[taskId,moduleId]` 建立 Map，避免模糊拼接和每条绑定逐一 find 组长。完整验证每条 binding 后建立 executionId Map 与 slot/generation Set；重复 ID、重复 slot/代次、错误 root/workspace 和成员关系均拒绝。任何索引只存在于本次同步调用内，失败中的部分索引也不会提交或暴露。

- `read`：一次冷读、JSON parse、全量验证，绑定/成员关联为 O(B+L)。返回本次 parse 新建的值；没有内部共享缓存，调用方修改不会污染下一次读或磁盘。
- `write`：隔离复制调用方输入；独立冷读并完整验证当前磁盘；兼容继承被省略的历史；完整验证候选后，以 executionId 查询并逐项比较每条旧绑定。保留核对从 O(B×B) 改为 O(B)，成员核对从 O(B×L) 改为 O(B+L)。不因同 ID 存在就跳过身份/requirements 比较。候选及旧历史各全量验证一次。
- `bindExecution`：隔离复制并完整验证新绑定；冷读并完整验证旧值一次，用本次索引核对重复、完整身份、成员、当前 generation、容量和 slot 冲突。原历史不再经公开 `write` 重读、复制或验证；追加后在同一无 await 调用中走私有已验证提交路径。当前容量集合的 includes 查询仍为线性，但每次只针对新增绑定，不在历史绑定循环内。

以上复杂度只描述此次消除的搜索及重复工作；结构校验、selection 指纹计算和其它快照字段的校验成本仍存在。**全历史 JSON 读取、解析、输入隔离复制、序列化及 append-only 磁盘增长均保留**，每次操作的瞬时内存仍随历史线性增长；没有宣称解决全部历史规模问题或引入退休/压缩协议。

## 原子写入及失败

私有提交路径仅接收本次同步调用已验证、隔离的数据。继续使用同目录 UUID 临时文件、`wx`、0600、写入、文件 fsync、关闭、rename；失败回收本次临时文件，不改原文件。仅 ENOENT 表示缺失，损坏 JSON、坏绑定、权限和其它 I/O 错误均为失败，不能写空修复。单 EH 同步写者假设保持不变；没有跨调用 mtime/size 缓存、跨进程 CAS、目录扫描、轮询、调度或容量操作，也不新增目录项掉电持久性保证。

## 验证与保留门禁

大历史回归使用 1,024 名真实结构成员、4,096 条历史绑定及一个有租约的新绑定。断言真实文件冷读次数和完整 binding validator 的有界遍历次数，并检查整个历史、顺序、尾部删除/替换、策略/指纹改变、同槽同代冲突及冷读损坏尾部。没有毫秒阈值或新的公开调试端口。原子写入测试注入 open/write/fsync/rename 与权限失败，核对原字节及临时文件回收；恢复回归仍消费原有独立 Owner fixture。

这些单元/集成夹具不证明生产 Owner、首次 launch 持久绑定、组长整组清理聚合或真实恢复已经完成。它们继续是中央集成门禁；本次不修改其共享所有权文件，不用性能优化授予任何清理/容量释放事实。真实 CLI、Extension Host 恢复、冷重启与跨平台实机验证仍由后续集成完成。
