# Loop+ 成员定位验收气泡

- 日期：2026-11-11
- 类型：feature
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json`，覆盖定位规则和浏览器交互回归。

## 背景与目标

上一任务切模型已通过提交 `d0e47a72` 推送到 `origin/master`。本任务让 Loop+ 群聊中已有验收结果的成员可点击定位最近一次验收气泡，不区分验收成功或失败。

## 范围与非目标

复用成员列表、验收反馈和现有滚动机制；新反馈记录不展示的事件身份，旧反馈仅在标题能唯一匹配时兼容定位。保留可定位的验收气泡，避免消息限额生成悬空入口。不改变调度状态、验收判定、CLI 或经典 Loop 行为，不提交无关文档迁移，不发布扩展。

## 验收标准

- 成功和失败成员均可定位对应验收气泡；批量验收允许多个成员定位同一气泡。
- 多次验收定位最近一次已验收 attempt，避免同名成员或旧 attempt 误匹配。
- 无验收气泡时不显示可点击入口；经典 Loop 不增加入口。
- 点击及键盘激活均滚动并聚焦目标；窄屏收起成员抽屉，减少动态效果偏好得到尊重。
- 自动刷新和消息清理后入口仍指向存在的目标。

## 影响面与风险

涉及验收反馈序列化、群聊渲染、主题样式与功能清单。旧记录无事件身份时有歧义，采取唯一标题匹配且不猜测；最新可定位气泡按保护项处理，不改变普通气泡清理算法。回滚可移除入口与隐藏元数据，新旧 transcript 保持可读。

## 验证计划与文档同步

执行 `npm run build`、相关 Node 单测、Chromium 宽窄屏交互验证；同步功能清单、能力规格、群聊气泡保留设计和 ontology。已删除测试计划的开发范围与历史验证摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（removed_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-test-loop-plus-acceptance-anchor.md; reference_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-feature-loop-plus-acceptance-anchor.md; source_old_path=null；entries[81]）。该审计仅供历史追溯，不是存活测试计划或当前执行负责人；本 feature 不承接测试开发。发现失败时先区分本次缺陷与既有基线问题。

## 当前结论

已完成验收事件身份、最近一次已验收 attempt 关联、成员原生按钮、滚动与焦点、窄屏抽屉关闭以及目标气泡清理保护。旧反馈按唯一完整标题兼容；错误或无明确反馈时不显示入口。功能清单、能力规格、群聊限额设计及 ontology 已同步；无需更新架构总览或记忆热区，长期事实保留在专题规格和设计文档中。

## 最终验收

- `npm run build` 通过，日志 `.tmp/loop-plus-acceptance-anchor-build.log`。
- 相关 Node 回归 267/267 通过，含 10 项新增定位测试及宿主真实反馈身份断言；原测试命令与扩展基线分类的审计保留摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（removed_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-test-loop-plus-acceptance-anchor.md; reference_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-feature-loop-plus-acceptance-anchor.md; source_old_path=null）。该来源没有迁移原来源标识，不存在可导航的存活测试计划；审计摘要不等同完整运行日志。
- Chromium 桌面 1440×820、窄屏 390×820，深/浅主题四组合通过；鼠标、键盘、目标聚焦、抽屉收起、最新 attempt 更新、旧目标清理、未变化补丁保留焦点和滚动均已验证，浏览器/网络错误为零。记录及截图位于 `.tmp/playwright-smoke/loop-plus-acceptance-anchor/`。
- Ontology 校验仍有 1 项既有模型导入计划迁移引用缺失，修改前后完全一致；ontology 测试 8/9 通过，唯一失败对应同一既有引用。本次新规则及来源均有效。
- `git diff --check` 通过；UI 检测器仅报告既有引用块左边框，未修改无关样式。未调用真实 CLI 或付费模型，未做完整 VS Code Extension Development Host 端到端或 Windows/Linux 实机验证。
- 仅上一任务切模型提交 `d0e47a72` 已推送；本轮定位功能保持工作区改动，未另行提交或推送，不包含任何无关文档迁移。
