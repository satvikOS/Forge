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
#include "forge/OcctPrimBuilder.hpp"   // TKPrim-free analytic cone + cylinder + linear sweep
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Solid.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pln.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

// K6 (OCCT-zero migration): all point / vector / direction arithmetic in this
// module now runs on the in-house native forge::native::brep::Vec3 (NVec3) via
// the small algebra helpers in the anonymous namespace below. OCCT gp_ types
// are constructed ONLY at the thin boundary where a BRep builder / gp_ frame
// (gp_Ax2 / gp_Pln / gp_Trsf / edge / face / prism / cone / cylinder builders)
// must be fed, and any OCCT query result (surface normal, centroid) is read
// straight back into NVec3 for the downstream math. This drops the module's
// direct gp_Vec / gp_Dir / gp_Pnt ALGEBRA (and <Precision.hxx>) onto the native
// substrate, matching the Airfoil.cpp K6-seed pattern. gp_ still appears at the
// builder boundary because the ShapeRegistry stores TopoDS_Shape and the
// primitive/boolean builders are K2/K3 territory (not yet native).
#include "forge/native/brep/Nurbs.hpp"   // forge::native::brep::Vec3 (dependency-free)
#include "forge/native/brep/FaceNormal.hpp"  // native BRepGProp_Face::Normal/Bounds replacement

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::mold {

namespace {

constexpr double kDeg2Rad = 0.017453292519943295; // π / 180
constexpr double kRad2Deg = 57.29577951308232;    // 180 / π

// OCCT's Precision::Confusion() is 1.0e-7; expressed here as a native constant
// so this translation unit no longer pulls in <Precision.hxx>.
constexpr double kConfusion = 1.0e-7;

// ---------------------------------------------------------------------------
// K6 native vector substrate — the OCCT-free replacement for this module's
// gp_Vec / gp_Dir / gp_Pnt arithmetic. NVec3 is the in-house B-rep Euclidean
// point (forge::native::brep::Vec3). The free functions below are the minimal
// affine/linear algebra the mould-tooling math needs; gp_ conversions live in
// the tiny to*/toN helpers and are used ONLY at the OCCT builder boundary.
// ---------------------------------------------------------------------------
using NVec3 = forge::native::brep::Vec3;

inline NVec3 nAdd(const NVec3& a, const NVec3& b)   { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline NVec3 nSub(const NVec3& a, const NVec3& b)   { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline NVec3 nScale(const NVec3& a, double s)       { return {a.x * s, a.y * s, a.z * s}; }
inline double nDot(const NVec3& a, const NVec3& b)  { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline NVec3 nCross(const NVec3& a, const NVec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double nMag(const NVec3& a) { return std::sqrt(nDot(a, a)); }
inline NVec3  nNormalize(const NVec3& a) {
    const double m = nMag(a);
    return (m > 0.0) ? nScale(a, 1.0 / m) : a;
}

// Boundary conversions (OCCT <-> native). Used ONLY where a gp_ value must be
// handed to an OCCT builder / frame, or an OCCT query result read back native.
inline NVec3  toN(const gp_Pnt& p) { return {p.X(), p.Y(), p.Z()}; }
inline NVec3  toN(const gp_Vec& v) { return {v.X(), v.Y(), v.Z()}; }
inline NVec3  toN(const gp_Dir& d) { return {d.X(), d.Y(), d.Z()}; }
inline gp_Pnt toPnt(const NVec3& v) { return gp_Pnt(v.x, v.y, v.z); }
inline gp_Vec toVec(const NVec3& v) { return gp_Vec(v.x, v.y, v.z); }
inline gp_Dir toDir(const NVec3& v) { return gp_Dir(v.x, v.y, v.z); }

// Surface normal at the parametric centroid of `face`, oriented OUT of
// the solid the face bounds, returned as a native unit NVec3.
//
// faceOrientedNormal (native BRepGProp_Face::Normal replacement) already
// returns an outward-pointing normal — it folds in the face's
// TopAbs_Orientation (S_u x S_v, reversed when REVERSED), exactly as OCCT
// did. We do NOT flip again for TopAbs_REVERSED — empirically verified on
// BRepPrimAPI_MakeBox where the bottom face is TopAbs_REVERSED and the
// oriented normal is -Z directly. Only fall back to a sane default if the
// normal is degenerate (zero-length) at the sample point. The gp_Vec/gp_Pnt
// out-params are read into NVec3 immediately; all magnitude/normalise math
// is native.
NVec3 faceOutwardNormal(const TopoDS_Face& face) {
    Standard_Real u0, u1, v0, v1;
    forge::native::brep::faceUVBounds(face, u0, u1, v0, v1);
    if (!std::isfinite(u0) || !std::isfinite(u1) || u1 <= u0) {
        u0 = 0.0; u1 = 1.0;
    }
    if (!std::isfinite(v0) || !std::isfinite(v1) || v1 <= v0) {
        v0 = 0.0; v1 = 1.0;
    }
    const Standard_Real u = 0.5 * (u0 + u1);
    const Standard_Real v = 0.5 * (v0 + v1);
    gp_Pnt p;   // surface-point out-param, discarded (as with the OCCT out-param)
    gp_Vec n;
    forge::native::brep::faceOrientedNormal(face, u, v, p, n);
    const NVec3 nn = toN(n);            // read the oriented normal into native at once
    if (nMag(nn) < kConfusion) {
        // Degenerate normal — fall back to +Z so the caller still gets a
        // well-defined dot product instead of NaN.
        return NVec3{0.0, 0.0, 1.0};
    }
    return nNormalize(nn);
}

NVec3 solidCentroid(const TopoDS_Shape& solid) {
    GProp_GProps props;
    BRepGProp::VolumeProperties(solid, props);
    return toN(props.CentreOfMass());
}

// Pick any two orthogonal unit vectors that are perpendicular to `axis`,
// used to build the in-plane extrusion frame for the parting surface.
// Fully native — the former gp_Vec cross/normalise version, unchanged in
// behaviour.
void orthogonalBasis(const NVec3& axis, NVec3& u, NVec3& v) {
    const NVec3 z = axis;
    NVec3 ref = (std::abs(z.z) < 0.9) ? NVec3{0.0, 0.0, 1.0}
                                      : NVec3{1.0, 0.0, 0.0};
    u = nCross(z, ref);
    if (nMag(u) < kConfusion) {
        ref = NVec3{0.0, 1.0, 0.0};
        u = nCross(z, ref);
    }
    u = nNormalize(u);
    v = nNormalize(nCross(z, u));
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
    const NVec3  pullVec   = toN(pullDir);    // pullDir is unit (gp_Dir)

    std::vector<DraftFace> out;
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(part, TopAbs_FACE, faceMap);
    out.reserve(faceMap.Extent());

    for (int i = 1; i <= faceMap.Extent(); ++i) {
        const TopoDS_Face face = TopoDS::Face(faceMap(i));
        const NVec3 n = faceOutwardNormal(face);
        const double dot = nDot(n, pullVec);            // n is unit, pull is unit
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

    const NVec3 pullVec = toN(pullDir);

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
            const NVec3 n = faceOutwardNormal(f);
            dots[k] = nDot(n, pullVec);
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
    NVec3 uAxis, vAxis;
    orthogonalBasis(pullVec, uAxis, vAxis);

    // Use the part's overall bounding box to size + centre the patch.
    Bnd_Box bb;
    BRepBndLib::Add(part, bb);
    Standard_Real bbMinX, bbMinY, bbMinZ, bbMaxX, bbMaxY, bbMaxZ;
    bb.Get(bbMinX, bbMinY, bbMinZ, bbMaxX, bbMaxY, bbMaxZ);
    const NVec3 centre{0.5 * (bbMinX + bbMaxX),
                       0.5 * (bbMinY + bbMaxY),
                       0.5 * (bbMinZ + bbMaxZ)};
    const double dx = bbMaxX - bbMinX;
    const double dy = bbMaxY - bbMinY;
    const double dz = bbMaxZ - bbMinZ;
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    const double half = std::max(1.0, diag) * 1.5;

    // Rectangular wire in the (uAxis, vAxis) frame — corners computed natively,
    // converted to gp_Pnt only at the edge builder.
    const NVec3 p00 = nAdd(centre, nAdd(nScale(uAxis, -half), nScale(vAxis, -half)));
    const NVec3 p10 = nAdd(centre, nAdd(nScale(uAxis,  half), nScale(vAxis, -half)));
    const NVec3 p11 = nAdd(centre, nAdd(nScale(uAxis,  half), nScale(vAxis,  half)));
    const NVec3 p01 = nAdd(centre, nAdd(nScale(uAxis, -half), nScale(vAxis,  half)));

    BRepBuilderAPI_MakeWire rectMk;
    rectMk.Add(BRepBuilderAPI_MakeEdge(toPnt(p00), toPnt(p10)).Edge());
    rectMk.Add(BRepBuilderAPI_MakeEdge(toPnt(p10), toPnt(p11)).Edge());
    rectMk.Add(BRepBuilderAPI_MakeEdge(toPnt(p11), toPnt(p01)).Edge());
    rectMk.Add(BRepBuilderAPI_MakeEdge(toPnt(p01), toPnt(p00)).Edge());
    if (!rectMk.IsDone()) {
        throw std::runtime_error(
            "forge.mold.computeParting: failed to build parting rectangle wire");
    }

    gp_Pln plane(toPnt(centre), pullDir);
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
    // straddles the centre line (native offset vector -> gp_Vec at gp_Trsf).
    const NVec3 halfOffset = nScale(pullVec, -0.5 * slabThk);
    gp_Trsf shift;
    shift.SetTranslation(toVec(halfOffset));
    BRepBuilderAPI_Transform shiftMk(faceMk.Face(), shift, /*Copy*/ true);
    const TopoDS_Shape shiftedFace = shiftMk.Shape();
    // TKPrim-free linear sweep (Geom_SurfaceOfLinearExtrusion + caps, OcctPrimBuilder).
    result.partingSurface = occtPrism(shiftedFace, toVec(nScale(pullVec, slabThk)));
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
        const double z = solidCentroid(s).z;
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
        if (!(ch.diameter > kConfusion)) {
            throw std::invalid_argument(
                "forge.mold.insertCoolingChannels: channel diameter must be > 0");
        }
        const NVec3 axis = nSub(toN(ch.end), toN(ch.start));
        const double length = nMag(axis);
        if (!(length > kConfusion)) {
            throw std::invalid_argument(
                "forge.mold.insertCoolingChannels: channel length must be > 0");
        }
        // Native direction, converted to gp_Dir only for the gp_Ax2 frame.
        const gp_Ax2 frame(ch.start, toDir(nNormalize(axis)));
        // BRepPrimAPI_MakeCylinder is a one-shot algo whose base-class
        // IsDone() returns false until Shape() is queried — calling
        // Shape() triggers Build() and throws StdFail_NotDone on real
        // failure, which propagates through the safe() wrapper.
        const TopoDS_Shape cylinder = forge::occtCylinderSolid(frame, 0.5 * ch.diameter, length);
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
    if (!(sprueDia > kConfusion)) {
        throw std::invalid_argument(
            "forge.mold.buildRunnerSystem: sprueDia must be > 0");
    }
    if (!(runnerDia > kConfusion)) {
        throw std::invalid_argument(
            "forge.mold.buildRunnerSystem: runnerDia must be > 0");
    }
    if (!(gateDia > kConfusion)) {
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
    const gp_Ax2 sprueFrame(sprueTop, toDir(NVec3{0.0, 0.0, -1.0}));
    // TKPrim-free: Geom_ConicalSurface lateral + planar caps (OcctPrimBuilder),
    // matching BRepPrimAPI_MakeCone(sprueFrame, R1, R2, len) 1:1 (base R1 at the
    // frame origin, top R2 at +len·axis). Throws on degenerate input via safe().
    result.sprue = forge::occtConeSolid(sprueFrame, sprueR1, sprueR2, sprueLength);

    // Sprue bottom centre — runners radiate from here to each gate. Computed
    // natively (sprueTop shifted down by sprueLength), converted to gp_Pnt at
    // the gp_Ax2 frame boundary.
    const NVec3 sprueBottom = nSub(toN(sprueTop), NVec3{0.0, 0.0, sprueLength});

    result.runners.reserve(gateEntries.size());
    result.gates.reserve(gateEntries.size());

    for (const gp_Pnt& gateEntry : gateEntries) {
        // Runner: cylinder from sprue bottom to gate entry (native axis math).
        const NVec3 runnerAxis = nSub(toN(gateEntry), sprueBottom);
        const double runnerLen = nMag(runnerAxis);
        if (!(runnerLen > kConfusion)) {
            throw std::invalid_argument(
                "forge.mold.buildRunnerSystem: gate entry coincides with sprue bottom");
        }
        const gp_Dir runnerDir = toDir(nNormalize(runnerAxis));
        const gp_Ax2 runnerFrame(toPnt(sprueBottom), runnerDir);
        result.runners.push_back(forge::occtCylinderSolid(runnerFrame, 0.5 * runnerDia, runnerLen));

        // Gate: short cylinder of length runnerDia, dia gateDia, axially
        // aligned with the runner, anchored at the gate entry point.
        const double gateLen = runnerDia;
        const gp_Ax2 gateFrame(gateEntry, runnerDir);
        result.gates.push_back(forge::occtCylinderSolid(gateFrame, 0.5 * gateDia, gateLen));
    }

    return result;
}

} // namespace forge::mold
