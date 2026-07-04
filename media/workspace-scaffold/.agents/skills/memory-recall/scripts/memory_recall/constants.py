"""Shared constants for memory recall generation."""

from __future__ import annotations

import re

GENERATOR_NAME = "memory-recall"
GENERATOR_VERSION = "0.3.0"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/memory-index"
DEFAULT_STALE_DAYS = 30
DEFAULT_RELATED_LIMIT = 4
DEFAULT_HANDOFF_LIMIT = 2
DEFAULT_INDEX_LIMIT = 12
DEFAULT_FULL_COUNT = 3
DEFAULT_TIMELINE_DEPTH = 3
HANDOFFS_DIR = ".ch/docs/handoffs"
DESIGN_DOCS_DIR = ".ch/docs/design-docs"
RUNBOOKS_DIR = ".ch/docs/runbooks"
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
HOT_ZONE_PRIORITY = {
    ".ch/docs/memory/ROLLING_SUMMARY.md": 0,
    ".ch/docs/memory/EVENT_MEMORY.md": 1,
    ".ch/docs/memory/PROJECT_CONTEXT.md": 2,
    ".ch/docs/memory/USER_PREFERENCES.md": 3,
    ".ch/docs/memory/ACTIVE_RISKS.md": 4,
    ".ch/docs/memory/PENDING_ITEMS.md": 5,
    ".ch/docs/memory/LESSONS_LEARNED.md": 6,
    ".ch/docs/memory/README.md": 7,
    ".ch/docs/MEMORY.md": 8,
}
HOT_ZONE_REASON = {
    ".ch/docs/memory/ROLLING_SUMMARY.md": "L1 滚动摘要入口，用于低成本恢复较旧阶段上下文。",
    ".ch/docs/memory/EVENT_MEMORY.md": "L2 事件记忆入口，用于召回失败原因、成功方案和关键决策。",
    ".ch/docs/memory/PROJECT_CONTEXT.md": "项目级长期上下文入口。",
    ".ch/docs/memory/USER_PREFERENCES.md": "长期协作和实现偏好入口。",
    ".ch/docs/memory/ACTIVE_RISKS.md": "当前仍有效的风险入口。",
    ".ch/docs/memory/PENDING_ITEMS.md": "跨会话未完成事项入口。",
    ".ch/docs/memory/LESSONS_LEARNED.md": "已验证经验入口。",
    ".ch/docs/memory/README.md": "热区边界和阅读顺序入口。",
    ".ch/docs/MEMORY.md": "记忆分层与流转规则入口。",
}
OBSERVATION_TYPE_PRIORITY = {
    "risk": 95,
    "pending": 90,
    "event": 85,
    "lesson": 80,
    "context": 75,
    "preference": 72,
    "plan": 68,
    "summary": 65,
    "rule": 45,
    "memory_doc": 40,
}
EXCLUDED_FILES = {"README.md", "TEMPLATE.md", ".keep"}
RUNBOOK_EXCLUDED_FILES = {"README.md", "PITFALLS_HISTORY.md"}
CJK_TOKEN_RE = re.compile(r"[㐀-䶿一-鿿]+")
CJK_BIGRAM_RE = re.compile(r"(?=([㐀-䶿一-鿿]{2}))")
