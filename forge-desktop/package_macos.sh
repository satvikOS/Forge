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
#     LC_BUILD_VERSION minos. Every bundled bottle built on macOS 26 reports
#     minos=26.0, so such an artifact refuses to launch on anything older.
#     -DCMAKE_OSX_DEPLOYMENT_TARGET on OUR code cannot lower a floor set inside
#     someone else's binary. The measured floor is written into
#     LSMinimumSystemVersion so the bundle states its real requirement instead
#     of overpromising.
#
#     BUT THE FLOOR IS NOT INTRINSIC, and an earlier version of this comment was
#     too pessimistic: it said lowering it "means building OCCT/SDL2/tbb from
#     source". MEASURED against the upstream Homebrew API (formulae.brew.sh), at
#     the SAME formula versions we already use, arm64_sonoma bottles exist and
#     carry minos=14.0 -- opencascade 7.9.3 (all 67 dylibs), tbb, sdl2-compat
#     and vulkan-loader alike. No source build is required. The floor simply
#     follows the RUNNER IMAGE the release is built on:
#         macos-14 -> 14.0     macos-15 -> 15.0     macos-26 -> 26.0
#     (`brew fetch --bottle-tag=` and `brew info --json` on a developer machine
#     report only the LOCAL platform's tag, which makes the older bottles look
#     absent. That is a filtering artifact of local brew, not upstream reality;
#     query formulae.brew.sh to see the real tag list.)
#
#   * GATEKEEPER. The signature is AD-HOC (no Developer ID, no notarization), so
#     `spctl -a -t exec` REJECTS the bundle. A user who downloads the zip gets a
#     refusal dialog. Fixing this needs a paid Developer ID certificate and a
#     notarization round-trip, which are credentials, not code.
#
# Usage:
#   forge-desktop/package_macos.sh                 build, package, verify
#   forge-desktop/package_macos.sh --no-build      package an existing build
#   forge-desktop/package_macos.sh --launch        also render a real frame (needs a display)
#   forge-desktop/package_macos.sh --version 1.2.3 stamp a version into the bundle
#   forge-desktop/package_macos.sh --macos-min 14.0  deployment target for OUR code
#   forge-desktop/package_macos.sh --floor-max 15.0  FAIL if the measured floor is higher
#
# Outputs, next to the zip:
#   Forge-macos-arm64-<v>.zip[.sha256]   the artifact
#   Forge-macos-arm64-<v>.manifest.json  floor, per-file minos, Gatekeeper result
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

say()  { echo "[package] $*"; }
die()  { echo "[package] FATAL: $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || die "cannot cd to $ROOT"

KERNEL_BUILD="${KERNEL_BUILD:-$ROOT/forge-kernel/build-app}"
APP_BUILD="${APP_BUILD:-$ROOT/forge-desktop/build}"
DIST="${DIST:-$ROOT/forge-desktop/dist}"
JOBS="${JOBS:-$( (command -v nproc >/dev/null 2>&1 && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"

DO_BUILD=1
DO_LAUNCH=0
VERSION="${FORGE_VERSION:-0.0.0-dev}"

# The deployment target OUR OWN code compiles against. This cannot lower a floor
# set inside somebody else's bottle, and it is NOT a fix for the OS floor. What
# it does is remove OUR two Mach-O files as a CAUSE of that floor, so the floor
# becomes attributable entirely to third-party bottles and drops by itself the
# moment the build runs on an older runner image.
#   MEASURED on macOS 26.6 / SDK 26.5: unset -> forge_desktop and
#   libforge_kernel_core carry minos=26.0. With 14.0 they carry minos=14.0 and
#   the build still succeeds (the linker warns that the Homebrew dylibs are
#   newer, which is precisely the honest signal that THEY set the floor).
MACOS_MIN="${FORGE_MACOS_MIN:-14.0}"

# Optional HARD GATE on the measured floor. Off by default. CI sets it so that a
# runner-image bump which silently RAISES the minimum macOS of every artifact we
# ship turns the build RED instead of shipping quietly. The workflow header
# worried about exactly this and nothing enforced it.
FLOOR_MAX="${FORGE_FLOOR_MAX:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) DO_BUILD=0 ;;
    --launch)   DO_LAUNCH=1 ;;
    --version)  shift; [ $# -gt 0 ] || die "--version needs a value"; VERSION="$1" ;;
    --macos-min) shift; [ $# -gt 0 ] || die "--macos-min needs a value"; MACOS_MIN="$1" ;;
    --floor-max) shift; [ $# -gt 0 ] || die "--floor-max needs a value"; FLOOR_MAX="$1" ;;
    -h|--help)  sed -n '2,75p' "$0"; exit 0 ;;
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
  say "building forge_kernel_core in $KERNEL_BUILD (deployment target $MACOS_MIN)"
  cmake -S forge-kernel -B "$KERNEL_BUILD" -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN" \
        -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >/dev/null \
    || die "kernel configure failed"
  cmake --build "$KERNEL_BUILD" -j "$JOBS" --target forge_kernel_core \
    || die "kernel core build failed"
  say "building forge_desktop in $APP_BUILD (deployment target $MACOS_MIN)"
  cmake -S forge-desktop -B "$APP_BUILD" -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN" \
        -DFORGE_KERNEL_BUILD_DIR="$KERNEL_BUILD" >/dev/null \
    || die "app configure failed"
  cmake --build "$APP_BUILD" -j "$JOBS" || die "app build failed"
