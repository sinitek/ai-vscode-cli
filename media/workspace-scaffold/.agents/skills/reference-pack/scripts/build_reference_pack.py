#!/usr/bin/env python3
"""Build exportable reference packs for cross-project reuse."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

GENERATOR_NAME = "reference-pack"
GENERATOR_VERSION = "0.2.0"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/reference-packs"
DEFAULT_PRESET = "memory-ops"
GENERATED_MEMORY_SUMMARY = ".ch/docs/generated/memory-index/summary.json"
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
TEXT_SUFFIXES = {
    "",
    ".md",
    ".txt",
    ".json",
    ".jsonl",
    ".py",
    ".sh",
    ".yml",
    ".yaml",
    ".toml",
    ".xml",
}
WINDOWS_ABSOLUTE_PATH_RE = re.compile(r"^[A-Za-z]:[\\/]")


def dedupe_items(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result

PACK_PRESETS: dict[str, list[str]] = {
    "memory-core": [
        ".agents/skills/AGENTS.md",
        ".agents/skills/execution-plan",
        ".agents/skills/session-handoff",
        ".agents/skills/memory-indexer",
        ".agents/skills/memory-recall",
        ".agents/skills/memory-consolidator",
        ".agents/skills/memory-freshness-auditor",
        ".ch/docs/MEMORY.md",
        ".ch/docs/PLANS.md",
        ".ch/docs/memory",
        ".ch/docs/handoffs",
        ".ch/docs/exec-plans/TEMPLATE.md",
        ".ch/docs/generated/README.md",
        ".ch/docs/generated/memory-index/README.md",
        ".ch/docs/generated/reference-packs/README.md",
        ".ch/docs/references/reference-packs.md",
        ".ch/docs/runbooks/PITFALLS.md",
        ".ch/docs/runbooks/PITFALLS_HISTORY.md",
        ".ch/docs/runbooks/pitfalls",
    ],
    "frontier-collab": [
        ".agents/skills/AGENTS.md",
        ".agents/skills/execution-plan",
        ".agents/skills/work-frontier",
        ".agents/skills/claim-release-auditor",
        ".ch/docs/PLANS.md",
        ".ch/docs/exec-plans/TEMPLATE.md",
        ".ch/docs/generated/README.md",
        ".ch/docs/generated/reference-packs/README.md",
        ".ch/docs/references/reference-packs.md",
    ],
}
PACK_PRESETS["memory-ops"] = dedupe_items(PACK_PRESETS["memory-core"] + PACK_PRESETS["frontier-collab"])


@dataclass
class PackItem:
    path: str
    kind: str
    sha256: str
    privacy_stripped_count: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a reusable reference pack from stable harness files.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated packs. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--preset",
        default=DEFAULT_PRESET,
        choices=sorted(PACK_PRESETS.keys()),
        help="Which reference pack preset to export.",
    )
    parser.add_argument("--pack-name", default="", help="Optional custom pack name.")
    parser.add_argument("--version", default="", help="Optional pack version label.")
    parser.add_argument("--source-repo", default="", help="Optional source repo label for manifest metadata.")
    parser.add_argument("--source-ref", default="", help="Optional source ref / tag / commit label.")
    parser.add_argument(
        "--topic",
        default="",
        help=(
            "Optional topic/type/concept from generated memory index. "
            "Matching observation source paths are added to the selected preset."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_output_dir(root, args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    generated_at = iso_now()
    topic = args.topic.strip().lower()
    pack_name = normalize_slug(args.pack_name) or default_pack_name(args.preset, topic)
    version = args.version.strip() or datetime.now(UTC).strftime("%Y-%m-%d")
    source_repo = args.source_repo.strip() or root.name
    source_ref = args.source_ref.strip() or "local-working-tree"
    pack_dir = output_dir / pack_name
    bundle_dir = pack_dir / "bundle"

    if pack_dir.exists():
        shutil.rmtree(pack_dir)
    bundle_dir.mkdir(parents=True, exist_ok=True)

    topic_source_paths = collect_topic_source_paths(root, topic) if topic else []
    source_paths = dedupe_items(PACK_PRESETS[args.preset] + topic_source_paths)
    included_items, missing_paths, private_docs_skipped = collect_pack_items(root, source_paths)
    private_blocks_stripped = copy_items(root, bundle_dir, included_items)

    manifest = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": generated_at,
        "pack_name": pack_name,
        "preset": args.preset,
        "pack_version": version,
        "source_repo": source_repo,
        "source_ref": source_ref,
        "topic": topic,
        "topic_source_paths": topic_source_paths,
        "file_count": len(included_items),
        "items": [item.__dict__ for item in included_items],
        "missing_paths": missing_paths,
        "privacy": {
            "private_docs_skipped": private_docs_skipped,
            "private_doc_skip_count": len(private_docs_skipped),
            "private_blocks_stripped": private_blocks_stripped,
            "supported_tags": list(PRIVATE_TAG_NAMES),
        },
    }

    write_json(pack_dir / "manifest.json", manifest)
    write_text(pack_dir / "FILES.md", render_files_md(pack_name, args.preset, topic, included_items, missing_paths, private_docs_skipped))
    write_text(
        pack_dir / "INSTALL.md",
        render_install_md(
            pack_name=pack_name,
            preset=args.preset,
            version=version,
            source_repo=source_repo,
            source_ref=source_ref,
            topic=topic,
            included_items=included_items,
        ),
    )
    write_text(
        pack_dir / "REFERENCE_ENTRY.md",
        render_reference_entry_md(
            pack_name=pack_name,
            version=version,
            source_repo=source_repo,
            source_ref=source_ref,
            preset=args.preset,
            topic=topic,
        ),
    )

    print(f"[{GENERATOR_NAME}] built {pack_dir}")
    print(f"- preset: {args.preset}")
    print(f"- topic: {topic or '(none)'}")
    print(f"- file_count: {len(included_items)}")
    print(f"- missing_paths: {len(missing_paths)}")
    print(f"- private_docs_skipped: {len(private_docs_skipped)}")
    print(f"- private_blocks_stripped: {private_blocks_stripped}")
    return 0


def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def normalize_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", value.strip().lower())
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug


def default_pack_name(preset: str, topic: str = "") -> str:
    topic_part = normalize_slug(topic)
    suffix = f"-{topic_part}" if topic_part else ""
    return f"{preset}{suffix}-{datetime.now(UTC).strftime('%Y%m%d')}"


def collect_pack_items(root: Path, source_paths: list[str]) -> tuple[list[PackItem], list[str], list[str]]:
    included: list[PackItem] = []
    missing: list[str] = []
    private_docs_skipped: list[str] = []
    seen: set[str] = set()

    for raw_rel_path in source_paths:
        rel_path = normalize_relative_path(raw_rel_path)
        if not rel_path:
            continue
        source = root / rel_path
        if not source.exists():
            missing.append(rel_path)
            continue
        if source.is_file():
            if should_skip_file(source):
                continue
            if is_private_document_file(source):
                private_docs_skipped.append(rel_path)
                continue
            add_item(included, seen, rel_path, "file")
            continue
        for child in sorted(source.rglob("*")):
            if not child.is_file():
                continue
            if should_skip_file(child):
                continue
            child_rel = child.relative_to(root).as_posix()
            if is_private_document_file(child):
                private_docs_skipped.append(child_rel)
                continue
            add_item(included, seen, child_rel, "file")
    return included, missing, dedupe_items(private_docs_skipped)


def should_skip_file(path: Path) -> bool:
    if path.suffix == ".pyc":
        return True
    return "__pycache__" in path.parts


def add_item(items: list[PackItem], seen: set[str], rel_path: str, kind: str) -> None:
    if rel_path in seen:
        return
    seen.add(rel_path)
    items.append(PackItem(path=rel_path, kind=kind, sha256=""))


def copy_items(root: Path, bundle_dir: Path, items: list[PackItem]) -> int:
    private_blocks_stripped = 0
    for item in items:
        source = root / item.path
        target = bundle_dir / item.path
        target.parent.mkdir(parents=True, exist_ok=True)
        strip_count = copy_sanitized(source, target)
        item.privacy_stripped_count = strip_count
        private_blocks_stripped += strip_count
        item.sha256 = sha256_file(target)
    return private_blocks_stripped


def copy_sanitized(source: Path, target: Path) -> int:
    if source.suffix.lower() not in TEXT_SUFFIXES:
        shutil.copy2(source, target)
        return 0
    try:
        text = source.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        shutil.copy2(source, target)
        return 0
    sanitized, strip_count = strip_private_blocks(text)
    if strip_count:
        target.write_text(sanitized, encoding="utf-8")
    else:
        shutil.copy2(source, target)
    return strip_count


def is_private_document_file(path: Path) -> bool:
    if path.suffix.lower() not in TEXT_SUFFIXES:
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    metadata, _body = split_front_matter(text)
    return is_private_document(metadata)


def split_front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    parts = text.split("\n---\n", 1)
    if len(parts) != 2:
        return {}, text
    raw_meta = parts[0].splitlines()[1:]
    metadata: dict[str, str] = {}
    for line in raw_meta:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata, parts[1]


def is_private_document(metadata: dict[str, str]) -> bool:
    visibility = metadata.get("memory_visibility", "").strip().lower()
    private = metadata.get("private", "").strip().lower()
    return visibility in {"private", "no-memory"} or private in {"true", "yes", "1"}


def strip_private_blocks(text: str) -> tuple[str, int]:
    count = 0

    def replace(_match: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return ""

    parts = re.split(r"(```[\s\S]*?```)", text)
    stripped_parts: list[str] = []
    for part in parts:
        if part.startswith("```"):
            stripped_parts.append(part)
            continue
        inline_parts = re.split(r"(`[^`\n]*`)", part)
        for inline_part in inline_parts:
            if inline_part.startswith("`") and inline_part.endswith("`"):
                stripped_parts.append(inline_part)
            else:
                stripped_parts.append(PRIVATE_TAG_RE.sub(replace, inline_part))
    return "".join(stripped_parts), count


def collect_topic_source_paths(root: Path, topic: str) -> list[str]:
    summary_path = root / GENERATED_MEMORY_SUMMARY
    if not summary_path.exists():
        return []
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    observations = summary.get("observations", [])
    if not isinstance(observations, list):
        return []

    paths: list[str] = []
    for raw in observations:
        if not isinstance(raw, dict) or not observation_matches_topic(raw, topic):
            continue
        for candidate in [raw.get("source_path", ""), *list(raw.get("files", []) if isinstance(raw.get("files", []), list) else [])]:
            rel_path = normalize_relative_path(str(candidate))
            if rel_path and not rel_path.startswith(".ch/docs/generated/") and (root / rel_path).exists():
                paths.append(rel_path)
    return dedupe_items(paths)


def observation_matches_topic(raw: dict[str, object], topic: str) -> bool:
    candidates = [
        raw.get("topic", ""),
        raw.get("type", ""),
        raw.get("title", ""),
        *list(raw.get("concepts", []) if isinstance(raw.get("concepts", []), list) else []),
    ]
    lowered_topic = topic.lower()
    for candidate in candidates:
        text = str(candidate).lower()
        if text == lowered_topic or lowered_topic in text:
            return True
    return False


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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(65536)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def render_files_md(
    pack_name: str,
    preset: str,
    topic: str,
    items: list[PackItem],
    missing_paths: list[str],
    private_docs_skipped: list[str],
) -> str:
    lines = [
        f"# Reference Pack Files - {pack_name}",
        "",
        f"- Preset: `{preset}`",
        f"- Topic: `{topic or '-'}`",
        f"- File count: {len(items)}",
        f"- Private docs skipped: {len(private_docs_skipped)}",
        "",
        "## Included Files",
        "",
    ]
    lines.extend(f"- `{item.path}`" for item in items)
    lines.append("")
    lines.append("## Missing Source Paths")
    lines.append("")
    if missing_paths:
        lines.extend(f"- `{path}`" for path in missing_paths)
    else:
        lines.append("- None")
    lines.append("")
    lines.append("## Private Docs Skipped")
    lines.append("")
    if private_docs_skipped:
        lines.extend(f"- `{path}`" for path in private_docs_skipped)
    else:
        lines.append("- None")
    lines.append("")
    return "\n".join(lines)


def render_install_md(
    *,
    pack_name: str,
    preset: str,
    version: str,
    source_repo: str,
    source_ref: str,
    topic: str,
    included_items: list[PackItem],
) -> str:
    top_level_groups = classify_top_level_groups(included_items)
    lines = [
        f"# Install {pack_name}",
        "",
        f"- Preset: `{preset}`",
        f"- Topic: `{topic or '-'}`",
        f"- Version: `{version}`",
        f"- Source repo: `{source_repo}`",
        f"- Source ref: `{source_ref}`",
        "",
        "## Install Steps",
        "",
        "1. Review `manifest.json` and `FILES.md`, confirm this pack matches the target repository's needs.",
        "2. Copy `bundle/` 下对应文件到目标仓库根目录，保持相对路径不变。",
        "3. 如目标仓库已存在同名文件，先人工 diff，再决定覆盖、合并或局部吸收。",
        "4. 在目标仓库更新 `.ch/docs/references/reference-packs.md`，记录来源、版本和本地改动情况。",
        "5. 如果 pack 带入了 skills，重启 Codex 或重新进入仓库，让新 skill 被扫描到。",
        "",
        "## Included Groups",
        "",
    ]
    lines.extend(f"- `{group}`" for group in top_level_groups)
    lines.extend(
        [
            "",
            "## Import Reminder",
            "",
            "- 不要把当前仓库的 generated 结果、真实 handoff 或进行中的计划一并复制过去。",
            "- 如果使用了 `--topic`，它只用 topic corpus 选择原始来源；不要把 generated topic corpus 当成唯一事实来源。",
            "- private 文档会跳过，private 标签块会在 bundle 中剥离。",
            "- pack 只解决“稳定骨架如何复用”，不替代目标仓库自己的事实来源建设。",
            "",
        ]
    )
    return "\n".join(lines)


def classify_top_level_groups(items: list[PackItem]) -> list[str]:
    groups: list[str] = []
    for item in items:
        path = item.path
        if path.startswith(".agents/skills/") and ".agents/skills/" not in groups:
            groups.append(".agents/skills/")
        elif path.startswith(".ch/docs/memory") and ".ch/docs/memory/" not in groups:
            groups.append(".ch/docs/memory/")
        elif path.startswith(".ch/docs/handoffs") and ".ch/docs/handoffs/" not in groups:
            groups.append(".ch/docs/handoffs/")
        elif path.startswith(".ch/docs/runbooks") and ".ch/docs/runbooks/" not in groups:
            groups.append(".ch/docs/runbooks/")
        elif path.startswith(".ch/docs/references") and ".ch/docs/references/" not in groups:
            groups.append(".ch/docs/references/")
        elif path.startswith(".ch/docs/generated") and ".ch/docs/generated/" not in groups:
            groups.append(".ch/docs/generated/")
        elif path.startswith(".ch/docs/exec-plans") and ".ch/docs/exec-plans/" not in groups:
            groups.append(".ch/docs/exec-plans/")
        elif path == ".ch/docs/MEMORY.md" and ".ch/docs/MEMORY.md" not in groups:
            groups.append(".ch/docs/MEMORY.md")
        elif path == ".ch/docs/PLANS.md" and ".ch/docs/PLANS.md" not in groups:
            groups.append(".ch/docs/PLANS.md")
    return groups


def render_reference_entry_md(
    *,
    pack_name: str,
    version: str,
    source_repo: str,
    source_ref: str,
    preset: str,
    topic: str,
) -> str:
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    lines = [
        "# Reference Entry",
        "",
        "将下面这一行追加到目标仓库的 `.ch/docs/references/reference-packs.md`：",
        "",
        "| Pack 名称 | 来源仓库 | 来源版本/Ref | 导入日期 | 作用域 | 本地改动 | 备注 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        f"| `{pack_name}` | `{source_repo}` | `{version}` / `{source_ref}` | `{today}` | `{preset}{f' / {topic}' if topic else ''}` | `no` | `imported via reference-pack` |",
        "",
    ]
    return "\n".join(lines)


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    raise SystemExit(main())
