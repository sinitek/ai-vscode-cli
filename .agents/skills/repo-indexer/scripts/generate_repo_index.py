#!/usr/bin/env python3
"""Generate low-noise repository navigation artifacts.

This script intentionally favors stable, mechanical facts over subjective
summaries so the output stays searchable, reviewable, and easy to regenerate.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python < 3.11 fallback
    tomllib = None

GENERATOR_NAME = "repo-indexer"
GENERATOR_VERSION = "0.1.0"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/repo-index"
DEFAULT_MODE = "quick"
MAX_LOCAL_AGENT_RESULTS = 200
SKIP_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    "node_modules",
    "dist",
    "build",
    "target",
    "coverage",
    ".next",
    ".nuxt",
    ".turbo",
    ".venv",
    "venv",
    "__pycache__",
}
ENTRY_DOC_CANDIDATES = [
    "AGENTS.md",
    "README.md",
    "ARCHITECTURE.md",
    ".ch/docs/README.md",
    ".ch/docs/PLANS.md",
    ".ch/docs/TESTING.md",
    ".ch/docs/SECURITY.md",
    ".ch/docs/RELIABILITY.md",
    ".ch/docs/product-specs/index.md",
    ".ch/docs/design-docs/index.md",
    ".ch/docs/runbooks/README.md",
]
WATCHED_PATTERNS = [
    "AGENTS.md",
    "**/AGENTS.md",
    "README.md",
    "ARCHITECTURE.md",
    ".ch/docs/**",
    "package.json",
    "pyproject.toml",
    "Makefile",
    "justfile",
    ".github/workflows/**",
]
TOP_LEVEL_PURPOSES = {
    ".agents": "仓库级 skills 与代理工作流扩展",
    ".ch": "仓库知识系统与执行文档",
    ".codex": "项目级 Codex 配置",
    ".github": "CI、工作流与协作自动化",
    "AGENTS.md": "仓库级规则与导航入口",
    "README.md": "项目概览与快速启动入口",
    "ARCHITECTURE.md": "架构边界与模块职责说明",
    "package.json": "Node 项目脚本与依赖入口",
    "pyproject.toml": "Python 项目配置与依赖入口",
    "Makefile": "常用工程命令入口",
    "justfile": "常用工程命令入口",
    "app": "应用或可复制 starter 本体",
    "apps": "多应用入口集合",
    "backend": "后端服务代码",
    "cmd": "CLI 或服务入口",
    "config": "配置文件与配置模板",
    "docs": "说明文档与设计/运维资料",
    "frontend": "前端应用代码",
    "infra": "基础设施与部署配置",
    "internal": "内部实现模块",
    "packages": "共享包或库",
    "pkg": "公共库代码",
    "scripts": "自动化脚本",
    "services": "服务模块集合",
    "src": "主要源码目录",
    "test": "测试目录",
    "tests": "测试目录",
    "tools": "开发工具或辅助脚本",
}
STACK_DETECTORS = {
    "package.json": "node",
    "pnpm-workspace.yaml": "pnpm-workspace",
    "pyproject.toml": "python",
    "requirements.txt": "python",
    "go.mod": "go",
    "Cargo.toml": "rust",
    "pom.xml": "java-maven",
    "build.gradle": "java-gradle",
    "build.gradle.kts": "java-gradle",
    "Gemfile": "ruby",
    "composer.json": "php",
}


@dataclass
class CommandEntry:
    category: str
    command: str
    source: str
    detail: str | None = None

    def to_dict(self) -> dict[str, str]:
        payload = {
            "category": self.category,
            "command": self.command,
            "source": self.source,
        }
        if self.detail:
            payload["detail"] = self.detail
        return payload


@dataclass
class EntryDoc:
    path: str
    kind: str
    reason: str

    def to_dict(self) -> dict[str, str]:
        return {"path": self.path, "kind": self.kind, "reason": self.reason}


@dataclass
class TopLevelEntry:
    path: str
    entry_type: str
    purpose: str

    def to_dict(self) -> dict[str, str]:
        return {
            "path": self.path,
            "entry_type": self.entry_type,
            "purpose": self.purpose,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate repository index artifacts.")
    parser.add_argument("--root", default=".", help="Repository root to scan.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated artifacts. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--mode",
        choices=["quick", "full"],
        default=DEFAULT_MODE,
        help="Scan depth preset. quick is the default low-noise mode.",
    )
    parser.add_argument(
        "--focus-path",
        action="append",
        default=[],
        help="Optional path prefix to highlight in the summary. Can be repeated.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_output_dir(root, args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    top_level_entries = collect_top_level_entries(root)
    entry_docs = collect_entry_docs(root)
    local_agents = collect_local_agents(root, limit=MAX_LOCAL_AGENT_RESULTS)
    detected_stacks = detect_stacks(root)
    commands = collect_commands(root)

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    git_head = get_git_head(root)
    focus_paths = normalize_focus_paths(root, args.focus_path)

    summary = {
        "top_level_entries": [entry.to_dict() for entry in top_level_entries],
        "entry_docs": [entry.to_dict() for entry in entry_docs],
        "local_agents": local_agents,
        "detected_stacks": detected_stacks,
        "commands": {
            category: [command.to_dict() for command in command_entries]
            for category, command_entries in group_commands(commands).items()
        },
        "focus_paths": focus_paths,
    }

    manifest = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": generated_at,
        "mode": args.mode,
        "repo_root": str(root),
        "output_dir": str(output_dir),
        "git_head": git_head,
        "focus_paths": focus_paths,
        "sources": sorted(list_sources(root)),
        "watched_patterns": WATCHED_PATTERNS,
        "files": [
            "index.md",
            "repo-map.md",
            "commands.md",
            "context-entrypoints.md",
            "manifest.json",
            "summary.json",
        ],
    }

    write_text(output_dir / "index.md", render_index_markdown(root, args.mode, generated_at, git_head, detected_stacks, focus_paths))
    write_text(output_dir / "repo-map.md", render_repo_map_markdown(top_level_entries, local_agents))
    write_text(output_dir / "commands.md", render_commands_markdown(commands))
    write_text(output_dir / "context-entrypoints.md", render_context_entrypoints_markdown(entry_docs, local_agents))
    write_json(output_dir / "manifest.json", manifest)
    write_json(output_dir / "summary.json", summary)

    print(f"[{GENERATOR_NAME}] generated artifacts in {output_dir}")
    for filename in manifest["files"]:
        print(f"- {filename}")
    return 0


def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def normalize_focus_paths(root: Path, focus_paths: list[str]) -> list[str]:
    normalized: list[str] = []
    for raw_path in focus_paths:
        candidate = (root / raw_path).resolve()
        try:
            normalized.append(candidate.relative_to(root).as_posix())
        except ValueError:
            normalized.append(raw_path)
    return sorted(dict.fromkeys(normalized))


def collect_top_level_entries(root: Path) -> list[TopLevelEntry]:
    entries: list[TopLevelEntry] = []
    for child in sorted(root.iterdir(), key=lambda path: (path.is_file(), path.name.lower())):
        if child.name in SKIP_DIR_NAMES:
            continue
        if child.name.startswith(".") and child.name not in {".agents", ".ch", ".codex", ".github"}:
            continue
        entry_type = "directory" if child.is_dir() else "file"
        purpose = TOP_LEVEL_PURPOSES.get(child.name, "未自动识别用途；请结合相邻 README / AGENTS.md 判断")
        entries.append(TopLevelEntry(path=child.name, entry_type=entry_type, purpose=purpose))
    return entries


def collect_entry_docs(root: Path) -> list[EntryDoc]:
    entry_docs: list[EntryDoc] = []
    for relative_path in ENTRY_DOC_CANDIDATES:
        candidate = root / relative_path
        if not candidate.exists():
            continue
        reason = entry_doc_reason(relative_path)
        kind = entry_doc_kind(relative_path)
        entry_docs.append(EntryDoc(path=relative_path, kind=kind, reason=reason))
    return entry_docs


def entry_doc_kind(relative_path: str) -> str:
    if relative_path.endswith("AGENTS.md"):
        return "rules"
    if relative_path.endswith("README.md"):
        return "overview"
    if "product-specs" in relative_path:
        return "spec-index"
    if "design-docs" in relative_path:
        return "design-index"
    return "doc"


def entry_doc_reason(relative_path: str) -> str:
    if relative_path == "AGENTS.md":
        return "仓库级工作规则与入口"
    if relative_path == "README.md":
        return "项目概览与常用入口"
    if relative_path == "ARCHITECTURE.md":
        return "架构边界与模块职责"
    if relative_path == ".ch/docs/README.md":
        return "文档系统总入口"
    if relative_path == ".ch/docs/PLANS.md":
        return "复杂任务计划与收尾机制"
    if relative_path == ".ch/docs/TESTING.md":
        return "测试与验证基线"
    if relative_path == ".ch/docs/SECURITY.md":
        return "安全基线与约束"
    if relative_path == ".ch/docs/RELIABILITY.md":
        return "可靠性与验证闭环"
    if relative_path == ".ch/docs/product-specs/index.md":
        return "产品规格与功能清单入口"
    if relative_path == ".ch/docs/design-docs/index.md":
        return "设计文档入口"
    if relative_path == ".ch/docs/runbooks/README.md":
        return "运行与排障手册入口"
    return "事实来源入口"


def collect_local_agents(root: Path, limit: int) -> list[str]:
    results: list[str] = []
    for current_root, dir_names, file_names in os.walk(root):
        dir_names[:] = pruned_dir_names(dir_names)
        if "AGENTS.md" not in file_names:
            continue
        candidate = Path(current_root) / "AGENTS.md"
        relative_path = candidate.relative_to(root).as_posix()
        if relative_path == "AGENTS.md":
            continue
        results.append(relative_path)
        if len(results) >= limit:
            break
    return sorted(results)


def pruned_dir_names(dir_names: Iterable[str]) -> list[str]:
    return sorted(name for name in dir_names if name not in SKIP_DIR_NAMES)


def detect_stacks(root: Path) -> list[str]:
    detected: list[str] = []
    for marker, stack_name in STACK_DETECTORS.items():
        if (root / marker).exists():
            detected.append(stack_name)
    if (root / ".github/workflows").exists():
        detected.append("github-actions")
    return sorted(dict.fromkeys(detected))


def collect_commands(root: Path) -> list[CommandEntry]:
    commands: list[CommandEntry] = []
    commands.extend(collect_package_json_commands(root))
    commands.extend(collect_makefile_commands(root))
    commands.extend(collect_justfile_commands(root))
    commands.extend(collect_pyproject_commands(root))
    return sorted(commands, key=lambda item: (item.category, item.command, item.source))


def collect_package_json_commands(root: Path) -> list[CommandEntry]:
    package_json = root / "package.json"
    if not package_json.exists():
        return []

    try:
        payload = json.loads(package_json.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []

    package_manager = str(payload.get("packageManager", "npm"))
    runner = package_manager.split("@", 1)[0] or "npm"
    if runner not in {"npm", "pnpm", "yarn", "bun"}:
        runner = "npm"

    scripts = payload.get("scripts", {})
    if not isinstance(scripts, dict):
        return []

    categories = {
        "dev": "dev",
        "start": "dev",
        "test": "test",
        "lint": "lint",
        "build": "build",
        "typecheck": "check",
        "check": "check",
    }

    commands: list[CommandEntry] = []
    for name, script_body in sorted(scripts.items()):
        category = categories.get(name, "other")
        if runner in {"pnpm", "yarn", "bun"} and name in {"dev", "start", "test", "lint", "build"}:
            command_text = f"{runner} {name}"
        else:
            command_text = f"{runner} run {name}"
        commands.append(
            CommandEntry(
                category=category,
                command=command_text,
                source="package.json",
                detail=str(script_body),
            )
        )
    return commands


MAKE_TARGET_PATTERN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?:\s|$)")
JUST_TARGET_PATTERN = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*)\s*:(?:\s|$)")


def collect_makefile_commands(root: Path) -> list[CommandEntry]:
    makefile = root / "Makefile"
    if not makefile.exists():
        return []

    commands: list[CommandEntry] = []
    for line in makefile.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("."):
            continue
        match = MAKE_TARGET_PATTERN.match(line)
        if not match:
            continue
        target = match.group(1)
        if any(symbol in target for symbol in ("%", "/", "$")):
            continue
        commands.append(
            CommandEntry(
                category=categorize_target_name(target),
                command=f"make {target}",
                source="Makefile",
            )
        )
    return dedupe_commands(commands)


def collect_justfile_commands(root: Path) -> list[CommandEntry]:
    justfile = root / "justfile"
    if not justfile.exists():
        return []

    commands: list[CommandEntry] = []
    for line in justfile.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = JUST_TARGET_PATTERN.match(line)
        if not match:
            continue
        target = match.group(1)
        if target.startswith("_"):
            continue
        commands.append(
            CommandEntry(
                category=categorize_target_name(target),
                command=f"just {target}",
                source="justfile",
            )
        )
    return dedupe_commands(commands)


def collect_pyproject_commands(root: Path) -> list[CommandEntry]:
    pyproject = root / "pyproject.toml"
    if not pyproject.exists() or tomllib is None:
        return []

    try:
        payload = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return []

    commands: list[CommandEntry] = []

    project_scripts = payload.get("project", {}).get("scripts", {})
    if isinstance(project_scripts, dict):
        for script_name, script_target in sorted(project_scripts.items()):
            commands.append(
                CommandEntry(
                    category="cli",
                    command=script_name,
                    source="pyproject.toml",
                    detail=str(script_target),
                )
            )

    tool_section = payload.get("tool", {})
    if isinstance(tool_section, dict):
        uv_scripts = tool_section.get("uv", {}).get("scripts", {}) if isinstance(tool_section.get("uv"), dict) else {}
        if isinstance(uv_scripts, dict):
            for script_name, script_target in sorted(uv_scripts.items()):
                commands.append(
                    CommandEntry(
                        category="other",
                        command=f"uv run {script_name}",
                        source="pyproject.toml",
                        detail=str(script_target),
                    )
                )
    return dedupe_commands(commands)


def dedupe_commands(commands: list[CommandEntry]) -> list[CommandEntry]:
    seen: set[tuple[str, str, str, str | None]] = set()
    deduped: list[CommandEntry] = []
    for command in commands:
        key = (command.category, command.command, command.source, command.detail)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(command)
    return deduped


def categorize_target_name(target: str) -> str:
    lowered = target.lower()
    if any(token in lowered for token in ("test", "pytest", "spec")):
        return "test"
    if any(token in lowered for token in ("lint", "fmt", "format")):
        return "lint"
    if any(token in lowered for token in ("build", "compile", "bundle")):
        return "build"
    if any(token in lowered for token in ("dev", "serve", "start", "run")):
        return "dev"
    if any(token in lowered for token in ("check", "verify", "validate", "typecheck")):
        return "check"
    return "other"


def group_commands(commands: list[CommandEntry]) -> dict[str, list[CommandEntry]]:
    grouped: dict[str, list[CommandEntry]] = {
        "dev": [],
        "test": [],
        "build": [],
        "lint": [],
        "check": [],
        "cli": [],
        "other": [],
    }
    for command in commands:
        grouped.setdefault(command.category, []).append(command)
    return grouped


def list_sources(root: Path) -> set[str]:
    sources: set[str] = set()
    for relative_path in ENTRY_DOC_CANDIDATES:
        if (root / relative_path).exists():
            sources.add(relative_path)
    for relative_path in ("package.json", "pyproject.toml", "Makefile", "justfile"):
        if (root / relative_path).exists():
            sources.add(relative_path)
    if (root / ".github/workflows").exists():
        sources.add(".github/workflows/")
    return sources


def render_index_markdown(
    root: Path,
    mode: str,
    generated_at: str,
    git_head: str | None,
    detected_stacks: list[str],
    focus_paths: list[str],
) -> str:
    stacks_text = ", ".join(detected_stacks) if detected_stacks else "未检测到常见技术栈标记"
    git_text = git_head or "unavailable"
    focus_section = ""
    if focus_paths:
        focus_items = "\n".join(f"- `{path}`" for path in focus_paths)
        focus_section = f"\n## 当前关注路径\n\n{focus_items}\n"

    return f"""# Repo Index

