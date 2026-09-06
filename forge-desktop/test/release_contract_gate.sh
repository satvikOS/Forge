#!/bin/bash
# release_contract_gate.sh — the RELEASE PATH and the APPCAST must name the same
#                            file, and the shipped bundle must carry the code
#                            that can install it.
#
# WHY THIS FILE EXISTS
# --------------------
# appcast_selftest.sh already proves the PRODUCER and the CONSUMER agree: the
# emitter writes a document the app's own parser accepts, with the digest of the
# file it was handed. That is a complete proof about the DOCUMENT and says
# nothing about the RELEASE.
#
# The release path spells the artifact's name THREE times, in three files that
# nothing compares:
#
#   forge-desktop/package_macos.sh        names the zip it creates
#   .github/workflows/desktop-release.yml names the zip it uploads
#   forge-desktop/emit_appcast.sh         names the zip inside the payload URL
#
# Change one and the other two still pass every existing gate. The result is a
# release whose appcast points at a URL GitHub answers with 404 — and the first
# place anyone learns that is an installed copy on a user's machine, which
# reports "update check failed" and stays on the old version for ever. The
# packaging half is green, the update half is green, and the product is broken
# in the seam between them.
#
# WHAT THIS GATE CHECKS
# ---------------------
#   1. THE THREE NAMES ARE ONE NAME. Each expression is EXTRACTED from the file
#      that owns it and EVALUATED, never retyped here. A gate that restates the
#      literal it is guarding proves only that someone typed it twice.
#   2. The tag the workflow publishes under is the tag the appcast's payload URL
#      points into, derived by running the workflow's OWN version expression.
#   3. appcast.json reaches the release AND is retained by a dry run. The second
#      half matters as much: this workflow's history is a file whose only working
#      trigger was the one that published, and an appcast a human cannot inspect
#      before tagging is that mistake again in a smaller place.
#   4. The bundle carries BOTH extra executables: forge_kernel_worker (crash
#      isolation) and forge_update (the apply path). A bundle without the second
#      can detect an update and cannot install one, which is the whole
#      requirement failing silently on the last inch.
#   5. The app and the emitter agree on WHICH REPOSITORY. kDefaultAppcastUrl is
#      compiled into every shipped copy; emit_appcast.sh has its own default. If
#      those drift, installed apps read one repo's appcast for ever while
#      releases go to another, and no later release can repair it — the client
#      doing the reading is the OLD BINARY.
#   6. END TO END: the REAL emitter is run for a simulated tag, and the app's
#      REAL parser is asked which URL it would fetch. That string is compared
#      with the URL derived from the workflow. This is the one check that spans
#      bash, YAML and C++ at once.
#   7. THE AUTOMATIC PATH agrees with itself the same way the tag path does. A
#      push to archdisc derives its own version and its own tag from expressions
#      that nothing else compares, and gets them wrong in exactly the same way:
#      a tag that is not the tag the payload URL enters is a release every
#      installed copy 404s on.
#   8. THE AUTOMATIC RELEASE ENDS UP NEITHER A DRAFT NOR A PRERELEASE, AND ONLY
#      AFTER ITS ASSETS ARE UP. Two requirements, not one, and they pull in
#      opposite directions:
#        * GitHub's `latest` skips drafts and prereleases, and
#          releases/latest/download/appcast.json is the only URL a shipped Forge
#          ever asks for, so either flag left set turns a release that looks
#          perfect on the releases page into one no user can see. Measured
#          2026-09-02: the repository's one existing release has BOTH set and has
#          never been visible.
#        * and `--latest` at CREATE time makes it resolvable before a single
#          asset exists. The uploads are separate requests; in that window real
#          users 404, and a job that dies mid-upload leaves an incomplete release
#          as `latest` until somebody notices.
#      So the automatic path STAGES A DRAFT, uploads all four assets, and then
#      publishes in one `gh release edit`. This checks the shape AND the order.
#   9. THE ACCEPTANCE STEP IS STILL AN ACCEPTANCE TEST. It must fetch the live
#      URL an installed app fetches, and it must NOT be softened with
#      --allow-unreleased, which tolerates "nothing is published" — the single
#      condition the whole step exists to detect.
#  10. Its own negative controls (--mutations). A gate nobody has seen fail is
#      silence.
#
# WHAT IT HONESTLY DOES NOT CHECK
# -------------------------------
#   * That GitHub serves the asset under the basename we uploaded. That is `gh`'s
#     behaviour, not ours, and asserting it would need a published release.
#     release_visibility_check.sh asks that question against the live API.
#   * That the app can install the update. update_gate.cpp proves applyUpdate()
#     end to end offline, including seven negative controls; this gate only
#     proves the binary that calls it reaches the bundle.
#   * Anything about the build. It reads sources; it compiles one small C++
#     checker and nothing else, so it can ride a PR job that never builds OCCT.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$ROOT/forge-desktop/package_macos.sh"
EMIT="$ROOT/forge-desktop/emit_appcast.sh"
DRYRUN="$ROOT/forge-desktop/release_dryrun.sh"
WF="$ROOT/.github/workflows/desktop-release.yml"
UPDHPP="$ROOT/forge-desktop/src/update/Updater.hpp"
DESKTOP="$ROOT/forge-desktop"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge-release-contract.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
fails=0
say() { echo "[release-contract] $*"; }
ok()  { echo "[release-contract]   ok    $*"; }
bad() { echo "[release-contract]   FAIL  $*" >&2; fails=$((fails + 1)); }

