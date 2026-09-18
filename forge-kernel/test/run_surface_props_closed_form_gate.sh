#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_surface_props_closed_form_gate.sh — T-147 Task 1.
#
# Builds and runs test/surface_props_closed_form_gate.cpp, which verifies
# forge/SurfaceProps (the native differential-property facade) against TEXTBOOK
# CLOSED FORMS — sphere, cylinder, cone, plane, torus, elliptical cylinder,
# circle, ellipse, rational arc — and NEVER against OCCT. Nothing here links,
# includes, or names OCCT: the whole point of the facade is to be the one place
# the GeomLProp_/BRepLProp_ cluster gets deleted from, so its gate cannot depend
# on the thing being deleted.
#
# ── THEN IT PROVES THE GATE CAN FAIL ────────────────────────────────────────
# A curvature gate that has only ever been seen green is not evidence. FOURTEEN
# mutants of the CODE UNDER TEST (never of the test) must each turn it RED, and
# each must do so ON ITS OWN ASSERTION — a mutant that goes red somewhere else
# has proved something, just not the thing it was written for.
#
# M1..M6 are T-147's, on the shared fundamental-form algebra and the analytic
# second derivatives. M7..M14 are T-151's: ONE PER RESTORED GEOMETRY KIND, so no
# kind can be called "carried" on the strength of an assertion nobody has seen
# fail. The five restored kinds are parabola, hyperbola, surface of revolution
# (two meridian families), and offset surface.
#
#   M1  the sign of M^2 in the Gaussian numerator  (L*N - M*M -> L*N + M*M)
#   M2  the sign of the -2FM cross term in the mean numerator
#   M3  the smaller principal root becomes the larger (H - sq -> H + sq)
#   M4  one sign in an ANALYTIC second derivative (the sphere's S_vv axial term)
#   M5  the scale-relative degeneracy guard removed
#   M6  the mean curvature perturbed by a RELATIVE 1e-8 — the two-sided proof
#       that the gate's own 1e-9 tolerance is load-bearing rather than decorative
#   M7  the parabola's CONSTANT second derivative              (T-151)
#   M8  the hyperbola's second derivative, cosh <-> sinh       (T-151)
#   M9  the revolution's S_vv loses its sin(u) term            (T-151)
#   M10 the revolution's k x m' reversed                       (T-151)
#   M11 the offset's SINGULARITY test disabled                 (T-151)
#   M12 one sign in the offset's second-order quotient rule    (T-151)
#   M13 an analytic THIRD derivative, which only the offset reads (T-151)
#   M14 the revolution's MIXED partial S_uv — invisible to K and H (T-151)
#
# ★ M1 AND M2 ARE THE REASON THE SHEAR FIXTURE EXISTS. Every analytic quadric in
#   the gate is parameterised ORTHOGONALLY, so F = S_u.S_v = 0 and M = S_uv.n = 0
#   on all of them, and BOTH of those mutants are invisible to every one. Only
#   the shear-reparameterisation fixture (F = lambda G, M = lambda N, both
#   non-zero, and K/H algebraically invariant) can see them. M1 and M2 are
#   therefore also the proof that that fixture is load-bearing and not scenery.
#
# ★ NOBUILD IS NEVER A KILL. A mutant that fails to compile proves nothing about
#   what the assertions can see, and is reported as a FAILURE OF THIS SCRIPT.
#
# ★ THE PATCH IS PROVEN TO HAVE LANDED before the rebuild (cmp on the source) and
#   every build writes a FRESH binary to a fresh path, so a stale executable
#   cannot be mistaken for a surviving mutant. That exact trap is on the record
#   in this repository: a mutation round that never forced a rebuild ran the
#   UNMUTATED binary and called itself blind.
#
# The tree is NEVER written to: each mutant is a copy in a temp dir, so an
# interrupted run cannot leave a mutated source behind.
#
# usage: bash forge-kernel/test/run_surface_props_closed_form_gate.sh [--no-mutations]
# exit 0 iff the stock gate is green AND every mutant is red on its own assertion.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

K="forge-kernel"
CXX="${CXX:-clang++}"
INC="$K/include"
GATE="$K/test/surface_props_closed_form_gate.cpp"
PROPS="$K/src/SurfaceProps.cpp"
ALGEBRA="$K/src/native/brep/NurbsAlgebra.cpp"
DO_MUT=1
[ "${1:-}" = "--no-mutations" ] && DO_MUT=0

