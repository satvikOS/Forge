#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release_dryrun.sh — build, package and REPORT on the macOS desktop artifact
#                     without publishing anything, anywhere.
#
# This is the safe half of the release path. It is the script the CI workflow
# runs on a manual dispatch, and the script a developer runs locally, so the
# two cannot drift: there is one code path and one report format.
#
# WHAT IT WILL NOT DO. This is checkable rather than promised — below the
# header, this file contains no invocation of git, of gh, or of any network
# client. It creates no tag, touches no release, and uploads nothing.
# Publishing lives ONLY in the tag-gated step of desktop-release.yml, which is
# additionally gated on the event being a push, so a manual dispatch cannot
# reach it at all.
#
# WHAT IT REPORTS, because these are the two things that decide whether the
# artifact is fit to ship:
#   * the MEASURED OS floor — the highest LC_BUILD_VERSION `minos` across every
#     bundled Mach-O file. This is the artifact's real minimum macOS regardless
#     of what our own compile flags asked for, because a Homebrew bottle carries
#     the minos of the machine that BUILT it. It therefore follows the build
#     host / runner image, and is not a property of this source tree.
#   * the GATEKEEPER verdict — `spctl -a -t exec`. An ad-hoc signature is
#     expected to be REJECTED (exit 3). This is reported and never asserted: a
#     check that cannot pass without a paid Developer ID certificate would be a
#     permanently red gate, which is the same as no gate.
#
# The one thing it does FAIL on is --floor-max: if the measured floor is higher
# than the allowed maximum, the runner image (or the developer's OS) has moved
# and the artifact would silently demand a newer macOS than we promise. That is
# the failure this script exists to make loud.
#
# USAGE
#   forge-desktop/release_dryrun.sh                       full build + package + report
#   forge-desktop/release_dryrun.sh --no-build            package an existing build
#   forge-desktop/release_dryrun.sh --version 0.1.0       stamp a version
#   forge-desktop/release_dryrun.sh --floor-max 15.0      FAIL if the floor exceeds this
#   forge-desktop/release_dryrun.sh --macos-min 14.0      deployment target for OUR code
#
# OUTPUTS (all under forge-desktop/dist/)
#   Forge.app, Forge-macos-arm64-<v>.zip, .zip.sha256
#   Forge-macos-arm64-<v>.dryrun.json   floor, per-file minos, Gatekeeper result
#   and, when $GITHUB_STEP_SUMMARY is set, the same table in the job summary.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
say() { printf '[dryrun] %s\n' "$*"; }
die() { printf '[dryrun] FATAL: %s\n' "$*" >&2; exit 1; }

KERNEL_BUILD="${KERNEL_BUILD:-$ROOT/forge-kernel/build-app}"
APP_BUILD="${APP_BUILD:-$ROOT/forge-desktop/build}"
DIST="${DIST:-$ROOT/forge-desktop/dist}"
JOBS="${JOBS:-$( (command -v nproc >/dev/null 2>&1 && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"

DO_BUILD=1
VERSION="${FORGE_VERSION:-0.0.0-dryrun}"
MACOS_MIN="${FORGE_MACOS_MIN:-14.0}"
FLOOR_MAX="${FORGE_FLOOR_MAX:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build)  DO_BUILD=0 ;;
    --version)   shift; [ $# -gt 0 ] || die "--version needs a value";   VERSION="$1" ;;
    --macos-min) shift; [ $# -gt 0 ] || die "--macos-min needs a value"; MACOS_MIN="$1" ;;
    --floor-max) shift; [ $# -gt 0 ] || die "--floor-max needs a value"; FLOOR_MAX="$1" ;;
    --jobs)      shift; [ $# -gt 0 ] || die "--jobs needs a value";      JOBS="$1" ;;
    -h|--help)   sed -n '2,48p' "$0"; exit 0 ;;
    *)           die "unknown argument: $1" ;;
  esac
  shift
done
VERSION="${VERSION#v}"

[ "$(uname -s)" = "Darwin" ] || die "macOS only (this packages a .app bundle)"
[ "$(uname -m)" = "arm64" ]  || die "arm64 only: this produces an arm64-named artifact, and \
the host is $(uname -m). Building here would put an Intel binary in a file called arm64."

