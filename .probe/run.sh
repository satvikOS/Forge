#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 2
: > census.jsonl
for f in /Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps/*.step; do
  n="$(basename "$f" .step)"
  ./srfcensus "$f" "$n" >> census.jsonl 2>/dev/null
done
wc -l census.jsonl