for f in "$PKG" "$EMIT" "$DRYRUN" "$WF" "$UPDHPP"; do
  [ -f "$f" ] || { echo "[release-contract] FATAL: $f not found" >&2; exit 2; }
done

# A simulated tag. Nothing is published, nothing is tagged; this is a string.
SIM_TAG="v9.9.9"

# ── extraction helper ────────────────────────────────────────────────────────
# Pulls ONE assignment out of a source file and evaluates it with a controlled
# environment. Refuses a line that could run a command: an asset name built by a
# subshell would be invisible to this gate, which is the same class of defect as
# a generator that cannot see a ternary id. Refusing is the honest answer.
eval_assignment() {   # $1 = file, $2 = grep -E pattern, $3 = var name, $4.. = VAR=VAL prelude
  local file="$1" pat="$2" var="$3"; shift 3
  local line
  line="$(LC_ALL=C grep -E -m1 "$pat" "$file" | sed 's/^[[:space:]]*//')"
  if [ -z "$line" ]; then
    echo "__EXTRACT_FAILED__"
    return 1
  fi
  case "$line" in
    *'$('*|*'`'*|*';'*|*'&'*|*'|'*)
      echo "__UNSAFE_EXPRESSION__"
      return 1 ;;
  esac
  env "$@" bash -c "$line"$'\n''printf %s "${'"$var"'}"'
}

# ═════════════════════════════════════════════════════════════════════════════
say "1. the three spellings of the artifact name"

# (a) the PACKAGER, which is the file that actually creates the zip.
PKG_ZIP="$(eval_assignment "$PKG" '^ZIP="\$DIST/' ZIP DIST=/D VERSION=9.9.9)"
# (b) the WORKFLOW, which is the file that uploads it.
WF_ZIP="$(eval_assignment "$WF" '^[[:space:]]*ZIP="forge-desktop/dist/' ZIP V=9.9.9)"
# (c) the EMITTER, whose payload URL is what an installed app downloads.
URL_TMPL="$(LC_ALL=C sed -n 's/^[[:space:]]*"url": "\(.*\)",$/\1/p' "$EMIT" | head -1)"
if [ -z "$URL_TMPL" ]; then
  APPCAST_URL="__EXTRACT_FAILED__"
else
  case "$URL_TMPL" in
    *'$('*|*'`'*) APPCAST_URL="__UNSAFE_EXPRESSION__" ;;
    *) APPCAST_URL="$(REPO=satvikOS/Forge VERSION=9.9.9 bash -c 'printf %s "'"$URL_TMPL"'"')" ;;
  esac
fi

say "   packager  $PKG_ZIP"
say "   workflow  $WF_ZIP"
say "   appcast   $APPCAST_URL"

case "$PKG_ZIP$WF_ZIP$APPCAST_URL" in
  *__EXTRACT_FAILED__*|*__UNSAFE_EXPRESSION__*)
    bad "could not extract all three names as plain assignments (see above)" ;;
esac

PKG_BASE="${PKG_ZIP##*/}"
WF_BASE="${WF_ZIP##*/}"
URL_BASE="${APPCAST_URL##*/}"

[ "$PKG_BASE" = "$WF_BASE" ] \
  && ok "the workflow uploads the file the packager writes ($PKG_BASE)" \
  || bad "the packager writes '$PKG_BASE' and the workflow uploads '$WF_BASE'"

