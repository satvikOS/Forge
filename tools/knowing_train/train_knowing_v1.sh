#!/usr/bin/env bash
# train_knowing_v1.sh — train archie-30b-knowing-v1, restartably.
#
#   bash tools/knowing_train/train_knowing_v1.sh [TOTAL_ITERS] [OUT_SUFFIX] [MAX_ATTEMPTS]
#
# RESTARTABLE means: if this dies at iteration 4,312 of 8,000 — and on this box it does,
# see below — running the same command again continues from the newest checkpoint rather
# than starting over, and this script retries by itself.
#
# WHY IT DIES. Measured 2026-09-14, in this repo, by me: I started a CPU scoring job
# (composite_score.py, which forks the pinned kernel) beside a training run that peaks at
# 24.7 GB on a 36 GB box. Swap went 2 GB -> 36 GB in ninety seconds and the trainer died
# with
#     [METAL] Command buffer execution failed: Insufficient Memory
#         (00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory)
# LAW 7 is not a formality and the guard below now also watches the kernel, not just the
# trainers. Twelve minutes of GPU work were lost; at 8,000 iterations it would have been
# seven hours.
#
# THREE THINGS THE RESUME PATH NEEDS, each of which is silently wrong without it:
#   * adapter_config.json — mlx_vlm cannot resume without one and does not write one.
#     It is DERIVED FROM THE TENSORS here, never copied from another adapter: copying a
#     config that describes different weights is what made v4a's first score (0.0210)
#     not a result at all.
#   * the switch layers — `_to_lora` raises on QuantizedSwitchLinear, so without
#     expert_lora_patch a resumed run drops every expert tensor. The launcher installs it.
#   * a freeze — mlx_vlm's resume branch freezes NOTHING and would train the layer norms
#     and the whole vision tower. The launcher freezes first and then REFUSES to train if
#     the trainable-parameter count is not LoRA-sized.
#
# PROGRESS IS CUMULATIVE AND IS NOT READ OFF THE CHECKPOINT NUMBERS. mlx_vlm restarts its
# iteration counter at 1 on every resume, so after one restart `0000250_adapters` means
# 250 iters of THIS attempt, not of the run. Reading the highest number on disk would
# under-count for ever. The cumulative figure lives in $OUT/PROGRESS.
set -u

REPO="${FORGE_MODEL_REPO:-/Users/account_clawteam1/archdisc-Models}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO" || { echo "no model repo at $REPO"; exit 1; }

TOTAL_ITERS="${1:-8000}"
SUFFIX="${2:-}"
MAX_ATTEMPTS="${3:-6}"
NAME="archie-30b-knowing-v1${SUFFIX}"
OUT="adapters/${NAME}"
DATA="data/forge/knowing_v1"
LOG="logs/${NAME}.log"
PY="$REPO/.venv/bin/python"
# CHECKPOINT CADENCE IS SET BY THE COLLISION RATE, NOT BY TASTE.
# 250 iters is ~13 minutes here, and on this box a sibling agent starts its own job
# against the same base model every few minutes; a collision that lands inside the first
# 13 minutes loses the whole attempt. Measured: three attempts in a row reached model
# load and died having written nothing. 125 iters is ~6.7 minutes, which turns a
# collision from "lose everything" into "lose seven minutes".
#
# Each checkpoint is 453 MB and free disk is 81 GB and falling (macOS swap files are on
# the same volume and grew 49 GB while these jobs fought), so KEEP_CKPT below bounds the
# total. Pruning happens only after a NEWER, non-empty checkpoint exists, which is the
# condition that makes an older one verifiably redundant for the only purpose it has
# here — resuming this run.
SAVE_EVERY=125
KEEP_CKPT=3

mkdir -p "$OUT" logs

