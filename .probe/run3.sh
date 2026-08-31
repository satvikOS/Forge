#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 2
clang++ -std=c++20 -O2 -I/opt/homebrew/opt/opencascade/include/opencascade \
  signprobe.cpp -o signprobe -L/opt/homebrew/opt/opencascade/lib \
  -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKGeomAlgo \
  -lTKTopAlgo -lTKPrim -lTKBO -lTKShHealing -lTKOffset -lTKDESTEP -lTKXSBase || exit 2
: > sign.jsonl
while IFS= read -r n; do
  f="/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps/$n.step"
  ./signprobe "$f" "$n" >> sign.jsonl 2>/dev/null
done < deletion.list
wc -l sign.jsonl
