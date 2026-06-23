// forge/native/brep/step_analytic_test.cpp
//
// Native (OCCT-free) gate for IN-HOUSE KERNEL STEP 3c — the ANALYTIC STEP codec
// forge::native::brep::StepAnalytic (write + read), the analytic sibling of
// StepFaceted. Auto-discovered by run_native.sh (the `brep` class). OCCT is NOT
// linkable here, so the reference is the CLOSED-FORM analytic mass properties of
// the source Solid — recovered to ~1e-9 because the round trip keeps the
// geometry ANALYTIC (a cylinder stays a cylinder; NOT a tessellation tolerance).
//
// VALIDATION GATE (asserted below):
//   * write(solid) emits a structurally valid ISO-10303-21 / AP242 document with
//     the ANALYTIC surface keyword for each curved primitive (CYLINDRICAL_SURFACE
//     / CONICAL_SURFACE / SPHERICAL_SURFACE / TOROIDAL_SURFACE) — proving it is
//     analytic, not faceted — wrapped in MANIFOLD_SOLID_BREP / CLOSED_SHELL /
//     ADVANCED_FACE and an ADVANCED_BREP_SHAPE_REPRESENTATION.
//   * ROUND-TRIP: read(write(solid)) reconstructs a Solid with the SAME face
//     count, watertight (closed 2-manifold tessellation), and volume / COM /
//     inertia preserved to 1e-6 — for box, cylinder, cone, sphere, tube, and a
//     bored plate (box − cylinder Cut, an analytic-face boolean result).
//   * The emitted file re-PARSES through the shared Part-21 parser with ZERO
//     dangling references (instance-graph integrity).
//   * malformed STEP -> ok=false (no fake): broken envelope, dangling ref.
//
// Pure C++20, no external deps, no test framework.

#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/StepPart21.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/NativeRoute.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

using namespace forge::native::brep;
namespace hem = forge::native::mesh;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool rel(double got, double exp, double tol) {
    double d = std::fabs(got - exp);
    double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}

// Count ADVANCED_FACE instances in a solid (== emitted face count).
static std::size_t faceCount(const Solid& s) {
    std::size_t n = 0;
    for (const Shell* sh : s.shells) if (sh) n += sh->faces.size();
    return n;
}

// Watertight check via the native tessellator -> HalfEdgeMesh::validate.
static bool watertight(const Solid& s) {
    bool ok = false;
    hem::HalfEdgeMesh m = tessellateSolidToMesh(s, ok);
    return ok && m.validate().isValid();
}

// Re-parse the emitted text and confirm zero dangling #refs across the DATA body.
static bool parsesWithNoDangling(const std::string& text, std::string& why) {
    std::size_t dB = 0, dE = 0;
    if (!p21::locateSections(text, dB, dE, why)) return false;
    std::unordered_map<std::uint64_t, p21::Instance> tab;
    if (!p21::parseInstances(text, dB, dE, tab, why)) return false;
    if (tab.empty()) { why = "no instances"; return false; }
    // Scan every parameter for a #ref and ensure it resolves.
    for (const auto& kv : tab) {
        const std::string& params = kv.second.params;
        for (std::size_t i = 0; i < params.size(); ++i) {
            if (params[i] != '#') continue;
            std::size_t j = i + 1;
            while (j < params.size() && params[j] >= '0' && params[j] <= '9') ++j;
            if (j == i + 1) continue;
            std::uint64_t id = std::stoull(params.substr(i + 1, j - (i + 1)));
            if (tab.find(id) == tab.end()) {
                why = "dangling #" + std::to_string(id) + " in #" +
                      std::to_string(kv.first);
                return false;
            }
            i = j - 1;
        }
    }
    return true;
}

// One round-trip case: write `src`, assert the keyword is present, read it back,
// and compare mass props + face count + watertightness.
static void roundTrip(const std::string& label, const Solid& src,
                      const std::string& surfaceKeyword) {
    MassProps mp0 = massProperties(src);
    auto wr = StepAnalytic::write(src, label);
    check(wr.ok, label + ": write ok");
    if (!wr.ok) return;

    // analytic-surface keyword present (proves analytic, not faceted)
    if (!surfaceKeyword.empty())
        check(wr.text.find(surfaceKeyword) != std::string::npos,
              label + ": emits analytic " + surfaceKeyword);
    check(wr.text.find("ADVANCED_BREP_SHAPE_REPRESENTATION") != std::string::npos,
          label + ": ADVANCED_BREP_SHAPE_REPRESENTATION present");

    std::string why;
    check(parsesWithNoDangling(wr.text, why),
          label + ": valid part-21, zero dangling refs" + (why.empty() ? "" : " (" + why + ")"));

    auto rr = StepAnalytic::read(wr.text);
    check(rr.ok && rr.solid, label + ": read ok" + (rr.ok ? "" : " — " + rr.reason));
    if (!rr.ok || !rr.solid) return;

    check(faceCount(*rr.solid) == faceCount(src), label + ": face count preserved");
    check(watertight(*rr.solid), label + ": reconstructed solid is watertight");

    MassProps mp1 = massProperties(*rr.solid);
    check(rel(mp1.volume, mp0.volume, 1e-6), label + ": volume preserved (1e-6)");
    bool com = rel(mp1.com[0], mp0.com[0], 1e-6) &&
               rel(mp1.com[1], mp0.com[1], 1e-6) &&
               rel(mp1.com[2], mp0.com[2], 1e-6);
    check(com, label + ": COM preserved (1e-6)");
    bool inertia = true;
    for (int k = 0; k < 9; ++k) {
        double scale = std::max(1.0, std::fabs(mp0.inertiaCom[k]));
        if (std::fabs(mp1.inertiaCom[k] - mp0.inertiaCom[k]) > 1e-6 * scale)
            inertia = false;
    }
    check(inertia, label + ": inertia tensor preserved (1e-6)");
}

