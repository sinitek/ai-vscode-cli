"""Shared constants for memory consolidation."""

from __future__ import annotations

import re

GENERATOR_NAME = "memory-consolidator"
GENERATOR_VERSION = "0.1.0"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/memory-index"
DEFAULT_HANDOFF_LIMIT = 3
HANDOFFS_DIR = ".ch/docs/handoffs"
ACTIVE_PLANS_DIR = ".ch/docs/exec-plans/active"
MEMORY_DIR = ".ch/docs/memory"
DESIGN_DOCS_DIR = ".ch/docs/design-docs"
PITFALLS_DIR = ".ch/docs/runbooks/pitfalls"
EXCLUDED_FILENAMES = {"README.md", "TEMPLATE.md", ".keep"}
STARTER_HINTS = (
    "starter 默认",
    "starter 状态",
    "starter 默认留空",
    "starter 默认不预置",
    "当前为模板初始状态",
)
PRIVATE_TAG_NAMES = (
    "private",
    "no-memory",
    "memory-private",
    "system_instruction",
    "system-instruction",
    "system-reminder",
    "persisted-output",
)
PRIVATE_TAG_RE = re.compile(
    rf"<({'|'.join(re.escape(name) for name in PRIVATE_TAG_NAMES)})\b[^>]*>[\s\S]*?</\1>",
    re.IGNORECASE,
)
OPEN_LOOP_KEYWORDS = ("待", "未", "后续", "继续", "跟进", "补", "完善", "确认", "同步", "验证", "收尾", "推进")
RISK_KEYWORDS = ("风险", "阻塞", "卡住", "依赖", "不确定", "兼容", "失败", "报错", "异常", "观察", "前置", "回滚")
PITFALL_KEYWORDS = ("报错", "失败", "前置", "坑", "踩", "兼容", "不要", "避免", "注意", "环境", "目录", "权限", "依赖")
DESIGN_KEYWORDS = ("设计", "约束", "边界", "分层", "抽象", "统一", "规范", "默认", "架构", "策略", "模型", "接口", "契约")
EVENT_KEYWORDS = ("失败", "成功", "原因", "方案", "修复", "解决", "事故", "迁移", "回滚", "复盘", "上线", "阻塞", "决策")
PROFILE_KEYWORDS = ("用户要求", "用户偏好", "项目约束", "技术栈", "业务约束", "长期约束", "项目画像", "不允许替换技术栈")
USER_PROFILE_KEYWORDS = ("用户", "偏好", "沟通", "验证偏好", "实现偏好")
PROCEDURAL_KEYWORDS = ("每次", "必须", "不要", "避免", "步骤", "流程", "固定动作", "脚本", "自动", "检查", "规避")
ROLLING_SUMMARY_HEADERS = ("时间窗口", "摘要", "覆盖来源", "保留原因", "下一次复核")
EVENT_MEMORY_HEADERS = ("日期", "类型", "事件", "结果/原因", "可复用结论", "来源")
PENDING_ITEMS_HEADERS = ("事项", "状态", "Owner", "来源", "下一步")
ACTIVE_RISKS_HEADERS = ("风险", "影响", "当前缓解", "来源")
LESSONS_HEADERS = ("场景", "推荐动作", "来源")
