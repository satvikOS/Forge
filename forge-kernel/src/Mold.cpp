// PUSH-08 — forge::mold tooling implementation (see forge/Mold.hpp).
#include "forge/Mold.hpp"

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <Bnd_Box.hxx>
#include <BRep_Builder.hxx>
#include <GProp_GProps.hxx>
#include <Precision.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Solid.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pln.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::mold {

namespace {

constexpr double kDeg2Rad = 0.017453292519943295; // π / 180
constexpr double kRad2Deg = 57.29577951308232;    // 180 / π

// Surface normal at the parametric centroid of `face`, oriented OUT of
// the solid the face bounds.
//
// OCCT's BRepGProp_Face::Normal already returns an outward-pointing
// normal (it inspects the face's TopAbs_Orientation internally). We do
// NOT need to flip again for TopAbs_REVERSED — empirically verified on
// BRepPrimAPI_MakeBox where the bottom face has TopAbs_REVERSED and
// BRepGProp_Face::Normal returns -Z directly. Only fall back to a sane
// default if OCCT returns a degenerate (zero-length) vector at the
// sample point.
gp_Vec faceOutwardNormal(const TopoDS_Face& face) {
    BRepGProp_Face gp(face);
    Standard_Real u0, u1, v0, v1;
    gp.Bounds(u0, u1, v0, v1);
    if (!std::isfinite(u0) || !std::isfinite(u1) || u1 <= u0) {
        u0 = 0.0; u1 = 1.0;
    }
    if (!std::isfinite(v0) || !std::isfinite(v1) || v1 <= v0) {
        v0 = 0.0; v1 = 1.0;
    }
    const Standard_Real u = 0.5 * (u0 + u1);
    const Standard_Real v = 0.5 * (v0 + v1);
    gp_Pnt p;
    gp_Vec n;
    gp.Normal(u, v, p, n);
    if (n.Magnitude() < Precision::Confusion()) {
        // Degenerate normal — fall back to +Z so the caller still gets a
        // well-defined dot product instead of NaN.
        return gp_Vec(0, 0, 1);
    }
    n.Normalize();
    return n;
}

gp_Pnt faceCentroid(const TopoDS_Face& face) {
    GProp_GProps props;
    BRepGProp::SurfaceProperties(face, props);
    return props.CentreOfMass();
}

gp_Pnt solidCentroid(const TopoDS_Shape& solid) {
    GProp_GProps props;
    BRepGProp::VolumeProperties(solid, props);
    return props.CentreOfMass();
}

// Pick any two orthogonal unit vectors that are perpendicular to `axis`,
// used to build the in-plane extrusion frame for the parting surface.
void orthogonalBasis(const gp_Dir& axis, gp_Vec& u, gp_Vec& v) {
    const gp_Vec z(axis);
    gp_Vec ref = std::abs(z.Z()) < 0.9 ? gp_Vec(0, 0, 1) : gp_Vec(1, 0, 0);
    u = z.Crossed(ref);
    if (u.Magnitude() < Precision::Confusion()) {
        ref = gp_Vec(0, 1, 0);
        u = z.Crossed(ref);
    }
    u.Normalize();
    v = z.Crossed(u);
    v.Normalize();
}

} // namespace

// ---------------------------------------------------------------- draft

std::vector<DraftFace> analyseDraft(const TopoDS_Shape& part,
                                    const gp_Dir&       pullDir,
                                    double              draftThresholdDeg) {
    if (part.IsNull()) {
        throw std::invalid_argument("forge.mold.analyseDraft: part is null");
    }
    if (draftThresholdDeg <= 0.0 || draftThresholdDeg >= 90.0) {
        throw std::invalid_argument(
            "forge.mold.analyseDraft: draftThresholdDeg must be in (0, 90)");
    }

    const double threshRad = draftThresholdDeg * kDeg2Rad;
    const double sinThresh = std::sin(threshRad);
    const gp_Vec pullVec(pullDir);

    std::vector<DraftFace> out;
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(part, TopAbs_FACE, faceMap);
    out.reserve(faceMap.Extent());

    for (int i = 1; i <= faceMap.Extent(); ++i) {
        const TopoDS_Face face = TopoDS::Face(faceMap(i));
        const gp_Vec n = faceOutwardNormal(face);
        const double dot = n.Dot(pullVec);              // n is unit, pull is unit
        const double clipped = std::max(-1.0, std::min(1.0, dot));
        const double angleRad = std::acos(clipped);
        const double angleDeg = angleRad * kRad2Deg;

        DraftFace df{};
        df.face       = face;
        df.angleDeg   = angleDeg;
        df.isPositive = dot >  sinThresh;
        df.isNegative = dot < -sinThresh;
        df.isVertical = std::abs(angleDeg - 90.0) <= draftThresholdDeg;
        out.push_back(df);
    }
    return out;
}

