#!/bin/bash
# release_publish_selftest.sh — rehearse the PUBLISH half of desktop-release.yml
#                               without publishing anything.
#
# ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
# release_contract_gate.sh proves the release path's three files NAME the same
# artifact. It is a static gate: it reads text. Nothing in this repository has
# ever EXECUTED the publish step, the acceptance step or the kernel gate, because
# every one of them is `if:`-gated on `github.event_name == 'push' && github.ref
# == 'refs/heads/archdisc'` and that push has never happened. MEASURED
# 2026-09-03: `gh api repos/satvikOS/Forge/releases/latest` -> 404, and
# `gh api repos/satvikOS/Forge/tags` -> 0 tags. The first time that shell runs
# for real will be the run that publishes to users.
#
# That is the same shape of mistake this workflow's own header records about
# itself -- "the only trigger that worked was the one that published" -- one
# layer further in. So this harness runs THE WORKFLOW'S OWN SHELL, extracted
# from the YAML rather than retyped, against a stubbed `gh` and a stubbed `curl`
# that reproduce GitHub's ONE load-bearing rule: `releases/latest` resolves only
# to a release that is neither a draft nor a prerelease.
#
# Nothing here touches the network, authenticates, tags, or publishes.
#
#   bash forge-desktop/test/release_publish_selftest.sh [--verbose]
#
# ── WHAT IT PROVES, AND WHAT IT CANNOT ───────────────────────────────────────
# PROVES (by execution): the version derivation, against real git repositories,
# deep and shallow, and both brake spellings; which steps run in each event
# context; the kernel gate's three outcomes; first publish, re-run no-op,
# partial-publication repair, a tag that points elsewhere with and without a
# release, a tag ref the API cannot be asked about, both ordering refusals, an
# API that exits 0 having left the release a DRAFT, and that nothing marks the
# release visible until all four assets are up; the acceptance step passing on a
# correct publication and failing on each way a release can be invisible or
# wrong; and the final proof step turning a green build that published nothing
# into a red one.
#
# CANNOT PROVE (needs the real API, i.e. the first merge): that GITHUB_TOKEN with
# `contents: write` may create a tag and a release in THIS repository; that
# GitHub serves an asset under the basename we uploaded; that `releases/latest`
# propagates inside the acceptance step's retry budget; and that creating a tag
# with GITHUB_TOKEN does not start a second workflow run.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WF="$ROOT/.github/workflows/desktop-release.yml"
SIM="$ROOT/forge-desktop/test/release_sim"
VERBOSE=0
case " $* " in *" --verbose "*) VERBOSE=1 ;; esac

for f in "$WF" "$SIM/extract_step.py" "$SIM/eval_if.py" "$SIM/gh" "$SIM/curl" \
         "$ROOT/forge-desktop/test/release_visibility_check.sh"; do
  [ -e "$f" ] || { echo "[publish-sim] FATAL: $f not found" >&2; exit 2; }
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge-publish-sim.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
fails=0; checks=0
say() { echo "[publish-sim] $*"; }
ok()  { checks=$((checks+1)); echo "[publish-sim]   ok    $*"; }
bad() { checks=$((checks+1)); fails=$((fails+1)); echo "[publish-sim]   FAIL  $*" >&2; }

SIM_SHA="c0ffee1234567890c0ffee1234567890c0ffee12"
SIM_VERSION="0.1.2969"
SIM_TAG="v${SIM_VERSION}"
REPO="satvikOS/Forge"

# ═════════════════════════════════════════════════════════════════════════════
# 0. THE VERSION. Everything downstream is a function of it: the tag, the payload
#    URL, Info.plist, and whether an installed copy sees the release at all. The
#    header claims the automatic version is monotonic and a function of the
#    commit; both claims are about `git rev-list --count HEAD`, which is SILENTLY
#    WRONG on the depth-1 clone actions/checkout takes by default. Executed here
#    against real repositories rather than reasoned about.
say "0. the version derivation, run against real git repositories"

VERDIR="$WORK/verrepo"
mkdir -p "$VERDIR"
( cd "$VERDIR" && git init -q . && git config user.email s@e && git config user.name s \
  && for i in 1 2 3 4 5 6 7; do echo $i > f && git add f && git commit -qm "c$i"; done ) >/dev/null 2>&1
git clone -q --depth 1 "file://$VERDIR" "$WORK/verrepo-shallow" >/dev/null 2>&1

