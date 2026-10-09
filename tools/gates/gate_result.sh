#!/usr/bin/env bash
# gate_result.sh — forge.gate_result/v1: ONE machine-readable verdict per gate run.
#
# ── WHY THIS EXISTS (T-185) ──────────────────────────────────────────────────
# A green CI job was being read as acceptance, and it could not carry the answer:
#
#   * desktop-release.yml concluded `success` on archdisc pushes whose publish
#     and acceptance steps were both SKIPPED (kernel-tests cancelled, gate=skip).
#     A skipped step and a passed step are the same colour.
#   * kernel-tests.yml goes green with the NAFEMS ratchet holding its known band
#     misses and LE11 BLOCKED, and the s0 ratchet holding its known failures. A
#     ratchet that is green AT ITS KNOWN-MISS COUNT proves "no worse than before";
#     the release path then read that green as "the kernel is correct".
#   * A job conclusion has no NOT_RUN and no BLOCKED. Directive §5A: "Distinguish
#     NOT RUN, BLOCKED, FAILED, and PASSED in machine-readable results", and
#     "Record existing debt and failures without counting their ratchet as
#     product acceptance."
#
# ── THE RECORD (one JSON object per line) ────────────────────────────────────
#   schema        "forge.gate_result/v1"
#   gate          stable id, [a-z0-9][a-z0-9_.:-]*         e.g. kernel.nafems_accuracy
#   kind          hard | ratchet | selftest | aggregate
#   status        PASSED | FAILED | BLOCKED | NOT_RUN
#   acceptance    bool — DERIVED HERE, never accepted from a caller (see below)
#   known_misses  int >= 0 | null   (required key for kind=ratchet)
#   known_blocked int >= 0 | null
#   exit_code     int | null        (null iff the gate did not run)
#   reason        string            (required for NOT_RUN and BLOCKED)
#   commit        40-hex            ($GITHUB_SHA, else git HEAD)
#   inputs        [path...]         non-empty: what this verdict is a function of
#   inputs_hash   "sha256:<64hex>"  over (path, content sha256) of every input
#   evidence      [path...]         logs/reports that back the verdict
#   components    [gate id...]      (aggregate only)
#   producer, run_id, recorded_at   provenance
#
# ── THE ACCEPTANCE RULE, IN ONE PLACE ────────────────────────────────────────
#   acceptance = status == PASSED
#              ∧ kind  != ratchet                ★ a ratchet can NEVER accept
#              ∧ known_misses  ∈ {0, null}
#              ∧ known_blocked ∈ {0, null}
#              ∧ (aggregate: every component present AND accepted)
#   A ratchet asserts "no worse than the pinned set". When its pinned set reaches
#   zero, convert it to kind=hard in a reviewed change; that is a decision, not a
#   side effect of a number reaching 0. `validate` re-derives the rule for every
#   record and REJECTS any record whose acceptance disagrees, so a hand-written
#   or post-edited `"acceptance": true` on a ratchet is invalid, not merely odd.
#
# ── USAGE ────────────────────────────────────────────────────────────────────
#   gate_result.sh emit --gate ID --kind K --status S --input P [--input P]...
#        [--known-misses N|null] [--known-blocked N|null] [--exit-code N]
#        [--reason TEXT] [--evidence P]... [--commit SHA] [--out FILE]
#   gate_result.sh run --gate ID --kind K --input P... [--blocked-rc N]...
#        [--known-misses-from ERE] [--known-blocked-from ERE] [--log FILE]
#        [--evidence P]... [--out FILE] -- CMD ARGS...
#        Runs CMD, prints its output, records the verdict, exits with CMD's rc.
#        rc 0 -> PASSED; rc in --blocked-rc -> BLOCKED; anything else -> FAILED.
#        The *-from EREs carry ONE capture group, applied to CMD's output (last
#        match wins). A ratchet whose count cannot be read records null, which
#        can never accept.
#   gate_result.sh aggregate --gate ID --component ID[,ID...] --from FILE
#        --input P... [--out FILE]
#   gate_result.sh validate FILE...           rc 0 all valid, 1 any invalid
#   gate_result.sh verdict --require ID[,ID...] [--commit SHA] FILE...
#        rc 0 iff every required gate has records and ALL of them accept.
#   gate_result.sh summary FILE...            markdown table on stdout
#
#   --out defaults to $FORGE_GATE_RESULTS. There is no silent default path: a
#   verdict written somewhere nobody reads is the defect this file exists to fix.
#
# Needs bash, jq, and shasum or sha256sum. No network.
set -uo pipefail

