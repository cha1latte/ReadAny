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
        voice = {"character": "Test", "captions": {"summary_prefix": "Configured summary:", "summary_unavailable": "The model summary was unavailable."}}
        with patch.object(bunny, "load_voice", return_value=voice), patch.object(bunny, "diff_shortstat", return_value="1 file changed"):
            summary = bunny.fallback_change_summary("base", ["file.ts"])[0]
        self.assertIn("Configured summary:", summary)
        self.assertIn("model summary was unavailable", summary)

    def test_checked_in_voice_configuration_is_valid(self):
        voice = bunny.load_voice()
        self.assertTrue(voice["character"].strip())

    def test_character_swap_reaches_all_model_passes_and_rendered_captions(self):
        voice_path = self.root / "voice.json"
        voice_path.write_text(json.dumps({
            "character": "GLaDOS", "instructions": ["Use dry technical wit."],
            "captions": {"summary_heading": "Test Results"},
        }), encoding="utf-8")
        review = {"change_summary": ["The PR updates review documentation."]}
        with patch.object(bunny, "VOICE_PATH", voice_path), patch.object(bunny, "model_call", return_value="FINAL_REVIEW {}") as model, patch.object(bunny, "extract_json_or_repair", return_value=review), patch.object(bunny, "commit_subject", return_value="fixture"), contextlib.redirect_stdout(io.StringIO()):
            prompt = bunny.review_prompt()
            bunny.three_pass_review(None, prompt, "Diff fixture", {})
            body = bunny.render_walkthrough(review, [], [], [], "", "a" * 40)
            self.assertEqual(bunny.caption("completed"), bunny.DEFAULT_CAPTIONS["completed"])
        self.assertEqual(model.call_count, 3)
        for call in model.call_args_list:
            system = call.args[1][0]["content"]
            self.assertIn("Character: GLaDOS", system)
            self.assertIn("Use dry technical wit.", system)
            self.assertIn("blocking|high|medium|low", system)
            self.assertNotIn("Ghostface", system)
        self.assertIn("Test Results", body)
        self.assertIn("Bunny Merge Signal: Ready", body)
        self.assertIn(bunny.BUNNY_MARKER, body)
        self.assertNotIn("Scene", body)
        self.assertNotIn("loose ends", body)

    def test_invalid_voice_configuration_is_rejected(self):
        voice_path = self.root / "voice.json"
        invalid = [
            [], {"character": ""}, {"character": "Test\nInjected heading"},
            {"character": "Test", "instructions": "not an array"},
            {"character": "Test", "examples": [123]},
            {"character": "Test", "unknown": "typo"},
            {"character": "Test", "captions": {"unknown": "typo"}},
            {"character": "Test", "captions": {"completed": "line one\nline two"}},
        ]
        for config in invalid:
            voice_path.write_text(json.dumps(config), encoding="utf-8")
            with self.subTest(config=config), patch.object(bunny, "VOICE_PATH", voice_path), self.assertRaises(ValueError):
                bunny.load_voice()

    def test_voice_comes_from_executing_tooling_not_pr_working_directory(self):
        original = bunny.load_voice()
        untrusted = self.root / ".github" / "bunny-review"
        untrusted.mkdir(parents=True)
        (untrusted / "voice.json").write_text('{"character":"Untrusted override"}', encoding="utf-8")
        with patch.object(bunny, "REPO_ROOT", self.root), patch.dict(os.environ, {"BUNNY_REVIEW_PROMPT_PATH": str(untrusted / "reviewer-prompt.md")}):
            self.assertEqual(bunny.load_voice(), original)


if __name__ == "__main__":
    unittest.main()
