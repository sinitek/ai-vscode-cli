# 总监逐组员工上限：UI 与受限宿主端口验证

本范围是总监成员树中的额度展示、编辑和授权接缝，不是生产额度执行或持久化接线。基线为已接受 `37d5847758a3ca1679be9eebdd8bd49e5a523c3d`；本轮独立物理工作树为 `/private/tmp/department-allocation-ui-round431-20261116`。未吸入并行策略或冷恢复源码，原 round422 UI 树只读。

## 设计与数据合同

总监摘要、共享占用行、三层成员树、组长弹窗和 tab 名称/图标保持原结构。每位组长群聊入口下方增加“员工上限”数字输入、“保存”和“恢复均分”；控件间距 8px、上方间距 4px，输入宽 64px、max-width:100%、min-width:0，可换行。状态用 member-meta、错误用现有 inputValidation/errorForeground 主题语义与 aria-live。组长页只读，显示来源、期望上限、实际占用、已应用上限或“待首次派发”；pending 显示“已保存，下次派发生效”。

只消费可信宿主 DTO，不由 UI 计算默认额度、占用或生效状态：

```ts
{
  rootTaskId, revision, defaultLimit,
  leaders: [{ leaderTaskId, source: 'default' | 'manual', desiredLimit,
    appliedLimit: number | null, activeEmployees: number | null, pending: boolean }]
}
```

默认策略由并行领域交付负责：按配置 maxLeaders 均分，20/4=5，非整除向上取整，全部门仍受共享 maxEmployees 约束。每组额度不是预留；调低不停止当前员工；全局零余额时原每组一个 overflow 例外保留。UI 中的 5 是 fixture DTO 的明确输入，缺服务时绝不推算 5 或伪造成功。

投影边界 `DepartmentGroupChatReadPort.readEmployeeAllocation` 以及 coordinator 的 `readDepartmentEmployeeAllocation` 均可选。`normalizeDepartmentEmployeeAllocation` 验证 root/revision、非负安全整数、source、null、组长集合及重复条目，并复制 DTO；缺失、异常或非法数据显示未知。编辑还要求可信 `updateDepartmentEmployeeLimit` 端口存在，否则禁用并解释不可编辑。没有独立任务 ID 的占位组长继续禁用群聊及额度控件。普通 Loop/Loop+ 无 department 时不生成额度行。

## 写入接缝与安全边界

浏览器消息：

```ts
{ type: 'loopGroupChatChat:updateDepartmentEmployeeLimit',
  requestId, leaderTaskId, employeeLimit: number | null, expectedRevision }
```

仅保存按钮或输入 Enter 提交；input/blur 不提交。数字 0 是常规额度 0，null 才是恢复均分。校验失败保留草稿及输入焦点。保存期间只禁用该行，显示“保存中…”，不允许重复派发；失败保留重试草稿。按 root/leader 保存未提交草稿，contentPatch 保留它们；切根清除。回执按 root、leader、requestId、revision 和编辑版本检查，不能覆盖新编辑或新请求。

宿主端口为 `DepartmentEmployeeAllocationWritePort`：

```ts
(root: LoopTaskRecord, request: DepartmentEmployeeLimitRequest) => Promise<
  { ok: true; allocation: DepartmentEmployeeAllocationProjection }
  | { ok: false; error: string }
>
```

集成任务负责安装真实持久化 CAS writer 和 reader；成功 allocation 必须是持久确认值，包含确认 revision，reader 应及时反映同一数据。writer 必须在持久操作处再次原子核对 expectedRevision；UI 的前置版本检查不是原子 CAS、预留或真实准入。此处不写 manager/store，不创建、继续、停止任务，也不回落普通 Loop。

coordinator 以当前宿主绑定 taskId 重新读取 root、workspace、角色和目标记录，复用 authorizeDepartmentLeader 与权威成员索引，拒绝跨根、员工/组长调用、歧义所有权、失效记录、错误数值和过期 revision。只复制四个已验证载荷字段给 writer。异步返回再次核对面板、根/工作区、成员及当前请求；失效回执丢弃。持久返回的 DTO/目标值/版本也需通过校验才能安装面板并回执。

新消息未加入 iframe allowlist，并在 DepartmentGroupChatTaskMessage 的 Exclude 中明确排除。opaque iframe 的 allow-scripts、source/origin/taskId/instanceId 校验保持。round425 的同步 inert/归焦、无 bridge fallback 和异步切模型成功不抢焦未修改。

## 有界验证与可复用命令