SCHEMA="forge.gate_result/v1"
PROG="gate_result.sh"
die()  { echo "[$PROG] $*" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || die "jq is required and was not found — refusing to emit an unverifiable verdict"

sha256_of() {   # sha256_of <file> -> hex
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}

# inputs_hash <path>... — order-independent, content-addressed. A missing input
# hashes as MISSING rather than aborting: the record still says what it was a
# function of, and the hash changes the moment the input appears.
inputs_hash() {
  local p
  for p in "$@"; do
    if [ -f "$p" ]; then printf '%s\t%s\n' "$p" "$(sha256_of "$p")"
    elif [ -d "$p" ]; then
      printf '%s\tDIR:%s\n' "$p" "$(cd "$p" && find . -type f -print | LC_ALL=C sort \
        | while IFS= read -r f; do printf '%s\t%s\n' "$f" "$(sha256_of "$f")"; done | sha256_stdin)"
    else printf '%s\tMISSING\n' "$p"; fi
  done | LC_ALL=C sort -u | sha256_stdin
}

resolve_commit() {
  local c="${1:-}"
  [ -n "$c" ] || c="${GITHUB_SHA:-}"
  [ -n "$c" ] || c="$(git rev-parse HEAD 2>/dev/null || true)"
  printf '%s' "$c" | grep -qE '^[0-9a-f]{40}$' || die "commit '$c' is not a 40-hex SHA"
  printf '%s' "$c"
}

is_count() { printf '%s' "$1" | grep -qE '^(null|0|[1-9][0-9]*)$'; }

# The jq definition of the rule. `emit` and `validate` both use THIS text, so the
# rule cannot drift between the producer and the checker.
JQ_RULE='
def derived_acceptance:
  (.status == "PASSED")
  and (.kind != "ratchet")
  and ((.known_misses  // 0) == 0)
  and ((.known_blocked // 0) == 0);
'

# ─────────────────────────────────────────────────────────────────────────────
cmd_emit() {
  local gate="" kind="" status="" misses="null" blocked="null" exitc="" reason="" commit="" out="${FORGE_GATE_RESULTS:-}"
  local comps="" misses_set=0
  local -a inputs=() evidence=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --gate) gate="$2"; shift 2 ;;
      --kind) kind="$2"; shift 2 ;;
      --status) status="$2"; shift 2 ;;
      --known-misses) misses="$2"; misses_set=1; shift 2 ;;
      --known-blocked) blocked="$2"; shift 2 ;;
      --exit-code) exitc="$2"; shift 2 ;;
      --reason) reason="$2"; shift 2 ;;
      --input) inputs+=("$2"); shift 2 ;;
      --evidence) evidence+=("$2"); shift 2 ;;
      --commit) commit="$2"; shift 2 ;;
      --out) out="$2"; shift 2 ;;
      --components) comps="$2"; shift 2 ;;
      --acceptance|--accept|--accepted)
        die "acceptance is DERIVED from status/kind/known misses and cannot be set by a caller" ;;
      *) die "emit: unknown argument '$1'" ;;
    esac
  done
  [ -n "$out" ] || die "emit: no --out and FORGE_GATE_RESULTS is unset"
  printf '%s' "$gate" | grep -qE '^[a-z0-9][a-z0-9_.:-]*$' || die "emit: --gate '$gate' is not a stable id"
  case "$kind" in hard|ratchet|selftest|aggregate) ;; *) die "emit: --kind must be hard|ratchet|selftest|aggregate" ;; esac
  case "$status" in PASSED|FAILED|BLOCKED|NOT_RUN) ;; *) die "emit: --status must be PASSED|FAILED|BLOCKED|NOT_RUN" ;; esac
  [ "${#inputs[@]}" -gt 0 ] || die "emit: at least one --input is required (what is this verdict a function of?)"
  is_count "$misses"  || die "emit: --known-misses '$misses' is not a count or null"
  is_count "$blocked" || die "emit: --known-blocked '$blocked' is not a count or null"
  if [ "$kind" = ratchet ] && [ "$misses_set" -eq 0 ]; then
    die "emit: a ratchet must state --known-misses (a count, or null if it could not be read)"
  fi
  case "$status" in
    NOT_RUN|BLOCKED) [ -n "$reason" ] || die "emit: status $status needs a --reason" ;;
  esac
  if [ "$status" = NOT_RUN ]; then
    [ -z "$exitc" ] || die "emit: a gate that did NOT_RUN has no exit code"
    exitc=null
  else
    [ -n "$exitc" ] || exitc=null
    printf '%s' "$exitc" | grep -qE '^(null|-?[0-9]+)$' || die "emit: --exit-code '$exitc' is not an integer"
  fi
  if [ "$status" = PASSED ] && [ "$exitc" != null ] && [ "$exitc" != 0 ]; then
    die "emit: PASSED with exit code $exitc is a contradiction"
  fi
  commit="$(resolve_commit "$commit")" || exit 2
  local ih; ih="$(inputs_hash ${inputs[@]+"${inputs[@]}"})"

  local rec
  rec="$(jq -cn \
    --arg schema "$SCHEMA" --arg gate "$gate" --arg kind "$kind" --arg status "$status" \
    --argjson misses "$misses" --argjson blocked "$blocked" --argjson exitc "$exitc" \
    --arg reason "$reason" --arg commit "$commit" --arg ih "sha256:$ih" \
    --arg comps "$comps" \
    --arg producer "${GITHUB_WORKFLOW:+${GITHUB_WORKFLOW}/}${GITHUB_JOB:-local}" \
    --arg runid "${GITHUB_RUN_ID:-}" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --args "$JQ_RULE"'
      {schema:$schema, gate:$gate, kind:$kind, status:$status,
       known_misses:$misses, known_blocked:$blocked, exit_code:$exitc,
       reason:$reason, commit:$commit,
       inputs:($ARGS.positional | map(select(startswith("I:"))) | map(.[2:])),
       inputs_hash:$ih,
       evidence:($ARGS.positional | map(select(startswith("E:"))) | map(.[2:])),
       producer:$producer,
       run_id:(if $runid == "" then null else $runid end),
       recorded_at:$at}
      | if $kind == "aggregate" then .components = ($comps | split(",") | map(select(. != ""))) else . end
      | .acceptance = derived_acceptance
      | {schema,gate,kind,status,acceptance,known_misses,known_blocked,exit_code,reason,
         commit,inputs,inputs_hash,evidence} + (if .components then {components} else {} end)
        + {producer,run_id,recorded_at}' \
    $(for i in ${inputs[@]+"${inputs[@]}"}; do printf 'I:%s\n' "$i"; done) \
    $( [ "${#evidence[@]}" -gt 0 ] && for e in ${evidence[@]+"${evidence[@]}"}; do printf 'E:%s\n' "$e"; done ) \
  )" || die "emit: jq failed to build the record"
  # Paths with spaces would be split by the $(...) above; refuse rather than mangle.
  local n_in n_ev
  n_in="$(printf '%s' "$rec" | jq '.inputs | length')"; n_ev="$(printf '%s' "$rec" | jq '.evidence | length')"
  [ "$n_in" -eq "${#inputs[@]}" ] && [ "$n_ev" -eq "${#evidence[@]}" ] \
    || die "emit: an --input/--evidence path contains whitespace; use a path without spaces"
  mkdir -p "$(dirname "$out")" 2>/dev/null
  printf '%s\n' "$rec" >> "$out" || die "emit: could not append to $out"
  echo "[$PROG] $gate: $status  acceptance=$(printf '%s' "$rec" | jq -r .acceptance)  known_misses=$misses  -> $out" >&2
}