PKG="$ROOT/forge-desktop/package_macos.sh"
[ -f "$PKG" ] || die "$PKG not found — this ref does not carry the desktop release path"

# ── 1. build ─────────────────────────────────────────────────────────────────
# Two separate CMake projects. The kernel is built node-free (no Node addon) with
# the desktop foundation on; the app links the resulting core library. Both are
# compiled against $MACOS_MIN so that OUR binaries are never what sets the floor
# — which is what makes the measurement below attributable to the bottles.
if [ "$DO_BUILD" = "1" ]; then
  say "configuring forge_kernel_core (node-free, deployment target $MACOS_MIN)"
  cmake -S "$ROOT/forge-kernel" -B "$KERNEL_BUILD" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN" \
        -DFORGE_BUILD_NODE_ADDON=OFF \
        -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >/dev/null || die "kernel configure failed"
  say "building forge_kernel_core -j$JOBS"
  cmake --build "$KERNEL_BUILD" -j"$JOBS" --target forge_kernel_core || die "kernel build failed"

  say "configuring forge_desktop"
  cmake -S "$ROOT/forge-desktop" -B "$APP_BUILD" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN" \
        -DFORGE_KERNEL_BUILD_DIR="$KERNEL_BUILD" >/dev/null || die "desktop configure failed"
  say "building forge_desktop -j$JOBS"
  cmake --build "$APP_BUILD" -j"$JOBS" || die "desktop build failed"
fi

# ── 2. headless frame gate ───────────────────────────────────────────────────
# A dry run that skipped this would package a binary that has never produced a
# frame. It runs with no window and no GPU, so it is valid on a CI runner.
GATE="$APP_BUILD/forge_desktop_frame_gate"
[ -x "$GATE" ] || die "$GATE not found (run without --no-build, or build first)"
say "headless frame gate"
"$GATE" >/dev/null || die "the frame gate is RED — not packaging this build"
say "  frame gate passed"

# ── 3. package ───────────────────────────────────────────────────────────────
# Capability detection, not assumption. package_macos.sh grew --macos-min and
# --floor-max on a later branch; on a ref that predates them the flags would be
# a hard "unknown argument" error. Detect the case arms (anchored, so the usage
# COMMENT that lists every flag cannot make an absent flag look present) and
# pass only what this ref actually understands. Whatever the packager cannot do,
# this script does itself in step 4 — so the report is identical either way.
PKG_ARGS=(--no-build --version "$VERSION")
if grep -qE '^[[:space:]]*--macos-min\)' "$PKG"; then
  PKG_ARGS+=(--macos-min "$MACOS_MIN")
else
  say "note: package_macos.sh on this ref has no --macos-min; not passing it"
fi
say "packaging Forge.app (version $VERSION)"
bash "$PKG" "${PKG_ARGS[@]}" || die "packaging failed"

APP="$DIST/Forge.app"
ZIP="$DIST/Forge-macos-arm64-${VERSION}.zip"
[ -d "$APP" ] || die "no bundle at $APP"
[ -f "$ZIP" ] || die "no zip at $ZIP"
[ -x "$APP/Contents/MacOS/forge_desktop" ] || die "no executable inside the bundle"

# ── 3a. the crash-isolation worker must be INSIDE the bundle ─────────────────
# forge_kernel_worker is the process the application is allowed to lose: the app
# looks for it BESIDE ITSELF, and a bundle without it degrades SILENTLY -- the
# app prints "kernel isolation: UNAVAILABLE" and models in process, because
# refusing to model would be worse than modelling unprotected. So a missing
# worker produces a product that is merely less safe, with nothing going red.
#
# package_macos.sh already dies if the worker was never BUILT. This is the
# separate question -- did it reach the ARTIFACT -- asked where the report can
# record the answer, so "the shipped app has crash isolation" is a measured
# field of every dry run rather than an inference from the packager's exit code.
#
# Capability-detected exactly like --macos-min and the appcast below: on a ref
# whose packager predates the worker there is nothing to look for, and the
# report says so rather than failing a build that was never wrong. The signal is
# the PACKAGER's own staging line, anchored to the assignment so the explanatory
# comments that mention the worker cannot make an absent capability look present.
WORKER_BUNDLED="not-applicable"
if grep -qE '^[[:space:]]*WORKER_SRC=' "$PKG"; then
  WORKER="$APP/Contents/MacOS/forge_kernel_worker"
  [ -x "$WORKER" ] || die "this ref STAGES a crash-isolation worker but $WORKER is \
not in the bundle -- the app would ship with NO crash isolation and say nothing"
  WORKER_BUNDLED="yes"
  say "crash-isolation worker is in the bundle: Contents/MacOS/forge_kernel_worker"
