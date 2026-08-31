#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 2
clang++ -std=c++20 -O2 -I/opt/homebrew/opt/opencascade/include/opencascade \
  cylcert.cpp -o cylcert -L/opt/homebrew/opt/opencascade/lib \
  -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKGeomAlgo \
  -lTKTopAlgo -lTKPrim -lTKBO -lTKShHealing -lTKDESTEP -lTKXSBase || exit 2
: > cylcert.jsonl
for f in /Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps/*.step; do
  n="$(basename "$f" .step)"
  ./cylcert "$f" "$n" >> cylcert.jsonl 2>/dev/null
done
wc -l cylcert.jsonl
