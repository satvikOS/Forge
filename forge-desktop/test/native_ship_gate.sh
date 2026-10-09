#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# native_ship_gate.sh — is the SHIPPING build of Forge actually native?
#
# The directive's release gate for the native application is "clean build and
# packaged launch without Electron/Node/JS/TS/Python product runtime". Before
# this gate, nothing asked that question of the artifact:
#
#   * FORGE_BUILD_NODE_ADDON defaults ON and every forge-kernel preset inherited
#     that default, so `cmake --preset macos-arm64-release*` ran `node` at
#     configure time and its forge_all built exactly one thing: forge-kernel.node.
#     MEASURED on b609b41d with node/python trap shims first on PATH:
#       TRAPPED node -e console.log(process.execPath)
#       FORGE_BUILD_NODE_ADDON:BOOL=ON   ->  "forge_all aggregates: forge_kernel"
#   * the release scripts built the app from ad-hoc -D flags, so "the release
#     build" was whatever two shell scripts happened to spell that week;
#   * the packager's launch smoke, `forge_desktop --headless`, returns before any
#     kernel, worker or Vulkan initialisation (src/main.cpp), so "the relocated
#     bundle launched and exited 0" proved that dyld resolved the closure and
#     nothing about whether the shipped kernel can model.
#
# WHAT THIS GATE DOES, in order, stopping at the first RED stage:
#
#   0 PREFLIGHT  the op-constraint table's sha256 pin (see below for why here).
#   1 PRESET     forge-kernel and forge-desktop both carry `macos-arm64-ship`, and
#                CMake's OWN resolution of those presets (inherits and all) pins
#                what ships: kernel FORGE_BUILD_NODE_ADDON=OFF -- explicitly, since
#                the CMakeLists default is ON -- FORGE_BUILD_DESKTOP_FOUNDATION=ON,
#                Release; app CMAKE_DISABLE_FIND_PACKAGE_Python3=ON, Release,
#                exported compile commands. The resolution configures a STUB
#                project that carries a copy of the presets file and nothing else,
#                so a preset that asks for the addon is caught HERE, before any
#                real configure exists to run node.
#   2 CONFIGURE  both projects are configured FROM THOSE PRESETS with trap shims
#                for node/npm/npx/node-gyp/cmake-js/yarn/pnpm/electron/python*
#                FIRST ON PATH. A shim records its invocation and exits 97. The
#                trap log is the authority, not a configure's exit status: CMake
#                ignores a failed execute_process and FindPython3 moves on to the
#                next interpreter when one fails, so a fired trap can sit inside a
#                "successful" configure.
#                The kernel configure ALSO passes -DFORGE_BUILD_NODE_ADDON=OFF: an
#                interlock, redundant with the pin stage 1 just verified, so that
#                no path through this gate can configure the addon even if stage 1
#                is edited away.
#                The caches must say FORGE_BUILD_NODE_ADDON=OFF and hold no N-API,
#                cmake-js or Python interpreter entry, and the generated kernel
#                build system must have no forge_kernel (.node) target.
#                ORDER: kernel configure -> kernel build -> app configure -> app
#                build, because the app's configure find_library()s the kernel
#                core and fails if it has not been built yet.
#   3 WERROR     every first-party translation unit in compile_commands.json
#                (forge-desktop/src+test, ui/src, archie/src, retrieval/src)
#                carries -Werror and no -Wno-error / -w / -Wno-everything, and
#                the cache's global CXX flags carry no such override.
#   4 BUILD      both build presets, still under the trap. Any COMPILER warning
#                (<path>:<line>:<col>: warning:) attributed to a first-party path
#                is RED: under -Werror a first-party warning cannot exist, so one
#                appearing means the policy did not reach that file. Kernel and
#                vendored warnings, and `ld: warning:` lines (the linker is not
#                governed by -Werror), are COUNTED in the report, not judged.
#                MEASURED on the first clean ship build: 474 kernel TUs with 12
#                compiler warnings -- 9 in an OCCT header (sprintf deprecated) and
#                3 in forge-kernel/src/native/brep (-Wswitch: EllipseExtrusion not
#                handled, Aabb.cpp:89, StepAnalytic.cpp:116 and :851); 88 app TUs
#                with 0 compiler warnings; 25 linker warnings, all but two of them
#                "built for newer version 26.0" from Homebrew bottles. Counts are
#                per RUN: a warm rebuild compiles nothing and reports 0.
#   5 GATES      the headless gates the desktop ship BUILD PRESET names (read from
#                forge-desktop/CMakePresets.json, so the list lives in one place)
#                run under ctest (under the trap), and exactly that many must pass.
#   6 PACKAGE    release_dryrun.sh --no-build packages the ship build into a
#                Forge.app + zip + appcast, ad-hoc signed, nothing published --
#                UNDER THE SAME TRAP: the release path runs no interpreter either
#                (its JSON reads are plutil, see release_dryrun.sh step 3b).
#   7 BUNDLE     no Node/Electron/Python artifact in the bundle: by NAME (*.node,
#                node_modules, *.js/*.mjs/*.cjs/*.ts, package.json, *.gyp*,
#                *.asar, *.py[co], Electron/Python frameworks) and by CONTENT for
#                every Mach-O (an N-API entry point or napi_/node::/Py* import,
#                or a load command naming libnode/Electron/Python) -- the content
#                check is what catches an addon renamed to libsomething.dylib.
#                Every load command must be @rpath/@executable_path/@loader_path
#                or /usr/lib or /System.
#   8 WORKER     a RELOCATED copy of the bundle's forge_kernel_worker, run under
#                `env -i` (no PATH, no HOME, no DYLD_*), builds a real solid from
#                an IR fixture -- a 40x30x20 block with a 6 mm through-hole -- and
#                its answer is checked against closed-form values computed HERE:
#                valid, volume = 24000 - 720*pi, the bounding box, 7 faces, a
#                non-empty tessellation.
#   9 LAUNCH     the relocated forge_desktop --headless under env -i exits 0 (dyld
#                resolved its whole closure from inside the bundle), and the
#                worker answers --version with its protocol magic.
#
# WHAT IT DOES NOT PROVE, said here so nobody reads more into a green run:
#   * an absolute-path invocation (/opt/homebrew/bin/node) bypasses a PATH trap,
#     and so does FindPython3 on macOS, which searches Python.framework before
#     PATH (measured 2026-10-08: with the lookup re-enabled it found
#     .../Python.framework/Versions/3.14/bin/python3.14 and never ran the shim).
#     That is why the Python3 lookup is judged by the PRESET pin (stage 1) and
#     the cache (stage 2) rather than by the trap; the artifact/symbol checks of
#     stage 7 are the last backstop, and the mutation proof shows which check
#     catches which defect;
#   * `--headless` still initialises no kernel, worker or Vulkan device -- stage 8
#     is the real modelling proof, and the windowed renderer is not launched;
#   * PREFLIGHT checks the op-constraint header's recorded sha256 against the
#     vocabulary file, which catches a vocabulary edited without regenerating the
#     header. It does NOT re-render the header (a hand edit of the header body
#     with the pin left intact passes here): that full check is Python, it is
#     what the ship preset keeps out of the build, and its gate of record stays
#     ui/test/run_op_constraint_gate.sh. This gate runs no interpreter at all;
#   * the kernel core (forge_kernel_core) is NOT compiled with -Werror; its
#     warnings are counted per run, not judged;
#   * one Mac, one toolchain. Not cross-platform evidence.
#
# USAGE
#   forge-desktop/test/native_ship_gate.sh                full gate
#   forge-desktop/test/native_ship_gate.sh --prove-mutations
#        full gate, then every mutation below, each of which MUST turn it RED for
#        its own named reason (a mutation that goes red for a different reason is
#        reported as a broken proof, not counted as a pass)
#   forge-desktop/test/native_ship_gate.sh --mutate <name> run one mutation
#   options: --jobs N  --kernel-build DIR  --app-build DIR  --dist DIR  --out DIR
#
# MUTATIONS (name -> the RED tags it must produce). No mutation configures the
# real kernel with the addon, runs node, or runs a Python interpreter: the
# preset mutations act on a COPY of a presets file resolved against a stub
# project, and the configure mutations use throwaway build trees under the trap.
#   node-addon          a copy of the kernel presets with the ship preset's
#                       FORGE_BUILD_NODE_ADDON flipped to ON              -> NODE-ADDON
#   node-addon-unpinned the same pin DELETED, so the CMakeLists default
#                       (ON) would apply                                  -> NODE-ADDON
#   python-unpinned     a copy of the desktop presets with the Python3
#                       lookup re-enabled (CMAKE_DISABLE_FIND_PACKAGE_
#                       Python3=OFF)                                      -> PYTHON
#   python-cache        app configured with an interpreter recorded in the
#                       cache (-DPython3_EXECUTABLE=<the trap shim>)      -> CACHE
#   python-by-name      a configure step that runs `python3` BY NAME
#                       (injected through CMAKE_PROJECT_INCLUDE)          -> TRAP
#   werror-off          app configured with CMAKE_CXX_FLAGS=-Wno-error    -> WERROR
#   gates-missing       a copy of the desktop presets naming one headless
#                       gate that does not exist, so ctest runs fewer
#                       gates than the preset promises                    -> GATES
#   optable-drift       a copy of the op vocabulary one byte longer than
#                       the one the header was generated from             -> OPTABLE
#   bundle-node-file    node_modules/, a *.node and an *.asar planted in
#                       the bundle (no .js file is written)               -> BUNDLE-NODE
#   bundle-napi-macho   a real N-API-shaped Mach-O (C, exports
#                       napi_register_module_v1) named libforge_helper    -> BUNDLE-NODE
#   worker-stub         worker replaced by a script that speaks the
#                       protocol and models nothing                       -> WORKER
#   missing-dylib       libforge_kernel_core.dylib removed from the bundle -> WORKER LAUNCH
#
# Exit 0 = GREEN, 1 = RED, 2 = usage / environment error.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF="$ROOT/forge-desktop/test/native_ship_gate.sh"
PRESET="macos-arm64-ship"

