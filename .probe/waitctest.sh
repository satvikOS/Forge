#!/usr/bin/env bash
until ! pgrep -f ctestall >/dev/null; do sleep 10; done
echo "ctest finished"
tail -22 /Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2/.probe/ctest_ab.log
