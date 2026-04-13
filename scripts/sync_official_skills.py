#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
MEDIA_DIR = ROOT / "media"
OFFICIAL_SKILLS_DIR = MEDIA_DIR / "official-skills"
CATALOG_PATH = MEDIA_DIR / "official_skills_catalog.json"

PLATFORMS = ("claude", "codex", "gemini")
PLATFORM_DEFAULTS: Dict[str, Dict[str, str]] = {
    "claude": {
        "group": "example-skills",
        "groupDescription": "示例技能集合，展示技能创建、MCP 构建、视觉设计、算法艺术、内部沟通、Web 测试、制品构建、Slack GIF 和主题样式等多种能力",
    },
    "codex": {
        "group": "curated",
        "groupDescription": "可通过官方 `$skill-installer` 工作流安装的 OpenAI curated skills。",
    },
    "gemini": {
        "group": "extensions",
        "groupDescription": "Google Gemini CLI 官方 Extensions，可直接安装到 `~/.gemini/extensions`。",
    },
}

MANUAL_ITEM_OVERRIDES: Dict[Tuple[str, str], Dict[str, str]] = {
    (
        "codex",
        "cli-creator",
    ): {
        "name": "cli-creator",
        "description": "基于 API 文档、OpenAPI 规范、现有 curl 示例、SDK、Web 应用、管理工具或本地脚本，为 Codex 构建可组合的 CLI。适用于希望 Codex 创建可在任意仓库通过命令名运行、提供可组合读写命令、返回稳定 JSON、管理鉴权，并可配套 companion skill 的命令行工具场景。",
        "group": "curated",
        "groupDescription": "可通过官方 `$skill-installer` 工作流安装的 OpenAI curated skills。",
        "installFolderName": "cli-creator",
        "sourceRepo": "openai/skills",
        "sourcePath": "skills/.curated/cli-creator",
    },
}

PLATFORM_NOTES_SUFFIX = "sourceRef 使用上游 codeload tarball 的 ETag，便于配置页识别内置官方包是否可更新。"
VALIDATION_FILE_BY_PLATFORM = {
    "claude": "SKILL.md",
    "codex": "SKILL.md",
    "gemini": "gemini-extension.json",
}


@dataclass
class PlatformBundle:
    platform: str
    repo: str
    branch: str
    ref: str
    extracted_root: Path


@dataclass
class GeminiBundle:
    repo: str
    branch: str
    ref: str
    extracted_root: Path


class SyncError(RuntimeError):
    pass


def run_command(args: List[str], *, cwd: Optional[Path] = None) -> str:
    result = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SyncError(
            f"Command failed ({result.returncode}): {' '.join(args)}\n{result.stdout}\n{result.stderr}".strip()
        )
    return result.stdout