[ "$PKG_BASE" = "$URL_BASE" ] \
  && ok "the appcast's payload URL names that same file" \
  || bad "the appcast points at '$URL_BASE' but the release carries '$PKG_BASE' — every installed app would 404"

# ═════════════════════════════════════════════════════════════════════════════
say "2. the tag the workflow publishes under is the tag the payload URL enters"

WF_V="$(eval_assignment "$WF" '^[[:space:]]*V="\$\{GITHUB_REF_NAME#v\}"' V GITHUB_REF_NAME="$SIM_TAG")"
WF_TAG="$(eval_assignment "$WF" '^[[:space:]]*TAG="\$\{GITHUB_REF_NAME\}"' TAG GITHUB_REF_NAME="$SIM_TAG")"
say "   tag $SIM_TAG -> version '$WF_V', release tag '$WF_TAG'"

case "$WF_V$WF_TAG" in
  *__EXTRACT_FAILED__*|*__UNSAFE_EXPRESSION__*)
    bad "could not extract the workflow's version/tag derivation" ;;
  *)
    # Re-derive the URL with the version the WORKFLOW computed, not one typed here.
    EXPECT_URL="$(REPO=satvikOS/Forge VERSION="$WF_V" bash -c 'printf %s "'"$URL_TMPL"'"')"
    case "$EXPECT_URL" in
      "https://github.com/satvikOS/Forge/releases/download/$WF_TAG/"*)
        ok "the payload URL enters /releases/download/$WF_TAG/" ;;
      *)
        bad "the payload URL is '$EXPECT_URL' but the workflow publishes under tag '$WF_TAG'" ;;
    esac ;;
esac

# ═════════════════════════════════════════════════════════════════════════════
say "3. appcast.json reaches the release, and a DRY RUN retains it"

LC_ALL=C grep -qE 'gh release upload .*appcast\.json' "$WF" \
  && ok "the publish step uploads appcast.json to the release" \
  || bad "the publish step never uploads appcast.json — the release would carry a zip no installed app can find"

# The dry run must keep the appcast too. Extracted from the upload-artifact
# `path:` block and matched as a GLOB against the real path, so a pattern that
# would not actually capture the file cannot pass by looking plausible.
ART_PATHS="$(LC_ALL=C sed -n '/uses: actions\/upload-artifact/,/if-no-files-found/p' "$WF" \
             | LC_ALL=C sed -n 's/^[[:space:]]*\(forge-desktop\/dist\/[^[:space:]]*\)$/\1/p')"
if [ -z "$ART_PATHS" ]; then
  bad "could not read the upload-artifact path list out of the workflow"
else
  matched=no
  while IFS= read -r glob; do
    [ -n "$glob" ] || continue
    # shellcheck disable=SC2254
    case "forge-desktop/dist/appcast.json" in
      $glob) matched=yes ;;
    esac
  done <<< "$ART_PATHS"
  [ "$matched" = yes ] \
    && ok "a dry run retains appcast.json as a CI artifact, so it can be read before tagging" \
    || bad "no upload-artifact glob captures forge-desktop/dist/appcast.json — the one release output nobody can inspect before publishing is the one every installed app reads"
fi

LC_ALL=C grep -q 'appcast does not describe this build' "$DRYRUN" \
  && ok "release_dryrun.sh fails when the appcast does not describe the zip" \
  || bad "release_dryrun.sh no longer checks the appcast against the zip"

# ═════════════════════════════════════════════════════════════════════════════
say "4. the bundle carries the worker AND the updater"

LC_ALL=C grep -qE '^[[:space:]]*WORKER_SRC=' "$PKG" \
  && ok "package_macos.sh stages forge_kernel_worker" \
  || bad "package_macos.sh no longer stages forge_kernel_worker — the app would ship with NO crash isolation and would not say so"

LC_ALL=C grep -qE '^[[:space:]]*UPDATER_SRC=' "$PKG" \
  && ok "package_macos.sh stages forge_update" \
  || bad "package_macos.sh does not stage forge_update — an installed app could DETECT an update and would have no way to install one"

LC_ALL=C grep -q 'Contents/MacOS/forge_kernel_worker' "$DRYRUN" \
  && ok "release_dryrun.sh asserts the worker reached the bundle" \
  || bad "release_dryrun.sh no longer asserts the worker is in the bundle"