# A DEAD JOB MUST NOT HOLD AN ENVELOPE. Guardian signals whatever pid a .job file names,
# and pids are recycled; a stale envelope means it either budgets memory for a job that
# is gone or, worse, signals an unrelated process. Cleared on every exit path.
JF=""
_deregister() { [ -n "${JF:-}" ] && rm -f "$JF"; }
trap '_deregister' EXIT INT TERM

say() { printf '[train] %s\n' "$*" | tee -a "$LOG"; }
hr()  { printf -- '--------------------------------------------------------------\n' | tee -a "$LOG"; }

[ -x "$PY" ] || { say "FATAL: no venv python at $PY"; exit 1; }
[ -d "models/qwen3-vl-30b-a3b-4bit" ] || { say "FATAL: no base model"; exit 1; }
[ -s "$DATA/train.jsonl" ] || { say "FATAL: no corpus at $DATA/train.jsonl"; exit 1; }

# --------------------------------------------------------------------------- #
#  LAW 8 — scan the corpus as TRAINING data, every launch, not once ever.      #
# --------------------------------------------------------------------------- #
hr
say "LAW 8: scanning $DATA as training data"
"$PY" scripts/contamination_guard.py --scan "$DATA/train.jsonl" "$DATA/valid.jsonl" >> "$LOG" 2>&1
if [ $? -ne 0 ]; then
  say "CONTAMINATED corpus — refusing to train. See $LOG."
  exit 1
fi
say "LAW 8: clean"

# --------------------------------------------------------------------------- #
#  LAW 7 — never start beside another GPU job OR a kernel scoring job.         #
# --------------------------------------------------------------------------- #
# The pattern demands the "<python> <script>.py" form. A bare `pgrep -f composite_score`
# also matches every SHELL waiting with that pattern on ITS OWN command line, so the loop
# would see processes that are only watching and block for ever.
# A PROCESS THAT MENTIONS THE MODEL IS NOT A PROCESS THAT LOADED IT.
# `pgrep -f qwen3-vl-30b-a3b-4bit` matches any command line containing that string,
# which on this box includes the coordinator's own diagnostic shell — observed
# 2026-09-14, a `/bin/zsh -c` whose body greps for exactly this pattern. A guard that
# counts it waits for ever on an observer. Only a PYTHON process can hold 18 GB of
# weights, so the process NAME is the discriminator, not the command line alone.
other_model_job() {
  local p comm
  for p in $(pgrep -f "qwen3-vl-30b-a3b-4bit" 2>/dev/null); do
    [ "$p" = "$$" ] && continue
    comm="$(ps -o comm= -p "$p" 2>/dev/null)"
    case "${comm##*/}" in
      *[Pp]ython*) return 0 ;;
    esac
  done
  return 1
}

