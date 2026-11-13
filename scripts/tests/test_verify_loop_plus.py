"""根目录 Python 检测入口的参数、平台路径及退出码回归。"""
from __future__ import annotations

import contextlib
import io
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import verify_loop_plus


class VerifyLoopPlusTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="sinitek-verify-python-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "含空格 workspace"
        self.verifier = self.root / "scripts" / "verify_loop_plus_fix.js"
        self.verifier.parent.mkdir(parents=True)
        self.verifier.touch()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(verify_loop_plus, "ROOT_DIR", self.root))
        self.node = stack.enter_context(patch.object(verify_loop_plus, "require_tool", return_value="C:\\Program Files\\nodejs\\node.exe"))
        self.process = stack.enter_context(patch.object(verify_loop_plus, "run_process"))
        self.stderr = stack.enter_context(contextlib.redirect_stderr(io.StringIO()))

    def test_default_calls_only_the_existing_verifier_from_repository_root(self):
        self.assertEqual(verify_loop_plus.main([]), 0)
        self.node.assert_called_once_with("node")
        self.process.assert_called_once_with(
            [self.node.return_value, str(self.verifier), "--live"], cwd=self.root,
        )

    def test_windows_and_macos_paths_and_parameters_are_forwarded_without_splitting(self):
        for command in ["C:\\Program Files\\Codex\\codex.cmd", "/opt/local CLI/bin/codex"]:
            with self.subTest(command=command):
                arguments = ["--codex", command, "--runs", "2", "--report", str(self.root / "检测报告 report.json")]
                original = list(arguments)
                self.assertEqual(verify_loop_plus.main(arguments), 0)
                self.process.assert_called_with(
                    [self.node.return_value, str(self.verifier), "--live", *arguments], cwd=self.root,
                )
                self.assertEqual(arguments, original)

    def test_help_is_forwarded_to_the_verifier_without_a_separate_build(self):
        self.assertEqual(verify_loop_plus.main(["--help"]), 0)
        self.process.assert_called_once_with(
            [self.node.return_value, str(self.verifier), "--live", "--help"], cwd=self.root,
        )

    def test_omitted_arguments_use_sys_argv_but_explicit_empty_list_does_not(self):
        with patch.object(sys, "argv", ["verify_win.py", "--runs", "1"]):
            self.assertEqual(verify_loop_plus.main(), 0)
            self.assertEqual(self.process.call_args.args[0][-2:], ["--runs", "1"])
            self.assertEqual(verify_loop_plus.main([]), 0)
            self.assertEqual(self.process.call_args.args[0][-1], "--live")

    def test_child_exit_codes_are_preserved_and_signals_are_nonzero(self):
        for code, expected in [(1, 1), (7, 7), (75, 75), (-15, 143)]:
            with self.subTest(code=code):
                self.process.side_effect = subprocess.CalledProcessError(code, ["node", "verifier"])
                self.assertEqual(verify_loop_plus.main([]), expected)

    def test_missing_node_gives_a_chinese_error_and_starts_no_child(self):
        self.node.side_effect = RuntimeError("node 未安装或不在 PATH 中。")
        self.assertEqual(verify_loop_plus.main([]), 1)
        self.assertIn("检测无法启动", self.stderr.getvalue())
        self.assertIn("node", self.stderr.getvalue())
        self.process.assert_not_called()

    def test_missing_verifier_starts_no_tools(self):
        self.verifier.unlink()
        self.assertEqual(verify_loop_plus.main([]), 1)
        self.assertIn("未找到检测脚本", self.stderr.getvalue())
        self.node.assert_not_called()
        self.process.assert_not_called()

    def test_spawn_failure_never_reports_success(self):
        self.process.side_effect = OSError("拒绝访问")
        self.assertEqual(verify_loop_plus.main([]), 1)
        self.assertIn("拒绝访问", self.stderr.getvalue())

    def test_interrupt_is_not_reported_as_completion(self):
        self.process.side_effect = KeyboardInterrupt()
        self.assertEqual(verify_loop_plus.main([]), 130)
        self.assertIn("不能判定修复通过", self.stderr.getvalue())

    def test_both_root_entries_call_the_shared_main_and_preserve_its_result(self):
        for name in ["verify_mac.py", "verify_win.py"]:
            with self.subTest(name=name), patch.object(verify_loop_plus, "main", return_value=7) as main:
                with patch.object(sys, "path", sys.path.copy()), self.assertRaises(SystemExit) as raised:
                    runpy.run_path(str(REPO_ROOT / name), run_name="__main__")
                self.assertEqual(raised.exception.code, 7)
                main.assert_called_once_with()
        self.process.assert_not_called()


class VerifyRootEntrySmokeTests(unittest.TestCase):
    def test_real_help_and_invalid_options_work_outside_repository_without_live_execution(self):
        with tempfile.TemporaryDirectory(prefix="sinitek-verify-entry-") as directory:
            cwd = Path(directory) / "外部目录 with spaces"
            cwd.mkdir()
            for name in ["verify_mac.py", "verify_win.py"]:
                for arguments, expected in [(["--help"], 0), (["--runs", "0"], 1)]:
                    with self.subTest(name=name, arguments=arguments):
                        completed = subprocess.run(
                            [sys.executable, str(REPO_ROOT / name), *arguments],
                            cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=15,
                        )
                        self.assertEqual(completed.returncode, expected, completed.stderr)
                        self.assertNotIn("开始检测：", completed.stdout)
                        if expected == 0:
                            self.assertIn("--codex", completed.stdout)
                        else:
                            self.assertIn("--runs", completed.stderr)


if __name__ == "__main__":
    unittest.main()
