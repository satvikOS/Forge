#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# package_macos.sh — produce a RELOCATABLE, SELF-CONTAINED Forge.app + a zip.
#
# There was no packaging machinery in this repo at all: no install() rules, no
# CPack, no MACOSX_BUNDLE, no install_name_tool, no codesign. `cmake --install`
# produced nothing. This script is that missing step, and it exists because the
# build tree is NOT shippable — forge_desktop links Homebrew dylibs by ABSOLUTE
# install name (/opt/homebrew/opt/...), so a copy handed to anyone else fails to
# launch.
#
# Four things here are load-bearing, each learned by measurement, each a silent
# total failure if omitted:
#
#   1. THE CLOSURE IS TRANSITIVE. `otool -L forge_desktop` names 3 non-system
#      libraries. The real closure is ~20 Mach-O files: TKGeomBase, TKGeomAlgo
#      and TKBool arrive only through OCCT's own @rpath references, never
#      directly. A packager that copies one level of otool -L ships a bundle
#      that dies in dyld. This walks the graph to a fixed point.
#
#   2. MoltenVK IS NOT IN THE LINK CLOSURE. It is dlopen'd at RUNTIME by the
#      Vulkan loader via an ICD manifest, so no amount of otool walking finds
#      it. It is copied explicitly, and a bundle-relative manifest is written to
#      Contents/Resources/vulkan/icd.d/ — which the macOS loader searches for a
#      real .app, so no launcher script and no VK_ICD_FILENAMES is needed.
#
#   3. install_name_tool INVALIDATES THE SIGNATURE. arm64 macOS refuses to load
#      a Mach-O whose signature does not match its bytes, so every rewritten
#      file MUST be re-signed. Skip it and the bundle is simply dead.
#
#   4. ABSOLUTE BUILD-TREE RPATHS ARE DELETED. If they survive, a bundle tested
#      on the build machine loads from the build tree and "it's relocatable"
#      is a false pass. Deleting them makes the relocation test mean something.
#
# TWO KNOWN RELEASE BLOCKERS THIS SCRIPT CANNOT FIX — it MEASURES and REPORTS
# them rather than hiding them:
#
#   * OS FLOOR. Homebrew bottles inherit their build host's OS as their
#     LC_BUILD_VERSION minos. Every bundled bottle here reports minos=26.0, so
#     the artifact refuses to launch on anything older. -DCMAKE_OSX_DEPLOYMENT_
#     TARGET on OUR code cannot lower a floor set inside someone else's binary.
#     Lowering it means building OCCT/SDL2/tbb from source with an explicit
#     deployment target. The measured floor is written into LSMinimumSystemVersion
#     so the bundle states its real requirement instead of overpromising.
#
#   * GATEKEEPER. The signature is AD-HOC (no Developer ID, no notarization), so
#     `spctl -a -t exec` REJECTS the bundle — with or without the quarantine
#     attribute, because spctl assesses signature POLICY. That is EXPECTED and
#     is not a build defect; do not try to make spctl pass. A user who
#     downloads the zip approves it ONCE via System Settings > Privacy &
#     Security > "Open Anyway" (docs/FIRST_LAUNCH_MACOS.md). Removing the
#     prompt needs a paid Developer ID certificate and a notarization
#     round-trip, which are credentials, not code.
#
# Usage:
#   forge-desktop/package_macos.sh                 build, package, verify
#   forge-desktop/package_macos.sh --no-build      package an existing build
#   forge-desktop/package_macos.sh --launch        also render a real frame (needs a display)
#   forge-desktop/package_macos.sh --version 1.2.3 stamp a version into the bundle
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

say()  { echo "[package] $*"; }
die()  { echo "[package] FATAL: $*" >&2; exit 1; }