LC_ALL=C grep -q 'Contents/MacOS/forge_update' "$DRYRUN" \
  && ok "release_dryrun.sh asserts the updater reached the bundle" \
  || bad "release_dryrun.sh does not assert forge_update is in the bundle"

# ═════════════════════════════════════════════════════════════════════════════
say "5. the app and the emitter agree on which repository"

APP_URL="$(LC_ALL=C sed -n 's|^[[:space:]]*"\(https://github.com/[^"]*appcast.json\)";$|\1|p' "$UPDHPP" | head -1)"
EMIT_REPO="$(LC_ALL=C sed -n 's/^REPO="\${FORGE_REPO:-\([^}]*\)}"$/\1/p' "$EMIT" | head -1)"
say "   app reads    ${APP_URL:-<none found>}"
say "   emitter repo ${EMIT_REPO:-<none found>}"
if [ -z "$APP_URL" ] || [ -z "$EMIT_REPO" ]; then
  bad "could not read the app's appcast URL and/or the emitter's default repo"
else
  [ "$APP_URL" = "https://github.com/$EMIT_REPO/releases/latest/download/appcast.json" ] \
    && ok "both name $EMIT_REPO, and the app reads the releases/latest/download path" \
    || bad "the app fetches '$APP_URL' but releases are emitted for '$EMIT_REPO' — installed copies would read the wrong repository for ever"
fi

# ═════════════════════════════════════════════════════════════════════════════
say "6. end to end: the emitter writes it, the app's own parser reads the URL back"

CHECK="$WORK/appcast_check"
if ! c++ -std=c++20 -O1 -Wall -Wextra -Werror -I "$DESKTOP/src" -o "$CHECK" \
     "$DESKTOP/src/update/Version.cpp" "$DESKTOP/src/update/Sha256.cpp" \
     "$DESKTOP/src/update/Manifest.cpp" "$DESKTOP/src/update/Updater.cpp" \
     "$DESKTOP/test/appcast_check.cpp" 2>"$WORK/cc.log"; then
  sed 's/^/[release-contract]   /' "$WORK/cc.log" >&2
  echo "[release-contract] FATAL: the app's parser does not compile — a gate that cannot build cannot fail." >&2
  exit 2
fi

# A fixture payload named EXACTLY what the packager would have written.
PAYLOAD="$WORK/$PKG_BASE"
head -c 2048 /dev/urandom > "$PAYLOAD"
bash "$EMIT" --version "$WF_V" --repo satvikOS/Forge --zip "$PAYLOAD" \
     --min-macos 15.0 --out "$WORK/appcast.json" >/dev/null \
  || bad "the emitter refused to describe the simulated release"

if [ -f "$WORK/appcast.json" ]; then
  APP_SEES="$("$CHECK" "$WORK/appcast.json" --running 0.0.1 --expect update --print-url 2>/dev/null \
              | LC_ALL=C sed -n 's/^payload_url=//p')"
  say "   the app would fetch $APP_SEES"
  [ -n "$APP_SEES" ] && [ "$APP_SEES" = "$EXPECT_URL" ] \
    && ok "the URL the APP resolves is the URL the RELEASE will serve" \
    || bad "the app would fetch '$APP_SEES'; the workflow publishes '$EXPECT_URL'"
fi

# ═════════════════════════════════════════════════════════════════════════════
say "7. the AUTOMATIC path derives a tag the payload URL actually enters"

# The tag path is checked above by running the workflow's own expression. The
# automatic path has its OWN two expressions, and they are the ones that run on
# every merge, so they are the ones a mistake reaches users through. Same method:
# EXTRACT and EVALUATE, never retype.
AUTO_V="$(eval_assignment "$WF" '^[[:space:]]*V="\$\{FORGE_VERSION_LINE\}\.\$\{COMMITS\}"' \
          V FORGE_VERSION_LINE=9.9 COMMITS=9)"
AUTO_TAG="$(eval_assignment "$WF" '^[[:space:]]*TAG="v\$\{V\}"' TAG V="$AUTO_V")"
say "   line 9.9 + 9 commits -> version '$AUTO_V', release tag '$AUTO_TAG'"

