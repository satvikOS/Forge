// ─────────────────────────────────────────────────────────────────────────────
// kernel_correctness_gate.cpp — four MEASURED assertions, each against a
// closed-form or independently computed REFERENCE, for four defects that all
// shared one shape: a wrong answer reported as a right one.
//
//   G1  ft::compileText() left ok == TRUE when the STEP export it was asked to
//       perform threw. A caller that asks for a file and is told "ok" has to be
//       able to conclude the file is there. REFERENCE: ok == false, and the
//       measured geometry is still reported (the solid WAS built) — the two
//       facts are separate and both are told.
//
//   G2  part::shellMultiThickness() silently DROPPED every per-face override
//       spelled with a negative thickness (`ovr.thickness <= Confusion()`),
//       while the SIGN CONTRACT introduced alongside it (Features.hpp, and the
//       std::abs() two lines below in the very same loop) says the sign of a
//       wall thickness is IGNORED. REFERENCE: the closed form the smoke already
//       asserts for the positive spelling, V = 1000 - 7.5*7*7 = 632.5; the
//       dropped override silently returns the uniform shell, 1000 - 8*8*9 = 424.
//
//   G3  the IR's VERIFY "holes=" counter de-duplicated bores by
//       {axisLocation.x, axisLocation.y, radius} — no axis DIRECTION and no
//       axisLocation.z — although its own comment says "one hole == one axis".
//       Two bores on DIFFERENT axes that happen to share those three numbers
//       counted as one. REFERENCE: a cross-drilled part with a vertical through
//       bore and a horizontal side port has TWO holes, and forge_verify's
//       independent axis-line bore measurement (src/tools/forge_verify.cpp,
//       which keys on the canonical direction AND the axis foot point) is the
//       second opinion this must agree with.
//
//   G4  the weld-betti genus had a SECOND hand-copy inside forge_verify, so the
//       "one definition" TopologySignature.cpp claims in its own header comment
//       did not hold. REFERENCE: the two must return identical numbers on the
//       same body — asserted here through the shared mesh overload.
//
// Build/run: forge-kernel/test/build_kernel_correctness_gate.sh
// Exit 0 iff every assertion holds.
// ─────────────────────────────────────────────────────────────────────────────

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "forge/DirectEdit.hpp"
#include "forge/Features.hpp"
#include "forge/IoExchange.hpp"
#include "forge/MassProps.hpp"
#include "forge/Primitives.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/Tessellate.hpp"
#include "forge/Topology.hpp"
#include "forge/ft/FeatureTree.hpp"