int main() {
    std::printf("step_analytic_test — STEP 3c analytic STEP codec (write + read)\n");

    // ---- primitive round trips -------------------------------------------
    {
        SolidFactory fac;
        roundTrip("box(2,3,4)", *fac.buildBox(2.0, 3.0, 4.0), "PLANE");
    }
    {
        // NOTE: the native cylinder primitive stores its side wall as a DEGENERATE
        // cone (r1==r2). The writer recognises that and emits a true
        // CYLINDRICAL_SURFACE (a zero-half-angle cone IS a cylinder; emitting it as
        // a cylinder is both exact and what a strict reader — OCCT — expects).
        SolidFactory fac;
        roundTrip("cylinder(1.3,5)", *fac.buildCylinder(1.3, 5.0), "CYLINDRICAL_SURFACE");
    }
    {
        SolidFactory fac;
        roundTrip("cone(2,0.8,4)", *fac.buildCone(2.0, 0.8, 4.0), "CONICAL_SURFACE");
    }
    {
        SolidFactory fac;
        roundTrip("sphere(2.1)", *fac.buildSphere(2.1), "SPHERICAL_SURFACE");
    }
    {
        SolidFactory fac;
        roundTrip("tube(2,1,4)", *fac.buildTube(2.0, 1.0, 4.0), "CYLINDRICAL_SURFACE");
    }
    {
        SolidFactory fac;
        roundTrip("torus(3,1)", *fac.buildTorus(3.0, 1.0), "TOROIDAL_SURFACE");
    }

    // ---- bored plate: box - cylinder (analytic-face Cut) ------------------
    // A 4x4x2 plate with a through bore of r=0.8 centred. The Cut keeps the box
    // planar faces + ONE analytic cylindrical bore wall — the analytic STEP must
    // carry CYLINDRICAL_SURFACE and round-trip the EXACT analytic volume.
    {
        SolidFactory facBox;  Solid* box = facBox.buildBox(4.0, 4.0, 2.0);
        SolidFactory facCyl;  Solid* cyl = facCyl.buildCylinder(0.8, 6.0);
        // place the cylinder centred in XY and spanning beyond the plate in Z.
        const double R[9] = {1,0,0, 0,1,0, 0,0,1};
        const double t[3] = {2.0, 2.0, -2.0};
        std::shared_ptr<TopologyBuilder> movedOwner;
        Solid* tool = transformSolid(*cyl, R, t, movedOwner);
        BooleanResult br = booleanSolid(*box, *tool, BoolOp::Cut);
        check(br.ok && br.solid, std::string("bored-plate: Cut ok") +
              (br.ok ? "" : std::string(" — ") + (br.reason ? br.reason : "")));
        if (br.ok && br.solid) {
            check(!br.usedMeshFallback, "bored-plate: analytic boolean (no mesh fallback)");
            // the bore wall is a degenerate-cone cylinder -> emitted as the exact
            // CYLINDRICAL_SURFACE (the writer collapses the zero-half-angle cone).
            roundTrip("bored-plate(4x4x2 bore r0.8)", *br.solid, "CYLINDRICAL_SURFACE");
        }
    }

    // ---- honest failure modes (0 fakes) -----------------------------------
    {
        auto r1 = StepAnalytic::read("not a step file");
        check(!r1.ok, "read: garbage -> ok=false");
        auto r2 = StepAnalytic::read(
            "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n"
            "#1=MANIFOLD_SOLID_BREP('',#999);\nENDSEC;\nEND-ISO-10303-21;\n");
        check(!r2.ok, "read: dangling shell ref -> ok=false");
        // write of an empty solid -> ok=false
        TopologyBuilder tb; Solid* empty = tb.makeSolid();
        auto w = StepAnalytic::write(*empty);
        check(!w.ok, "write: empty solid -> ok=false");
    }

    std::printf("step_analytic_test RESULT: %d/%d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
