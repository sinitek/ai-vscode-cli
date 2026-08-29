from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT = REPO_ROOT / ".agents/skills/memory-consolidator/scripts/consolidate_memory.py"


def load_consolidator_module():
    module_name = "memory_consolidator_under_test"
    spec = importlib.util.spec_from_file_location(module_name, SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class MemoryConsolidatorTest(unittest.TestCase):
    def test_limit_suggestions_by_kind_keeps_active_plan_context_first(self) -> None:
        module = load_consolidator_module()

        def suggestion(kind: str, source_path: str, text: str, confidence: str = "high"):
            return module.Suggestion(
                kind=kind,
                destination=".ch/docs/memory/EVENT_MEMORY.md",
                confidence=confidence,
                source_path=source_path,
                source_section="测试",
                text=text,
                reason="测试",
                draft_fields={"建议": text},
            )

        suggestions = [
            suggestion("event_memory", ".ch/docs/runbooks/pitfalls/example.md", "pitfall 1"),
            suggestion("event_memory", ".ch/docs/runbooks/pitfalls/example.md", "pitfall 2"),
            suggestion("event_memory", ".ch/docs/exec-plans/active/current.md", "active plan", "medium"),
            suggestion("pending_item", ".ch/docs/exec-plans/active/current.md", "pending"),
        ]

        kept, limit = module.limit_suggestions_by_kind(suggestions, 2)

        self.assertEqual(limit["suppressed_total"], 1)
        self.assertEqual(limit["suppressed_by_kind"], {"event_memory": 1})
        self.assertEqual([item.text for item in kept if item.kind == "event_memory"], ["active plan", "pitfall 1"])
        self.assertEqual([item.text for item in kept if item.kind == "pending_item"], ["pending"])

    def test_zero_limit_keeps_all_suggestions(self) -> None:
        module = load_consolidator_module()
        suggestions = [
            module.Suggestion(
                kind="lesson",
                destination=".ch/docs/memory/LESSONS_LEARNED.md",
                confidence="high",
                source_path="source.md",
                source_section="测试",
                text=f"lesson {index}",
                reason="测试",
                draft_fields={},
            )
            for index in range(3)
        ]

        kept, limit = module.limit_suggestions_by_kind(suggestions, 0)

        self.assertEqual(kept, suggestions)
        self.assertEqual(limit["suppressed_total"], 0)


if __name__ == "__main__":
    unittest.main()