KERNEL_BUILD="${KERNEL_BUILD:-$ROOT/.forge-local/builds/$PRESET}"
APP_BUILD="${APP_BUILD:-$ROOT/.forge-local/builds/$PRESET-app}"
DIST="${DIST:-$ROOT/.forge-local/ship-dist}"
OUT="${OUT:-$ROOT/.forge-local/ship-gate}"
if [ -z "${JOBS:-}" ]; then
  JOBS="$( (command -v forge-nproc >/dev/null 2>&1 && forge-nproc) || echo 4)"
fi
MUTATION=""
PROVE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --jobs)         shift; JOBS="${1:?--jobs needs a value}" ;;
    --kernel-build) shift; KERNEL_BUILD="${1:?}" ;;
    --app-build)    shift; APP_BUILD="${1:?}" ;;
    --dist)         shift; DIST="${1:?}" ;;
    --out)          shift; OUT="${1:?}" ;;
    --mutate)       shift; MUTATION="${1:?--mutate needs a name}" ;;
    --prove-mutations) PROVE=1 ;;
    -h|--help)      awk 'NR>1 && !/^#/{exit} NR>1{print}' "$SELF"; exit 0 ;;
    *) echo "[ship-gate] unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

ALL_MUTATIONS="node-addon node-addon-unpinned python-unpinned python-cache python-by-name werror-off gates-missing optable-drift bundle-node-file bundle-napi-macho worker-stub missing-dylib"
expected_tags() {
  case "$1" in
    node-addon)          echo "NODE-ADDON" ;;
    node-addon-unpinned) echo "NODE-ADDON" ;;
    python-unpinned)     echo "PYTHON" ;;
    python-cache)        echo "CACHE" ;;
    python-by-name)      echo "TRAP" ;;
    werror-off)          echo "WERROR" ;;
    gates-missing)       echo "GATES" ;;
    optable-drift)       echo "OPTABLE" ;;
    bundle-node-file)    echo "BUNDLE-NODE" ;;
    bundle-napi-macho)   echo "BUNDLE-NODE" ;;
    worker-stub)         echo "WORKER" ;;
    missing-dylib)       echo "WORKER LAUNCH" ;;
    *) return 1 ;;
  esac
}

# The inputs the gate judges. Mutations point these at COPIES; the real files are
# never edited by this script.
KERNEL_PRESETS="$ROOT/forge-kernel/CMakePresets.json"
DESKTOP_PRESETS="$ROOT/forge-desktop/CMakePresets.json"
OP_VOCAB="$ROOT/implementation/sacrosanct/archie_op_vocabulary.json"
OP_HEADER="$ROOT/ui/include/forge/ui/ArchieOpVocabulary.hpp"
if [ -n "$MUTATION" ] && ! expected_tags "$MUTATION" >/dev/null; then
  echo "[ship-gate] unknown mutation '$MUTATION' (known: $ALL_MUTATIONS)" >&2; exit 2
fi

say()  { printf '[ship-gate] %s\n' "$*"; }
FAILS=0
FAIL_TAGS=""
fail() {   # fail TAG message...
  local tag="$1"; shift
  printf '[ship-gate] RED[%s] %s\n' "$tag" "$*"
  FAILS=$((FAILS + 1))
  case " $FAIL_TAGS " in *" $tag "*) ;; *) FAIL_TAGS="$FAIL_TAGS $tag" ;; esac
}
STAGE_LOG=""
stage_end() {   # stop at the first RED stage; later stages depend on earlier ones
  local name="$1"
  if [ "$FAILS" -gt 0 ]; then
    STAGE_LOG="$STAGE_LOG $name=RED"
    finish
  fi
  STAGE_LOG="$STAGE_LOG $name=GREEN"
  say "stage $name: GREEN"
}

mkdir -p "$OUT" || { echo "[ship-gate] cannot create $OUT" >&2; exit 2; }
RUN=""
TRAP_LOG=""
REPORT="$OUT/native_ship_gate${MUTATION:+.mut-$MUTATION}.json"