ver_arm() { # name repo event ref ref_type brake  expect-version expect-tag expect-mode expect-exit
  local name="$1" repo="$2" ev="$3" ref="$4" rt="$5" brake="$6" xv="$7" xt="$8" xm="$9" xrc="${10}"
  local out="$WORK/ver.$RANDOM.out"
  ( cd "$repo" && python3 "$SIM/extract_step.py" "$WF" ver run > "$repo/.ver.sh" \
    && env GITHUB_REF_TYPE="$rt" GITHUB_REF="$ref" GITHUB_EVENT_NAME="$ev" \
           GITHUB_REF_NAME="${ref##*/}" \
           GITHUB_SHA=27875b48aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
           FORGE_VERSION_LINE=0.1 FORGE_AUTORELEASE="$brake" \
           GITHUB_OUTPUT="$out" GITHUB_STEP_SUMMARY=/dev/null \
           bash "$repo/.ver.sh" ) > "$out.log" 2>&1
  local rc=$? v t m
  v="$(sed -n 's/^version=//p' "$out" 2>/dev/null | tail -1)"
  t="$(sed -n 's/^tag=//p'     "$out" 2>/dev/null | tail -1)"
  m="$(sed -n 's/^mode=//p'    "$out" 2>/dev/null | tail -1)"
  [ "$VERBOSE" = 1 ] && sed 's/^/[publish-sim]      | /' "$out.log"
  if [ "$rc" = "$xrc" ] && [ "$v" = "$xv" ] && [ "$t" = "$xt" ] && [ "$m" = "$xm" ]; then
    ok "$name -> version='$v' tag='$t' mode='$m' exit=$rc"
  else
    bad "$name -> version='$v' tag='$t' mode='$m' exit=$rc (expected '$xv'/'$xt'/'$xm'/$xrc)"
  fi
}

ver_arm "a push to archdisc (7 commits)" "$VERDIR" \
  push refs/heads/archdisc branch ''      0.1.7 v0.1.7 auto 0
ver_arm "the same push with FORGE_AUTORELEASE=off" "$VERDIR" \
  push refs/heads/archdisc branch off     0.1.7 v0.1.7 brake 0
# ★ A BRAKE THAT FAILS OPEN ON A TYPO IS NOT A BRAKE. `OFF` and `false` are how
#   someone actually tries to stop a publication; both used to mean 'on'.
ver_arm "FORGE_AUTORELEASE=OFF still brakes (case is forgiven)" "$VERDIR" \
  push refs/heads/archdisc branch OFF     0.1.7 v0.1.7 brake 0
ver_arm "FORGE_AUTORELEASE=false is REFUSED, not read as 'on'" "$VERDIR" \
  push refs/heads/archdisc branch false   '' '' '' 1

ver_arm "a pushed tag owns its own version" "$VERDIR" \
  push v2.5.1 tag ''                      2.5.1 v2.5.1 tag 0
ver_arm "a dispatch is stamped unreleasable" "$VERDIR" \
  workflow_dispatch refs/heads/archdisc branch '' \
  "0.0.0-dev+27875b4" "v0.0.0-dev+27875b4" dryrun 0
# ★ THE ONE THAT WOULD SHIP A VERSION THAT GOES BACKWARDS. A depth-1 clone makes
#   `git rev-list --count HEAD` report 1, so the release would be 0.1.1 -- below
#   anything already published, and a tag that collides with a real one.
ver_arm "a SHALLOW checkout is refused, not silently versioned 0.1.1" "$WORK/verrepo-shallow" \
  push refs/heads/archdisc branch ''      '' '' '' 1
grep -q 'checkout is SHALLOW' "$WORK"/ver.*.log 2>/dev/null \
  && ok "  and it says which knob to restore (fetch-depth: 0)" \
  || bad "  the shallow refusal did not name fetch-depth"

# ═════════════════════════════════════════════════════════════════════════════
# 1. WHICH STEPS RUN. The `if:` expressions are the whole safety argument of this
#    workflow -- "a dispatch cannot publish" is a claim about them -- and an
#    `if:` that evaluates the wrong way produces a GREEN job, never an error.
#    Extracted from the YAML and evaluated, never read by eye.
say "1. step gating: evaluate every publish-path 'if:' in each real context"

gate_of() { python3 "$SIM/extract_step.py" "$WF" "$1" if 2>/dev/null; }
KG_IF="$(gate_of kgate)"; PB_IF="$(gate_of publish)"; AC_IF="$(gate_of acceptance)"
[ -n "$KG_IF$PB_IF$AC_IF" ] || { echo "[publish-sim] FATAL: could not extract the if: expressions" >&2; exit 2; }

ctx() { # $1=event $2=ref $3=ref_type $4=mode $5=kgate
  cat > "$WORK/ctx.json" <<CTX
{"github.event_name":"$1","github.ref":"$2","github.ref_type":"$3",
 "steps.ver.outputs.mode":"$4","steps.kgate.outputs.gate":"$5"}
CTX
}
ev() { python3 "$SIM/eval_if.py" "$1" "$WORK/ctx.json"; }

