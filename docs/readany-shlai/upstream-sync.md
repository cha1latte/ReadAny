# Synchronizing ReadAny Shlai with official ReadAny

The **Shlai Upstream Sync** workflow runs every Monday at 13:17 UTC. It can also be started manually from the Actions page with **Run workflow**.

It fetches `codedogQBY/ReadAny:main` and opens at most one pull request whose title begins `Sync official ReadAny upstream`. If the fork already contains official `main`, an identically titled sync PR is already open, or that day's sync branch already exists, it exits without changing the fork.

The sync branch starts at official `main`; it is pushed to the fork and opened as a visible pull request against fork `main`. The workflow never merges or auto-merges that pull request. GitHub makes any conflict visible for a human to resolve and review.

## Resolve a sync conflict

Fetch the pushed sync branch, then merge the current fork `main` into it locally. Use these commands exactly, replacing the example branch only when the workflow chose a different date:

```powershell
git fetch origin
git switch sync/upstream-2026-08-15
git merge origin/main
pnpm --filter @readany/core test
pnpm --filter @readany/app-expo test
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
git push origin sync/upstream-2026-08-15
```

Resolve conflicts deliberately before running the checks. The push updates the same visible sync pull request; review its preview APK and approve it through the normal pull-request process. Do not merge it from the workflow or enable auto-merge.

## Preservation rules

During conflict resolution, preserve the ReadAny Shlai Android identities, package names, schemes, version metadata, release workflows, protected signing boundary, Shlai branding, and fork/upstream GPL attribution. Keep the fork-specific preview and stable release behavior even when official files have changed.

When a Shlai-specific fix has been accepted upstream, remove the fork-side copy only after that upstream commit arrives on a branch created by this synchronization path and its visible sync pull request is reviewed. Do not delete or overwrite Shlai work merely because a similar upstream change exists elsewhere.
