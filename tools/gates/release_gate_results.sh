#!/usr/bin/env bash
# release_gate_results.sh — turn one desktop-release.yml run into
# forge.gate_result/v1 records, ending in ONE aggregate: release.acceptance.
#
# ── THE DEFECT (T-185) ───────────────────────────────────────────────────────
# On an archdisc push whose kernel-tests run was cancelled (kgate=skip), the
# release job concludes SUCCESS with publish=skipped and acceptance=skipped. The
# `prove` step tolerates that on purpose -- 9 of 15 pushes were superseded, and a
# red build on 60% of merges for a reason that heals itself is its own defect.
# But a green tick over "nothing was published and nothing was accepted" is not a
# result anyone can consume. And when kernel-tests IS green, it is green with the
# NAFEMS ratchet holding known band misses (LE11 BLOCKED on the runner) and the s0
# ratchet holding known failures -- "no worse than before", read downstream as
# "correct".
#
# So the job colour keeps meaning "did the workflow malfunction", and THIS file
# says what was accepted, with NOT_RUN and BLOCKED as first-class answers:
#
#   release.build_package     hard   the build/package/floor step
#   release.self_contained    hard   the bundle self-containment proof
#   release.kernel_gate       hard   kgate: go=PASSED skip=NOT_RUN stop=FAILED
#   kernel.s0_conformance     ratchet  } fetched from kernel-tests' own records for
#   kernel.nafems_accuracy    ratchet  } this commit; absent => NOT_RUN
#   release.publish           hard   the publish step
#   release.live_acceptance   hard   the live releases/latest fetch + digest check
#   release.acceptance        aggregate of ALL of the above
#
# release.acceptance is true ONLY when every component PASSED and accepted. A
# ratchet never accepts (tools/gates/gate_result.sh), so while NAFEMS or s0 hold
# known misses the release is recorded as PUBLISHED-BUT-NOT-ACCEPTED -- exactly
# what directive §11 asks: "Pre-existing misses can be tracked while working, but
# they prevent full acceptance of the affected capability."
#
# ★ THIS DOES NOT CHANGE WHAT PUBLISHES. Publishing is still decided by kgate and
#   the brake, unchanged; this records what the run established. Whether known
#   misses should ALSO block publication is a product decision, recorded as an
#   open issue rather than slipped in here.
#
# Inputs (env; every one may be empty, and empty means the step did not run):
#   GR_EVENT GR_REF GR_REF_TYPE GR_MODE GR_KGATE
#   GR_BUILD GR_SELFCONTAINED GR_PUBLISH GR_ACCEPT  (step outcomes)
#   GR_KERNEL_DIR   directory holding kernel-tests' gate-results-*/*.jsonl
#   GR_WORKFLOW     the workflow file (an input of every record)
#   FORGE_GATE_RESULTS  output file
# Exit: 0 when the records are written and valid (whatever they say); 1 if the
# records it wrote fail validation; 2 on usage errors.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GR="$HERE/gate_result.sh"
OUT="${FORGE_GATE_RESULTS:?FORGE_GATE_RESULTS must name the output file}"
WF="${GR_WORKFLOW:-.github/workflows/desktop-release.yml}"
KDIR="${GR_KERNEL_DIR:-}"
mkdir -p "$(dirname "$OUT")"

MODE="${GR_MODE:-}"; KGATE="${GR_KGATE:-}"
# The kernel ratchets the release REQUIRES a record for. Absent => NOT_RUN.
KERNEL_REQUIRED="kernel.s0_conformance kernel.nafems_accuracy"

# status_of <step outcome> -> PASSED|FAILED|NOT_RUN
status_of() {
  case "$1" in
    success) echo PASSED ;;
    failure) echo FAILED ;;
    *)       echo NOT_RUN ;;   # skipped, cancelled, or the step never existed
  esac
}

why_not_published() {
  if [ "${GR_EVENT:-}" != push ] || [ "${GR_REF:-}" != refs/heads/archdisc ]; then
    echo "not an archdisc push (event=${GR_EVENT:-?} ref=${GR_REF:-?}): this run publishes nothing by design"
  elif [ "$MODE" = brake ]; then
    echo "FORGE_AUTORELEASE brake is off: built and measured, published nothing"
  elif [ "$MODE" != auto ]; then
    echo "mode=${MODE:-<none>}: this run does not publish"
  elif [ "$KGATE" = skip ]; then
    echo "kernel-tests was cancelled/skipped for this commit (superseded); the superseding commit publishes"
  elif [ -z "$KGATE" ]; then
    echo "the kernel gate never answered (an earlier step failed or the job was cancelled)"
  else
    echo "kernel gate answered '$KGATE'"
  fi
}

emit_step() {  # emit_step <gate> <outcome> <not-run reason>
  local gate="$1" outcome="$2" why="$3" st
  st="$(status_of "$outcome")"
  case "$st" in
    PASSED)  bash "$GR" emit --gate "$gate" --kind hard --status PASSED --exit-code 0 --input "$WF" --out "$OUT" ;;
    FAILED)  bash "$GR" emit --gate "$gate" --kind hard --status FAILED --exit-code 1 --input "$WF" --out "$OUT" \
               --reason "step outcome 'failure'" ;;
    NOT_RUN) bash "$GR" emit --gate "$gate" --kind hard --status NOT_RUN --input "$WF" --out "$OUT" \
               --reason "step outcome '${outcome:-<none>}': $why" ;;
  esac
}

rc=0
emit_step release.build_package  "${GR_BUILD:-}"         "an earlier step failed or the job was cancelled" || rc=2
emit_step release.self_contained "${GR_SELFCONTAINED:-}" "an earlier step failed or the job was cancelled" || rc=2