case "$AUTO_V$AUTO_TAG" in
  *__EXTRACT_FAILED__*|*__UNSAFE_EXPRESSION__*)
    bad "could not extract the automatic path's version/tag derivation from $WF" ;;
  *)
    AUTO_URL="$(REPO=satvikOS/Forge VERSION="$AUTO_V" bash -c 'printf %s "'"$URL_TMPL"'"')"
    say "   an installed app would fetch $AUTO_URL"
    case "$AUTO_URL" in
      "https://github.com/satvikOS/Forge/releases/download/$AUTO_TAG/"*)
        ok "the automatic payload URL enters /releases/download/$AUTO_TAG/" ;;
      *)
        bad "the automatic path publishes tag '$AUTO_TAG' and the appcast points at '$AUTO_URL' — every installed app would 404" ;;
    esac ;;
esac

# ═════════════════════════════════════════════════════════════════════════════
say "8. the automatic release becomes visible, and only after its assets are up"

# Read the actual commands out of the workflow rather than asserting on a
# comment, and read them WITH THEIR LINE NUMBERS, because the order is half the
# requirement. `--target` is what distinguishes the automatic create (which makes
# the tag) from the tag path's create.
#
# BACKSLASH CONTINUATIONS ARE JOINED FIRST. Reading one grep line found
# `--target` and missed the `--latest` on the following line, and would equally
# have missed a `--draft` added there — a flag out of sight on line two is the
# whole failure this check exists for. `index()` rather than a regex so no `$` or
# `"` needs escaping into a shell string into an awk pattern.
AUTO_CREATE="$(LC_ALL=C awk '
  index($0, "gh release create \"$TAG\" --draft --target") {
    buf = $0; sub(/^[ \t]+/, "", buf)
    while (buf ~ /\\$/) {
      sub(/\\[ \t]*$/, "", buf)
      if ((getline nl) <= 0) break
      sub(/^[ \t]+/, " ", nl)
      buf = buf nl
    }
    print NR ": " buf; exit
  }' "$WF")"
if [ -z "$AUTO_CREATE" ]; then
  bad "no automatic 'gh release create \"\$TAG\" --draft --target ...' in $WF — nothing stages a release on green"
else
  say "   $AUTO_CREATE"
  # It is staged INVISIBLE on purpose. --latest or a missing --draft here would
  # make releases/latest resolve before any asset is attached.
  case "$AUTO_CREATE" in
    *--latest*)
      bad "the automatic CREATE passes --latest, so releases/latest resolves to a release with NO assets until the uploads finish — a real user in that window gets a 404, and a job that dies mid-upload leaves it that way" ;;
    *--prerelease*)
      bad "the automatic create marks the release as a PRERELEASE; GitHub's 'latest' skips prereleases" ;;
    *)
      ok "the automatic path STAGES a draft — invisible to 'latest' until it is complete" ;;
  esac
fi

# ...and exactly one command publishes it, in the create branch, AFTER both
# uploads. Line numbers, because "the right commands in the wrong order" is the
# defect this half exists for and no set of greps can see it.
# The region is the create branch itself: from its `gh release create` down to
# the `STATE=created` that closes it. Scoping matters — the pushed-tag path at
# the bottom of the file uploads too, and an unscoped search reads ITS upload as
# the last one and reports a false failure.
CREATE_LINE="${AUTO_CREATE%%:*}"
END_LINE="$(LC_ALL=C awk -v lo="${CREATE_LINE:-0}" '
  NR > lo && $0 ~ /^[ \t]*STATE=created[ \t]*$/ { print NR; exit }' "$WF")"
PUBLISH_LINE="$(LC_ALL=C awk -v lo="${CREATE_LINE:-0}" -v hi="${END_LINE:-0}" '
  NR > lo && NR < hi && index($0, "gh release edit \"$TAG\" --draft=false --prerelease=false --latest") { print NR; exit }' "$WF")"
LAST_UPLOAD="$(LC_ALL=C awk -v lo="${CREATE_LINE:-0}" -v hi="${END_LINE:-0}" '
  NR > lo && NR < hi && index($0, "gh release upload \"$TAG\"") { n = NR } END { print n+0 }' "$WF")"
if [ -z "$END_LINE" ]; then
  bad "could not find the end of the automatic create branch (STATE=created) in $WF"
elif [ -z "$PUBLISH_LINE" ]; then
  bad "nothing runs 'gh release edit --draft=false --prerelease=false --latest' — the staged draft would never be published and no installed copy could see it"
elif [ "$LAST_UPLOAD" -eq 0 ]; then
  bad "no 'gh release upload' follows the automatic create — the release would be published empty"
