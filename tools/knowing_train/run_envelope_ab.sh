#!/usr/bin/env bash
# run_envelope_ab.sh — the envelope A/B on BenchCAD-holdout-41.
#
#   bash tools/knowing_train/run_envelope_ab.sh <adapter-dir> [out-tag]
#
# TWO ARMS, ONE VARIABLE. Arm A is the benchmark exactly as written, which hands the
# model the true three-axis envelope in text ("Measured: overall envelope about
# 22.14 x 22.14 x 64.22 mm"). Arm B is the same 41 rows with those two size sentences
# replaced by knowing_v1's own scale convention. `id`, `image`, `gt` and `gt_step` are
# byte-identical between the arms, so BOTH ARE SCORED AGAINST THE SAME GEOMETRY BY THE
# SAME KERNEL and only the prompt differs.
#
# WHY IT IS WORTH GPU TIME. No family in knowing_v1 pairs an image with a three-axis
# envelope: the image families state one scalar and let the model derive the rest, and
# the envelope families carry no image. The eval pairing exists in no training row. The
# direction of that gap is measurable rather than arguable — same score either way means
# the model is reading size off the picture and the gift is inert; better with the
# envelope means it is using the gift; worse with it means the unfamiliar text is
# displacing the image evidence, and only then is the framing gap a defect to fix.
#
# READ THE COMPONENTS, NOT THE COMPOSITE. `centred-longest` makes the 0.4 shape term
# scale-invariant, while the 0.4 interface term compares coordinates in ABSOLUTE units.
# A model that emits at longest-axis=100 against a 64 mm reference can therefore be at
# its shape ceiling and still forfeit most of interface. A composite alone hides that.
#
# NOT CHUNKED BY ACCIDENT: 35 rows per chunk, because a switch/expert-LoRA adapter emits
# token id 0 for ever from generation 41 and a fresh process is the only thing measured
# to reset it.
set -u

REPO="${FORGE_MODEL_REPO:-/Users/account_clawteam1/archdisc-Models}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO" || exit 1

ADAPTER="${1:?usage: run_envelope_ab.sh <adapter-dir> [tag]}"
TAG="${2:-envAB}"
PY="$REPO/.venv/bin/python"
BASE="models/qwen3-vl-30b-a3b-4bit"
OUT="$REPO/reports/knowing_v1"
RUN="$REPO/runs/knowing_v1_${TAG}"
VSHA="2751bc36c1cbbe5dcc1b4f9e1434a99740619bb07c79681047a6bd2e2c984320"
KSHA="3133cb258ec1eebd08f4d9377c378dd85dc20643fbd779b6e7355f2462cbde4f"
A_TASKS="data/forge/bench_tasks_benchcad.jsonl"
B_TASKS="$OUT/bench_tasks_benchcad_NOENV.jsonl"

mkdir -p "$OUT" "$RUN"
LOG="$OUT/envelope_ab.log"
say() { printf '[envAB] %s\n' "$*" | tee -a "$LOG"; }

export FORGE_PINNED_DIR="$REPO/tools/pinned"

[ -s "$B_TASKS" ] || {
  say "building the stripped arm"
  "$PY" "$HERE/make_no_envelope_tasks.py" --tasks "$A_TASKS" --out "$B_TASKS" \
        --mode rescale-framing 2>&1 | tee -a "$LOG"
}

# PROVE THE ARMS DIFFER BEFORE SPENDING A MINUTE OF GPU ON THEM. A null A/B in this
# repository has meant a broken harness more than once — "zero differences across three
# variants" was one binary compared against itself.
"$PY" - "$A_TASKS" "$B_TASKS" <<'PYEOF' 2>&1 | tee -a "$LOG"
import json, sys
a = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
b = [json.loads(l) for l in open(sys.argv[2]) if l.strip()]
assert len(a) == len(b) == 41, (len(a), len(b))
diff = sum(1 for x, y in zip(a, b) if x["user"] != y["user"])
same_ref = sum(1 for x, y in zip(a, b)
               if x["id"] == y["id"] and x["gt"] == y["gt"]
               and x["gt_step"] == y["gt_step"] and x["image"] == y["image"])
print(f"[arms] prompts differ on {diff}/41 rows; reference identical on {same_ref}/41")
if diff != 41 or same_ref != 41:
    raise SystemExit("the arms are not a clean one-variable pair — refusing to run")
PYEOF
[ "${PIPESTATUS[0]}" -eq 0 ] || { say "arm check FAILED"; exit 1; }

run_arm() {
  local name="$1" tasks="$2"
  local save="$RUN/${name}_emissions" em="$RUN/${name}_emissions.jsonl"
  local js="$OUT/${name}.composite.json"
  mkdir -p "$save"
  say "arm ${name}: emitting all 41 rows in chunks of 35"
  bash scripts/run_bench_chunked.sh 35 "$RUN/${name}_chunks" "$RUN/${name}.trace.jsonl" -- \
       --set "BenchCAD-holdout=${tasks}" \
       --model "$BASE" --adapter "$ADAPTER" \
       --max-tokens 4096 --verify-timeout 300 \
       --save-emissions "$save" >> "$LOG" 2>&1 \
    || say "arm ${name}: emitter exited non-zero; scoring whatever it emitted"

  "$PY" - "$save" "$em" <<'PYEOF'
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
n = 0
with open(dst, "w") as out:
    for fn in sorted(os.listdir(src)):
        if not fn.endswith(".json"):
            continue
        d = json.load(open(os.path.join(src, fn)))
        if not d.get("ir"):
            continue
        out.write(json.dumps({"id": d["id"], "ir": d["ir"]}) + "\n")
        n += 1
print(f"[collate] {n} emissions -> {dst}")
PYEOF

  if [ -s "$em" ]; then
    "$PY" scripts/composite_score.py --tasks "$tasks" --emissions "$em" \
          --benchmark "BenchCAD-holdout-41 (${name})" \
          --align centred-longest --grid 64 --json "$js" \
          --require-verifier-sha "$VSHA" --require-kernel-sha "$KSHA" >> "$LOG" 2>&1
    say "arm ${name}: scored -> $js"
  else
    say "arm ${name}: NO usable IR emitted — that is a result, and it is not a zero score"
  fi
}

run_arm "${TAG}_A_with_envelope" "$A_TASKS"
run_arm "${TAG}_B_no_envelope"   "$B_TASKS"

say "comparing both arms against the floor, paired, per family"
"$PY" "$HERE/compare_arms.py" \
      --floor "$REPO/reports/composite_anchor/benchcad41_envelope_centred-longest_g64.json" \
      --arm "with-envelope=$OUT/${TAG}_A_with_envelope.composite.json" \
      --arm "no-envelope=$OUT/${TAG}_B_no_envelope.composite.json" \
      --tasks "$A_TASKS" \
      --json-out "$OUT/envelope_ab.json" 2>&1 | tee -a "$LOG"