// ---------------------------------------------------------------- parting

PartingResult computeParting(const TopoDS_Shape& part,
                             const gp_Dir&       pullDir) {
    if (part.IsNull()) {
        throw std::invalid_argument("forge.mold.computeParting: part is null");
    }

    const gp_Vec pullVec(pullDir);

    // Map every edge to the faces that share it.
    TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
    TopExp::MapShapesAndAncestors(part, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);

    PartingResult result{};

    for (int i = 1; i <= edgeFaceMap.Extent(); ++i) {
        const TopoDS_Edge edge = TopoDS::Edge(edgeFaceMap.FindKey(i));
        const TopTools_ListOfShape& faces = edgeFaceMap.FindFromIndex(i);
        if (faces.Extent() != 2) {
            // Boundary edges or T-junctions can't define a silhouette flip.
            continue;
        }
        double dots[2] = {0.0, 0.0};
        int    k = 0;
        for (TopTools_ListOfShape::Iterator it(faces); it.More() && k < 2; it.Next(), ++k) {
            const TopoDS_Face f = TopoDS::Face(it.Value());
            const gp_Vec n = faceOutwardNormal(f);
            dots[k] = n.Dot(pullVec);
        }
        // Silhouette: the two faces disagree on whether they face the pull.
        if (dots[0] * dots[1] < 0.0) {
            result.partingLines.push_back(edge);
        }
    }

    if (result.partingLines.empty()) {
        throw std::runtime_error(
            "forge.mold.computeParting: no silhouette edges found "
            "(part may have no draft along pullDir)");
    }

    // Build a rectangular patch in the plane perpendicular to pullDir,
    // sized to fully enclose the part with a generous margin, then
    // extrude it as the parting "surface" (returned as a thin prism so
    // downstream booleans have something solid to bite on).
    gp_Vec uAxis, vAxis;
    orthogonalBasis(pullDir, uAxis, vAxis);

    // Use the part's overall bounding box to size + centre the patch.
    Bnd_Box bb;
    BRepBndLib::Add(part, bb);
    Standard_Real bbMinX, bbMinY, bbMinZ, bbMaxX, bbMaxY, bbMaxZ;
    bb.Get(bbMinX, bbMinY, bbMinZ, bbMaxX, bbMaxY, bbMaxZ);
    const gp_Pnt centre(0.5 * (bbMinX + bbMaxX),
                        0.5 * (bbMinY + bbMaxY),
                        0.5 * (bbMinZ + bbMaxZ));
    const double dx = bbMaxX - bbMinX;
    const double dy = bbMaxY - bbMinY;
    const double dz = bbMaxZ - bbMinZ;
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    const double half = std::max(1.0, diag) * 1.5;

    // Rectangular wire in the (uAxis, vAxis) frame.
    const gp_Pnt p00 = centre.Translated(uAxis * (-half) + vAxis * (-half));
    const gp_Pnt p10 = centre.Translated(uAxis * ( half) + vAxis * (-half));
    const gp_Pnt p11 = centre.Translated(uAxis * ( half) + vAxis * ( half));
    const gp_Pnt p01 = centre.Translated(uAxis * (-half) + vAxis * ( half));

    BRepBuilderAPI_MakeWire rectMk;
    rectMk.Add(BRepBuilderAPI_MakeEdge(p00, p10).Edge());
    rectMk.Add(BRepBuilderAPI_MakeEdge(p10, p11).Edge());
    rectMk.Add(BRepBuilderAPI_MakeEdge(p11, p01).Edge());
    rectMk.Add(BRepBuilderAPI_MakeEdge(p01, p00).Edge());
    if (!rectMk.IsDone()) {
        throw std::runtime_error(
            "forge.mold.computeParting: failed to build parting rectangle wire");
    }

    gp_Pln plane(centre, pullDir);
    BRepBuilderAPI_MakeFace faceMk(plane, rectMk.Wire());
    if (!faceMk.IsDone()) {
        throw std::runtime_error(
            "forge.mold.computeParting: failed to build parting face");
    }

    // Extrude the parting patch a thin slab along the pull direction so
    // BRepAlgoAPI_Splitter has a 3-D tool to work with. The patch is
    // centred on the part's centroid plane; we extrude HALF the slab
    // upward and HALF downward so the tool sits symmetric around the
    // bounding-box equator. Slab total thickness = 1 % of the diag.
    const double slabThk = std::max(1.0, 0.01 * diag);
    // First offset the face downward by slabThk/2 so the extrusion
    // straddles the centre line.
    const gp_Vec halfOffset = gp_Vec(pullVec) * (-0.5 * slabThk);
    gp_Trsf shift;
    shift.SetTranslation(halfOffset);
    BRepBuilderAPI_Transform shiftMk(faceMk.Face(), shift, /*Copy*/ true);
    const TopoDS_Shape shiftedFace = shiftMk.Shape();
    BRepPrimAPI_MakePrism prismMk(shiftedFace,
                                  gp_Vec(pullVec) * slabThk);
    prismMk.Build();
    if (!prismMk.IsDone()) {
        throw std::runtime_error(
            "forge.mold.computeParting: parting surface extrusion failed");
    }

    result.partingSurface = prismMk.Shape();
    return result;
}

