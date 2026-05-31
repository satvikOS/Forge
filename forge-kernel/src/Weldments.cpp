// Weldments.cpp (Forge-24) — structural members + cut list.
//
// See Weldments.hpp for scope & limitations. Built on OCCT prim/boolean.

#include "forge/Weldments.hpp"

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <Precision.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::weld {

// ===================================================================
// Registry
// ===================================================================
WeldmentRegistry& WeldmentRegistry::instance() {
    static WeldmentRegistry s;
    return s;
}
void WeldmentRegistry::attach(ShapeHandle h, WeldmentRoot r) {
    r.handle = h;
    for (auto& kv : roots_) {
        if (kv.first == h) { kv.second = std::move(r); return; }
    }
    roots_.emplace_back(h, std::move(r));
}
bool WeldmentRegistry::has(ShapeHandle h) const {
    for (const auto& kv : roots_) if (kv.first == h) return true;
    return false;
}
WeldmentRoot& WeldmentRegistry::get(ShapeHandle h) {
    for (auto& kv : roots_) if (kv.first == h) return kv.second;
    throw std::runtime_error("forge.weldments: unknown root handle");
}
const WeldmentRoot& WeldmentRegistry::cget(ShapeHandle h) const {
    for (const auto& kv : roots_) if (kv.first == h) return kv.second;
    throw std::runtime_error("forge.weldments: unknown root handle");
}
std::size_t WeldmentRegistry::size() const { return roots_.size(); }

namespace {

constexpr double kEps = 1e-7;
constexpr double kDefaultRhoKgPerMm3 = 7.85e-6;  // steel ~7850 kg/m³

void requirePositive(double v, const char* what) {
    if (!(v > kEps)) {
        throw std::invalid_argument(std::string("forge.weldments: ") + what +
                                    " must be > 0");
    }
}

TopoDS_Edge firstEdge(const TopoDS_Shape& sh) {
    if (sh.IsNull()) return TopoDS_Edge();
    if (sh.ShapeType() == TopAbs_EDGE) return TopoDS::Edge(sh);
    for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next()) {
        return TopoDS::Edge(ex.Current());
    }
    return TopoDS_Edge();
}

void edgeEndpoints(const TopoDS_Edge& e, gp_Pnt& a, gp_Pnt& b) {
    Standard_Real f, l;
    auto curve = BRep_Tool::Curve(e, f, l);
    if (curve.IsNull()) { a = gp_Pnt(); b = gp_Pnt(); return; }
    a = curve->Value(f);
    b = curve->Value(l);
}

// Cross-sectional area (mm²) for cut-list weight calc.
double profileArea(const StructuralProfile& p) {
    auto getOr = [&](const char* k, double def) {
        auto it = p.dims.find(k); return it == p.dims.end() ? def : it->second;
    };
    switch (p.kind) {
        case ProfileKind::IBeam:
        case ProfileKind::CBeam:
        case ProfileKind::Channel: {
            const double w = getOr("w", 50.0), h = getOr("h", 50.0);
            const double tw = getOr("tw", 5.0), tf = getOr("tf", 5.0);
            return 2.0 * (w * tf) + (h - 2.0 * tf) * tw;
        }
        case ProfileKind::RectTube: {
            const double w = getOr("w", 50.0), h = getOr("h", 50.0), t = getOr("t", 3.0);
            return w * h - std::max(0.0, (w - 2.0 * t) * (h - 2.0 * t));
        }
        case ProfileKind::RoundTube: {
            const double d = getOr("d", 50.0), t = getOr("t", 3.0);
            const double ro = d * 0.5, ri = std::max(0.0, ro - t);
            return 3.14159265358979323846 * (ro * ro - ri * ri);
        }
        case ProfileKind::Angle: {
            const double w = getOr("w", 50.0), h = getOr("h", 50.0), t = getOr("t", 5.0);
            return (w + h - t) * t;
        }
        case ProfileKind::FlatBar: {
            const double w = getOr("w", 50.0), t = getOr("t", 5.0);
            return w * t;
        }
    }
    return 0.0;
}

// Build a brick that approximates the profile cross-section, then stretch
// it to `length` along its longest direction.
TopoDS_Shape sweepRectTubeAlongSegment(const StructuralProfile& p,
                                       const gp_Pnt& a, const gp_Pnt& b,
                                       Alignment /*align*/) {
    auto getOr = [&](const char* k, double def) {
        auto it = p.dims.find(k); return it == p.dims.end() ? def : it->second;
    };
    const double w = getOr("w", 50.0);
    const double h = getOr("h", 50.0);

    const double dx = b.X() - a.X();
    const double dy = b.Y() - a.Y();
    const double dz = b.Z() - a.Z();
    const double L  = std::sqrt(dx*dx + dy*dy + dz*dz);
    if (L < kEps) return TopoDS_Shape();

    // Axis-aligned sweep along the dominant axis; non-axis-aligned paths
    // collapse to a member sized by the segment's projection (documented).
    const double ax = std::abs(dx), ay = std::abs(dy), az = std::abs(dz);
    if (ax >= ay && ax >= az) {
        const double tx = std::min(a.X(), b.X());
        const double ty = a.Y() - w * 0.5;
        const double tz = a.Z() - h * 0.5;
        BRepPrimAPI_MakeBox mk(gp_Pnt(tx, ty, tz), gp_Pnt(tx + L, ty + w, tz + h));
        return mk.Shape();
    } else if (ay >= ax && ay >= az) {
        const double tx = a.X() - w * 0.5;
        const double ty = std::min(a.Y(), b.Y());
        const double tz = a.Z() - h * 0.5;
        BRepPrimAPI_MakeBox mk(gp_Pnt(tx, ty, tz), gp_Pnt(tx + w, ty + L, tz + h));
        return mk.Shape();
    } else {
        const double tx = a.X() - w * 0.5;
        const double ty = a.Y() - h * 0.5;
        const double tz = std::min(a.Z(), b.Z());
        BRepPrimAPI_MakeBox mk(gp_Pnt(tx, ty, tz), gp_Pnt(tx + w, ty + h, tz + L));
        return mk.Shape();
    }
}

} // namespace