# ── run_bounded — LAUNCH THE APP WITH A CEILING, AND DIAGNOSE A HANG ─────────
# MEASURED 2026-08-31, GitHub Actions runs 33377699374 and 33392163311, both on
# macos-15: the relocation smoke test below launched the bundled forge_desktop
# and NEVER RETURNED. Runs 33392163311 and 33377699374 sat on that one line for
# 176.5 and 176.4 minutes respectively and were killed by the job's
# `timeout-minutes: 180`. A job timeout is reported by the API as `cancelled`,
# so both runs looked like an infrastructure blip. They were not: at cleanup the
# runner logged `Terminate orphan process: pid (10831) (forge_desktop)` — the
# process was still alive.
#
# The build itself was never the problem. In run 33392163311 everything from
# `cmake` to `codesign --verify` finished in 147 SECONDS; 176.5 of the 180
# minutes were this single launch.
#
# So no app launch in this script may ever again be unbounded. Two rules:
#
#   * macOS SHIPS NO `timeout(1)`. There is no coreutils on a stock macOS or on
#     a GitHub macos-15 runner (verified: `which timeout gtimeout` -> not
#     found), so this is a hand-rolled watchdog rather than a one-liner.
#
#   * A CEILING WITHOUT A DIAGNOSIS JUST MOVES THE MYSTERY. On expiry this takes
#     a `sample(1)` stack of the stuck process and PRINTS it before killing, so
#     the next occurrence names the exact frame instead of costing another three
#     hours and explaining nothing.
#
# Output goes to a FILE, never a pipe. `OUT="$(cmd)"` — which is what this
# replaced — blocks until the pipe's every writer closes, so a child that
# outlives its parent hangs the shell even after the process it waited for is
# gone. A file cannot do that, which removes one whole class of false hang.
#
# Usage: run_bounded <seconds> <label> <outfile> <cmd> [args...]
# Returns the command's exit status, or 124 if the watchdog fired.
run_bounded() {
  local limit="$1" label="$2" outf="$3"; shift 3
  local flag="$WORK/.watchdog_fired"
  local samp="$WORK/hang.sample.txt"
  rm -f "$flag" "$samp"
  : > "$outf"

  "$@" > "$outf" 2>&1 &
  local pid=$!

  # The watchdog is a child of THIS shell, but $pid is its sibling, so `kill -0`
  # here is a plain process-existence probe. It can still see a zombie, which is
  # why the caller treats the flag as authoritative only alongside a non-zero
  # exit status.
  (
    n=0
    while [ "$n" -lt "$limit" ]; do
      sleep 1
      n=$((n + 1))
      kill -0 "$pid" 2>/dev/null || exit 0
    done
    : > "$flag"
    sample "$pid" 5 -f "$samp" >/dev/null 2>&1
    kill -9 "$pid" 2>/dev/null
  ) &
  local wdog=$!

  wait "$pid"; local rc=$?
  kill "$wdog" 2>/dev/null
  wait "$wdog" 2>/dev/null

  # A clean exit 0 is a pass even if the watchdog tripped in the microseconds
  # between `wait` returning and the kill above — otherwise that race would
  # report a phantom timeout on a build that was fine.
  if [ -f "$flag" ] && [ "$rc" -ne 0 ]; then
    echo "[package] $label: STILL RUNNING after ${limit}s — killed." >&2
    echo "[package] ---- what it printed before it stopped ----" >&2
    cat "$outf" >&2 2>/dev/null
    if [ -s "$samp" ]; then
      echo "[package] ---- sample(1) stack of the stuck process ----" >&2
      cat "$samp" >&2
    else
      echo "[package] (sample(1) produced nothing)" >&2
    fi
    echo "[package] ---- end diagnosis ----" >&2
    return 124
  fi
  return "$rc"
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || die "cannot cd to $ROOT"

KERNEL_BUILD="${KERNEL_BUILD:-$ROOT/forge-kernel/build-app}"
APP_BUILD="${APP_BUILD:-$ROOT/forge-desktop/build}"
DIST="${DIST:-$ROOT/forge-desktop/dist}"
JOBS="${JOBS:-$( (command -v nproc >/dev/null 2>&1 && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"

DO_BUILD=1
DO_LAUNCH=0
VERSION="${FORGE_VERSION:-0.0.0-dev}"
# owner/name of the GitHub repository the updater fetches releases from. It
# appears in appcast.json's payload URL, which MUST point at one specific
# release -- see forge-desktop/src/update/Manifest.hpp for why a floating
# latest/download URL there would make the digest undescribable.
REPO="${FORGE_REPO:-satvikOS/Forge}"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) DO_BUILD=0 ;;
    --launch)   DO_LAUNCH=1 ;;
    --version)  shift; [ $# -gt 0 ] || die "--version needs a value"; VERSION="$1" ;;
    --repo)     shift; [ $# -gt 0 ] || die "--repo needs a value"; REPO="$1" ;;
    -h|--help)  sed -n '2,58p' "$0"; exit 0 ;;
    *)          die "unknown argument: $1" ;;
  esac
  shift
