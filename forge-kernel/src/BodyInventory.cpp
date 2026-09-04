// BodyInventory — see include/forge/BodyInventory.hpp for what this answers and
// why it is one function rather than a script over massProperties.

#include "forge/BodyInventory.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <exception>

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepBndLib.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopAbs.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Cone.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace forge {
namespace {

struct Box {
    double lo[3] = {0.0, 0.0, 0.0};
    double hi[3] = {0.0, 0.0, 0.0};
    bool valid = false;
};

Box boxOf(const TopoDS_Shape& shape) {
    Box out;
    Bnd_Box bb;
    BRepBndLib::Add(shape, bb);
    // ★ THE GAP, AND WHY IT IS CLEARED. Bnd_Box carries a padding term and Get()
    // returns the bounds ALREADY WIDENED by it, so a 10.000 mm cube measures
    // 10.0000002 mm and a parts list quotes a size no caliper will ever read.
    // MEASURED: the gap is 1.0e-7 on this build, and clearing it returns exactly
    // the same numbers as BRepBndLib::AddOptimal on a box, a cylinder and a
    // sphere -- so this is the tight box, not a rounded one. The padding exists
    // to keep the box an OUTER bound under tolerance; the geometry is inside
    // either way, which is what the pair walk's lower-bound argument needs.
    bb.SetGap(0.0);
    if (bb.IsVoid()) return out;
    bb.Get(out.lo[0], out.lo[1], out.lo[2], out.hi[0], out.hi[1], out.hi[2]);
    out.valid = true;
    return out;
}

// The gap between two axis-aligned boxes: 0 when they overlap, otherwise the
// Euclidean distance between them. This is a LOWER BOUND on the true distance
// between the two solids, which is what makes ordering the pair walk by it — and
// dropping the tail when the cap bites — exact rather than a shortcut. A pair the
// boxes put 40 mm apart cannot be a contact.
double boxGap(const Box& a, const Box& b) {
    if (!a.valid || !b.valid) return 0.0;
    double d2 = 0.0;
    for (int i = 0; i < 3; ++i) {
        const double gap = std::max(0.0, std::max(a.lo[i] - b.hi[i], b.lo[i] - a.hi[i]));
        d2 += gap * gap;
    }
    return std::sqrt(d2);
}

// Whether two directions name the SAME LINE, either way round. Which end of a
// shaft you measured from is not a property of the shaft.
bool sameLine(const gp_Dir& u, const gp_Dir& v) {
    return std::fabs(u.Dot(v)) > 0.999995;  // within about 0.18 degrees
}

double distanceToAxis(const gp_Ax1& axis, const gp_Pnt& p) {
    const gp_Vec toPoint(axis.Location(), p);
    const gp_Vec along(axis.Direction());
    const gp_Vec perp = toPoint - along * toPoint.Dot(along);
    return perp.Magnitude();
}

bool roundFaceAxis(const TopoDS_Face& face, gp_Ax1& out) {
    BRepAdaptor_Surface surface(face);
    const GeomAbs_SurfaceType type = surface.GetType();
    if (type == GeomAbs_Cylinder) { out = surface.Cylinder().Axis(); return true; }
    if (type == GeomAbs_Cone)     { out = surface.Cone().Axis();     return true; }
    return false;
}

bool flatFacePlane(const TopoDS_Face& face, gp_Pln& out) {
    BRepAdaptor_Surface surface(face);
    if (surface.GetType() != GeomAbs_Plane) return false;
    out = surface.Plane();
    return true;
}

} // namespace

BodyInventory bodyInventory(const TopoDS_Shape& shape, const BodyInventoryOptions& options) {
    BodyInventory out;
    if (shape.IsNull()) return out;

    // ---- 1. the solids, in the kernel's own walk order ----------------------
    std::vector<TopoDS_Shape> solids;
    for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next()) {
        solids.push_back(ex.Current());
    }
    if (solids.empty()) return out;  // a sheet or a faceted result: analysed stays false

    // ---- 2. which face belongs to which solid -------------------------------
    // The 1-based positions of TopExp_Explorer(shape, TopAbs_FACE) ARE the face
    // ids forge::tessellate stamps per triangle and forge::faceById resolves, so
    // the same walk is what maps a face to its body and there is no second
    // numbering to drift.
    std::vector<TopTools_IndexedMapOfShape> facesOfSolid(solids.size());
    for (std::size_t i = 0; i < solids.size(); ++i) {
        for (TopExp_Explorer fx(solids[i], TopAbs_FACE); fx.More(); fx.Next()) {
            facesOfSolid[i].Add(fx.Current());
        }
    }
    std::vector<TopoDS_Face> faceById;  // index 0 unused
    faceById.emplace_back();
    out.bodyOfFace.push_back(0u);
    for (TopExp_Explorer fx(shape, TopAbs_FACE); fx.More(); fx.Next()) {
        faceById.push_back(TopoDS::Face(fx.Current()));
        std::uint32_t owner = 0;
        for (std::size_t i = 0; i < facesOfSolid.size(); ++i) {
            if (facesOfSolid[i].Contains(fx.Current())) {
                owner = static_cast<std::uint32_t>(i + 1);
                break;
            }
        }
        out.bodyOfFace.push_back(owner);
    }

    // ---- 3. the per-body measurements ---------------------------------------
    std::vector<Box> boxes(solids.size());
    out.bodies.resize(solids.size());
    for (std::size_t i = 0; i < solids.size(); ++i) {
        SolidBody& body = out.bodies[i];
        GProp_GProps volumeProps;
        BRepGProp::VolumeProperties(solids[i], volumeProps);
        GProp_GProps areaProps;
        BRepGProp::SurfaceProperties(solids[i], areaProps);
        body.volume = volumeProps.Mass();
        body.area = areaProps.Mass();
        const gp_Pnt com = volumeProps.CentreOfMass();
        body.centroid[0] = com.X();
        body.centroid[1] = com.Y();
        body.centroid[2] = com.Z();
        boxes[i] = boxOf(solids[i]);
        for (int c = 0; c < 3; ++c) {
            body.bboxMin[c] = boxes[i].lo[c];
            body.bboxMax[c] = boxes[i].hi[c];
        }
        body.faceCount = static_cast<std::uint32_t>(facesOfSolid[i].Extent());
    }
    out.analysed = true;
    if (solids.size() < 2) return out;  // one body relates to nothing

    // ---- 4. the pairs, CLOSEST FIRST ----------------------------------------
    struct Candidate { std::size_t i; std::size_t j; double boxGap; };
    std::vector<Candidate> candidates;
    for (std::size_t i = 0; i < solids.size(); ++i) {
        for (std::size_t j = i + 1; j < solids.size(); ++j) {
            candidates.push_back(Candidate{i, j, boxGap(boxes[i], boxes[j])});
        }
    }
    std::stable_sort(candidates.begin(), candidates.end(),
                     [](const Candidate& l, const Candidate& r) { return l.boxGap < r.boxGap; });
    if (candidates.size() > options.maxPairs) {
        out.pairsTruncated = true;
        candidates.resize(options.maxPairs);
    }

    for (const Candidate& c : candidates) {
        SolidBodyPair pair;
        pair.a = static_cast<std::uint32_t>(c.i + 1);
        pair.b = static_cast<std::uint32_t>(c.j + 1);
        try {
            BRepExtrema_DistShapeShape distance(solids[c.i], solids[c.j]);
            distance.Perform();
            // A distance the kernel would not compute is a row that is LEFT OUT,
            // never a zero. A zero here would read as "these parts touch".
            if (!distance.IsDone()) continue;
            pair.gap = distance.Value();
        } catch (const std::exception&) {
            continue;
        } catch (...) {
            continue;
        }
        // Material two solids SHARE. Only asked when the boxes overlap, because a
        // boolean between bodies that cannot meet is a guaranteed empty answer
        // paid for at full price.
        if (c.boxGap <= 0.0) {
            try {
                BRepAlgoAPI_Common common(solids[c.i], solids[c.j]);
                common.Build();
                if (common.IsDone() && !common.Shape().IsNull()) {
                    GProp_GProps shared;
                    BRepGProp::VolumeProperties(common.Shape(), shared);
                    if (shared.Mass() > 1e-9) pair.overlapVolume = shared.Mass();
                }
            } catch (const std::exception&) {
                // An unmeasurable overlap is reported as none, never as a guess.
            } catch (...) {
            }
        }
        ++out.pairsEvaluated;
        out.pairs.push_back(pair);
    }

    // ---- 5. how the near bodies line up -------------------------------------
    // Only pairs step 4 actually measured are examined, so this walk inherits its
    // bound from that one and cannot become the expensive half by itself.
    for (const SolidBodyPair& pair : out.pairs) {
        if (out.alignments.size() >= options.maxAlignments) break;
        if (pair.gap > options.contactTolerance) continue;
        std::size_t found = 0;
        for (std::uint32_t fa = 1;
             fa < faceById.size() && found < options.maxAlignmentsPerPair; ++fa) {
            if (out.bodyOfFace[fa] != pair.a) continue;
            for (std::uint32_t fb = 1;
                 fb < faceById.size() && found < options.maxAlignmentsPerPair; ++fb) {
                if (out.bodyOfFace[fb] != pair.b) continue;
                gp_Ax1 axisA;
                gp_Ax1 axisB;
                if (roundFaceAxis(faceById[fa], axisA) && roundFaceAxis(faceById[fb], axisB)) {
                    if (!sameLine(axisA.Direction(), axisB.Direction())) continue;
                    const double off = distanceToAxis(axisA, axisB.Location());
                    if (off > options.contactTolerance) continue;
                    SolidBodyAlignment al;
                    al.kind = BodyAlignmentKind::Concentric;
                    al.a = pair.a;
                    al.b = pair.b;
                    al.faceA = fa;
                    al.faceB = fb;
                    al.deviation = off;
                    al.point[0] = axisA.Location().X();
                    al.point[1] = axisA.Location().Y();
                    al.point[2] = axisA.Location().Z();
                    al.direction[0] = axisA.Direction().X();
                    al.direction[1] = axisA.Direction().Y();
                    al.direction[2] = axisA.Direction().Z();
                    out.alignments.push_back(al);
                    ++found;
                    continue;
                }
                gp_Pln planeA;
                gp_Pln planeB;
                if (flatFacePlane(faceById[fa], planeA) && flatFacePlane(faceById[fb], planeB)) {
                    if (!sameLine(planeA.Axis().Direction(), planeB.Axis().Direction())) continue;
                    const double off = std::fabs(planeA.Distance(planeB.Location()));
                    if (off > options.contactTolerance) continue;
                    // Two faces can share a plane and still be metres apart within
                    // it. The boxes settle that, and they settle it exactly.
                    if (boxGap(boxOf(faceById[fa]), boxOf(faceById[fb])) > options.contactTolerance)
                        continue;
                    SolidBodyAlignment al;
                    al.kind = BodyAlignmentKind::Coplanar;
                    al.a = pair.a;
                    al.b = pair.b;
                    al.faceA = fa;
                    al.faceB = fb;
                    al.deviation = off;
                    al.point[0] = planeA.Location().X();
                    al.point[1] = planeA.Location().Y();
                    al.point[2] = planeA.Location().Z();
                    al.direction[0] = planeA.Axis().Direction().X();
                    al.direction[1] = planeA.Axis().Direction().Y();
                    al.direction[2] = planeA.Axis().Direction().Z();
                    out.alignments.push_back(al);
                    ++found;
                }
            }
        }
    }
    return out;
}

BodyInventory bodyInventory(ShapeHandle body, const BodyInventoryOptions& options) {
    // A handle that does not resolve — or one backed by a faceted result, which
    // has no analytic solid to walk — comes back unanalysed rather than as an
    // exception: the caller is a viewport that must keep drawing either way.
    try {
        return bodyInventory(ShapeRegistry::instance().get(body), options);
    } catch (const std::exception&) {
        return BodyInventory{};
    } catch (...) {
        return BodyInventory{};
    }
}

} // namespace forge
