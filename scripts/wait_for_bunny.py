"""Gate Preview APK builds on the trusted Bunny status for this exact PR head."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlencode, urlsplit


def github_api(path):
    result = subprocess.run(["gh", "api", path], check=True, capture_output=True, text=True, timeout=30)
    return json.loads(result.stdout)


def latest_retarget(repository, number):
    owner, name = repository.split("/")
    query = """query($owner:String!,$name:String!,$number:Int!){
      repository(owner:$owner,name:$name){pullRequest(number:$number){
        timelineItems(last:1,itemTypes:[BASE_REF_CHANGED_EVENT]){
          nodes{... on BaseRefChangedEvent{id}}
        }
      }}
    }"""
    result = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={query}", "-f", f"owner={owner}",
         "-f", f"name={name}", "-F", f"number={number}"],
        check=True, capture_output=True, text=True, timeout=30)
    nodes = json.loads(result.stdout)["data"]["repository"]["pullRequest"]["timelineItems"]["nodes"]
    return nodes[-1]["id"] if nodes else "none"


def review_context(pr, number, retarget):
    base = pr.get("base", {})
    head = pr.get("head", {}).get("sha", "")
    if (base.get("ref") != "main" or not re.fullmatch(r"[0-9a-f]{40}", base.get("sha", ""))
            or not re.fullmatch(r"[0-9a-f]{40}", head) or not retarget):
        raise ValueError("A main base SHA, head SHA and retarget history are required")
    return urlencode({"pr": str(number), "head": head, "base": base["sha"], "retarget": retarget})


def capture_review_context(repository, number, head, base, *, api=github_api, retarget=latest_retarget):
    pr = api(f"repos/{repository}/pulls/{number}")
    if pr.get("head", {}).get("sha") != head or pr.get("base", {}).get("sha") != base:
        raise ValueError("PR revisions changed before the review started")
    return review_context(pr, number, retarget(repository, number))


def current_pr(pr, sha):
    return (pr.get("state") == "open" and not pr.get("draft", True)
            and pr.get("head", {}).get("sha") == sha
            and pr.get("base", {}).get("ref") == "main")


def bunny_state(response, sha, repository, context):
    if response.get("sha") != sha:
        return "pending"
    for status in response.get("statuses", []):
        if status.get("context") != "Bunny Review":
            continue
        creator = status.get("creator", {})
        if creator.get("login") != "github-actions[bot]" or creator.get("type") != "Bot":
            return "pending"
        prefix = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{repository}/actions/runs/"
        url = str(status.get("target_url", ""))
        if not url.startswith(prefix) or urlsplit(url).fragment != context:
            return "pending"
        # Draft reviews may be green even with blocking findings. Wait for the
        # non-draft review dispatched by ready_for_review instead.
        if str(status.get("description", "")).startswith("Draft review"):
            return "pending"
        return status.get("state", "pending")
    return "pending"


def wait_for_bunny(repository, number, sha, *, api=github_api,
                   clock=time.monotonic, sleep=time.sleep, timeout=1800, retarget=latest_retarget):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid repository")
    if not re.fullmatch(r"[1-9][0-9]*", str(number)) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("A PR number and full head SHA are required")
    pr_path = f"repos/{repository}/pulls/{number}"
    start = clock()
    while True:
        pr = api(pr_path)
        if not current_pr(pr, sha):
            print("No APK: PR is draft, closed, retargeted, or no longer matches this checkout.", flush=True)
            return False
        context = review_context(pr, number, retarget(repository, number))
        # The combined /status endpoint omits creator; the status list includes it.
        statuses = api(f"repos/{repository}/commits/{sha}/statuses")
        state = bunny_state({"sha": sha, "statuses": statuses}, sha, repository, context)
        elapsed = int(clock() - start)
        print(f"Bunny Review for {sha[:8]}: {state}; elapsed {elapsed}s (limit {timeout}s).", flush=True)
        if state == "success":
            # Recheck head, base and retarget history after the status request.
            latest = api(pr_path)
            return (current_pr(latest, sha) and context ==
                    review_context(latest, number, retarget(repository, number)))
        if state in {"failure", "error"}:
            print("No APK: Bunny has not approved this commit.", flush=True)
            return False
        if clock() - start >= timeout:
            raise TimeoutError("Bunny did not turn green. Request a review, then rerun this workflow.")
        sleep(min(20, max(0, timeout - (clock() - start))))


def main():
    if sys.argv[1:] == ["--review-context"]:
        context = capture_review_context(os.environ["GITHUB_REPOSITORY"], os.environ["PR_NUMBER"],
                                         os.environ["PR_HEAD_SHA"], os.environ["PR_BASE_SHA"])
        with Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf-8") as output:
            output.write(f"BUNNY_APPROVAL_CONTEXT={context}\n")
        return
    approved = wait_for_bunny(os.environ["GITHUB_REPOSITORY"], os.environ["PR_NUMBER"], os.environ["PR_HEAD_SHA"])
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        output.write(f"approved={str(approved).lower()}\n")


if __name__ == "__main__":
    main()