// ---------------------------------------------------------------- cavity / core

CavityCoreResult splitCavityCore(const TopoDS_Shape& moldBlock,
                                 const TopoDS_Shape& part,
                                 const TopoDS_Shape& partingSurface) {
    if (moldBlock.IsNull()) {
        throw std::invalid_argument("forge.mold.splitCavityCore: moldBlock is null");
    }
    if (part.IsNull()) {
        throw std::invalid_argument("forge.mold.splitCavityCore: part is null");
    }
    if (partingSurface.IsNull()) {
        throw std::invalid_argument("forge.mold.splitCavityCore: partingSurface is null");
    }

    BRepAlgoAPI_Splitter splitter;
    TopTools_ListOfShape args; args.Append(moldBlock);
    TopTools_ListOfShape tools; tools.Append(partingSurface);
    splitter.SetArguments(args);
    splitter.SetTools(tools);
    splitter.Build();
    if (!splitter.IsDone()) {
        throw std::runtime_error(
            "forge.mold.splitCavityCore: BRepAlgoAPI_Splitter failed");
    }

    // Splitter returns a compound. Walk solids; tag each by Z centroid.
    const TopoDS_Shape split = splitter.Shape();
    TopoDS_Shape upper, lower;
    double upperZ = -1e300, lowerZ = 1e300;
    int solidCount = 0;
    for (TopExp_Explorer ex(split, TopAbs_SOLID); ex.More(); ex.Next()) {
        const TopoDS_Solid s = TopoDS::Solid(ex.Current());
        const double z = solidCentroid(s).Z();
        if (z > upperZ) { upperZ = z; upper = s; }
        if (z < lowerZ) { lowerZ = z; lower = s; }
        ++solidCount;
    }
    if (solidCount < 2 || upper.IsNull() || lower.IsNull()) {
        throw std::runtime_error(
            "forge.mold.splitCavityCore: splitter produced fewer than 2 solids; "
            "parting surface may not fully cross the mould block");
    }

    auto subtractPart = [&](const TopoDS_Shape& half) -> TopoDS_Shape {
        BRepAlgoAPI_Cut cut(half, part);
        cut.Build();
        if (!cut.IsDone()) {
            throw std::runtime_error(
                "forge.mold.splitCavityCore: BRepAlgoAPI_Cut(half - part) failed");
        }
        return cut.Shape();
    };

    CavityCoreResult out;
    out.cavity = subtractPart(upper);
    out.core   = subtractPart(lower);
    return out;
}

// ---------------------------------------------------------------- cooling

TopoDS_Shape insertCoolingChannels(const TopoDS_Shape&                moldBlock,
                                   const std::vector<CoolingChannel>& channels) {
    if (moldBlock.IsNull()) {
        throw std::invalid_argument(
            "forge.mold.insertCoolingChannels: moldBlock is null");
    }
    if (channels.empty()) {
        // No channels — return a copy of the block (semantically a no-op).
        return moldBlock;
    }

    TopoDS_Shape result = moldBlock;
    for (std::size_t i = 0; i < channels.size(); ++i) {
        const CoolingChannel& ch = channels[i];
        if (!(ch.diameter > Precision::Confusion())) {
            throw std::invalid_argument(
                "forge.mold.insertCoolingChannels: channel diameter must be > 0");
        }
        const gp_Vec axis(ch.start, ch.end);
        const double length = axis.Magnitude();
        if (!(length > Precision::Confusion())) {
            throw std::invalid_argument(
                "forge.mold.insertCoolingChannels: channel length must be > 0");
        }
        const gp_Dir dir(axis);
        const gp_Ax2 frame(ch.start, dir);
        // BRepPrimAPI_MakeCylinder is a one-shot algo whose base-class
        // IsDone() returns false until Shape() is queried — calling
        // Shape() triggers Build() and throws StdFail_NotDone on real
        // failure, which propagates through the safe() wrapper.
        BRepPrimAPI_MakeCylinder cylMk(frame, 0.5 * ch.diameter, length);
        const TopoDS_Shape cylinder = cylMk.Shape();
        BRepAlgoAPI_Cut cut(result, cylinder);
        cut.Build();
        if (!cut.IsDone()) {
            throw std::runtime_error(
                "forge.mold.insertCoolingChannels: BRepAlgoAPI_Cut failed");
        }
        result = cut.Shape();
    }
    return result;
}

