#!/usr/bin/env bash
R=/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2/forge-kernel/.build-corpus-ab/run-thicken-after
until [ ! -e /proc ] && ! pgrep -f run_corpus_ab_coverage >/dev/null; do sleep 10; done
echo "run finished, rows: $(wc -l < "$R/results.jsonl")"
tail -3 "$R/run.log"