elif [ "$PUBLISH_LINE" -lt "$LAST_UPLOAD" ]; then
  bad "the release is published (line $PUBLISH_LINE) BEFORE its last asset is uploaded (line $LAST_UPLOAD) — releases/latest would resolve to an incomplete release"
else
  ok "it is published at line $PUBLISH_LINE, after the last upload at line $LAST_UPLOAD, with --draft=false --prerelease=false --latest"
fi

# The two flags are re-read from the API after publishing, because `gh release
# create` exiting 0 is not evidence about what was created.
LC_ALL=C grep -q 'isDraft,isPrerelease' "$WF" \
  && ok "the workflow re-reads isDraft/isPrerelease from the API after publishing" \
  || bad "nothing re-reads the two flags after publishing — the job would go green on the word of the flags it passed"

# The DRAFT path must survive: it is the human escape hatch, and losing it would
# mean a human can no longer stage a release before anyone sees it.
# `--draft --title`, not just `--draft`: the automatic path now stages a draft
# too (`--draft --target`), and a grep that both lines satisfy would report the
# human escape hatch as present after it had been deleted.
LC_ALL=C grep -qE 'gh release create "\$TAG" --draft --title' "$WF" \
  && ok "the pushed-tag path still creates a DRAFT for a human to publish" \
  || bad "the pushed-tag path no longer creates a draft — the manual escape hatch is gone"

# ═════════════════════════════════════════════════════════════════════════════
say "9. the acceptance step still asks the question a green job cannot answer"

LC_ALL=C grep -q 'releases/latest/download/appcast.json' "$WF" \
  && ok "the workflow fetches the live URL an installed Forge fetches" \
  || bad "the workflow never fetches releases/latest/download/appcast.json — 'the job was green' would be the only evidence the release is visible"

# The INVOCATION, not any mention of the script. Grepping the whole file for
# `--allow-unreleased` reported this workflow as softened because a COMMENT
# explains why it is not passed — a check that cannot tell an instruction from a
# note about it will keep finding defects that are not there, and people stop
# reading it.
VIS_CALLS="$(LC_ALL=C grep -E '^[[:space:]]*bash .*release_visibility_check\.sh' "$WF" \
             | sed 's/^[[:space:]]*//' || true)"
if [ -z "$VIS_CALLS" ]; then
  bad "the workflow never RUNS release_visibility_check.sh after publishing — nothing asks the API whether the release is visible"
else
  say "   $VIS_CALLS"
  case "$VIS_CALLS" in
    *--expect-version*) ok "it asks release_visibility_check.sh for a second opinion, pinned to this version" ;;
    *) bad "release_visibility_check.sh is run without --expect-version, so it would pass on ANY published release, including a stale one" ;;
  esac
  # --allow-unreleased tolerates EXACTLY ONE condition: nothing published. That
  # is the correct tolerance for a per-PR job and the WRONG one here, where the
  # step runs immediately after publishing and that condition IS the failure.
  case "$VIS_CALLS" in
    *--allow-unreleased*) bad "the release workflow passes --allow-unreleased, which tolerates 'nothing is published' — the exact state the acceptance step exists to catch" ;;
    *) ok "and NOT with --allow-unreleased, so 'nothing is published' fails the job" ;;
  esac
fi