只在本轮独立工作树构建；标准 build 会清理本树 dist，禁止拿此命令在原冻结树执行。

```sh
npm run build
node --test dist/test/loop/departmentGroupChatPanel.test.js dist/test/loop/departmentGroupChatHost.test.js
node --check scripts/department_group_chat_smoke.cjs
node --check scripts/department_employee_allocation_scenario.cjs
```

新增交互沿用现有 smoke 入口、真实编译 Webview 生成器和 department fixture。独立场景 helper 不生成或复制生产页面。动态 loopback 端口、独立无用户会话 Chromium，不登录、不读凭据、不发模型请求。

```sh
NODE_PATH=/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/node_modules \
DEPARTMENT_UI_DIST=/private/tmp/department-allocation-ui-round431-20261116/dist \
DEPARTMENT_UI_EVIDENCE=/private/tmp/department-allocation-ui-round431-evidence/browser-confirmed \
DEPARTMENT_UI_ALLOCATION_ONLY=1 \
PLAYWRIGHT_MODULE=/tmp/zq-playwright-smoke/node_modules/playwright \
CHROMIUM_PATH='/Users/fangjiawei/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
node scripts/department_group_chat_smoke.cjs
```

实际结果：

- 首次标准 build 通过；新增测试使用 Array.findLast 导致 ES2020 lib 编译失败，记录于 `build-tests.log`。改为 filter(...).at(-1)，未改工具链。后续标准 build 均通过。
- `tests-confirmed.log`：40/40，通过投影、coordinator 以及原有相关部门渲染/路由测试。没有重跑原完整 71 项矩阵。
- 首次 `browser-first/result.json` 两视口通过；之后为只读组长信息补充“期望上限”数值，其显示证据由 `browser-confirmed/result.json` 替代，旧结果保留。
- 最终浏览器：1440 深色、280 浅色，两视口通过，动态端口 56509，各 7 个明确保存请求，browserErrors 均为空。覆盖保存/Enter、null 恢复与数字0、整数错误与焦点、pending/失败重试、迟到 root/leader/request/编辑回执、contentPatch 草稿保持、切根清除、未知/不可编辑状态、首次派发/已应用区分及溢出。输入宽64px、gap8px、margin-top4px，两视口根/控件均无横向溢出。
- 浏览器后只修复宿主去重顺序并增加回归：另一组提升共享 revision 时，同一在途请求的重复消息不会先发过期错误。最终 `build-host-confirmed.log` 标准 build 通过；`node --test --test-name-pattern=allocation dist/test/loop/departmentGroupChatHost.test.js` 的5项额度测试通过。此宿主改动不影响浏览器；`inputs.json` 中8项浏览器输入与重建后逐字节相符，因此没有重跑仍有效的浏览器或渲染用例。
- 最终截图为 `1440-dark-allocation.png`、`280-light-allocation.png`，各另有 pending 和失败状态截图。保存了 generated-input HTML、inputs.json、result.json 以及严格 console/page/requestfailed/HTTP错误采集。截图已人工查看。

完整本机证据根：`/private/tmp/department-allocation-ui-round431-evidence/`。最终哈希清单为该目录 `final-hashes.json`；包括所有源码、测试、脚本、编译产物、实际生成HTML、日志、JSON和截图。浏览器 helper 中“后续编辑”使用 input 事件作防御性竞态夹具，真实用户在 pending 时输入保持禁用；不将它描述为用户可在保存中直接改值。

## 复用、限制与交接

未重跑 tabs、旧全主题矩阵、旧队列几何或其他未受影响场景；round419/424/425 接受结果按原未变范围复用。departmentGroupChatModal.ts、loopModelSwitchDialog.ts 和 tabs 脚本与37d基线逐字节一致；这些不构成本轮重新执行证据。

本轮是生成 Webview + fixture host 的显示验证及受限接口单测，不代表生产持久化、限额策略执行、真实员工准入、调度、CLI、模型、Extension Host/EH、冷恢复、Windows/Linux平台或最终合并树回归通过。真实 writer/reader 安装、策略模块对接及最新额度与全局余额的同步 grant 校验仍由集成任务负责。

新增用户可见能力需在整合时更新中央 FEATURE_INVENTORY、ontology 权限/DTO/期望与应用状态及来源引用、active计划的范围/门禁；本轮不竞争冷恢复任务的中央文档写域，不声称无需更新。集成审查应核对并行策略 DTO、CAS持久确认及 reader一致性，然后在实际接线树验证，不以本fixture代替接受审查。
