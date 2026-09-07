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
            report = audit.execute({"snapshot": "a" * 40, "scope": "update-release", "files": {}}, "packet", output, fail)
            self.assertEqual(report["state"], "incomplete")
            self.assertEqual(report["error_types"], ["RuntimeError", "ConnectionResetError"])
            self.assertTrue((output / "manifest.json").exists())
            self.assertNotIn("sensitive-url-or-token", (output / "report.json").read_text())

    def test_bad_schema_is_incomplete_not_clean(self):
        with tempfile.TemporaryDirectory() as directory:
            report = audit.execute({"snapshot": "a" * 40, "scope": "update-release", "files": {}},
                                   "packet", Path(directory), lambda *_: {})
            self.assertEqual(report["state"], "incomplete")

    def test_successful_report_keeps_candidates_unconfirmed(self):
        finding = {"path": "source.ts", "line": 1, "title": "Race", "body": "Trigger and impact"}
        for findings, expected in [([], "no-candidates"), ([finding], "needs-triage")]:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                report = audit.execute({"snapshot": "a" * 40, "scope": "update-release", "files": {"source.ts": 2}},
                                       "packet", output, lambda *_: self.review(findings))
                self.assertEqual(report["state"], expected)
                self.assertEqual(json.loads((output / "report.json").read_text())["candidates"], findings)
                self.assertIn("require reproduction", (output / "report.md").read_text())

    def test_failed_review_control_is_incomplete_not_clean(self):
        review = self.review()
        review["pre_merge_checks"] = [{"status": "fail", "name": "Missing context"}]
        with tempfile.TemporaryDirectory() as directory:
            report = audit.execute({"snapshot": "a" * 40, "scope": "update-release", "files": {}},
                                   "packet", Path(directory), lambda *_: review)
            self.assertEqual(report["state"], "incomplete")

    def test_call_budget_counts_failed_attempts(self):
        requests = audit.MeteredRequests(lambda **_: (_ for _ in ()).throw(ConnectionError()), lambda _: None)
        for _ in range(audit.MAX_CALLS):
            with self.assertRaises(ConnectionError):
                requests.create()
        with self.assertRaisesRegex(RuntimeError, "budget"):
            requests.create()

    def test_retrospective_disables_shared_request_timeout(self):
        from types import SimpleNamespace
        received = []
        def create(**kwargs):
            received.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="response"))])
        requests = audit.MeteredRequests(create, lambda _: None)
        client = SimpleNamespace(chat=SimpleNamespace(completions=requests))
        original_timeout = audit.bunny.MODEL_REQUEST_TIMEOUT
        self.assertEqual(audit.bunny.model_call(client, [], audit.bunny.build_stats("")), "response")
        self.assertIn("timeout", received[0])
        self.assertIsNone(received[0]["timeout"])
        self.assertEqual(audit.bunny.MODEL_REQUEST_TIMEOUT, original_timeout)

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
            manifest, packet = audit.prepare("update-release")
            self.assertIn("+current source", packet)
            self.assertEqual(manifest["snapshot"], "a" * 40)
            with patch.object(audit, "MAX_PACKET", 1), self.assertRaises(ValueError):
                audit.prepare("update-release")

    def test_dirty_live_checkout_rejected(self):
        with patch.object(audit, "git", side_effect=["a" * 40, " M source.ts"]), self.assertRaises(ValueError):
            audit.prepare("update-release")

    def test_update_chunks_and_workflow_choices_match(self):
        workflow = (Path(__file__).resolve().parents[1] / "workflows/bunny-retrospective.yml").read_text()
        for name in audit.SCOPES:
            self.assertIn(f"          - {name}\n", workflow)
        self.assertNotIn("updates", audit.SCOPES)
        chunks = [audit.SCOPES[name]["files"] for name in
                  ("update-release", "update-discovery", "update-install")]
        for files in chunks:
            self.assertTrue(any(".test." in path for path in files))
        self.assertFalse(set(chunks[0]) & set(chunks[1]) & set(chunks[2]))

    def test_extra_context_requests_have_reduced_limits(self):
        request = audit.bunny.parse_context_request('CONTEXT_REQUEST ' + json.dumps({
            "files": ["a", "b", "c"], "searches": ["first", "second"]}))
        self.assertEqual(request["files"], ["a", "b"])
        self.assertEqual(request["searches"], ["first"])
        self.assertEqual(audit.bunny.MAX_CONTEXT_CHARS, 20_000)
        self.assertEqual(audit.bunny.MAX_CONTEXT_FILE_CHARS, 10_000)

    def test_workflow_is_manual_pinned_read_only(self):
        text = (Path(__file__).resolve().parents[1] / "workflows/bunny-retrospective.yml").read_text()
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("if: github.ref == 'refs/heads/main'", text)
        self.assertIn("ref: ${{ github.sha }}", text)
        self.assertIn("persist-credentials: false", text)
        self.assertNotIn(": write", text)
        self.assertNotIn("GH_TOKEN", text)
        self.assertIn("if: always()", text)

    def test_diagnostic_is_one_small_nonstreaming_request(self):
        from types import SimpleNamespace
        received = []
        def create(**kwargs):
            received.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Explanation"))])
        with tempfile.TemporaryDirectory() as directory, patch.object(audit, "git", side_effect=["a" * 40, "small source"]):
            report = audit.run_diagnostic(Path(directory), create)
            self.assertEqual(report["state"], "response-received")
            self.assertEqual(len(received), 1)
            self.assertEqual(received[0]["timeout"], 180)
            self.assertFalse(received[0]["stream"])
            self.assertEqual(received[0]["messages"][1]["content"], "small source")

    def test_diagnostic_records_safe_failure_categories(self):
        def fail(**_):
            try:
                raise ConnectionError("Server disconnected without sending a response https://secret.invalid/token")
            except ConnectionError as cause:
                error = RuntimeError("provider secret body")
                error.status_code = 502
                raise error from cause
        with tempfile.TemporaryDirectory() as directory, patch.object(audit, "git", side_effect=["a" * 40, "small source"]):
            output = Path(directory)
            report = audit.run_diagnostic(output, fail)
            self.assertEqual(report["state"], "failed")
            self.assertEqual(report["http_status"], 502)
            self.assertEqual(report["categories"], ["disconnected_before_response"])
            self.assertEqual(report["error_types"], ["RuntimeError", "ConnectionError"])
            self.assertNotIn("secret", (output / "diagnostic.json").read_text())
            self.assertNotIn("secret", (output / "progress.log").read_text())

    def test_empty_diagnostic_response_is_not_success(self):
        from types import SimpleNamespace
        empty = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=""))])
        with tempfile.TemporaryDirectory() as directory, patch.object(audit, "git", side_effect=["a" * 40, "small source"]):
            report = audit.run_diagnostic(Path(directory), lambda **_: empty)
            self.assertEqual(report["state"], "failed")

    def test_oversized_diagnostic_source_never_calls_model(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(audit, "git", side_effect=["a" * 40, "x" * 4001]):
            with self.assertRaises(ValueError):
                audit.run_diagnostic(Path(directory), lambda **_: self.fail("Unexpected model call"))


if __name__ == "__main__":
    unittest.main()
