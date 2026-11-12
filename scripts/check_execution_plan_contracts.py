"""Read-only checks for the 2026-11-11 execution-plan migration v1 contract.

SHA field syntax does not authenticate original bytes. Keyword evidence does not
prove complete semantic classification or faithful splitting: human review is
still required. Only explicitly supplied mappings and their targets are read.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
from pathlib import Path, PurePosixPath, PureWindowsPath


MIGRATION_DATE = "2026-11-11"
PLAN_ROOT = ".ch/docs/exec-plans/"
PLAN_TYPES = ("feature", "bugfix", "refactor", "chore", "docs", "test", "perf")
PLAN_NAME = re.compile(
    rf"(?P<date>\d{{4}}-\d{{2}}-\d{{2}})-(?P<type>{'|'.join(PLAN_TYPES)})-"
    r"[a-z0-9]+(?:-[a-z0-9]+)*\.md"
)
BLOCKED_SOURCE = PLAN_ROOT + "active/2026-11-03-loop-routing-release-176.md"
LIMITATIONS = (
    "SHA 字段格式检查不证明原始字节哈希真实；关键词检查不证明语义分类完整，"
    "不能替代人工拆分审查，也不证明映射外的源覆盖或仓内引用完整。"
    "old_status=null 仅表示原头部状态元数据缺失，不默认任何状态，也不证明状态继承；"
    "目标仍须有非空显式状态，其真实性须人工核对原文证据。"
)


class ContractError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def repository_path(root: Path, value: object) -> Path:
    require(isinstance(value, str) and bool(value), "path must be a nonempty repository-relative string")
    require(
        not value.startswith("/")
        and not PureWindowsPath(value).drive
        and "\\" not in value
        and not any(part in ("", ".", "..") for part in value.split("/")),
        f"unsafe repository-relative path: {value!r}",
    )
    resolved = (root / value).resolve()
    require(resolved.is_relative_to(root), f"path escapes repository root: {value}")
    return resolved


def calendar_date(value: str) -> str:
    require(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)), f"invalid date: {value}")
    try:
        datetime.date.fromisoformat(value)
    except ValueError as error:
        raise ContractError(f"invalid date: {value}") from error
    return value


def exact_fields(value: object, fields: set[str], label: str) -> dict:
    require(isinstance(value, dict), f"{label} must be an object")
    require(set(value) == fields, f"{label} fields must be exactly {', '.join(sorted(fields))}")
    return value


def unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def metadata(content: str, field: str, required: bool = True) -> str | None:
    header_lines = []
    opening = True
    for line in content.splitlines():
        if not line.strip():
            continue
        if opening and re.match(r"^#{1,2}[ \t]+", line):
            opening = False
            continue
        opening = False
        if re.match(r"^-[ \t]+\[[ xX]\](?:[ \t]|$)", line):
            break
        if not re.match(r"^-[ \t]+[^:：]+[:：]", line):
            break
        header_lines.append(line)
    header = "\n".join(header_lines)
    values = re.findall(rf"^-[ \t]+(?:\*\*)?{field}(?:\*\*)?[ \t]*[:：][ \t]*(.*?)[ \t]*$", header, re.MULTILINE)
    require(len(values) <= 1, f"duplicate header metadata: {field}")
    require(bool(values) or not required, f"missing header metadata: {field}")
    if not values:
        return None
    value = values[0].strip().strip("`")
    require(bool(value), f"empty header metadata: {field}")
    return value


def check_target(root: Path, target: str, old_date: str, old_status: str | None) -> str:
    target_file = repository_path(root, target)
    require(target.startswith(PLAN_ROOT), f"target outside execution plans: {target}")
    parts = PurePosixPath(target[len(PLAN_ROOT):]).parts
    require(
        (len(parts) == 2 and parts[0] == "active")
        or (len(parts) == 3 and parts[0] == "completed"),
        f"target must be active or month-archived: {target}",
    )
    name = PLAN_NAME.fullmatch(parts[-1])
    require(name is not None, f"invalid typed plan name: {target}")
    plan_date = calendar_date(name['date'])
    require(plan_date == old_date, f"target date must inherit source date: {target}")
    if parts[0] == "completed":
        require(parts[1] == plan_date[:7], f"archive month/date mismatch: {target}")
        require(old_status != "blocked", f"blocked target cannot be archived completed: {target}")
    require(target_file.is_file(), f"target does not exist: {target}")
    content = target_file.read_text(encoding="utf-8")
    require(metadata(content, "日期") == plan_date, f"header date/name mismatch: {target}")
    target_status = metadata(content, "状态")
    if parts[0] == "completed":
        require(target_status != "blocked", f"blocked target cannot be archived completed: {target}")
    if old_status is not None:
        require(target_status == old_status, f"target must inherit original status {old_status!r}: {target}")
    plan_type = metadata(content, "类型", required=False)
    require(plan_type is None or plan_type == name['type'], f"type metadata/name mismatch: {target}")
    return content


def check_blocked_evidence(contents: list[str]) -> None:
    combined = "\n".join(contents)
    for label, pattern in (
        ("429 failure", r"\b429\b"),
        ("real acceptance gate", r"真实[^\n。]*验收[^\n。]*门禁"),
        ("not released", r"未发布|尚未发布|not (?:yet )?released"),
    ):
        require(bool(re.search(pattern, combined, re.IGNORECASE)), f"blocked source lost {label} evidence across targets")


def check_mappings(root: Path, mapping_paths: list[str]) -> list[str]:
    root = root.resolve()
    errors = []
    sources = set()
    targets = set()
    for mapping_path in mapping_paths:
        try:
            mapping_file = repository_path(root, mapping_path)
            document = json.loads(mapping_file.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
            document = exact_fields(document, {"version", "migration_date", "scope", "entries"}, "mapping")
            require(type(document["version"]) is int and document["version"] == 1, "version must be integer 1")
            require(document["migration_date"] == MIGRATION_DATE, f"migration_date must be {MIGRATION_DATE}")
            require(isinstance(document["scope"], str) and bool(document["scope"].strip()), "scope must be a nonempty string")
            entries = document["entries"]
            require(isinstance(entries, list) and bool(entries), "entries must be a nonempty array")
        except (ContractError, OSError, ValueError) as error:
            errors.append(f"{mapping_path}: {error}")
            continue
        for index, entry in enumerate(entries):
            label = f"{mapping_path}: entries[{index}]"
            try:
                entry = exact_fields(entry, {"old_path", "old_sha256", "old_status", "new_paths", "reference_path", "notes"}, "entry")
                old_path = entry["old_path"]
                repository_path(root, old_path)
                require(old_path.startswith(PLAN_ROOT), "old_path must belong to execution plans")
                old_name = PurePosixPath(old_path).name
                old_date = calendar_date(old_name[:10])
                require(old_path not in sources, f"duplicate original source: {old_path}")
                sources.add(old_path)
                require(isinstance(entry["old_sha256"], str) and bool(re.fullmatch(r"[0-9a-fA-F]{64}", entry["old_sha256"])), "old_sha256 must be 64 hexadecimal characters")
                old_status = entry["old_status"]
                require(old_status is None or (isinstance(old_status, str) and bool(old_status.strip())), "old_status must be a nonempty string or JSON null")
                require(isinstance(entry["notes"], str) and bool(entry["notes"].strip()), "notes must be a nonempty string")
                new_paths = entry["new_paths"]
                require(isinstance(new_paths, list) and bool(new_paths), "new_paths must be a nonempty array")
                for target in new_paths:
                    repository_path(root, target)
                    require(target not in targets, f"duplicate target: {target}")
                    targets.add(target)
                repository_path(root, entry["reference_path"])
                require(entry["reference_path"] in new_paths, "reference_path must belong to new_paths")
                if old_path == BLOCKED_SOURCE:
                    require(old_status == "blocked", "known November 3 source must remain blocked")
                contents = [check_target(root, target, old_date, old_status) for target in new_paths]
                if old_path == BLOCKED_SOURCE:
                    check_blocked_evidence(contents)
            except (ContractError, OSError, ValueError) as error:
                errors.append(f"{label}: {error}")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, epilog=LIMITATIONS)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="repository root")
    parser.add_argument("--mapping", action="append", required=True, help="repository-relative mapping JSON; repeat for cross-map uniqueness")
    arguments = parser.parse_args(argv)
    errors = check_mappings(arguments.root, arguments.mapping)
    print(LIMITATIONS)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"PASS: {len(arguments.mapping)} migration mapping(s); structural contract only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