finish() {
  local verdict="GREEN"; [ "$FAILS" -gt 0 ] && verdict="RED"
  {
    printf '{\n'
    printf '  "gate": "native_ship_gate",\n'
    printf '  "verdict": "%s",\n' "$verdict"
    printf '  "mutation": "%s",\n' "${MUTATION:-none}"
    printf '  "red_tags": "%s",\n' "${FAIL_TAGS# }"
    printf '  "stages": "%s",\n' "${STAGE_LOG# }"
    printf '  "commit": "%s",\n' "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"
    printf '  "tree_dirty": %s,\n' "$( [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ] && echo true || echo false)"
    printf '  "cmake": "%s",\n' "$(cmake --version 2>/dev/null | head -1)"
    printf '  "cxx": "%s",\n' "$(awk -F= '/^CMAKE_CXX_COMPILER:/{print $2}' "$APP_BUILD/CMakeCache.txt" 2>/dev/null) $(c++ --version 2>/dev/null | head -1)"
    printf '  "trap_hits": %s,\n' "${TRAP_HITS:-0}"
    printf '  "firstparty_tus_audited": %s,\n' "${FP_TUS:-0}"
    printf '  "kernel_compiled_tus_this_run": %s,\n' "${K_TUS:-0}"
    printf '  "kernel_compiler_warnings_this_run": %s,\n' "${K_WARN:-0}"
    printf '  "kernel_compiler_warnings_in_forge_kernel": %s,\n' "${K_WARN_OWN:-0}"
    printf '  "app_compiled_tus_this_run": %s,\n' "${A_TUS:-0}"
    printf '  "app_nonfirstparty_compiler_warnings_this_run": %s,\n' "${A_WARN_OTHER:-0}"
    printf '  "linker_warnings_this_run": %s,\n' "${LD_WARN:-0}"
    printf '  "headless_gates_passed": "%s",\n' "${GATES_PASSED:-}"
    printf '  "bundle_macho_count": %s,\n' "${N_MACHO:-0}"
    printf '  "worker_volume": "%s",\n' "${W_VOL:-}"
    printf '  "worker_volume_expected": "%s",\n' "${V_EXP:-}"
    printf '  "worker_faces": "%s",\n' "${W_FACES:-}"
    printf '  "worker_triangles": "%s",\n' "${W_TRIS:-}"
    printf '  "logs": "%s"\n' "$RUN"
    printf '}\n'
  } > "$REPORT"
  if [ "$verdict" = "GREEN" ]; then
    say "PASS — the shipping build is native: no Node/Electron/Python in its build or its bundle, -Werror intact, the bundled worker models under env -i"
    say "report: $REPORT"
    exit 0
  fi
  say "FAIL — $FAILS check(s) RED:${FAIL_TAGS}"
  say "report: $REPORT   logs: $RUN"
  exit 1
}

# ── bounded execution (macOS runners have no timeout(1)) ─────────────────────
# bounded <secs> <stdin-file|-> <stdout> <stderr> cmd...   -> rc, or 124 on expiry
bounded() {
  local lim="$1" in="$2" o="$3" e="$4"; shift 4
  if [ "$in" = "-" ]; then in=/dev/null; fi
  "$@" < "$in" > "$o" 2> "$e" &
  local pid=$! n=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$n" -ge $((lim * 10)) ]; then
      kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 124
    fi
    sleep 0.1; n=$((n + 1))
  done
  wait "$pid"
}

# ═════════════════════════════════════════════════════════════════════════════
# --prove-mutations: green run first, then every mutation must go RED for ITS
# reason. Each mutation is a child invocation of this same script.
# ═════════════════════════════════════════════════════════════════════════════
if [ "$PROVE" = "1" ]; then
  say "mutation proof: GREEN baseline first"
  bash "$SELF" --jobs "$JOBS" --kernel-build "$KERNEL_BUILD" --app-build "$APP_BUILD" \
       --dist "$DIST" --out "$OUT" > "$OUT/baseline.log" 2>&1
  rc=$?
  tail -3 "$OUT/baseline.log"
  if [ "$rc" -ne 0 ]; then
    say "the unmutated gate is RED (exit $rc) — a mutation proof over a red baseline proves nothing"
    exit 1
  fi
  bad=0; n=0
  for m in $ALL_MUTATIONS; do
    n=$((n + 1))
    bash "$SELF" --mutate "$m" --jobs "$JOBS" --kernel-build "$KERNEL_BUILD" \
         --app-build "$APP_BUILD" --dist "$DIST" --out "$OUT" > "$OUT/mutation.$m.log" 2>&1
    mrc=$?
    want="$(expected_tags "$m")"
    missing=""
    for t in $want; do
      grep -qF "RED[$t]" "$OUT/mutation.$m.log" || missing="$missing $t"
    done
    if [ "$mrc" -eq 0 ]; then
      say "  mutation $m: STAYED GREEN — the gate cannot see this defect"; bad=$((bad + 1))
    elif [ "$mrc" -ne 1 ]; then
      say "  mutation $m: exit $mrc (environment/usage error, not a verdict)"; tail -5 "$OUT/mutation.$m.log"; bad=$((bad + 1))
    elif [ -n "$missing" ]; then
      say "  mutation $m: RED but WITHOUT the expected reason(s):$missing"
      grep -F 'RED[' "$OUT/mutation.$m.log" | head -5
      bad=$((bad + 1))
    else
      say "  mutation $m: RED as required [$(grep -oE 'RED\[[A-Z-]+\]' "$OUT/mutation.$m.log" | sort -u | tr '\n' ' ')]"
    fi
  done
  if [ "$bad" -ne 0 ]; then say "MUTATION PROOF FAILED: $bad of $n"; exit 1; fi
  say "MUTATION PROOF PASSED: $n of $n mutations turned the gate RED for their own reason"
  exit 0
fi

RUN="$(mktemp -d "$OUT/run.XXXXXX")" || exit 2

# ── trap shims ───────────────────────────────────────────────────────────────
TRAPDIR="$RUN/trap-bin"
TRAP_LOG="$RUN/trap.log"
mkdir -p "$TRAPDIR"; : > "$TRAP_LOG"
for t in node nodejs npm npx node-gyp cmake-js yarn pnpm corepack electron electron-builder \
         python python3 python3.9 python3.10 python3.11 python3.12 python3.13 python3.14 \
         pip pip3; do
  cat > "$TRAPDIR/$t" <<SHIM
#!/bin/sh
# native_ship_gate.sh trap: the shipping build must not run $t.
printf 'TRAPPED %s %s (cwd %s)\n' "$t" "\$*" "\$(pwd)" >> "$TRAP_LOG"
exit 97
SHIM
  chmod +x "$TRAPDIR/$t"
done
# Anything that would let a build reach a Node toolchain without PATH is removed
# from the build's environment rather than trusted to be absent.
TRAP_ENV=(env -u FORGE_NODE_MODULES -u NODE_PATH -u NODE_OPTIONS -u npm_config_prefix
          -u PYTHONPATH -u PYTHONHOME -u VIRTUAL_ENV "PATH=$TRAPDIR:$PATH")
check_trap() {   # check_trap <phase>
  if [ -s "$TRAP_LOG" ]; then
    fail TRAP "$1 invoked a trapped Node/Electron/Python tool:"
    sed 's/^/             /' "$TRAP_LOG"
    TRAP_HITS=$(( ${TRAP_HITS:-0} + $(wc -l < "$TRAP_LOG") ))
    : > "$TRAP_LOG"
  fi
}

