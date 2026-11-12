# AI 对话任务列表滚动位置保留

- 日期：2026-11-06
- 状态：completed
- 类型：feature
- 负责人：Codex

## 背景与目标

任务列表的 `renderTaskList` 每次刷新都会销毁 `.tasklist-items` 滚动容器，即使内容与高度不变，浏览位置也会回到顶部。修复同一任务列表的重复刷新和进度更新，不改变显示、折叠、运行结束清空及 Tab 隔离规则。

本计划只交付“刷新保留同一列表浏览位置”的外部行为改进。来源证明了旧实现缺陷与先红后绿，但没有已发布版本背景，不能仅凭“修复”措辞归 bugfix；按新增滚动保留契约归 feature，不补造发布或安装事实。中央仍引用的旧 bugfix 目标暂留，待集成改引用后清理。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：历史测试开发、容器身份/列表隔离/自然缩高断言及 Chromium 消息桥证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-task-list-scroll-stability.md` 定位；此处仅作审计导航。
- [滚动清单与 runbook](2026-11-06-docs-task-list-scroll-stability.md#验收标准)：依据实现和回归事实同步产品契约及复用经验，不承担实现或测试开发。

## 范围与非目标

- 范围：`src/webview/viewContentScript/taskListAndUi.ts` 中任务列表局部 DOM 渲染，保持滚动容器与已有任务行身份。
- 非目标：聊天主区域滚动、CLI 协议、任务生命周期、布局与主题；历史测试/消息桥场景开发由上述审计记录追溯，不列入本计划任务或验收；功能清单/runbook 写作由存活 docs 计划负责。

## 验收标准

- [x] 重复渲染、任务状态或等高文本更新不重建滚动容器，保留滚动位置及已有任务行。
- [x] 增删任务正确反映内容；实际内容高度缩小时允许浏览器自然约束滚动范围。
- [x] 不同任务列表不继承上一列表滚动位置，清空与后续新建正常；显示、折叠和运行结束生命周期保持不变。
- [x] 历史构建和回归/Chromium 结果支持实现；测试开发及结果只作审计证据，文档写作由存活 docs 计划分别承接。

## 影响面与风险

- 代码：`src/webview/viewContentScript/taskListAndUi.ts`。
- 风险：Tab 切换错误复用容器；通过任务列表状态对象标识隔离，并以历史回归证据验证。回滚只撤销局部渲染改动；测试开发及其历史命令、失败/结果由上述审计项保留，不存在存活 test 计划。
- 文档影响归关联 docs；仅渲染行为，不改变业务语义，无需新增 ontology 规则。

## 验证计划与记录

- 历史 `npm run build` 通过；最小相关 158/158、全 Webview 390/390 及真实 Chromium 证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-task-list-scroll-stability.md` 见[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，本计划只使用这些执行结果证明实现，不认领测试开发。
- 历史通过代码检测、差异空白和 ontology 校验；shell 包装失败及修复见上述来源审计项，文档校验边界见存活 docs 计划。
- 本轮仅迁移静态计划，未执行历史命令。未启动 Extension Development Host，未调用真实模型、未发布或安装扩展；原文未声称 Windows/Linux 原生环境已验收，不新增该声明。

## 文档与记忆同步

[docs 计划](2026-11-06-docs-task-list-scroll-stability.md#文档与记忆同步)独立承接功能清单和 `runbooks/PITFALLS.md` 的实际写作；不以这类写作充当本计划收尾任务。

## 任务列表

- [completed] 核对重复刷新导致滚动容器重建的根因
- [completed] 实现同列表局部更新和状态对象隔离
- [completed] 按历史回归证据确认增删/缩高/清空行为，保留原布局与生命周期

## 当前结论

继承原 completed，实现完成；保留同一列表的滚动容器，从根因消除无高度变化的滚动归零，显示布局及生命周期保持不变。历史回归证据由审计项保留，文档由存活 docs 计划承接；不推导真实宿主、全平台或发布安装验收已完成。