done
# A leading 'v' is a TAG convention, not a version. CFBundleShortVersionString
# must be numeric-dotted or Finder shows nothing at all.
VERSION="${VERSION#v}"

[ "$(uname -s)" = "Darwin" ] || die "macOS only (this packages a .app bundle)"

command -v otool             >/dev/null 2>&1 || die "otool not found (install Xcode command line tools)"
command -v install_name_tool >/dev/null 2>&1 || die "install_name_tool not found"
command -v codesign          >/dev/null 2>&1 || die "codesign not found"
command -v ditto             >/dev/null 2>&1 || die "ditto not found"

BREW="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"

# ── 1. build ─────────────────────────────────────────────────────────────────
if [ "$DO_BUILD" = "1" ]; then
  say "building forge_kernel_core in $KERNEL_BUILD"
  cmake -S forge-kernel -B "$KERNEL_BUILD" -DCMAKE_BUILD_TYPE=Release \
        -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >/dev/null \
    || die "kernel configure failed"
  cmake --build "$KERNEL_BUILD" -j "$JOBS" --target forge_kernel_core \
    || die "kernel core build failed"
  say "building forge_desktop in $APP_BUILD"
  cmake -S forge-desktop -B "$APP_BUILD" -DCMAKE_BUILD_TYPE=Release \
        -DFORGE_KERNEL_BUILD_DIR="$KERNEL_BUILD" >/dev/null \
    || die "app configure failed"
  cmake --build "$APP_BUILD" -j "$JOBS" || die "app build failed"
fi

EXE="$APP_BUILD/forge_desktop"
[ -f "$EXE" ] || die "$EXE not found (run without --no-build, or build first)"

# ── 2. bundle skeleton ───────────────────────────────────────────────────────
APP="$DIST/Forge.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Frameworks" \
         "$APP/Contents/Resources/vulkan/icd.d" || die "mkdir failed"
cp "$EXE" "$APP/Contents/MacOS/forge_desktop" || die "cannot stage the executable"
chmod +x "$APP/Contents/MacOS/forge_desktop"

FW="$APP/Contents/Frameworks"
WORK="$(mktemp -d /tmp/forge_package.XXXXXX)" || die "mktemp failed"
trap 'rm -rf "$WORK"' EXIT
SEEN="$WORK/seen"; : > "$SEEN"
QUEUE="$WORK/queue"; : > "$QUEUE"

# Where an @rpath/... dependency can be found. The kernel build dir and OCCT's
# lib dir are the two that actually matter; the rest are belt and braces.
RPATH_SEARCH="$FW
$KERNEL_BUILD
$BREW/lib
$BREW/opt/opencascade/lib
$BREW/opt/tbb/lib"

resolve_rpath() {  # $1 = basename -> prints an existing path, or nothing
  local base="$1" d
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    if [ -f "$d/$base" ]; then echo "$d/$base"; return 0; fi
  done <<< "$RPATH_SEARCH"
  return 1
}

