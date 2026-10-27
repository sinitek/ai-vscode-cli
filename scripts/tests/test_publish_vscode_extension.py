from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]


class PublishFixture:
    def __init__(self, test: unittest.TestCase, publisher: str = "sinitek") -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="sinitek publish test ")
        test.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.events_file = self.root / "events.jsonl"
        for filename in (
            "publish_vscode_extension.py",
            "run_dev.py",
            "vscode_extension_process.py",
            "vscode_extension_win.py",
        ):
            (self.root / filename).write_bytes((ROOT_DIR / filename).read_bytes())
        (self.root / "scripts").mkdir()
        for filename in ("vsix_target.js",):
            (self.root / "scripts" / filename).write_bytes((ROOT_DIR / "scripts" / filename).read_bytes())
        (self.root / "package.json").write_text(
            json.dumps({"name": "sinitek-cli-tools", "publisher": publisher, "version": "1.2.0"}),
            encoding="utf-8",
        )
        export_fixture = self.root / "export_fixture.py"
        export_fixture.write_text(
            "import json, os, pathlib, sys\n"
            "args = sys.argv[1:]\n"
            "pathlib.Path(os.environ['EVENT_FILE']).open('a', encoding='utf-8').write("
            "json.dumps({'args': ['export', *args]}) + '\\n')\n"
            "if os.environ.get('FAIL_COMMAND') == 'export':\n"
            "    raise SystemExit(1)\n"
            "target = args[args.index('--target') + 1]\n"
            "suffix = '' if target == 'universal' else '-' + target\n"
            "if not os.environ.get('OMIT_PACKAGE'):\n"
            "    output = pathlib.Path.cwd() / 'dist' / ('sinitek-cli-tools-1.2.0' + suffix + '.vsix')\n"
            "    output.parent.mkdir(parents=True, exist_ok=True)\n"
            "    output.write_bytes(b'fixture vsix')\n",
            encoding="utf-8",
        )
        (self.root / "export_vscode_extension.py").write_text(
            "import runpy, sys\n"
            "from pathlib import Path\n"
            "if __name__ == '__main__':\n"
            "    sys.argv[0] = str(Path(__file__).with_name('export_fixture.py'))\n"
            "    runpy.run_path(sys.argv[0], run_name='__main__')\n"
            "else:\n"
            "    sys.stdin.isatty = lambda: False\n"
            "    ROOT_DIR = Path(__file__).resolve().parent\n"
            "    import json, os\n"
            "    read_manifest = lambda root=ROOT_DIR: json.loads((root / 'package.json').read_text(encoding='utf-8'))\n"
            "    def resolve_target(target, root=ROOT_DIR):\n"
            "        valid = {'universal', 'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'}\n"
            "        if target != 'current' and target not in valid:\n"
            "            raise RuntimeError('不支持的打包平台：' + target)\n"
            "        return 'win32-x64' if target == 'current' and os.name == 'nt' else target\n"
            "    resolve_vsce = lambda root=ROOT_DIR, install_missing=True: str(root / 'node_modules' / '.bin' / ('vsce.cmd' if os.name == 'nt' else 'vsce'))\n"
            "    def output_file(target, root=ROOT_DIR):\n"
            "        suffix = '' if target == 'universal' else '-' + target\n"
            "        return root / 'dist' / ('sinitek-cli-tools-1.2.0' + suffix + '.vsix')\n",
            encoding="utf-8",
        )
        bin_dir = self.root / "node_modules" / ".bin"
        bin_dir.mkdir(parents=True)
        recorder = self.root / "record_vsce.py"
        recorder.write_text(
            "import json, os, pathlib, sys\n"
            "args = sys.argv[1:]\n"
            "pathlib.Path(os.environ['EVENT_FILE']).open('a', encoding='utf-8').write("
            "json.dumps({'args': args, 'patMatches': os.environ.get('VSCE_PAT') == os.environ.get('EXPECTED_PAT')}) + '\\n')\n"
            "if args[0] == 'ls-publishers' and os.environ.get('CACHED_PUBLISHER'):\n"
            "    print(os.environ['CACHED_PUBLISHER'])\n"
            "if args[0] == os.environ.get('FAIL_COMMAND'):\n"
            "    raise SystemExit(1)\n",
            encoding="utf-8",
        )
        suffix = ".cmd" if os.name == "nt" else ""
        self.vsce = bin_dir / f"vsce{suffix}"
        if suffix:
            self.vsce.write_text(
                f'@echo off\r\n"{sys.executable}" "{recorder}" %*\r\n',
                encoding="utf-8",
            )
        else:
            self.vsce.write_text(f"#!{sys.executable}\n" + recorder.read_text(encoding="utf-8"), encoding="utf-8")
            self.vsce.chmod(0o755)
        (self.root / "record_vsce.py").write_text(
            recorder.read_text(encoding="utf-8")
            + "if args[0] == 'package' and not os.environ.get('OMIT_PACKAGE'):\n"
            + "    output = pathlib.Path(args[args.index('--out') + 1])\n"
            + "    output.parent.mkdir(parents=True, exist_ok=True)\n"
            + "    output.write_bytes(b'fixture vsix')\n",
            encoding="utf-8",
        )
        if not suffix:
            self.vsce.write_text(f"#!{sys.executable}\n" + recorder.read_text(encoding="utf-8"), encoding="utf-8")

    def run(self, args: list[str] | None = None, **overrides: str) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        for name in (
            "VSCE_PAT",
            "VSCODE_MARKETPLACE_PAT",
            "VSCE_AZURE_CREDENTIAL",
            "CACHED_PUBLISHER",
            "FAIL_COMMAND",
            "OMIT_PACKAGE",
            "EVENT_FILE",
            "EXPECTED_PAT",
        ):
            env.pop(name, None)
        env.update({"EVENT_FILE": str(self.events_file), "PYTHONIOENCODING": "utf-8", **overrides})
        return subprocess.run(
            [sys.executable, str(self.root / "publish_vscode_extension.py"), *(args or [])],
            cwd=tempfile.gettempdir(),
            env=env,
            capture_output=True,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            timeout=15,
        )

    def events(self) -> list[dict]:
        if not self.events_file.exists():
            return []
        return [json.loads(line) for line in self.events_file.read_text(encoding="utf-8").splitlines()]


