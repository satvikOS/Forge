// VoxelIoU.cpp — see forge/VoxelIoU.hpp.
//
// Both solids are classified on ONE grid. Under IoUAlign::Raw that grid spans the
// union of their world bounding boxes, so a candidate that is the right shape in
// the wrong place scores badly — which is the point. Under Centred /
// CentredScaled each solid is first moved (and optionally scaled) so the score
// answers "is this the right shape" independently of where it sits.
//
// Every failure path records WHY. A bare `catch (...)` returning false once made
// four cleanly-importable STEPs simply "fail" with nothing to diagnose; a
// measurement tool that cannot say why it declined is not a measurement tool.

#include "forge/VoxelIoU.hpp"
#include "forge/ParallelFor.hpp"
#include "forge/ShapeRegistry.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <stdexcept>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <vector>

#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <Bnd_Box.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

namespace forge {

namespace {

struct Box {
    double lo[3]{};
    double hi[3]{};
    bool ok = false;
};

Box boundsOf(const TopoDS_Shape& s, std::string& why) {
    Box b;
    try {
        Bnd_Box bb;
        BRepBndLib::Add(s, bb);
        if (bb.IsVoid()) { why = "bounding box is void (empty shape?)"; return b; }
        bb.Get(b.lo[0], b.lo[1], b.lo[2], b.hi[0], b.hi[1], b.hi[2]);
        for (int k = 0; k < 3; ++k) {
            if (!std::isfinite(b.lo[k]) || !std::isfinite(b.hi[k])) {
                why = "bounding box is not finite";
                return b;
            }
        }
        b.ok = true;
    } catch (const std::exception& e) {
        why = std::string("BRepBndLib threw: ") + e.what();
    } catch (...) {
        why = "BRepBndLib threw a non-standard exception";
    }
    return b;
}

// Is a point inside a bounding box, slackened by `pad` on every side?
// `pad` is the classifier's own tolerance: a point that fails this is further from the
// solid than any tolerance in play, so IN and ON are both impossible.
inline bool inBox(const Box& b, double x, double y, double z, double pad) {
    return x >= b.lo[0] - pad && x <= b.hi[0] + pad &&
           y >= b.lo[1] - pad && y <= b.hi[1] + pad &&
           z >= b.lo[2] - pad && z <= b.hi[2] + pad;
}

// Move (and optionally scale) a shape to the origin per the alignment convention.
bool normalise(const TopoDS_Shape& in, const Box& b, IoUAlign align,
               TopoDS_Shape& out, std::string& why) {
    if (align == IoUAlign::Raw) { out = in; return true; }
    const double cx = 0.5 * (b.lo[0] + b.hi[0]);
    const double cy = 0.5 * (b.lo[1] + b.hi[1]);
    const double cz = 0.5 * (b.lo[2] + b.hi[2]);
    double s = 1.0;
    if (align == IoUAlign::CentredScaled || align == IoUAlign::CentredLongest) {
        const double dx = b.hi[0] - b.lo[0], dy = b.hi[1] - b.lo[1], dz = b.hi[2] - b.lo[2];
        // Diagonal and longest-axis are different normalisations, not variants of
        // one: they agree only when the extent is confined to a single axis, and
        // differ by sqrt(3) for a cube. BenchCAD uses the longest axis.
        const double d = (align == IoUAlign::CentredLongest)
                             ? std::max(dx, std::max(dy, dz))
                             : std::sqrt(dx * dx + dy * dy + dz * dz);
        if (!(d > 1e-9)) {
            why = (align == IoUAlign::CentredLongest)
                      ? "degenerate extent; cannot scale to unit longest axis"
                      : "degenerate extent; cannot scale to unit diagonal";
            return false;
        }
        s = 1.0 / d;
    }
    try {
        gp_Trsf move;
        move.SetTranslation(gp_Vec(-cx, -cy, -cz));
        TopoDS_Shape centred = BRepBuilderAPI_Transform(in, move, true).Shape();
        if (align == IoUAlign::Centred) { out = centred; return true; }
        gp_Trsf scale;
        scale.SetScale(gp_Pnt(0, 0, 0), s);
        out = BRepBuilderAPI_Transform(centred, scale, true).Shape();
        return true;
    } catch (const std::exception& e) {
        why = std::string("normalising transform threw: ") + e.what();
        return false;
    } catch (...) {
        why = "normalising transform threw a non-standard exception";
        return false;
    }
}

// ------------------------------------------------------- per-cell digest
// WHY A DIGEST AND NOT JUST THE COUNTS
//
// The four counts this file returns (inA, inB, intersection, union) are SUMS.
// Two different occupancy grids can produce the same four sums -- one cell
// gained here and one lost there cancels exactly -- so "the counts matched" is
// a weaker claim than "every cell matched", and the difference is precisely
// what a parallelisation bug would look like. The digest below folds the
// per-cell (inA,inB) state pair, in the canonical i-j-k order of the serial
// loop, into one 64-bit value, and reports HOW MANY CELLS it folded. A claim of
// bit-identity is then checkable against a stated denominator rather than
// against the absence of a complaint.
//
// It is OFF unless FORGE_VOXEL_CELL_DIGEST=1, so it costs a branch-free byte
// store per cell only when a caller is actually checking.
struct CellDigest {
    bool on = false;
    std::vector<unsigned char> cells;   // one byte per cell, canonical order
    long n = 0;