# ── mutations ────────────────────────────────────────────────────────────────
# Preset and vocabulary mutations act on a COPY of the file and point the gate's
# input variable at it. Configure mutations use THROWAWAY build trees, so a proof
# never poisons the real ship build. Bundle mutations act on a COPY of the bundle.
# mutate_copy <src> <dst> <expected-changed-line-count> <awk program>
mutate_copy() {
  local src="$1" dst="$2" want="$3" prog="$4" changed
  mkdir -p "$(dirname "$dst")"
  awk "$prog" "$src" > "$dst" || { echo "[ship-gate] cannot write the mutated copy $dst" >&2; exit 2; }
  changed="$(diff "$src" "$dst" | grep -c '^[<>]' || true)"
  if [ "$changed" != "$want" ]; then
    echo "[ship-gate] mutation $MUTATION did not apply as designed to a copy of $src ($changed changed line(s), want $want) -- the file moved; fix the mutation" >&2
    exit 2
  fi
}
MUT_APP_ARGS=()
MUTDIR="$RUN/mutated"
case "$MUTATION" in
  node-addon)
    mutate_copy "$KERNEL_PRESETS" "$MUTDIR/forge-kernel/CMakePresets.json" 2 \
      '{ if ($0 ~ /"FORGE_BUILD_NODE_ADDON": *"OFF"/) sub(/"OFF"/, "\"ON\""); print }'
    KERNEL_PRESETS="$MUTDIR/forge-kernel/CMakePresets.json" ;;
  node-addon-unpinned)
    # The pin is not the last key of its object, so dropping the line keeps the
    # JSON valid (CMake would otherwise reject the file, which is a different RED).
    mutate_copy "$KERNEL_PRESETS" "$MUTDIR/forge-kernel/CMakePresets.json" 1 \
      '!/"FORGE_BUILD_NODE_ADDON": *"OFF",[ \t]*$/'
    KERNEL_PRESETS="$MUTDIR/forge-kernel/CMakePresets.json" ;;
  python-unpinned)
    mutate_copy "$DESKTOP_PRESETS" "$MUTDIR/forge-desktop/CMakePresets.json" 2 \
      '{ if ($0 ~ /"CMAKE_DISABLE_FIND_PACKAGE_Python3": *"ON"/) sub(/"ON"/, "\"OFF\""); print }'
    DESKTOP_PRESETS="$MUTDIR/forge-desktop/CMakePresets.json" ;;
  gates-missing)
    # One more gate name as the FIRST target, so the JSON stays valid wherever the
    # real list ends.
    mutate_copy "$DESKTOP_PRESETS" "$MUTDIR/forge-desktop/CMakePresets.json" 1 \
      '{ print } /"targets": *\[[ \t]*$/ && !done { print "        \"forge_desktop_absent_gate\","; done=1 }'
    DESKTOP_PRESETS="$MUTDIR/forge-desktop/CMakePresets.json" ;;
  optable-drift)
    mkdir -p "$MUTDIR"
    { cat "$OP_VOCAB"; printf '\n'; } > "$MUTDIR/archie_op_vocabulary.json"
    OP_VOCAB="$MUTDIR/archie_op_vocabulary.json" ;;
  python-cache)
    # An interpreter recorded in the cache, with the lookup still disabled. The
    # value is the trap shim, so even a step that did run it would run no Python.
    APP_BUILD="$RUN/mut-app"
    MUT_APP_ARGS=("-DPython3_EXECUTABLE=$TRAPDIR/python3") ;;
  python-by-name)
    APP_BUILD="$RUN/mut-app"
    printf 'execute_process(COMMAND python3 -c "print(1)" RESULT_VARIABLE _ignored OUTPUT_QUIET ERROR_QUIET)\n' \
      > "$RUN/python_by_name.cmake"
    MUT_APP_ARGS=("-DCMAKE_PROJECT_INCLUDE=$RUN/python_by_name.cmake") ;;
  werror-off)
    APP_BUILD="$RUN/mut-app"
    MUT_APP_ARGS=("-DCMAKE_CXX_FLAGS=-Wno-error") ;;
esac

say "ROOT=$ROOT"
say "kernel build: $KERNEL_BUILD"
say "app build:    $APP_BUILD"
say "dist:         $DIST    jobs: $JOBS    mutation: ${MUTATION:-none}"

FIRSTPARTY_RE="^$ROOT/(forge-desktop/(src|test)|ui/(src|include)|archie/(src|include)|retrieval/(src|include))/"

# ═════════════════════════════════════════════════════════════════════════════
# 0 PREFLIGHT — the op-constraint table's sha256 pin
# ═════════════════════════════════════════════════════════════════════════════
# The ship preset keeps Python out of the BUILD (CMAKE_DISABLE_FIND_PACKAGE_Python3),
# which also removes the build-time `gen_op_constraint_table.py --check`. What is
# checkable here WITHOUT an interpreter is the generator's own provenance record:
# the header carries sha256(vocabulary) twice -- in its banner and as
# kVocabularySha256 -- and both must equal the vocabulary file as it is now. A
# vocabulary edited without regenerating the header fails this. A hand edit of the
# header BODY does not (the full re-render is ui/test/run_op_constraint_gate.sh).
run_preflight() {
  local want banner konst
  if [ ! -f "$OP_VOCAB" ] || [ ! -f "$OP_HEADER" ]; then
    fail OPTABLE "missing $OP_VOCAB or $OP_HEADER"
  else
    want="$(shasum -a 256 "$OP_VOCAB" | awk '{print $1}')"
    banner="$(LC_ALL=C sed -n 's|^// sha256(vocabulary) = \([0-9a-f]\{64\}\)$|\1|p' "$OP_HEADER")"
    konst="$(LC_ALL=C sed -n 's|^inline constexpr std::string_view kVocabularySha256 = "\([0-9a-f]\{64\}\)";$|\1|p' "$OP_HEADER")"
    if [ -z "$banner" ] || [ -z "$konst" ]; then
      fail OPTABLE "${OP_HEADER#"$ROOT"/} carries no sha256(vocabulary) banner or kVocabularySha256 -- cannot tell what it was generated from"
    elif [ "$banner" != "$want" ] || [ "$konst" != "$want" ]; then
      fail OPTABLE "${OP_HEADER#"$ROOT"/} was generated from vocabulary sha256 ${konst:0:12} (banner ${banner:0:12}); the vocabulary is now ${want:0:12} -- regenerate it (gen_op_constraint_table.py --write) and rerun ui/test/run_op_constraint_gate.sh"
    else
      say "preflight: op-constraint header pins vocabulary sha256 ${want:0:12}, which is the vocabulary on disk (pin only; the full re-render is ui/test/run_op_constraint_gate.sh)"
    fi
  fi
  stage_end PREFLIGHT
}

# ═════════════════════════════════════════════════════════════════════════════
# 1 PRESET — resolved by CMake itself, against a STUB project
# ═════════════════════════════════════════════════════════════════════════════
# preset_probe <presets.json> <probe dir>: configure a stub project (no languages,
# no commands) that carries a copy of <presets.json>, from the ship preset, under
# the trap. Its CMakeCache.txt is then exactly what the preset resolves to --
# inherits, macros and all -- with no project code having run.
preset_probe() {
  local src="$1" dir="$2"
  mkdir -p "$dir/src"
  cp "$src" "$dir/src/CMakePresets.json" || return 1
  printf 'cmake_minimum_required(VERSION 3.25)\nproject(forge_ship_preset_probe NONE)\n' > "$dir/src/CMakeLists.txt"
  (cd "$dir/src" && "${TRAP_ENV[@]}" cmake --preset "$PRESET" -B "$dir/build") > "$dir/probe.log" 2>&1
}
has_preset() {   # has_preset <probe dir> configure|build
  (cd "$1/src" && cmake --list-presets="$2" 2>/dev/null) | grep -q "\"$PRESET\""
}
run_preset_stage() {
  local kp="$RUN/preset-probe/kernel" dp="$RUN/preset-probe/desktop" v
  if [ ! -f "$DESKTOP_PRESETS" ]; then
    fail PRESET "forge-desktop/CMakePresets.json does not exist — the app has no shipping preset at all"
  fi
  if [ ! -f "$KERNEL_PRESETS" ]; then
    fail PRESET "forge-kernel/CMakePresets.json does not exist"
  fi
  [ "$FAILS" -eq 0 ] || { stage_end PRESET; return; }

  if ! preset_probe "$KERNEL_PRESETS" "$kp" || ! has_preset "$kp" configure; then
    fail PRESET "forge-kernel/CMakePresets.json has no usable '$PRESET' configure preset — the shipping build is still assembled from ad-hoc -D flags: $(grep -m1 -iE 'error' "$kp/probe.log")"
  else
    v="$(cache_get "$kp/build" FORGE_BUILD_NODE_ADDON)"
    [ "$v" = "OFF" ] || fail NODE-ADDON "the kernel '$PRESET' preset resolves FORGE_BUILD_NODE_ADDON=${v:-<not pinned: the CMakeLists default, ON, would apply>}; the shipping preset must pin it OFF"
    v="$(cache_get "$kp/build" FORGE_BUILD_DESKTOP_FOUNDATION)"
    [ "$v" = "ON" ] || fail PRESET "the kernel '$PRESET' preset resolves FORGE_BUILD_DESKTOP_FOUNDATION=${v:-<unset>}; the app links forge_kernel_core, which only exists when it is ON"
    v="$(cache_get "$kp/build" CMAKE_BUILD_TYPE)"
    [ "$v" = "Release" ] || fail PRESET "the kernel '$PRESET' preset resolves CMAKE_BUILD_TYPE=${v:-<unset>}, not Release"
  fi
  has_preset "$kp" build || fail PRESET "forge-kernel/CMakePresets.json has no '$PRESET' build preset"

  if ! preset_probe "$DESKTOP_PRESETS" "$dp" || ! has_preset "$dp" configure; then
    fail PRESET "forge-desktop/CMakePresets.json has no usable '$PRESET' configure preset: $(grep -m1 -iE 'error' "$dp/probe.log")"
  else
    v="$(cache_get "$dp/build" CMAKE_DISABLE_FIND_PACKAGE_Python3)"
    [ "$v" = "ON" ] || fail PYTHON "the desktop '$PRESET' preset resolves CMAKE_DISABLE_FIND_PACKAGE_Python3=${v:-<unset>}; with the lookup live the build finds an interpreter (Python.framework, ahead of PATH) and runs it"
    v="$(cache_get "$dp/build" CMAKE_BUILD_TYPE)"
    [ "$v" = "Release" ] || fail PRESET "the desktop '$PRESET' preset resolves CMAKE_BUILD_TYPE=${v:-<unset>}, not Release"
    v="$(cache_get "$dp/build" CMAKE_EXPORT_COMPILE_COMMANDS)"
    [ "$v" = "ON" ] || fail PRESET "the desktop '$PRESET' preset resolves CMAKE_EXPORT_COMPILE_COMMANDS=${v:-<unset>}; stage WERROR audits through it"
  fi
  has_preset "$dp" build || fail PRESET "forge-desktop/CMakePresets.json has no '$PRESET' build preset"
  check_trap "preset resolution"
  stage_end PRESET
}

