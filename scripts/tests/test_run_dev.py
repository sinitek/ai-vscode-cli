"""开发启动入口的平台兼容和依赖布局回归。"""
from __future__ import annotations

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import run_dev


class RunDevTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sinitek-dev-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "工作区 with spaces"
        self.root.mkdir()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(run_dev, "ROOT_DIR", self.root))
        self.process = stack.enter_context(patch.object(run_dev, "run_process"))
        stack.enter_context(patch.object(run_dev, "require_tool", return_value="npm"))
        self.pnpm = stack.enter_context(patch.object(run_dev.shutil, "which", return_value=None))
        stack.enter_context(patch.object(run_dev, "find_vscode_command", return_value="code"))
        stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        stack.enter_context(contextlib.redirect_stderr(io.StringIO()))

    def test_default_installs_builds_and_launches_from_script_directory(self):
        self.assertEqual(run_dev.main([]), 0)
        self.assertEqual(self.process.call_args_list, [
            call(["npm", "install"], cwd=self.root),
            call(["npm", "run", "build"], cwd=self.root),
            call(["code", "--new-window", f"--extensionDevelopmentPath={self.root}"], cwd=self.root),
        ])

    def test_existing_pnpm_layout_keeps_pnpm(self):
        (self.root / "node_modules" / ".pnpm").mkdir(parents=True)
        self.pnpm.return_value = "pnpm"
        run_dev.install_workspace_node_modules("npm")
        self.process.assert_called_once_with(["pnpm", "install"], cwd=self.root)

    def test_clean_checkout_can_follow_local_pnpm_lock(self):
        (self.root / "pnpm-lock.yaml").touch()
        self.pnpm.return_value = "pnpm"
        run_dev.install_workspace_node_modules("npm")
        self.process.assert_called_once_with(["pnpm", "install"], cwd=self.root)

    def test_existing_npm_layout_is_not_changed_by_local_pnpm_lock(self):
        (self.root / "node_modules").mkdir()
        (self.root / "pnpm-lock.yaml").touch()
        self.pnpm.return_value = "pnpm"
        run_dev.install_workspace_node_modules("npm")
        self.process.assert_called_once_with(["npm", "install"], cwd=self.root)

    def test_missing_pnpm_removes_incompatible_tree_before_install(self):
        node_modules = self.root / "node_modules"
        (node_modules / ".pnpm").mkdir(parents=True)
        (node_modules / "old-dependency").touch()

        def check_install(*args, **kwargs):
            self.assertFalse(node_modules.exists())

        self.process.side_effect = check_install
        run_dev.install_workspace_node_modules("npm")
        self.process.assert_called_once_with(["npm", "install"], cwd=self.root)

    def test_install_or_build_failure_stops_before_launch(self):
        for failing_step in (0, 1):
            with self.subTest(failing_step=failing_step):
                self.process.reset_mock()
                self.process.side_effect = [None] * failing_step + [subprocess.CalledProcessError(7, "npm")]
                self.assertEqual(run_dev.main([]), 7)
                self.assertEqual(self.process.call_count, failing_step + 1)

    def test_missing_vscode_stops_before_dependency_changes(self):
        with patch.object(run_dev, "find_vscode_command", return_value=None):
            self.assertEqual(run_dev.main([]), 1)
        self.process.assert_not_called()

    def test_custom_vscode_and_skips_only_launch_existing_build(self):
        code = str(self.root / "VS Code" / "bin" / "code.cmd")
        with patch.object(run_dev, "require_tool", side_effect=AssertionError("无需 npm")):
            self.assertEqual(run_dev.main(["--code", code, "--skip-install", "--skip-build"]), 0)
        self.process.assert_called_once_with(
            [code, "--new-window", f"--extensionDevelopmentPath={self.root}"], cwd=self.root,
        )


class VscodePlatformTests(unittest.TestCase):
    def test_macos_uses_bundled_code_before_path(self):
        with patch.object(run_dev.sys, "platform", "darwin"), \
                patch.object(Path, "is_file", return_value=True), \
                patch.object(run_dev.os, "access", return_value=True), \
                patch.object(run_dev, "find_vscode_code_command") as fallback:
            self.assertEqual(
                run_dev.find_vscode_command(),
                str(Path("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")),
            )
            fallback.assert_not_called()

    def test_macos_falls_back_to_path_if_app_is_missing_or_not_executable(self):
        for exists, executable in ((False, True), (True, False)):
            with self.subTest(exists=exists, executable=executable), \
                    patch.object(run_dev.sys, "platform", "darwin"), \
                    patch.object(Path, "is_file", return_value=exists), \
                    patch.object(run_dev.os, "access", return_value=executable), \
                    patch.object(run_dev, "find_vscode_code_command", return_value="/custom/bin/code"):
                self.assertEqual(run_dev.find_vscode_command(), "/custom/bin/code")

    @unittest.skipUnless(os.name == "nt", "验证真实 Windows cmd.exe")
    def test_windows_cmd_paths_and_arguments_with_spaces(self):
        with tempfile.TemporaryDirectory(prefix="sinitek dev ") as temporary:
            root = Path(temporary)
            output = root / "arguments.json"
            recorder = root / "record.py"
            recorder.write_text(
                "import json, pathlib, sys\n"
                "pathlib.Path(sys.argv[1]).write_text(json.dumps(sys.argv[2:]), encoding='utf-8')\n",
                encoding="utf-8",
            )
            command = root / "code.cmd"
            command.write_text(
                f'@echo off\n"{sys.executable}" "{recorder}" "{output}" %*\n',
                encoding="utf-8",
            )
            arguments = ["--new-window", f"--extensionDevelopmentPath={root / 'workspace with spaces & punctuation'}"]
            run_dev.run_process([str(command), *arguments], cwd=root)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), arguments)


if __name__ == "__main__":
    unittest.main()