# ── 3. transitive dylib closure ──────────────────────────────────────────────
say "walking the transitive dylib closure"
echo "$APP/Contents/MacOS/forge_desktop" > "$QUEUE"
while [ -s "$QUEUE" ]; do
  f="$(head -1 "$QUEUE")"
  sed -i '' '1d' "$QUEUE"
  [ -f "$f" ] || continue
  # tail -n +2 drops otool's "<file>:" header line. A dylib ALSO lists its own
  # id first; that is handled by the seen-set rather than by counting lines.
  otool -L "$f" 2>/dev/null | tail -n +2 | awk '{print $1}' | while IFS= read -r dep; do
    case "$dep" in
      /usr/lib/*|/System/*) continue ;;   # OS-supplied, never bundled
      "") continue ;;
    esac
    base="$(basename "$dep")"
    if grep -qxF "$base" "$SEEN" 2>/dev/null; then continue; fi
    case "$dep" in
      @rpath/*|@loader_path/*|@executable_path/*) src="$(resolve_rpath "$base")" ;;
      /*) src="$dep" ;;
      *)  src="$(resolve_rpath "$base")" ;;
    esac
    if [ -z "${src:-}" ] || [ ! -f "$src" ]; then
      echo "UNRESOLVED $dep (from $f)" >> "$WORK/unresolved"
      continue
    fi
    echo "$base" >> "$SEEN"
    # -L dereferences: Homebrew's opt/ paths are symlinks into Cellar, and a
    # symlink copied into the bundle points back out of it.
    if ! cp -L "$src" "$FW/$base"; then
      echo "COPYFAIL $src" >> "$WORK/unresolved"
      continue
    fi
    chmod u+w "$FW/$base"
    echo "$FW/$base" >> "$QUEUE"
  done
done

if [ -f "$WORK/unresolved" ]; then
  cat "$WORK/unresolved" >&2
  die "$(wc -l < "$WORK/unresolved" | tr -d ' ') dependencies could not be resolved"
fi

# ── 4. MoltenVK — runtime-only, invisible to otool ───────────────────────────
MVK_LIB=""
for c in "$BREW/opt/molten-vk/lib/libMoltenVK.dylib" "$BREW/lib/libMoltenVK.dylib"; do
  if [ -f "$c" ]; then MVK_LIB="$c"; break; fi
done
[ -n "$MVK_LIB" ] || die "libMoltenVK.dylib not found (brew install molten-vk)"
cp -L "$MVK_LIB" "$FW/libMoltenVK.dylib" || die "cannot stage MoltenVK"
chmod u+w "$FW/libMoltenVK.dylib"
grep -qxF "libMoltenVK.dylib" "$SEEN" 2>/dev/null || echo "libMoltenVK.dylib" >> "$SEEN"

# Bundle-relative ICD manifest. From Contents/Resources/vulkan/icd.d, three
# levels up is Contents/, so ../../../Frameworks is Contents/Frameworks.
cat > "$APP/Contents/Resources/vulkan/icd.d/MoltenVK_icd.json" <<'ICD'
{
    "file_format_version" : "1.0.0",
    "ICD": {
        "library_path": "../../../Frameworks/libMoltenVK.dylib",
        "api_version" : "1.2.0",
        "is_portability_driver" : true
    }
}
ICD

# ── 5. rewrite install names ─────────────────────────────────────────────────
say "rewriting install names to @rpath"
BUNDLED="$WORK/bundled"
{ echo "$APP/Contents/MacOS/forge_desktop"; ls "$FW"/*.dylib 2>/dev/null; } > "$BUNDLED"

while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$f" in
    *.dylib) install_name_tool -id "@rpath/$(basename "$f")" "$f" 2>/dev/null ;;
  esac
  otool -L "$f" 2>/dev/null | tail -n +2 | awk '{print $1}' | while IFS= read -r dep; do
    case "$dep" in
      /usr/lib/*|/System/*|"") continue ;;
    esac
    base="$(basename "$dep")"
    [ -f "$FW/$base" ] || continue
    [ "$dep" = "@rpath/$base" ] && continue
    install_name_tool -change "$dep" "@rpath/$base" "$f" 2>/dev/null
  done
  # Strip ABSOLUTE rpaths. A surviving build-tree rpath makes the bundle load
  # from the build tree on this machine and pass a relocation test it should
  # have failed.
  otool -l "$f" 2>/dev/null | awk '/LC_RPATH/{r=1} r&&/path /{print $2; r=0}' \
    | while IFS= read -r rp; do
        case "$rp" in
          @*) continue ;;
          *)  install_name_tool -delete_rpath "$rp" "$f" 2>/dev/null ;;
        esac
      done
done < "$BUNDLED"

# The two rpaths that make the bundle self-contained.
install_name_tool -add_rpath "@executable_path/../Frameworks" \
  "$APP/Contents/MacOS/forge_desktop" 2>/dev/null
for d in "$FW"/*.dylib; do
  [ -f "$d" ] || continue
  install_name_tool -add_rpath "@loader_path" "$d" 2>/dev/null
done

# ── 6. measured OS floor ─────────────────────────────────────────────────────
# Reported, not assumed. The highest minos among the bundled Mach-O files IS the
# artifact's real minimum OS, whatever our own compile flags claim.
FLOOR="0.0"
while IFS= read -r f; do
  [ -f "$f" ] || continue
  m="$(otool -l "$f" 2>/dev/null | awk '/minos/{print $2; exit}')"
  [ -n "$m" ] || continue
  hi="$(printf '%s\n%s\n' "$FLOOR" "$m" | sort -t. -k1,1n -k2,2n | tail -1)"
  FLOOR="$hi"
done < "$BUNDLED"
say "measured LC_BUILD_VERSION minos floor across the bundle = $FLOOR"

# ── 7. Info.plist ────────────────────────────────────────────────────────────
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Forge</string>
  <key>CFBundleDisplayName</key><string>Forge</string>
  <key>CFBundleExecutable</key><string>forge_desktop</string>
  <key>CFBundleIdentifier</key><string>com.archdisc.forge</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <!-- MEASURED from the bundled Mach-O files, not aspirational. Homebrew
       bottles set this floor; see the header of package_macos.sh. -->
  <key>LSMinimumSystemVersion</key><string>${FLOOR}</string>
</dict>
</plist>
PLIST

# ── 8. re-sign (leaves first, bundle last) ───────────────────────────────────
say "re-signing (install_name_tool invalidated every signature it touched)"
for d in "$FW"/*.dylib; do
  [ -f "$d" ] || continue
  codesign --force --sign - --timestamp=none "$d" >/dev/null 2>&1 \
    || die "codesign failed on $d"
done
codesign --force --sign - --timestamp=none "$APP" >/dev/null 2>&1 \
  || die "codesign failed on the bundle"
codesign --verify --deep --strict "$APP" >/dev/null 2>&1 \
  || die "codesign --verify rejected the bundle we just signed"
say "codesign --verify --deep --strict: OK (ad-hoc)"

# ── 9. verification ──────────────────────────────────────────────────────────
say "verifying the bundle is self-contained"
{ echo "$APP/Contents/MacOS/forge_desktop"; ls "$FW"/*.dylib 2>/dev/null; } > "$BUNDLED"
LEAKS=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  # grep -c PRINTS 0 and EXITS 1, so the assignment must not be trusted to a
  # pipeline status. The count is what matters and it is defaulted below.
  n="$(otool -L "$f" 2>/dev/null | tail -n +2 | awk '{print $1}' \
        | grep -c -e '^/opt/' -e '^/usr/local/')"
  n="${n:-0}"
  if [ "$n" -gt 0 ]; then
    echo "  LEAK $f -> $n absolute reference(s)" >&2
    LEAKS=$((LEAKS + n))
  fi
done < "$BUNDLED"
[ "$LEAKS" -eq 0 ] || die "$LEAKS residual absolute (non-system) references — the bundle is NOT relocatable"
say "0 residual absolute references across $(wc -l < "$BUNDLED" | tr -d ' ') Mach-O files"

# RELOCATION PROOF. Running it in place proves nothing: the build tree is still
# there. Copy it somewhere unrelated and launch THAT. --headless returns 0 after
# dyld has bound every library, so a clean exit IS the closure resolving from
# inside the bundle.
RELOC="$WORK/relocated"
mkdir -p "$RELOC"
ditto "$APP" "$RELOC/Forge.app" || die "ditto to the relocation dir failed"
say "relocation smoke test: launching the COPY at $RELOC/Forge.app"
# 120s. The whole build+package ahead of this point measures 147 seconds on a
# macos-15 runner, so a launch that has not returned in two minutes is not slow,
# it is stuck, and the stack sample is worth far more than the wait.
RELOC_OUT="$WORK/reloc_launch.txt"
run_bounded 120 "relocation smoke test" "$RELOC_OUT" \
  "$RELOC/Forge.app/Contents/MacOS/forge_desktop" --headless
RELOC_RC=$?
if [ "$RELOC_RC" -eq 0 ]; then
  say "  relocated bundle launched and exited 0: $(cat "$RELOC_OUT")"
elif [ "$RELOC_RC" -eq 124 ]; then
  die "the relocated bundle HUNG on launch (see the sample above). It was not
killed for being slow: the entire build and package before it takes 147s."
else
  cat "$RELOC_OUT" >&2
  die "the relocated bundle FAILED to launch (exit $RELOC_RC) — it is not self-contained"
fi

# MEASURED, and NOT a packaging defect: VK_LOADER_DEBUG=all shows the loader
# searching Forge.app/Contents/Resources/vulkan/icd.d FIRST, ahead of every
# system directory, so the bundle is self-sufficient. But the loader does not
# STOP there — it keeps enumerating, and on a machine that also has Homebrew's
# molten-vk it additionally finds /opt/homebrew/etc/vulkan/icd.d/MoltenVK_icd.json
# and loads a SECOND copy of libMoltenVK. That produces an objc duplicate-class
# warning for MVKBlockObserver, which Apple documents as a potential source of
# "spurious casting failures and mysterious crashes". An end user without
# Homebrew loads exactly one driver, so this affects DEVELOPER machines only —
# but a developer seeing that warning should know it is expected and why.
if [ -e "$BREW/etc/vulkan/icd.d/MoltenVK_icd.json" ]; then
  say "NOTE: a system MoltenVK ICD also exists at $BREW/etc/vulkan/icd.d/"
  say "      This machine will load TWO MoltenVK copies (bundled + Homebrew) and"
  say "      print an objc duplicate-class warning. Expected here; an end user"
  say "      without Homebrew loads only the bundled driver."
fi

if [ "$DO_LAUNCH" = "1" ]; then
  say "render smoke test (needs a display)"
  SHOT="$DIST/forge_launch.png"
  # Bounded for the same reason as the smoke test above, with more room because
  # this one really does work: it opens a window, builds a swapchain and renders
  # 60 frames.
  RENDER_OUT="$WORK/render_launch.txt"
  run_bounded 180 "render smoke test" "$RENDER_OUT" \
    "$RELOC/Forge.app/Contents/MacOS/forge_desktop" --frames 60 --screenshot "$SHOT"
  RENDER_RC=$?
  if [ "$RENDER_RC" -eq 0 ]; then
    say "  rendered; screenshot -> $SHOT"
  elif [ "$RENDER_RC" -eq 124 ]; then
    die "the relocated bundle HUNG while rendering (see the sample above)"
  else
    cat "$RENDER_OUT" >&2
    die "the relocated bundle failed to render a frame (exit $RENDER_RC)"
  fi
fi

# ── 10. zip ──────────────────────────────────────────────────────────────────
ZIP="$DIST/Forge-macos-arm64-${VERSION}.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP" || die "ditto zip failed"
shasum -a 256 "$ZIP" > "$ZIP.sha256"

# ── 10b. appcast.json — what the RUNNING APP reads to find this release ──────
# Written by forge-desktop/emit_appcast.sh, which is a separate script precisely
# so test/appcast_selftest.sh can run it and feed the result to the app's REAL
# manifest parser. A producer and a consumer that must agree and are never
# exercised together will drift. Read that script's header for why the payload
# URL names ONE release and why a draft release is invisible to the updater.
#
# min_macos is the floor MEASURED in step 8, never a hard-coded minimum.
APPCAST="$DIST/appcast.json"
bash "$ROOT/forge-desktop/emit_appcast.sh" \
  --version "$VERSION" --repo "$REPO" --zip "$ZIP" \
  --min-macos "$FLOOR" --out "$APPCAST" \
  || die "could not write the appcast"
CHANNEL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["channel"])' "$APPCAST")"

APP_SZ="$(du -sh "$APP" | awk '{print $1}')"
ZIP_SZ="$(du -h "$ZIP" | awk '{print $1}')"
NMACH="$(wc -l < "$BUNDLED" | tr -d ' ')"

# Gatekeeper is REPORTED, never asserted: an ad-hoc signature is expected to be
# rejected, and a script that failed on it could never pass without credentials.
SPCTL="$(spctl -a -vvv -t exec "$APP" 2>&1 | tr '\n' ' ')"
SPCTL_RC=$?

cat <<SUMMARY

────────────────────────────────────────────────────────────────────────────
  FORGE macOS RELEASE ARTIFACT
────────────────────────────────────────────────────────────────────────────
  bundle        $APP  ($APP_SZ)
  zip           $ZIP  ($ZIP_SZ)
  sha256        $(awk '{print $1}' "$ZIP.sha256")
  version       $VERSION
  appcast       $APPCAST  (channel $CHANNEL)
  Mach-O files  $NMACH bundled (libMoltenVK included, loaded via the ICD)
  relocatable   YES — a copy in an unrelated directory launched and exited 0
  signature     ad-hoc

  KNOWN BLOCKERS (measured, not fixable by this script):
   * minimum macOS = $FLOOR. Set by Homebrew bottles' LC_BUILD_VERSION, not by
     our compile flags. To lower it, build OCCT/SDL2/tbb from source with an
     explicit -DCMAKE_OSX_DEPLOYMENT_TARGET.
   * Gatekeeper: spctl exit $SPCTL_RC -> $SPCTL
     Ad-hoc signing is not notarization, and spctl can never accept an ad-hoc
     signature — expected, not a defect. A downloaded copy shows a refusal
     dialog on FIRST LAUNCH; the user clears it once via System Settings >
     Privacy & Security > "Open Anyway" (docs/FIRST_LAUNCH_MACOS.md).
     The real fix is a Developer ID certificate + notarytool submission.
────────────────────────────────────────────────────────────────────────────
SUMMARY