# ═════════════════════════════════════════════════════════════════════════════
# 2 CONFIGURE (trapped) + 3 WERROR
# ═════════════════════════════════════════════════════════════════════════════
cache_get() { awk -F= -v k="$2" 'index($0, k ":")==1 {sub(/^[^=]*=/, ""); print; exit}' "$1/CMakeCache.txt" 2>/dev/null; }

configure_kernel() {
  # Interlock: the real kernel is only ever configured from the REAL presets file
  # (a mutation judges a copy, and stops at stage PRESET), and always with the
  # addon explicitly OFF.
  if [ "$KERNEL_PRESETS" != "$ROOT/forge-kernel/CMakePresets.json" ]; then
    echo "[ship-gate] internal error: refusing to configure forge-kernel while judging a presets copy" >&2; exit 2
  fi
  say "configure forge-kernel from preset $PRESET (trap shims first on PATH)"
  (cd "$ROOT/forge-kernel" && "${TRAP_ENV[@]}" cmake --preset "$PRESET" -B "$KERNEL_BUILD" \
      -DFORGE_BUILD_NODE_ADDON=OFF) > "$RUN/kernel.configure.log" 2>&1
  local rc=$?
  check_trap "kernel configure"
  [ "$rc" -eq 0 ] || fail CONFIGURE "forge-kernel configure from '$PRESET' failed (exit $rc): $(grep -m1 -A2 'CMake Error' "$RUN/kernel.configure.log" | tr '\n' ' ')"
  local addon; addon="$(cache_get "$KERNEL_BUILD" FORGE_BUILD_NODE_ADDON)"
  [ "$addon" = "OFF" ] || fail NODE-ADDON "kernel cache has FORGE_BUILD_NODE_ADDON=${addon:-<unset>}; the ship preset must build no N-API addon"
  local fnd; fnd="$(cache_get "$KERNEL_BUILD" FORGE_BUILD_DESKTOP_FOUNDATION)"
  [ "$fnd" = "ON" ] || fail CONFIGURE "kernel cache has FORGE_BUILD_DESKTOP_FOUNDATION=${fnd:-<unset>}; the app links forge_kernel_core, which only exists when it is ON"
  if grep -qE '^forge_kernel:' "$KERNEL_BUILD/Makefile" 2>/dev/null; then
    fail NODE-ADDON "the generated kernel build system has a forge_kernel target (forge-kernel.node)"
  fi
  if grep -qE '^(NODE_ADDON_API_DIR|CMAKE_JS_[A-Z]+|NODE_EXE|NODE_DIR)[:=]' "$KERNEL_BUILD/CMakeCache.txt" 2>/dev/null; then
    fail CACHE "kernel cache holds Node entries: $(grep -E '^(NODE_ADDON_API_DIR|CMAKE_JS_|NODE_EXE|NODE_DIR)' "$KERNEL_BUILD/CMakeCache.txt" | tr '\n' ' ')"
  fi
}

configure_app() {
  say "configure forge-desktop from preset $PRESET (trap shims first on PATH)"
  (cd "$ROOT/forge-desktop" && "${TRAP_ENV[@]}" cmake --preset "$PRESET" -B "$APP_BUILD" \
      "-DFORGE_KERNEL_BUILD_DIR=$KERNEL_BUILD" \
      ${MUT_APP_ARGS[@]+"${MUT_APP_ARGS[@]}"}) > "$RUN/app.configure.log" 2>&1
  local rc=$?
  check_trap "app configure"
  [ "$rc" -eq 0 ] || fail CONFIGURE "forge-desktop configure from '$PRESET' failed (exit $rc): $(grep -m1 -A2 'CMake Error' "$RUN/app.configure.log" | tr '\n' ' ')"
  if grep -qE '^(Python3?_EXECUTABLE|_Python3_EXECUTABLE|PYTHON_EXECUTABLE)[:=]' "$APP_BUILD/CMakeCache.txt" 2>/dev/null; then
    fail CACHE "app cache holds a Python interpreter: $(grep -E '^_?Python3?_EXECUTABLE|^PYTHON_EXECUTABLE' "$APP_BUILD/CMakeCache.txt" | tr '\n' ' ') — the build would run it"
  fi
  if grep -qE '^forge_ui_op_table_check:' "$APP_BUILD/Makefile" 2>/dev/null; then
    fail CACHE "the generated app build system runs forge_ui_op_table_check (a Python step) inside the shipping build"
  fi
  local kb; kb="$(cache_get "$APP_BUILD" FORGE_KERNEL_BUILD_DIR)"
  [ "$kb" = "$KERNEL_BUILD" ] || fail CONFIGURE "app links the kernel from '$kb', not the ship kernel build '$KERNEL_BUILD'"
}

