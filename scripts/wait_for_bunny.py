"""Gate Preview APK builds on the trusted Bunny status for this exact PR head."""

import json
import os
from pathlib import Path
import re
import subprocess
import time


def github_api(path):
    result = subprocess.run(["gh", "api", path], check=True, capture_output=True, text=True, timeout=30)
    return json.loads(result.stdout)


def current_pr(pr, sha):
    return (pr.get("state") == "open" and not pr.get("draft", True)
            and pr.get("head", {}).get("sha") == sha
            and pr.get("base", {}).get("ref") == "main")


def bunny_state(response, sha, repository):
    if response.get("sha") != sha:
        return "pending"
    for status in response.get("statuses", []):
        if status.get("context") != "Bunny Review":
            continue
        creator = status.get("creator", {})
        if creator.get("login") != "github-actions[bot]" or creator.get("type") != "Bot":
            return "pending"
        prefix = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{repository}/actions/runs/"
        if not str(status.get("target_url", "")).startswith(prefix):
            return "pending"
        # Draft reviews may be green even with blocking findings. Wait for the
        # non-draft review dispatched by ready_for_review instead.
        if str(status.get("description", "")).startswith("Draft review"):
            return "pending"
        return status.get("state", "pending")
    return "pending"


def wait_for_bunny(repository, number, sha, *, api=github_api,
                   clock=time.monotonic, sleep=time.sleep, timeout=1800):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid repository")
    if not re.fullmatch(r"[1-9][0-9]*", str(number)) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("A PR number and full head SHA are required")
    pr_path = f"repos/{repository}/pulls/{number}"
    start = clock()
    while True:
        if not current_pr(api(pr_path), sha):
            print("No APK: PR is draft, closed, retargeted, or no longer matches this checkout.", flush=True)
            return False
        state = bunny_state(api(f"repos/{repository}/commits/{sha}/status"), sha, repository)
        elapsed = int(clock() - start)
        print(f"Bunny Review for {sha[:8]}: {state}; elapsed {elapsed}s (limit {timeout}s).", flush=True)
        if state == "success":
            # Close the head-change race while the status request was in flight.
            return current_pr(api(pr_path), sha)
        if state in {"failure", "error"}:
            print("No APK: Bunny has not approved this commit.", flush=True)
            return False
        if clock() - start >= timeout:
            raise TimeoutError("Bunny did not turn green. Request a review, then rerun this workflow.")
        sleep(min(20, max(0, timeout - (clock() - start))))


def main():
    approved = wait_for_bunny(os.environ["GITHUB_REPOSITORY"], os.environ["PR_NUMBER"], os.environ["PR_HEAD_SHA"])
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        output.write(f"approved={str(approved).lower()}\n")


if __name__ == "__main__":
    main()
