"""Bounded current-main audits using Bunny; reports only, never PR/status writes."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("retrospective_bunny", HERE / "bunny_review.py")
bunny = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bunny
spec.loader.exec_module(bunny)
# This is a separately loaded Bunny module; regular PR reviews retain their limits.
bunny.MAX_CONTEXT_FILES = 2
bunny.MAX_CONTEXT_SEARCHES = 1
bunny.MAX_CONTEXT_CHARS = 20_000
bunny.MAX_CONTEXT_FILE_CHARS = 10_000
MAX_PACKET = 120_000
UPDATE_MAX_PACKET = 65_000
MAX_CALLS = 8
SCOPES = json.loads((HERE / "retrospective-scopes.json").read_text("utf-8"))


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True,
                          text=True, encoding="utf-8", timeout=30).stdout


def prepare(scope_name, *, prepare_only=False):
    scope = SCOPES[scope_name]
    sha = git("rev-parse", "HEAD").strip()
    # Live context retrieval reads the checkout: it must match the pinned source.
    if not prepare_only and git("status", "--porcelain", "--untracked-files=no").strip():
        raise ValueError("Audit requires a clean tracked checkout; use a separate checkout for preparation.")
    sections = [f"Current snapshot: {sha}\nPurpose: {scope['purpose']}\n"
                f"Historical PRs for orientation only: {scope['prs']}. "
                "Only defects still present in this snapshot are eligible.\n"
                "The synthetic added lines below represent current audit scope, not a historical change. "
                "Use actual current file line numbers. Do not claim these files were newly added."]
    allowed = {}
    for path in scope["files"]:
        source = git("show", f"{sha}:{path}")
        lines = source.splitlines()
        allowed[path] = len(lines)
        sections.append(f"diff --git a/{path} b/{path}\n--- /dev/null\n+++ b/{path}\n"
                        f"@@ -0,0 +1,{len(lines)} @@\n" + "\n".join("+" + line for line in lines))
    for path in bunny.select_guidance(scope["files"]):
        sections.append(f"Guidance: {path}\n" + bunny.read_text(path, 6_000))
    sections.append(bunny.matching_path_rules(scope["files"]))
    # Recent history identifies subsequent fixes without using historical code as truth.
    sections.append("Recent scoped history:\n" + git("log", "-15", "--format=%h %s", "--", *scope["files"]))
    packet = bunny.redact_for_model("\n\n".join(sections))
    limit = min(MAX_PACKET, UPDATE_MAX_PACKET) if scope_name.startswith("update-") else MAX_PACKET
    if len(packet) > limit:
        raise ValueError(f"Scope is {len(packet)} characters; split it before running (limit {limit}).")
    return {"snapshot": sha, "scope": scope_name, "prs": scope["prs"],
            "files": allowed, "packet_chars": len(packet), "packet_limit": limit,
            "extra_context_limit": bunny.MAX_CONTEXT_CHARS}, packet


class MeteredRequests:
    def __init__(self, create, progress):
        self.create_request = create
        self.progress = progress
        self.calls = 0

    def create(self, **kwargs):
        if self.calls >= MAX_CALLS:
            raise RuntimeError("Audit model-call budget exhausted")
        self.calls += 1
        self.progress(f"Model request {self.calls}/{MAX_CALLS} started")
        started = time.monotonic()
        try:
            # Override the shared PR reviewer's per-call timeout explicitly.
            # Retrospective requests are bounded by the workflow's job timeout.
            kwargs["timeout"] = None
            return self.create_request(**kwargs)
        finally:
            self.progress(f"Model request {self.calls}/{MAX_CALLS} ended after {time.monotonic() - started:.1f}s")


def exception_types(exc):
    # Preserve diagnostic cause types without logging URLs, credentials or provider bodies.
    result, seen = [], set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        result.append(type(exc).__name__)
        exc = exc.__cause__ or exc.__context__
    return result


def validate_candidates(review, files):
    gaps = bunny.review_contract_gaps(review)
    if gaps or review.get("_schema_repair_remaining_gaps") or review.get("_schema_repair_error"):
        raise ValueError("Incomplete review schema")
    candidates, rejected = [], []
    for item in review["findings"]:
        if (not isinstance(item, dict) or item.get("path") not in files
                or type(item.get("line")) is not int
                or not 1 <= item["line"] <= files[item["path"]]
                or not item.get("title") or not item.get("body")):
            rejected.append(item)
        else:
            candidates.append(item)
    return candidates, rejected


def execute(manifest, packet, output, review_call):
    output.mkdir(parents=True, exist_ok=True)
    def progress(message):
        line = f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {message}"
        print(line, flush=True)
        with (output / "progress.log").open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    report = {**manifest, "state": "incomplete", "candidates": []}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (output / "packet.txt").write_text(packet, encoding="utf-8")
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    progress(f"Audit started: scope={manifest['scope']} snapshot={manifest['snapshot']}")
    try:
        review = review_call(packet, progress)
        report["review"] = review
        report["candidates"], report["rejected_locations"] = validate_candidates(review, manifest["files"])
        report["state"] = "needs-triage" if report["candidates"] else "no-candidates"
        if (report["rejected_locations"] or review.get("review_state")
                or any(check.get("status") in {"fail", "failure", "unknown"}
                       for check in review["pre_merge_checks"] if isinstance(check, dict))):
            report["state"] = "incomplete"
    except Exception as exc:
        report["error_types"] = exception_types(exc)
        progress("Review failed: " + " -> ".join(report["error_types"]))
    finally:
        (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        lines = [f"# Bunny retrospective: {manifest['scope']}",
                 f"Snapshot: `{manifest['snapshot']}`", f"Result: **{report['state']}**",
                 "Model candidates require reproduction on current main. This is not a merge approval or a clean-code certificate."]
        for item in report["candidates"]:
            lines.extend([f"## {item['title']}", f"`{item['path']}:{item['line']}`", item["body"],
                          "Triage: pending reproduction; check existing issues and later fixes before filing."])
        if report.get("error_types"):
            lines.append("Failure chain: " + " -> ".join(report["error_types"]))
        (output / "report.md").write_text("\n\n".join(lines) + "\n", encoding="utf-8")
        progress(f"Audit ended: {report['state']}")
    return report


def live_review(packet, progress):
    from openai import OpenAI
    key = bunny.model_api_key()
    if not key:
        raise RuntimeError("Missing model credential")
    with OpenAI(api_key=key, base_url=os.environ.get("LLM_BASE_URL") or None, max_retries=0) as client:
        requests = MeteredRequests(client.chat.completions.create, progress)
        measured = SimpleNamespace(chat=SimpleNamespace(completions=requests))
        stats = bunny.build_stats(packet)
        try:
            return bunny.three_pass_review(measured, bunny.review_prompt(),
                "Retrospective audit of the current snapshot, not a PR merge decision. "
                "Treat the synthetic patch as the eligible scope. Require a concrete current failure, "
                "trigger, impact and proposed regression test in each finding. Do not report historical "
                "bugs fixed in this snapshot, stylistic nitpicks, or missing tests alone. "
                "Read adjacent callers/tests with the existing bounded context request when needed. "
                "Request at most two extra files and one literal search; extra context is limited "
                "to 20,000 characters total and 10,000 per file. Stay within this chunk's purpose. "
                "Never claim reproduction or test execution: this run only reads source.\n\n" + packet, stats)
        finally:
            bunny.print_telemetry(stats)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", choices=list(SCOPES), default="update-release")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    manifest, packet = prepare(args.scope, prepare_only=args.prepare_only)
    if args.prepare_only:
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        (args.output / "packet.txt").write_text(packet, encoding="utf-8")
        print(json.dumps(manifest), flush=True)
        return
    report = execute(manifest, packet, args.output, live_review)
    if report["state"] == "incomplete":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