wait_for_box() {
  local waited=0
  # THREE PATTERNS, because a list of script names is not a list of jobs.
  #   1. the known trainers/evaluators by name
  #   2. the pinned kernel
  #   3. ANY process with the base model on its command line — measured 2026-09-14:
  #      a sibling agent was running its own inference against
  #      models/qwen3-vl-30b-a3b-4bit from a scratchpad script this guard had never
  #      heard of. Two 18 GB models on a 36 GB box left BOTH processes in
  #      uninterruptible wait at 0% CPU, and my trainer had died of
  #      kIOGPUCommandBufferCallbackErrorOutOfMemory shortly before. The model path is
  #      the thing they have in common; the script name is not.
  while pgrep -f "[Pp]ython[^ ]* (scripts/|tools/knowing_train/)(lora_eager_rope|launch_vlm_expert_lora|archie_loop|score_benchmarks|composite_score)[.]py" >/dev/null 2>&1 \
     || pgrep -x forge_verify >/dev/null 2>&1 \
     || other_model_job; do
    [ $waited -eq 0 ] && say "LAW 7: another GPU/kernel job is resident — waiting for the box"
    [ $((waited % 600)) -eq 0 ] && [ $waited -gt 0 ] && say "LAW 7: still waiting (${waited}s)"
    sleep 60; waited=$((waited + 60))
  done
  # ---- MEMORY READINESS ---------------------------------------------------- #
  # NOT `vm.swapusage used` against an absolute threshold. That was this script's
  # first guard and it is UNREACHABLE on this machine: measured 2026-09-14, total RSS
  # across every process on the box was 4.5 GB while swap still reported ~14 GB used,
  # because macOS counts pages it has WRITTEN to the swap file and reclaims that space
  # lazily, long after the owning processes exit. Successive samples read 13163M,
  # 14945M, 13674M, 13866M — it went UP while the box was idle. A guard that waits for
  # 4500M there waits for ever, which is the same shape of gridlock as a job politely
  # blocked on a gate that its own absence keeps shut.
  #
  # Two signals that DO track current demand:
  #   * free physical memory percentage (memory_pressure), and
  #   * swap GROWTH over a window — rising swap means someone is actively allocating,
  #     which is the condition that killed attempt 1; a high flat level means nothing.
  local tries=0 freepct s0 s1 growth
  while :; do
    freepct="$(memory_pressure 2>/dev/null | sed -n 's/.*free percentage: *\([0-9]*\)%.*/\1/p' | tail -1)"
    s0="$(sysctl -n vm.swapusage | sed -E 's/.*used = ([0-9.]+)M.*/\1/' | cut -d. -f1)"
    sleep 20
    s1="$(sysctl -n vm.swapusage | sed -E 's/.*used = ([0-9.]+)M.*/\1/' | cut -d. -f1)"
    growth=$(( ${s1:-0} - ${s0:-0} ))
    if [ "${freepct:-0}" -ge 12 ] && [ "$growth" -lt 1500 ]; then
      say "box ready: free memory ${freepct}%, swap ${s1}M (growth ${growth}M/20s)"
      return 0
    fi
    tries=$((tries + 1))
    if [ "$tries" -gt 45 ]; then
      say "box never settled (free ${freepct}%, swap growth ${growth}M/20s) after 15 min"
      return 1
    fi
    say "waiting: free memory ${freepct}%, swap ${s1}M, growth ${growth}M/20s"
    sleep 20
  done
}

# --------------------------------------------------------------------------- #
#  ATTEMPT LOOP                                                                #
# --------------------------------------------------------------------------- #
write_config() {
  "$PY" - "$1" <<'PYEOF'
import sys, os
sys.path.insert(0, os.path.join(os.environ.get("FORGE_MODEL_REPO",
                "/Users/account_clawteam1/archdisc-Models"), "scripts"))
import expert_lora_patch as e
print("write_config ->", e.write_config(sys.argv[1], rank=16, alpha=32,
                                        dropout=0.0, expert_rank=8))
ok, msg = e.verify(sys.argv[1])
print(("OK|" if ok else "BAD|") + msg)
raise SystemExit(0 if ok else 3)
PYEOF
}

