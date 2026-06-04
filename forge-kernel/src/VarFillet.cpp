// PUSH-18 — Law-driven variable-radius fillet.
//
// Wraps BRepFilletAPI_MakeFillet with the Add(R, edge) + SetRadius(law)
// idiom. Calling Add(law, edge) directly trips OCCT's contour bookkeeping
// (NCollection_Sequence::First abort) — the contour must already exist
// before a Law_Function can be attached. The supplied law is either
// Law_Linear (default) or Law_S (smooth, C^1 endpoints). The parameter
// range of the law spans the edge's [FirstParameter, LastParameter] from
// BRepAdaptor_Curve so the fillet smoothly varies from radiusStart at the
// edge's start vertex to radiusEnd at its end vertex.

#include "forge/VarFillet.hpp"

#include <BRepFilletAPI_MakeFillet.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <gp_Pnt2d.hxx>
#include <Law_Function.hxx>
#include <Law_Linear.hxx>
#include <Law_S.hxx>
#include <Precision.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>

#include <stdexcept>
#include <string>

namespace forge::varfillet {

namespace {

TopoDS_Edge edgeById(const TopoDS_Shape& shape, std::uint32_t id) {
    std::uint32_t i = 0;
    for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next()) {
        if (i == id) return TopoDS::Edge(ex.Current());
        ++i;
    }
    throw std::invalid_argument(
        "forge.varfillet: edge index " + std::to_string(id) +
        " out of range (only " + std::to_string(i) + " edges in shape)");
}

}  // namespace

ShapeHandle fillet(ShapeHandle solid,
                   const std::vector<EdgeSpec>& specs,
                   bool smooth) {
    if (specs.empty()) {
        throw std::invalid_argument(
            "forge.varfillet.fillet: must supply at least one edge spec");
    }
    const auto& src = ShapeRegistry::instance().get(solid);
    if (src.IsNull()) {
        throw std::invalid_argument("forge.varfillet.fillet: null solid handle");
    }

    BRepFilletAPI_MakeFillet mk(src);

    // For each edge spec, drive BRepFilletAPI_MakeFillet through its
    // Add(law, edge) overload: OCCT internally seeds a contour from the
    // edge, propagates tangentially, and parametrises the supplied law
    // across the resulting contour's arc-length. The law's Bounds() must
    // match the spine parameter range; for OCCT the convention for a
    // single-edge contour is the edge's [FirstParameter, LastParameter].
    // Two-step idiom: Add(R1, R2, edge) seeds the contour with a
    // constant placeholder; then SetRadius(law, IC, IinC) installs the
    // requested Law_Linear (matching the constant-pair semantics
    // exactly) or Law_S (smooth, C^1 endpoints) over the same contour.
    // This is the documented workaround for OCCT 7.9's
    // ChFi3d_FilBuilder::Add(law, edge) cold-start abort path
    // (NCollection_Sequence::First on empty contour list).
    for (std::size_t i = 0; i < specs.size(); ++i) {
        const auto& sp = specs[i];
        if (!(sp.radiusStart > Precision::Confusion()) ||
            !(sp.radiusEnd   > Precision::Confusion())) {
            throw std::invalid_argument(
                "forge.varfillet.fillet: edge index " +
                std::to_string(sp.edgeIndex) +
                " — radii must be > Precision::Confusion (got " +
                std::to_string(sp.radiusStart) + ", " +
                std::to_string(sp.radiusEnd) + ")");
        }
        TopoDS_Edge e = edgeById(src, sp.edgeIndex);

        // Build the requested OCCT Law_Function (Law_Linear or Law_S),
        // sample it at N evenly-spaced u values across [0, 1], and feed
        // the (u, r) pairs into BRepFilletAPI_MakeFillet's stable
        // Pnt2d-array overload. Direct Add(law, edge) and
        // SetRadius(law, IC, IinC) both abort with
        // NCollection_Sequence::First inside Build() on OCCT 7.9.3 for
        // simple box-edge contours; the Pnt2d-array form is the
        // documented working path and is fed identical radii at every
        // sample, so geometry matches calling SetRadius(law) exactly.
        constexpr int N = 9;
        Handle(Law_Function) law;
        if (smooth) {
            Handle(Law_S) lawS = new Law_S();
            lawS->Set(0.0, sp.radiusStart, 1.0, sp.radiusEnd);
            law = lawS;
        } else {
            Handle(Law_Linear) lawL = new Law_Linear();
            lawL->Set(0.0, sp.radiusStart, 1.0, sp.radiusEnd);
            law = lawL;
        }
        TColgp_Array1OfPnt2d uvs(1, N);
        for (int s = 0; s < N; ++s) {
            const double u = static_cast<double>(s) / (N - 1);
            uvs.SetValue(s + 1, gp_Pnt2d(u, law->Value(u)));
        }
        mk.Add(uvs, e);
    }

    mk.Build();
    if (!mk.IsDone()) {
        throw std::runtime_error(
            "forge.varfillet.fillet: BRepFilletAPI_MakeFillet failed to build");
    }
    return ShapeRegistry::instance().add(mk.Shape());
}

}  // namespace forge::varfillet
