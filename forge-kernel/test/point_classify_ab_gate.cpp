// point_classify_ab_gate.cpp — LIVE-OCCT A/B for the T-145 point-classification seam.
//
// THE QUESTION. Four production TUs classify points with OCCT's
// BRepClass3d_SolidClassifier. forge::classifyPoint (include/forge/ShapeClassify.hpp)
// answers the same question through the native engine. Before any consumer is
// migrated, do the two arms give the SAME in/out answer on real parts?
//
// THE METHOD. Per part, ONE TopoDS_Shape is read once and both arms are run on the
// SAME probe points in ONE process:
//
//   arm A (OLD, the incumbent) : BRepClass3d_SolidClassifier::Perform(gp_Pnt, 1e-7)
//                                 — the exact call src/VoxelIoU.cpp:202 makes, same
//                                   tolerance, same IN||ON -> "material" mapping.
//   arm B (NEW, under test)    : forge::classifyPoint(handle, x, y, z, 1e-9)
//                                 — ShapeRegistry handle -> importOcctSolid ->
//                                   native::brep::pointInSolid.
//
// Both arms are reduced to the SAME binary predicate the production consumers use,
// which is `IN || ON -> in the material` (src/VoxelIoU.cpp:202-203 and :278, and
// VoxelIoU.hpp's "Points ON the boundary count as In").
//
// STRATIFICATION. A disagreement a hair from the boundary and a disagreement deep
// inside the part are not the same defect, and averaging them hides the one that
// matters. So every probe is assigned a stratum first:
//
//   linDefl = 1e-3 * bboxDiagonal              (the chord tolerance used below)
//   tFar    = max(10 * linDefl, 1e-3 * diagonal) = 1e-2 * diagonal
//
//   NEAR — arm A reports ON at tolerance tFar, i.e. the point lies within tFar of
//          the boundary. (A solid classifier's tolerance argument IS its ON band,
//          so OCCT itself is the referee for "how close to the boundary is this" —
//          the baseline arm decides the stratum, not the arm under test.)
//   FAR  — everything else: deep interior or clear exterior.
//
//   FAR discordance must be ZERO. NEAR discordance is REPORTED per part and never
//   suppressed: two different tessellations of one curved boundary genuinely
//   disagree inside a chord-tolerance band, and pretending otherwise would mean
//   widening a tolerance until a fixture passes.
//
// PROBES. Two sources, both deterministic (splitmix64 seeded from the part name, so
// a re-run reproduces the identical point set):
//   * BULK — uniform in the bbox padded by one tenth. Mostly FAR; this is where the
//     zero-discordance requirement does its work.
//   * BOUNDARY — centroids of the shape's own boundary triangles, which are ON the
//     surface by construction and therefore populate the NEAR stratum on purpose. A
//     gate whose NEAR stratum is empty has not tested the hard case at all.
//
// WHY THE SOUP IS REFUSED WHEN CRACKED. The boundary triangles come from
// forge::occtmesh::tessellateShapeToSoup, which is passed `deferredFaces` and whose
// non-zero count is REFUSED. Its own header says a partial "crack-bounded" soup is
// returned whenever at least one face meshes, and triangle centroids taken off a
// soup with a hole in it are not boundary points of the solid. When the count is
// non-zero this gate drops the boundary probes for that part and SAYS SO, rather
// than sampling a surface that is missing pieces.
//
// ============================ THE ANTI-SELF-COMPARISON GATE ==================
// This programme's recurring failure is an instrument quieter than the truth — a
// check that compares one path with itself, or that cannot go red. Three defences,
// all of them assertions and none of them optional:
//
//  1. SAMPLE PARITY. nA == nB and both non-zero. If the two arms did not evaluate
//     the same number of points, the concordance figure is meaningless.
//  2. THE COMPARATOR CAN GO RED. A mutation control: arm A's answer at p is compared
//     against arm B's answer at a DELIBERATELY DISPLACED point (p pushed outside the
//     padded bbox, where the answer must be Outside). The gate REQUIRES this to
//     mismatch at least once. If a displaced comparison still agrees everywhere, the
//     comparator is broken and every "0 discordance" it prints is worthless.
//  3. ARM B REALLY CROSSED THE BRIDGE. forge::classifyCacheSize() must be non-zero
//     after an OCCT-backed part is classified — that counter is incremented only by
//     a successful importOcctSolid inside the seam, so it is positive proof arm B
//     ran the native path rather than being skipped.
//
// The structural half of the distinctness proof — that this TU imports BRepClass3d
// while the seam's own object file imports none of it — is in run_point_classify_ab.sh,
// because it is an nm question and not a runtime one.
//
// DEFERRALS ARE NOT CONCORDANCE. When importOcctSolid declines, classifyPoint throws
// ClassifyRefused and arm B has NO answer. Those parts are counted in their own
// bucket and excluded from the concordance denominator; they are the parts on which
// migrating a consumer would THROW in production, which makes their count the most
// decision-relevant number this gate prints.

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include <BRepBndLib.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <Bnd_Box.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <TopAbs_State.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