else
  say "note: this ref's packager stages no kernel worker; nothing to check"
fi

# ── 3a-ii. the UPDATER must be INSIDE the bundle ─────────────────────────────
# forge_update is the only code in the shipped product that can INSTALL a
# release. The app's own check is read-only by design -- it fetches the appcast,
# decides, and downloads nothing -- so a bundle without this binary produces an
# app that can tell a user a new version exists and can do nothing whatever
# about it. Every user then re-downloads a zip by hand and clears Gatekeeper
# again, which is the exact cost the update path exists to charge once.
#
# Like the worker, its absence is SILENT: nothing errors, no gate goes red, and
# the product is simply frozen at the version each user happened to install.
# Capability-detected against the packager's own staging assignment, anchored so
# the comments that explain the updater cannot make an absent capability look
# present.
UPDATER_BUNDLED="not-applicable"
if grep -qE '^[[:space:]]*UPDATER_SRC=' "$PKG"; then
  UPD="$APP/Contents/MacOS/forge_update"
  [ -x "$UPD" ] || die "this ref STAGES an updater but $UPD is not in the bundle -- \
the shipped app could DETECT a release and would have no way to INSTALL one"
  UPDATER_BUNDLED="yes"
  say "updater is in the bundle: Contents/MacOS/forge_update"
else
  say "note: this ref's packager stages no updater; nothing to check"
fi

# ── 3b. the appcast must describe THIS zip ───────────────────────────────────
# appcast.json is what every already-installed copy of Forge reads to find and
# verify this release. A release whose appcast names a different build is a
# release nobody's app can install, and that failure would surface on a user's
# machine weeks later rather than here.
#
# Capability-detected the same way --macos-min is above: a ref whose packager
# predates the updater writes no appcast, and this dry run must still be usable
# on such a ref. The signal is the emitter's existence, not a silent skip.
APPCAST="$DIST/appcast.json"
APPCAST_OK="not-applicable"
if [ -f "$ROOT/forge-desktop/emit_appcast.sh" ]; then
  [ -f "$APPCAST" ] || die "this ref has emit_appcast.sh but produced no $APPCAST"
  if python3 - "$APPCAST" "$ZIP" "$VERSION" <<'APPCAST_PY'
import hashlib, json, os, sys
m = json.load(open(sys.argv[1]))
zip_path, version = sys.argv[2], sys.argv[3]
errs = []
if m.get("schema") != "forge-appcast/1":
    errs.append("schema is %r" % m.get("schema"))
if m.get("version") != version:
    errs.append("version is %r, the build is %r" % (m.get("version"), version))
size = os.path.getsize(zip_path)
if m.get("size") != size:
    errs.append("size is %r, the zip is %d" % (m.get("size"), size))
digest = hashlib.sha256(open(zip_path, "rb").read()).hexdigest()
if m.get("sha256") != digest:
    errs.append("sha256 is %r, the zip hashes to %s" % (m.get("sha256"), digest))
url = m.get("url", "")
if not url.startswith("https://"):
    errs.append("payload url is not https: %r" % url)
if "/releases/latest/" in url or "/releases/download/" not in url:
    # A floating payload URL makes the digest undescribable, and the app refuses
    # one outright -- see forge-desktop/src/update/Manifest.hpp.
    errs.append("payload url is not pinned to one release: %r" % url)
if errs:
    sys.stderr.write("appcast does not describe this build: " + "; ".join(errs) + "\n")
    sys.exit(1)