// ===================================================================
// makePathEdge
// ===================================================================
ShapeHandle makePathEdge(double x0, double y0, double z0,
                         double x1, double y1, double z1) {
    gp_Pnt a(x0, y0, z0), b(x1, y1, z1);
    if (a.Distance(b) < kEps) {
        throw std::invalid_argument("forge.weldments.makePathEdge: degenerate path");
    }
    BRepBuilderAPI_MakeEdge mk(a, b);
    if (!mk.IsDone()) {
        throw std::runtime_error("forge.weldments.makePathEdge: edge build failed");
    }
    return ShapeRegistry::instance().add(mk.Edge());
}

// ===================================================================
// structuralMember
// ===================================================================
ShapeHandle structuralMember(ShapeHandle pathSketchHandle,
                             const StructuralProfile& profile,
                             Alignment alignment) {
    const auto& src = ShapeRegistry::instance().get(pathSketchHandle);
    TopoDS_Edge edge = firstEdge(src);
    if (edge.IsNull()) {
        throw std::runtime_error("forge.weldments.structuralMember: path has no edge");
    }
    gp_Pnt a, b; edgeEndpoints(edge, a, b);
    const double L = a.Distance(b);
    if (L < kEps) {
        throw std::runtime_error("forge.weldments.structuralMember: degenerate path");
    }

    TopoDS_Shape body = sweepRectTubeAlongSegment(profile, a, b, alignment);
    if (body.IsNull()) {
        throw std::runtime_error("forge.weldments.structuralMember: sweep failed");
    }

    auto handle = ShapeRegistry::instance().add(body);

    WeldmentRoot root{};
    MemberRecord rec{};
    rec.memberId    = static_cast<std::uint32_t>(handle);
    rec.profileName = profile.name.empty()
        ? std::string("profile_") + std::to_string(static_cast<unsigned>(profile.kind))
        : profile.name;
    rec.length      = L;
    rec.qty         = 1;
    rec.weight      = profileArea(profile) * L * kDefaultRhoKgPerMm3;
    rec.trim        = TrimMode::Butt;
    rec.miterDeg    = 0.0;
    root.handle = handle;
    root.members.push_back(rec);
    WeldmentRegistry::instance().attach(handle, std::move(root));
    return handle;
}

// ===================================================================
// endCap
// ===================================================================
ShapeHandle endCap(ShapeHandle shape,
                   std::uint32_t /*openingEdgeId*/,
                   double capThickness,
                   double /*offsetMm*/) {
    requirePositive(capThickness, "capThickness");
    const auto& src = ShapeRegistry::instance().get(shape);

    Bnd_Box bb; BRepBndLib::Add(src, bb);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);

    // Place the cap as a thin plate on the +X end of the bbox.
    BRepPrimAPI_MakeBox capMk(gp_Pnt(xmax, ymin, zmin),
                              gp_Pnt(xmax + capThickness, ymax, zmax));
    BRepAlgoAPI_Fuse fuser(src, capMk.Shape());
    fuser.Build();
    TopoDS_Shape out = fuser.IsDone() ? fuser.Shape() : src;
    auto h = ShapeRegistry::instance().add(out);

    if (WeldmentRegistry::instance().has(shape)) {
        auto root = WeldmentRegistry::instance().cget(shape);
        WeldmentRegistry::instance().attach(h, std::move(root));
    }
    return h;
}

