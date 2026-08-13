from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path
from types import ModuleType


REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT = REPO_ROOT / ".agents/skills/ontology/scripts/search_ontology.py"


def load_search_module() -> ModuleType:
    module_name = "ontology_search_under_test"
    spec = importlib.util.spec_from_file_location(module_name, SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class OntologySearchCliTest(unittest.TestCase):
    def run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_validate_current_ontology(self) -> None:
        result = self.run_cli("--validate", "--json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        validation = payload["validation"]
        self.assertTrue(validation["valid"])
        self.assertEqual(validation["issue_count"], 0)
        self.assertGreaterEqual(validation["counts"]["domain"], 2)
        self.assertGreaterEqual(validation["counts"]["concept"], 6)
        self.assertGreaterEqual(validation["counts"]["workflow"], 1)

    def test_chinese_query_returns_harness_rule(self) -> None:
        result = self.run_cli("任务列表", "--domain", "harness-governance", "--type", "rule", "--json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        result_ids = {item["id"] for item in payload["results"]}
        self.assertIn("harness.rule.tasklist_format", result_ids)

    def test_exact_id_expands_related_concepts(self) -> None:
        result = self.run_cli("--id", "harness.ontology", "--related", "1", "--json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["count"], 1)
        record = payload["results"][0]
        self.assertEqual(record["id"], "harness.ontology")
        related_ids = {item["to"] for item in record["related"]}
        self.assertIn("harness.agent_rules", related_ids)

    def test_domain_and_record_type_filters(self) -> None:
        result = self.run_cli(
            "事实来源",
            "--match",
            "any",
            "--domain",
            "harness-governance",
            "--type",
            "rule",
            "--json",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["results"])
        for item in payload["results"]:
            self.assertEqual(item["record_type"], "rule")
            self.assertIn("harness-governance", item["domains"])

    def test_no_match_query_returns_empty_results(self) -> None:
        result = self.run_cli("definitely_missing_ontology_record_xxyy", "--json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["count"], 0)

    def test_status_report_flags_empty_or_scaffold_placeholder_ontology(self) -> None:
        result = self.run_cli("--status-report", "--json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        status = payload["status"]
        if "project-system" in status["business_domain_ids"]:
            self.assertTrue(status["needs_initialization"])
            self.assertTrue(status["placeholder_only"])
        else:
            self.assertFalse(status["needs_initialization"])
            self.assertFalse(status["placeholder_only"])

    def test_status_report_flags_empty_index(self) -> None:
        module = load_search_module()
        index = module.OntologyIndex(
            root=REPO_ROOT,
            ontology_dir=REPO_ROOT / ".ch/docs/ontology",
            manifest={"domain_files": [], "workflow_files": []},
            records=[],
        )

        status = module.ontology_status_report(index)
        self.assertTrue(status["needs_initialization"])
        self.assertTrue(status["empty"])

    def test_expand_related_handles_cyclic_relation_graph(self) -> None:
        module = load_search_module()

        def concept(record_id: str) -> object:
            return module.build_record(
                {
                    "id": record_id,
                    "name": record_id,
                    "kind": "entity",
                    "description": record_id,
                    "status": "active",
                    "source_refs": [{"path": "AGENTS.md"}],
                },
                "concept",
                ("cycle-domain",),
                "cycle.json",
            )

        def relation(record_id: str, source: str, target: str) -> object:
            return module.build_record(
                {
                    "id": record_id,
                    "name": record_id,
                    "description": record_id,
                    "status": "active",
                    "from": source,
                    "type": "references",
                    "to": target,
                    "cardinality": "N:N",
                    "source_refs": [{"path": "AGENTS.md"}],
                },
                "relation",
                ("cycle-domain",),
                "cycle.json",
            )

        concept_a = concept("cycle.a")
        concept_b = concept("cycle.b")
        concept_c = concept("cycle.c")
        index = module.OntologyIndex(
            root=REPO_ROOT,
            ontology_dir=REPO_ROOT / ".ch/docs/ontology",
            manifest={},
            records=[
                concept_a,
                concept_b,
                concept_c,
                relation("cycle.relation.a_b", "cycle.a", "cycle.b"),
                relation("cycle.relation.b_c", "cycle.b", "cycle.c"),
                relation("cycle.relation.c_a", "cycle.c", "cycle.a"),
            ],
        )

        related = module.expand_related(index, concept_a, 10)
        edge_keys = {
            (item["from"], item["relation_id"], item["to"])
            for item in related
        }
        self.assertEqual(len(related), len(edge_keys))
        self.assertLessEqual(len(related), 6)
        self.assertIn(("cycle.a", "cycle.relation.a_b", "cycle.b"), edge_keys)
        self.assertIn(("cycle.a", "cycle.relation.c_a", "cycle.c"), edge_keys)

    def test_payload_object_keys_are_searchable(self) -> None:
        module = load_search_module()
        record = module.build_record(
            {
                "id": "test.key_search_record",
                "name": "键名检索记录",
                "kind": "entity",
                "description": "只有 JSON 键名包含目标词。",
                "status": "active",
                "source_refs": [{"path": "AGENTS.md"}],
                "stableCodeIdentifier": "unrelated value",
            },
            "concept",
            ("test-domain",),
            "test.json",
        )

        _score, matched_terms = module.score_record(
            record,
            ["stablecodeidentifier"],
            "stablecodeidentifier",
        )
        self.assertIn("stablecodeidentifier", matched_terms)


if __name__ == "__main__":
    unittest.main()
