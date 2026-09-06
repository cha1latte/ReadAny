import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "preview_build_scope", Path(__file__).with_name("preview_build_scope.py")
)
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class PreviewBuildScopeTests(unittest.TestCase):
    def test_bunny_setup_and_docs_skip(self):
        self.assertFalse(scope.needs_apk([
            ".github/bunny-review/bunny_review.py", ".github/workflows/bunny-review.yml",
            ".github/workflows/shlai-pr.yml", ".github/workflows/shlai-phone-release.yml",
            "scripts/preview_build_scope.py", "docs/readany-shlai/bunny-review.md", ".gitignore",
            "AGENTS.md", ".github/bunny-review/voice.json",
            "scripts/wait_for_bunny.py", "scripts/test_wait_for_bunny.py",
        ]))

    def test_mixed_changes_and_unknown_configuration_build(self):
        for path in [
            "packages/app-expo/src/App.tsx", "packages/core/src/stores/reader-store.ts",
            "packages/app/src-tauri/tauri.conf.json", "packages/foliate-js/view.js",
            "package.json", "pnpm-lock.yaml", "eas.json", ".npmrc",
            ".github/workflows/shlai-release.yml", "docs/generate-reader.js",
        ]:
            with self.subTest(path=path):
                self.assertTrue(scope.needs_apk(["docs/notes.md", path]))

    def test_manual_dispatch_forces_build_without_diff(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch"}, clear=True), patch.object(scope, "changed_paths") as diff, contextlib.redirect_stdout(io.StringIO()) as output:
            scope.main()
        diff.assert_not_called()
        self.assertIn("apk_required=true", output.getvalue())

    def test_diff_failure_forces_build(self):
        for error in [ValueError("missing commit"), subprocess.CalledProcessError(1, "git")]:
            with self.subTest(error=error), patch.dict(os.environ, {"GITHUB_EVENT_NAME": "push"}, clear=True), patch.object(scope, "changed_paths", side_effect=error), contextlib.redirect_stdout(io.StringIO()) as output:
                scope.main()
            self.assertIn("apk_required=true", output.getvalue())

    def test_push_and_pr_write_explicit_skip_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"
            for event in ("pull_request", "push"):
                path.write_text("")
                with patch.dict(os.environ, {"GITHUB_EVENT_NAME": event, "GITHUB_OUTPUT": str(path)}, clear=True), patch.object(scope, "changed_paths", return_value=["docs/review.md"]), contextlib.redirect_stdout(io.StringIO()):
                    scope.main()
                self.assertEqual(path.read_text(), "apk_required=false\n")

    def test_git_diff_includes_deleted_and_renamed_source(self):
        # A real Git fixture exercises NUL separation and rename handling.
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.run(["git", "-C", directory, *args], check=True, capture_output=True, text=True).stdout.strip()
            git("init")
            source = Path(directory) / "app.ts"
            source.write_text("const value = 1;\n")
            git("add", ".")
            git("-c", "user.name=Scope Test", "-c", "user.email=scope@example.invalid", "commit", "-m", "base")
            base = git("rev-parse", "HEAD")
            docs = Path(directory) / "docs"
            docs.mkdir()
            source.rename(docs / "app notes.md")
            git("add", "-A")
            git("-c", "user.name=Scope Test", "-c", "user.email=scope@example.invalid", "commit", "-m", "rename")
            head = git("rev-parse", "HEAD")
            run = subprocess.run
            with patch.object(scope.subprocess, "run", side_effect=lambda args, **kwargs: run(args, cwd=directory, **kwargs)):
                paths = scope.changed_paths(base, head)
            self.assertEqual(set(paths), {"app.ts", "docs/app notes.md"})
            self.assertTrue(scope.needs_apk(paths))


if __name__ == "__main__":
    unittest.main()
