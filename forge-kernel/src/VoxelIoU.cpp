// VoxelIoU.cpp — see forge/VoxelIoU.hpp.
//
// Both solids are classified on ONE grid spanning the union of their bounding
// boxes. Sharing the grid is the whole point: a candidate that is the right
// shape in the wrong place must score badly, and it only does if the reference's
// extent is part of the frame.

#include "forge/VoxelIoU.hpp"

#include <algorithm>
#include <cmath>

#include <BRepBndLib.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <Bnd_Box.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

namespace forge {

namespace {

struct Box { double lo[3]; double hi[3]; bool ok = false; };

Box boundsOf(const TopoDS_Shape& s) {
    Box b;
    try {
        Bnd_Box bb;
        BRepBndLib::Add(s, bb);
        if (bb.IsVoid()) return b;
        bb.Get(b.lo[0], b.lo[1], b.lo[2], b.hi[0], b.hi[1], b.hi[2]);
        b.ok = true;
    } catch (...) {
        b.ok = false;
    }
    return b;
}

}  // namespace

bool voxelIoU(ShapeHandle candidate, ShapeHandle reference, VoxelIoUResult& out,
              int gridN) {
    if (gridN < 2) gridN = 2;
    if (gridN > 256) gridN = 256;          // 256^3 = 16.7M classifications; a ceiling, not a guess

    const TopoDS_Shape* sa = nullptr;
    const TopoDS_Shape* sb = nullptr;
    try {
        sa = &ShapeRegistry::instance().get(candidate);
        sb = &ShapeRegistry::instance().get(reference);
    } catch (...) {
        return false;
    }
    if (!sa || !sb || sa->IsNull() || sb->IsNull()) return false;

    const Box ba = boundsOf(*sa);
    const Box bb = boundsOf(*sb);
    if (!ba.ok || !bb.ok) return false;

    double lo[3], hi[3];
    for (int k = 0; k < 3; ++k) {
        lo[k] = std::min(ba.lo[k], bb.lo[k]);
        hi[k] = std::max(ba.hi[k], bb.hi[k]);
        if (!(hi[k] > lo[k])) { hi[k] = lo[k] + 1.0; }
    }
    // pad by one cell so boundary-touching material is not clipped by the frame
    double step[3];
    for (int k = 0; k < 3; ++k) {
        step[k] = (hi[k] - lo[k]) / static_cast<double>(gridN);
        lo[k] -= step[k];
        hi[k] += step[k];
        step[k] = (hi[k] - lo[k]) / static_cast<double>(gridN);
    }

    BRepClass3d_SolidClassifier ca(*sa);
    BRepClass3d_SolidClassifier cb(*sb);
    const double tol = 1e-7;

    long inA = 0, inB = 0, both = 0, either = 0;
    for (int i = 0; i < gridN; ++i) {
        const double x = lo[0] + (i + 0.5) * step[0];
        for (int j = 0; j < gridN; ++j) {
            const double y = lo[1] + (j + 0.5) * step[1];
            for (int k = 0; k < gridN; ++k) {
                const double z = lo[2] + (k + 0.5) * step[2];
                const gp_Pnt p(x, y, z);
                bool a = false, b = false;
                try {
                    ca.Perform(p, tol);
                    a = (ca.State() == TopAbs_IN || ca.State() == TopAbs_ON);
                } catch (...) { a = false; }
                try {
                    cb.Perform(p, tol);
                    b = (cb.State() == TopAbs_IN || cb.State() == TopAbs_ON);
                } catch (...) { b = false; }
                if (a) ++inA;
                if (b) ++inB;
                if (a && b) ++both;
                if (a || b) ++either;
            }
        }
    }

    out.gridN = gridN;
    out.inA = inA;
    out.inB = inB;
    out.intersection = both;
    out.unionCount = either;
    out.iou = either > 0 ? static_cast<double>(both) / static_cast<double>(either) : 0.0;
    out.cellVolume = step[0] * step[1] * step[2];
    return true;
}

}  // namespace forge
