// multi_solid_import_gate.cpp — T-152. Does importOcctSolid return ok=true for a
// shape it only PARTIALLY imported?
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────
// src/OcctImport.cpp picked the FIRST TopoDS_Solid and dropped the rest:
//
//     TopExp_Explorer solidEx(shape, TopAbs_SOLID);
//     TopoDS_Shape src = shape;
//     if (solidEx.More()) src = solidEx.Current();
//
// and then returned ok=true. include/forge/OcctImport.hpp said so honestly
// ("Import the FIRST solid found in `shape`") — and every caller still read
// ok=true as "the whole shape is now native". Documentation is not a guard.
//
// ── WHAT THIS GATE MEASURES: FAR MATERIAL LOSS ──────────────────────────────
// The production symptom is that a point sitting deep inside solid #2 of a
// two-solid part comes back OUTSIDE — material silently deleted. So the metric
// is a count of exactly those points, not a volume ratio:
//
//   * probe uniformly in the shape's padded bounding box;
//   * OCCT's BRepClass3d_SolidClassifier, loaded with the WHOLE shape, decides
//     what is material and what is near the boundary. A probe is FAR MATERIAL
//     iff the classifier says IN at tolerance tFar = 1e-2 * bboxDiagonal — i.e.
//     it is inside AND more than tFar from any face. OCCT is the referee for
//     both questions, so the arm under test never gets to grade itself.
//   * BEFORE (what the old importer lost): the same FAR MATERIAL probes are
//     re-classified by a second OCCT classifier loaded with ONLY the first
//     solid — the exact shape the old `src` line selected. This number is pure
//     OCCT and needs no rebuild, so BEFORE and AFTER print in the SAME run.
//   * AFTER (what the importer actually loses now): the same probes are
//     classified by native::brep::pointInSolid against the imported Solid.
//
// A FAR probe is a full tFar away from every face, so neither number can be an
// artefact of the import's chord tolerance: a chord error cannot move a point
// 1% of the diagonal. That is why the bar below is 1e-9 and not a percentage.
//
// ── WHY THIS INSTRUMENT CANNOT GO QUIET ─────────────────────────────────────
// This programme's standing failure is a check quieter than the truth. Three
// assertions, none optional:
//
//   1. EVERY multi-solid fixture MUST report beforeLoss > 0. A fixture that is
//      not actually lossy under the old rule tests nothing, and a gate that
//      passes on it is measuring its own absence. (This is also why the
//      fixtures are asserted to carry the solid count they claim.)
//   2. farMaterial MUST be non-zero on every part. Zero FAR probes means the
//      stratifier rejected everything and "0 lost of 0" is not evidence.
//   3. The single-solid CONTROL must import ok with zero loss. If the fix broke
//      the ordinary path, this is what says so.
//
// ── FIXTURES ────────────────────────────────────────────────────────────────
// Built IN CODE from OCCT primitives, so they are committed, deterministic, and
// need no corpus — CI has OCCT and nothing else. Extra STEP paths may be passed
// on the command line (the 600-part gold corpus holds real multi-solid parts:
// ho1 carries 2 solids, ho1005 carries 3, ho1191 carries 1).
//
//   usage: multi_solid_import_gate [--probes N] [part.step ...]
//
// Exit 0 = every part passed. Exit 1 = a part failed (named). Exit 2 = usage.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <BRepBndLib.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Builder.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <Bnd_Box.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <TopAbs_State.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <BRepBuilderAPI_Transform.hxx>

#include "forge/OcctImport.hpp"                  // THE FUNCTION UNDER TEST
#include "forge/ShapeClassify.hpp"               // classifyPoint + its cache bound
#include "forge/ShapeRegistry.hpp"                // handles for the cache-bound check
#include "forge/native/brep/MassProps.hpp"       // volume of the imported solid
#include "forge/native/brep/Query.hpp"           // pointInSolid
#include "forge/native/brep/Topology.hpp"

namespace nb = forge::native::brep;

