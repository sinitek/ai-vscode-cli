"""Constants for memory index generation."""

from __future__ import annotations

import re

GENERATOR_NAME = "memory-indexer"
GENERATOR_VERSION = "0.2.0"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/memory-index"
DEFAULT_STALE_DAYS = 30
MEMORY_DIR = ".ch/docs/memory"
MEMORY_RULES = ".ch/docs/MEMORY.md"
ACTIVE_PLANS_DIR = ".ch/docs/exec-plans/active"
CHARS_PER_TOKEN_ESTIMATE = 4
STARTER_HINTS = (
    "starter 默认",
    "starter 状态",
    "starter 默认留空",
    "starter 默认不预置",
)
PATH_PREFIXES = (
    ".ch/",
    "src/",
    "apps/",
    "packages/",
    "libs/",
    "scripts/",
    "infra/",
    "tests/",
    "app/",
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
PYRAMID_LEVEL_BY_MEMORY_TYPE = {
    "rolling_summary": "L1 rolling_summary",
    "event_memory": "L2 event_memory",
    "project_context": "L3 project_profile",
    "user_preferences": "L3 user_profile",
    "lesson": "L4 procedural_experience",
}
OBSERVATION_TYPE_BY_MEMORY_TYPE = {
    "rolling_summary": "summary",
    "event_memory": "event",
    "project_context": "context",
    "user_preferences": "preference",
    "pending_items": "pending",
    "active_risk": "risk",
    "lesson": "lesson",
    "memory_rules": "rule",
    "memory_index_rules": "rule",
}
STARTER_DOC_ALLOWLIST = {
    ".ch/docs/MEMORY.md",
    ".ch/docs/memory/README.md",
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
CLAIM_STATUS_BY_TYPE = {
    "risk": "active",
    "pending": "active",
    "lesson": "active",
    "plan": "active",
}
CLAIM_TYPE_BY_MEMORY_TYPE = {
    "user_preferences": "preference",
    "active_risk": "risk",
    "pending_items": "instruction",
    "lesson": "instruction",
    "memory_rules": "instruction",
}
REVIEW_AFTER_DAYS_BY_CLAIM_TYPE = {
    "decision": 90,
    "fact": 60,
    "hypothesis": 21,
    "instruction": 45,
    "preference": 120,
    "risk": 21,
}
SHORT_BULLET_MAX_LENGTH = 220

