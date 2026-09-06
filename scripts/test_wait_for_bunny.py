import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import os
import runpy
import tempfile
import subprocess
import sys

spec = importlib.util.spec_from_file_location("wait_for_bunny", Path(__file__).with_name("wait_for_bunny.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = "a" * 40
REPO = "owner/repo"
PR = {"state": "open", "draft": False, "head": {"sha": SHA}, "base": {"ref": "main", "sha": "b" * 40}}

CONTEXT = gate.review_context(PR, "28", "none")


def status(state="success", **extra):
    return {"sha": SHA, "statuses": [{
        "context": "Bunny Review", "state": state,
        "creator": {"login": "github-actions[bot]", "type": "Bot"},
        "target_url": "https://github.com/owner/repo/actions/runs/123#" + CONTEXT,
        "description": "Bunny posted or updated its review for this pull request.",
        **extra,
    }]}


class BunnyGateTests(unittest.TestCase):
    def wait(self, responses, prs=None, timeout=40):
        states = iter(responses)
        pulls = iter(prs) if prs else None
        ticks = [0]
        def api(path):
            if "/pulls/" in path:
                return next(pulls) if pulls else PR
            self.assertEqual(path, f"repos/{REPO}/commits/{SHA}/statuses")
            return next(states)["statuses"]
        def sleep(seconds):
            ticks[0] += seconds
        with contextlib.redirect_stdout(io.StringIO()):
            return gate.wait_for_bunny(REPO, "28", SHA, api=api, clock=lambda: ticks[0], sleep=sleep, timeout=timeout, retarget=lambda *_: "none")

    def test_pending_and_missing_wait_for_green(self):
        self.assertTrue(self.wait([{"sha": SHA, "statuses": []}, status("pending"), status()]))

    def test_red_never_unlocks_preview(self):
        for state in ["failure", "error"]:
            with self.subTest(state=state):
                self.assertFalse(self.wait([status(state)]))

    def test_timeout_never_unlocks_preview(self):
        with self.assertRaises(TimeoutError):
            self.wait([status("pending")] * 3)

    def test_status_must_match_exact_head(self):
        response = status()
        response["sha"] = "b" * 40
        self.assertEqual(gate.bunny_state(response, SHA, REPO, CONTEXT), "pending")

    def test_status_must_come_from_trusted_reviewer(self):
        for extra in [
            {"context": "Another review"},
            {"creator": {"login": "someone", "type": "User"}},
            {"target_url": "https://example.com/green"},
            {"description": "Draft review posted with notes."},
        ]:
            with self.subTest(extra=extra):
                self.assertEqual(gate.bunny_state(status(**extra), SHA, REPO, CONTEXT), "pending")

    def test_invalid_pr_states_skip(self):
        for extra in [{"draft": True}, {"state": "closed"}, {"head": {"sha": "b" * 40}}, {"base": {"ref": "other"}}]:
            with self.subTest(extra=extra):
                self.assertFalse(self.wait([], prs=[{**PR, **extra}]))

    def test_changed_head_during_status_fetch_skips(self):
        self.assertFalse(self.wait([status()], prs=[PR, {**PR, "head": {"sha": "b" * 40}}]))

    def test_draft_review_waits_for_non_draft_review(self):
        self.assertTrue(self.wait([status(description="Draft review posted with notes."), status("pending"), status()]))

    def test_api_failure_cannot_approve(self):
        def failed_api(path):
            raise RuntimeError("API unavailable")
        with self.assertRaises(RuntimeError):
            gate.wait_for_bunny(REPO, "28", SHA, api=failed_api)

    def test_invalid_inputs_fail_before_api_call(self):
        for repo, number, sha in [("bad", "28", SHA), (REPO, "", SHA), (REPO, "28", "short")]:
            with self.subTest(repo=repo, number=number, sha=sha), self.assertRaises(ValueError):
                gate.wait_for_bunny(repo, number, sha, api=lambda _: self.fail("Unexpected API call"))

    def test_stale_base_or_retarget_approval_never_unlocks(self):
        for context in [CONTEXT.replace("b" * 40, "c" * 40),
                        CONTEXT.replace("retarget=none", "retarget=event1"), ""]:
            with self.subTest(context=context):
                response = status(target_url="https://github.com/owner/repo/actions/runs/123#" + context)
                with self.assertRaises(TimeoutError):
                    self.wait([response] * 3)

    def test_base_changes_during_status_request(self):
        self.assertFalse(self.wait([status()], prs=[PR, {**PR, "base": {"ref": "main", "sha": "c" * 40}}]))

    def test_capture_rejects_unreviewed_revision(self):
        for head, base in [("c" * 40, "b" * 40), (SHA, "c" * 40)]:
            with self.assertRaises(ValueError):
                gate.capture_review_context(REPO, "28", head, base, api=lambda _: PR,
                                            retarget=lambda *_: "none")

    def test_retarget_during_status_request(self):
        events = iter(["none", "new-event"])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(gate.wait_for_bunny(
                REPO, "28", SHA, api=lambda path: PR if "/pulls/" in path else status()["statuses"],
                retarget=lambda *_: next(events)))

    def test_trusted_context_is_captured_before_review(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / ".github/workflows/bunny-review.yml").read_text()
        self.assertIn('git show "$PR_BASE_SHA:scripts/wait_for_bunny.py"', source)
        self.assertLess(source.index("--review-context"), source.index("produce &"))
        self.assertEqual(source.count('#${BUNNY_APPROVAL_CONTEXT:-}'), 2)

    def test_pr_copy_cannot_replace_executed_trusted_gate(self):
        source = Path(gate.__file__).read_text()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "scripts/wait_for_bunny.py").write_text('raise AssertionError("Executed PR copy")')
            trusted = root / ".bunny-gate/scripts"
            trusted.mkdir(parents=True)
            script = trusted / "wait_for_bunny.py"
            script.write_text(source)
            output = root / "output"
            def api_command(args, **kwargs):
                if args[2] == "graphql":
                    response = {"data": {"repository": {"pullRequest": {"timelineItems": {"nodes": []}}}}}
                else:
                    response = PR if "/pulls/" in args[2] else status("failure")["statuses"]
                return subprocess.CompletedProcess(args, 0, stdout=json.dumps(response))
            previous = Path.cwd()
            try:
                os.chdir(root)
                with patch.dict(os.environ, {"GITHUB_REPOSITORY": REPO, "PR_NUMBER": "28",
                                             "PR_HEAD_SHA": SHA, "GITHUB_OUTPUT": str(output)}), \
                        patch.object(sys, "argv", [str(script)]), \
                        patch("subprocess.run", side_effect=api_command), \
                        contextlib.redirect_stdout(io.StringIO()):
                    runpy.run_path(".bunny-gate/scripts/wait_for_bunny.py", run_name="__main__")
            finally:
                os.chdir(previous)
            self.assertEqual(output.read_text(), "approved=false\n")

    def test_workflow_dependencies_cannot_form_a_preview_cycle(self):
        root = Path(__file__).resolve().parents[1]
        config = json.loads((root / ".github/bunny-review/ci-checks.json").read_text())
        self.assertEqual([item["name"] for item in config["expected_checks"]], ["Validate"])
        workflow = (root / ".github/workflows/shlai-pr.yml").read_text()
        preview = workflow.split("  preview:\n", 1)[1]
        self.assertIn("needs: [validate, bunny_gate]", preview)
        self.assertIn("needs.bunny_gate.outputs.approved == 'true'", preview)
        self.assertIn("github.event.pull_request.head.sha || github.sha", workflow)
        self.assertIn("types: [opened, synchronize, reopened, ready_for_review]", workflow)


if __name__ == "__main__":
    unittest.main()