expect_gating() { # name event ref ref_type mode kgate  want_kgate want_publish want_accept
  local name="$1"; shift
  ctx "$1" "$2" "$3" "$4" "$5"; shift 5
  local wk="$1" wp="$2" wa="$3"
  local gk gp ga; gk="$(ev "$KG_IF")"; gp="$(ev "$PB_IF")"; ga="$(ev "$AC_IF")"
  [ "$VERBOSE" = 1 ] && say "   $name -> kgate=$gk publish=$gp acceptance=$ga"
  if [ "$gk" = "$wk" ] && [ "$gp" = "$wp" ] && [ "$ga" = "$wa" ]; then
    ok "$name: kgate=$gk publish=$gp acceptance=$ga"
  else
    bad "$name: kgate=$gk publish=$gp acceptance=$ga (expected $wk/$wp/$wa)"
  fi
}

# The two claims the header makes about safety.
expect_gating "workflow_dispatch on archdisc CANNOT publish" \
  workflow_dispatch refs/heads/archdisc branch dryrun ''      false false false
expect_gating "workflow_dispatch on a feature branch CANNOT publish" \
  workflow_dispatch refs/heads/feature/x branch dryrun ''     false false false
expect_gating "a pushed TAG takes the draft path, not the auto path" \
  push refs/tags/v0.1.0 tag tag ''                            false false false
expect_gating "a push to a NON-archdisc branch publishes nothing" \
  push refs/heads/feature/x branch dryrun ''                  false false false
expect_gating "the FORGE_AUTORELEASE brake stops the whole publish path" \
  push refs/heads/archdisc branch brake ''                    false false false
expect_gating "a green archdisc push runs all three" \
  push refs/heads/archdisc branch auto go                     true  true  true

# ★ The one the design turns on. The kernel gate deliberately answers 'skip'
#   when kernel-tests was CANCELLED, and the workflow documents that as "NOT an
#   error ... self-healing". MEASURED on this repo the same day: 9 of the last 15
#   archdisc pushes had kernel-tests CANCELLED, so this is the COMMON path.
expect_gating "kernel-tests CANCELLED: publish skipped, acceptance must skip too" \
  push refs/heads/archdisc branch auto skip                   true  false false

# ═════════════════════════════════════════════════════════════════════════════
# fixtures
mkfixture() { # $1 = sandbox dir, $2 = version
  local d="$1" v="$2"
  mkdir -p "$d/forge-desktop/dist" "$d/forge-desktop/test"
  cp "$ROOT/forge-desktop/test/release_visibility_check.sh" "$d/forge-desktop/test/"
  head -c 65536 /dev/urandom > "$d/forge-desktop/dist/Forge-macos-arm64-$v.zip"
  ( cd "$d/forge-desktop/dist" && shasum -a 256 "Forge-macos-arm64-$v.zip" \
      > "Forge-macos-arm64-$v.zip.sha256" )
  printf '{"measured_floor":"15.0"}\n' > "$d/forge-desktop/dist/Forge-macos-arm64-$v.dryrun.json"
  bash "$ROOT/forge-desktop/emit_appcast.sh" --version "$v" --repo "$REPO" \
    --zip "$d/forge-desktop/dist/Forge-macos-arm64-$v.zip" --min-macos 15.0 \
    --out "$d/forge-desktop/dist/appcast.json" >/dev/null
  printf 'notes for %s\n' "$v" > "$d/forge-desktop/dist/Forge-macos-arm64-$v.notes.md"
  mkdir -p "$d/state"
}

runstep() { # $1 = step id, $2 = sandbox, $3 = version, $4.. = extra env
  local id="$1" d="$2" v="$3"; shift 3
  python3 "$SIM/extract_step.py" "$WF" "$id" run > "$d/$id.sh" || return 99
  ( cd "$d" && PATH="$SIM:$PATH" env \
      FORGE_SIM_STATE="$d/state/state.json" FORGE_SIM_LOG="$d/state/calls.log" \
      GITHUB_SHA="$SIM_SHA" GITHUB_REPOSITORY="$REPO" GH_TOKEN=stub \
      GITHUB_SERVER_URL="https://github.com" GITHUB_REF=refs/heads/archdisc \
      GITHUB_REF_TYPE=branch GITHUB_EVENT_NAME=push \
      GITHUB_OUTPUT="$d/out.txt" GITHUB_STEP_SUMMARY="$d/summary.md" \
      RUNNER_TEMP="$d/runner-temp" \
      SIM_VERSION="$v" SIM_TAG="v$v" SIM_MODE=auto \
      SIM_NOTES="forge-desktop/dist/Forge-macos-arm64-$v.notes.md" \
      SIM_PUBLISH_STATE="${SIM_PUBLISH_STATE:-}" SIM_KGATE=go \
      "$@" bash "$d/$id.sh" ) > "$d/$id.log" 2>&1
}

