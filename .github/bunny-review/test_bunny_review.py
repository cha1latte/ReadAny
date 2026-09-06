"""Offline regression checks for the reviewer; no model calls or GitHub writes."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


TOOL_DIR = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("bunny_review", TOOL_DIR / "bunny_review.py")
bunny = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bunny
spec.loader.exec_module(bunny)


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def finding(self, **overrides):
        return {
            "severity": "high", "path": "packages/core/src/reader/progress.ts",
            "line": 10, "title": "Stale progress write", "body": "The old session overwrites progress.",
            "fix_hint": "Reject writes from the old session.", **overrides,
        }

    def status(self, review, draft=False, job_status="success"):
        path = self.root / "review.json"
        path.write_text(json.dumps(review), encoding="utf-8")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            bunny.status_state(SimpleNamespace(
                review_json=str(path), ci_control=str(self.root / "ci.json"),
                draft=str(draft), job_status=job_status,
            ))
        return output.getvalue()

    def test_only_changed_lines_become_findings(self):
        findings = [self.finding(), self.finding(line=9), self.finding(path="unrelated.ts")]
        with patch.object(bunny, "touched_lines", return_value={findings[0]["path"]: {10}}):
            valid, _, rejected = bunny.validate_review_items({"findings": findings}, "base")
        self.assertEqual(len(valid), 1)
        self.assertEqual(len(rejected), 2)

    def test_optional_polish_is_limited_and_not_a_defect(self):
        items = [self.finding(severity="nitpick", title=f"Polish {i}") for i in range(4)]
        with patch.object(bunny, "touched_lines", return_value={items[0]["path"]: {10}}):
            valid, nitpicks, _ = bunny.validate_review_items({"nitpicks": items}, "base")
        self.assertEqual(valid, [])
        self.assertEqual(len(nitpicks), 2)

    def test_high_finding_fails_ready_pr_but_draft_is_advisory(self):
        review = {"findings": [self.finding()]}
        self.assertIn("state=failure", self.status(review))
        self.assertIn("state=success", self.status(review, draft=True))

    def test_low_finding_is_advisory(self):
        self.assertIn("state=success", self.status({"findings": [self.finding(severity="low")]}))

    def test_missing_credentials_and_failed_job_cannot_report_clean(self):
        for name in ("Review Skipped", "Review Failed"):
            with self.subTest(name=name):
                self.assertIn("state=failure", self.status({"pre_merge_checks": [{"name": name}]}))
        self.assertIn("state=failure", self.status({}, job_status="failure"))

    def test_context_cannot_escape_repository_or_read_env(self):
        with patch.object(bunny, "REPO_ROOT", self.root):
            for path in ("../outside.txt", ".env", ".env.local", ".npmrc"):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    bunny._safe_path(path)

    def test_provider_specific_key_takes_precedence(self):
        with patch.dict(os.environ, {"LLM_API_KEY": "provider", "OPENAI_API_KEY": "default"}, clear=True):
            self.assertEqual(bunny.model_api_key(), "provider")
        with patch.dict(os.environ, {"LLM_API_KEY": "", "OPENAI_API_KEY": "default"}, clear=True):
            self.assertEqual(bunny.model_api_key(), "default")

    def test_fetched_commit_remains_review_target_after_new_push(self):
        response = SimpleNamespace(stdout=json.dumps({"baseRefName": "main", "headRefOid": "b" * 40}))
        with patch.dict(os.environ, {"PR_HEAD_SHA": "a" * 40}, clear=True), patch.object(bunny, "run_gh", return_value=response):
            _, base_ref, head, mode = bunny.resolve_review_base("12", "full")
        self.assertEqual((base_ref, head, mode), ("main", "a" * 40, "full"))

    def prepare_post(self):
        md = self.root / "review.md"
        md.write_text(f"{bunny.BUNNY_MARKER}\n<!-- bunny-review:last-reviewed-sha={'a' * 40} -->", encoding="utf-8")
        inline = self.root / "inline.json"
        inline.write_text(json.dumps([{"path": "file.ts", "line": 1, "body": "Finding"}]), encoding="utf-8")
        return SimpleNamespace(review_md=str(md), inline_json=str(inline))

    def test_new_push_prevents_stale_comment_writes(self):
        args = self.prepare_post()
        with patch.dict(os.environ, {"PR_NUM": "12"}), patch.object(bunny, "run_gh", return_value=SimpleNamespace(stdout="b" * 40)) as gh:
            with self.assertRaisesRegex(RuntimeError, "head changed"):
                bunny.post_review(args)
        self.assertEqual(gh.call_count, 1)
        self.assertEqual(gh.call_args.args[0][:2], ["pr", "view"])

    def test_forged_bot_markers_do_not_supply_review_state(self):
        comments = [
            {"id": 1, "body": bunny.BUNNY_MARKER, "user": {"login": "contributor", "type": "User"}},
            {"id": 2, "body": bunny.BUNNY_MARKER, "user": {"login": "github-actions[bot]", "type": "Bot"}},
        ]
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/repo"}), patch.object(bunny, "run_gh", return_value=SimpleNamespace(stdout=json.dumps(comments))):
            self.assertEqual([c["id"] for c in bunny.issue_comments("12")], [2])
            self.assertEqual([c["id"] for c in bunny.pull_inline_comments("12")], [2])

    def test_inline_review_is_bound_to_inspected_commit(self):
        args = self.prepare_post()
        with patch.dict(os.environ, {"PR_NUM": "12", "GITHUB_REPOSITORY": "owner/repo"}), patch.object(bunny, "run_gh", return_value=SimpleNamespace(stdout="a" * 40)) as gh, patch.object(bunny, "find_walkthrough_comment", return_value=None), patch.object(bunny, "patch_command_status_complete"), patch.object(bunny, "filter_duplicate_inline_comments", side_effect=lambda _, comments: comments):
            bunny.post_review(args)
        payload = json.loads(gh.call_args.kwargs["input_text"])
        self.assertEqual(payload["commit_id"], "a" * 40)
        self.assertEqual(payload["event"], "COMMENT")

    def test_shlai_guidance_exists_and_has_no_foreign_repo_paths(self):
        repo = TOOL_DIR.parents[1]
        with patch.dict(os.environ, {"BUNNY_REVIEW_PROMPT_PATH": str(TOOL_DIR / "reviewer-prompt.md")}), patch.object(bunny, "REPO_ROOT", repo):
            guidance = bunny.select_guidance(["packages/core/src/reader/progress.ts", ".github/workflows/shlai-release.yml"])
        self.assertIn("docs/readany-shlai/code-quality.md", guidance)
        self.assertIn("docs/readany-shlai/releasing.md", guidance)
        for path in guidance:
            self.assertTrue((repo / path).is_file(), path)

    def test_fallback_summary_keeps_voice_without_claiming_a_model_pass(self):
        with patch.object(bunny, "diff_shortstat", return_value="1 file changed"):
            summary = bunny.fallback_change_summary("base", ["file.ts"])[0]
        self.assertIn("opening scene", summary)
        self.assertIn("model summary was unavailable", summary)
        self.assertNotIn("Wah", summary)


if __name__ == "__main__":
    unittest.main()