attempt=0
ZERO=0
while :; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt "$MAX_ATTEMPTS" ]; then
    say "gave up after ${MAX_ATTEMPTS} attempt(s)"
    exit 4
  fi

  DONE=0
  [ -s "$OUT/PROGRESS" ] && DONE="$(cat "$OUT/PROGRESS")"
  REMAIN=$(( TOTAL_ITERS - DONE ))
  if [ "$REMAIN" -le 0 ]; then
    say "COMPLETE: ${DONE}/${TOTAL_ITERS} iters"
    break
  fi

  RESUME_ARGS=()
  if [ -s "$OUT/adapters.safetensors" ]; then
    say "resuming: ${DONE} done, ${REMAIN} to go (attempt ${attempt})"
    write_config "$OUT" >> "$LOG" 2>&1
    if [ $? -ne 0 ]; then
      say "the existing adapter's config does not describe its weights — refusing to resume"
      exit 1
    fi
    RESUME_ARGS=(--adapter-path "$OUT")
  else
    say "fresh start: ${REMAIN} iters (attempt ${attempt})"
  fi

  wait_for_box || exit 1

  MARK="$(mktemp -t knowingmark)"
  hr
  say "START $(date) attempt=${attempt} iters=${REMAIN} cumulative_done=${DONE} out=${OUT}"

  # --- ADMISSION, then REGISTRATION OF THE PID THAT CAN ACTUALLY OBEY --------- #
  #
  # Guardian sheds ONLY REGISTERED JOBS, so an unregistered 25 GB trainer is both
  # invisible to the shedder AND the pressure that starves every process waiting on a
  # gate. Registration is mandatory. But it must register the PYTHON pid, not a shell
  # wrapper's, and this is measured rather than argued:
  #
  #   guardian.log  17:31:57  shed sig=USR1 -> job='knowing-v1-lora' pid=78851
  #   this log      17:31:57  ATTEMPT_DONE rc=158          (158 = 128 + SIGUSR1)
  #
  # Guardian's stage-1 shed is COOPERATIVE — its own source says SIGUSR1 means
  # "checkpoint now and reduce your footprint" — but `forge-job` traps only EXIT, INT
  # and TERM, so its zsh wrapper takes SIGUSR1's default disposition and dies, taking
  # the job with it before it ever reaches a checkpoint. The politest signal in the
  # system is the one that kills. That is a defect in the shared wrapper; this script
  # does not edit it (two other agents' jobs are running under it right now) and instead
  # does what forge-job does, minus the fatal gap:
  #
  #   1. forge-gate --need orange   — the same admission control, same arguments.
  #      orange, not green: a job that loads 18 GB will never see green here, and
  #      waiting for green is waiting for a condition the job itself prevents.
  #   2. write the job file with the TRAINER's pid, so stage-1 SIGUSR1 lands on the
  #      process whose handler saves the adapter and carries on (see the launcher).
  #   3. remove the job file on ANY exit, so a dead job never holds an envelope.
  #
  # Exit 75 (EX_TEMPFAIL) keeps forge-job's meaning here: the gate denied admission.
  if ! forge-gate --need orange --wait 900 --why knowing-v1-lora >> "$LOG" 2>&1; then
    say "forge-gate DENIED admission (Guardian too hot for 900 s). Retrying, not failing."
    rm -f "$MARK"
    sleep 120
    continue
  fi

  FORGE_EXPERT_LORA_LAYERS=12 FORGE_EXPERT_LORA_RANK=8 FORGE_MODEL_REPO="$REPO" \
  PYTHONUNBUFFERED=1 \
  "$PY" "$HERE/launch_vlm_expert_lora.py" \
    --model-path models/qwen3-vl-30b-a3b-4bit \
    --dataset "$DATA" \
    --split train \
    --train-mode sft --train-on-completions \
    --lora-rank 16 --lora-alpha 32 --lora-dropout 0.0 \
    --max-seq-length 3072 \
    --batch-size 1 --gradient-accumulation-steps 4 --grad-checkpoint \
    --learning-rate 1e-5 \
    --iters "$REMAIN" \
    --steps-per-report 50 --steps-per-save "$SAVE_EVERY" \
    "${RESUME_ARGS[@]+"${RESUME_ARGS[@]}"}" \
    --output-path "$OUT" >> "$LOG" 2>&1 &
  TRAIN_PID=$!
  JOBS_DIR="${FORGE_HEALTH_DIR:-$HOME/.forge-health}/jobs"
  mkdir -p "$JOBS_DIR"
  JF="$JOBS_DIR/${TRAIN_PID}.job"
  {
    echo "pid=$TRAIN_PID"
    echo "name=knowing-v1-lora"
    echo "priority=5"
    echo "can_restart=1"
    echo "peak_gb=25"
    echo "gpu=1"
    echo "started=$(date +%s)"
    echo "cmd=knowing_v1 LoRA (mlx_vlm, expert LoRA, resumable at ${SAVE_EVERY}-iter checkpoints)"
  } > "$JF"
  say "registered with Guardian: $JF (pid ${TRAIN_PID}, peak 25 GB, restartable)"
  wait "$TRAIN_PID"
  rc=$?
  rm -f "$JF"
  say "ATTEMPT_DONE rc=${rc} $(date)  [deregistered]"
  if [ "$rc" -eq 158 ]; then
    say "rc=158 is SIGUSR1: Guardian's stage-1 CHECKPOINT request killed the process."
    say "If this recurs the launcher's SIGUSR1 handler is not installed — check the log"
    say "for '[launch] SIGUSR1/SIGTERM handlers installed'."
  fi
  if [ "$rc" -eq 143 ]; then
    say "rc=143 is SIGTERM: Guardian stage-3 eviction. The launcher saved before exiting."
  fi

  # How far did THIS attempt actually get? rc==0 means the final save ran, so all of
  # REMAIN landed. Otherwise the last thing on disk is the newest numbered checkpoint
  # WRITTEN DURING THIS ATTEMPT — hence the -newer marker; the numbers restart at 1 on
  # every resume and an older, larger number from a previous attempt would over-count.
  if [ "$rc" -eq 0 ]; then
    GOT="$REMAIN"
  else
    GOT="$(find "$OUT" -name '[0-9]*_adapters.safetensors' -newer "$MARK" 2>/dev/null \
           | sed -E 's|.*/0*([0-9]+)_adapters\.safetensors|\1|' | sort -n | tail -1)"
    GOT="${GOT:-0}"
  fi
  rm -f "$MARK"
  DONE=$(( DONE + GOT ))
  echo "$DONE" > "$OUT/PROGRESS"
  say "PROGRESS ${DONE}/${TOTAL_ITERS} (attempt added ${GOT})"

  # Bound the checkpoint pile. Only ever removes a numbered checkpoint that has at least
  # KEEP_CKPT NEWER, non-empty siblings — resume reads $OUT/adapters.safetensors (always
  # the latest) and $OUT/PROGRESS, so an older numbered file is redundant for resuming
  # once a newer one exists. The rolling adapters.safetensors is never touched.
  n_ck="$(ls "$OUT"/[0-9]*_adapters.safetensors 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${n_ck:-0}" -gt "$KEEP_CKPT" ]; then
    for old in $(ls -t "$OUT"/[0-9]*_adapters.safetensors 2>/dev/null | tail -n +$((KEEP_CKPT + 1))); do
      [ -s "$old" ] || continue
      say "pruning superseded checkpoint $(basename "$old") ($(ls -t "$OUT"/[0-9]*_adapters.safetensors | head -1 | xargs basename) is newer)"
      rm -f "$old"
    done
  fi

  if [ "$rc" -eq 0 ]; then
    break
  fi
  if [ "$GOT" -eq 0 ]; then
    ZERO=$(( ZERO + 1 ))
    say "attempt ${attempt} produced NO checkpoint (${ZERO} in a row)"
    tail -3 "$LOG"
    # FOUR, not two. A zero-progress attempt on this box is usually CONTENTION, not a
    # broken recipe: a sibling agent loading the same 18 GB base model puts both
    # processes into uninterruptible wait and my trainer then dies without reaching its
    # first 250-iteration checkpoint. That is worth retrying — wait_for_box will hold
    # until the other job is gone. A genuinely broken recipe still stops, just later.
    if [ "$ZERO" -ge 8 ]; then
      say "four attempts with no progress — stopping rather than looping on a hard failure"
      exit "$rc"
    fi
  else
    ZERO=0
  fi
  say "retrying after a 120 s cool-down"
  sleep 120
done

# --------------------------------------------------------------------------- #
#  THE ADAPTER MUST DESCRIBE ITSELF                                            #
# --------------------------------------------------------------------------- #
if [ -s "$OUT/adapters.safetensors" ]; then
  write_config "$OUT" | tee -a "$LOG"
  say "FINAL cumulative iters: $(cat "$OUT/PROGRESS" 2>/dev/null)"
fi
exit 0