arm() { # $1 = short name -> sets ARM to a fresh sandbox
  ARM="$WORK/$1"; rm -rf "$ARM"; mkfixture "$ARM" "$SIM_VERSION"; mkdir -p "$ARM/runner-temp"
}
state() { printf '%s' "$1" > "$ARM/state/state.json"; }
outv()  { sed -n "s/^$1=//p" "$ARM/out.txt" | tail -1; }
show()  { [ "$VERBOSE" = 1 ] && sed 's/^/[publish-sim]      | /' "$ARM/$1.log"; return 0; }

EMPTY='{"releases":[],"tags":{},"kernel_runs":[]}'

# ═════════════════════════════════════════════════════════════════════════════
say "2. the kernel correctness gate: its three documented outcomes, executed"

kgate_arm() { # $1 name, $2 runs-json, $3 expect-exit, $4 expect-gate
  arm "kgate_$1"; state "{\"releases\":[],\"tags\":{},\"kernel_runs\":$2}"
  runstep kgate "$ARM" "$SIM_VERSION"; local rc=$?; show kgate
  local g; g="$(outv gate)"
  if [ "$rc" = "$3" ] && [ "$g" = "$4" ]; then ok "kernel-tests $1 -> exit $rc, gate='$g'"
  else bad "kernel-tests $1 -> exit $rc, gate='$g' (expected exit $3, gate '$4')"; fi
}
kgate_arm success   '[{"status":"completed","conclusion":"success"}]'   0 go
kgate_arm cancelled '[{"status":"completed","conclusion":"cancelled"}]' 0 skip
kgate_arm failure   '[{"status":"completed","conclusion":"failure"}]'   1 stop
kgate_arm "pending, then success" \
  '[{"status":"queued","conclusion":null},{"status":"in_progress","conclusion":null},{"status":"completed","conclusion":"success"}]' 0 go

# ═════════════════════════════════════════════════════════════════════════════
say "3. the publish step, executed against a stubbed release API"

# ── 3a. the FIRST publication: nothing exists at all ─────────────────────────
arm publish_first; state "$EMPTY"
runstep publish "$ARM" "$SIM_VERSION"; rc=$?; show publish
if [ "$rc" != 0 ]; then bad "first publication exited $rc"; else
  ok "first publication succeeds (state='$(outv state)')"
  [ "$(outv state)" = created ] || bad "expected state=created, got '$(outv state)'"
  python3 - "$ARM/state/state.json" "$SIM_TAG" <<'PY' || bad "the created release is not visible to an installed copy"
import json,sys
r=[x for x in json.load(open(sys.argv[1]))["releases"] if x["tag_name"]==sys.argv[2]][0]
assert r["draft"] is False and r["prerelease"] is False and r["latest"] is True, r
need={"Forge-macos-arm64-0.1.2969.zip","Forge-macos-arm64-0.1.2969.zip.sha256",
      "Forge-macos-arm64-0.1.2969.dryrun.json","appcast.json"}
assert need <= set(r["assets"]), sorted(set(r["assets"]))
PY
  ok "  it is draft=false prerelease=false latest=true and carries all four assets"
fi

# ── 3b. re-running the SAME commit must publish nothing second ───────────────
arm publish_rerun
state '{"releases":[{"tag_name":"v0.1.2969","draft":false,"prerelease":false,"latest":true,
 "target_commitish":"c0ffee1234567890c0ffee1234567890c0ffee12",
 "assets":["Forge-macos-arm64-0.1.2969.zip","Forge-macos-arm64-0.1.2969.zip.sha256",
           "Forge-macos-arm64-0.1.2969.dryrun.json","appcast.json"]}],
 "tags":{"v0.1.2969":{"type":"commit","sha":"c0ffee1234567890c0ffee1234567890c0ffee12"}},
 "kernel_runs":[]}'
runstep publish "$ARM" "$SIM_VERSION"; rc=$?; show publish
[ "$rc" = 0 ] && [ "$(outv state)" = noop ] \
  && ok "a re-run of the same commit is a no-op (state=noop)" \
  || bad "re-run gave exit $rc state='$(outv state)' (expected 0 / noop)"
grep -q '^create' "$ARM/state/calls.log" 2>/dev/null \
  && bad "the re-run created a SECOND release for a commit that already had one" \
  || ok "  and it created no second release"