APPCAST_PY
  then
    APPCAST_OK="yes"
    say "appcast describes this zip (version, size, sha256, pinned https url)"
  else
    die "the appcast does not describe the zip that was just built"
  fi
else
  say "note: this ref has no emit_appcast.sh; no appcast to check"
fi

# ── 4. measure the floor, independently of the packager ──────────────────────
# The highest minos across every Mach-O file in the bundle IS the artifact's
# minimum macOS. Measured here rather than parsed out of the packager's prose so
# that this report is valid on every ref, including ones whose packager writes
# no manifest at all.
say "measuring LC_BUILD_VERSION minos across the bundle"
CENSUS="$(mktemp)"; trap 'rm -f "$CENSUS"' EXIT
while IFS= read -r f; do
  file -b "$f" 2>/dev/null | grep -q 'Mach-O' || continue
  m="$(otool -l "$f" 2>/dev/null | awk '/minos/{print $2; exit}')"
  [ -n "$m" ] || continue
  printf '%s %s\n' "$m" "${f#"$APP"/}" >> "$CENSUS"
done < <(find "$APP" -type f -perm -u+r)

[ -s "$CENSUS" ] || die "no Mach-O files found in $APP — the bundle is not what it claims"
FLOOR="$(awk '{print $1}' "$CENSUS" | sort -t. -k1,1n -k2,2n | tail -1)"
NMACH="$(wc -l < "$CENSUS" | tr -d ' ')"
NSET="$(awk -v F="$FLOOR" '$1==F' "$CENSUS" | wc -l | tr -d ' ')"
FLOOR_SETTERS="$(awk -v F="$FLOOR" '$1==F{print $2}' "$CENSUS" | tr '\n' ' ')"

# ── 5. Gatekeeper verdict — REPORTED, never asserted ─────────────────────────
# `set -o pipefail` above is what makes $? after this pipeline the status of
# spctl and not of tr. Without it this would silently report exit 0 (accepted)
# for a bundle Gatekeeper actually rejects, which is the worst possible failure
# for exactly this check. Verified: with pipefail 3, without it 0.
SPCTL_OUT="$(spctl -a -vvv -t exec "$APP" 2>&1 | tr '\n' ' ')"
SPCTL_RC=$?
if [ "$SPCTL_RC" -eq 0 ]; then GK=true; else GK=false; fi
IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null | tail -1 | tr -d '\n')"

SHA="$(awk '{print $1}' "$ZIP.sha256" 2>/dev/null)"
ZIP_SZ="$(du -h "$ZIP" | awk '{print $1}')"

# ── 6. machine-readable report ───────────────────────────────────────────────
REPORT="$DIST/Forge-macos-arm64-${VERSION}.dryrun.json"
{
  printf '{\n'
  printf '  "dry_run": true,\n'
  printf '  "published": false,\n'
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "zip": "%s",\n' "$(basename "$ZIP")"
  printf '  "zip_sha256": "%s",\n' "$SHA"
  printf '  "appcast_describes_this_zip": "%s",\n' "$APPCAST_OK"
  printf '  "crash_isolation_worker_bundled": "%s",\n' "$WORKER_BUNDLED"
  printf '  "updater_bundled": "%s",\n' "$UPDATER_BUNDLED"
  printf '  "host_macos": "%s",\n' "$(sw_vers -productVersion)"
  printf '  "deployment_target_requested": "%s",\n' "$MACOS_MIN"
  printf '  "measured_floor": "%s",\n' "$FLOOR"
  printf '  "floor_max_allowed": "%s",\n' "${FLOOR_MAX:-none}"
  printf '  "macho_count": %s,\n' "$NMACH"
  printf '  "floor_setter_count": %s,\n' "$NSET"
  printf '  "gatekeeper_accepted": %s,\n' "$GK"
  printf '  "spctl_exit": %s,\n' "$SPCTL_RC"
  printf '  "signature": "ad-hoc",\n'
  printf '  "minos_by_file": {\n'
  sort -k2 "$CENSUS" | awk '{printf "    \"%s\": \"%s\",\n", $2, $1}' | sed '$s/,$//'
  printf '  }\n'
  printf '}\n'
} > "$REPORT"

