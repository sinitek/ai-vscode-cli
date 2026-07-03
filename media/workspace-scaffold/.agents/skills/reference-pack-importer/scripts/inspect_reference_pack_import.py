#!/usr/bin/env python3
"""Inspect how a generated reference pack would map onto the current repository."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_OUTPUT_DIR = ".ch/docs/generated/reference-pack-imports"
REGISTRY_PATH = ".ch/docs/references/reference-packs.md"
WINDOWS_ABSOLUTE_PATH_RE = re.compile(r"^[A-Za-z]:[\\/]")


@dataclass
class DiffEntry:
    path: str
    status: str
    source_sha256: str
    target_sha256: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect a reference pack before importing it.")
    parser.add_argument("--root", default=".", help="Target repository root.")
    parser.add_argument("--pack-dir", required=True, help="Path to the exported reference pack directory.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated import reports. Relative paths resolve from --root.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    pack_dir = Path(args.pack_dir).resolve()
    if not pack_dir.exists():
        raise SystemExit(f"ERROR: pack directory does not exist: {pack_dir}")

    manifest_path = pack_dir / "manifest.json"
    bundle_dir = pack_dir / "bundle"
    if not manifest_path.exists():
        raise SystemExit(f"ERROR: missing manifest.json in {pack_dir}")
    if not bundle_dir.exists():
        raise SystemExit(f"ERROR: missing bundle/ in {pack_dir}")

    manifest = load_json(manifest_path)
    pack_name = str(manifest.get("pack_name", pack_dir.name))
    output_dir = resolve_output_dir(root, args.output_dir) / pack_name
    if output_dir.exists():
        remove_tree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    items = manifest.get("items", [])
    if not isinstance(items, list):
        raise SystemExit("ERROR: invalid manifest format: items must be a list.")

    diffs = inspect_bundle(root, bundle_dir, items)
    registry_status = inspect_registry(root, pack_name, manifest)
    sanitized_manifest = sanitize_manifest(manifest)

    summary = {
        "generator": "reference-pack-importer",
        "generated_at": iso_now(),
        "pack_name": pack_name,
        "preset": manifest.get("preset", ""),
        "pack_version": manifest.get("pack_version", ""),
        "source_repo": manifest.get("source_repo", ""),
        "source_ref": manifest.get("source_ref", ""),
        "target_repo": root.name,
        "pack_location": describe_pack_location(root, pack_dir),
        "counts": count_statuses(diffs),
        "registry_status": registry_status,
        "diffs": [entry.to_dict() for entry in diffs],
    }

    write_json(output_dir / "import-summary.json", summary)
    write_json(output_dir / "REFERENCE_MANIFEST.json", sanitized_manifest)
    write_text(output_dir / "import-report.md", render_report(manifest, diffs, registry_status, root, pack_dir))
    write_text(output_dir / "COPYLIST.md", render_copylist(diffs))

    print(f"[reference-pack-importer] wrote {output_dir / 'import-report.md'}")
    print(f"[reference-pack-importer] wrote {output_dir / 'import-summary.json'}")
    print(f"[reference-pack-importer] wrote {output_dir / 'COPYLIST.md'}")
    print(f"[reference-pack-importer] wrote {output_dir / 'REFERENCE_MANIFEST.json'}")
    print(f"- missing: {sum(1 for item in diffs if item.status == 'missing')}")
    print(f"- different: {sum(1 for item in diffs if item.status == 'different')}")
    print(f"- identical: {sum(1 for item in diffs if item.status == 'identical')}")
    return 0


def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def sanitize_manifest(manifest: dict[str, object]) -> dict[str, object]:
    sanitized = dict(manifest)
    for key in ("repo_root", "output_dir", "source_root", "pack_dir"):
        sanitized.pop(key, None)

    topic_source_paths = sanitized.get("topic_source_paths")
    if isinstance(topic_source_paths, list):
        sanitized["topic_source_paths"] = sanitize_path_list(topic_source_paths)

    items = sanitized.get("items")
    if isinstance(items, list):
        sanitized_items: list[dict[str, object]] = []
        for raw_item in items:
            if not isinstance(raw_item, dict):
                continue
            item = dict(raw_item)
            path = normalize_relative_path(str(item.get("path", "")))
            if not path:
                continue
            item["path"] = path
            for key in ("source_path", "absolute_path", "repo_root", "source_root"):
                item.pop(key, None)
            sanitized_items.append(item)
        sanitized["items"] = sanitized_items

    missing_paths = sanitized.get("missing_paths")
    if isinstance(missing_paths, list):
        sanitized["missing_paths"] = sanitize_path_list(missing_paths)

    privacy = sanitized.get("privacy")
    if isinstance(privacy, dict):
        private_docs_skipped = privacy.get("private_docs_skipped")
        if isinstance(private_docs_skipped, list):
            sanitized_privacy = dict(privacy)
            sanitized_privacy["private_docs_skipped"] = sanitize_path_list(private_docs_skipped)
            sanitized["privacy"] = sanitized_privacy
    return sanitized


def sanitize_path_list(values: list[object]) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for value in values:
        path = normalize_relative_path(str(value))
        if not path or path in seen:
            continue
        seen.add(path)
        paths.append(path)
    return paths


def normalize_relative_path(value: str) -> str:
    candidate = value.strip().replace("\\", "/")
    if not candidate or candidate.startswith(("http://", "https://", "#")):
        return ""
    while candidate.startswith("./"):
        candidate = candidate[2:]
    if not candidate or candidate == ".":
        return ""
    if candidate.startswith("/") or WINDOWS_ABSOLUTE_PATH_RE.match(candidate):
        return ""
    normalized = Path(candidate).as_posix()
    if normalized.startswith("../") or "/../" in normalized or normalized == "..":
        return ""
    return normalized


def describe_pack_location(root: Path, pack_dir: Path) -> str:
    try:
        return pack_dir.relative_to(root).as_posix()
    except ValueError:
        return pack_dir.name


def inspect_bundle(root: Path, bundle_dir: Path, items: list[object]) -> list[DiffEntry]:
    diffs: list[DiffEntry] = []
    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue
        rel_path = normalize_relative_path(str(raw_item.get("path", "")))
        if not rel_path:
            continue
        source_path = bundle_dir / rel_path
        target_path = root / rel_path
        source_hash = sha256_file(source_path) if source_path.exists() else ""
        if not target_path.exists():
            diffs.append(DiffEntry(path=rel_path, status="missing", source_sha256=source_hash, target_sha256=""))
            continue
        target_hash = sha256_file(target_path)
        status = "identical" if source_hash == target_hash else "different"
        diffs.append(DiffEntry(path=rel_path, status=status, source_sha256=source_hash, target_sha256=target_hash))
    diffs.sort(key=lambda item: (status_weight(item.status), item.path))
    return diffs


def status_weight(status: str) -> int:
    if status == "missing":
        return 0
    if status == "different":
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


def inspect_registry(root: Path, pack_name: str, manifest: dict[str, object]) -> dict[str, object]:
    registry_path = root / REGISTRY_PATH
    if not registry_path.exists():
        return {
            "path": REGISTRY_PATH,
            "exists": False,
            "registered": False,
            "message": "目标仓库缺少 `.ch/docs/references/reference-packs.md`。",
        }

    text = registry_path.read_text(encoding="utf-8")
    pack_version = str(manifest.get("pack_version", "")).strip()
    source_repo = str(manifest.get("source_repo", "")).strip()
    registered = pack_name in text or (source_repo and source_repo in text and pack_version and pack_version in text)
    if registered:
        message = "registry 中已存在与该 pack 或来源版本相近的记录。"
    else:
        message = "registry 中尚未发现该 pack 的导入登记。"
    return {
        "path": REGISTRY_PATH,
        "exists": True,
        "registered": registered,
        "message": message,
    }


def count_statuses(diffs: list[DiffEntry]) -> dict[str, int]:
    return {
        "missing": sum(1 for item in diffs if item.status == "missing"),
        "different": sum(1 for item in diffs if item.status == "different"),
        "identical": sum(1 for item in diffs if item.status == "identical"),
    }


def render_report(
    manifest: dict[str, object],
    diffs: list[DiffEntry],
    registry_status: dict[str, object],
    root: Path,
    pack_dir: Path,
) -> str:
    counts = count_statuses(diffs)
    lines = [
        "# Reference Pack Import Report",
        "",
        "## Summary",
        "",
        f"- Generated at: {iso_now()}",
        f"- Target repo: `{root.name}`",
        f"- Pack location: `{describe_pack_location(root, pack_dir)}`",
        f"- Pack name: `{manifest.get('pack_name', '')}`",
        f"- Preset: `{manifest.get('preset', '')}`",
        f"- Pack version: `{manifest.get('pack_version', '')}`",
        f"- Source repo: `{manifest.get('source_repo', '')}`",
        f"- Source ref: `{manifest.get('source_ref', '')}`",
        f"- Missing files: {counts['missing']}",
        f"- Different files: {counts['different']}",
        f"- Identical files: {counts['identical']}",
        "",
        "## Registry Check",
        "",
        f"- Path: `{registry_status['path']}`",
        f"- Exists: {registry_status['exists']}",
        f"- Registered: {registry_status['registered']}",
        f"- Message: {registry_status['message']}",
        "",
    ]

    lines.extend(render_diff_group("Missing", [item for item in diffs if item.status == "missing"]))
    lines.extend(render_diff_group("Different", [item for item in diffs if item.status == "different"]))
    lines.extend(render_diff_group("Identical", [item for item in diffs if item.status == "identical"]))
    lines.extend(
        [
            "## Suggested Actions",
            "",
            "1. 先审查 `Different` 组，决定是覆盖、合并还是只局部吸收。",
            "2. 再处理 `Missing` 组，这些文件可以按 pack 的 `bundle/` 路径直接落到目标仓库。",
            "3. 导入完成后，将 `REFERENCE_MANIFEST.json` 复制到 `.ch/docs/references/reference-pack-manifests/<pack-name>.json`，作为 drift 审计基线。",
            "4. 最后更新 `.ch/docs/references/reference-packs.md`，记录来源和版本。",
            "",
        ]
    )
    return "\n".join(lines)


def render_diff_group(title: str, entries: list[DiffEntry]) -> list[str]:
    lines = [f"## {title}", ""]
    if not entries:
        lines.append("- None")
        lines.append("")
        return lines
    for item in entries:
        if item.status == "different":
            lines.append(
                f"- `{item.path}` | source={item.source_sha256[:12]} | target={item.target_sha256[:12]}"
            )
        else:
            lines.append(f"- `{item.path}`")
    lines.append("")
    return lines


def render_copylist(diffs: list[DiffEntry]) -> str:
    lines = [
        "# Copy List",
        "",
        "下面这些路径是当前目标仓库中缺失或与 pack 不一致的文件：",
        "",
    ]
    candidates = [item for item in diffs if item.status in {"missing", "different"}]
    if not candidates:
        lines.append("- 当前目标仓库与 pack 已完全对齐。")
        lines.append("")
        return "\n".join(lines)
    for item in candidates:
        lines.append(f"- `{item.path}` | {item.status}")
    lines.append("")
    return "\n".join(lines)


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def remove_tree(path: Path) -> None:
    for child in sorted(path.rglob("*"), reverse=True):
        if child.is_file():
            child.unlink()
        elif child.is_dir():
            child.rmdir()
    path.rmdir()


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    raise SystemExit(main())
