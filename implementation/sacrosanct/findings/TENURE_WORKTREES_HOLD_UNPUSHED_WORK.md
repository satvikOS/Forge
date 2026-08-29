# Ten Tenure worktrees hold work that exists nowhere else

**Measured 2026-08-28.** The standing storage instruction was to clear Tenure
worktrees "as its already pushed to respective repos". For 10 of them that premise
is false, and they are the ones that look safest.

## What was checked

`~/Tenure` had 31 registered worktrees holding **13.4 GiB**. Twelve had a
completely clean tracked tree -- no modifications, no untracked files. Those are
exactly the ones a reaper classifies FINISHED.

None of the twelve had a remote branch containing its HEAD. That alone proves
nothing: a squash-merge deletes the branch, so a merged worktree and an abandoned
one look identical to `git branch -r --contains`. This repository does **not**
fetch `refs/pull/*` (`remote.origin.fetch` is `+refs/heads/*:refs/remotes/origin/*`,
0 refs under refs/pull), so the pull-ref witness that works elsewhere does not
exist here either.

So the question was put to GitHub instead: for each branch, is there a PR?

| branch | remote branch | PR |
|---|---|---|
| verify/notifications-embargo-and-containment | 0 | none |
| triage139-merge | 0 | none |
| fix/chart-axis-labels-match-their-gridlines | 0 | none |
| resolve/272, /273, /277, /280, /283 | 0 | none |
| fix/activation-review-findings | 0 | none |
| r121-merge | 0 | none |
| chore/one-model-no-chooser | 0 | **#293 MERGED** |
| feat/a-card-can-have-fields | 0 | **#292 MERGED** |

**Ten of twelve have no remote branch and no pull request of any kind.** Each is
2 to 24 commits ahead of `origin/main`. Those commits exist only in these local
worktrees, on one machine, with no off-machine copy.

## The two that were safe, and why that needed checking too

Even the two merged ones did not match their PR head sha, so "the PR merged" was
not sufficient. The direction mattered:

    tenure-wt-aimodel : 0 commits not in PR#293 head, 8 commits behind it
    tenure-wt-memory  : 0 commits not in PR#292 head, 13 commits behind it

Both are **ancestors** of what was merged -- everything they contain reached main,
and more. Those two were removed. Had the arrow pointed the other way, the
worktree would have held post-merge work and been a keep.

## Why this is the dangerous shape

A dirty worktree announces that it is unfinished. These announce the opposite: a
clean tree, a tidy branch name, a job that reads as done. Every signal a cleanup
consults says FINISHED, and the one fact that matters -- that nothing outside this
disk has a copy -- is not visible to any of them.

The 10 are kept. Nothing was deleted on a disk-pressure argument: the volume sits
at 65% used with 157 GiB free, and pressure never converts uncertainty into
deletion authority.

**Recommended, and NOT done here because it pushes branches into a shared repo:**
push the 10 branches, or delete them deliberately, one by one, with a human
deciding which. Until then they are the only copy.
