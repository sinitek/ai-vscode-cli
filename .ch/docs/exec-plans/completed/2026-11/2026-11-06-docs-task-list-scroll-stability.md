# AI 对话任务列表滚动清单与 runbook 同步

- 日期：2026-11-06
- 状态：completed
- 类型：docs
- 负责人：Codex

## 背景与目标

独立把刷新保留浏览位置的用户契约写入功能清单，并把销毁滚动容器导致浏览位置丢失的可复用经验写入既有 runbook，避免将实际文档写作隐藏为实现附带收尾。

## 关联计划

- [滚动保留实现](2026-11-06-feature-task-list-scroll-stability.md#验收标准)：提供同列表复用、自然缩高和跨列表隔离事实；没有已发布版本背景，不因“修复”措辞新增发布声明。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：历史双视口 DOM/布局及未做真实宿主/CLI 验收边界按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-task-list-scroll-stability.md` 定位；此处为审计而非存活测试导航。

## 范围与非目标

- 范围：功能清单和 `runbooks/PITFALLS.md` 的实际文档更新。
- 非目标：生产 DOM 修改、回归/场景开发、ontology 新规则或记忆流水；本轮不再次编辑外部 Markdown、本体或热区。

## 验收标准

- [x] 功能清单写明刷新保留同列表浏览位置，同时不改变显示、折叠、运行结束清空和 Tab 隔离。
- [x] 既有 runbook 记录容器重建导致滚动丢失的复用经验，不复制到热区记忆或事件记录。
- [x] 保留 ontology 无概念/权限/生命周期/事实来源变化、无需修改的依据，不增加真实 CLI/宿主或全平台成功承诺。

## 影响面与风险

仅产品清单与排障经验；风险是误承诺内容缩短也绝不改变 scrollTop，或把本机 Chromium 写成所有宿主都已验证。按实现自然约束和关联回归边界核对；回滚仅撤销误导文案。

## 验证计划

历史核对功能清单、既有 runbook 和无需更新 ontology 的边界，差异空白、Impeccable detector 与 ontology 校验通过。本轮只做计划局部结构/互链检查，不执行历史命令。

## 文档与记忆同步

- 功能清单补充刷新保留浏览位置的契约。
- 已在 `runbooks/PITFALLS.md` 记录容器重建导致滚动丢失的复用经验；不重复写入热区记忆或事件记录。
- 历史 `git diff --check`、Impeccable detector 与 ontology 校验通过。ontology 无业务概念、权限、生命周期或事实来源变化，无需修改；这里只保留检查结果，不认领 ontology 测试开发。
- 业务/浏览器回归、390/390 及 zsh `status` 包装失败见上述来源审计项；本 docs 计划不承接测试开发，不用文档完成掩盖未做真实环境验收。

## 任务列表

- [completed] 更新滚动保留功能清单契约
- [completed] 将容器重建经验写入 runbook 并确认不追加热区/事件记录
- [completed] 保留文档校验与无 ontology 语义变化结论

## 当前结论

继承原 completed，文档写作完成；未启动 Extension Development Host，未调用真实模型、未发布或安装扩展，不声明 Windows/Linux 原生环境已验证。没有以产品清单的完成状态替代实际集成验收。