case "$KGATE" in
  go)   bash "$GR" emit --gate release.kernel_gate --kind hard --status PASSED --exit-code 0 \
          --input "$WF" --out "$OUT" || rc=2 ;;
  stop) bash "$GR" emit --gate release.kernel_gate --kind hard --status FAILED --exit-code 1 \
          --input "$WF" --out "$OUT" --reason "kernel-tests concluded red, or could not be asked, for this commit" || rc=2 ;;
  skip) bash "$GR" emit --gate release.kernel_gate --kind hard --status NOT_RUN \
          --input "$WF" --out "$OUT" --reason "kernel-tests was cancelled/skipped for this commit (superseded by a newer push)" || rc=2 ;;
  *)    bash "$GR" emit --gate release.kernel_gate --kind hard --status NOT_RUN \
          --input "$WF" --out "$OUT" --reason "kernel gate not evaluated (mode=${MODE:-<none>}): $(why_not_published)" || rc=2 ;;
esac

# Kernel-tests' own records for this commit, copied in verbatim after validation.
KCOMPS="$KERNEL_REQUIRED"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null)}"
KWHY="no kernel-tests records were fetched"
if [ -n "$KDIR" ] && [ -d "$KDIR" ]; then
  KFILES="$(find "$KDIR" -type f -name '*.jsonl' | LC_ALL=C sort)"
  if [ -n "$KFILES" ]; then
    # shellcheck disable=SC2086
    if bash "$GR" validate $KFILES; then
      # shellcheck disable=SC2086
      cat $KFILES | jq -c --arg sha "$SHA" 'select(.commit == $sha)' >> "$OUT"
      # Every kernel.* gate present joins the aggregate, on top of the required set.
      # shellcheck disable=SC2086
      KCOMPS="$( { printf '%s\n' $KERNEL_REQUIRED; cat $KFILES | jq -r --arg sha "$SHA" 'select(.commit == $sha) | .gate'; } \
                 | grep -E '^kernel\.' | LC_ALL=C sort -u | tr '\n' ' ')"
      # shellcheck disable=SC2086
      KWHY="kernel-tests records were fetched ($(cat $KFILES | grep -c .) line(s)) and none is for this gate at this commit"
    else
      KWHY="the fetched kernel-tests records are INVALID and were not copied"
      echo "[release-gate-results] $KWHY"
    fi
  else
    KWHY="no kernel-tests records in $KDIR"
    echo "[release-gate-results] $KWHY"
  fi
else
  echo "[release-gate-results] $KWHY"
fi

# A REQUIRED kernel gate with no record for this commit gets an EXPLICIT NOT_RUN
# record, so a reader of the JSONL sees the gate and the reason instead of an
# absence. Both required gates are ratchets, so known_misses is stated as null:
# unknown, which can never accept. (MEASURED 2026-10-08: kernel.nafems_accuracy
# has NO producer -- the NAFEMS ratchet runs node in kernel-tests' `kernel` job,
# which emits no record -- so until a native producer exists this line is what
# keeps release.acceptance honest about it.)
for g in $KERNEL_REQUIRED; do
  if ! jq -s -e --arg g "$g" --arg sha "$SHA" 'map(select(type == "object" and .gate == $g and .commit == $sha)) | length > 0' \
       "$OUT" >/dev/null 2>&1; then
    bash "$GR" emit --gate "$g" --kind ratchet --status NOT_RUN --known-misses null --input "$WF" --out "$OUT" \
      --reason "no forge.gate_result/v1 record from kernel-tests.yml for this commit: $KWHY" || rc=2
  fi
done

NOTPUB="$(why_not_published)"
emit_step release.publish         "${GR_PUBLISH:-}" "$NOTPUB" || rc=2
emit_step release.live_acceptance "${GR_ACCEPT:-}"  "$NOTPUB" || rc=2

COMPS="release.build_package,release.self_contained,release.kernel_gate,$(printf '%s' "$KCOMPS" | tr ' ' ',' | sed 's/,*$//'),release.publish,release.live_acceptance"
bash "$GR" aggregate --gate release.acceptance --component "$COMPS" --from "$OUT" --input "$WF" --out "$OUT.agg" || rc=2
cat "$OUT.agg" >> "$OUT" 2>/dev/null; rm -f "$OUT.agg"

if ! bash "$GR" validate "$OUT"; then
  echo "[release-gate-results] the records this run wrote are INVALID"; rc=1
fi

VERDICT="$(jq -r 'select(.gate == "release.acceptance") | "\(.status)\t\(.acceptance)\t\(.reason)"' "$OUT" | tail -1)"
V_ST="$(printf '%s' "$VERDICT" | cut -f1)"; V_ACC="$(printf '%s' "$VERDICT" | cut -f2)"; V_WHY="$(printf '%s' "$VERDICT" | cut -f3-)"
if [ "$V_ACC" = true ]; then HEAD="ACCEPTED"; else HEAD="NOT ACCEPTED ($V_ST)"; fi
echo "[release-gate-results] release.acceptance: $HEAD"
[ "$V_ACC" = true ] || echo "[release-gate-results]   because: $V_WHY"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Release acceptance (forge.gate_result/v1): **$HEAD**"
    echo
    echo "The job colour says whether the workflow malfunctioned. THIS says what was"
    echo "accepted. A ratchet never accepts; a skipped step is NOT_RUN, not a pass."
    echo
    [ "$V_ACC" = true ] || { echo "> $V_WHY"; echo; }
    bash "$GR" summary "$OUT"
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit $rc