cat <<SUMMARY

────────────────────────────────────────────────────────────────────────────
  FORGE macOS DRY RUN — nothing was published
────────────────────────────────────────────────────────────────────────────
  bundle          $APP
  zip             $ZIP  ($ZIP_SZ)
  sha256          $SHA
  report          $REPORT
  appcast         $APPCAST  (describes this zip: $APPCAST_OK)
  crash isolation forge_kernel_worker in the bundle: $WORKER_BUNDLED
  self-update     forge_update in the bundle: $UPDATER_BUNDLED
  version         $VERSION
  host macOS      $(sw_vers -productVersion)
  Mach-O files    $NMACH

  MEASURED OS FLOOR        $FLOOR   (allowed max: ${FLOOR_MAX:-not enforced})
    set by $NSET of $NMACH files, our deployment target was $MACOS_MIN
    $(echo "$FLOOR_SETTERS" | fold -s -w 68 | sed '2,$s/^/    /')
    The floor follows the BUILD HOST, because a Homebrew bottle carries the
    minos of the machine that built it. It is not a property of this source.

  GATEKEEPER               spctl exit $SPCTL_RC (accepted: $GK)
    $SPCTL_OUT
    codesigning identities on this host: ${IDENTITIES:-none}
    An ad-hoc signature is NOT notarization, and spctl can never accept one:
    this rejection is EXPECTED and is not a packaging defect. A downloaded
    copy is refused on FIRST LAUNCH until the user approves it once via
    System Settings > Privacy & Security > "Open Anyway" — the shipped steps
    are docs/FIRST_LAUNCH_MACOS.md, and the release page carries them from
    docs/RELEASE_BODY_macos.md. Removing the prompt entirely is a CREDENTIAL
    blocker. No change to this repository can clear it.

  PUBLISHED       NO — no tag was created, no release was touched.
────────────────────────────────────────────────────────────────────────────
SUMMARY

# ── 7. job summary, when running under Actions ───────────────────────────────
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Forge macOS dry run \`${VERSION}\`"
    echo
    echo "| property | value |"
    echo "| --- | --- |"
    echo "| published | \`NO — dry run\` |"
    echo "| measured minimum macOS | \`$FLOOR\` (allowed \`${FLOOR_MAX:-not enforced}\`) |"
    echo "| floor set by | $NSET of $NMACH Mach-O files |"
    echo "| Gatekeeper accepted | \`$GK\` (spctl exit \`$SPCTL_RC\`) |"
    echo "| signature | ad-hoc, NOT notarized |"
    echo "| zip sha256 | \`$SHA\` |"
    echo
    echo 'Gatekeeper rejection is EXPECTED for an ad-hoc signature and is not a build defect;'
    echo 'clearing it entirely is blocked on a paid Developer ID certificate.'
    echo 'Downloaders approve the app ONCE via System Settings > Privacy & Security >'
    echo '"Open Anyway" — steps in `docs/FIRST_LAUNCH_MACOS.md`. Do not tell anyone to'
    echo 'right-click > Open: Apple removed that shortcut in macOS 15 (Sequoia).'
  } >> "$GITHUB_STEP_SUMMARY"
fi

# ── 8. the one hard gate ─────────────────────────────────────────────────────
# Last, so the artifact and the report are on disk to inspect when it fires.
if [ -n "$FLOOR_MAX" ]; then
  higher="$(printf '%s\n%s\n' "$FLOOR_MAX" "$FLOOR" | sort -t. -k1,1n -k2,2n | tail -1)"
  if [ "$FLOOR" != "$FLOOR_MAX" ] && [ "$higher" = "$FLOOR" ]; then
    die "measured floor $FLOOR EXCEEDS --floor-max $FLOOR_MAX.
       The build host moved, or a bottle was rebuilt on a newer OS. Shipping this
       would raise the minimum macOS of the artifact without anyone deciding to.
       Files at the floor: $FLOOR_SETTERS"
  fi
  say "floor gate OK: measured $FLOOR <= allowed $FLOOR_MAX"
fi
say "dry run complete — nothing published"
