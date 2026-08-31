#!/usr/bin/env bash
# Measure run_ab_native_thicken.sh on the UNMODIFIED engine, then restore mine
# FROM A BACKUP (never from git: `git checkout --` on unstaged work reverts the
# whole edit, and this repo has already paid for that once).
set -uo pipefail
W=/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2
E="$W/forge-kernel/src/native/brep/NativeThickenShell.cpp"
B="$W/.probe/NativeThickenShell.MINE.cpp"
O="$W/.probe/NativeThickenShell.ORIG.cpp"
cp "$E" "$B" || exit 2
cd "$W" || exit 2
git show HEAD:forge-kernel/src/native/brep/NativeThickenShell.cpp > "$O" || exit 2
cp "$O" "$E" || exit 2
echo "===== BASELINE (engine as at HEAD) ====="
bash forge-kernel/test/run_ab_native_thicken.sh 2>&1 | tail -8
echo "baseline rc above"
cp "$B" "$E" || { echo "FATAL: could not restore"; exit 9; }
echo "restored: $(cmp -s "$B" "$E" && echo YES || echo NO)"
