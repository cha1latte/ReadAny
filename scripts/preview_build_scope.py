"""Decide whether a diff needs an APK. Unknown paths and manual runs build."""

import os
from pathlib import Path
import re
import subprocess


AUTOMATION_FILES = {
    "AGENTS.md",
    ".gitignore",
    ".github/workflows/bunny-review.yml",
    ".github/workflows/bunny-review-auto.yml",
    ".github/workflows/bunny-review-command.yml",
    ".github/workflows/shlai-pr.yml",
    ".github/workflows/shlai-phone-release.yml",
    "scripts/preview_build_scope.py",
    "scripts/test_preview_build_scope.py",
    "scripts/wait_for_bunny.py",
    "packages/app-expo/src/config/shlai-workflows.test.ts",
    "scripts/test_wait_for_bunny.py",
}


def needs_apk(paths):
    for path in paths:
        if path in AUTOMATION_FILES:
            continue
        if path.startswith(".github/bunny-review/"):
            continue
        if path.startswith("docs/") and path.endswith(".md"):
            continue
        return True
    return False


def changed_paths(base, head):
    for sha in (base, head):
        if not re.fullmatch(r"[0-9a-f]{40}", sha) or sha == "0" * 40:
            raise ValueError("Diff endpoints must be nonzero commit SHAs")
    # Disable rename detection so both old and new paths count. A renamed app
    # source file must not disappear behind a new documentation filename.
    result = subprocess.run(
        ["git", "diff", "--no-renames", "--name-only", "-z", base, head, "--"],
        check=True, capture_output=True,
    )
    return [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]


def main():
    required = True
    reason = "Manual or unknown event: build the APK."
    if os.environ.get("GITHUB_EVENT_NAME") in {"pull_request", "push"}:
        try:
            paths = changed_paths(os.environ.get("BASE_SHA", ""), os.environ.get("HEAD_SHA", ""))
            required = needs_apk(paths)
            reason = (
                "App, dependency, or other build-relevant paths changed."
                if required else "Only Bunny/preview CI tooling or Markdown documentation changed."
            )
        except (ValueError, subprocess.CalledProcessError):
            reason = "Diff could not be established: build the APK."
    output = f"apk_required={str(required).lower()}\n"
    print(output.strip())
    print(reason)
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as handle:
            handle.write(output)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as handle:
            handle.write(f"### Preview build scope\n\n{reason}\n")


if __name__ == "__main__":
    main()