- generator: `{GENERATOR_NAME}` `{GENERATOR_VERSION}`
- generated_at: `{generated_at}`
- mode: `{mode}`
- repo_root: `{root}`
- git_head: `{git_text}`
- detected_stacks: {stacks_text}

## 建议阅读顺序

1. `repo-map.md`：看仓库结构与高频入口
2. `commands.md`：看开发、测试、构建命令
3. `context-entrypoints.md`：看规则与文档事实来源

## 产物说明

- `repo-map.md`：顶层目录、关键入口、局部规则文件位置
- `commands.md`：从常见配置文件机械提取的命令索引
- `context-entrypoints.md`：AGENTS、README、docs index 等事实入口
- `manifest.json`：生成元数据与 watched patterns
- `summary.json`：供脚本或其他 skill 读取的机读摘要
{focus_section}
## 使用提醒

- 这些文件是导航层，不替代代码、规格、设计文档或执行计划。
- 如果结构、命令或入口文件发生变化，请重新生成。
"""


def render_repo_map_markdown(top_level_entries: list[TopLevelEntry], local_agents: list[str]) -> str:
    lines = [
        "# Repo Map",
        "",
        "## 顶层目录与文件",
        "",
        "| 路径 | 类型 | 用途 |",
        "| --- | --- | --- |",
    ]
    if top_level_entries:
        for entry in top_level_entries:
            lines.append(f"| `{entry.path}` | {entry.entry_type} | {entry.purpose} |")
    else:
        lines.append("| _none_ | - | - |")

    lines.extend([
        "",
        "## 局部 AGENTS.md",
        "",
    ])
    if local_agents:
        lines.extend(f"- `{path}`" for path in local_agents)
    else:
        lines.append("- 未检测到仓库根级之外的局部 `AGENTS.md`")

    lines.extend([
        "",
        "## 使用建议",
        "",
        "- 先读根级 `AGENTS.md` 与 `.ch/docs/README.md`，再进入任务相关目录。",
        "- 如果某个业务目录存在局部 `AGENTS.md`，优先读取最近的一层。",
    ])
    return "\n".join(lines) + "\n"


def render_commands_markdown(commands: list[CommandEntry]) -> str:
    grouped = group_commands(commands)
    lines = ["# Commands Index", ""]
    for category in ("dev", "test", "build", "lint", "check", "cli", "other"):
        lines.append(f"## {category}")
        lines.append("")
        command_entries = grouped.get(category, [])
        if not command_entries:
            lines.append("- 未检测到该类别命令")
            lines.append("")
            continue
        lines.append("| 命令 | 来源 | 说明 |")
        lines.append("| --- | --- | --- |")
        for command in command_entries:
            detail = command.detail.replace("|", "\\|") if command.detail else "-"
            lines.append(f"| `{command.command}` | `{command.source}` | {detail} |")
        lines.append("")

    lines.extend([
        "## 使用提醒",
        "",
        "- 这里只列机械提取出来的命令，不保证所有命令都已可运行。",
        "- 执行前仍应查看对应配置文件和局部说明，确认依赖、环境变量和工作目录。",
    ])
    return "\n".join(lines) + "\n"


def render_context_entrypoints_markdown(entry_docs: list[EntryDoc], local_agents: list[str]) -> str:
    lines = [
        "# Context Entrypoints",
        "",
        "## 全局入口",
        "",
        "| 路径 | 类型 | 作用 |",
        "| --- | --- | --- |",
    ]
    if entry_docs:
        for entry in entry_docs:
            lines.append(f"| `{entry.path}` | {entry.kind} | {entry.reason} |")
    else:
        lines.append("| _none_ | - | 未检测到预设入口文档 |")

    lines.extend([
        "",
        "## 局部规则入口",
        "",
    ])
    if local_agents:
        lines.extend(f"- `{path}`" for path in local_agents)
    else:
        lines.append("- 未检测到局部 `AGENTS.md`")

    lines.extend([
        "",
        "## 使用建议",
        "",
        "- 把这里列出的文档视为导航入口，再继续深挖与当前任务直接相关的事实来源。",
        "- 如果信息只存在聊天里、不在这里或代码里落库，对下一次会话来说等价于不存在。",
    ])
    return "\n".join(lines) + "\n"


def get_git_head(root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return result.stdout.strip() or None


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