    void arm(long gridN) {
        const char* e = std::getenv("FORGE_VOXEL_CELL_DIGEST");
        on = (e && e[0] == '1' && e[1] == '\0');
        if (!on) return;
        n = gridN * gridN * gridN;
        cells.assign(static_cast<std::size_t>(n), 0);
    }
    // index is the canonical serial-loop position (i*gridN + j)*gridN + k
    inline void set(long index, bool a, bool b) {
        if (!on) return;
        cells[static_cast<std::size_t>(index)] =
            static_cast<unsigned char>((a ? 1 : 0) | (b ? 2 : 0));
    }
    // FNV-1a 64. Order-DEPENDENT on purpose: a permutation of the same cells is
    // a different grid and must not hash the same.
    void report(long gridN, long inA, long inB, long both, long either,
                long errs, long performCalls, long culled) const {
        if (!on) return;
        std::uint64_t h = 0xcbf29ce484222325ULL;
        for (std::size_t i = 0; i < cells.size(); ++i) {
            h ^= static_cast<std::uint64_t>(cells[i]);
            h *= 0x100000001b3ULL;
        }
        std::fprintf(stderr,
                     "VOXELIOU_CELL_DIGEST gridN=%ld cells=%ld digest=%016llx "
                     "inA=%ld inB=%ld intersection=%ld union=%ld errs=%ld "
                     "classifierCalls=%ld culled=%ld\n",
                     gridN, n, static_cast<unsigned long long>(h), inA, inB, both,
                     either, errs, performCalls, culled);
    }
};

}  // namespace

bool voxelIoU(ShapeHandle candidate, ShapeHandle reference, VoxelIoUResult& out,
              int gridN, IoUAlign align) {
    out.failure.clear();
    if (gridN < 2) gridN = 2;
    if (gridN > 256) gridN = 256;   // 256^3 = 16.7M classifications; a ceiling, not a guess

    TopoDS_Shape rawA, rawB;
    try {
        rawA = ShapeRegistry::instance().get(candidate);
    } catch (const std::exception& e) {
        // Report what actually threw. A bare catch-all here asserted "not in the
        // shape registry" for 62 B-spline-heavy references whose real failure was
        // something else entirely — an audit chased that wording and could not
        // isolate the mechanism, because the message was fiction. A diagnostic
        // that names the wrong cause is worse than none: it sends the reader
        // somewhere the bug is not.
        out.failure = std::string("candidate handle ") + std::to_string(candidate) +
                      " could not be resolved: " + e.what();
        return false;
    } catch (...) {
        out.failure = "candidate handle " + std::to_string(candidate) +
                      " could not be resolved (non-standard exception)";
        return false;
    }
    try {
        rawB = ShapeRegistry::instance().get(reference);
    } catch (const std::exception& e) {
        out.failure = std::string("reference handle ") + std::to_string(reference) +
                      " could not be resolved: " + e.what();
        return false;
    } catch (...) {
        out.failure = "reference handle " + std::to_string(reference) +
                      " could not be resolved (non-standard exception)";
        return false;
    }
    if (rawA.IsNull()) { out.failure = "candidate shape is null"; return false; }
    if (rawB.IsNull()) { out.failure = "reference shape is null"; return false; }

    std::string why;
    Box ba = boundsOf(rawA, why);
    if (!ba.ok) { out.failure = "candidate bounds: " + why; return false; }
    Box bb = boundsOf(rawB, why);
    if (!bb.ok) { out.failure = "reference bounds: " + why; return false; }

    TopoDS_Shape sa, sb;
    if (!normalise(rawA, ba, align, sa, why)) { out.failure = "candidate: " + why; return false; }
    if (!normalise(rawB, bb, align, sb, why)) { out.failure = "reference: " + why; return false; }
    if (align != IoUAlign::Raw) {
        ba = boundsOf(sa, why);
        if (!ba.ok) { out.failure = "candidate bounds after align: " + why; return false; }
        bb = boundsOf(sb, why);
        if (!bb.ok) { out.failure = "reference bounds after align: " + why; return false; }
    }

    double lo[3], hi[3], step[3];
    for (int k = 0; k < 3; ++k) {
        lo[k] = std::min(ba.lo[k], bb.lo[k]);
        hi[k] = std::max(ba.hi[k], bb.hi[k]);
        if (!(hi[k] > lo[k])) hi[k] = lo[k] + 1.0;
    }
    // pad by one cell so boundary-touching material is not clipped by the frame
    for (int k = 0; k < 3; ++k) {
        step[k] = (hi[k] - lo[k]) / static_cast<double>(gridN);
        lo[k] -= step[k];
        hi[k] += step[k];
        step[k] = (hi[k] - lo[k]) / static_cast<double>(gridN);
    }

    // ------------------------------------------------------------- the workers
    // ONE CLASSIFIER PAIR PER WORKER. BRepClass3d_SolidClassifier::Perform MUTATES
    // the classifier — State() reads back what the last Perform left there — so a
    // single shared classifier cannot be asked a question from two threads at once.
    // The shapes are shared and read-only; the query objects are not shared at all.
    //
    // EVERY Load HAPPENS HERE, on the calling thread, before any worker starts. Load
    // is where a classifier walks the shape and builds its face bounding-box tree,
    // which is also where the shape's geometry is first read. Doing all of them
    // serially keeps that first read out of the concurrent phase, so the parallel
    // section only ever re-reads geometry that has already been touched once.
    // HOW MANY WORKERS, AND WHY NOT ALL OF THEM
    //
    // MEASURED on this 14-core box (10 P + 4 E, OCCT 7.9.3), wall clock in seconds for
    // one forge_verify row, FORGE_VOXEL_THREADS sweeping the worker count:
    //
    //   workers                 1     2     3     4     5     6     8
    //   box10 vs box10  g64   3.20  2.83  2.92  3.15  3.45  5.86  6.98
    //   tri-cyl part    g64   9.33  5.59  4.51  3.78  3.45  4.49  5.11
    //   cadgenbench     g16   1.59  1.02  0.86  0.77  0.72  0.84  0.88
    //
    // It gets WORSE past five, on every fixture, and on the simplest one it is already
    // losing at five. That is not the E-cores: ten workers (ten P-cores) is slower than
    // four. The limit is in-process state shared inside OCCT — the classifier calls
    // TopExp::MapShapesAndAncestors per point, and those containers allocate through one
    // process-wide NCollection_BaseAllocator handle whose atomics every worker touches.
    //
    // The control that proves it: TEN SEPARATE PROCESSES, one worker each, doing the
    // whole tri-cyl row, finish in 10.41 s against 9.34 s for one process — 9.0x the
    // throughput. The machine parallelises; OCCT's classifier, in one address space,
    // does not. So the DEFAULT is capped at FOUR — the largest count that never lost on
    // any fixture measured. FORGE_VOXEL_THREADS overrides the cap, not just the default,
    // so a sweep past four still measures what it asked for.
    const int workers = parallelWorkerCount(0, 4);

    // A PRIVATE DEEP COPY OF EACH SOLID PER WORKER.
    //
    // Loading N classifiers from ONE TopoDS_Shape leaves every worker walking the same
    // TShape and the same TopLoc nodes, and those carry atomic reference counts: the
    // explorer inside Perform copies them millions of times, so fourteen cores end up
    // fighting over a handful of cache lines. MEASURED on box10 at four workers:
    // 3.99 s sharing one shape, 3.15 s with a copy each — 21% for a copy that costs
    // nothing measurable even on the heaviest pair in the corpus (2162 faces:
    // 17.25 s at one worker, 17.33 s at fourteen, all of it the STEP import).
    //
    // BRepBuilderAPI_Transform with an identity gp_Trsf and Copy=true is the deep copy:
    // Copy=true forces the BRepTools_Modifier path, and an identity gp_Trsf leaves every
    // coordinate bit-untouched. It also introduces NO new OCCT symbol — this file
    // already calls exactly that constructor to normalise the alignment. Worker 0 uses
    // the original, so a single-worker run copies nothing at all.
    std::vector<TopoDS_Shape> sac(static_cast<std::size_t>(workers));
    std::vector<TopoDS_Shape> sbc(static_cast<std::size_t>(workers));
    {
        const gp_Trsf identity;
        for (int w = 0; w < workers; ++w) {
            sac[static_cast<std::size_t>(w)] =
                (w == 0) ? sa : BRepBuilderAPI_Transform(sa, identity, true).Shape();
            sbc[static_cast<std::size_t>(w)] =
                (w == 0) ? sb : BRepBuilderAPI_Transform(sb, identity, true).Shape();
        }
    }
    std::vector<std::unique_ptr<BRepClass3d_SolidClassifier>> cas(
        static_cast<std::size_t>(workers));
    std::vector<std::unique_ptr<BRepClass3d_SolidClassifier>> cbs(
        static_cast<std::size_t>(workers));
    for (int w = 0; w < workers; ++w) {
        try {
            cas[static_cast<std::size_t>(w)].reset(new BRepClass3d_SolidClassifier());
            cas[static_cast<std::size_t>(w)]->Load(sac[static_cast<std::size_t>(w)]);
        } catch (const std::exception& e) {
            out.failure = std::string("cannot classify candidate: ") + e.what();
            return false;
        } catch (...) {
            out.failure = "cannot classify candidate (non-standard exception)";
            return false;
        }
        try {
            cbs[static_cast<std::size_t>(w)].reset(new BRepClass3d_SolidClassifier());
            cbs[static_cast<std::size_t>(w)]->Load(sbc[static_cast<std::size_t>(w)]);
        } catch (const std::exception& e) {
            out.failure = std::string("cannot classify reference: ") + e.what();
            return false;
        } catch (...) {
            out.failure = "cannot classify reference (non-standard exception)";
            return false;
        }
    }

    const double tol = 1e-7;
    CellDigest digest;
    digest.arm(gridN);

    // Per-worker tallies, padded to a cache line. Two workers incrementing two longs
    // that share a 64-byte line would ping that line between cores on every cell —
    // false sharing on the counters can cost more than the classification they count.
    struct Tally {
        long inA = 0, inB = 0, both = 0, either = 0, errs = 0, calls = 0, culled = 0;
        // A THROWN CLASSIFICATION IS A FAILURE, NEVER AN EXCLUSION (see below).
        // Per worker so nothing is shared; `failIdx` is the CELL index, which is
        // what makes the reported failure deterministic under a work-stealing
        // tile cursor — see the merge after the parallel region.
        bool        failed  = false;
        long        failIdx = 0;
        std::string reason;
    };
    struct alignas(64) PaddedTally { Tally t; };
    std::vector<PaddedTally> tallies(static_cast<std::size_t>(workers));

    const long cells = static_cast<long>(gridN) * gridN * gridN;
    std::atomic<bool> abortAll{false};
    parallelForTiles(cells, 0, workers, [&](long begin, long end, int w) {
        if (abortAll.load(std::memory_order_relaxed)) return;   // a peer already failed
        Tally& t = tallies[static_cast<std::size_t>(w)].t;
        BRepClass3d_SolidClassifier& ca = *cas[static_cast<std::size_t>(w)];
        BRepClass3d_SolidClassifier& cb = *cbs[static_cast<std::size_t>(w)];
        const long plane = static_cast<long>(gridN) * gridN;
        for (long idx = begin; idx < end; ++idx) {
            // idx is the canonical serial-loop position (i*gridN + j)*gridN + k, so a
            // tile is a contiguous run of the SAME cells the serial loop visited in
            // the same order — only the order the tiles are retired in changes.
            const long i = idx / plane;
            const long rem = idx - i * plane;
            const long j = rem / gridN;
            const long k = rem - j * gridN;
            // Written term for term as the serial loop wrote it. The point must be the
            // same DOUBLE, not merely the same value to within rounding: a cell centre
            // that differs in the last bit can land on the other side of a face, and
            // "bit-identical" would then be a claim about luck.
            const double x = lo[0] + (i + 0.5) * step[0];
            const double y = lo[1] + (j + 0.5) * step[1];
            const double z = lo[2] + (k + 0.5) * step[2];
            const gp_Pnt p(x, y, z);
            bool a = false, b = false;
            // CULL BY BOUNDING BOX BEFORE ASKING THE CLASSIFIER.
            //
            // This is exact, not a heuristic. Bnd_Box as BRepBndLib fills it already
            // contains the shape inflated by its own face tolerances, and the test is
            // slackened by another `tol` — the same tolerance the classifier is given —
            // so a point that fails it is further from the solid than any tolerance in
            // play and cannot come back IN or ON. The classifier would answer OUT; we
            // answer OUT without paying for it.
            //
            // It matters because the grid spans the UNION of the two bounding boxes:
            // whenever the candidate and the reference differ in size or placement —
            // which is every interesting row — a large part of that union is empty for
            // at least one of them, and the serial code classified all of it anyway.
            // A THROWN CLASSIFICATION IS A FAILURE, NEVER AN EXCLUSION.
            //
            // These two blocks used to read `catch (...) { ++t.errs; }` with `a`/`b`
            // initialised false, so a probe that THREW was counted as a probe that
            // came back OUTSIDE. The counts absorbed it, voxelIoU returned TRUE with
            // a fully populated result, and the only trace was a `failure` string
            // beside a number every caller had reason to read.
            //
            // That is the worst available shape for this defect: OUTSIDE is the
            // answer that REMOVES material, so each throw shrinks the solid it
            // happened on -- and shrinks candidate and reference by different
            // amounts, moving the IoU in an uncontrolled direction. `catch (...)`
            // also discarded what() and the point, so nothing could be diagnosed.
            //
            // MEASURED on the pre-thread version with a fault injected into the
            // candidate classifier: the old handler returned status=ok with
            // IoU 0.250000 -> 0.000000 and inA 320 -> 0; the refusal names cause and
            // coordinates and returns false. Behaviour is identical on healthy input.
            if (!t.failed && inBox(ba, x, y, z, tol)) {
                try {
                    ++t.calls;
                    ca.Perform(p, tol);
                    a = (ca.State() == TopAbs_IN || ca.State() == TopAbs_ON);
                } catch (const std::exception& e) {
                    t.failed = true; t.failIdx = idx;
                    t.reason = std::string("classifying the candidate at (") +
                               std::to_string(x) + ", " + std::to_string(y) + ", " +
                               std::to_string(z) + ") threw: " + e.what() +
                               " -- a failed probe is a failure, not an outside";
                } catch (...) {
                    t.failed = true; t.failIdx = idx;
                    t.reason = std::string("classifying the candidate at (") +
                               std::to_string(x) + ", " + std::to_string(y) + ", " +
                               std::to_string(z) + ") threw a non-standard exception"
                               " -- a failed probe is a failure, not an outside";
                }
            } else if (!t.failed) { ++t.culled; }
            if (!t.failed && inBox(bb, x, y, z, tol)) {
                try {
                    ++t.calls;
                    cb.Perform(p, tol);
                    b = (cb.State() == TopAbs_IN || cb.State() == TopAbs_ON);
                } catch (const std::exception& e) {
                    t.failed = true; t.failIdx = idx;
                    t.reason = std::string("classifying the reference at (") +
                               std::to_string(x) + ", " + std::to_string(y) + ", " +
                               std::to_string(z) + ") threw: " + e.what() +
                               " -- a failed probe is a failure, not an outside";
                } catch (...) {
                    t.failed = true; t.failIdx = idx;
                    t.reason = std::string("classifying the reference at (") +
                               std::to_string(x) + ", " + std::to_string(y) + ", " +
                               std::to_string(z) + ") threw a non-standard exception"
                               " -- a failed probe is a failure, not an outside";
                }
            } else if (!t.failed) { ++t.culled; }
            if (t.failed) {
                // Stop this worker and tell the others to stop too. The result is
                // discarded, so finishing the grid would only cost time -- and on a
                // 64^3 grid that is a quarter of a million pointless classifications.
                abortAll.store(true, std::memory_order_relaxed);
                break;
            }
            if (a) ++t.inA;
            if (b) ++t.inB;
            if (a && b) ++t.both;
            if (a || b) ++t.either;
            // Distinct bytes of a preallocated buffer: each cell is its own memory
            // location, so no two workers ever write the same one.
            digest.set(idx, a, b);
        }
    });

    // Merged in WORKER ORDER. These are integers, so the sum is exact whatever order
    // it is taken in — but fixing the order costs nothing and removes the question.
    long inA = 0, inB = 0, both = 0, either = 0, errs = 0;
    long performCalls = 0, culled = 0;
    for (int w = 0; w < workers; ++w) {
        const Tally& t = tallies[static_cast<std::size_t>(w)].t;
        inA += t.inA; inB += t.inB; both += t.both; either += t.either;
        errs += t.errs; performCalls += t.calls; culled += t.culled;
    }

    // A THROW ENDS THE MEASUREMENT, AND THE REPORTED ONE IS DETERMINISTIC.
    //
    // Which WORKER sees a failure first is not reproducible -- tiles come off one
    // atomic cursor, so the assignment varies run to run. The CELL INDEX does not:
    // reporting the smallest failing idx names the first cell the serial loop would
    // have reached, which is the same answer on every run and at every worker count.
    // This file's own contract is that threading changed nothing observable; a
    // refusal whose text depended on scheduling would break exactly that.
    {
        bool any = false;
        long firstIdx = 0;
        std::string firstReason;
        for (int w = 0; w < workers; ++w) {
            const Tally& t = tallies[static_cast<std::size_t>(w)].t;
            if (!t.failed) continue;
            if (!any || t.failIdx < firstIdx) { firstIdx = t.failIdx; firstReason = t.reason; }
            any = true;
        }
        if (any) {
            out.failure = firstReason;
            return false;
        }
    }
    digest.report(gridN, inA, inB, both, either, errs, performCalls, culled);

    // Both empty means neither solid occupied a single cell — a real failure to
    // measure, not an IoU of zero, and the caller must be able to tell them apart.
    if (either == 0) {
        out.failure = "no cell of the shared grid is inside either solid "
                      "(classification produced nothing to compare)";
        return false;
    }

    out.gridN = gridN;
    out.inA = inA;
    out.inB = inB;
    out.intersection = both;
    out.unionCount = either;
    out.iou = static_cast<double>(both) / static_cast<double>(either);
    out.cellVolume = step[0] * step[1] * step[2];
    // No `errs` epilogue any more: a throw returned false above, so reaching here
    // means every probe of both solids that was not culled actually answered. A
    // true return from this function now carries an unqualified measurement, and
    // out.failure is empty exactly when out.iou is meaningful. `errs` survives only
    // as a digest field, and is necessarily 0 on this path.
    return true;
}

// --------------------------------------------------------------- PointInSolid
// The same classifier the loop above uses, held open so a caller can ask the
// question one point at a time. The classifier is loaded in the constructor
// precisely because loading is the expensive half; a caller that asks thousands
// of times pays for it once.

struct PointInSolid::Impl {
    mutable BRepClass3d_SolidClassifier cls;   // Perform() mutates; the SOLID does not
    bool loaded = false;
    std::string why;
};

PointInSolid::PointInSolid(ShapeHandle body) : impl_(new Impl) {
    try {
        const TopoDS_Shape& s = ShapeRegistry::instance().get(body);
        if (s.IsNull()) {
            impl_->why = "shape behind handle " + std::to_string(body) + " is null";
            return;
        }
        impl_->cls.Load(s);
        impl_->loaded = true;
    } catch (const std::exception& e) {
        // Name what threw. A bare catch-all that invents a cause sends the
        // reader somewhere the bug is not — see the note above voxelIoU.
        impl_->why = std::string("cannot classify handle ") + std::to_string(body) +
                     ": " + e.what();
    } catch (...) {
        impl_->why = "cannot classify handle " + std::to_string(body) +
                     " (non-standard exception)";
    }
}

PointInSolid::~PointInSolid() = default;

bool PointInSolid::loaded() const { return impl_->loaded; }

const std::string& PointInSolid::why() const { return impl_->why; }

PointInSolid::State PointInSolid::at(double x, double y, double z) const {
    if (!impl_->loaded) return State::Error;
    try {
        impl_->cls.Perform(gp_Pnt(x, y, z), 1e-7);
        const TopAbs_State st = impl_->cls.State();
        return (st == TopAbs_IN || st == TopAbs_ON) ? State::In : State::Out;
    } catch (...) {
        return State::Error;
    }
}

}  // namespace forge