# ─────────────────────────────────────────────────────────────────────────────
cmd_run() {
  local gate="" kind="" mfrom="" bfrom="" log="" out="${FORGE_GATE_RESULTS:-}"
  local -a pass=() brc=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --) shift; break ;;
      --gate) gate="$2"; pass+=("$1" "$2"); shift 2 ;;
      --kind) kind="$2"; pass+=("$1" "$2"); shift 2 ;;
      --input|--evidence|--commit) pass+=("$1" "$2"); shift 2 ;;
      --out) out="$2"; shift 2 ;;
      --blocked-rc) brc+=("$2"); shift 2 ;;
      --known-misses-from) mfrom="$2"; shift 2 ;;
      --known-blocked-from) bfrom="$2"; shift 2 ;;
      --log) log="$2"; shift 2 ;;
      --acceptance|--accept|--accepted)
        die "acceptance is DERIVED and cannot be set by a caller" ;;
      *) die "run: unknown argument '$1'" ;;
    esac
  done
  [ $# -gt 0 ] || die "run: no command after --"
  [ -n "$out" ] || die "run: no --out and FORGE_GATE_RESULTS is unset"
  [ "$kind" != aggregate ] || die "run: an aggregate is computed with 'aggregate', not run"
  local tmplog; tmplog="$(mktemp "${TMPDIR:-/tmp}/gate_result_run.XXXXXX")"
  "$@" 2>&1 | tee "$tmplog"
  local rc=${PIPESTATUS[0]}
  local status=FAILED reason="" b
  [ "$rc" -eq 0 ] && status=PASSED
  if [ "$rc" -ne 0 ] && [ "${#brc[@]}" -gt 0 ]; then
    for b in ${brc[@]+"${brc[@]}"}; do
      [ "$rc" = "$b" ] && { status=BLOCKED; reason="command exited $rc, declared BLOCKED (the gate could not run its check)"; }
    done
  fi
  [ "$status" = FAILED ] && reason="command exited $rc"
  grab() {  # grab <ERE with one group> -> last captured value, or null
    local v
    v="$(perl -ne 'BEGIN{$re=shift} if (/$re/) { $v=$1 } END { print defined $v ? $v : "" }' "$1" "$tmplog" 2>/dev/null)"
    printf '%s' "$v" | grep -qE '^(0|[1-9][0-9]*)$' && { printf '%s' "$v"; return; }
    printf 'null'
  }
  local -a extra=()
  if [ -n "$mfrom" ]; then extra+=(--known-misses "$(grab "$mfrom")"); elif [ "$kind" = ratchet ]; then
    extra+=(--known-misses null); fi
  [ -n "$bfrom" ] && extra+=(--known-blocked "$(grab "$bfrom")")
  if [ "$kind" = ratchet ] && [ -n "$mfrom" ] && [ "$(grab "$mfrom")" = null ]; then
    reason="${reason:+$reason; }known misses could not be read from the output"
  fi
  if [ -n "$log" ]; then mkdir -p "$(dirname "$log")" 2>/dev/null; cp "$tmplog" "$log"; extra+=(--evidence "$log"); fi
  rm -f "$tmplog"
  local -a rs=()
  [ -n "$reason" ] && rs=(--reason "$reason")
  cmd_emit ${pass[@]+"${pass[@]}"} --status "$status" --exit-code "$rc" --out "$out" ${extra[@]+"${extra[@]}"} ${rs[@]+"${rs[@]}"} \
    || { echo "[$PROG] the gate ran (rc=$rc) but its verdict could NOT be recorded" >&2; [ "$rc" -eq 0 ] && return 2; return "$rc"; }
  return "$rc"
}

