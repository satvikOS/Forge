#!/usr/bin/env bash
BIN=/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2/forge-kernel/.build-corpus-ab/corpus_ab_coverage
D=/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps
for n in "$@"; do
  "$BIN" "$D/$n.step" --name="$n" --families=THICKEN --arm-timeout=20 --part-timeout=120
done
