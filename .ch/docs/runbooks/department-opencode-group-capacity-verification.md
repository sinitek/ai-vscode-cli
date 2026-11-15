# OpenCode 组长树容量组件验证

适用范围：生产组件配受控免费 Node CLI，不是实际 OpenCode binary、真实模型或完整 Extension Host 验收。入口为 `src/test/extensionHost/departmentopencodegroupcapacity.test.ts`；独立夹具复用 `departmentproductionwiringfixture.ts`，后者默认 Codex 行为保持，只有显式传入 OpenCode 组长时才要求配置相应测试 transport。

## 组件与替身

实际复用组织 `createDepartmentRuntimeComposition`/orchestration、同一 Loop+ scheduler/adapter、owned task repository/router、RuntimeStore、producer、Ledger、原 Owner server/worker/client、SharedRuntimeConfig 租约和资源能力。每组一名 OpenCode 组长与一名 Codex 员工，下一模块仍经组织 `startLeader` 合法派发。没有复制 pool/scheduler，没有预置 completed 记录、清空容量或通过磁盘 receipt 补成功。

OpenCode CLI 为 Node 替身：只实现现有 helper 使用的无 prompt `POST /session`、`GET /session/:id` 和现有 builder 生成的 `run --session`；替身从实际调度提示中回传验收事件 ID。输出经生产 `parseOpenCodeRunOutput` 和原生 ID extractor，再经实际只读绑定校验器，最终进入真实 Loop+ 决策解析及验收处理。Codex 员工复用既有免费 app-server 协议替身及真实 runner。UI 消息发布/完成事件接收、Map tab host 与外层 scheduler execution-root disposer 是受控能力；它们不是 VS Code UI 或外层工作区实物清理证据。Owner 自建的 execution root/links、overlay/config lease 和 CLI 子进程则沿原生产资源实现处理。

## 成功门禁

- 首次责任写入在原生准备之前；可信准备得到 session 后，任务 session 保存/读回、Store binding 写入/冷读均在首个实际任务进程启动前。组件保留原生产同步最终 grant 栅栏；没有测试注入 grant 或启动能力。
- 同代组长至少两轮使用相同 native ID 和相同独立 Owner worker；local transcript key 和 tab 保持。CLI 的初次准备请求体为 `{}`，没有任务 prompt。
- 文件门闩仅控制替身物理退出/stdio 时序，deferred 门闩控制输出消费者；门闩本身不构成清理证据。分别在组长物理执行、员工管道未排空、员工消费者和组长末轮消费者阶段断言相应租约保留。
- 真实 scheduler 消费员工 finish event 并完成验收；正常任务 lifecycle 独立完成后，读取原客户端的严格 `waitForCleanup` 返回值，逐项核对每个 required fact、identity 和 policy。OpenCode 原 bootstrap 仍须 receipt 与 stopped 双确认。Codex socket 退出后的原始 observe 可以 unknown；只有原客户端已严格取得的 receipt 可保留，不从磁盘重建能力。
- 最终集合恰含组长及员工两份绑定、已封闭；原聚合器执行前后配置/绑定复核与最终冷读。记录真实 Store 成功写入和 pool 通知，断言组长容量先持久移除，再出现内存归还通知，且此前已经获得两份原 Owner 完整凭证。tab 已实际从受控 host 删除并回读消失，配置 leases 为空。随后另一模块从组织入口新派发成功，单独完成其员工和原 Owner 生命周期。

## 反例门禁

注入实际 tab close 端口抛错；员工原记录为 cleanup-failed，严格原 receipt 不成立，员工与组长持久/内存容量均保留。再次派发同模块被拒，binding/session 创建数和任务进程数不增加。负例的 teardown/强制回收仅用于测试进程卫生，不计作 drain、receipt 或容量释放。员工清理失败可能在后续组长验收前封闭调度，反例不要求新增一轮不合法执行。

## 运行

必须将 src、scripts、package 文件和 tsconfig 实体复制到隔离目录，检查 src/dist realpath，只有 node_modules 可以链接依赖；在隔离目录执行：

```sh
npm run build
node --test dist/test/extensionHost/departmentopencodegroupcapacity.test.js
node --test --test-name-pattern='production OpenCode employee (close and drain, owned resources and tab readback return mixed group capacity|tab release failure retains mixed group capacity)' dist/test/extensionHost/departmentgroupcapacity.test.js
```

每个新场景在 HOME/USERPROFILE/CODEX_HOME 隔离的 Node 中运行；阶段等待 12 秒并输出事件/任务/容量诊断，子测试总限 25 秒、外层退出等待 30 秒、外层测试 35 秒。标准构建及相关结果见 round-361 报告。共享 dist 不得构建或清理。

尚未证明：真实 OpenCode binary/付费模型、真实 EH/VS Code tab、总监 CLI 决策/公开 UI 新建入口、整个生产外层工作区资源、冷恢复、Linux/Windows 或停止/继续 EH 集成。已有余额/超额策略、绑定冲突、零重试和逐次绑定读取结果按未变范围复用。本验证不改变生产语义或开放新容量门禁。
