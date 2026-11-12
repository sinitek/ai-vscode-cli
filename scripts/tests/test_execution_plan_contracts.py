from __future__ import annotations

import copy
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path, PurePosixPath


ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR / "scripts"))

import check_execution_plan_contracts as contracts


class ExecutionPlanContractsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="execution plan contracts ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.mapping_path = ".ch/docs/exec-plans/migrations/fixture.json"
        self.target = contracts.PLAN_ROOT + "completed/2026-04/2026-04-22-feature-example.md"
        self.entry = {
            "old_path": contracts.PLAN_ROOT + "completed/2026-04/2026-04-22-example.md",
            "old_sha256": "0" * 64,
            "old_status": "completed",
            "new_paths": [self.target],
            "reference_path": self.target,
            "notes": "Preserve original state and evidence.",
        }
        self.document = {
            "version": 1,
            "migration_date": "2026-11-11",
            "scope": "Isolated fixture only",
            "entries": [self.entry],
        }
        self.write_plan(self.target)

    def write_plan(self, target: str, status: str = "completed", date: str = "2026-04-22",
                   plan_type: str | None = "feature", body: str = "", title_level: int = 1) -> None:
        target_file = self.root / target
        target_file.parent.mkdir(parents=True, exist_ok=True)
        type_line = f"- 类型：{plan_type}\n" if plan_type is not None else ""
        target_file.write_text(
            f"{'#' * title_level} Fixture\n\n- 日期：{date}\n{type_line}- 状态：{status}\n\n## Evidence\n{body}\n",
            encoding="utf-8",
        )

    def write_mapping(self, document: object | None = None, mapping_path: str | None = None) -> None:
        mapping_file = self.root / (mapping_path or self.mapping_path)
        mapping_file.parent.mkdir(parents=True, exist_ok=True)
        mapping_file.write_text(json.dumps(self.document if document is None else document), encoding="utf-8")

    def errors(self, document: object | None = None) -> list[str]:
        self.write_mapping(document)
        return contracts.check_mappings(self.root, [self.mapping_path])

    def assert_rejected(self, message: str, document: object | None = None) -> None:
        errors = self.errors(document)
        self.assertTrue(errors, "invalid fixture was accepted")
        self.assertIn(message, "\n".join(errors))

    def test_valid_mapping_does_not_require_old_bytes_or_authenticate_sha(self) -> None:
        self.assertFalse((self.root / self.entry["old_path"]).exists())
        self.assertEqual(self.errors(), [])
        self.assertIn("不证明原始字节哈希真实", contracts.LIMITATIONS)
        self.assertIn("不能替代人工拆分审查", contracts.LIMITATIONS)

    def test_exact_top_level_and_entry_schema(self) -> None:
        for field in self.document:
            with self.subTest(missing_top_field=field):
                document = copy.deepcopy(self.document)
                del document[field]
                self.assert_rejected("mapping fields", document)
        for field in self.entry:
            with self.subTest(missing_entry_field=field):
                document = copy.deepcopy(self.document)
                del document["entries"][0][field]
                self.assert_rejected("entry fields", document)
        for location in ("top", "entry"):
            with self.subTest(unknown_field=location):
                document = copy.deepcopy(self.document)
                destination = document if location == "top" else document["entries"][0]
                destination["typo"] = "unexpected"
                self.assert_rejected("fields must be exactly", document)
        self.assert_rejected("mapping must be an object", [])
        document = copy.deepcopy(self.document)
        document["entries"] = [None]
        self.assert_rejected("entry must be an object", document)

    def test_exact_version_and_migration_date(self) -> None:
        for version in (True, 1.0, "1", 0, 2, None):
            with self.subTest(version=version):
                self.assert_rejected("version must be integer 1", {**self.document, "version": version})
        for date in ("2026-11-10", "2026-11-12", "2026-11-11T00:00:00", "2026-2-31", None):
            with self.subTest(migration_date=date):
                self.assert_rejected("migration_date must be 2026-11-11", {**self.document, "migration_date": date})

    def test_nonempty_schema_values_and_array_types(self) -> None:
        for field, values in (("scope", ("", "  ", 5)), ("entries", ([], {}, None))):
            for value in values:
                with self.subTest(field=field, value=value):
                    self.assert_rejected(field, {**self.document, field: value})
        for field, values in (
            ("old_status", ("", " ", [], {}, 0, 1, 1.5, True, False)),
            ("notes", ("", None, 42)),
            ("new_paths", ([], self.target, None, {})),
        ):
            for value in values:
                with self.subTest(field=field, value=value):
                    document = copy.deepcopy(self.document)
                    document["entries"][0][field] = value
                    self.assert_rejected(field, document)

    def test_sha_requires_exactly_64_hex_characters(self) -> None:
        for digest in ("a" * 63, "a" * 65, "z" * 64, "a" * 64 + "\n", None, 123):
            with self.subTest(digest=digest):
                self.entry["old_sha256"] = digest
                self.assert_rejected("old_sha256")
        self.entry["old_sha256"] = "ABCDEF0123456789" * 4
        self.assertEqual(self.errors(), [])

    def test_duplicate_original_sources_and_targets(self) -> None:
        duplicate = copy.deepcopy(self.entry)
        self.document["entries"].append(duplicate)
        self.assert_rejected("duplicate original source")
        duplicate["old_path"] = self.entry["old_path"].replace("-example.md", "-other.md")
        self.assert_rejected("duplicate target")
        self.document["entries"].pop()
        self.entry["new_paths"].append(self.target)
        self.assert_rejected("duplicate target")

    def test_duplicates_across_mapping_files_are_rejected(self) -> None:
        other_mapping = self.mapping_path.replace("fixture.json", "second.json")
        self.write_mapping()
        self.write_mapping(mapping_path=other_mapping)
        errors = contracts.check_mappings(self.root, [self.mapping_path, other_mapping])
        self.assertIn("duplicate original source", "\n".join(errors))
        other_document = copy.deepcopy(self.document)
        other_document["entries"][0]["old_path"] = self.entry["old_path"].replace("-example.md", "-other.md")
        self.write_mapping(other_document, other_mapping)
        errors = contracts.check_mappings(self.root, [self.mapping_path, other_mapping])
        self.assertIn("duplicate target", "\n".join(errors))

    def test_reference_path_must_be_one_of_its_own_targets(self) -> None:
        self.entry["reference_path"] = self.target.replace("-example.md", "-foreign.md")
        self.write_plan(self.entry["reference_path"])
        self.assert_rejected("reference_path must belong to new_paths")

    def test_missing_target_is_rejected(self) -> None:
        (self.root / self.target).unlink()
        self.assert_rejected("target does not exist")

    def test_unsafe_paths_rejected_in_every_mapping_path_field(self) -> None:
        invalid_paths = (
            "", "/tmp/outside.md", "C:/outside.md", "C:outside.md", "Z:\\outside.md",
            "\\\\server\\share\\plan.md", "../outside.md", "safe/../../outside.md",
            "safe/../inside.md", "./inside.md", "safe//inside.md", "safe\\..\\outside.md", None,
        )
        for field in ("old_path", "new_paths", "reference_path"):
            for unsafe in invalid_paths:
                with self.subTest(field=field, path=unsafe):
                    document = copy.deepcopy(self.document)
                    document["entries"][0][field] = [unsafe] if field == "new_paths" else unsafe
                    self.assert_rejected("repository-relative", document)

    def test_mapping_path_cannot_escape_root(self) -> None:
        for unsafe in ("/tmp/map.json", "C:/map.json", "C:map.json", "../map.json", "safe/../../map.json"):
            with self.subTest(path=unsafe):
                errors = contracts.check_mappings(self.root, [unsafe])
                self.assertIn("repository-relative", "\n".join(errors))

    def test_symlink_target_and_mapping_cannot_escape_root(self) -> None:
        with tempfile.TemporaryDirectory() as outside:
            outside_file = Path(outside) / "external.md"
            outside_file.write_text("outside", encoding="utf-8")
            target_file = self.root / self.target
            target_file.unlink()
            target_file.symlink_to(outside_file)
            self.assert_rejected("escapes repository root")
            mapping_file = self.root / self.mapping_path
            mapping_file.unlink()
            mapping_file.symlink_to(outside_file)
            errors = contracts.check_mappings(self.root, [self.mapping_path])
            self.assertIn("escapes repository root", "\n".join(errors))

    def test_all_seven_types_and_optional_type_metadata(self) -> None:
        self.entry["new_paths"] = []
        for plan_type in contracts.PLAN_TYPES:
            target = self.target.replace("-feature-", f"-{plan_type}-")
            self.write_plan(target, plan_type=plan_type)
            self.entry["new_paths"].append(target)
        self.assertEqual(self.errors(), [])
        self.write_plan(self.target, plan_type=None)
        self.assertEqual(self.errors(), [])

    def test_strict_typed_names_reject_aliases_case_and_malformed_slugs(self) -> None:
        names = (
            "2026-04-22-feat-example.md", "2026-04-22-fix-example.md", "2026-04-22-build-example.md",
            "2026-04-22-example.md", "2026-04-22-feature-Example.md", "2026-04-22-feature-example_slug.md",
            "2026-04-22-feature-example--slug.md", "2026-04-22-feature--example.md",
            "2026-04-22-feature-example-.md", "2026-04-22-feature-.md", "2026-4-22-feature-example.md",
            "2026-04-22-feature-example.MD",
        )
        for name in names:
            with self.subTest(name=name):
                target = str(PurePosixPath(self.target).with_name(name))
                self.assertNotIn("\\", target)
                self.entry["new_paths"] = [target]
                self.entry["reference_path"] = target
                self.assert_rejected("invalid typed plan name")

    def test_archive_month_source_date_and_header_date_must_match(self) -> None:
        for target, message in (
            (self.target.replace("completed/2026-04/", "completed/2026-05/"), "archive month/date mismatch"),
            (self.target.replace("2026-04-22-feature", "2026-04-23-feature"), "inherit source date"),
            (self.target.replace("completed/2026-04/", "completed/"), "month-archived"),
            (self.target.replace(contracts.PLAN_ROOT, "other/"), "outside execution plans"),
        ):
            with self.subTest(target=target):
                self.entry["new_paths"] = [target]
                self.entry["reference_path"] = target
                self.assert_rejected(message)
        self.entry["new_paths"] = [self.target]
        self.entry["reference_path"] = self.target
        self.write_plan(self.target, date="2026-04-21")
        self.assert_rejected("header date/name mismatch")

    def test_impossible_calendar_dates_rejected_even_when_strings_match(self) -> None:
        self.entry["old_path"] = self.entry["old_path"].replace("2026-04-22", "2026-02-30")
        self.assert_rejected("invalid date")
        self.entry["old_path"] = self.entry["old_path"].replace("2026-02-30", "2026-04-22")
        target = self.target.replace("2026-04-22", "2026-02-30")
        self.entry["new_paths"] = [target]
        self.entry["reference_path"] = target
        self.assert_rejected("invalid date")

    def test_type_metadata_must_match_filename(self) -> None:
        self.write_plan(self.target, plan_type="test")
        self.assert_rejected("type metadata/name mismatch")

    def test_historical_validated_and_other_original_statuses_are_preserved(self) -> None:
        for status in ("validated", "draft", "in-progress", "historically-reviewed"):
            with self.subTest(status=status):
                self.entry["old_status"] = status
                self.write_plan(self.target, status=status)
                self.assertEqual(self.errors(), [])
                self.write_plan(self.target, status="completed")
                self.assert_rejected("inherit original status")

    def test_null_source_status_does_not_default_to_completed_or_prove_inheritance(self) -> None:
        self.entry["old_status"] = None
        self.assertEqual(self.errors(), [])
        active = self.target.replace("completed/2026-04/", "active/")
        self.entry.update(new_paths=[active], reference_path=active)
        for status in ("draft", "in-progress", "blocked"):
            with self.subTest(status=status):
                self.write_plan(active, status=status)
                self.assertEqual(self.errors(), [])
        self.assertIn("old_status=null 仅表示原头部状态元数据缺失", contracts.LIMITATIONS)
        self.assertIn("不默认任何状态，也不证明状态继承", contracts.LIMITATIONS)

    def test_null_source_status_still_requires_nonempty_target_header_status(self) -> None:
        self.entry["old_status"] = None
        for title_level in (1, 2):
            for status_line, message in (("", "missing"), ("- 状态：\n", "empty")):
                with self.subTest(title_level=title_level, status_line=status_line):
                    self.write_plan(self.target, title_level=title_level, body="- 状态：completed")
                    target_file = self.root / self.target
                    content = target_file.read_text(encoding="utf-8")
                    content = content.replace("- 状态：completed\n", status_line, 1)
                    target_file.write_text(content, encoding="utf-8")
                    self.assert_rejected(f"{message} header metadata: 状态")

    def test_null_source_status_keeps_target_structure_checks(self) -> None:
        self.entry["old_status"] = None
        for target, message in (
            (self.target.replace("-feature-", "-feat-"), "invalid typed plan name"),
            (self.target.replace("2026-04-22-feature", "2026-04-23-feature"), "inherit source date"),
            (self.target.replace("completed/2026-04/", "completed/2026-05/"), "archive month/date mismatch"),
            (self.target.replace("completed/2026-04/", "completed/"), "month-archived"),
            (self.target.replace(contracts.PLAN_ROOT, "other/"), "outside execution plans"),
            ("../outside.md", "repository-relative"),
            (self.target.replace("-example.md", "-missing.md"), "target does not exist"),
        ):
            with self.subTest(target=target):
                self.entry.update(new_paths=[target], reference_path=target)
                self.assert_rejected(message)
        self.entry.update(new_paths=[self.target], reference_path=self.target)
        self.write_plan(self.target, date="2026-04-21")
        self.assert_rejected("header date/name mismatch")
        self.write_plan(self.target, plan_type="test")
        self.assert_rejected("type metadata/name mismatch")

    def test_null_source_status_does_not_allow_archived_blocked_target(self) -> None:
        self.entry["old_status"] = None
        self.write_plan(self.target, status="blocked")
        self.assert_rejected("blocked target cannot be archived completed")

    def test_opening_level_one_and_two_titles_preserve_header_metadata(self) -> None:
        for title_level in (1, 2):
            with self.subTest(title_level=title_level):
                self.write_plan(self.target, title_level=title_level)
                self.assertEqual(self.errors(), [])

    def test_header_metadata_cannot_be_forged_by_body_or_duplicates(self) -> None:
        for title_level in (1, 2):
            for field in ("日期", "状态"):
                with self.subTest(title_level=title_level, field=field):
                    self.write_plan(self.target, title_level=title_level)
                    target_file = self.root / self.target
                    content = target_file.read_text(encoding="utf-8")
                    header, body = content.split("## Evidence")
                    line = next(line for line in header.splitlines() if line.startswith(f"- {field}："))
                    target_file.write_text(header.replace(line, "") + "## Evidence\n" + line + body, encoding="utf-8")
                    self.assert_rejected("missing header metadata")
                    target_file.write_text(header + line + "\n## Evidence\n" + body, encoding="utf-8")
                    self.assert_rejected("duplicate header metadata")

    def test_real_body_boundaries_cannot_supply_or_override_header_metadata(self) -> None:
        for title_level in (1, 2):
            for boundary in ("# Body", "## Body", "### Body", "Body prose.", "```text", "- [ ] Body task"):
                with self.subTest(title_level=title_level, boundary=boundary):
                    title = "#" * title_level + " Fixture"
                    forged = "- 日期：2026-04-21\n- 状态：blocked\n- 类型：test\n"
                    header = "- 日期：2026-04-22\n- 状态：completed\n"
                    content = f"\n\n{title}\n\n{header}\n{boundary}\n{forged}"
                    self.assertEqual(contracts.metadata(content, "日期"), "2026-04-22")
                    self.assertEqual(contracts.metadata(content, "状态"), "completed")
                    self.assertIsNone(contracts.metadata(content, "类型", required=False))
                    for field in ("日期", "状态"):
                        missing = re.sub(rf"^- {field}：[^\n]*\n", "", header, flags=re.MULTILINE)
                        content = f"{title}\n\n{missing}\n{boundary}\n{forged}"
                        with self.assertRaisesRegex(contracts.ContractError, f"missing header metadata: {field}"):
                            contracts.metadata(content, field)

    def test_checkbox_body_with_colons_cannot_supply_or_override_header_metadata(self) -> None:
        for title_level in (1, 2):
            for marker in ("[ ]", "[x]", "[X]"):
                for colon in (":", "："):
                    with self.subTest(title_level=title_level, marker=marker, colon=colon):
                        title = "#" * title_level + " Fixture"
                        header = "- 日期：2026-04-22\n- 状态：completed\n"
                        body = f"- {marker} Body task{colon} evidence\n\n"
                        forged = "- 日期：2026-04-21\n- 状态：blocked\n- 类型：test\n"
                        content = f"{title}\n\n{header}\n{body}{forged}"
                        target_file = self.root / self.target
                        target_file.write_text(content, encoding="utf-8")
                        self.assertEqual(self.errors(), [])
                        self.assertEqual(contracts.metadata(content, "日期"), "2026-04-22")
                        self.assertEqual(contracts.metadata(content, "状态"), "completed")
                        self.assertIsNone(contracts.metadata(content, "类型", required=False))
                        for field in ("日期", "状态"):
                            missing = re.sub(rf"^- {field}：[^\n]*\n", "", header, flags=re.MULTILINE)
                            content = f"{title}\n\n{missing}\n{body}{forged}"
                            target_file.write_text(content, encoding="utf-8")
                            self.assert_rejected(f"missing header metadata: {field}")

    def test_empty_header_metadata_cannot_consume_the_next_field(self) -> None:
        for title_level in (1, 2):
            for field in ("日期", "状态"):
                with self.subTest(title_level=title_level, field=field):
                    self.write_plan(self.target, title_level=title_level)
                    target_file = self.root / self.target
                    content = target_file.read_text(encoding="utf-8")
                    content = re.sub(rf"^- {field}：[^\n]*", f"- {field}：", content, flags=re.MULTILINE)
                    target_file.write_text(content, encoding="utf-8")
                    self.assert_rejected(f"empty header metadata: {field}")

    def blocked_fixture(self) -> tuple[str, str]:
        implementation = contracts.PLAN_ROOT + "active/2026-11-03-bugfix-routing.md"
        release = contracts.PLAN_ROOT + "active/2026-11-03-chore-live-release.md"
        self.entry.update(
            old_path=contracts.BLOCKED_SOURCE, old_status="blocked",
            new_paths=[implementation, release], reference_path=release,
            notes="429；保留真实验收门禁；未发布。映射注释不能替代计划事实。",
        )
        self.write_plan(implementation, "blocked", "2026-11-03", "bugfix", "子模型真实调用失败：HTTP 429。")
        self.write_plan(release, "blocked", "2026-11-03", "chore", "用户选择保留真实验收门禁；未发布 1.7.6。")
        return implementation, release

    def test_blocked_evidence_can_be_distributed_across_related_targets(self) -> None:
        self.blocked_fixture()
        self.assertEqual(self.errors(), [])

    def test_blocked_failure_gate_and_unreleased_facts_cannot_disappear(self) -> None:
        for removed, message in (("429", "429 failure"), ("真实验收门禁", "real acceptance gate"), ("未发布", "not released")):
            with self.subTest(removed=removed):
                targets = self.blocked_fixture()
                for target in targets:
                    target_file = self.root / target
                    target_file.write_text(target_file.read_text(encoding="utf-8").replace(removed, "删除"), encoding="utf-8")
                self.assert_rejected(message)

    def test_each_blocked_target_must_inherit_status(self) -> None:
        implementation, release = self.blocked_fixture()
        self.write_plan(implementation, "completed", "2026-11-03", "bugfix", "429")
        self.assert_rejected("inherit original status")
        self.blocked_fixture()
        self.write_plan(release, "completed", "2026-11-03", "chore", "真实验收门禁；未发布")
        self.assert_rejected("inherit original status")

    def test_blocked_target_cannot_be_archived_even_with_blocked_header(self) -> None:
        implementation, release = self.blocked_fixture()
        archived = release.replace("active/", "completed/2026-11/")
        self.write_plan(archived, "blocked", "2026-11-03", "chore", "真实验收门禁；未发布")
        self.entry["new_paths"] = [implementation, archived]
        self.entry["reference_path"] = archived
        self.assert_rejected("blocked target cannot be archived completed")

    def test_known_blocked_source_cannot_be_relabelled_completed_or_null_in_mapping(self) -> None:
        self.blocked_fixture()
        for status in ("completed", None):
            with self.subTest(status=status):
                self.entry["old_status"] = status
                self.assert_rejected("known November 3 source must remain blocked")

    def test_invalid_json_duplicate_keys_and_unreadable_input(self) -> None:
        self.write_mapping()
        mapping_file = self.root / self.mapping_path
        for raw in ('{"version":', '{"version":1,"version":1}', '\xff'):
            with self.subTest(raw=raw):
                mapping_file.write_bytes(raw.encode("latin-1"))
                self.assertTrue(contracts.check_mappings(self.root, [self.mapping_path]))
        mapping_file.unlink()
        self.assertTrue(contracts.check_mappings(self.root, [self.mapping_path]))

    def test_cli_is_read_only_and_reports_success_failure_and_limits(self) -> None:
        self.write_mapping()
        before = {target.relative_to(self.root): target.read_bytes() for target in self.root.rglob("*") if target.is_file()}
        command = [sys.executable, str(ROOT_DIR / "scripts/check_execution_plan_contracts.py"),
                   "--root", str(self.root), "--mapping", self.mapping_path]
        success = subprocess.run(command, capture_output=True, text=True, cwd=self.root, check=False)
        self.assertEqual(success.returncode, 0, success.stdout + success.stderr)
        self.assertIn("PASS:", success.stdout)
        self.assertIn(contracts.LIMITATIONS, success.stdout)
        after = {target.relative_to(self.root): target.read_bytes() for target in self.root.rglob("*") if target.is_file()}
        self.assertEqual(after, before)
        (self.root / self.target).unlink()
        failure = subprocess.run(command, capture_output=True, text=True, cwd=self.root, check=False)
        self.assertEqual(failure.returncode, 1)
        self.assertIn("target does not exist", failure.stdout)
        self.assertNotIn("Traceback", failure.stderr)


if __name__ == "__main__":
    unittest.main()