namespace {

// ---------------------------------------------------------------- determinism
std::uint64_t splitmix64(std::uint64_t& s) {
    s += 0x9E3779B97F4A7C15ULL;
    std::uint64_t z = s;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
}
double uniform01(std::uint64_t& s) {
    return static_cast<double>(splitmix64(s) >> 11) / 9007199254740992.0;
}
std::uint64_t seedFrom(const std::string& name) {
    std::uint64_t h = 1469598103934665603ULL;   // FNV-1a offset basis
    for (unsigned char c : name) { h ^= c; h *= 1099511628211ULL; }
    return h;
}

TopoDS_Shape movedBox(double dx, double dy, double dz, double at) {
    TopoDS_Shape b = BRepPrimAPI_MakeBox(dx, dy, dz).Shape();
    gp_Trsf t;
    t.SetTranslation(gp_Vec(at, 0.0, 0.0));
    return BRepBuilderAPI_Transform(b, t, Standard_True).Shape();
}

// ------------------------------------------------------------------- fixtures
struct Fixture {
    std::string  name;
    TopoDS_Shape shape;
    int          expectSolids = 1;   // asserted, so a fixture cannot quietly
                                     // stop being multi-solid
};

std::vector<Fixture> builtinFixtures() {
    std::vector<Fixture> out;

    // (0) CONTROL — one solid. Must import ok with zero loss both before and
    //     after; it is the regression guard on the ordinary path.
    out.push_back({"fx_one_box", BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape(), 1});

    // (1) TWO DISJOINT BOXES. The first solid explored holds 1000 of 9000 mm^3,
    //     so the old rule drops 8/9 of the material.
    {
        TopoDS_Compound c;
        BRep_Builder bb;
        bb.MakeCompound(c);
        bb.Add(c, BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape());
        bb.Add(c, movedBox(20.0, 20.0, 20.0, 50.0));
        out.push_back({"fx_two_boxes", c, 2});
    }

    // (2) THREE DISJOINT BOXES — the ho1005 shape of the problem (3 solids).
    {
        TopoDS_Compound c;
        BRep_Builder bb;
        bb.MakeCompound(c);
        bb.Add(c, BRepPrimAPI_MakeBox(6.0, 6.0, 6.0).Shape());
        bb.Add(c, movedBox(12.0, 12.0, 12.0, 40.0));
        bb.Add(c, movedBox(24.0, 24.0, 24.0, 90.0));
        out.push_back({"fx_three_boxes", c, 3});
    }

    // (3) TWO BOXES SHARING A FACE — the CROSS-BODY hazard, made constructible.
    //     The vertex weld is GLOBAL, so body A's +X wall and body B's -X wall land
    //     on the SAME welded vertex ids with OPPOSITE winding. Keyed only by the
    //     vertex set, fin removal cancels both walls: each body is left OPEN, and
    //     a manifold check pooled over both bodies sees the union close and says
    //     yes. That is ok=true over two open shells — a per-body property decided
    //     globally, which is the defect class this whole task removes.
    //     Scoped per shell, the walls survive, the shared edges are caught as a
    //     cross-body collision, and the import REFUSES by name.
    {
        TopoDS_Compound c;
        BRep_Builder bb;
        bb.MakeCompound(c);
        bb.Add(c, BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape());
        bb.Add(c, movedBox(10.0, 10.0, 10.0, 10.0));   // touches at x = 10
        out.push_back({"fx_two_boxes_touching", c, 2});
    }

    // (4) A CURVED multi-solid: box + cylinder. Proves the all-solids import is
    //     not a planar-only trick, and that a curved second body's interior is
    //     recovered too.
    {
        TopoDS_Compound c;
        BRep_Builder bb;
        bb.MakeCompound(c);
        bb.Add(c, BRepPrimAPI_MakeBox(8.0, 8.0, 8.0).Shape());
        gp_Trsf t;
        t.SetTranslation(gp_Vec(40.0, 0.0, 0.0));
        bb.Add(c, BRepBuilderAPI_Transform(
                      BRepPrimAPI_MakeCylinder(10.0, 30.0).Shape(), t, Standard_True).Shape());
        out.push_back({"fx_box_plus_cylinder", c, 2});
    }

    return out;
}

// --------------------------------------------------------------- measurement
struct PartResult {
    std::string name;
    bool        measured   = false;   // the instrument ran at all
    std::string note;                 // why not, when it did not
    int         solids     = 0;
    double      volOcct    = 0.0;     // whole shape, OCCT
    double      volFirst   = 0.0;     // first solid only, OCCT
    long        farMaterial = 0;      // FAR-IN probes (the denominator)
    long        lostBefore = 0;       // of those, Outside for FIRST-SOLID-ONLY
    long        lostAfter  = 0;       // of those, Outside for the native import
    bool        importOk   = false;
    std::string importReason;
    double      volNative  = 0.0;
    bool        pass       = false;
    std::string failWhy;
};

double occtVolume(const TopoDS_Shape& s) {
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    return g.Mass();
}

PartResult measure(const std::string& name, const TopoDS_Shape& shape,
                   int bulkProbes, int expectSolids, bool expectSolidsKnown) {
    PartResult r;
    r.name = name;

    if (shape.IsNull()) { r.note = "null shape"; return r; }

    for (TopExp_Explorer se(shape, TopAbs_SOLID); se.More(); se.Next()) ++r.solids;
    if (r.solids == 0) { r.note = "no TopoDS_Solid in shape"; return r; }

    if (expectSolidsKnown && r.solids != expectSolids) {
        r.note = "fixture claims " + std::to_string(expectSolids) + " solids but carries " +
                 std::to_string(r.solids);
        return r;
    }

    TopoDS_Shape firstSolid;
    { TopExp_Explorer se(shape, TopAbs_SOLID); firstSolid = se.Current(); }

    r.volOcct  = occtVolume(shape);
    r.volFirst = occtVolume(firstSolid);

    Bnd_Box bb;
    BRepBndLib::Add(shape, bb);
    if (bb.IsVoid()) { r.note = "void bbox"; return r; }
    double xm, ym, zm, xM, yM, zM;
    bb.Get(xm, ym, zm, xM, yM, zM);
    const double dx = xM - xm, dy = yM - ym, dz = zM - zm;
    const double diagonal = std::sqrt(dx * dx + dy * dy + dz * dz);
    if (!(diagonal > 0.0)) { r.note = "degenerate bbox"; return r; }

    // FAR band: a probe must be this far from EVERY face to count as material.
    // Same stratum rule the T-145 A/B uses, and a full 1% of the diagonal, so no
    // chord tolerance in the importer can reach across it.
    const double tFar = 1e-2 * diagonal;

    BRepClass3d_SolidClassifier whole, firstOnly;
    try {
        whole.Load(shape);
        firstOnly.Load(firstSolid);
    } catch (...) { r.note = "BRepClass3d_SolidClassifier::Load threw"; return r; }

    // ---- the probe set: FAR MATERIAL points, chosen by OCCT on the whole shape
    std::vector<nb::Vec3> far;
    {
        std::uint64_t rng = seedFrom(name);
        const double px = 0.05 * dx + 1e-9, py = 0.05 * dy + 1e-9, pz = 0.05 * dz + 1e-9;
        // Sample until we have `bulkProbes` FAR-material points or exhaust the
        // budget. The budget is generous because a part can be a thin sliver of
        // its own bounding box.
        const int budget = bulkProbes * 200;
        for (int i = 0; i < budget && (int)far.size() < bulkProbes; ++i) {
            const double x = xm - px + uniform01(rng) * (dx + 2 * px);
            const double y = ym - py + uniform01(rng) * (dy + 2 * py);
            const double z = zm - pz + uniform01(rng) * (dz + 2 * pz);
            const gp_Pnt p(x, y, z);
            try {
                whole.Perform(p, tFar);
                if (whole.State() != TopAbs_IN) continue;   // ON or OUT -> not FAR material
            } catch (...) { continue; }
            far.push_back({x, y, z});
        }
    }
    r.farMaterial = (long)far.size();
    if (r.farMaterial == 0) {
        r.note = "no FAR material probe found — the stratifier rejected every sample";
        return r;
    }

    // ---- BEFORE: the same probes against the FIRST SOLID ONLY (pure OCCT).
    for (const nb::Vec3& p : far) {
        try {
            firstOnly.Perform(gp_Pnt(p.x, p.y, p.z), 1e-7);
            const TopAbs_State st = firstOnly.State();
            if (!(st == TopAbs_IN || st == TopAbs_ON)) ++r.lostBefore;
        } catch (...) { ++r.lostBefore; }
    }

    // ---- AFTER: the same probes against whatever importOcctSolid produced.
    forge::ImportResult ir;
    try {
        ir = forge::importOcctSolid(shape);
    } catch (...) {
        r.note = "importOcctSolid threw";
        return r;
    }
    r.importOk     = ir.ok;
    r.importReason = ir.reason;

    if (ir.ok && ir.solid) {
        r.volNative = nb::massProperties(*ir.solid).volume;
        for (const nb::Vec3& p : far) {
            const nb::PointClass pc = nb::pointInSolid(*ir.solid, p, 1e-9);
            if (pc != nb::PointClass::Inside) ++r.lostAfter;
        }
    }

    r.measured = true;

    // ---- the verdict --------------------------------------------------------
    const double beforeFrac = (double)r.lostBefore / (double)r.farMaterial;
    const double afterFrac  = (double)r.lostAfter  / (double)r.farMaterial;

    // (1) a multi-solid fixture that is not lossy under the OLD rule proves
    //     nothing, so the instrument refuses to call it a pass.
    if (r.solids > 1 && !(beforeFrac > 0.0)) {
        r.failWhy = "multi-solid part shows ZERO loss under the old first-solid-only rule "
                    "— this fixture cannot detect the defect it exists to detect";
        return r;
    }
    // (2) the control must still import.
    if (r.solids == 1 && !r.importOk) {
        r.failWhy = "single-solid part no longer imports: " + r.importReason;
        return r;
    }
    // (3) THE BAR. ok=true is a claim about the WHOLE shape.
    if (r.importOk && afterFrac > 1e-9) {
        r.failWhy = "importOcctSolid returned ok=TRUE having lost " +
                    std::to_string(r.lostAfter) + " of " + std::to_string(r.farMaterial) +
                    " FAR material probes (" + std::to_string(100.0 * afterFrac) + "%)";
        return r;
    }
    // (4) a refusal is acceptable ONLY if it names the solid count.
    if (!r.importOk && r.solids > 1) {
        if (r.importReason.find(std::to_string(r.solids)) == std::string::npos) {
            r.failWhy = "refused a " + std::to_string(r.solids) +
                        "-solid shape without naming the count: \"" + r.importReason + "\"";
            return r;
        }
    }
    r.pass = true;
    return r;
}

void report(const PartResult& r) {
    if (!r.measured && r.failWhy.empty() && !r.pass) {
        std::printf("  %-22s  NOT MEASURED — %s\n", r.name.c_str(), r.note.c_str());
        return;
    }
    const double beforeFrac = r.farMaterial ? (double)r.lostBefore / (double)r.farMaterial : 0.0;
    const double afterFrac  = r.farMaterial ? (double)r.lostAfter  / (double)r.farMaterial : 0.0;
    std::printf("  %-22s solids=%d  farProbes=%ld  "
                "LOSS before=%6.2f%%  after=%6.2f%%  "
                "volOcct=%.6g volFirst=%.6g volNative=%.6g  import=%s%s%s  %s\n",
                r.name.c_str(), r.solids, r.farMaterial,
                100.0 * beforeFrac, 100.0 * afterFrac,
                r.volOcct, r.volFirst, r.volNative,
                r.importOk ? "ok" : "REFUSED",
                r.importOk ? "" : " reason=",
                r.importOk ? "" : r.importReason.c_str(),
                r.pass ? "PASS" : "FAIL");
    if (!r.pass && !r.failWhy.empty())
        std::printf("      ^ %s: %s\n", r.name.c_str(), r.failWhy.c_str());
}

}  // namespace