class MarketplacePublishTests(unittest.TestCase):
    def fixture(self, publisher: str = "sinitek") -> PublishFixture:
        return PublishFixture(self, publisher)

    def test_help_and_invalid_arguments_do_not_start_publishing(self) -> None:
        fixture = self.fixture()
        help_result = fixture.run(["--help"])
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        self.assertIn("sinitek", help_result.stdout)
        for args in (["--unknown"], ["--target"], ["--target", "unsupported"]):
            with self.subTest(args=args):
                self.assertNotEqual(fixture.run(args).returncode, 0)
        self.assertEqual(fixture.events(), [])

    def test_environment_tokens_and_precedence(self) -> None:
        for token_source in ("VSCE_PAT", "VSCODE_MARKETPLACE_PAT"):
            with self.subTest(token_source=token_source):
                fixture = self.fixture()
                token = "fixture-publishing-token"
                result = fixture.run(**{token_source: token, "EXPECTED_PAT": token})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(all(event["patMatches"] for event in fixture.events() if "patMatches" in event))
                self.assertNotIn(token, result.stdout + result.stderr)
                self.assertIn("发布成功：sinitek.sinitek-cli-tools@1.2.0", result.stdout)
        fixture = self.fixture()
        result = fixture.run(
            ["--target", "win32-x64"],
            VSCE_PAT="primary-token",
            VSCODE_MARKETPLACE_PAT="fallback-token",
            EXPECTED_PAT="primary-token",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(fixture.events()[0]["patMatches"])
        self.assertEqual(fixture.events()[1]["args"], ["export", "--target", "win32-x64"])
        self.assertTrue(any("sinitek-cli-tools-1.2.0-win32-x64.vsix" in arg for arg in fixture.events()[-1]["args"]))

    def test_cached_publisher_is_reused(self) -> None:
        fixture = self.fixture()
        result = fixture.run(CACHED_PUBLISHER="sinitek")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([event["args"][0] for event in fixture.events()], ["ls-publishers", "verify-pat", "export", "publish"])

    def test_missing_credentials_stop_before_export(self) -> None:
        fixture = self.fixture()
        result = fixture.run(CACHED_PUBLISHER="other-publisher")
        self.assertEqual(result.returncode, 1)
        self.assertIn(f'"{Path(fixture.vsce).resolve()}" login sinitek', result.stderr)
        self.assertNotIn("npx", result.stderr)
        self.assertEqual([event["args"][0] for event in fixture.events()], ["ls-publishers"])

    def test_publisher_mismatch_stops_before_credentials(self) -> None:
        fixture = self.fixture("other-publisher")
        result = fixture.run(VSCE_PAT="fixture-token")
        self.assertEqual(result.returncode, 1)
        self.assertIn("publisher 必须为 sinitek", result.stderr)
        self.assertEqual(fixture.events(), [])

    def test_verify_failure_stops_before_export(self) -> None:
        fixture = self.fixture()
        result = fixture.run(VSCE_PAT="fixture-token", FAIL_COMMAND="verify-pat")
        self.assertEqual(result.returncode, 1)
        self.assertEqual([event["args"][0] for event in fixture.events()], ["verify-pat"])

    def test_export_failure_and_missing_vsix_stop_before_publish(self) -> None:
        for overrides in ({"FAIL_COMMAND": "export"}, {"OMIT_PACKAGE": "1"}):
            with self.subTest(overrides=overrides):
                fixture = self.fixture()
                result = fixture.run(VSCE_PAT="fixture-token", **overrides)
                self.assertEqual(result.returncode, 1)
                self.assertEqual([event["args"][0] for event in fixture.events()], ["verify-pat", "export"])

    def test_publish_failure_preserves_vsix_and_does_not_report_success(self) -> None:
        fixture = self.fixture()
        result = fixture.run(VSCE_PAT="fixture-token", FAIL_COMMAND="publish")
        self.assertEqual(result.returncode, 1)
        self.assertIn("已发布版本不能重复覆盖", result.stderr)
        self.assertNotIn("发布成功", result.stdout)
        self.assertTrue((fixture.root / "dist" / "sinitek-cli-tools-1.2.0.vsix").is_file())


class InteractiveExitTests(unittest.TestCase):
    def run_entrypoint(self, isatty: bool) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="sinitek publish entrypoint ") as temporary:
            script = Path(temporary) / "entrypoint.py"
            script.write_text(
                "import runpy\n"
                "from unittest.mock import patch\n"
                "import publish_vscode_extension as publish_script\n"
                "publish_script.main = lambda: 1\n"
                f"publish_script.sys.stdin.isatty = lambda: {isatty}\n"
                "with patch('builtins.input') as wait_for_input:\n"
                "    try:\n"
                "        runpy.run_module('publish_vscode_extension', run_name='__main__')\n"
                "    except SystemExit:\n"
                "        pass\n"
                f"assert wait_for_input.call_count == {int(isatty)}\n",
                encoding="utf-8",
            )
            return subprocess.run(
                [sys.executable, "-c", f"import runpy; runpy.run_path({str(script)!r}, run_name='__main__')"],
                cwd=ROOT_DIR,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

    def test_interactive_failure_keeps_window_open_and_preserves_exit_code(self) -> None:
        result = self.run_entrypoint(True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_noninteractive_failure_does_not_wait_for_input(self) -> None:
        result = self.run_entrypoint(False)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