def http_head(url: str) -> Optional[Dict[str, str]]:
    result = subprocess.run(
        ["curl", "-sSIL", "--max-time", "30", url],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    header_blocks = [block for block in result.stdout.split("\r\n\r\n") if block.strip()]
    if not header_blocks:
        return None
    lines = [line for line in header_blocks[-1].splitlines() if line.strip()]
    if not lines:
        return None
    status_line = lines[0]
    match = re.search(r"\s(\d{3})\s", status_line + " ")
    if not match:
        return None
    status = int(match.group(1))
    headers: Dict[str, str] = {":status": str(status)}
    for line in lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    run_command(["curl", "-sSL", "--fail", "--max-time", "180", "-o", str(destination), url])


def normalize_ref(value: str) -> str:
    cleaned = value.strip().strip('"')
    if not cleaned:
        raise SyncError("Missing source ref/etag from upstream archive.")
    return f"etag:{cleaned}"


def resolve_repo_tarball(repo: str) -> Tuple[str, str, str]:
    for branch in ("main", "master"):
        url = f"https://codeload.github.com/{repo}/tar.gz/refs/heads/{branch}"
        headers = http_head(url)
        if not headers:
            continue
        if headers.get(":status") != "200":
            continue
        etag = headers.get("etag")
        if not etag:
            raise SyncError(f"Upstream archive missing etag header: {url}")
        return branch, url, normalize_ref(etag)
    raise SyncError(f"Unable to resolve codeload tarball for {repo} (tried main/master).")


def extract_tarball(tarball_path: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tarball_path, "r:gz") as archive:
        archive.extractall(destination)
    entries = [path for path in destination.iterdir() if path.is_dir()]
    if len(entries) != 1:
        raise SyncError(f"Expected one extracted root in {destination}, found {len(entries)}")
    return entries[0]


def zip_directory(source_dir: Path, zip_path: Path) -> None:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for current_root, dir_names, file_names in os.walk(source_dir):
            current_path = Path(current_root)
            dir_names.sort()
            file_names.sort()
            relative_root = current_path.relative_to(source_dir.parent)
            if not file_names and not dir_names:
                directory_name = str(relative_root).replace(os.sep, "/") + "/"
                info = zipfile.ZipInfo(directory_name)
                st = current_path.stat()
                info.external_attr = (st.st_mode & 0xFFFF) << 16
                archive.writestr(info, "")
                continue
            for file_name in file_names:
                file_path = current_path / file_name
                arc_name = str(relative_root / file_name).replace(os.sep, "/")
                info = zipfile.ZipInfo.from_file(file_path, arc_name)
                st = file_path.stat()
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (st.st_mode & 0xFFFF) << 16
                with file_path.open("rb") as handle:
                    archive.writestr(info, handle.read())


def ensure_validation_file(platform: str, skill_root: Path) -> None:
    validation = skill_root / VALIDATION_FILE_BY_PLATFORM[platform]
    if not validation.exists():
        raise SyncError(f"Missing validation file for {platform}: {validation}")


def load_existing_catalog() -> Dict[str, Any]:
    if not CATALOG_PATH.exists():
        raise SyncError(f"Missing current catalog: {CATALOG_PATH}")
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


@dataclass
class SeedLookup:
    by_platform_name: Dict[Tuple[str, str], Dict[str, Any]]
    by_platform_repo_path: Dict[Tuple[str, str, str], Dict[str, Any]]
    by_platform_install_dir: Dict[Tuple[str, str], Dict[str, Any]]
    platform_meta: Dict[str, Dict[str, Any]]


def build_seed_lookup(catalog: Dict[str, Any]) -> SeedLookup:
    by_platform_name: Dict[Tuple[str, str], Dict[str, Any]] = {}
    by_platform_repo_path: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    by_platform_install_dir: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for item in catalog.get("skills", []):
        platform = str(item["platform"])
        by_platform_name[(platform, str(item["name"]))] = item
        by_platform_repo_path[(platform, str(item["sourceRepo"]), str(item["sourcePath"]))] = item
        by_platform_install_dir[(platform, str(item["installFolderName"]))] = item
    return SeedLookup(
        by_platform_name=by_platform_name,
        by_platform_repo_path=by_platform_repo_path,
        by_platform_install_dir=by_platform_install_dir,
        platform_meta=dict(catalog.get("platforms", {})),
    )


def seed_for_item(
    lookup: SeedLookup,
    platform: str,
    source_repo: str,
    source_path: str,
    install_folder_name: str,
    item_name: str,
) -> Optional[Dict[str, Any]]:
    return (
        lookup.by_platform_repo_path.get((platform, source_repo, source_path))
        or lookup.by_platform_install_dir.get((platform, install_folder_name))
        or lookup.by_platform_name.get((platform, item_name))
    )


def get_item_metadata(
    lookup: SeedLookup,
    *,
    platform: str,
    source_repo: str,
    source_path: str,
    install_folder_name: str,
    item_name: str,
) -> Dict[str, str]:
    seed = seed_for_item(lookup, platform, source_repo, source_path, install_folder_name, item_name)
    override = MANUAL_ITEM_OVERRIDES.get((platform, item_name), {})
    group = str(override.get("group") or (seed or {}).get("group") or PLATFORM_DEFAULTS[platform]["group"])
    group_description = str(
        override.get("groupDescription")
        or (seed or {}).get("groupDescription")
        or PLATFORM_DEFAULTS[platform]["groupDescription"]
    )
    display_name = str(override.get("name") or (seed or {}).get("name") or item_name)
    install_dir = str(override.get("installFolderName") or (seed or {}).get("installFolderName") or install_folder_name)
    description = override.get("description") or (seed or {}).get("description")
    if not description:
        raise SyncError(
            f"Missing Chinese description for {platform}:{item_name}. Add it to MANUAL_ITEM_OVERRIDES or seed catalog first."
        )
    return {
        "group": group,
        "groupDescription": group_description,
        "name": display_name,
        "description": str(description),
        "installFolderName": install_dir,
    }


def build_platform_meta(seed_meta: Dict[str, Any], ref: str, *, notes_suffix: str = PLATFORM_NOTES_SUFFIX) -> Dict[str, str]:
    notes = str(seed_meta.get("notes") or "")
    if notes_suffix not in notes:
        notes = f"{notes} {notes_suffix}".strip()
    return {
        "repo": str(seed_meta.get("repo") or ""),
        "ref": ref,
        "sourceUrl": str(seed_meta.get("sourceUrl") or ""),
        "installRootHint": str(seed_meta.get("installRootHint") or ""),
        "notes": notes,
    }


def remove_stale_archives(platform_root: Path, expected_files: Iterable[Path]) -> None:
    expected_names = {path.name for path in expected_files}
    if not platform_root.exists():
        return
    for existing in platform_root.glob("*.zip"):
        if existing.name not in expected_names:
            existing.unlink()


def sha256_of_refs(pairs: Iterable[Tuple[str, str]]) -> str:
    payload = "\n".join(f"{repo}={ref}" for repo, ref in sorted(pairs))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def sync_codex_or_claude(platform: str, repo: str, source_root: str, lookup: SeedLookup, output_root: Path) -> Tuple[List[Dict[str, Any]], str]:
    branch, url, ref = resolve_repo_tarball(repo)
    with tempfile.TemporaryDirectory(prefix=f"sinitek-{platform}-") as temp_dir:
        temp_path = Path(temp_dir)
        tarball_path = temp_path / f"{platform}.tar.gz"
        download_file(url, tarball_path)
        extracted_root = extract_tarball(tarball_path, temp_path / "extract")
        entry_root = extracted_root / source_root
        if not entry_root.exists():
            raise SyncError(f"Missing upstream source directory: {entry_root}")
        items: List[Dict[str, Any]] = []
        written_archives: List[Path] = []
        platform_output = output_root / platform
        platform_output.mkdir(parents=True, exist_ok=True)
        for entry in sorted(path for path in entry_root.iterdir() if path.is_dir()):
            item_name = entry.name
            install_folder_name = item_name
            source_path = f"{source_root}/{item_name}"
            metadata = get_item_metadata(
                lookup,
                platform=platform,
                source_repo=repo,
                source_path=source_path,
                install_folder_name=install_folder_name,
                item_name=item_name,
            )
            ensure_validation_file(platform, entry)
            archive_path = platform_output / f"{metadata['installFolderName']}.zip"
            zip_directory(entry, archive_path)
            written_archives.append(archive_path)
            items.append(
                {
                    "id": f"{platform}:{metadata['name']}",
                    "platform": platform,
                    "group": metadata["group"],
                    "groupDescription": metadata["groupDescription"],
                    "name": metadata["name"],
                    "description": metadata["description"],
                    "archivePath": f"official-skills/{platform}/{archive_path.name}",
                    "installFolderName": metadata["installFolderName"],
                    "sourceRepo": repo,
                    "sourceRef": ref,
                    "sourcePath": source_path,
                    "sourceUrl": f"https://github.com/{repo}/tree/{branch}/{source_path}",
                }
            )
        remove_stale_archives(OFFICIAL_SKILLS_DIR / platform, written_archives)
        return items, ref


def collect_gemini_repos(catalog: Dict[str, Any]) -> List[str]:
    repos = {str(item["sourceRepo"]) for item in catalog.get("skills", []) if item.get("platform") == "gemini"}
    override_repos = {
        value["sourceRepo"]
        for (platform, _), value in MANUAL_ITEM_OVERRIDES.items()
        if platform == "gemini" and value.get("sourceRepo")
    }
    return sorted(repos | override_repos)


def clone_seed_gemini_items(seed_catalog: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
    items = [dict(item) for item in seed_catalog.get("skills", []) if item.get("platform") == "gemini"]
    if not items:
        raise SyncError("Seed catalog does not contain Gemini items to reuse.")
    for item in items:
        archive_path = MEDIA_DIR / str(item["archivePath"])
        if not archive_path.exists():
            raise SyncError(f"Missing seeded Gemini archive: {archive_path}")
    platform_meta = seed_catalog.get("platforms", {}).get("gemini") or {}
    snapshot_ref = str(platform_meta.get("ref") or f"snapshot:{sha256_of_refs((str(item['sourceRepo']), str(item['sourceRef'])) for item in items)}")
    return sorted(items, key=lambda item: str(item["name"]).lower()), snapshot_ref


def sync_gemini(lookup: SeedLookup, seed_catalog: Dict[str, Any], output_root: Path) -> Tuple[List[Dict[str, Any]], str]:
    items: List[Dict[str, Any]] = []
    written_archives: List[Path] = []
    resolved_refs: List[Tuple[str, str]] = []
    platform_output = output_root / "gemini"
    platform_output.mkdir(parents=True, exist_ok=True)
    for repo in collect_gemini_repos(seed_catalog):
        branch, url, latest_ref = resolve_repo_tarball(repo)
        repo_name = repo.split("/", 1)[1]
        seed = seed_for_item(lookup, "gemini", repo, ".", repo_name, repo_name)
        display_name = repo_name
        install_folder_name = repo_name
        if seed:
            display_name = str(seed.get("name") or repo_name)
            install_folder_name = str(seed.get("installFolderName") or repo_name)
        metadata = get_item_metadata(
            lookup,
            platform="gemini",
            source_repo=repo,
            source_path=".",
            install_folder_name=install_folder_name,
            item_name=display_name,
        )
        archive_path = platform_output / f"{metadata['installFolderName']}.zip"
        existing_archive = MEDIA_DIR / (str(seed.get("archivePath")) if seed and seed.get("archivePath") else f"official-skills/gemini/{archive_path.name}")
        item_ref = latest_ref
        item_source_url = f"https://github.com/{repo}/tree/{branch}"
        if seed and str(seed.get("sourceRef") or "") == latest_ref and existing_archive.exists():
            if existing_archive.resolve() != archive_path.resolve():
                shutil.copy2(existing_archive, archive_path)
        else:
            try:
                with tempfile.TemporaryDirectory(prefix="sinitek-gemini-") as temp_dir:
                    temp_path = Path(temp_dir)
                    tarball_path = temp_path / "repo.tar.gz"
                    download_file(url, tarball_path)
                    extracted_root = extract_tarball(tarball_path, temp_path / "extract")
                    ensure_validation_file("gemini", extracted_root)
                    renamed_root = temp_path / metadata["installFolderName"]
                    shutil.copytree(extracted_root, renamed_root)
                    zip_directory(renamed_root, archive_path)
            except SyncError as error:
                if not seed or not existing_archive.exists():
                    raise
                print(f"[warn] Reusing existing Gemini archive for {repo}: {error}", file=sys.stderr, flush=True)
                if existing_archive.resolve() != archive_path.resolve():
                    shutil.copy2(existing_archive, archive_path)
                item_ref = str(seed.get("sourceRef") or latest_ref)
                item_source_url = str(seed.get("sourceUrl") or item_source_url)
        resolved_refs.append((repo, item_ref))
        written_archives.append(archive_path)
        items.append(
            {
                "id": f"gemini:{metadata['name']}",
                "platform": "gemini",
                "group": metadata["group"],
                "groupDescription": metadata["groupDescription"],
                "name": metadata["name"],
                "description": metadata["description"],
                "archivePath": f"official-skills/gemini/{archive_path.name}",
                "installFolderName": metadata["installFolderName"],
                "sourceRepo": repo,
                "sourceRef": item_ref,
                "sourcePath": ".",
                "sourceUrl": item_source_url,
            }
        )
    remove_stale_archives(OFFICIAL_SKILLS_DIR / "gemini", written_archives)
    snapshot_ref = f"snapshot:{sha256_of_refs(resolved_refs)}"
    return sorted(items, key=lambda item: str(item["name"]).lower()), snapshot_ref


def validate_catalog(catalog: Dict[str, Any]) -> None:
    skills = catalog.get("skills")
    if not isinstance(skills, list) or not skills:
        raise SyncError("Generated catalog has no skills.")
    seen_ids = set()
    for item in skills:
        item_id = str(item["id"])
        if item_id in seen_ids:
            raise SyncError(f"Duplicate catalog id: {item_id}")
        seen_ids.add(item_id)
        archive_path = MEDIA_DIR / str(item["archivePath"])
        if not archive_path.exists():
            raise SyncError(f"Missing generated archive: {archive_path}")
        validation_name = VALIDATION_FILE_BY_PLATFORM[str(item["platform"])]
        with zipfile.ZipFile(archive_path, "r") as archive:
            names = archive.namelist()
            if not any(name.endswith(f"/{validation_name}") for name in names):
                raise SyncError(f"Archive missing validation entry */{validation_name}: {archive_path}")


def main() -> int:
    refresh_gemini = "--refresh-gemini" in sys.argv[1:]
    seed_catalog = load_existing_catalog()
    lookup = build_seed_lookup(seed_catalog)
    output_root = OFFICIAL_SKILLS_DIR
    output_root.mkdir(parents=True, exist_ok=True)

    print("[1/4] Syncing Claude official skills...", flush=True)
    claude_items, claude_ref = sync_codex_or_claude("claude", "anthropics/skills", "skills", lookup, output_root)

    print("[2/4] Syncing Codex official skills...", flush=True)
    codex_items, codex_ref = sync_codex_or_claude("codex", "openai/skills", "skills/.curated", lookup, output_root)

    print("[3/4] Syncing Gemini official extensions...", flush=True)
    if refresh_gemini:
        gemini_items, gemini_ref = sync_gemini(lookup, seed_catalog, output_root)
    else:
        gemini_items, gemini_ref = clone_seed_gemini_items(seed_catalog)

    generated_at = run_command(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"]).strip()
    catalog = {
        "generatedAt": generated_at,
        "platforms": {
            "claude": build_platform_meta(lookup.platform_meta.get("claude", {}), claude_ref),
            "codex": build_platform_meta(lookup.platform_meta.get("codex", {}), codex_ref),
            "gemini": build_platform_meta(
                lookup.platform_meta.get("gemini", {}),
                gemini_ref,
                notes_suffix="每个 extension 条目分别记录对应 repo 的 tarball ETag，供配置页判断是否可更新。",
            ),
        },
        "skills": sorted(claude_items + codex_items + gemini_items, key=lambda item: (item["platform"], item["name"].lower())),
    }
    validate_catalog(catalog)
    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    counts = {platform: 0 for platform in PLATFORMS}
    for item in catalog["skills"]:
        counts[str(item["platform"])] += 1
    print("[4/4] Done", flush=True)
    print(json.dumps({"generatedAt": generated_at, "counts": counts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyncError as error:
        print(f"sync_official_skills.py failed: {error}", file=sys.stderr)
        raise SystemExit(1)