else
  say "--no-build: NOT applying deployment target $MACOS_MIN (nothing is compiled);"
  say "            the floor below is measured from whatever binaries already exist"
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
#
# A bare maximum is not enough to ACT on: it says the artifact needs macOS N but
# not WHICH file demanded it, so nobody can tell a floor we control from a floor
# a bottle imposes. The census below records every file, so the summary can name
# the culprits and a reader can see at a glance whether the fix is ours to make.
#
# A file carrying only the LEGACY LC_VERSION_MIN_MACOSX has no 'minos' line at
# all. Matching bare /minos/ would skip it and read as "no floor" -- a false
# zero. Both spellings are read here.
CENSUS="$WORK/minos_census"     # "<minos> <basename>" per bundled Mach-O
: > "$CENSUS"
FLOOR="0.0"
while IFS= read -r f; do
  [ -f "$f" ] || continue
  l="$(otool -l "$f" 2>/dev/null)"
  m="$(printf '%s' "$l" | awk '/^ *minos /{print $2; exit}')"
  if [ -z "$m" ]; then
    m="$(printf '%s' "$l" | awk '/LC_VERSION_MIN_MACOSX/{g=1} g&&/^ *version /{print $2; exit}')"
  fi
  [ -n "$m" ] || { echo "NONE $(basename "$f")" >> "$CENSUS"; continue; }
  echo "$m $(basename "$f")" >> "$CENSUS"
  hi="$(printf '%s\n%s\n' "$FLOOR" "$m" | sort -t. -k1,1n -k2,2n | tail -1)"
  FLOOR="$hi"
done < "$BUNDLED"
say "measured LC_BUILD_VERSION minos floor across the bundle = $FLOOR"

# Name the files that SET the floor, and say whether they are ours.
FLOOR_SETTERS="$(awk -v F="$FLOOR" '$1==F{printf "%s ", $2}' "$CENSUS")"
NSET="$(awk -v F="$FLOOR" '$1==F' "$CENSUS" | wc -l | tr -d ' ')"
OURS_AT_FLOOR="$(awk -v F="$FLOOR" '$1==F && ($2=="forge_desktop" || $2=="libforge_kernel_core.dylib")' "$CENSUS" | wc -l | tr -d ' ')"
say "  $NSET of $(wc -l < "$CENSUS" | tr -d ' ') bundled Mach-O files sit at that floor; $OURS_AT_FLOOR of them are OURS"

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
if OUT="$("$RELOC/Forge.app/Contents/MacOS/forge_desktop" --headless 2>&1)"; then
  say "  relocated bundle launched and exited 0: ${OUT}"
else
  echo "$OUT" >&2
  die "the relocated bundle FAILED to launch — it is not self-contained"
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
  if "$RELOC/Forge.app/Contents/MacOS/forge_desktop" --frames 60 --screenshot "$SHOT"; then
    say "  rendered; screenshot -> $SHOT"
  else
    die "the relocated bundle failed to render a frame"
  fi
fi

