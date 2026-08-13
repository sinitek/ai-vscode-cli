#!/usr/bin/env python3
"""Audit drift against imported reference pack baseline manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_OUTPUT_DIR = ".ch/docs/generated/reference-pack-drifts"
DEFAULT_MANIFEST_DIR = ".ch/docs/references/reference-pack-manifests"
REGISTRY_PATH = ".ch/docs/references/reference-packs.md"


@dataclass
class DriftEntry:
    pack_name: str
    path: str
    status: str
    baseline_sha256: str
    current_sha256: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit drift against imported reference pack baseline manifests.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated drift reports. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--manifest-dir",
        default=DEFAULT_MANIFEST_DIR,
        help="Directory containing stored reference pack baseline manifests.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_output_dir(root, args.output_dir)
    manifest_dir = resolve_output_dir(root, args.manifest_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    manifests = collect_manifests(manifest_dir)
    registry_status = load_registry(root)
    drift_entries: list[DriftEntry] = []
    manifest_summaries: list[dict[str, object]] = []

    for manifest_path in manifests:
        manifest = load_json(manifest_path)
        pack_name = str(manifest.get("pack_name", manifest_path.stem))
        entries = audit_manifest(root, manifest, pack_name)
        drift_entries.extend(entries)
        manifest_summaries.append(
            {
                "pack_name": pack_name,
                "manifest_path": manifest_path.relative_to(root).as_posix() if manifest_path.is_relative_to(root) else str(manifest_path),
                "source_repo": manifest.get("source_repo", ""),
                "source_ref": manifest.get("source_ref", ""),
                "pack_version": manifest.get("pack_version", ""),
                "registry_registered": registry_contains(registry_status["text"], pack_name, manifest),
                "counts": count_entries(entries),
            }
        )

    summary = {
        "generator": "reference-pack-drift-auditor",
        "generated_at": iso_now(),
        "repo_root": ".",
        "manifest_dir": relative_path(root, manifest_dir),
        "manifest_count": len(manifests),
        "registry_path": REGISTRY_PATH,
        "pack_summaries": manifest_summaries,
        "total_counts": count_entries(drift_entries),
        "entries": [entry.to_dict() for entry in drift_entries],
    }

    write_json(output_dir / "drift-summary.json", summary)
    write_text(output_dir / "drift-report.md", render_report(root, manifest_summaries, drift_entries, manifests, manifest_dir, registry_status))

    print(f"[reference-pack-drift-auditor] wrote {output_dir / 'drift-report.md'}")
    print(f"[reference-pack-drift-auditor] wrote {output_dir / 'drift-summary.json'}")
    print(f"- manifest_count: {len(manifests)}")
    print(f"- drifted: {sum(1 for item in drift_entries if item.status == 'drifted')}")
    print(f"- missing: {sum(1 for item in drift_entries if item.status == 'missing')}")
    print(f"- aligned: {sum(1 for item in drift_entries if item.status == 'aligned')}")
    return 0


def resolve_output_dir(root: Path, path_arg: str) -> Path:
    path = Path(path_arg)
    if path.is_absolute():
        return path
    return root / path


def relative_path(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def collect_manifests(manifest_dir: Path) -> list[Path]:
    if not manifest_dir.exists():
        return []
    return sorted(
        path for path in manifest_dir.glob("*.json") if path.is_file()
    )


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_registry(root: Path) -> dict[str, object]:
    path = root / REGISTRY_PATH
    if not path.exists():
        return {"exists": False, "text": "", "path": REGISTRY_PATH}
    return {"exists": True, "text": path.read_text(encoding="utf-8"), "path": REGISTRY_PATH}


def audit_manifest(root: Path, manifest: dict[str, object], pack_name: str) -> list[DriftEntry]:
    items = manifest.get("items", [])
    if not isinstance(items, list):
        return []
    entries: list[DriftEntry] = []
    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue
        rel_path = str(raw_item.get("path", "")).strip()
        baseline_sha256 = str(raw_item.get("sha256", "")).strip()
        if not rel_path:
            continue
        current_path = root / rel_path
        if not current_path.exists():
            entries.append(
                DriftEntry(
                    pack_name=pack_name,
                    path=rel_path,
                    status="missing",
                    baseline_sha256=baseline_sha256,
                    current_sha256="",
                )
            )
            continue
        current_sha256 = sha256_file(current_path)
        status = "aligned" if baseline_sha256 and baseline_sha256 == current_sha256 else "drifted"
        entries.append(
            DriftEntry(
                pack_name=pack_name,
                path=rel_path,
                status=status,
                baseline_sha256=baseline_sha256,
                current_sha256=current_sha256,
            )
        )
    return sorted(entries, key=lambda item: (status_weight(item.status), item.pack_name, item.path))


def status_weight(status: str) -> int:
    if status == "missing":
        return 0
    if status == "drifted":
        return 1
    return 2


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(65536)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def registry_contains(text: str, pack_name: str, manifest: dict[str, object]) -> bool:
    source_repo = str(manifest.get("source_repo", "")).strip()
    pack_version = str(manifest.get("pack_version", "")).strip()
    return pack_name in text or (source_repo and source_repo in text and pack_version and pack_version in text)


def count_entries(entries: list[DriftEntry]) -> dict[str, int]:
    return {
        "missing": sum(1 for item in entries if item.status == "missing"),
        "drifted": sum(1 for item in entries if item.status == "drifted"),
        "aligned": sum(1 for item in entries if item.status == "aligned"),
    }


def render_report(
    root: Path,
    manifest_summaries: list[dict[str, object]],
    drift_entries: list[DriftEntry],
    manifests: list[Path],
    manifest_dir: Path,
    registry_status: dict[str, object],
) -> str:
    totals = count_entries(drift_entries)
    lines = [
        "# Reference Pack Drift Report",
        "",
        "## Summary",
        "",
        f"- Generated at: {iso_now()}",
        f"- Baseline manifest dir: `{relative_path(root, manifest_dir)}`",
        f"- Baseline manifests: {len(manifests)}",
        f"- Registry exists: {registry_status['exists']}",
        f"- Missing files: {totals['missing']}",
        f"- Drifted files: {totals['drifted']}",
        f"- Aligned files: {totals['aligned']}",
        "",
    ]

    if not manifests:
        lines.extend(
            [
                "## No Baseline Manifests",
                "",
                "- 当前没有可用于 drift 审计的 baseline manifest。",
                "- 导入 pack 后，请将 `reference-pack-importer` 产出的 `REFERENCE_MANIFEST.json` 复制到 `.ch/docs/references/reference-pack-manifests/<pack-name>.json`。",
                "",
            ]
        )
        return "\n".join(lines)

    lines.extend(["## Pack Summaries", ""])
    for summary in manifest_summaries:
        counts = summary["counts"]
        lines.append(
            "- "
            + " | ".join(
                [
                    f"`{summary['pack_name']}`",
                    f"missing={counts['missing']}",
                    f"drifted={counts['drifted']}",
                    f"aligned={counts['aligned']}",
                    f"registered={summary['registry_registered']}",
                ]
            )
        )
    lines.append("")
    lines.extend(render_group("Missing", [item for item in drift_entries if item.status == "missing"]))
    lines.extend(render_group("Drifted", [item for item in drift_entries if item.status == "drifted"]))
    lines.extend(render_group("Aligned", [item for item in drift_entries if item.status == "aligned"]))
    lines.extend(
        [
            "## Suggested Actions",
            "",
            "1. 先处理 `Missing` 组，确认这些文件是误删、迁移，还是 pack 已被本地替代。",
            "2. 再审查 `Drifted` 组，判断这些偏离是否应记录为本地改动，或需要更新 baseline manifest。",
            "3. 如果某个 pack 已大幅偏离且不再准备跟上游对齐，更新 `.ch/docs/references/reference-packs.md` 说明本地演化状态。",
            "",
        ]
    )
    return "\n".join(lines)


def render_group(title: str, entries: list[DriftEntry]) -> list[str]:
    lines = [f"## {title}", ""]
    if not entries:
        lines.append("- None")
        lines.append("")
        return lines
    for item in entries:
        if item.status == "aligned":
            lines.append(f"- `{item.pack_name}` | `{item.path}`")
        else:
            lines.append(
                "- "
                + " | ".join(
                    [
                        f"`{item.pack_name}`",
                        f"`{item.path}`",
                        f"baseline={item.baseline_sha256[:12] if item.baseline_sha256 else 'n/a'}",
                        f"current={item.current_sha256[:12] if item.current_sha256 else 'missing'}",
                    ]
                )
            )
    lines.append("")
    return lines


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    raise SystemExit(main())