# ── 3c. a run that died between create and upload must be REPAIRED ───────────
arm publish_repair
state '{"releases":[{"tag_name":"v0.1.2969","draft":false,"prerelease":false,"latest":true,
 "target_commitish":"c0ffee1234567890c0ffee1234567890c0ffee12","assets":[]}],
 "tags":{"v0.1.2969":{"type":"commit","sha":"c0ffee1234567890c0ffee1234567890c0ffee12"}},
 "kernel_runs":[]}'
runstep publish "$ARM" "$SIM_VERSION"; rc=$?; show publish
[ "$rc" = 0 ] && [ "$(outv state)" = repaired ] \
  && ok "a release that is 'latest' with no assets is repaired, not left broken" \
  || bad "partial publication gave exit $rc state='$(outv state)' (expected 0 / repaired)"

# ── 3d. the tag exists but points somewhere else ─────────────────────────────
arm publish_collision
state '{"releases":[{"tag_name":"v0.1.2969","draft":false,"prerelease":false,"latest":true,
 "target_commitish":"deadbeef","assets":[]}],
 "tags":{"v0.1.2969":{"type":"commit","sha":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}},
 "kernel_runs":[]}'
runstep publish "$ARM" "$SIM_VERSION"; rc=$?; show publish
[ "$rc" != 0 ] && grep -q 'already exists and points at' "$ARM/publish.log" \
  && ok "a tag that points at a DIFFERENT commit is refused, not overwritten" \
  || bad "a colliding tag exited $rc without the collision error"

# ── 3d-bis. the TAG exists with no release at all ────────────────────────────
# `--target` is IGNORED by `gh release create` when the tag already exists, so
# without a check on the git ref this build's zip lands on a release that names a
# different commit -- and every downstream check still passes, because the
# appcast, the digest and the payload are all consistent with each other.
arm publish_orphan_tag
state '{"releases":[],
 "tags":{"v0.1.2969":{"type":"commit","sha":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}},
 "kernel_runs":[]}'
runstep publish "$ARM" "$SIM_VERSION"; rc=$?; show publish
[ "$rc" != 0 ] && grep -q 'already exists and points at' "$ARM/publish.log" \
  && ok "a tag that exists with NO release, pointing elsewhere, is refused" \
  || bad "an orphan tag at another commit was not refused (exit $rc)"

# ── 3d-ter. an API that cannot answer must not be read as "no tag here" ──────
# The ref read used to be `gh api ... || echo '{}'`, which turned a rate limit or
# a brief outage into "the tag does not exist" and silently skipped the check
# above. "I could not ask" must never be reported as "the answer was fine".
arm publish_ref_unreadable
state '{"releases":[],"tags":{},"kernel_runs":[],"api_fail_ref":"Bad gateway (HTTP 502)"}'
runstep publish "$ARM" "$SIM_VERSION"; rc=$?; show publish
[ "$rc" != 0 ] && grep -q 'not a 404' "$ARM/publish.log" \
  && ok "a non-404 failure reading the tag ref refuses to publish" \
  || bad "a 502 on the tag-ref read was treated as 'no such tag' (exit $rc)"

# ── 3e. the version must order above what is already published ───────────────
arm publish_backwards
state '{"releases":[{"tag_name":"v0.1.3000","draft":false,"prerelease":false,"latest":true,
 "target_commitish":"abc","assets":["appcast.json"]}],"tags":{},"kernel_runs":[]}'
runstep publish "$ARM" "$SIM_VERSION"; rc=$?; show publish
[ "$rc" != 0 ] && grep -q "does not order above" "$ARM/publish.log" \
  && ok "a version that would go BACKWARDS (0.1.2969 under a published 0.1.3000) is refused" \
  || bad "a backwards version exited $rc without the monotonic refusal"

# ── 3f. ★ the API is asked, not the exit code ────────────────────────────────
# `gh release create` exiting 0 is not evidence about what was created. Here the
# stub creates a DRAFT no matter what flags it was passed -- the exact silent
# failure that leaves releases/latest a 404 -- and the step must still go red.
arm publish_lying_api
state '{"releases":[],"tags":{},"kernel_runs":[],"lie_on_edit":{"draft":true}}'
runstep publish "$ARM" "$SIM_VERSION"; rc=$?; show publish
[ "$rc" != 0 ] && grep -q "is draft/prerelease" "$ARM/publish.log" \
  && ok "an API that exits 0 and leaves the release a DRAFT is caught by re-reading it" \
  || bad "the step trusted its own flags: exit $rc with no draft/prerelease error"

# ── 3f-bis. ★ the release must not become `latest` before its assets exist ───
# `--latest` at create time makes releases/latest/download/appcast.json resolve
# for real users BEFORE a single asset is attached, and the uploads that follow
# are separate requests that can fail or be slow. Proved from the ORDER of the
# calls the step actually made, not from reading the YAML.
arm publish_order; state "$EMPTY"
runstep publish "$ARM" "$SIM_VERSION" >/dev/null 2>&1
if python3 "$SIM/check_order.py" "$ARM/state/calls.log"; then
  ok "nothing makes the release visible until all four assets are uploaded"