# ═════════════════════════════════════════════════════════════════════════════
# 10. negative controls — each MUST make this gate go red.
# Run against a COPY of the tree, and the gate re-invokes ITSELF there rather
# than re-implementing its checks, so a check that stops working stops being
# provable here too.
if [ "${1:-}" = "--mutations" ]; then
  say "--- negative controls ---"
  mut_n=0; mut_caught=0
  run_mutation() {  # $1 = name, $2 = relative path to mutate, $3 = sed expression
    local name="$1" rel="$2" sedexpr="$3"
    mut_n=$((mut_n + 1))
    local dir="$WORK/mut$mut_n"
    rm -rf "$dir"; mkdir -p "$dir"
    # A copy of only what this gate reads. tar so symlinks and modes survive.
    (cd "$ROOT" && tar cf - forge-desktop .github/workflows/desktop-release.yml) \
      | (cd "$dir" && tar xf -)
    sed "$sedexpr" "$ROOT/$rel" > "$dir/$rel.tmp" && mv "$dir/$rel.tmp" "$dir/$rel"
    if cmp -s "$dir/$rel" "$ROOT/$rel"; then
      echo "[release-contract]   FAIL  mutation '$name' changed NOTHING — it cannot prove anything" >&2
      fails=$((fails + 1)); return
    fi
    if bash "$dir/forge-desktop/test/release_contract_gate.sh" >/dev/null 2>&1; then
      echo "[release-contract]   FAIL  mutation '$name' was NOT caught" >&2
      fails=$((fails + 1))
    else
      say "  caught: $name"; mut_caught=$((mut_caught + 1))
    fi
  }

  run_mutation "the packager renames the zip" \
    "forge-desktop/package_macos.sh" \
    's|^ZIP="\$DIST/Forge-macos-arm64-\${VERSION}\.zip"|ZIP="$DIST/Forge-${VERSION}-macos.zip"|'
  run_mutation "the appcast's payload URL loses the version from the filename" \
    "forge-desktop/emit_appcast.sh" \
    's|/Forge-macos-arm64-\$VERSION\.zip",|/Forge-macos-arm64.zip",|'
  run_mutation "the appcast points into the wrong tag" \
    "forge-desktop/emit_appcast.sh" \
    's|/releases/download/v\$VERSION/|/releases/download/release-$VERSION/|'
  run_mutation "the publish step stops uploading appcast.json" \
    ".github/workflows/desktop-release.yml" \
    '/gh release upload "\$TAG" "forge-desktop\/dist\/appcast.json" --clobber/d'
  run_mutation "a dry run stops retaining the appcast" \
    ".github/workflows/desktop-release.yml" \
    '/^            forge-desktop\/dist\/appcast\.json$/d'
  run_mutation "the packager stops staging the updater" \
    "forge-desktop/package_macos.sh" \
    's|^UPDATER_SRC=|DISABLED_UPDATER_SRC=|'
  run_mutation "the app is pointed at a different repository" \
    "forge-desktop/src/update/Updater.hpp" \
    's|"https://github.com/satvikOS/Forge/releases/latest/download/appcast.json";|"https://github.com/someone/Else/releases/latest/download/appcast.json";|'

  # ── the automatic path ─────────────────────────────────────────────────────
  # Each of these is a change that leaves the workflow valid YAML, leaves the job
  # green, and silently takes the product back to where it was on 2026-09-02: a
  # release that exists and that no installed copy can see.
  run_mutation "the automatic release is never taken OUT of draft" \
    ".github/workflows/desktop-release.yml" \
    '/gh release edit "\$TAG" --draft=false --prerelease=false --latest/d'
  run_mutation "the automatic release goes out marked PRERELEASE" \
    ".github/workflows/desktop-release.yml" \
    's|gh release create "\$TAG" --draft --target "\$GITHUB_SHA" --title|gh release create "$TAG" --draft --prerelease --target "$GITHUB_SHA" --title|'
  run_mutation "the release is made visible BEFORE its assets are uploaded" \
    ".github/workflows/desktop-release.yml" \
    's|^\([[:space:]]*\)gh release upload "\$TAG" "\$ZIP" "\$ZIP.sha256" "\$REPORT" --clobber$|\1gh release edit "$TAG" --draft=false --prerelease=false --latest\n\1gh release upload "$TAG" "$ZIP" "$ZIP.sha256" "$REPORT" --clobber|'
  run_mutation "the human escape hatch stops creating a draft" \
    ".github/workflows/desktop-release.yml" \
    's|gh release create "\$TAG" --draft --title|gh release create "$TAG" --title|'
  run_mutation "the automatic tag stops being the tag the payload URL enters" \
    ".github/workflows/desktop-release.yml" \
    's|^\([[:space:]]*\)TAG="v\${V}"$|\1TAG="release-${V}"|'
  run_mutation "the acceptance step is softened to tolerate nothing being published" \
    ".github/workflows/desktop-release.yml" \
    's|release_visibility_check.sh --expect-version|release_visibility_check.sh --allow-unreleased --expect-version|'
  run_mutation "the acceptance step stops fetching the live URL" \
    ".github/workflows/desktop-release.yml" \
    '/releases\/latest\/download\/appcast.json/d'

  say "negative controls: $mut_caught of $mut_n caught"
  [ "$mut_caught" -eq "$mut_n" ] || fails=$((fails + 1))
fi

echo
if [ "$fails" -eq 0 ]; then
  say "PASS — the release path, the appcast and the shipped bundle agree"
  exit 0
fi
say "$fails check(s) failed"
exit 1