// ---------------------------------------------------------------- runner

RunnerSystem buildRunnerSystem(const gp_Pnt&              sprueTop,
                               const std::vector<gp_Pnt>& gateEntries,
                               double                     sprueDia,
                               double                     runnerDia,
                               double                     gateDia) {
    if (!(sprueDia > Precision::Confusion())) {
        throw std::invalid_argument(
            "forge.mold.buildRunnerSystem: sprueDia must be > 0");
    }
    if (!(runnerDia > Precision::Confusion())) {
        throw std::invalid_argument(
            "forge.mold.buildRunnerSystem: runnerDia must be > 0");
    }
    if (!(gateDia > Precision::Confusion())) {
        throw std::invalid_argument(
            "forge.mold.buildRunnerSystem: gateDia must be > 0");
    }
    if (gateEntries.empty()) {
        throw std::invalid_argument(
            "forge.mold.buildRunnerSystem: at least one gate entry required");
    }

    RunnerSystem result;

    // Sprue: tapered cone, large end at the top, small end at the bottom.
    // Conventional sprue aspect ratio is 8:1 (length:top-diameter) for
    // typical reciprocating-screw injection moulding nozzles. We build the
    // cone with its base at the small (bottom) radius and its top at the
    // large (top) radius, with the local +Z axis pointing UP from sprueTop
    // ... but MakeCone defines R1 as the base radius at the gp_Ax2 origin
    // and R2 as the top radius at +Z·H, so we point the axis DOWN and let
    // R1 = top dia, R2 = bottom dia × 0.7 trick produce the taper.
    const double sprueLength = 8.0 * sprueDia;
    const double sprueR1 = 0.5 * sprueDia;          // top radius
    const double sprueR2 = 0.7 * 0.5 * sprueDia;    // bottom radius (70 %)
    // gp_Ax2 anchored at sprueTop, axis pointing DOWN (-Z), so the base
    // of the cone (R1) is at sprueTop and the apex direction (R2 at +H)
    // is at sprueTop - sprueLength·Z.
    const gp_Ax2 sprueFrame(sprueTop, gp_Dir(0, 0, -1));
    BRepPrimAPI_MakeCone sprueMk(sprueFrame, sprueR1, sprueR2, sprueLength);
    // Shape() internally triggers Build() and throws StdFail_NotDone on
    // genuine failure (negative radii, zero height etc.); the safe()
    // wrapper surfaces that as a real JS error.
    result.sprue = sprueMk.Shape();

    // Sprue bottom centre — runners radiate from here to each gate.
    const gp_Pnt sprueBottom(sprueTop.X(), sprueTop.Y(),
                             sprueTop.Z() - sprueLength);

    result.runners.reserve(gateEntries.size());
    result.gates.reserve(gateEntries.size());

    for (const gp_Pnt& gateEntry : gateEntries) {
        // Runner: cylinder from sprue bottom to gate entry.
        const gp_Vec runnerAxis(sprueBottom, gateEntry);
        const double runnerLen = runnerAxis.Magnitude();
        if (!(runnerLen > Precision::Confusion())) {
            throw std::invalid_argument(
                "forge.mold.buildRunnerSystem: gate entry coincides with sprue bottom");
        }
        const gp_Dir runnerDir(runnerAxis);
        const gp_Ax2 runnerFrame(sprueBottom, runnerDir);
        BRepPrimAPI_MakeCylinder runnerMk(runnerFrame, 0.5 * runnerDia, runnerLen);
        result.runners.push_back(runnerMk.Shape());

        // Gate: short cylinder of length runnerDia, dia gateDia, axially
        // aligned with the runner, anchored at the gate entry point.
        const double gateLen = runnerDia;
        const gp_Ax2 gateFrame(gateEntry, runnerDir);
        BRepPrimAPI_MakeCylinder gateMk(gateFrame, 0.5 * gateDia, gateLen);
        result.gates.push_back(gateMk.Shape());
    }

    return result;
}

} // namespace forge::mold