else
  bad "the release became non-draft/latest before its assets were attached"
fi

# ── 3g. ★ re-running an OLD commit must not drag `latest` BACKWARDS ──────────
# `gh release edit --draft=false --prerelease=false --latest` in the
# already-exists branch is unconditional, and GitHub's `--latest` MOVES the
# pointer. Re-running a superseded commit's workflow (one click in the Actions
# UI) therefore republishes an older build as the one every new download and
# every update check resolves to -- and the acceptance step agrees, because it
# only asks whether `latest` names THIS run's version.
arm publish_steals_latest
state '{"releases":[
 {"tag_name":"v0.1.2969","draft":false,"prerelease":false,"latest":false,
  "target_commitish":"c0ffee1234567890c0ffee1234567890c0ffee12",
  "assets":["Forge-macos-arm64-0.1.2969.zip","Forge-macos-arm64-0.1.2969.zip.sha256",
            "Forge-macos-arm64-0.1.2969.dryrun.json","appcast.json"]},
 {"tag_name":"v0.1.3000","draft":false,"prerelease":false,"latest":true,
  "target_commitish":"newer","assets":["appcast.json"]}],
 "tags":{"v0.1.2969":{"type":"commit","sha":"c0ffee1234567890c0ffee1234567890c0ffee12"}},
 "kernel_runs":[]}'
runstep publish "$ARM" "$SIM_VERSION"; rc=$?; show publish
NOWLATEST="$(python3 -c 'import json,sys
s=json.load(open(sys.argv[1]))
print(next((r["tag_name"] for r in s["releases"] if r.get("latest")), "<none>"))' "$ARM/state/state.json")"
if [ "$rc" != 0 ] || [ "$NOWLATEST" = "v0.1.3000" ]; then
  ok "re-running a superseded commit does not drag 'latest' back to $SIM_TAG (latest=$NOWLATEST)"
else
  bad "re-running a superseded commit moved 'latest' BACKWARDS to $NOWLATEST — every new download and every update check would resolve to the older build"
fi

# ═════════════════════════════════════════════════════════════════════════════
say "4. the acceptance step, executed against the URL an installed Forge fetches"

accept_after_publish() { # runs publish then acceptance in one sandbox
  arm "$1"; state "${2:-$EMPTY}"
  SIM_PUBLISH_STATE="" runstep publish "$ARM" "$SIM_VERSION" >/dev/null 2>&1
  SIM_PUBLISH_STATE="$(outv state)" runstep acceptance "$ARM" "$SIM_VERSION"
}

# ── 4a. the positive control ─────────────────────────────────────────────────
accept_after_publish accept_good; rc=$?; show acceptance
[ "$rc" = 0 ] && ok "after a correct publication the acceptance step passes" \
  || { bad "acceptance failed (exit $rc) on a correct publication"; sed 's/^/[publish-sim]      | /' "$ARM/acceptance.log" >&2; }
grep -q 'resolved to version 0.1.2969' "$ARM/acceptance.log" \
  && ok "  it read the live releases/latest/download/appcast.json and got this version" \
  || bad "  it did not report resolving the live URL to this version"

# ── 4b. published, but as a PRERELEASE: GitHub's `latest` skips it ───────────
arm accept_prerelease; state "$EMPTY"
SIM_PUBLISH_STATE="" runstep publish "$ARM" "$SIM_VERSION" >/dev/null 2>&1
python3 - "$ARM/state/state.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1])); s["releases"][0]["prerelease"]=True
json.dump(s,open(sys.argv[1],"w"))
PY
SIM_PUBLISH_STATE=created runstep acceptance "$ARM" "$SIM_VERSION"; rc=$?; show acceptance
[ "$rc" != 0 ] && ok "a PRERELEASE release fails acceptance (latest skips it)" \
  || bad "acceptance PASSED on a prerelease — the invisible-release defect would ship"

# ── 4c. published, but left a DRAFT ──────────────────────────────────────────
arm accept_draft; state "$EMPTY"
SIM_PUBLISH_STATE="" runstep publish "$ARM" "$SIM_VERSION" >/dev/null 2>&1
python3 - "$ARM/state/state.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1])); s["releases"][0]["draft"]=True
json.dump(s,open(sys.argv[1],"w"))
PY
SIM_PUBLISH_STATE=created runstep acceptance "$ARM" "$SIM_VERSION"; rc=$?; show acceptance
[ "$rc" != 0 ] && ok "a DRAFT release fails acceptance (latest skips it)" \
  || bad "acceptance PASSED on a draft — the invisible-release defect would ship"

