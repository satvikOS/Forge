#!/usr/bin/env bash
cd /Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2/forge-kernel || exit 2
SKIP_BUILD=1 FAMILIES=THICKEN,FILLING,MAKEOFFSET \
  bash test/run_corpus_ab_coverage.sh all \
  /Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2/forge-kernel/.build-corpus-ab/run-thicken-after