# The SHARED object set is spelled out, not globbed, so a new dependency that
# this list does not name fails the LINK and goes red rather than silently
# shrinking the gate.
SHARED="$GATE
        $K/src/native/brep/NurbsCalculus.cpp
        $K/src/native/brep/Nurbs.cpp
        $K/src/native/brep/NurbsSurface.cpp
        $K/src/native/brep/Surface.cpp
        $K/src/native/brep/Curve.cpp
        $K/src/native/mesh/HalfEdgeMesh.cpp"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge_surfprops.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/obj"

echo "[surfprops] compiling the shared object set (pure C++20, zero OCCT)"
for s in $SHARED; do
  n="$(basename "$s" .cpp)"
  if ! "$CXX" -std=c++20 -O1 -Wall -I "$INC" -c "$s" -o "$WORK/obj/$n.o" \
       2> "$WORK/obj/$n.err"; then
    echo "[surfprops] the gate's own object set does not COMPILE ($n):" >&2
    tail -25 "$WORK/obj/$n.err" >&2
    exit 2
  fi
done

# build PROPS_SRC ALGEBRA_SRC OUT -> 0 built, 2 did not build
build() {
  local props="$1" algebra="$2" out="$3"
  "$CXX" -std=c++20 -O1 -Wall -I "$INC" -c "$props" -o "$out.props.o" \
      2> "$out.cc.err" \
    && "$CXX" -std=c++20 -O1 -Wall -I "$INC" -c "$algebra" -o "$out.alg.o" \
      2>> "$out.cc.err" \
    && "$CXX" -std=c++20 -O1 "$out.props.o" "$out.alg.o" "$WORK"/obj/*.o -o "$out" \
      2>> "$out.cc.err" \
    || return 2
  return 0
}

# ── STOCK ───────────────────────────────────────────────────────────────────
if ! build "$PROPS" "$ALGEBRA" "$WORK/stock"; then
  echo "[surfprops] STOCK DOES NOT BUILD — nothing below proves anything" >&2
  tail -30 "$WORK/stock.cc.err" >&2
  exit 2
fi
"$WORK/stock" > "$WORK/stock.log" 2>&1; rc=$?
cat "$WORK/stock.log"
if [ "$rc" -ne 0 ]; then
  echo "[surfprops] STOCK GATE IS RED — fix that before reading any mutant"
  exit 1
fi
STOCK_SCORE="$(grep '^=== RESULT' "$WORK/stock.log" | tail -1)"
echo "[surfprops] STOCK: $STOCK_SCORE"
[ "$DO_MUT" = "0" ] && { echo "[surfprops] --no-mutations: the kill proof was SKIPPED"; exit 0; }

# mutate SRC DST OLD NEW — exact and UNIQUE, else abort. A stale anchor is LOUD
# rather than a silently skipped mutant.
mutate() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import io, sys
src, dst, old, new = sys.argv[1:5]
s = io.open(src, encoding="utf-8").read()
if s.count(old) != 1:
    sys.stderr.write("MUTATION ANCHOR NOT UNIQUE (%d occurrences): %r\n"
                     % (s.count(old), old[:100]))
    sys.exit(2)
io.open(dst, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

bad=0
# kill NAME PROPS_SRC ALGEBRA_SRC MUST_MATCH
kill_check() {
  local name="$1" props="$2" algebra="$3" must="$4" out="$WORK/$1" rc
  # PROVE the patch landed. An anchor that no longer matches would otherwise
  # leave an identical file, rebuild it, and report the mutant "caught".
  if cmp -s "$props" "$PROPS" && cmp -s "$algebra" "$ALGEBRA"; then
    echo "  $name THE MUTANT IS IDENTICAL TO THE TREE — the anchor did not land"
    bad=1; return
  fi
  if ! build "$props" "$algebra" "$out"; then
    echo "  $name NOBUILD — proves nothing about what the assertions see; rewrite it"
    tail -6 "$out.cc.err" | sed 's/^/       /'
    bad=1; return
  fi
  "$out" > "$out.log" 2>&1; rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "  $name PASSED THE GATE — THE GATE CANNOT FAIL ON THIS DEFECT"
    bad=1; return
  fi
  if ! grep -q "\[FAIL\].*$must" "$out.log"; then
    echo "  $name went RED but NOT on \"$must\" — the kill is an accident elsewhere,"
    echo "       which is not the proof this mutant is for. First failures:"
    grep -m4 '\[FAIL\]' "$out.log" | sed 's/^/         /'
    bad=1; return
  fi
  echo "  $name RED on \"$must\" ($(grep -c '\[FAIL\]' "$out.log" | tr -d ' ') failures)"
  echo "       $(grep -m1 "\[FAIL\].*$must" "$out.log" | cut -c1-150)"
}

echo
echo "[surfprops] ── SIX MUTANTS, EACH MUST BE RED ON ITS OWN ASSERTION ──"

# M1 — the sign of M^2 in the Gaussian numerator. Invisible to every orthogonal
#      quadric (M = 0 on all of them); only the shear fixture can see it.
mutate "$ALGEBRA" "$WORK/m1.cpp" \
  'out.gaussian = (L * N - M * M) / det1;' \
  'out.gaussian = (L * N + M * M) / det1;' || exit 2
echo "[surfprops] M1: Gaussian numerator L*N - M*M  ->  L*N + M*M"
kill_check M1 "$PROPS" "$WORK/m1.cpp" "shear sphere K is reparameterisation-INVARIANT"

# M2 — the sign of the -2FM cross term in the mean numerator. Same blindness.
mutate "$ALGEBRA" "$WORK/m2.cpp" \
  'out.mean = (E * N - 2.0 * F * M + G * L) / (2.0 * det1);' \
  'out.mean = (E * N + 2.0 * F * M + G * L) / (2.0 * det1);' || exit 2
echo "[surfprops] M2: mean numerator  - 2FM  ->  + 2FM"
kill_check M2 "$PROPS" "$WORK/m2.cpp" "shear sphere H is reparameterisation-INVARIANT"

# M3 — both principal roots become the larger one.
mutate "$ALGEBRA" "$WORK/m3.cpp" \
  'out.k1 = out.mean - sq;                      // smaller root' \
  'out.k1 = out.mean + sq;                      // smaller root' || exit 2
echo "[surfprops] M3: the smaller principal root becomes the larger"
kill_check M3 "$PROPS" "$WORK/m3.cpp" "cyl(out) kMin == -1/R"

# M4 — one sign in an ANALYTIC second derivative this file ADDED (the sphere's
#      S_vv axial term). Proves the new derivative code is what the sphere
#      closed forms are measuring, not the shared algebra alone.
mutate "$PROPS" "$WORK/m4.cpp" \
  'dvv = R * (-r * sp * ct) + B * (-r * sp * st) + A * (-r * cp);' \
  'dvv = R * (-r * sp * ct) + B * (-r * sp * st) + A * (r * cp);' || exit 2
echo "[surfprops] M4: the sphere's analytic S_vv axial term flips sign"
kill_check M4 "$WORK/m4.cpp" "$ALGEBRA" "sph K == 1/R\^2"

# M5 — the scale-relative degeneracy guard removed. The EXACT pole survives this
#      (S_u is bit-zero there and the absolute guard still fires), which is
#      exactly why the gate carries a NEAR pole at phi = 1e-14.
mutate "$PROPS" "$WORK/m5.cpp" \
  'if (!(crLen > 0.0) || crLen <= kRelTol * sMax * sMax) {' \
  'if (!(crLen > 0.0)) {' || exit 2
echo "[surfprops] M5: the scale-relative degeneracy guard removed"
kill_check M5 "$WORK/m5.cpp" "$ALGEBRA" "near-pole(phi=1e-14) refused by the RELATIVE guard"

# M6 — a RELATIVE 1e-8 error in H. The gate demands 1e-9, so this must be caught:
#      it is the two-sided proof that the stated tolerance is the real threshold
#      and not a number chosen loose enough to never bite.
mutate "$ALGEBRA" "$WORK/m6.cpp" \
  'out.mean = (E * N - 2.0 * F * M + G * L) / (2.0 * det1);' \
  'out.mean = (E * N - 2.0 * F * M + G * L) / (2.0 * det1) * (1.0 + 1.0e-8);' || exit 2
echo "[surfprops] M6: H perturbed by a RELATIVE 1e-8 (the gate asserts 1e-9)"
kill_check M6 "$PROPS" "$WORK/m6.cpp" "cyl(out) H == -1/(2R)"

# ═══════════════ T-151: ONE MUTANT PER RESTORED KIND ═══════════════════════
# T-147's delta was part-paid in CAPABILITY: a 19-kind probe carried 19 before
# the migration and 14 after. T-151 restored the five, and a restored kind whose
# assertion has never been seen RED is not restored, it is merely quiet. So each
# of the five gets a mutant that must kill it ON ITS OWN ASSERTION.
echo
echo "[surfprops] ── SEVEN MORE MUTANTS: ONE PER RESTORED KIND (T-151) ──"

# M7 — the PARABOLA's constant second derivative. It is the only conic whose C''
#      does not depend on t, so a wrong constant is invisible in the SHAPE of the
#      curvature curve and shows only in its value — which is why the apex, where
#      kappa IS that constant, is asserted separately.
mutate "$PROPS" "$WORK/m7.cpp" \
  'out.d2 = R * (1.0 / (2.0 * f));' \
  'out.d2 = R * (1.0 / (4.0 * f));' || exit 2
echo "[surfprops] M7: parabola C'' = R/(2f) -> R/(4f)"
kill_check M7 "$WORK/m7.cpp" "$ALGEBRA" "parabola APEX kappa == 1/(2f)"

# M8 — the HYPERBOLA's second derivative with cosh and sinh exchanged. At the
#      WAIST that makes C'' parallel to C', so kappa collapses to 0 — the one
#      station where the error is total rather than partial.
mutate "$PROPS" "$WORK/m8.cpp" \
  'out.d2 = R * (a * ch) + B * (b * sh);' \
  'out.d2 = R * (a * sh) + B * (b * ch);' || exit 2
echo "[surfprops] M8: hyperbola C'' has cosh and sinh exchanged"
kill_check M8 "$WORK/m8.cpp" "$ALGEBRA" "hyperbola WAIST kappa == a/b\^2"

# M9 — the REVOLUTION's S_vv loses its sin(u) term. Invisible at u = 0 and at
#      u = pi, which is exactly why no fixture samples the revolution only there.
mutate "$PROPS" "$WORK/m9.cpp" \
  'const Vec3 dvv = k * h2 + q2 * c + p2 * s;' \
  'const Vec3 dvv = k * h2 + q2 * c;' || exit 2
echo "[surfprops] M9: revolution S_vv drops its sin(u)*p'' term"
kill_check M9 "$WORK/m9.cpp" "$ALGEBRA" "rev(bspline) H == profile form"

# M10 — the REVOLUTION's tangential meridian direction k x m' is reversed. This
#       is the sign that Rodrigues' formula fixes and that a hand-rolled sweep
#       gets wrong first; it changes S_v and S_uv but NOT the point, so only a
#       curvature assertion can see it.
#       ★ It must be read on H, not on K: reversing that one term is a REFLECTION
#         of the swept surface, and K is reflection-invariant while H changes
#         sign. Naming K here produced a mutant that went red "somewhere else" —
#         which this script reports as a failure, correctly.
mutate "$PROPS" "$WORK/m10.cpp" \
  'const Vec3 p1 = k.cross(mp.d1);' \
  'const Vec3 p1 = mp.d1.cross(k);' || exit 2
echo "[surfprops] M10: revolution p' = k x m'  ->  m' x k"
kill_check M10 "$WORK/m10.cpp" "$ALGEBRA" "rev(circle) H == torus H"

# M11 — the OFFSET's SINGULARITY TEST REMOVED. This is not a hypothetical: the
#       first version of that test used the two principal factors separately and
#       MISSED d == R on a sphere, because the umbilic cancellation split the
#       principals by ~1e-8. The gate caught it. This mutant is that defect,
#       preserved, so the fix can never be quietly undone.
mutate "$PROPS" "$WORK/m11.cpp" \
  'if (std::fabs(den) <= kOffsetSingularTol * denScale)' \
  'if (false && std::fabs(den) <= kOffsetSingularTol * denScale)' || exit 2
echo "[surfprops] M11: the offset SINGULARITY test is disabled"
kill_check M11 "$WORK/m11.cpp" "$ALGEBRA" "offset(sphere, d == R) is DECLINED"

# M12 — one sign in the OFFSET's second-order quotient rule (the n_uu term that
#       carries |C|'s own second derivative).
#       ★ ONLY THE FREE-FORM BASE CAN SEE THIS, and that is why the NURBS fixture
#         is in the gate. On every analytic quadric here — plane, cylinder, cone,
#         sphere, torus, elliptic cylinder — |S_u x S_v| does not depend on u at
#         all, so L_u and L_uu are identically ZERO and this whole term vanishes.
#         A gate built only from the quadrics would call the quotient rule proven
#         while one of its terms was never once non-zero. (Naming the torus here
#         first produced exactly the "red somewhere else" report.)
mutate "$PROPS" "$WORK/m12.cpp" \
  '- C * (Luu / (L * L))' \
  '+ C * (Luu / (L * L))' || exit 2
echo "[surfprops] M12: offset n_uu term  - C*Luu/L^2  ->  + C*Luu/L^2"
kill_check M12 "$WORK/m12.cpp" "$ALGEBRA" "offset(nurbs 4x4 bicubic) H_off"

# M13 — an ANALYTIC THIRD derivative (the cone's d/dv S_uu), which exists ONLY to
#       serve the offset. If no assertion depends on it the whole order-3 table is
#       decoration, so this mutant is what proves it load-bearing.
#       ★ IT MUST BE READ ON THE SECOND PARTIALS, NOT ON A CURVATURE, AND THAT IS
#         A THEOREM. n.n == 1 differentiates twice to n.n_uu == -|n_u|^2, so the
#         offset's L = L_base - d|n_u|^2 sees the base only to SECOND order: no
#         third derivative can move K or H. This mutant SURVIVED the first version
#         of the gate for exactly that reason, and the fix was not to loosen
#         anything but to assert the offset's REPORTED d2uu/d2uv/d2vv — part of
#         SurfProps' contract — against the shifted-cone closed form, where a
#         wrong third derivative shows as a purely TANGENTIAL error.
mutate "$PROPS" "$WORK/m13.cpp" \
  'duuv = R * (-dr * c) + B * (-dr * si);' \
  'duuv = R * (dr * c) + B * (dr * si);' || exit 2
echo "[surfprops] M13: the cone's analytic S_uuv flips sign"
kill_check M13 "$WORK/m13.cpp" "$ALGEBRA" "offset(cone) S_uu == -(r + d cos a)"

# M14 — the REVOLUTION's MIXED partial S_uv, perturbed by a RELATIVE 1e-6.
#       ★ THIS MUTANT EXISTS BECAUSE IT ONCE SURVIVED. A surface of revolution is
#         parameterised ORTHOGONALLY, so F = S_u.S_v == 0 and M = S_uv.n == 0 (the
#         n-components of S_uv's two terms cancel exactly). H's only S_uv term is
#         -2FM with F == 0, and K's is -M^2 — QUADRATIC. So a 1e-6 error in S_uv
#         moved nothing a curvature assertion could see and the whole gate stayed
#         green. That is the shear fixture's blind spot in a new place, and the
#         fix was not a tolerance: the revolution's REPORTED d2uu/d2uv/d2vv are
#         now asserted against the closed form -rho e_r / rho' e_theta /
#         z'' k + rho'' e_r directly. 1e-6 is deliberately far LOOSER than the
#         gate's 1e-9, to show the assertion bites well before the tolerance does.
mutate "$PROPS" "$WORK/m14.cpp" \
  'const Vec3 duv = q1 * (-s) + p1 * c;' \
  'const Vec3 duv = q1 * (-s) + p1 * (c * 1.000001);' || exit 2
echo "[surfprops] M14: revolution S_uv p'-term scaled by 1 + 1e-6"
kill_check M14 "$WORK/m14.cpp" "$ALGEBRA" "rev(circle) S_uv == rho' \* e_theta"

echo
if [ "$bad" = "0" ]; then
  echo "PASS: $STOCK_SCORE against textbook closed forms, and all FOURTEEN mutants"
  echo "      are killed, each on the assertion it was written for."
else
  echo "FAIL: a control is inert — see above."
fi
exit "$bad"