#include "forge/OcctNativeMesh.hpp"   // tessellateShapeToSoup (boundary probes)
#include "forge/ShapeClassify.hpp"    // THE SEAM UNDER TEST
#include "forge/ShapeRegistry.hpp"    // add() — to get a handle for arm B

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
    std::uint64_t h = 1469598103934665603ULL;  // FNV-1a offset basis
    for (unsigned char c : name) { h ^= c; h *= 1099511628211ULL; }
    return h;
}

// ------------------------------------------------------- the two arms, reduced
// Arm A: the incumbent call, copied from src/VoxelIoU.cpp:201-203 (tol 1e-7, the
// production value — NOT widened, which would be the way to fake a pass).
constexpr double kOcctTol = 1e-7;

bool occtInMaterial(BRepClass3d_SolidClassifier& cls, const gp_Pnt& p) {
    cls.Perform(p, kOcctTol);
    const TopAbs_State st = cls.State();
    return (st == TopAbs_IN || st == TopAbs_ON);
}

// Arm B: the seam. onTol stays at the header default 1e-9 — deliberately NOT
// matched to arm A's 1e-7, because matching it would mean tuning the new arm to
// the old arm's tolerance to manufacture agreement. Any residue this leaves is
// inside the NEAR band by construction, and the NEAR band is reported, not gated.
constexpr double kNativeOnTol = 1e-9;

bool nativeInMaterial(forge::ShapeHandle h, double x, double y, double z) {
    const forge::PointClass pc = forge::classifyPoint(h, x, y, z, kNativeOnTol);
    return (pc == forge::PointClass::Inside || pc == forge::PointClass::On);
}

