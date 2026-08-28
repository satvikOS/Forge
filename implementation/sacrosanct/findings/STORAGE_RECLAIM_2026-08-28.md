# Storage reclaim, 2026-08-28: 47 GiB -> 109 GiB free

The data volume was at **90% (391 GiB used, 47 GiB free)**. It is now at **109 GiB free**, with
**102 worktrees and build directories removed** and **40 kept** because they hold work that is
not safe to lose.

## The rule every deletion had to satisfy

A worktree was removed ONLY with positive evidence of both:

1. `git status --porcelain` **empty** (nothing uncommitted), and
2. its HEAD **reachable from a pushed remote ref**, proved per tree with
   `git branch -r --contains <head>` (or `merge-base --is-ancestor` against a named ref).

Anything failing either test was kept. A check that could not run was treated as a failure.

**Removing a worktree is not deleting a branch.** A local checkout is disposable once its
commits exist on a remote; that is what made most of this safe rather than risky.

## What was reclaimed

| root | removed | reclaimed |
| --- | --- | --- |
| my own session scratch worktrees (`/private/tmp/fv*`, `ir_gate`, ...) | 8 | 4.4 GiB |
| reproducible build dirs (`tkdrop`, `ir_app`, `forge_app_build`, ...) | 7 | (in the above) |
| `archdisc-Mech/.claude/worktrees` | 10 | 4.4 GiB |
| `~/Tenure` worktrees (parent: Tenurework/Tenure) | 38 | 25.0 GiB |
| `~/tenure-parent-wt7` worktrees (parent: Tenurework/Tenure-Parent) | 39 | 29.8 GiB |
| **total** | **102** | **~62 GiB** |

## Three worktrees were PUSHED before being removed

`align-op`, `fix/ft-unknown-op-fail-closed` and `worktree-wf_41f62d36-39b-1` were clean but
their HEADs were on **no remote ref at all** -- deleting them would have stranded the commits,
including the TKOffset drop at `8d4e7130`. Each branch was pushed first, the witness was
**re-verified after the push**, and only then was the worktree removed. Pushing costs nothing
and converts local disk into a permanent remote ref.

## What was kept, and why

**40 worktrees** remain: 34 under `~/Tenure` and 6 under `~/tenure-parent-wt7`, plus
`/private/tmp/fv_stoi` (which holds the `forge_verify` binary a running job was using) and the
Mech trees carrying uncommitted work.

The keep reasons are uncommitted files (`dirty=1..110`) or `remote_refs=0`. Several have only
one dirty file and may well be disposable -- but "probably nothing" is not evidence, and the
cost of being wrong is unrecoverable while the cost of keeping is a gigabyte.

## Regenerating the enlarged eval split

`data/` is gitignored in archdisc-Models and `holdout_true.jsonl` is not tracked either, so eval
splits are regenerated rather than versioned:

```
cd ~/archdisc-Models
FORGE_VERIFY=<path-to-forge_verify> .venv/bin/python scripts/make_holdout_tasks.py \
    --corpus data/forge/ft_decomp_gt_corpus --split valid \
    --out data/forge/holdout_enlarged_600.jsonl --limit 600 \
    --exclude-train data/forge/expert3d_v1_clean/train.jsonl
```

Produced **600 tasks**, dropping `{"seen-in-training": 56, "gold-unmeasurable": 129}` from 1368,
gold tree ops p50=27 max=36. Ground truth is MEASURED through the kernel, not trusted from the
row. Registered ACTIVE in `HOLDOUT_REGISTRY` (archdisc-Models `1bc249c83`).

Verified three ways: the builder dropped exactly the 56 rows measured by hand; R9 scanning the
result reports 0 contaminated across 600; and re-scanning the 16,671-row training corpus against
the enlarged registry reports 0.
