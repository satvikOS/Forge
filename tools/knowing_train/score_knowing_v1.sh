#!/usr/bin/env bash
# score_knowing_v1.sh — score one adapter on BenchCAD-holdout-41, honestly.
#
#   bash tools/knowing_train/score_knowing_v1.sh [ADAPTER_DIR]
#
# ORDER MATTERS AND EACH STEP GATES THE NEXT:
#
#   1. PROVE THE ADAPTER LOADS.   An adapter can be silently not-applied and still
#      report plausible numbers; that cost this repository a whole wrong conclusion
#      ("v4a collapse", composite 0.0210 against a 0.3174 baseline, which was a
#      mis-loaded adapter and not a model result). Nothing is scored until the proof
#      passes: config describes the weights, the modules exist in the built graph, the
#      file's numbers are IN that graph (max|delta| 0), and neutralising the adapter
#      CHANGES the output.
#
#   2. SCORE ALL 41 ROWS.   Via the repo's own sweep, which pins the verifier, refuses
#      a floor measured by a different binary, and chunks the arm at 35 rows because a
#      switch/expert-LoRA adapter emits token id 0 for ever from generation 41.
#      The holdout is sorted HARDEST-FIRST — a prefix reads 0.2423 where the full set
#      reads 0.3617 — so a partial run is not a sample and is not reported.
#
#   3. RE-SCORE THE INCUMBENT UNDER THE SAME PIN.   astra-v1's published 0.2394 was
#      measured by verifier 45e9ad9a, which FABRICATES (BANANA(1,1,1) returns a valid
#      1x1x1 solid), and the pin has since moved. Its persisted IR is on disk, so the
#      incumbent is re-scored from the same emissions under THIS binary. Comparing my
#      number to a number from another kernel would not be a comparison.
#
#   4. COMPARE, PAIRED, PER FAMILY, WITH AN INTERVAL CLUSTERED ON FAMILIES.
set -u

REPO="${FORGE_MODEL_REPO:-/Users/account_clawteam1/archdisc-Models}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO" || exit 1

ADAPTER="${1:-adapters/archie-30b-knowing-v1}"
PY="$REPO/.venv/bin/python"
BASE="models/qwen3-vl-30b-a3b-4bit"
TASKS="data/forge/bench_tasks_benchcad.jsonl"
OUTDIR="$REPO/reports/knowing_v1"
VSHA="2751bc36c1cbbe5dcc1b4f9e1434a99740619bb07c79681047a6bd2e2c984320"
KSHA="3133cb258ec1eebd08f4d9377c378dd85dc20643fbd779b6e7355f2462cbde4f"
FLOOR="$REPO/reports/composite_anchor/benchcad41_envelope_centred-longest_g64.json"
ASTRA_EMISSIONS="$REPO/runs/sweep_20260910T220154/BenchCAD-holdout-41_emissions.jsonl"

mkdir -p "$OUTDIR"
LOG="$OUTDIR/score.log"
say() { printf '[score] %s\n' "$*" | tee -a "$LOG"; }

[ -d "$ADAPTER" ] || { say "FATAL: no adapter at $ADAPTER"; exit 1; }
ls "$ADAPTER"/*.safetensors >/dev/null 2>&1 \
  || { say "FATAL: no weights in $ADAPTER — a sweep there would silently score the BASE"; exit 1; }

wait_for_box() {
  while pgrep -f "[Pp]ython[^ ]* (scripts/|tools/knowing_train/)(lora_eager_rope|launch_vlm_expert_lora)[.]py" >/dev/null 2>&1 \
     || pgrep -f "qwen3-vl-30b-a3b-4bit" >/dev/null 2>&1; do
    say "LAW 7: a model job is resident — waiting"
    sleep 60
  done
}

# --- 1. proof ---------------------------------------------------------------- #
wait_for_box
say "STEP 1 — proving the adapter is loaded"
"$PY" "$HERE/prove_adapter_loaded.py" "$BASE" "$ADAPTER" \
      --tasks "$TASKS" --row 0 --max-tokens 48 \
      --json-out "$OUTDIR/adapter_loaded_proof.json" 2>&1 | tee -a "$LOG"
# ${PIPESTATUS[0]} is the proof's status; $? would be tee's, which is always 0.
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  say "ADAPTER-LOADED PROOF FAILED — refusing to score. A number from an unloaded"
  say "adapter is not a worse number, it is a different experiment."
  exit 2
fi

# --- 2. the model arm, all 41 rows ------------------------------------------- #
wait_for_box
say "STEP 2 — sweep on BenchCAD-holdout-41 (all 41 rows, chunked at 35)"
bash scripts/sweep_all_benchmarks.sh "$ADAPTER" --only BenchCAD-holdout-41 2>&1 | tee -a "$LOG"
SWEEP_DIR="$(ls -dt "$REPO"/reports/sweep_* 2>/dev/null | head -1)"
say "sweep wrote $SWEEP_DIR"
MINE="$SWEEP_DIR/BenchCAD-holdout-41.composite.json"
[ -s "$MINE" ] || { say "FATAL: the sweep produced no composite JSON"; exit 3; }

# --- 3. the incumbent, re-scored under THIS pin ------------------------------- #
ASTRA_JSON="$OUTDIR/astra_v1_rescored_currentpin.json"
if [ ! -s "$ASTRA_JSON" ]; then
  wait_for_box
  say "STEP 3 — re-scoring astra-v1's persisted IR under pin ${VSHA:0:8}"
  FORGE_PINNED_DIR="$REPO/tools/pinned" "$PY" scripts/composite_score.py \
      --tasks "$TASKS" --emissions "$ASTRA_EMISSIONS" \
      --benchmark "BenchCAD-holdout-41 (astra-v1, re-scored under this pin)" \
      --align centred-longest --grid 64 --json "$ASTRA_JSON" \
      --require-verifier-sha "$VSHA" --require-kernel-sha "$KSHA" 2>&1 | tee -a "$LOG"
else
  say "STEP 3 — reusing $ASTRA_JSON"
fi

# --- 4. the comparison -------------------------------------------------------- #
say "STEP 4 — paired comparison, per family, family-clustered interval"
"$PY" "$HERE/compare_arms.py" \
      --floor "$FLOOR" \
      --arm "knowing-v1=$MINE" \
      --arm "astra-v1=$ASTRA_JSON" \
      --tasks "$TASKS" \
      --json-out "$OUTDIR/comparison.json" 2>&1 | tee -a "$LOG"

say "DONE. artefacts in $OUTDIR and $SWEEP_DIR"
