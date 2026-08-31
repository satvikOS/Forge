#!/usr/bin/env bash
set -uo pipefail
W=/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2
B="$W/.probe/build-cmake"
cmake --build "$B" -j 8 > "$W/.probe/ctest_build.log" 2>&1
echo "build rc=$?"
grep -c "error:" "$W/.probe/ctest_build.log"
cd "$B" || exit 2
ctest -R '^kernel\.ab\.' --output-on-failure > "$W/.probe/ctest_ab.log" 2>&1
echo "ctest rc=$?"
tail -25 "$W/.probe/ctest_ab.log"