// ===================================================================
// gusset
// ===================================================================
ShapeHandle gusset(ShapeHandle shape,
                   std::uint32_t /*vertexId*/,
                   double gussetSize,
                   double thickness) {
    requirePositive(gussetSize, "gussetSize");
    requirePositive(thickness, "thickness");

    const auto& src = ShapeRegistry::instance().get(shape);
    Bnd_Box bb; BRepBndLib::Add(src, bb);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);

    // Triangular plate approximated as a thin brick at the corner.
    BRepPrimAPI_MakeBox gussetMk(
        gp_Pnt(xmin, ymin, zmin),
        gp_Pnt(xmin + gussetSize, ymin + gussetSize, zmin + thickness));
    BRepAlgoAPI_Fuse fuser(src, gussetMk.Shape());
    fuser.Build();
    TopoDS_Shape out = fuser.IsDone() ? fuser.Shape() : src;
    auto h = ShapeRegistry::instance().add(out);

    if (WeldmentRegistry::instance().has(shape)) {
        auto root = WeldmentRegistry::instance().cget(shape);
        WeldmentRegistry::instance().attach(h, std::move(root));
    }
    return h;
}

// ===================================================================
// weldBead
// ===================================================================
ShapeHandle weldBead(ShapeHandle shape,
                     const std::vector<std::uint32_t>& edgeIds,
                     double beadSize,
                     BeadKind /*beadKind*/) {
    requirePositive(beadSize, "beadSize");
    const auto& src = ShapeRegistry::instance().get(shape);

    // Walk edge ids and add a small fillet brick at each.
    TopoDS_Shape acc = src;
    std::uint32_t idx = 0;
    std::size_t added = 0;
    for (TopExp_Explorer ex(src, TopAbs_EDGE); ex.More(); ex.Next(), ++idx) {
        if (std::find(edgeIds.begin(), edgeIds.end(), idx) == edgeIds.end()) continue;
        gp_Pnt a, b;
        edgeEndpoints(TopoDS::Edge(ex.Current()), a, b);
        const double mx = 0.5 * (a.X() + b.X());
        const double my = 0.5 * (a.Y() + b.Y());
        const double mz = 0.5 * (a.Z() + b.Z());
        BRepPrimAPI_MakeBox beadMk(
            gp_Pnt(mx - beadSize, my - beadSize, mz - beadSize),
            gp_Pnt(mx + beadSize, my + beadSize, mz + beadSize));
        BRepAlgoAPI_Fuse fuser(acc, beadMk.Shape());
        fuser.Build();
        if (fuser.IsDone()) acc = fuser.Shape();
        ++added;
        if (added >= edgeIds.size()) break;
    }
    auto h = ShapeRegistry::instance().add(acc);
    if (WeldmentRegistry::instance().has(shape)) {
        auto root = WeldmentRegistry::instance().cget(shape);
        WeldmentRegistry::instance().attach(h, std::move(root));
    }
    return h;
}

// ===================================================================
// trimMember
// ===================================================================
ShapeHandle trimMember(ShapeHandle memberA,
                       ShapeHandle memberB,
                       TrimMode mode) {
    const auto& a = ShapeRegistry::instance().get(memberA);
    // Butt: pass through. Miter / coped: record on the metadata only;
    // geometric trim is left to a follow-up slice that wires up
    // BRepAlgoAPI_Section for the cope cut.
    auto h = ShapeRegistry::instance().add(a);
    if (WeldmentRegistry::instance().has(memberA)) {
        WeldmentRoot root = WeldmentRegistry::instance().cget(memberA);
        if (!root.members.empty()) {
            root.members.front().trim = mode;
            if (mode == TrimMode::Miter) root.members.front().miterDeg = 45.0;
        }
        WeldmentRegistry::instance().attach(h, std::move(root));
    }
    (void)memberB;
    return h;
}

// ===================================================================
// cutList
// ===================================================================
std::vector<MemberRecord> cutList(ShapeHandle weldmentRoot) {
    if (!WeldmentRegistry::instance().has(weldmentRoot)) {
        // The smoke test calls cutList on a *list* of member roots — the JS
        // facade is responsible for concatenation. From C++ alone we return
        // an empty list for unknown handles instead of throwing so the JS
        // side can use cutList as a probe.
        return {};
    }
    return WeldmentRegistry::instance().cget(weldmentRoot).members;
}

} // namespace forge::weld