# ── 4d. `latest` resolves, but to the PREVIOUS release ───────────────────────
arm accept_stale
state '{"releases":[{"tag_name":"v0.1.2900","draft":false,"prerelease":false,"latest":true,
 "target_commitish":"old","assets":["appcast.json"]}],"tags":{},"kernel_runs":[]}'
mkdir -p "$ARM/state/served/v0.1.2900"
bash "$ROOT/forge-desktop/emit_appcast.sh" --version 0.1.2900 --repo "$REPO" \
  --zip "$ARM/forge-desktop/dist/Forge-macos-arm64-$SIM_VERSION.zip" --min-macos 15.0 \
  --out "$ARM/state/served/v0.1.2900/appcast.json" >/dev/null
SIM_PUBLISH_STATE=created runstep acceptance "$ARM" "$SIM_VERSION"; rc=$?; show acceptance
[ "$rc" != 0 ] && grep -q "did not resolve to version $SIM_VERSION" "$ARM/acceptance.log" \
  && ok "a 'latest' that still names the PREVIOUS release fails acceptance" \
  || bad "acceptance tolerated a stale 'latest' (exit $rc)"

# ── 4e. the payload the appcast names must be the bytes that were published ──
arm accept_bad_digest; state "$EMPTY"
SIM_PUBLISH_STATE="" runstep publish "$ARM" "$SIM_VERSION" >/dev/null 2>&1
head -c 65536 /dev/urandom > "$ARM/state/served/$SIM_TAG/Forge-macos-arm64-$SIM_VERSION.zip"
SIM_PUBLISH_STATE=created runstep acceptance "$ARM" "$SIM_VERSION"; rc=$?; show acceptance
[ "$rc" != 0 ] && ok "a payload whose digest does not match the appcast fails acceptance" \
  || bad "acceptance PASSED on a payload that does not hash to what the appcast declares"

# ═════════════════════════════════════════════════════════════════════════════
# 4b. THE STEP THAT TURNS A SILENT SKIP INTO A RED BUILD. It carries no `if:`,
#     so it runs on every green job, and it is the only thing standing between
#     "this build published nothing" and "this build was green". It had never
#     run either. Driven here with each combination it has to judge.
say "4b. the final proof step: a green job that published nothing must be RED"

prove_arm() { # name  event ref mode kgate publish_outcome publish_state accept  expect-exit
  local name="$1" ev="$2" ref="$3" mode="$4" kg="$5" po="$6" ps="$7" ao="$8" xrc="$9"
  local d="$WORK/prove.$RANDOM"; mkdir -p "$d"
  python3 "$SIM/extract_step.py" "$WF" prove run > "$d/prove.sh" || { bad "$name: could not extract the step"; return; }
  ( cd "$d" && env GITHUB_EVENT_NAME="$ev" GITHUB_REF="$ref" GITHUB_REF_TYPE=branch \
      MODE="$mode" KGATE="$kg" PUBLISH_OUTCOME="$po" PUBLISH_STATE="$ps" ACCEPT_OUTCOME="$ao" \
      bash "$d/prove.sh" ) > "$d/log" 2>&1
  local rc=$?
  [ "$VERBOSE" = 1 ] && sed 's/^/[publish-sim]      | /' "$d/log"
  [ "$rc" = "$xrc" ] && ok "$name -> exit $rc" || bad "$name -> exit $rc (expected $xrc)"
}

prove_arm "a real publication passes" \
  push refs/heads/archdisc auto go success created success 0
prove_arm "★ a GREEN build that published NOTHING is RED" \
  push refs/heads/archdisc auto go skipped '' skipped 1
prove_arm "★ acceptance skipped while publish ran is RED" \
  push refs/heads/archdisc auto go success created skipped 1
prove_arm "the FORGE_AUTORELEASE brake is a tolerated, announced skip" \
  push refs/heads/archdisc brake '' skipped '' skipped 0
prove_arm "a superseded commit (kernel gate 'skip') is a tolerated, announced skip" \
  push refs/heads/archdisc auto skip skipped '' skipped 0
prove_arm "a dispatch is not expected to publish" \
  workflow_dispatch refs/heads/archdisc dryrun '' skipped '' skipped 0
prove_arm "a pushed tag is not expected to publish here" \
  push refs/tags/v0.1.0 tag '' skipped '' skipped 0

