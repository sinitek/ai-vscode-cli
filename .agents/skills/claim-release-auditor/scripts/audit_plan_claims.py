#!/usr/bin/env python3
"""Audit claim/release health for active execution plans."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, time, timedelta
from pathlib import Path

DEFAULT_OUTPUT_DIR = ".ch/docs/generated"
UNASSIGNED = {"", "未指定"}


@dataclass
class ClaimAuditEntry:
    level: str
    path: str
    title: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit claim/release state for active plans.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated claim audit files. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--expiring-hours",
        type=int,
        default=24,
        help="Warn when a claim will expire within this many hours.",
    )
    parser.add_argument("--strict", action="store_true", help="Return non-zero when issues are found.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_output_dir(root, args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    refresh_work_frontier(root, output_dir)
    summary = load_json(output_dir / "work-frontier-summary.json")
    plans = summary.get("plans", [])
    if not isinstance(plans, list):
        raise SystemExit("ERROR: invalid work-frontier summary format.")

    now = datetime.now(UTC)
    issues: list[ClaimAuditEntry] = []
    warnings: list[ClaimAuditEntry] = []
    expiring: list[ClaimAuditEntry] = []

    for raw_plan in plans:
        if not isinstance(raw_plan, dict):
            continue
        audit_plan(raw_plan, now, args.expiring_hours, issues, warnings, expiring)

    report = render_report(plans, issues, warnings, expiring, args.expiring_hours)
    report_path = output_dir / "claim-audit.md"
    summary_path = output_dir / "claim-audit-summary.json"
    report_path.write_text(report, encoding="utf-8")
    summary_path.write_text(
        json.dumps(
            {
                "generator": "claim-release-auditor",
                "generated_at": now.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "repo_root": str(root),
                "active_plan_count": len(plans),
                "issue_count": len(issues),
                "warning_count": len(warnings),
                "expiring_count": len(expiring),
                "issues": [entry.to_dict() for entry in issues],
                "warnings": [entry.to_dict() for entry in warnings],
                "expiring": [entry.to_dict() for entry in expiring],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"[claim-release-auditor] wrote {report_path}")
    print(f"[claim-release-auditor] wrote {summary_path}")
    print(f"- issues: {len(issues)}")
    print(f"- warnings: {len(warnings)}")
    print(f"- expiring soon: {len(expiring)}")
    if args.strict and issues:
        return 1
    return 0


def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def refresh_work_frontier(root: Path, output_dir: Path) -> None:
    script_path = (
        Path(__file__).resolve().parents[2]
        / "work-frontier"
        / "scripts"
        / "build_work_frontier.py"
    )
    subprocess.run(
        [
            sys.executable,
            str(script_path),
            "--root",
            str(root),
            "--output-dir",
            str(output_dir),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def audit_plan(
    plan: dict[str, object],
    now: datetime,
    expiring_hours: int,
    issues: list[ClaimAuditEntry],
    warnings: list[ClaimAuditEntry],
    expiring: list[ClaimAuditEntry],
) -> None:
    path = str(plan.get("path", "unknown"))
    title = str(plan.get("title", path))
    status = str(plan.get("status", "draft"))
    owner = normalize_value(plan.get("owner"))
    claimed_at_raw = normalize_value(plan.get("claimed_at"))
    claim_ttl_raw = normalize_value(plan.get("claim_ttl"))
    handoff_to = normalize_value(plan.get("handoff_to"))

    has_claim = any([owner, claimed_at_raw, claim_ttl_raw, handoff_to])
    claimed_at = parse_datetime_value(claimed_at_raw) if claimed_at_raw else None

    if claimed_at_raw and claimed_at is None:
        issues.append(entry("issue", path, title, f"`claimed_at` 格式无法解析：{claimed_at_raw}"))
    if claim_ttl_raw and not claimed_at:
        issues.append(entry("issue", path, title, "存在 `claim_ttl`，但缺少可解析的 `claimed_at`，无法判断 claim 是否过期。"))
    if claimed_at and not owner:
        issues.append(entry("issue", path, title, "存在 `claimed_at`，但缺少 `owner`。"))
    if owner and status in {"in-progress", "blocked"} and not claimed_at:
        warnings.append(entry("warning", path, title, "当前计划已声明 `owner`，但缺少 `claimed_at`。"))
    if owner and status in {"in-progress", "blocked"} and not claim_ttl_raw:
        warnings.append(entry("warning", path, title, "当前计划已声明 `owner`，但缺少 `claim_ttl`。"))
    if status in {"in-progress", "blocked"} and not has_claim:
        warnings.append(entry("warning", path, title, "活跃计划缺少 claim 字段；如存在并发协作，建议补 `owner` / `claimed_at` / `claim_ttl`。"))
    if status == "blocked" and owner and not handoff_to:
        warnings.append(entry("warning", path, title, "blocked 计划已有 owner，但缺少 `handoff_to`。"))
    if status == "completed" and has_claim:
        warnings.append(entry("warning", path, title, "计划已 completed，但仍保留 claim 字段；确认是否应释放或清理。"))

    expires_at = resolve_expiry(now, claimed_at, claim_ttl_raw)
    if claim_ttl_raw and claimed_at and expires_at is None:
        issues.append(entry("issue", path, title, f"`claim_ttl` 无法解析：{claim_ttl_raw}"))
    if expires_at is not None:
        if expires_at <= now and status != "completed":
            issues.append(entry("issue", path, title, f"claim 已过期：expires_at={format_datetime(expires_at)}"))
        elif expires_at > now and expires_at - now <= timedelta(hours=expiring_hours):
            expiring.append(entry("warning", path, title, f"claim 即将到期：expires_at={format_datetime(expires_at)}"))


def normalize_value(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_datetime_value(value: str | None) -> datetime | None:
    if not value:
        return None
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def resolve_expiry(now: datetime, claimed_at: datetime | None, claim_ttl_raw: str) -> datetime | None:
    if not claim_ttl_raw or not claimed_at:
        return None
    ttl = claim_ttl_raw.strip().lower()

    absolute = parse_datetime_value(ttl)
    if absolute is not None:
        return absolute

    absolute_date = parse_date_only(ttl, claimed_at.tzinfo or UTC)
    if absolute_date is not None:
        return absolute_date

    if ttl == "today":
        return end_of_day(now)
    if ttl == "tomorrow":
        return end_of_day(now + timedelta(days=1))

    matched = re_duration(ttl)
    if matched is not None:
        amount, unit = matched
        delta = duration_to_timedelta(amount, unit)
        if delta is None:
            return None
        return claimed_at + delta

    return None


def parse_date_only(value: str, tzinfo) -> datetime | None:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None
    return datetime.combine(parsed, time(23, 59, 59), tzinfo=tzinfo).astimezone(UTC)


def end_of_day(source: datetime) -> datetime:
    target = source.astimezone(UTC)
    return datetime.combine(target.date(), time(23, 59, 59), tzinfo=UTC)


def re_duration(ttl: str) -> tuple[int, str] | None:
    import re

    matched = re.match(r"^(\d+)\s*([mhdw])$", ttl)
    if not matched:
        return None
    return int(matched.group(1)), matched.group(2)


def duration_to_timedelta(amount: int, unit: str) -> timedelta | None:
    if unit == "m":
        return timedelta(minutes=amount)
    if unit == "h":
        return timedelta(hours=amount)
    if unit == "d":
        return timedelta(days=amount)
    if unit == "w":
        return timedelta(weeks=amount)
    return None


def format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def entry(level: str, path: str, title: str, message: str) -> ClaimAuditEntry:
    return ClaimAuditEntry(level=level, path=path, title=title, message=message)


def render_report(
    plans: list[object],
    issues: list[ClaimAuditEntry],
    warnings: list[ClaimAuditEntry],
    expiring: list[ClaimAuditEntry],
    expiring_hours: int,
) -> str:
    lines = [
        "# Claim Audit",
        "",
        "## Summary",
        "",
        f"- Active plans: {len(plans)}",
        f"- Issues: {len(issues)}",
        f"- Warnings: {len(warnings)}",
        f"- Expiring within {expiring_hours}h: {len(expiring)}",
        "",
    ]

    lines.extend(render_entries("Issues", issues, empty_message="No blocking claim issues found."))
    lines.extend(render_entries("Warnings", warnings, empty_message="No warnings."))
    lines.extend(render_entries("Expiring Soon", expiring, empty_message="No claims expiring soon."))
    lines.extend(
        [
            "## Suggested Actions",
            "",
            "- 为并发中的 active plans 补齐 `owner`、`claimed_at`、`claim_ttl`。",
            "- blocked 计划如果仍被占用，尽量补 `handoff_to`，避免长期卡死在单一 owner 手里。",
            "- completed 计划如果仍保留 claim 字段，确认是否应该释放或归档。",
            "",
        ]
    )
    return "\n".join(lines)


def render_entries(title: str, entries: list[ClaimAuditEntry], *, empty_message: str) -> list[str]:
    lines = [f"## {title}", ""]
    if not entries:
        lines.append(f"- {empty_message}")
        lines.append("")
        return lines
    for item in entries:
        lines.append(f"- `{item.path}` | {item.title} | {item.message}")
    lines.append("")
    return lines


if __name__ == "__main__":
    raise SystemExit(main())