int main(int argc, char** argv) {
    int probes = 150;
    std::vector<std::string> steps;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--probes") == 0 && i + 1 < argc) {
            probes = std::atoi(argv[++i]);
        } else if (std::strncmp(argv[i], "--", 2) == 0) {
            std::fprintf(stderr,
                "usage: multi_solid_import_gate [--probes N] [part.step ...]\n");
            return 2;
        } else {
            steps.push_back(argv[i]);
        }
    }
    if (probes < 1) probes = 1;

    std::printf("=== T-152 multi-solid import gate ===\n");
    std::printf("LOSS = FAR material probes (OCCT: IN at 1%% of the bbox diagonal) that come\n"
                "       back OUTSIDE.  before = first-solid-only (the OLD importer's `src`);\n"
                "       after  = whatever importOcctSolid returns now.  Bar: ok=true => 0.\n");
    // ── THE NON-THROWING CONTRACT, ON THE ERROR PATH ────────────────────────
    // OcctImport.hpp promises "Never throws ... returns ok=false with a reason so
    // the caller can defer", and 13 of the 15 call sites use exactly that to fall
    // through to OCCT. T-152 added a wrapper that explores `shape` on the refusal
    // path, so the null input — which the body rejects on its first line — now
    // passes through code the old version never reached. Asserted here rather
    // than reasoned about, because a contract change on an error path is the
    // defect class this whole gate exists for.
    int failures = 0, measured = 0;
    {
        bool threw = false, ok = true;
        std::string reason;
        try {
            const forge::ImportResult r = forge::importOcctSolid(TopoDS_Shape{});
            ok = r.ok;
            reason = r.reason;
        } catch (...) { threw = true; }
        const bool pass = (!threw && !ok && !reason.empty());
        std::printf("  %-22s threw=%d ok=%d reason=\"%s\"  %s\n",
                    "null_shape (contract)", (int)threw, (int)ok, reason.c_str(),
                    pass ? "PASS" : "FAIL");
        if (!pass) {
            std::printf("      ^ importOcctSolid(null) must return ok=false with a reason "
                        "and NEVER throw — the callers' deferral path depends on it\n");
            ++failures;
        }
        ++measured;
    }

    // ── THE CLASSIFY CACHE IS BOUNDED ───────────────────────────────────────
    // classifyPoint caches one imported topology per OCCT handle. Handles are
    // never reused and a released handle is rejected, so this was never a
    // staleness bug — it was a LEAK: ShapeRegistry::release() freed the body and
    // the topology cached beside it stayed for the life of the process. In a
    // batch run that is "bounded by the parts you process"; in Forge.app, a
    // persistent process, it is unbounded across a modelling session.
    //
    // This lives in THIS gate because this gate RUNS — classifyPoint is the
    // consumer the T-152 importer exists for, and a leak with no test is a leak
    // that comes back. The assertion is on the BOUND, not on a size: capacity is
    // lowered so eviction is forced without allocating 64 bodies.
    {
        const std::size_t savedCap = forge::classifyCacheCapacity();
        forge::classifyCacheClear();
        forge::classifyCacheSetCapacity(8);

        const int kBodies = 64;
        std::size_t peak = 0;
        for (int i = 0; i < kBodies; ++i) {
            // A DISTINCT body each time, so each gets its own handle and its own
            // import — the create/classify/release cycle the finding describes.
            TopoDS_Shape s = BRepPrimAPI_MakeBox(1.0 + i * 0.01, 2.0, 3.0).Shape();
            const forge::ShapeHandle h = forge::ShapeRegistry::instance().add(s);
            try { forge::classifyPoint(h, 0.5, 1.0, 1.5, 1e-9); } catch (...) {}
            peak = std::max(peak, forge::classifyCacheSize());
            forge::ShapeRegistry::instance().release(h);
        }
        const std::size_t after = forge::classifyCacheSize();
        const bool pass = (peak <= 8 && after <= 8);
        std::printf("  %-22s bodies=%d cap=8 peakCached=%zu finalCached=%zu  %s\n",
                    "classify cache bound", kBodies, peak, after, pass ? "PASS" : "FAIL");
        if (!pass) {
            std::printf("      ^ the classify cache grew past its capacity — one imported "
                        "topology per distinct handle is retained without bound\n");
            ++failures;
        }
        ++measured;

        forge::classifyCacheClear();
        forge::classifyCacheSetCapacity(savedCap);
    }

    std::printf("--- built-in fixtures (probes=%d) ---\n", probes);

    for (const Fixture& f : builtinFixtures()) {
        PartResult r = measure(f.name, f.shape, probes, f.expectSolids, true);
        report(r);
        if (r.measured) ++measured;
        if (!r.pass) ++failures;
    }

    if (!steps.empty()) {
        std::printf("--- STEP parts ---\n");
        for (const std::string& path : steps) {
            std::string name = path;
            if (auto s = name.find_last_of('/'); s != std::string::npos) name = name.substr(s + 1);
            TopoDS_Shape shape;
            STEPControl_Reader rd;
            if (rd.ReadFile(path.c_str()) != IFSelect_RetDone) {
                std::printf("  %-22s  NOT MEASURED — STEP read failed\n", name.c_str());
                continue;
            }
            rd.TransferRoots();
            shape = rd.OneShape();
            PartResult r = measure(name, shape, probes, 0, false);
            report(r);
            if (r.measured) ++measured;
            // A corpus part that cannot be measured is reported, not counted as a
            // failure: the corpus is not committed and its parts are not the bar.
            if (r.measured && !r.pass) ++failures;
        }
    }

    // The instrument must have run. "0 failures out of 0 parts" is not a pass.
    if (measured == 0) {
        std::printf("GATE FAIL — no part was measured at all; this run is not evidence.\n");
        return 1;
    }
    std::printf("%s — %d part(s) measured, %d failure(s)\n",
                failures ? "GATE FAIL" : "GATE PASS", measured, failures);
    return failures ? 1 : 0;
}