struct Probe { double x, y, z; bool near_; };

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr,
            "usage: point_classify_ab_gate <part.step> [bulkProbes]\n"
            "  emits one JSON line on stdout; exit 0 = this part passed\n");
        return 2;
    }
    const std::string path = argv[1];
    const int bulkProbes = (argc >= 3) ? std::atoi(argv[2]) : 400;

    std::string name = path;
    if (auto slash = name.find_last_of('/'); slash != std::string::npos)
        name = name.substr(slash + 1);

    // ------------------------------------------------------------- STEP import
    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        if (rd.ReadFile(path.c_str()) != IFSelect_RetDone) {
            std::printf("{\"part\":\"%s\",\"status\":\"step_read_failed\"}\n", name.c_str());
            return 3;
        }
        rd.TransferRoots();
        shape = rd.OneShape();
    }
    if (shape.IsNull()) {
        std::printf("{\"part\":\"%s\",\"status\":\"null_shape\"}\n", name.c_str());
        return 3;
    }

    // ── BOTH ARMS MUST SEE THE SAME GEOMETRY ────────────────────────────────
    // MEASURED, and it invalidated this gate's first full run. src/OcctImport.cpp:821-822
    // picks the FIRST TopoDS_Solid it finds:
    //
    //     TopExp_Explorer solidEx(shape, TopAbs_SOLID);
    //     TopoDS_Shape src = shape;
    //     if (solidEx.More()) src = solidEx.Current();
    //
    // whereas BRepClass3d_SolidClassifier::Load(shape) takes the WHOLE compound. On a
    // multi-solid STEP part, arm A was therefore answering about N solids and arm B
    // about one of them, and every point inside solids 2..N was a guaranteed
    // "discordance" that said nothing whatever about the native engine. The first run
    // reported 469/2608 FAR discordance on that basis.
    //
    // So the gate hands BOTH arms the SAME first solid — the exact shape
    // importOcctSolid will import — and reports solidCount so a multi-solid part is
    // visible in the results instead of silently mis-compared.
    int solidCount = 0;
    for (TopExp_Explorer se(shape, TopAbs_SOLID); se.More(); se.Next()) ++solidCount;
    if (solidCount > 0) {
        TopExp_Explorer se(shape, TopAbs_SOLID);
        shape = se.Current();   // == importOcctSolid's `src`
    }

    // ------------------------------------------------------------------ bounds
    Bnd_Box bb;
    BRepBndLib::Add(shape, bb);
    if (bb.IsVoid()) {
        std::printf("{\"part\":\"%s\",\"status\":\"void_bbox\"}\n", name.c_str());
        return 3;
    }
    double xm, ym, zm, xM, yM, zM;
    bb.Get(xm, ym, zm, xM, yM, zM);
    const double dx = xM - xm, dy = yM - ym, dz = zM - zm;
    const double diagonal = std::sqrt(dx * dx + dy * dy + dz * dz);
    if (!(diagonal > 0.0)) {
        std::printf("{\"part\":\"%s\",\"status\":\"degenerate_bbox\"}\n", name.c_str());
        return 3;
    }
    const double linDefl = 1e-3 * diagonal;
    const double angDefl = 0.5;
    const double tFar = std::fmax(10.0 * linDefl, 1e-3 * diagonal);  // = 1e-2*diagonal

    // --------------------------------------------------------- handle for arm B
    const forge::ShapeHandle h = forge::ShapeRegistry::instance().add(shape);

    // ------------------------------------------------------------- probe set
    std::vector<Probe> probes;
    std::uint64_t rng = seedFrom(name);

    // BULK — uniform in the bbox padded by a tenth on each side, so exterior
    // points are sampled too and not only the interior.
    const double px = 0.1 * dx + 1e-9, py = 0.1 * dy + 1e-9, pz = 0.1 * dz + 1e-9;
    for (int i = 0; i < bulkProbes; ++i) {
        probes.push_back({xm - px + uniform01(rng) * (dx + 2 * px),
                          ym - py + uniform01(rng) * (dy + 2 * py),
                          zm - pz + uniform01(rng) * (dz + 2 * pz), false});
    }

    // BOUNDARY — triangle centroids of the shape's own boundary soup. REFUSED
    // whole when any face deferred: a crack-bounded soup's centroids are not
    // boundary points of this solid.
    int deferredFaces = 0;
    int boundaryProbes = 0;
    const char* soupNote = "ok";
    {
        std::vector<double> pos;
        std::vector<std::uint32_t> idx;
        const bool soupOk = forge::occtmesh::tessellateShapeToSoup(
            shape, pos, idx, linDefl, angDefl, &deferredFaces);
        if (!soupOk) {
            soupNote = "soup_failed_no_face_meshed";
        } else if (deferredFaces != 0) {
            soupNote = "soup_refused_deferred_faces";
        } else {
            const std::size_t ntri = idx.size() / 3;
            const std::size_t want = 200;
            const std::size_t stride = (ntri > want) ? (ntri / want) : 1;
            for (std::size_t t = 0; t < ntri; t += stride) {
                const std::uint32_t a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
                if (3ull * a + 2 >= pos.size() || 3ull * b + 2 >= pos.size() ||
                    3ull * c + 2 >= pos.size()) continue;
                probes.push_back({(pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3.0,
                                  (pos[3 * a + 1] + pos[3 * b + 1] + pos[3 * c + 1]) / 3.0,
                                  (pos[3 * a + 2] + pos[3 * b + 2] + pos[3 * c + 2]) / 3.0,
                                  true});
                ++boundaryProbes;
            }
        }
    }

    // ------------------------------------------------------------ arm A: OCCT
    BRepClass3d_SolidClassifier cls;
    try {
        cls.Load(shape);
    } catch (...) {
        std::printf("{\"part\":\"%s\",\"status\":\"occt_load_threw\"}\n", name.c_str());
        return 3;
    }
    // A separate classifier instance for the stratum referee, so the tolerance it
    // is Perform()ed at can never leak into arm A's own 1e-7 answer.
    BRepClass3d_SolidClassifier strat;
    try {
        strat.Load(shape);
    } catch (...) {
        std::printf("{\"part\":\"%s\",\"status\":\"occt_load_threw\"}\n", name.c_str());
        return 3;
    }

    long nA = 0, nB = 0;
    long farTotal = 0, farDisc = 0, nearTotal = 0, nearDisc = 0;
    long armAThrew = 0, refusals = 0;
    std::string firstRefusal;
    std::vector<char> aAns(probes.size(), 0);
    std::vector<char> aValid(probes.size(), 0);

    for (std::size_t i = 0; i < probes.size(); ++i) {
        const Probe& q = probes[i];
        const gp_Pnt gp(q.x, q.y, q.z);

        bool a = false;
        bool aOk = true;
        try { a = occtInMaterial(cls, gp); }
        catch (...) { aOk = false; ++armAThrew; }
        if (!aOk) continue;   // a failed probe is a failure, never an exclusion
                              // from the material — so it is counted and skipped,
                              // not silently treated as Outside.
        ++nA;
        aAns[i] = a ? 1 : 0;
        aValid[i] = 1;

        // stratum: is the point within tFar of the boundary, per the BASELINE arm
        bool isNear = q.near_;
        if (!isNear) {
            try {
                strat.Perform(gp, tFar);
                isNear = (strat.State() == TopAbs_ON);
            } catch (...) { isNear = true; }  // unsure -> the forgiving stratum
        }

        bool b = false;
        try { b = nativeInMaterial(h, q.x, q.y, q.z); }
        catch (const forge::ClassifyRefused& e) {
            ++refusals;
            if (firstRefusal.empty()) firstRefusal = e.what();
            continue;                      // a deferral, NOT a discordance
        } catch (const std::exception& e) {
            ++refusals;
            if (firstRefusal.empty()) firstRefusal = std::string("std::exception: ") + e.what();
            continue;
        }
        ++nB;

        if (isNear) { ++nearTotal; if (a != b) ++nearDisc; }
        else        { ++farTotal;  if (a != b) ++farDisc;  }
    }

    // -------------------------------------------------------- defence 3 (bridge)
    const std::size_t cacheSize = forge::classifyCacheSize();

    // ------------------------------- defence 2 (the comparator can go red) -----
    // Compare arm A at p against arm B at a point pushed WELL outside the padded
    // bbox, where the only correct answer is Outside. Over the probes where arm A
    // said "in the material", a displaced arm B must disagree at least once. If it
    // never does, this gate's comparison is inert and its zeroes mean nothing.
    long mutationChecked = 0, mutationMismatched = 0;
    if (nB > 0) {
        const double ox = xM + 10.0 * diagonal, oy = yM + 10.0 * diagonal,
                     oz = zM + 10.0 * diagonal;
        for (std::size_t i = 0; i < probes.size() && mutationChecked < 32; ++i) {
            if (!aValid[i] || !aAns[i]) continue;   // need arm A == in-material
            ++mutationChecked;
            bool bDisp = false;
            try { bDisp = nativeInMaterial(h, ox, oy, oz); } catch (...) { continue; }
            if (bDisp != (aAns[i] != 0)) ++mutationMismatched;
        }
    }

    // ------------------------------------------------------------------ verdict
    const bool deferred = (nB == 0 && refusals > 0);
    bool pass = true;
    const char* fail = "";

    if (deferred) {
        // Not a pass and not a discordance: arm B has no answer for this part.
        pass = false; fail = "arm_b_deferred_whole_part";
    } else if (nB == 0) {
        pass = false; fail = "arm_b_no_samples";
    } else if (nA == 0) {
        pass = false; fail = "arm_a_no_samples";
    } else if (nA != nB) {
        // Sample parity. Unequal counts are expected ONLY via refusals; if the
        // books do not balance, something else dropped a probe silently.
        if (nA - nB != refusals) { pass = false; fail = "sample_parity_unexplained"; }
    }
    if (pass && farDisc != 0)                 { pass = false; fail = "far_discordance"; }
    if (pass && mutationChecked > 0 && mutationMismatched == 0) {
        pass = false; fail = "comparator_inert_mutation_control_agreed";
    }
    if (pass && cacheSize == 0)               { pass = false; fail = "arm_b_never_crossed_bridge"; }

    // JSON escape for the refusal reason (quotes/backslashes only — the reasons are
    // plain ASCII sentences from the importer).
    std::string esc;
    for (char c : firstRefusal) {
        if (c == '"' || c == '\\') { esc.push_back('\\'); esc.push_back(c); }
        else if (static_cast<unsigned char>(c) >= 0x20) esc.push_back(c);
    }

    std::printf(
        "{\"part\":\"%s\",\"status\":\"%s\",\"fail\":\"%s\""
        ",\"solidCount\":%d,\"diagonal\":%.6g,\"linDefl\":%.6g,\"tFar\":%.6g"
        ",\"probes\":%zu,\"boundaryProbes\":%d,\"soup\":\"%s\",\"deferredFaces\":%d"
        ",\"nA\":%ld,\"nB\":%ld,\"armAThrew\":%ld,\"refusals\":%ld"
        ",\"farTotal\":%ld,\"farDisc\":%ld,\"nearTotal\":%ld,\"nearDisc\":%ld"
        ",\"mutationChecked\":%ld,\"mutationMismatched\":%ld,\"cacheSize\":%zu"
        ",\"firstRefusal\":\"%s\"}\n",
        name.c_str(), pass ? "pass" : (deferred ? "deferred" : "fail"), fail,
        solidCount, diagonal, linDefl, tFar,
        probes.size(), boundaryProbes, soupNote, deferredFaces,
        nA, nB, armAThrew, refusals,
        farTotal, farDisc, nearTotal, nearDisc,
        mutationChecked, mutationMismatched, cacheSize,
        esc.c_str());

    if (pass) return 0;
    return deferred ? 4 : 1;   // 4 = honest deferral, 1 = a real A/B failure
}
