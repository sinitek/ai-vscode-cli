# 系统通知焦点规则与使用说明同步

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：docs

## 背景与目标

将前后台都发送系统通知、仅后台窗口闪烁的稳定事实同步到设置/使用说明、产品规格、架构和 ontology。

## 范围与非目标

- 已同步 `FEATURE_INVENTORY.md`、能力规格、设置描述、使用说明、`ARCHITECTURE.md` 和 ontology 两条提醒规则。
- 使用说明仅修改文案，无布局或交互变化；不承担通知控制器或测试开发，不新增热区记忆/事件条目。

## 验收标准

说明区分系统通知与后台窗口提醒，保留通知开关和远程宿主边界；文案不把接口成功表述为横幅已显示。

## 风险与缓解

与远端“工具设置 → 通知授权”、两个独立通知开关及说明的冲突处理由关联 chore 记录；不得覆盖远端设置事实。

## 验证计划与历史结果

- 原计划命令：`python .agents/skills/ontology/scripts/search_ontology.py --validate`、`python -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`。
- ontology 校验通过；`PYTHONUTF8=1 PYTHONIOENCODING=utf-8` 下上述 Python 单测 9 项全部通过。
- 首次 Python 单测失败分类为 Windows 编码环境问题：父进程按 GBK 解码 UTF-8 子进程输出。启用上述 UTF-8 环境后全部通过，未改测试实现。
- 既有 Webview 单测通过；未启动浏览器验收。远端同步后校验、九项单测及空白结果见 chore，均为历史执行。

## 当前状态

稳定规则文档同步完成；不声称新增 ontology 测试或本轮改写产品文档。

## 关联计划

- [feature：系统通知独立于窗口焦点](2026-11-05-feature-desktop-notification-focus.md#背景与目标)：分别承接系统通知独立于窗口焦点，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留系统通知焦点与宿主回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-desktop-notification-focus.md`；不再作为现行测试责任。
- [chore：系统通知远端同步与本机构建依赖恢复](2026-11-05-chore-desktop-notification-focus.md#背景与目标)：分别承接系统通知远端同步与本机构建依赖恢复，共享本来源的历史背景与接口。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
