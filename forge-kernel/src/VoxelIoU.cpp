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

#include <algorithm>
#include <cmath>

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

// Move (and optionally scale) a shape to the origin per the alignment convention.
bool normalise(const TopoDS_Shape& in, const Box& b, IoUAlign align,
               TopoDS_Shape& out, std::string& why) {
    if (align == IoUAlign::Raw) { out = in; return true; }
    const double cx = 0.5 * (b.lo[0] + b.hi[0]);
    const double cy = 0.5 * (b.lo[1] + b.hi[1]);
    const double cz = 0.5 * (b.lo[2] + b.hi[2]);
    double s = 1.0;
    if (align == IoUAlign::CentredScaled) {
        const double dx = b.hi[0] - b.lo[0], dy = b.hi[1] - b.lo[1], dz = b.hi[2] - b.lo[2];
        const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
        if (!(diag > 1e-9)) { why = "degenerate extent; cannot scale to unit diagonal"; return false; }
        s = 1.0 / diag;
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

    BRepClass3d_SolidClassifier ca, cb;
    try {
        ca.Load(sa);
    } catch (const std::exception& e) {
        out.failure = std::string("cannot classify candidate: ") + e.what();
        return false;
    } catch (...) {
        out.failure = "cannot classify candidate (non-standard exception)";
        return false;
    }
    try {
        cb.Load(sb);
    } catch (const std::exception& e) {
        out.failure = std::string("cannot classify reference: ") + e.what();
        return false;
    } catch (...) {
        out.failure = "cannot classify reference (non-standard exception)";
        return false;
    }

    const double tol = 1e-7;
    long inA = 0, inB = 0, both = 0, either = 0, errs = 0;
    for (int i = 0; i < gridN; ++i) {
        const double x = lo[0] + (i + 0.5) * step[0];
        for (int j = 0; j < gridN; ++j) {
            const double y = lo[1] + (j + 0.5) * step[1];
            for (int k = 0; k < gridN; ++k) {
                const gp_Pnt p(x, y, lo[2] + (k + 0.5) * step[2]);
                bool a = false, b = false;
                try {
                    ca.Perform(p, tol);
                    a = (ca.State() == TopAbs_IN || ca.State() == TopAbs_ON);
                } catch (...) { ++errs; }
                try {
                    cb.Perform(p, tol);
                    b = (cb.State() == TopAbs_IN || cb.State() == TopAbs_ON);
                } catch (...) { ++errs; }
                if (a) ++inA;
                if (b) ++inB;
                if (a && b) ++both;
                if (a || b) ++either;
            }
        }
    }

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
    if (errs) {
        out.failure = "measured, but " + std::to_string(errs) +
                      " point classifications threw and were counted as outside";
    }
    return true;
}

}  // namespace forge