namespace {

int g_pass = 0;
int g_fail = 0;

void ok(const std::string& what) {
    ++g_pass;
    std::printf("  PASS  %s\n", what.c_str());
}
void bad(const std::string& what, const std::string& detail = "") {
    ++g_fail;
    std::printf("  FAIL  %s\n", what.c_str());
    if (!detail.empty()) std::printf("        %s\n", detail.c_str());
}
void expectEq(double got, double want, double tol, const std::string& what) {
    if (std::fabs(got - want) <= tol) {
        char b[256];
        std::snprintf(b, sizeof b, "%s = %.6f (reference %.6f)", what.c_str(), got, want);
        ok(b);
    } else {
        char b[256];
        std::snprintf(b, sizeof b, "%s = %.6f, reference %.6f (tol %.3g)",
                      what.c_str(), got, want, tol);
        bad(b);
    }
}
void expectTrue(bool cond, const std::string& what, const std::string& detail = "") {
    if (cond) ok(what); else bad(what, detail);
}

double volumeOf(forge::ShapeHandle h) { return forge::massProperties(h).volume; }

// ───────────────────────────────────────────────────────────── G1
// A requested export that fails must fail the compile.
void g1_export_failure_fails_the_compile() {
    // Deliberately unwritable: the parent directory does not exist, so
    // forge::io::exportStep -> spillFile throws "cannot write ...".
    const std::string bad_path = "/nonexistent-forge-gate-dir/out.step";
    const std::string ir =
        "%1 = BOX(20, 20, 10)\n"
        "RESULT(%1)\n";

    forge::ft::CompileResult r = forge::ft::compileText(ir, bad_path, "");
    expectTrue(!r.ok,
               "G1 compile with an impossible STEP path reports ok == false",
               "ok=" + std::string(r.ok ? "true" : "false") +
                   " exported=" + (r.exported ? "true" : "false") +
                   " error='" + r.error + "'");
    expectTrue(!r.exported, "G1 exported == false when nothing was written");
    expectTrue(!r.error.empty(), "G1 the failure is named in .error");
    // The solid WAS built: the handle and the measurement survive, so a caller
    // can still tell "wrote no file" from "built no part".
    expectTrue(r.handle != 0, "G1 the built solid is still reported (handle != 0)");
    if (r.handle != 0) expectEq(volumeOf(r.handle), 4000.0, 1e-9, "G1 body volume");

    // Control: the same tree with a writable path must still succeed.
    const char* tmpdir = std::getenv("TMPDIR");
    const std::string good_path =
        std::string(tmpdir && *tmpdir ? tmpdir : "/tmp") + "/forge_gate_g1.step";
    forge::ft::CompileResult r2 = forge::ft::compileText(ir, good_path, "");
    expectTrue(r2.ok && r2.exported,
               "G1 control: a writable path still compiles ok and exports",
               "ok=" + std::string(r2.ok ? "true" : "false") +
                   " exported=" + (r2.exported ? "true" : "false") +
                   " error='" + r2.error + "'");
    std::remove(good_path.c_str());
}

// ───────────────────────────────────────────────────────────── G2
// The sign of a per-face wall override is IGNORED, like every other thickness.
void g2_multithickness_sign_contract() {
    const double REF_OVERRIDDEN = 1000.0 - 7.5 * 7.0 * 7.0;   // 632.5
    const double REF_UNIFORM    = 1000.0 - 8.0 * 8.0 * 9.0;   // 424.0

    // Baseline: the uniform 1.0 shell, the value a DROPPED override collapses to.
    const double uniform =
        volumeOf(forge::part::shell(forge::makeBox(10, 10, 10), {0}, 1.0, {}));
    expectEq(uniform, REF_UNIFORM, 1e-9, "G2 uniform shell volume");

    for (std::uint32_t removeId = 0; removeId < 6; ++removeId) {
        const std::uint32_t overrideId = (removeId + 1) % 6;
        forge::part::FaceThickness pos{}, neg{};
        pos.faceId = overrideId; pos.thickness =  1.5;
        neg.faceId = overrideId; neg.thickness = -1.5;

        const double vp = volumeOf(forge::part::shellMultiThickness(
            forge::makeBox(10, 10, 10), {removeId}, 1.0, {pos}));
        const double vn = volumeOf(forge::part::shellMultiThickness(
            forge::makeBox(10, 10, 10), {removeId}, 1.0, {neg}));

        char b[160];
        std::snprintf(b, sizeof b, "G2 rm=%u override +1.5", removeId);
        expectEq(vp, REF_OVERRIDDEN, 1e-9, b);
        std::snprintf(b, sizeof b, "G2 rm=%u override -1.5 (sign ignored)", removeId);
        expectEq(vn, REF_OVERRIDDEN, 1e-9, b);
        if (std::fabs(vn - REF_UNIFORM) < 1e-9) {
            bad("G2 the negative override was DROPPED — the result is the uniform shell");
        }
    }
}

// ───────────────────────────────────────────────────────────── G3
// One hole == one AXIS. Two bores that differ only in axis direction are two.
//
// The part: a 60x60x20 plate with a O10 vertical through bore on the Z axis
// through (0,0), plus a O10 horizontal side port drilled in along +X from that
// same bore out through the +X face. The port's cylinder is placed with its
// base ON the vertical bore's axis, so both cylindrical walls report
// axisLocation.x = axisLocation.y = 0 and the same radius: the pre-fix key
// {x, y, radius} is IDENTICAL for the two, and they collapsed to one hole.
const char* kCrossDrilledIR =
    "# 60x60x20 plate, vertical O10 through bore + O10 side port on +X\n"
    "%1 = BOX(60, 60, 20)\n"
    "%2 = CYL(5, 40, 0, 0, -10)\n"          // Z-axis cutter, through
    "%3 = CUT(%1, %2)\n"
    "%4 = CYL(5, 40, 0, 0, 10, 1, 0, 0)\n"  // X-axis cutter, base ON the Z axis
    "%5 = CUT(%3, %4)\n"
    "RESULT(%5)\n";

void g3_bore_count_is_per_axis() {
    // First: what the kernel's own inventory says, printed so a failure is
    // diagnosable rather than merely red.
    forge::ft::CompileResult built = forge::ft::compileText(kCrossDrilledIR, "", "");
    if (!built.ok || built.handle == 0) {
        bad("G3 the cross-drilled part did not build", built.error);
        return;
    }
    forge::ShapeHandle probe = built.handle;
    try { probe = forge::unifyFaces(built.handle); } catch (...) { probe = built.handle; }
    const auto inv = forge::faceInventory(probe);
    int nConcaveCyl = 0;
    for (const auto& f : inv) {
        if (f.kind != "cylinder" || !f.concave) continue;
        ++nConcaveCyl;
        std::printf("        [inv] cyl r=%.3f loc=(%.3f,%.3f,%.3f) dir=(%.3f,%.3f,%.3f)\n",
                    f.radius, f.axisLocation[0], f.axisLocation[1], f.axisLocation[2],
                    f.direction[0], f.direction[1], f.direction[2]);
    }
    expectTrue(nConcaveCyl >= 2,
               "G3 the part really does carry two concave cylindrical walls",
               "concave cylinder faces = " + std::to_string(nConcaveCyl));

    // The assertion under test: VERIFY("holes=2") is the IR's own gate, and a
    // failed assertion is a compile failure, so ok==true IS the pass.
    std::string ir2 = std::string(kCrossDrilledIR);
    ir2.replace(ir2.find("RESULT(%5)"), std::string("RESULT(%5)").size(),
                "%6 = VERIFY(%5, \"holes=2\")\nRESULT(%6)");
    forge::ft::CompileResult r = forge::ft::compileText(ir2, "", "");
    std::string detail = r.error;
    for (const auto& v : r.verify) detail += " | " + v;
    expectTrue(r.ok, "G3 VERIFY(\"holes=2\") passes on a cross-drilled part", detail);

    // Negative control: the same part must NOT satisfy holes=1, or the counter
    // is simply saturating rather than counting.
    std::string ir1 = std::string(kCrossDrilledIR);
    ir1.replace(ir1.find("RESULT(%5)"), std::string("RESULT(%5)").size(),
                "%6 = VERIFY(%5, \"holes=1\")\nRESULT(%6)");
    forge::ft::CompileResult rn = forge::ft::compileText(ir1, "", "");
    expectTrue(!rn.ok, "G3 negative control: VERIFY(\"holes=1\") is rejected");

    // And a plain single-bore plate must still count exactly one.
    const std::string ir3 =
        "%1 = BOX(60, 60, 20)\n"
        "%2 = HOLE(%1, 10, 0, 0, 0)\n"
        "%3 = VERIFY(%2, \"holes=1\")\n"
        "RESULT(%3)\n";
    forge::ft::CompileResult r3 = forge::ft::compileText(ir3, "", "");
    expectTrue(r3.ok, "G3 one drilled hole still counts as exactly one", r3.error);
}

// ───────────────────────────────────────────────────────────── G4
// One definition of the weld-betti signature, not two.
void g4_single_topology_definition() {
    // A genus-2 body: a plate with two through bores.
    const std::string ir =
        "%1 = BOX(60, 60, 20)\n"
        "%2 = HOLE(%1, 10, -15, 0, 0)\n"
        "%3 = HOLE(%2, 10,  15, 0, 0)\n"
        "RESULT(%3)\n";
    forge::ft::CompileResult r = forge::ft::compileText(ir, "", "");
    if (!r.ok || r.handle == 0) { bad("G4 body did not build", r.error); return; }

    forge::TopoSignature byHandle;
    expectTrue(forge::topologySignature(r.handle, byHandle, 0.3, 0.6),
               "G4 topologySignature(handle) measured the body");
    expectEq(static_cast<double>(byHandle.genus), 2.0, 0.0,
             "G4 genus of a two-bore plate");
    expectEq(static_cast<double>(byHandle.shellCount), 1.0, 0.0, "G4 shellCount");

    // The mesh overload is what forge_verify now calls, on the mesh it already
    // tessellated. Same numbers, or the "one definition" claim is false.
    forge::Mesh m = forge::tessellate(r.handle, 0.3, 0.6);
    forge::TopoSignature byMesh;
    expectTrue(forge::topologySignature(m, byMesh),
               "G4 topologySignature(mesh) measured the same mesh");
    expectTrue(byMesh.genus == byHandle.genus && byMesh.shellCount == byHandle.shellCount &&
                   byMesh.eulerChar == byHandle.eulerChar &&
                   byMesh.vertexCount == byHandle.vertexCount,
               "G4 the mesh and handle overloads agree exactly",
               "mesh g=" + std::to_string(byMesh.genus) +
                   " chi=" + std::to_string(byMesh.eulerChar) +
                   " V=" + std::to_string(byMesh.vertexCount) +
                   " vs handle g=" + std::to_string(byHandle.genus) +
                   " chi=" + std::to_string(byHandle.eulerChar) +
                   " V=" + std::to_string(byHandle.vertexCount));
}

}  // namespace

int main() {
    std::printf("== kernel correctness gate ==\n\n");
    g1_export_failure_fails_the_compile();
    g2_multithickness_sign_contract();
    g3_bore_count_is_per_axis();
    g4_single_topology_definition();
    std::printf("\n  %d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
