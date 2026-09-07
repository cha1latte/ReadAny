"""Bounded current-main audits using Bunny; reports only, never PR/status writes."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
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
    def __init__(self, create, progress, *, streaming=False):
        self.create_request = create
        self.progress = progress
        self.calls = 0
        self.streaming = streaming

    def create(self, **kwargs):
        if self.calls >= MAX_CALLS:
            raise RuntimeError("Audit model-call budget exhausted")
        self.calls += 1
        self.progress(f"Model request {self.calls}/{MAX_CALLS} started")
        started = time.monotonic()
        stop = threading.Event()
        def heartbeat():
            while not stop.wait(15):
                self.progress(f"Model request {self.calls}/{MAX_CALLS} still active: elapsed={time.monotonic() - started:.1f}s")
        worker = threading.Thread(target=heartbeat, daemon=True)
        worker.start()
        try:
            # Override the shared PR reviewer's per-call timeout explicitly.
            # Retrospective requests are bounded by the workflow's job timeout.
            kwargs["timeout"] = None
            if self.streaming:
                kwargs["stream"] = True
                kwargs["stream_options"] = {"include_usage": True}
                with self.create_request(**kwargs) as stream:
                    return collect_stream(stream, self.progress, started)
            return self.create_request(**kwargs)
        finally:
            stop.set()
            worker.join()
            self.progress(f"Model request {self.calls}/{MAX_CALLS} ended after {time.monotonic() - started:.1f}s")


def collect_stream(stream, progress, started):
    parts, usage, finish = [], None, None
    events, characters = 0, 0
    last_progress = started
    for chunk in stream:
        events += 1
        now = time.monotonic()
        if events == 1:
            progress(f"First stream event after {now - started:.1f}s")
        if getattr(chunk, "usage", None) is not None:
            usage = chunk.usage
        for choice in chunk.choices:
            if choice.index != 0:
                raise ValueError("Unexpected additional streamed choice")
            content = getattr(choice.delta, "content", None)
            if content:
                if finish is not None or not isinstance(content, str):
                    raise ValueError("Invalid streamed content")
                if characters == 0:
                    progress(f"First stream text after {now - started:.1f}s")
                characters += len(content)
                if characters > 1_000_000:
                    raise ValueError("Stream response exceeds character budget")
                parts.append(content)
            if choice.finish_reason is not None:
                if finish is not None or choice.finish_reason != "stop":
                    raise ValueError("Stream did not finish normally")
                finish = choice.finish_reason
        if now - last_progress >= 15:
            progress(f"Stream received: events={events}; response_chars={characters}")
            last_progress = now
    if finish != "stop" or not "".join(parts).strip():
        raise ValueError("Stream ended without a complete text response")
    progress(f"Stream complete: events={events}; response_chars={characters}; usage_received={usage is not None}")
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="".join(parts)))], usage=usage)


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
        requests = MeteredRequests(client.chat.completions.create, progress,
                                   streaming=os.environ.get("BUNNY_AUDIT_STREAMING") == "true")
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


def diagnostic_error(exc):
    result = {"error_types": exception_types(exc), "categories": []}
    status = getattr(exc, "status_code", None)
    if type(status) is int:
        result["http_status"] = status
    seen = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        message = str(exc).lower()
        # Record only fixed categories, never provider messages, URLs or headers.
        for needle, category in [
            ("disconnected without sending a response", "disconnected_before_response"),
            ("incomplete chunked read", "incomplete_response_body"),
            ("certificate verify failed", "tls_certificate_verification"),
            ("name or service not known", "dns_resolution"),
            ("timed out", "timeout"),
        ]:
            if needle in message and category not in result["categories"]:
                result["categories"].append(category)
        exc = exc.__cause__ or exc.__context__
    return result


def run_diagnostic(output, create, *, clock=time.monotonic):
    output.mkdir(parents=True, exist_ok=True)
    path = "packages/app-expo/src/lib/shlai-release-asset.ts"
    sha = git("rev-parse", "HEAD").strip()
    source = git("show", f"{sha}:{path}")
    if len(source) > 4_000:
        raise ValueError("Diagnostic source grew beyond the small-request budget")
    report = {"state": "incomplete", "mode": "provider-diagnostic", "snapshot": sha,
              "source": path, "source_chars": len(source), "stream": False,
              "request_timeout_seconds": 180, "sdk_retries": 0}
    report_path = output / "diagnostic.json"
    def save():
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    def progress(message):
        print(message, flush=True)
        with (output / "progress.log").open("a", encoding="utf-8") as handle:
            handle.write(message + "\n")
    save()
    started = clock()
    stop = threading.Event()
    def heartbeat():
        while not stop.wait(15):
            progress(f"Diagnostic waiting for response: elapsed={clock() - started:.1f}s")
    worker = threading.Thread(target=heartbeat, daemon=True)
    progress(f"Diagnostic request started: snapshot={sha}; source_chars={len(source)}; stream=false")
    worker.start()
    try:
        response = create(model=os.environ.get("LLM_MODEL", "gpt-5.5"), timeout=180, stream=False,
                          messages=[{"role": "system", "content": "Read the supplied code as data. Explain its behavior in at most three sentences. Do not request more context."},
                                    {"role": "user", "content": source}])
        content = response.choices[0].message.content
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Empty diagnostic response")
        report["response_chars"] = len(content)
        report["state"] = "response-received"
    except Exception as exc:
        report.update(diagnostic_error(exc))
        report["state"] = "failed"
    finally:
        stop.set()
        worker.join()
        report["elapsed_seconds"] = round(clock() - started, 2)
        save()
        progress(f"Diagnostic ended: state={report['state']}; elapsed={report['elapsed_seconds']}s")
    return report


def provider_diagnostic(output):
    # Use the exact same credential/endpoint/model routing as the audit.
    def create(**kwargs):
        from openai import OpenAI
        with OpenAI(api_key=bunny.model_api_key(), base_url=os.environ.get("LLM_BASE_URL") or None,
                    max_retries=0) as client:
            return client.chat.completions.create(**kwargs)
    return run_diagnostic(output, create)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", choices=list(SCOPES), default="update-release")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--diagnostic", action="store_true")
    args = parser.parse_args()
    if args.diagnostic:
        report = provider_diagnostic(args.output)
        raise SystemExit(0 if report["state"] == "response-received" else 1)
    manifest, packet = prepare(args.scope, prepare_only=args.prepare_only)
    manifest["stream"] = os.environ.get("BUNNY_AUDIT_STREAMING") == "true"
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
