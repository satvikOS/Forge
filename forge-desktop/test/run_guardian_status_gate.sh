#!/bin/bash
# forge-desktop/test/run_guardian_status_gate.sh
#
# The app's view of Forge Guardian (forge-desktop/src/GuardianStatus.cpp) built
# headless: the pure reader, the strict retrieval/ JSON parser it uses, and the gate.
# No window, no GPU, no kernel -- seconds. Fails non-zero on any compile error or
# any failed check; there is no skip path.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
CXX="${CXX:-clang++}"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/guardian_status_gate.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT
"$CXX" -std=c++20 -O1 -g -Wall -Wextra -Werror ${GATE_SANITIZE:+-fsanitize=address,undefined} \
  -I forge-desktop/src -I retrieval/include \
  forge-desktop/src/GuardianStatus.cpp retrieval/src/Json.cpp forge-desktop/test/guardian_status_test.cpp \
  -o "$OUT/guardian_status_test"
"$OUT/guardian_status_test"
