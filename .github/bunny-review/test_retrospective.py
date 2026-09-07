"""Offline audit boundary and failure tests; no provider calls."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("retrospective", Path(__file__).with_name("retrospective.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class RetrospectiveTests(unittest.TestCase):
    def review(self, findings=None):
        return {"change_summary": ["Inspected current source"], "what_i_checked": ["Source only"],
                "findings": findings or [], "nitpicks": [], "pre_merge_checks": [], "open_questions": []}

    def test_locations_must_exist_in_current_scope(self):
        valid = {"path": "source.ts", "line": 2, "title": "Race", "body": "Trigger and impact"}
        for invalid in [{**valid, "line": 3}, {**valid, "line": True},
                        {**valid, "path": "historical.ts"}]:
            with self.subTest(invalid=invalid):
                accepted, rejected = audit.validate_candidates(self.review([valid, invalid]), {"source.ts": 2})
                self.assertEqual(accepted, [valid])
                self.assertEqual(rejected, [invalid])

    def test_failure_preserves_cause_types_without_secret_message(self):
        def fail(*_):
            try:
                raise ConnectionResetError("sensitive-url-or-token")
            except ConnectionResetError as cause:
                raise RuntimeError("provider-body") from cause
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            report = audit.execute({"snapshot": "a" * 40, "scope": "updates", "files": {}}, "packet", output, fail)
            self.assertEqual(report["state"], "incomplete")
            self.assertEqual(report["error_types"], ["RuntimeError", "ConnectionResetError"])
            self.assertTrue((output / "manifest.json").exists())
            self.assertNotIn("sensitive-url-or-token", (output / "report.json").read_text())

    def test_bad_schema_is_incomplete_not_clean(self):
        with tempfile.TemporaryDirectory() as directory:
            report = audit.execute({"snapshot": "a" * 40, "scope": "updates", "files": {}},
                                   "packet", Path(directory), lambda *_: {})
            self.assertEqual(report["state"], "incomplete")

    def test_successful_report_keeps_candidates_unconfirmed(self):
        finding = {"path": "source.ts", "line": 1, "title": "Race", "body": "Trigger and impact"}
        for findings, expected in [([], "no-candidates"), ([finding], "needs-triage")]:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                report = audit.execute({"snapshot": "a" * 40, "scope": "updates", "files": {"source.ts": 2}},
                                       "packet", output, lambda *_: self.review(findings))
                self.assertEqual(report["state"], expected)
                self.assertEqual(json.loads((output / "report.json").read_text())["candidates"], findings)
                self.assertIn("require reproduction", (output / "report.md").read_text())

    def test_failed_review_control_is_incomplete_not_clean(self):
        review = self.review()
        review["pre_merge_checks"] = [{"status": "fail", "name": "Missing context"}]
        with tempfile.TemporaryDirectory() as directory:
            report = audit.execute({"snapshot": "a" * 40, "scope": "updates", "files": {}},
                                   "packet", Path(directory), lambda *_: review)
            self.assertEqual(report["state"], "incomplete")

    def test_call_budget_counts_failed_attempts(self):
        requests = audit.MeteredRequests(lambda **_: (_ for _ in ()).throw(ConnectionError()), lambda _: None)
        for _ in range(audit.MAX_CALLS):
            with self.assertRaises(ConnectionError):
                requests.create()
        with self.assertRaisesRegex(RuntimeError, "budget"):
            requests.create()

    def test_prepare_uses_pinned_current_content_and_rejects_oversize(self):
        commands = []
        def git(*args):
            commands.append(args)
            if args[0] == "rev-parse":
                return "a" * 40
            if args[0] == "show":
                self.assertTrue(args[1].startswith("a" * 40 + ":"))
                return "current source\n"
            return ""
        with patch.object(audit, "git", side_effect=git), patch.object(audit.bunny, "select_guidance", return_value=[]):
            manifest, packet = audit.prepare("updates")
            self.assertIn("+current source", packet)
            self.assertEqual(manifest["snapshot"], "a" * 40)
            with patch.object(audit, "MAX_PACKET", 1), self.assertRaises(ValueError):
                audit.prepare("updates")

    def test_dirty_live_checkout_rejected(self):
        with patch.object(audit, "git", side_effect=["a" * 40, " M source.ts"]), self.assertRaises(ValueError):
            audit.prepare("updates")

    def test_workflow_is_manual_pinned_read_only(self):
        text = (Path(__file__).resolve().parents[1] / "workflows/bunny-retrospective.yml").read_text()
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("if: github.ref == 'refs/heads/main'", text)
        self.assertIn("ref: ${{ github.sha }}", text)
        self.assertIn("persist-credentials: false", text)
        self.assertNotIn(": write", text)
        self.assertNotIn("GH_TOKEN", text)
        self.assertIn("if: always()", text)


if __name__ == "__main__":
    unittest.main()