# ═════════════════════════════════════════════════════════════════════════════
# 5. NEGATIVE CONTROLS. A gate nobody has seen fail is silence, and that applies
#    hardest to a harness whose whole claim is "we rehearsed the thing that has
#    never run". Each mutation below leaves the workflow valid YAML, leaves every
#    other gate in this repository green, and puts the release path back into one
#    of the states it exists to prevent. Run against a COPY, and the harness
#    re-invokes ITSELF there rather than re-implementing its checks, so a check
#    that stops working stops being provable here too.
if [ "${1:-}" = "--mutations" ] || [ "${2:-}" = "--mutations" ]; then
  say "5. negative controls — each MUST make this harness go red"
  mut_n=0; mut_caught=0
  run_mutation() {  # $1 = name, $2 = relative path, $3 = python: rewrite `s`
    local name="$1" rel="$2" code="$3"
    mut_n=$((mut_n + 1))
    local dir="$WORK/mut$mut_n"
    rm -rf "$dir"; mkdir -p "$dir/.github/workflows"
    ( cd "$ROOT" && tar cf - forge-desktop .github/workflows/desktop-release.yml ) \
      | ( cd "$dir" && tar xf - )
    MUT_FILE="$dir/$rel" MUT_CODE="$code" python3 - <<'MUTATE'
import os, sys
p = os.environ["MUT_FILE"]
s = open(p, encoding="utf-8").read()
before = s
exec(os.environ["MUT_CODE"])
if s == before:
    sys.stderr.write("mutation changed NOTHING\n"); sys.exit(1)
open(p, "w", encoding="utf-8").write(s)
MUTATE
    if [ $? -ne 0 ]; then
      echo "[publish-sim]   FAIL  mutation '$name' changed NOTHING — it cannot prove anything" >&2
      fails=$((fails + 1)); return
    fi
    if bash "$dir/forge-desktop/test/release_publish_selftest.sh" >"$dir/out.log" 2>&1; then
      echo "[publish-sim]   FAIL  mutation '$name' was NOT caught" >&2
      fails=$((fails + 1))
    else
      say "  caught: $name"; mut_caught=$((mut_caught + 1))
    fi
  }
  W=".github/workflows/desktop-release.yml"

  run_mutation "the acceptance step stops carrying the kernel gate's answer" "$W" \
    's = s.replace("""          && steps.kgate.outputs.gate == '"'"'go'"'"'\n        id: acceptance""", """        id: acceptance""")'
  run_mutation "the automatic release is never taken OUT of draft" "$W" \
    's = s.replace("""            gh release edit "$TAG" --draft=false --prerelease=false --latest\n""", """""")'
  run_mutation "the release is made visible BEFORE its assets are uploaded" "$W" \
    'a = """              --notes-file "$NOTES"\n            gh release upload"""; s = s.replace(a, """              --notes-file "$NOTES"\n            gh release edit "$TAG" --draft=false --prerelease=false --latest\n            gh release upload""", 1)'
  run_mutation "the automatic release stops being marked latest at all" "$W" \
    's = s.replace("""            gh release edit "$TAG" --draft=false --prerelease=false --latest\n            STATE=created""", """            gh release edit "$TAG" --draft=false --prerelease=false\n            STATE=created""")'
  run_mutation "the two flags are trusted from the exit code instead of re-read" "$W" \
    's = s.replace("""[ "$FLAGS" = "false false" ]""", """[ -n "$FLAGS" ]""")'
  run_mutation "the existing-release branch stops guarding what it marks latest" "$W" \
    's = s.replace("""              assert_ordering "$PREV" "$TAG" not-below\n""", "")'
  run_mutation "the shallow-checkout refusal is defanged" "$W" \
    's = s.replace(chr(33)+chr(61)+chr(32)+chr(34)+"false"+chr(34)+" ]; then", chr(33)+chr(61)+chr(32)+chr(34)+"never"+chr(34)+" ]; then")'
  run_mutation "the tag-points-elsewhere check is made vacuous" "$W" \
    's = s.replace(chr(34)+"$OBJ_SHA"+chr(34)+" != "+chr(34)+"$GITHUB_SHA"+chr(34), chr(34)+"$OBJ_SHA"+chr(34)+" != "+chr(34)+"$OBJ_SHA"+chr(34))'
  run_mutation "the proof step reports the failure and exits 0 anyway" "$W" \
    's = s.replace("""is a RED build rather than a quiet one."\n            exit 1""", """is a RED build rather than a quiet one."\n            exit 0""")'
  run_mutation "the brake goes back to failing OPEN on a typo" "$W" \
    's = s.replace("""            *) echo "::error::repository variable FORGE_AUTORELEASE""", """            unreachable) echo "::error::repository variable FORGE_AUTORELEASE""")'

  say "negative controls: $mut_caught of $mut_n caught"
  [ "$mut_caught" -eq "$mut_n" ] || fails=$((fails + 1))
fi

echo
if [ "$fails" -eq 0 ]; then
  say "PASS — $checks checks, the publish path behaves as documented in every arm above"
  exit 0
fi
say "$fails of $checks check(s) failed"
exit 1