audit_werror() {
  local cc="$APP_BUILD/compile_commands.json"
  if [ ! -f "$cc" ]; then
    fail WERROR "no $cc — the ship preset must export compile commands so -Werror can be audited"
    return
  fi
  # One JSON object per TU; CMake writes "directory", "command", "file", "output"
  # one key per line. Judge each object at its closing brace.
  awk -v re="$FIRSTPARTY_RE" '
    /^\{/ { cmd=""; f="" }
    /"command":/ { cmd=$0 }
    /"file":/ { f=$0; sub(/^[^:]*: *"/, "", f); sub(/",?[ \t]*$/, "", f) }
    /^\}/ {
      if (f ~ re) {
        n++
        if (cmd !~ / -Werror([ "]|$)/) { print "NO-WERROR " f; bad++ }
        if (cmd ~ /-Wno-error|-Wno-everything| -w([ "]|$)/) { print "OVERRIDE " f; bad++ }
      }
    }
    END { print "COUNT " n+0 " " bad+0 }' "$cc" > "$RUN/werror.audit" 2>&1
  FP_TUS="$(awk '/^COUNT/{print $2}' "$RUN/werror.audit")"
  local bad; bad="$(awk '/^COUNT/{print $3}' "$RUN/werror.audit")"
  if [ "${FP_TUS:-0}" -lt 40 ]; then
    fail WERROR "only ${FP_TUS:-0} first-party TUs found in compile_commands.json — the audit would pass vacuously"
  fi
  if [ "${bad:-1}" -ne 0 ]; then
    fail WERROR "$bad first-party TU(s) compile without an effective -Werror:"
    grep -v '^COUNT' "$RUN/werror.audit" | head -10 | sed 's/^/             /'
  fi
  local flags
  for v in CMAKE_CXX_FLAGS CMAKE_CXX_FLAGS_RELEASE CMAKE_OBJCXX_FLAGS CMAKE_OBJCXX_FLAGS_RELEASE; do
    flags="$(cache_get "$APP_BUILD" "$v")"
    case " $flags " in
      *-Wno-error*|*" -w "*|*-Wno-everything*) fail WERROR "$v='$flags' disables -Werror globally" ;;
    esac
  done
  say "  -Werror audit: ${FP_TUS:-0} first-party TUs, ${bad:-?} without effective -Werror"
}

# ═════════════════════════════════════════════════════════════════════════════
# 4 BUILD (trapped)
# ═════════════════════════════════════════════════════════════════════════════
count_tus() { grep -cE 'Building (CXX|C|OBJCXX) object' "$1" 2>/dev/null || true; }
# A COMPILER diagnostic is "<path>:<line>:<col>: warning: ..."; "ld: warning: ..."
# is the linker, which -Werror does not govern, and is counted separately.
CC_WARN_RE='^[^ :]+:[0-9]+:[0-9]+: warning: '

build_kernel() {
  say "build forge-kernel preset $PRESET -j$JOBS"
  (cd "$ROOT/forge-kernel" && "${TRAP_ENV[@]}" cmake --build "$KERNEL_BUILD" --preset "$PRESET" -j "$JOBS") \
    > "$RUN/kernel.build.log" 2>&1
  local rc=$?
  check_trap "kernel build"
  [ "$rc" -eq 0 ] || { fail BUILD "kernel build failed (exit $rc)"; grep -m10 -E 'error:|Error ' "$RUN/kernel.build.log" | sed 's/^/             /'; return; }
  K_TUS="$(count_tus "$RUN/kernel.build.log")"
  grep -E "$CC_WARN_RE" "$RUN/kernel.build.log" > "$RUN/kernel.warnings" || true
  K_WARN="$(wc -l < "$RUN/kernel.warnings" | tr -d ' ')"
  K_WARN_OWN="$(grep -c "^$ROOT/forge-kernel/" "$RUN/kernel.warnings" || true)"
  [ -f "$KERNEL_BUILD/libforge_kernel_core.dylib" ] || fail BUILD "no libforge_kernel_core.dylib in $KERNEL_BUILD"
  local nodes; nodes="$(find "$KERNEL_BUILD" -name '*.node' -type f 2>/dev/null | head -3)"
  [ -z "$nodes" ] || fail NODE-ADDON "the kernel ship build produced a Node addon: $nodes"
  say "  kernel: ${K_TUS} TUs compiled this run, ${K_WARN} compiler warnings, ${K_WARN_OWN} of them in forge-kernel/ (forge_kernel_core is not -Werror: counted, not judged)"
}

build_app() {
  say "build forge-desktop preset $PRESET -j$JOBS"
  (cd "$ROOT/forge-desktop" && "${TRAP_ENV[@]}" cmake --build "$APP_BUILD" --preset "$PRESET" -j "$JOBS") \
    > "$RUN/app.build.log" 2>&1
  local rc=$?
  check_trap "app build"
  [ "$rc" -eq 0 ] || { fail BUILD "app build failed (exit $rc)"; grep -m10 -E 'error:|Error ' "$RUN/app.build.log" | sed 's/^/             /'; return; }
  A_TUS="$(count_tus "$RUN/app.build.log")"
  grep -E "$CC_WARN_RE" "$RUN/app.build.log" > "$RUN/app.warnings" || true
  grep -E "$FIRSTPARTY_RE" "$RUN/app.warnings" > "$RUN/app.warnings.firstparty" || true
  A_WARN_OTHER=$(( $(wc -l < "$RUN/app.warnings") - $(wc -l < "$RUN/app.warnings.firstparty") ))
  if [ -s "$RUN/app.warnings.firstparty" ]; then
    fail WERROR "$(wc -l < "$RUN/app.warnings.firstparty" | tr -d ' ') compiler warning(s) in FIRST-PARTY code reached the log — -Werror did not apply there:"
    head -5 "$RUN/app.warnings.firstparty" | sed 's/^/             /'
  fi
  LD_WARN="$(cat "$RUN/kernel.build.log" "$RUN/app.build.log" | grep -cE '^ld: warning' || true)"
  local exe
  for exe in forge_desktop forge_kernel_worker forge_update libforge_expr.dylib; do
    [ -f "$APP_BUILD/$exe" ] || fail BUILD "the app ship build did not produce $exe"
  done
  say "  app:    ${A_TUS} TUs compiled this run, 0 first-party compiler warnings (required), ${A_WARN_OTHER} in vendored/LGPL-library code; ${LD_WARN} linker warnings (kernel+app)"
}

# ═════════════════════════════════════════════════════════════════════════════
# 5 GATES
# ═════════════════════════════════════════════════════════════════════════════
# preset_targets <presets.json>: the ship BUILD preset's target list, one per line,
# read as JSON (plutil, no interpreter) rather than grepped out of prose.
preset_targets() {
  local f="$1" n i=0 m j name
  n="$(plutil -extract buildPresets raw -o - "$f" 2>/dev/null)" || return 1
  while [ "$i" -lt "${n:-0}" ]; do
    name="$(plutil -extract "buildPresets.$i.name" raw -o - "$f" 2>/dev/null)"
    if [ "$name" = "$PRESET" ]; then
      m="$(plutil -extract "buildPresets.$i.targets" raw -o - "$f" 2>/dev/null)" || return 1
      j=0
      while [ "$j" -lt "${m:-0}" ]; do
        plutil -extract "buildPresets.$i.targets.$j" raw -o - "$f" 2>/dev/null || return 1
        j=$((j + 1))
      done
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}
run_headless_gates() {
  local list n names re targets
  if ! targets="$(preset_targets "$DESKTOP_PRESETS")"; then
    fail GATES "cannot read the '$PRESET' build preset's targets from ${DESKTOP_PRESETS#"$ROOT"/}"
    return
  fi
  list="$(printf '%s\n' "$targets" | grep -E '^forge_desktop_[a-z0-9_]+_gate$' | sort -u)"
  n="$(printf '%s\n' "$list" | grep -c . || true)"
  if [ "${n:-0}" -lt 1 ]; then
    fail GATES "the desktop ship build preset names no headless gate — the packaged product would be gated by nothing"
    return
  fi
  names="$(printf '%s\n' "$list" | paste -sd'|' -)"
  re="^(${names})\$"
  say "headless gates named by the ship build preset ($n): $(printf '%s ' $list)"
  (cd "$APP_BUILD" && "${TRAP_ENV[@]}" ctest --test-dir "$APP_BUILD" -R "$re" --output-on-failure \
      --no-tests=error --timeout 600) > "$RUN/ctest.log" 2>&1
  local rc=$?
  check_trap "headless gates"
  local ran; ran="$(grep -oE '[0-9]+ tests? failed out of [0-9]+' "$RUN/ctest.log" | awk '{print $NF}')"
  if [ "$rc" -ne 0 ]; then
    fail GATES "headless gates RED (ctest exit $rc):"
    grep -E 'Failed|\*\*\*|No tests were found' "$RUN/ctest.log" | head -10 | sed 's/^/             /'
  elif [ "${ran:-0}" != "$n" ]; then
    fail GATES "ctest ran ${ran:-0} gates; the ship preset names $n"
  else
    GATES_PASSED="$(printf '%s ' $list)"
    say "  $n of $n headless gates passed"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# 6 PACKAGE — the release dry run, nothing published, under the trap
# ═════════════════════════════════════════════════════════════════════════════
package_bundle() {
  say "release dry run (--no-build): package the ship build, ad-hoc signed, nothing published (trap shims first on PATH)"
  "${TRAP_ENV[@]}" KERNEL_BUILD="$KERNEL_BUILD" APP_BUILD="$APP_BUILD" DIST="$DIST" \
    bash "$ROOT/forge-desktop/release_dryrun.sh" --no-build --version 0.0.0-shipgate \
    > "$RUN/dryrun.log" 2>&1
  local rc=$?
  check_trap "release dry run (packaging)"
  if [ "$rc" -ne 0 ]; then
    fail PACKAGE "release_dryrun.sh --no-build failed (exit $rc):"
    grep -E 'FATAL|RED|error' "$RUN/dryrun.log" | head -8 | sed 's/^/             /'
    return
  fi
  grep -q 'nothing published' "$RUN/dryrun.log" || fail PACKAGE "the dry run did not state that nothing was published"
  [ -d "$DIST/Forge.app" ] || fail PACKAGE "no bundle at $DIST/Forge.app"
}

# ═════════════════════════════════════════════════════════════════════════════
# 7 BUNDLE — no Node / Electron / Python, by name and by content
# ═════════════════════════════════════════════════════════════════════════════
audit_bundle() {   # audit_bundle <Forge.app>
  local app="$1" hits f
  [ -x "$app/Contents/MacOS/forge_desktop" ] || { fail BUNDLE "no Contents/MacOS/forge_desktop in $app"; return; }
  [ -x "$app/Contents/MacOS/forge_kernel_worker" ] || fail BUNDLE "no forge_kernel_worker in the bundle"
  [ -f "$app/Contents/Frameworks/libforge_kernel_core.dylib" ] || fail BUNDLE "no libforge_kernel_core.dylib in Contents/Frameworks"

  hits="$(find "$app" \( -iname '*.node' -o -iname 'node_modules' -o -iname '*.js' -o -iname '*.mjs' \
            -o -iname '*.cjs' -o -iname '*.ts' -o -iname 'package.json' -o -iname 'package-lock.json' \
            -o -iname '*.gyp' -o -iname '*.gypi' -o -iname '*.asar' -o -iname '*.py' -o -iname '*.pyc' \
            -o -iname '*.pyo' -o -iname 'Electron Framework*' -o -iname 'Python.framework' \
            -o -iname 'libpython*' -o -iname 'libnode*' -o -iname 'node' -o -iname 'python*' \) -print 2>/dev/null)"
  if [ -n "$hits" ]; then
    fail BUNDLE-NODE "the bundle contains Node/Electron/Python artifacts by name:"
    printf '%s\n' "$hits" | head -8 | sed "s|^$app/|             |"
  fi

  N_MACHO=0
  : > "$RUN/bundle.macho"
  while IFS= read -r f; do
    file -b "$f" 2>/dev/null | grep -q 'Mach-O' || continue
    N_MACHO=$((N_MACHO + 1))
    printf '%s\n' "$f" >> "$RUN/bundle.macho"
    local rel="${f#"$app"/}"
    if nm -gU "$f" 2>/dev/null | grep -qE ' _(napi_register_module_v[0-9]+|node_register_module_v[0-9]+|node_api_module_get_api_version_v[0-9]+)$'; then
      fail BUNDLE-NODE "$rel EXPORTS a Node module entry point — it is an N-API addon, whatever its name"
    fi
    local imp
    imp="$(nm -u "$f" 2>/dev/null | grep -E '^_(napi_|uv_)|^__ZN4node|^_Py[A-Z_]' | head -3 | tr '\n' ' ')"
    [ -z "$imp" ] || fail BUNDLE-NODE "$rel imports Node/Python runtime symbols: $imp"
    local deps bad
    deps="$(otool -L "$f" 2>/dev/null | tail -n +2 | awk '{print $1}')"
    bad="$(printf '%s\n' "$deps" | grep -iE 'libnode|electron|python|libuv' | head -3 | tr '\n' ' ')"
    [ -z "$bad" ] || fail BUNDLE-NODE "$rel loads a Node/Electron/Python library: $bad"
    bad="$(printf '%s\n' "$deps" | grep -vE '^(@rpath/|@executable_path/|@loader_path/|/usr/lib/|/System/)' | grep . | head -3 | tr '\n' ' ')"
    [ -z "$bad" ] || fail BUNDLE-LINK "$rel loads a library from OUTSIDE the bundle and the OS: $bad"
  done < <(find "$app" -type f 2>/dev/null)
  [ "$N_MACHO" -ge 4 ] || fail BUNDLE "only $N_MACHO Mach-O files in the bundle — the scan above would be vacuous"
  say "  bundle: $N_MACHO Mach-O files scanned (names, exports, imports, load commands)"
}

# ═════════════════════════════════════════════════════════════════════════════
# 8 WORKER + 9 LAUNCH — the RELOCATED bundle, under env -i
# ═════════════════════════════════════════════════════════════════════════════
hdr() { LC_ALL=C awk -v k="$1" '$1==k { $1=""; sub(/^ /, ""); print; exit }' "$2"; }
run_worker_and_launch() {   # <Forge.app> (already relocated)
  local app="$1" w="$1/Contents/MacOS/forge_kernel_worker"
  local fx="$RUN/fixture.ir"
  # A 40 x 30 x 20 block (BOX is centred in XY, base on z=0) with a 6 mm-radius
  # cylinder standing on the origin and 40 tall -- so it pierces the block's top
  # and bottom and the CUT is a clean through-hole.
  printf '%%1 = BOX(40, 30, 20)\n%%2 = CYL(6, 40)\n%%3 = CUT(%%1, %%2)\n' > "$fx"
  # Closed form, computed here and nowhere near the kernel:
  #   V = 40*30*20 - pi*6^2*20 = 24000 - 720*pi
  #   bbox = [-20,-15,0] .. [20,15,20]     faces = 6 planes + 1 cylinder = 7
  V_EXP="$(awk 'BEGIN{ printf "%.10f", 24000 - 720*atan2(0,-1) }')"
  local rc
  bounded 120 "$fx" "$RUN/worker.out" "$RUN/worker.err" env -i "$w"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    fail WORKER "the bundled worker under env -i exited $rc$([ "$rc" -eq 124 ] && echo ' (HUNG, killed after 120 s)'): $(head -c 400 "$RUN/worker.err" | tr '\n' ' ')"
  else
    check_worker_answer
  fi
  launch_checks "$app" "$w"
}

check_worker_answer() {
  local k v
  if ! LC_ALL=C head -1 "$RUN/worker.out" | grep -qx 'FORGE-WORKER-RESULT 1'; then
    fail WORKER "the worker's answer does not start with its protocol magic"
  fi
  for k in parsed compiled tessellated valid; do
    v="$(hdr "$k" "$RUN/worker.out")"
    [ "$v" = "1" ] || fail WORKER "worker reports $k=${v:-<missing>} (want 1)"
  done
  W_VOL="$(hdr volume "$RUN/worker.out")"
  W_FACES="$(hdr faceCount "$RUN/worker.out")"
  W_TRIS="$(hdr triangles "$RUN/worker.out")"
  local bmin bmax
  bmin="$(hdr bboxMin "$RUN/worker.out")"; bmax="$(hdr bboxMax "$RUN/worker.out")"
  # Tolerances: volume relative 1e-6 -- an exact B-rep volume of this body is a
  # closed form, and a NO-HOLE answer (24000) is 4% away, a half-depth hole 5%;
  # bbox 1e-6 mm absolute.
  awk -v got="${W_VOL:-nan}" -v want="$V_EXP" 'BEGIN{ g=got+0; d=g-want; if (d<0) d=-d; exit !(got!="" && got!="nan" && d <= 1e-6*want) }' \
    || fail WORKER "volume ${W_VOL:-<missing>} != closed form $V_EXP (rel tol 1e-6)"
  awk -v a="$bmin $bmax" 'BEGIN{ n=split(a, x, " "); split("-20 -15 0 20 15 20", e, " ");
        if (n != 6) exit 1; for (i=1;i<=6;i++){ d=x[i]-e[i]; if (d<0) d=-d; if (d>1e-6) exit 1 } exit 0 }' \
    || fail WORKER "bbox [$bmin]..[$bmax] != [-20 -15 0]..[20 15 20]"
  [ "${W_FACES:-}" = "7" ] || fail WORKER "faceCount ${W_FACES:-<missing>} != 7 (6 planes + 1 cylindrical bore)"
  [ "${W_TRIS:-0}" -gt 0 ] 2>/dev/null || fail WORKER "the worker tessellated ${W_TRIS:-0} triangles"
  say "  worker (env -i, relocated): valid, volume $W_VOL (closed form $V_EXP), $W_FACES faces, $W_TRIS triangles"
}

launch_checks() {   # <Forge.app> <worker>
  local app="$1" w="$2" rc
  bounded 60 - "$RUN/worker.version.out" "$RUN/worker.version.err" env -i "$w" --version
  rc=$?
  { [ "$rc" -eq 0 ] && grep -qx 'FORGE-WORKER-RESULT 1' "$RUN/worker.version.out"; } \
    || fail LAUNCH "bundled worker --version under env -i: exit $rc, '$(head -c 200 "$RUN/worker.version.out" "$RUN/worker.version.err" 2>/dev/null | tr '\n' ' ')'"

  bounded 60 - "$RUN/app.headless.out" "$RUN/app.headless.err" env -i "$app/Contents/MacOS/forge_desktop" --headless
  rc=$?
  if [ "$rc" -ne 0 ] || ! grep -q '^\[forge\] --headless' "$RUN/app.headless.out"; then
    fail LAUNCH "bundled forge_desktop --headless under env -i: exit $rc: $(head -c 300 "$RUN/app.headless.err" | tr '\n' ' ')"
  else
    say "  forge_desktop --headless (env -i, relocated): dyld resolved the closure, exit 0"
  fi
}

relocate() {   # relocate <Forge.app> -> prints the path of a copy in an unrelated dir
  local dst="$RUN/relocated"
  rm -rf "$dst"; mkdir -p "$dst"
  ditto "$1" "$dst/Forge.app" || return 1
  printf '%s\n' "$dst/Forge.app"
}

mutate_bundle() {   # mutate_bundle <Forge.app copy>
  local app="$1"
  case "$MUTATION" in
    bundle-node-file)
      # Node/Electron artifacts by NAME only: a node_modules tree (holding a plain
      # text file -- this gate writes no JavaScript), an Electron archive, and a
      # Mach-O named like the addon.
      mkdir -p "$app/Contents/Resources/app/node_modules/left-pad"
      printf 'MIT\n' > "$app/Contents/Resources/app/node_modules/left-pad/LICENSE"
      : > "$app/Contents/Resources/app.asar"
      cp "$app/Contents/MacOS/forge_update" "$app/Contents/Resources/forge-kernel.node" ;;
    bundle-napi-macho)
      # A REAL N-API addon shape -- exports napi_register_module_v1, imports
      # napi_create_object -- built with the system compiler and given an
      # innocent dylib name, so only a CONTENT check can see it.
      printf 'extern int napi_create_object(void*, void*);\nint napi_register_module_v1(void* e, void* x) { return napi_create_object(e, x); }\n' > "$RUN/addon.c"
      cc -dynamiclib -undefined dynamic_lookup -o "$app/Contents/Frameworks/libforge_helper.dylib" "$RUN/addon.c" \
        > "$RUN/addon.cc.log" 2>&1 || { echo "[ship-gate] cannot build the mutation addon" >&2; cat "$RUN/addon.cc.log" >&2; exit 2; } ;;
    worker-stub)
      cat > "$app/Contents/MacOS/forge_kernel_worker" <<'STUB'
#!/bin/sh
# speaks the protocol, models nothing
cat >/dev/null
printf 'FORGE-WORKER-RESULT 1\nparsed 1\ncompiled 1\ntessellated 1\nvalid 1\nfailedOpId -1\nfaceCount 0\nvolume 0\nbboxMin 0 0 0\nbboxMax 0 0 0\ntriangles 0\n'
STUB
      chmod +x "$app/Contents/MacOS/forge_kernel_worker" ;;
    missing-dylib)
      rm -f "$app/Contents/Frameworks/libforge_kernel_core.dylib" ;;
  esac
}

# ═════════════════════════════════════════════════════════════════════════════
# drive
# ═════════════════════════════════════════════════════════════════════════════
case "$MUTATION" in
  bundle-node-file|bundle-napi-macho|worker-stub|missing-dylib)
    # Bundle mutations act on a COPY of the bundle a green run produced.
    [ -d "$DIST/Forge.app" ] || { echo "[ship-gate] mutation $MUTATION needs a bundle from a green run at $DIST/Forge.app" >&2; exit 2; }
    COPY="$(relocate "$DIST/Forge.app")" || { echo "[ship-gate] cannot copy the bundle" >&2; exit 2; }
    mutate_bundle "$COPY"
    say "mutated bundle copy: $COPY"
    audit_bundle "$COPY"
    run_worker_and_launch "$COPY"
    finish ;;
  node-addon|node-addon-unpinned|python-unpinned)
    # Judged on the presets COPY; stage PRESET is RED, so nothing is configured.
    run_preset_stage
    finish ;;
  optable-drift)
    run_preflight
    finish ;;
  gates-missing)
    [ -f "$APP_BUILD/CTestTestfile.cmake" ] \
      || { echo "[ship-gate] mutation $MUTATION needs a built ship app at $APP_BUILD (run the gate green first)" >&2; exit 2; }
    run_preset_stage
    run_headless_gates
    finish ;;
  python-cache|python-by-name|werror-off)
    run_preset_stage
    [ -f "$KERNEL_BUILD/libforge_kernel_core.dylib" ] \
      || { echo "[ship-gate] mutation $MUTATION needs a built kernel core at $KERNEL_BUILD (run the gate green first)" >&2; exit 2; }
    configure_app
    audit_werror
    finish ;;
esac

if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
  say "NOTE: the working tree has uncommitted changes; this run gates the tree as it is, not a commit"
fi

run_preflight
run_preset_stage
configure_kernel
stage_end CONFIGURE-KERNEL
build_kernel
stage_end BUILD-KERNEL
configure_app
stage_end CONFIGURE-APP
audit_werror
stage_end WERROR
build_app
stage_end BUILD-APP
run_headless_gates
stage_end GATES
package_bundle
stage_end PACKAGE
audit_bundle "$DIST/Forge.app"
stage_end BUNDLE
COPY="$(relocate "$DIST/Forge.app")" || { fail WORKER "cannot relocate the bundle"; finish; }
run_worker_and_launch "$COPY"
stage_end WORKER-LAUNCH
finish