# ── 10. zip ──────────────────────────────────────────────────────────────────
ZIP="$DIST/Forge-macos-arm64-${VERSION}.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP" || die "ditto zip failed"
shasum -a 256 "$ZIP" > "$ZIP.sha256"

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
  Mach-O files  $NMACH bundled (libMoltenVK included, loaded via the ICD)
  relocatable   YES — a copy in an unrelated directory launched and exited 0
  signature     ad-hoc

  KNOWN BLOCKERS (measured, not fixable by this script):
   * minimum macOS = $FLOOR, set by $NSET of the bundled Mach-O files, of which
     $OURS_AT_FLOOR are ours. Files at the floor:
       $(echo "$FLOOR_SETTERS" | fold -s -w 68 | sed '2,$s/^/       /')
     A Homebrew bottle inherits its BUILD HOST's OS as LC_BUILD_VERSION, so this
     floor tracks the machine that built the bottles, not our compile flags.
     MEASURED upstream (formulae.brew.sh API, same formula versions): the
     arm64_sonoma bottles of opencascade (67 dylibs), tbb, sdl2-compat and
     vulkan-loader ALL carry minos=14.0. So the floor is not intrinsic -- it
     follows the runner image. Building on macos-15 yields 15.0, macos-14
     yields 14.0. Our own two binaries were compiled with
     -DCMAKE_OSX_DEPLOYMENT_TARGET=$MACOS_MIN so they are not the cause.
   * Gatekeeper: spctl exit $SPCTL_RC -> $SPCTL
     Ad-hoc signing is not notarization. A downloaded copy shows a refusal
     dialog until the user runs:  xattr -dr com.apple.quarantine Forge.app
     The real fix is a Developer ID certificate + notarytool submission.
────────────────────────────────────────────────────────────────────────────
SUMMARY

# ── 11. machine-readable manifest ────────────────────────────────────────────
# The summary above is for a human. Everything a RELEASE decision needs must
# also be readable without parsing prose: what the floor is, which files set it,
# and whether Gatekeeper accepted. Written next to the zip.
MANIFEST="$DIST/Forge-macos-arm64-${VERSION}.manifest.json"
{
  printf '{\n'
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "zip": "%s",\n' "$(basename "$ZIP")"
  printf '  "zip_sha256": "%s",\n' "$(awk '{print $1}' "$ZIP.sha256")"
  printf '  "macho_count": %s,\n' "$NMACH"
  printf '  "deployment_target_requested": "%s",\n' "$MACOS_MIN"
  printf '  "measured_floor": "%s",\n' "$FLOOR"
  printf '  "floor_setter_count": %s,\n' "$NSET"
  printf '  "floor_setters_ours": %s,\n' "$OURS_AT_FLOOR"
  printf '  "gatekeeper_accepted": %s,\n' "$([ "$SPCTL_RC" -eq 0 ] && echo true || echo false)"
  printf '  "spctl_exit": %s,\n' "$SPCTL_RC"
  printf '  "signature": "ad-hoc",\n'
  printf '  "minos_by_file": {\n'
  awk '{printf "    \"%s\": \"%s\",\n", $2, $1}' "$CENSUS" | sed '$s/,$//'
  printf '  }\n'
  printf '}\n'
} > "$MANIFEST"
say "manifest -> $MANIFEST"

# ── 12. optional hard gate on the measured floor ─────────────────────────────
# Deliberately LAST: the artifact and the manifest already exist, so a failure
# here leaves everything on disk to inspect. It fails the STEP, which is what
# stops an over-floor artifact from being uploaded or attached to a release.
if [ -n "$FLOOR_MAX" ]; then
  # sort puts the HIGHER version last. floor > max exactly when the higher of
  # the two is the floor AND they are not equal.
  higher="$(printf '%s\n%s\n' "$FLOOR_MAX" "$FLOOR" | sort -t. -k1,1n -k2,2n | tail -1)"
  if [ "$FLOOR" != "$FLOOR_MAX" ] && [ "$higher" = "$FLOOR" ]; then
    die "measured floor $FLOOR EXCEEDS --floor-max $FLOOR_MAX. The runner image
       almost certainly moved. This is the check that stops a silent bump in the
       minimum macOS of every artifact we ship. Files at the floor: $FLOOR_SETTERS"
  fi
  say "floor gate OK: measured $FLOOR <= allowed $FLOOR_MAX"
fi