# ─────────────────────────────────────────────────────────────────────────────
# validate FILE... — every line must be a v1 record whose acceptance equals the
# rule. Prints one line per defect. rc 0 all valid, 1 any invalid, 2 usage.
JQ_CHECK="$JQ_RULE"'
def problems:
  [ (if type != "object" then "not a JSON object" else empty end),
    (if .schema != "forge.gate_result/v1" then "schema is not forge.gate_result/v1" else empty end),
    (if (.gate|type) != "string" or ((.gate // "") | test("^[a-z0-9][a-z0-9_.:-]*$") | not) then "gate id invalid" else empty end),
    (if ([.kind] | inside(["hard","ratchet","selftest","aggregate"])) | not then "kind invalid" else empty end),
    (if ([.status] | inside(["PASSED","FAILED","BLOCKED","NOT_RUN"])) | not then "status invalid" else empty end),
    (if (.acceptance|type) != "boolean" then "acceptance is not a boolean" else empty end),
    (if (has("known_misses") | not) or ((.known_misses|type) as $t | ($t != "null" and $t != "number")) then "known_misses missing or not a count" else empty end),
    (if (.known_misses|type) == "number" and ((.known_misses < 0) or (.known_misses|floor) != .known_misses) then "known_misses not a non-negative integer" else empty end),
    (if (.known_blocked|type) as $t | ($t != "null" and $t != "number") then "known_blocked not a count" else empty end),
    (if (.exit_code|type) as $t | ($t != "null" and $t != "number") then "exit_code not an integer or null" else empty end),
    (if .status == "NOT_RUN" and .exit_code != null then "NOT_RUN carries an exit code" else empty end),
    (if .status == "PASSED" and (.exit_code != null and .exit_code != 0) then "PASSED with a non-zero exit code" else empty end),
    (if ([.status] | inside(["NOT_RUN","BLOCKED"])) and ((.reason // "") == "") then "NOT_RUN/BLOCKED without a reason" else empty end),
    (if ((.commit // "") | test("^[0-9a-f]{40}$")) | not then "commit is not a 40-hex sha" else empty end),
    (if ((.inputs_hash // "") | test("^sha256:[0-9a-f]{64}$")) | not then "inputs_hash invalid" else empty end),
    (if (.inputs|type) != "array" or (.inputs|length) == 0 or ((.inputs // []) | map(type == "string") | all | not) then "inputs must be a non-empty array of paths" else empty end),
    (if (.evidence|type) != "array" or ((.evidence // []) | map(type == "string") | all | not) then "evidence must be an array of paths" else empty end),
    (if .kind == "aggregate" and ((.components|type) != "array" or (.components|length) == 0) then "aggregate without components" else empty end),
    (if .acceptance == true and .kind == "ratchet" then "a RATCHET claims acceptance" else empty end),
    (if .acceptance == true and .status != "PASSED" then "acceptance=true on a non-PASSED status" else empty end),
    (if .acceptance == true and ((.known_misses // 0) != 0 or (.known_blocked // 0) != 0) then "acceptance=true with known misses/blocked" else empty end),
    (if (.acceptance|type) == "boolean" and .kind != "aggregate" and .acceptance != derived_acceptance then "acceptance disagrees with the derivation rule" else empty end)
  ];
'
cmd_validate() {
  [ $# -gt 0 ] || die "validate: no files"
  local f bad=0 n=0 line ln probs
  for f in "$@"; do
    [ -f "$f" ] || { echo "[$PROG] INVALID $f: no such file"; bad=$((bad+1)); continue; }
    ln=0
    while IFS= read -r line || [ -n "$line" ]; do
      ln=$((ln+1)); [ -n "$line" ] || continue
      n=$((n+1))
      if ! probs="$(printf '%s' "$line" | jq -r "$JQ_CHECK"' problems | join("; ")' 2>/dev/null)"; then
        probs="not valid JSON"
      fi
      if [ -n "$probs" ]; then
        echo "[$PROG] INVALID $f:$ln: $probs"; bad=$((bad+1))
      fi
    done < "$f"
  done
  # aggregates: when the components are in the same files, re-derive them too.
  local agg
  agg="$(cat "$@" 2>/dev/null | jq -sr '
    . as $all
    | map(select(type=="object" and .kind=="aggregate")) | .[]
    | . as $a
    | [ $a.components[] as $c | ($all | map(select(type=="object" and .gate==$c and .commit==$a.commit))) ] as $per
    | if ($per | map(length > 0) | all) then
        ( ($per | map(map(.acceptance) | all) | all) ) as $acc
        | if $a.acceptance != $acc then "aggregate \($a.gate): acceptance=\($a.acceptance) but its components derive \($acc)" else empty end
      else
        (if $a.acceptance == true then "aggregate \($a.gate): acceptance=true with a component that has no record" else empty end)
      end' 2>/dev/null)"
  if [ -n "$agg" ]; then
    printf '%s\n' "$agg" | sed "s/^/[$PROG] INVALID /"; bad=$((bad + $(printf '%s\n' "$agg" | grep -c .)))
  fi
  echo "[$PROG] validate: $n record(s), $bad defect(s)"
  [ "$bad" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# aggregate — roll components up. Status is the WORST present
# (FAILED > BLOCKED > NOT_RUN > PASSED); a component with no record counts as
# NOT_RUN. Acceptance is the rule applied to the roll-up AND every component
# accepted.
cmd_aggregate() {
  local gate="" comps="" from="" out="${FORGE_GATE_RESULTS:-}" commit=""
  local -a inputs=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --gate) gate="$2"; shift 2 ;;
      --component|--components) comps="${comps:+$comps,}$2"; shift 2 ;;
      --from) from="$2"; shift 2 ;;
      --input) inputs+=(--input "$2"); shift 2 ;;
      --out) out="$2"; shift 2 ;;
      --commit) commit="$2"; shift 2 ;;
      *) die "aggregate: unknown argument '$1'" ;;
    esac
  done
  [ -n "$gate" ] && [ -n "$comps" ] && [ -n "$from" ] || die "aggregate: --gate, --component and --from are required"
  [ "${#inputs[@]}" -gt 0 ] || inputs=(--input "$from")
  commit="$(resolve_commit "$commit")" || exit 2
  [ -f "$from" ] || : > "$from"
  local roll
  roll="$(jq -sc --arg comps "$comps" --arg commit "$commit" '
    ($comps | split(",") | map(select(. != ""))) as $cs
    | map(select(type=="object" and .commit == $commit)) as $all
    | [ $cs[] as $c | ($all | map(select(.gate == $c))) as $r
        | if ($r|length) == 0 then {gate:$c, status:"NOT_RUN", acceptance:false, known_misses:null, known_blocked:null, reason:"no record"}
          else {gate:$c,
                status:( [$r[].status] | if index("FAILED") then "FAILED" elif index("BLOCKED") then "BLOCKED"
                                          elif index("NOT_RUN") then "NOT_RUN" else "PASSED" end),
                acceptance:([$r[].acceptance] | all),
                known_misses:( [$r[].known_misses] | if any(. == null) and ([$r[] | select(.kind=="ratchet")] | length) > 0 then null else (map(. // 0) | add) end),
                known_blocked:( [$r[].known_blocked | . // 0] | add ),
                reason:([$r[] | select(.status != "PASSED") | .reason] | join("; "))}
          end ] as $per
    | { status: ([$per[].status] | if index("FAILED") then "FAILED" elif index("BLOCKED") then "BLOCKED"
                                   elif index("NOT_RUN") then "NOT_RUN" else "PASSED" end),
        all_accepted: ([$per[].acceptance] | all),
        misses: ( [$per[].known_misses] | if any(. == null) then null else add end ),
        blocked: ( [$per[].known_blocked | . // 0] | add ),
        reason: ( [ $per[] | select(.acceptance | not)
                    | "\(.gate)=\(.status)" + (if (.known_misses // 0) > 0 then " (\(.known_misses) known misses)" else "" end)
                      + (if .status == "PASSED" and (.known_misses // 0) == 0 and .known_misses != null then " (not accepted: a ratchet or known blocked)" else "" end)
                      + (if .known_misses == null and .status == "PASSED" then " (known misses unreadable)" else "" end)
                      + (if .reason != "" and .status != "PASSED" then ": \(.reason)" else "" end) ] | join("; ") ) }
  ' "$from")" || die "aggregate: could not read $from"
  local st misses blocked all_acc reason
  st="$(printf '%s' "$roll" | jq -r .status)"
  misses="$(printf '%s' "$roll" | jq -r '.misses // "null"')"
  blocked="$(printf '%s' "$roll" | jq -r '.blocked // "null"')"
  all_acc="$(printf '%s' "$roll" | jq -r .all_accepted)"
  reason="$(printf '%s' "$roll" | jq -r .reason)"
  # An aggregate of PASSED components that are NOT accepted (a ratchet holding
  # misses) must not derive acceptance=true. The rule sees known_misses; when the
  # count is unknown, null would read as 0, so state it as a miss explicitly.
  if [ "$all_acc" != true ] && [ "$st" = PASSED ] && { [ "$misses" = null ] || [ "$misses" = 0 ]; }; then
    misses=1; reason="${reason:-a component is not accepted}"
  fi
  local -a rs=()
  [ -n "$reason" ] && rs=(--reason "$reason")
  cmd_emit --gate "$gate" --kind aggregate --status "$st" --components "$comps" \
    --known-misses "$misses" --known-blocked "$blocked" --commit "$commit" --out "$out" \
    ${inputs[@]+"${inputs[@]}"} ${rs[@]+"${rs[@]}"}
}

# ─────────────────────────────────────────────────────────────────────────────
cmd_verdict() {
  local req="" commit=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --require) req="${req:+$req,}$2"; shift 2 ;;
      --commit) commit="$2"; shift 2 ;;
      --) shift; break ;;
      -*) die "verdict: unknown argument '$1'" ;;
      *) break ;;
    esac
  done
  [ -n "$req" ] || die "verdict: --require is mandatory (an empty requirement accepts everything)"
  [ $# -gt 0 ] || die "verdict: no result files"
  cmd_validate "$@" >/dev/null || { cmd_validate "$@"; echo "[$PROG] verdict: NOT ACCEPTED — invalid records"; return 1; }
  local table
  table="$(cat "$@" | jq -sr --arg req "$req" --arg commit "$commit" '
    ($req | split(",") | map(select(. != ""))) as $rs
    | map(if $commit == "" then . else select(.commit == $commit) end) as $all
    | $rs[] as $g | ($all | map(select(.gate == $g))) as $r
    | if ($r|length) == 0 then "\($g)\tNOT_RUN\tfalse\t-\tno record"
      else ($r | last) as $l
        | "\($g)\t\($l.status)\t\([$r[].acceptance] | all)\t\($l.known_misses // "-")\t\($l.reason)" end')"
  printf '%s\n' "$table" | awk -F'\t' '{printf "[%s] %-36s %-8s acceptance=%-5s known_misses=%-4s %s\n", "'"$PROG"'", $1, $2, $3, $4, $5}'
  if printf '%s\n' "$table" | awk -F'\t' '$3 != "true"{bad=1} END{exit bad?0:1}'; then
    echo "[$PROG] verdict: NOT ACCEPTED"; return 1
  fi
  echo "[$PROG] verdict: ACCEPTED"; return 0
}

cmd_summary() {
  [ $# -gt 0 ] || die "summary: no files"
  echo "| gate | kind | status | acceptance | known misses | reason |"
  echo "|---|---|---|---|---|---|"
  cat "$@" | jq -r 'select(type=="object") | "| `\(.gate)` | \(.kind) | **\(.status)** | \(if .acceptance then "✅ true" else "❌ false" end) | \(.known_misses // "–") | \(.reason | gsub("\\|"; "/")) |"'
}

sub="${1:-}"; [ $# -gt 0 ] && shift
case "$sub" in
  emit)      cmd_emit "$@" ;;
  run)       cmd_run "$@" ;;
  aggregate) cmd_aggregate "$@" ;;
  validate)  cmd_validate "$@" ;;
  verdict)   cmd_verdict "$@" ;;
  summary)   cmd_summary "$@" ;;
  *) sed -n '2,60p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; [ -z "$sub" ] && exit 2; die "unknown subcommand '$sub'" ;;
esac
