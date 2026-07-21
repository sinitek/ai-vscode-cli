#!/usr/bin/env python3
"""Audit freshness and completeness of memory docs."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

DEFAULT_OUTPUT_DIR = ".ch/docs/generated/memory-index"
RECALL_SUMMARY_FILENAME = "recall-summary.json"
PLACEHOLDER_VALUES = {"", "-", "todo", "tbd", "待定", "unknown"}
NON_PRIORITY_CLAIM_STATUSES = {"needs_verification", "superseded", "archived"}


@dataclass
class AuditResult:
    issues: list[str]
    warnings: list[str]
    claim_source: str | None
    claim_count: int
    claim_audit_skipped: bool
    claim_skip_reason: str | None
    priority_source: str | None
    priority_selected_count: int
    priority_audit_skipped: bool
    priority_skip_reason: str | None


@dataclass
class RecallSelection:
    selected_claim_ids: set[str]
    selected_claims: list[dict[str, object]]
    source: str | None
    skipped: bool
    skip_reason: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit harness memory freshness.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="memory-index output directory.")
    parser.add_argument("--stale-days", type=int, default=30, help="Freshness threshold passed to memory-indexer.")
    parser.add_argument("--strict", action="store_true", help="Return non-zero when issues are found.")
    parser.add_argument("--write-report", action="store_true", help="Write the markdown report to --report-path.")
    parser.add_argument(
        "--report-path",
        default=".ch/docs/generated/memory-index/freshness-audit.md",
        help="Where to write the report when --write-report is set.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_output_dir(root, args.output_dir)

    run_memory_indexer(root, output_dir, args.stale_days)
    summary = load_json(output_dir / "summary.json")
    claims, claim_source = load_claims(output_dir, summary)
    recall_selection = load_recall_selection(output_dir)
    audit = audit_summary(summary, claims, claim_source, recall_selection)
    report = render_report(summary, audit)

    print(report)
    if args.write_report:
        report_path = resolve_output_dir(root, args.report_path)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report, encoding="utf-8")
        print(f"[memory-freshness-auditor] wrote report to {display_path(root, report_path)}", file=sys.stderr)

    if args.strict and audit.issues:
        return 1
    return 0


def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def display_path(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.name or "."


def run_memory_indexer(root: Path, output_dir: Path, stale_days: int) -> None:
    script_path = (
        Path(__file__).resolve().parents[2]
        / "memory-indexer"
        / "scripts"
        / "generate_memory_index.py"
    )
    command = [
        sys.executable,
        str(script_path),
        "--root",
        str(root),
        "--output-dir",
        str(output_dir),
        "--stale-days",
        str(stale_days),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_claims(output_dir: Path, summary: dict[str, object]) -> tuple[list[dict[str, object]], str | None]:
    claims_path = output_dir / "claims.jsonl"
    if claims_path.exists():
        claims = load_jsonl_records(claims_path)
        if claims:
            return claims, "claims.jsonl"

    claims = extract_claims_from_summary(summary)
    if claims:
        return claims, "summary.json"

    return [], None


def load_jsonl_records(path: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            records.append(payload)
    return records


def extract_claims_from_summary(summary: dict[str, object]) -> list[dict[str, object]]:
    raw_claims = summary.get("claims", [])
    if not isinstance(raw_claims, list):
        return []
    return [item for item in raw_claims if is_claim_record(item)]


def is_claim_record(candidate: object) -> bool:
    if not isinstance(candidate, dict):
        return False
    return any(key in candidate for key in ("claim_id", "text", "claim_type", "status", "source_observation_id"))


def load_recall_selection(output_dir: Path) -> RecallSelection:
    recall_path = output_dir / RECALL_SUMMARY_FILENAME
    if not recall_path.exists():
        return RecallSelection(
            selected_claim_ids=set(),
            selected_claims=[],
            source=None,
            skipped=True,
            skip_reason=(
                f"No recall artifact was found at `{RECALL_SUMMARY_FILENAME}`; "
                "skipped high-priority claim selection audit."
            ),
        )

    try:
        recall_summary = load_json(recall_path)
    except json.JSONDecodeError:
        return RecallSelection(
            selected_claim_ids=set(),
            selected_claims=[],
            source=RECALL_SUMMARY_FILENAME,
            skipped=True,
            skip_reason=(
                f"`{RECALL_SUMMARY_FILENAME}` could not be parsed; "
                "skipped high-priority claim selection audit."
            ),
        )

    selected_claim_ids = collect_recall_selected_claim_ids(recall_summary)
    selected_claims = collect_recall_selected_claims(recall_summary)
    if not selected_claim_ids and selected_claims:
        for claim in selected_claims:
            claim_id = normalize_value(claim.get("claim_id")) or normalize_value(claim.get("id"))
            if claim_id:
                selected_claim_ids.add(claim_id)

    if not selected_claim_ids and not selected_claims:
        return RecallSelection(
            selected_claim_ids=set(),
            selected_claims=[],
            source=RECALL_SUMMARY_FILENAME,
            skipped=True,
            skip_reason=(
                f"`{RECALL_SUMMARY_FILENAME}` does not contain `selected_claim_ids` or `selected_claims`; "
                "skipped high-priority claim selection audit."
            ),
        )

    return RecallSelection(
        selected_claim_ids=selected_claim_ids,
        selected_claims=selected_claims,
        source=RECALL_SUMMARY_FILENAME,
        skipped=False,
        skip_reason=None,
    )


def collect_recall_selected_claim_ids(recall_summary: dict[str, object]) -> set[str]:
    selected_ids: set[str] = set()
    raw_ids = recall_summary.get("selected_claim_ids", [])
    if not isinstance(raw_ids, list):
        return selected_ids
    for item in raw_ids:
        claim_id = normalize_value(item)
        if claim_id:
            selected_ids.add(claim_id)
    return selected_ids


def collect_recall_selected_claims(recall_summary: dict[str, object]) -> list[dict[str, object]]:
    raw_claims = recall_summary.get("selected_claims", [])
    if not isinstance(raw_claims, list):
        return []
    return [item for item in raw_claims if is_claim_record(item)]


def audit_summary(
    summary: dict[str, object],
    claims: list[dict[str, object]],
    claim_source: str | None,
    recall_selection: RecallSelection,
) -> AuditResult:
    issues: list[str] = []
    warnings: list[str] = []

    memory_docs = summary.get("memory_docs", [])
    if isinstance(memory_docs, list):
        for raw_doc in memory_docs:
            if not isinstance(raw_doc, dict):
                continue
            path = str(raw_doc.get("path", "unknown"))
            freshness = str(raw_doc.get("freshness", "unknown"))
            status = normalize_value(raw_doc.get("status"))
            source_of_truth = normalize_value(raw_doc.get("source_of_truth"))
            last_verified = normalize_value(raw_doc.get("last_verified_at"))
            starter = bool(raw_doc.get("starter"))

            if freshness == "stale":
                issues.append(f"`{path}` is stale and needs verification.")
            if not status:
                issues.append(f"`{path}` is missing `status`.")
            if not source_of_truth:
                issues.append(f"`{path}` is missing `source_of_truth`.")
            if not last_verified and not starter:
                warnings.append(f"`{path}` is missing `last_verified_at`.")
            if starter:
                warnings.append(f"`{path}` is still a starter placeholder.")

    open_loops = summary.get("open_loops", {})
    if isinstance(open_loops, dict):
        pending_items = open_loops.get("pending_items", [])
        if isinstance(pending_items, list):
            for index, item in enumerate(pending_items, start=1):
                if not isinstance(item, dict):
                    continue
                owner = normalize_value(item.get("Owner"))
                source = normalize_value(item.get("来源"))
                next_step = normalize_value(item.get("下一步"))
                title = str(item.get("事项", f"pending-item-{index}"))
                if not owner:
                    issues.append(f"Pending item `{title}` is missing `Owner`.")
                if not source:
                    issues.append(f"Pending item `{title}` is missing `来源`.")
                if not next_step:
                    issues.append(f"Pending item `{title}` is missing `下一步`.")

        active_risks = open_loops.get("active_risks", [])
        if isinstance(active_risks, list):
            for index, risk in enumerate(active_risks, start=1):
                if not isinstance(risk, dict):
                    continue
                source = normalize_value(risk.get("来源"))
                title = str(risk.get("风险", f"active-risk-{index}"))
                if not source:
                    issues.append(f"Active risk `{title}` is missing `来源`.")

    active_plans = summary.get("active_plans", [])
    if isinstance(active_plans, list) and len(active_plans) > 5:
        warnings.append(f"There are {len(active_plans)} active plans; consider checking if some should be closed or merged.")

    claims_by_id: dict[str, dict[str, object]] = {}
    for claim in claims:
        claim_ref = format_claim_ref(claim)
        claim_status = normalize_value(claim.get("status"))
        source_path = normalize_value(claim.get("source_path"))
        source_span = normalize_value(claim.get("source_span"))
        source_anchor = normalize_value(claim.get("source_anchor"))
        review_after = normalize_value(claim.get("review_after"))
        claim_id = normalize_value(claim.get("claim_id")) or normalize_value(claim.get("id"))

        if not claim_status:
            issues.append(f"Claim `{claim_ref}` is missing `status`.")
        if not source_path:
            issues.append(f"Claim `{claim_ref}` is missing `source_path`.")
        if not source_span and not source_anchor:
            issues.append(f"Claim `{claim_ref}` is missing both `source_span` and `source_anchor`.")
        if not review_after:
            warnings.append(f"Claim `{claim_ref}` is missing `review_after`.")
        if claim_id:
            claims_by_id.setdefault(claim_id, claim)

    flagged_selected_ids: set[str] = set()
    if not recall_selection.skipped:
        for selected_claim in recall_selection.selected_claims:
            selected_status = normalize_value(selected_claim.get("status"))
            if selected_status not in NON_PRIORITY_CLAIM_STATUSES:
                continue
            claim_ref = format_claim_ref(selected_claim)
            issues.append(
                f"Claim `{claim_ref}` has status `{selected_status}` but is still selected as a high-priority input."
            )
            selected_id = normalize_value(selected_claim.get("claim_id")) or normalize_value(selected_claim.get("id"))
            if selected_id:
                flagged_selected_ids.add(selected_id)

        for claim_id in sorted(recall_selection.selected_claim_ids):
            if claim_id in flagged_selected_ids:
                continue
            claim = claims_by_id.get(claim_id)
            if not claim:
                continue
            claim_status = normalize_value(claim.get("status"))
            if claim_status in NON_PRIORITY_CLAIM_STATUSES:
                issues.append(
                    f"Claim `{format_claim_ref(claim)}` has status `{claim_status}` but is still selected as a high-priority input."
                )

    claim_count = len(claims)
    claim_audit_skipped = claim_count == 0
    claim_skip_reason = None
    if claim_audit_skipped:
        claim_skip_reason = "No claim artifacts were found in `claims.jsonl` or `summary.json`."

    priority_selected_count = 0
    if recall_selection.selected_claims:
        priority_selected_count = len(recall_selection.selected_claims)
    elif recall_selection.selected_claim_ids:
        priority_selected_count = len(recall_selection.selected_claim_ids)

    return AuditResult(
        issues=issues,
        warnings=warnings,
        claim_source=claim_source,
        claim_count=claim_count,
        claim_audit_skipped=claim_audit_skipped,
        claim_skip_reason=claim_skip_reason,
        priority_source=recall_selection.source,
        priority_selected_count=priority_selected_count,
        priority_audit_skipped=recall_selection.skipped,
        priority_skip_reason=recall_selection.skip_reason,
    )


def format_claim_ref(claim: dict[str, object]) -> str:
    for key in ("claim_id", "id"):
        normalized = normalize_value(claim.get(key))
        if normalized:
            return normalized

    text = normalize_value(claim.get("text"))
    if text:
        compact = " ".join(text.split())
        if len(compact) > 80:
            return f"{compact[:77]}..."
        return compact

    return "unknown-claim"


def normalize_value(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if normalized.lower() in PLACEHOLDER_VALUES:
        return None
    if normalized == "template-fill-when-adopted":
        return None
    return normalized


def render_report(summary: dict[str, object], audit: AuditResult) -> str:
    memory_docs = summary.get("memory_docs", [])
    open_loops = summary.get("open_loops", {})
    pending_count = len(open_loops.get("pending_items", [])) if isinstance(open_loops, dict) else 0
    risk_count = len(open_loops.get("active_risks", [])) if isinstance(open_loops, dict) else 0
    active_plan_count = len(summary.get("active_plans", [])) if isinstance(summary.get("active_plans", []), list) else 0

    lines = [
        "# Memory Freshness Audit",
        "",
        "## Summary",
        "",
        f"- Memory docs: {len(memory_docs) if isinstance(memory_docs, list) else 0}",
        f"- Active plans: {active_plan_count}",
        f"- Pending items: {pending_count}",
        f"- Active risks: {risk_count}",
        f"- Claim completeness checked: {audit.claim_count}"
        if not audit.claim_audit_skipped
        else "- Claim completeness checked: skipped",
        f"- Recall-selected claims reviewed: {audit.priority_selected_count}"
        if not audit.priority_audit_skipped
        else "- Recall-selected claims reviewed: skipped",
        f"- Issues: {len(audit.issues)}",
        f"- Warnings: {len(audit.warnings)}",
        "",
    ]

    lines.extend(["## Claim-Level Audit", ""])
    if audit.claim_audit_skipped:
        lines.append(f"- Claim completeness: skipped ({audit.claim_skip_reason})")
    else:
        lines.append(f"- Claim completeness source: `{audit.claim_source or 'unknown'}`")
        lines.append(f"- Claim completeness checked: {audit.claim_count}")
        lines.append("- Required fields: `status`, `source_path`, and either `source_span` or `source_anchor`.")
        lines.append("- Warning field: `review_after`.")
    if audit.priority_audit_skipped:
        lines.append(f"- High-priority selection audit: skipped ({audit.priority_skip_reason})")
    else:
        lines.append(f"- High-priority selection source: `{audit.priority_source or 'unknown'}`")
        lines.append(f"- Recall-selected claims reviewed: {audit.priority_selected_count}")
        lines.append("- Invalid selected statuses: `needs_verification`, `superseded`, `archived`.")
    lines.append("")

    if audit.issues:
        lines.extend(["## Issues", ""])
        lines.extend(f"- {issue}" for issue in audit.issues)
        lines.append("")
    else:
        lines.extend(["## Issues", "", "- No blocking issues found.", ""])

    if audit.warnings:
        lines.extend(["## Warnings", ""])
        lines.extend(f"- {warning}" for warning in audit.warnings)
        lines.append("")
    else:
        lines.extend(["## Warnings", "", "- No warnings.", ""])

    lines.extend(
        [
            "## Suggested Actions",
            "",
            "- Verify stale or placeholder memory docs and update `last_verified_at`.",
            "- Fill missing `source_of_truth`, `Owner`, `来源`, or `下一步` fields.",
            "- For claim-aware indexes, add `status`, `source_path`, evidence anchors, and `review_after` before treating claims as durable inputs.",
            f"- Run `memory-recall` to regenerate `{RECALL_SUMMARY_FILENAME}` before auditing selected high-priority claims."
            if audit.priority_audit_skipped
            else "- Remove or re-verify stale selected claims before keeping them in default recall inputs.",
            "- If a starter placeholder is no longer appropriate, replace it with real project memory.",
            "",
        ]
    )
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
