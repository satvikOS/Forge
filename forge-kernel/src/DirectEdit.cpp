#include "forge/DirectEdit.hpp"

#include <cmath>
#include <stdexcept>

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepGProp.hxx>
#include "forge/OcctPrimBuilder.hpp"   // TKPrim-free analytic cylinder + linear sweep
#include <GProp_GProps.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Circle.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Precision.hxx>
#include <TopExp_Explorer.hxx>
#include <gp_Ax1.hxx>
#include <gp_Lin.hxx>
#include <vector>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#ifdef FORGE_NATIVE_BREP
#include <memory>
#include "forge/native/brep/UnifyFaces.hpp"
#include "forge/native/brep/NativeRoute.hpp"      // forgeNativeFeaturesEnabled()
#include "forge/native/brep/NativeShapeHeal.hpp"  // occtheal::finalizeShape (TKShHealing-free light heal)
#endif

namespace forge {
namespace {

TopTools_IndexedMapOfShape faceMap(const TopoDS_Shape& s) {
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, TopAbs_FACE, m);
    return m;
}

TopoDS_Face faceAt(const TopoDS_Shape& s, int index) {
    TopTools_IndexedMapOfShape m = faceMap(s);
    if (index < 1 || index > m.Extent()) {
        throw std::runtime_error("DirectEdit: face index " + std::to_string(index) +
                                 " out of range [1," + std::to_string(m.Extent()) + "]");
    }
    return TopoDS::Face(m.FindKey(index));
}

std::array<double, 3> unit(const std::array<double, 3>& v) {
    const double n = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (n == 0.0) throw std::runtime_error("DirectEdit: zero-length direction");
    return {{v[0] / n, v[1] / n, v[2] / n}};
}

TopoDS_Shape heal(const TopoDS_Shape& s) {
#ifdef FORGE_NATIVE_BREP
    // NATIVE (TKShHealing-free) LIGHT finalize behind the FEAT gate: SameParameter
    // reconcile + outward orient by signed volume + closed-shell->solid promote
    // (occtheal::finalizeShape — surface-preserving, no faceting). This is the
    // load-bearing part of the defensive post-boolean ShapeFix_Shape pass these
    // DirectEdit ops use. The OCCT ShapeFix_Shape path is kept as the #else fallback;
    // GATE DEFAULT OFF (forgeNativeFeaturesEnabled()), so the production build runs the
    // OCCT path byte-for-byte until the FEAT gate is flipped on.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        return forge::occtheal::finalizeShape(s, 0.0, 0.0).shape;
    }
#endif
    ShapeFix_Shape fixer(s);
    fixer.Perform();
    return fixer.Shape();
}

TopoDS_Shape makeCylinder(const std::array<double, 3>& base,
                          const std::array<double, 3>& axis,
                          double radius, double length) {
    const auto a = unit(axis);
    gp_Ax2 ax(gp_Pnt(base[0], base[1], base[2]), gp_Dir(a[0], a[1], a[2]));
    return forge::occtCylinderSolid(ax, radius, length);
}

// ---- unifySameDomain crash guard: the MIXED-REPRESENTATION coaxial bore ----
//
// MEASURED 2026-08-29 (forge-kernel/test/ft_unify_concentric_hole_segv.ir and the
// 20-case sweep in unify_coaxial_guard_test.sh). ShapeUpgrade_UnifySameDomain::
// IntUnifyFaces dereferences a NULL Geom2d_Curve (a pcurve) and SIGSEGVs when the
// shape carries two coaxial, EQUAL-RADIUS, seam-carrying cylindrical walls that are
// STORED DIFFERENTLY -- one an analytic Geom_CylindricalSurface (what HOLE builds)
// and one a Geom_SurfaceOfLinearExtrusion of a circle (what CIRCLE+EXTRUDE+CUT
// leaves behind). OCCT judges the pair same-domain and merges a periodic analytic
// surface with a periodic extrusion surface; the pcurve that merge needs does not
// exist, and the null is produced INSIDE the merge.
//
// The trigger is EXACT radius coincidence and nothing else. On a plate with ONE
// bore: hole radius 4.4950 == the cut's radius -> SIGSEGV; 4.4900 -> ok; 4.5000 ->
// ok; and it crashes again at 5.0 and at 3.0 whenever the two coincide exactly.
// Two coaxial equal-radius ANALYTIC cylinders (HOLE then CUT) merge FINE, so the
// mixed representation is load-bearing, not the coincidence on its own -- which is
// also why the order of the ops matters and the hole COUNT does not.
//
// A pre-check for null pcurves on the INPUT cannot work: the input is clean
// (nullPcurves=0, measured on the crashing shape). So the guard detects the
// CONFIGURATION instead, and where it fires the body is returned UNMERGED. That
// leaves a bore wall split in two, which is a face count we would rather not have.
// It is not a wrong solid, and on exactly these inputs the alternative is a SIGSEGV
// that takes the whole verifier process down.
struct SeamWall {
    TopoDS_Face face;
    gp_Ax1      axis;
    double      radius;
    bool        analytic;  // true = Geom_CylindricalSurface, false = extrusion-of-circle
};

// Collect every full-turn (seam-carrying) cylindrical wall, however it is stored.
std::vector<SeamWall> seamWalls(const TopoDS_Shape& shape) {
    std::vector<SeamWall> out;
    for (TopExp_Explorer fx(shape, TopAbs_FACE); fx.More(); fx.Next()) {
        const TopoDS_Face f = TopoDS::Face(fx.Current());

        // A wall with no seam edge is a partial arc, not the periodic face OCCT
        // merges here, so it cannot be half of the crashing pair.
        bool seam = false;
        for (TopExp_Explorer ex(f, TopAbs_EDGE); ex.More() && !seam; ex.Next()) {
            if (BRep_Tool::IsClosed(TopoDS::Edge(ex.Current()), f)) seam = true;
        }
        if (!seam) continue;

        const Handle(Geom_Surface) srf = BRep_Tool::Surface(f);
        if (srf.IsNull()) continue;

        const Handle(Geom_CylindricalSurface) cyl =
            Handle(Geom_CylindricalSurface)::DownCast(srf);
        if (!cyl.IsNull()) {
            out.push_back({f, cyl->Cylinder().Axis(), cyl->Cylinder().Radius(), true});
            continue;
        }

        const Handle(Geom_SurfaceOfLinearExtrusion) ext =
            Handle(Geom_SurfaceOfLinearExtrusion)::DownCast(srf);
        if (ext.IsNull()) continue;

        Handle(Geom_Curve) basis = ext->BasisCurve();
        for (;;) {
            const Handle(Geom_TrimmedCurve) trimmed =
                Handle(Geom_TrimmedCurve)::DownCast(basis);
            if (trimmed.IsNull()) break;
            basis = trimmed->BasisCurve();
        }
        const Handle(Geom_Circle) circ = Handle(Geom_Circle)::DownCast(basis);
        if (circ.IsNull()) continue;

        // Only an extrusion ALONG the circle's own axis is geometrically a
        // cylinder; a skewed sweep is an oblique tube and never same-domain
        // with an analytic cylinder.
        const gp_Ax1 ax = circ->Circ().Axis();
        if (!ax.Direction().IsParallel(ext->Direction(), Precision::Angular())) continue;
        out.push_back({f, ax, circ->Circ().Radius(), false});
    }
    return out;
}

// The faces of every pair that would make IntUnifyFaces dereference null.
// Non-empty means "do not hand this shape to ShapeUpgrade_UnifySameDomain".
TopTools_MapOfShape mixedCoaxialSameRadiusFaces(const TopoDS_Shape& shape) {
    TopTools_MapOfShape keep;
    const std::vector<SeamWall> w = seamWalls(shape);
    for (std::size_t i = 0; i < w.size(); ++i) {
        for (std::size_t j = i + 1; j < w.size(); ++j) {
            // Same representation is exactly the case that merges correctly.
            if (w[i].analytic == w[j].analytic) continue;
            if (std::fabs(w[i].radius - w[j].radius) > Precision::Confusion()) continue;
            if (!w[i].axis.Direction().IsParallel(w[j].axis.Direction(),
                                                  Precision::Angular())) continue;
            if (gp_Lin(w[i].axis).Distance(w[j].axis.Location()) > Precision::Confusion())
                continue;
            keep.Add(w[i].face);
            keep.Add(w[j].face);
        }
    }
    return keep;
}

} // namespace

ShapeHandle unifyFaces(ShapeHandle body) {
#ifdef FORGE_NATIVE_BREP
    // NATIVE ALTERNATIVE PATH (gated to NativeSolid handles). For a native
    // analytic solid whose ONLY same-domain merges are coplanar planar faces
    // (e.g. a boolean fuse whose seam split the caps into coplanar strips), run
    // the in-house native unifySameDomain — merge coplanar-adjacent faces, drop
    // the shared edges, collapse collinear vertices — WITHOUT the OCCT bridge.
    // Any curved / holed / disk / multi-shell solid is ineligible and falls
    // through to OCCT's ShapeUpgrade_UnifySameDomain below (so the analytic
    // cylinder-strip case and every OCCT-backed handle are unchanged).
    {
        ShapeRegistry& reg = ShapeRegistry::instance();
        if (reg.kindOf(body) == ShapeKind::NativeSolid) {
            const native::brep::Solid& s = reg.getNativeSolid(body);
            if (native::brep::nativeUnifyPlanarEligible(s)) {
                std::shared_ptr<native::brep::TopologyBuilder> owner;
                native::brep::Solid* merged =
                    native::brep::unifySameDomainPlanar(s, owner);
                if (merged) return reg.addNativeSolid(std::move(owner), merged);
                // merged == nullptr: could not merge exactly -> OCCT fallback.
            }
            // ADDITIVE (curved co-cylindrical merge): a native cylinder whose lateral
            // surface was emitted as N angular strips is merged back into ONE periodic
            // cylindrical face IN-HOUSE (no OCCT bridge). Any body that is not a clean
            // single-cylinder (sphere/cone/torus, tube, bored plate, partial cylinder)
            // is ineligible and falls through to OCCT's ShapeUpgrade_UnifySameDomain.
            else if (native::brep::nativeUnifyCurvedEligible(s)) {
                std::shared_ptr<native::brep::TopologyBuilder> owner;
                native::brep::Solid* merged =
                    native::brep::unifySameDomainCurved(s, owner);
                if (merged) return reg.addNativeSolid(std::move(owner), merged);
                // merged == nullptr: could not merge exactly -> OCCT fallback.
            }
            // ADDITIVE (curved co-cylindrical BORE merge, holed-face aware): a bored
            // plate — ONE ruled wall group (the coaxial hole's N strips) + planar caps
            // whose top/bottom carry the bore rim as an inner (hole) loop — merges the
            // strips into ONE periodic wall face IN-HOUSE while copying the holed caps
            // 1:1 (holes preserved). A tube / blind bore / shattered annular cap is
            // ineligible and falls through to OCCT's ShapeUpgrade_UnifySameDomain.
            else if (native::brep::nativeUnifyBoredEligible(s)) {
                std::shared_ptr<native::brep::TopologyBuilder> owner;
                native::brep::Solid* merged =
                    native::brep::unifySameDomainBored(s, owner);
                if (merged) return reg.addNativeSolid(std::move(owner), merged);
                // merged == nullptr: could not merge exactly -> OCCT fallback.
            }
        }
    }
#endif
    const TopoDS_Shape& shape = ShapeRegistry::instance().get(body);
    // See mixedCoaxialSameRadiusFaces: OCCT SIGSEGVs merging this one pair, so a
    // body carrying it is returned UNMERGED rather than crashing the process.
    //
    // Withholding just the offending pair with ShapeUpgrade_UnifySameDomain::
    // KeepShapes -- which would have preserved every other merge in the body -- was
    // implemented and MEASURED: all six crashing cases still SIGSEGV, because
    // IntUnifyFaces still traverses a kept face and still asks it for the pcurve
    // that is not there. KeepShapes prevents a face being merged AWAY; it does not
    // keep the traversal off it. So the whole-shape skip is what is shipped, and
    // the map is kept because it NAMES the pair for any future targeted repair.
    if (!mixedCoaxialSameRadiusFaces(shape).IsEmpty()) return body;
    ShapeUpgrade_UnifySameDomain u(shape, Standard_True, Standard_True, Standard_True);
    u.Build();
    return ShapeRegistry::instance().add(u.Shape());
}

std::vector<FaceInfo> faceInventory(ShapeHandle body) {
    const TopoDS_Shape& shape = ShapeRegistry::instance().get(body);
    TopTools_IndexedMapOfShape m = faceMap(shape);

    std::vector<FaceInfo> out;
    out.reserve(static_cast<std::size_t>(m.Extent()));

    for (int i = 1; i <= m.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(m.FindKey(i));
        BRepAdaptor_Surface ad(f);

        FaceInfo fi;
        fi.index = i;
        fi.concave = (f.Orientation() == TopAbs_REVERSED);
        fi.vMin = ad.FirstVParameter();
        fi.vMax = ad.LastVParameter();

        GProp_GProps props;
        BRepGProp::SurfaceProperties(f, props);
        fi.area = props.Mass();
        const gp_Pnt c = props.CentreOfMass();
        fi.centroid = {{c.X(), c.Y(), c.Z()}};

        switch (ad.GetType()) {
            case GeomAbs_Plane: {
                fi.kind = "plane";
                const gp_Dir d = ad.Plane().Axis().Direction();
                const double s = fi.concave ? -1.0 : 1.0;
                fi.direction = {{s * d.X(), s * d.Y(), s * d.Z()}};
                break;
            }
            case GeomAbs_Cylinder: {
                fi.kind = "cylinder";
                const gp_Cylinder cy = ad.Cylinder();
                const gp_Dir d = cy.Axis().Direction();
                const gp_Pnt p = cy.Axis().Location();
                fi.direction = {{d.X(), d.Y(), d.Z()}};
                fi.axisLocation = {{p.X(), p.Y(), p.Z()}};
                fi.radius = cy.Radius();
                break;
            }
            case GeomAbs_Cone: {
                fi.kind = "cone";
                const gp_Cone co = ad.Cone();
                const gp_Dir d = co.Axis().Direction();
                const gp_Pnt p = co.Axis().Location();
                fi.direction = {{d.X(), d.Y(), d.Z()}};
                fi.axisLocation = {{p.X(), p.Y(), p.Z()}};
                fi.radius = co.RefRadius();
                break;
            }
            case GeomAbs_Sphere:
                fi.kind = "sphere";
                fi.radius = ad.Sphere().Radius();
                break;
            case GeomAbs_Torus: {
                fi.kind = "torus";
                const gp_Torus to = ad.Torus();
                const gp_Dir d = to.Axis().Direction();
                const gp_Pnt p = to.Axis().Location();
                fi.direction = {{d.X(), d.Y(), d.Z()}};
                fi.axisLocation = {{p.X(), p.Y(), p.Z()}};
                fi.radius = to.MajorRadius();
                fi.minorRadius = to.MinorRadius();
                break;
            }
            case GeomAbs_BSplineSurface:        fi.kind = "bspline";    break;
            case GeomAbs_BezierSurface:         fi.kind = "bezier";     break;
            case GeomAbs_SurfaceOfRevolution:   fi.kind = "revolution"; break;
            default:                            fi.kind = "other";      break;
        }
        out.push_back(std::move(fi));
    }
    return out;
}

ShapeHandle defeature(ShapeHandle body, const std::vector<int>& faceIndices) {
    if (faceIndices.empty()) {
        throw std::runtime_error("forge.defeature: no faces given");
    }
    const TopoDS_Shape& shape = ShapeRegistry::instance().get(body);

    TopTools_ListOfShape toRemove;
    for (int idx : faceIndices) toRemove.Append(faceAt(shape, idx));

    BRepAlgoAPI_Defeaturing df;
    df.SetShape(shape);
    df.AddFacesToRemove(toRemove);
    df.SetRunParallel(Standard_True);
    df.Build();
    if (!df.IsDone()) {
        throw std::runtime_error(
            "forge.defeature: OCCT could not heal the wound after removing the "
            "given faces (the neighbours do not extend to a closed solid)");
    }
    return ShapeRegistry::instance().add(df.Shape());
}

ShapeHandle pushPullFace(ShapeHandle body, int faceIndex,
                         const std::array<double, 3>& dir, double distance) {
    if (distance == 0.0) throw std::runtime_error("forge.pushPullFace: distance is zero");

    const TopoDS_Shape& shape = ShapeRegistry::instance().get(body);
    const TopoDS_Face face = faceAt(shape, faceIndex);

    BRepAdaptor_Surface ad(face);
    if (ad.GetType() != GeomAbs_Plane) {
        throw std::runtime_error("forge.pushPullFace: face " + std::to_string(faceIndex) +
                                 " is not planar (it is a " +
                                 faceInventory(body)[faceIndex - 1].kind + ")");
    }

    const auto d = unit(dir);
    const gp_Vec v(d[0] * std::abs(distance), d[1] * std::abs(distance), d[2] * std::abs(distance));
    const TopoDS_Shape prism = occtPrism(face, distance > 0 ? v : -v);

    TopoDS_Shape result;
    if (distance > 0) {
        BRepAlgoAPI_Fuse op(shape, prism);
        op.SetRunParallel(Standard_True);
        op.Build();
        if (!op.IsDone()) throw std::runtime_error("forge.pushPullFace: fuse failed");
        result = op.Shape();
    } else {
        BRepAlgoAPI_Cut op(shape, prism);
        op.SetRunParallel(Standard_True);
        op.Build();
        if (!op.IsDone()) throw std::runtime_error("forge.pushPullFace: cut failed");
        result = op.Shape();
    }
    return ShapeRegistry::instance().add(heal(result));
}

ShapeHandle resizeBore(ShapeHandle body, int faceIndex, double newRadius) {
    if (newRadius <= 0.0) throw std::runtime_error("forge.resizeBore: newRadius must be > 0");

    const TopoDS_Shape& shape = ShapeRegistry::instance().get(body);
    const TopoDS_Face face = faceAt(shape, faceIndex);

    BRepAdaptor_Surface ad(face);
    if (ad.GetType() != GeomAbs_Cylinder) {
        throw std::runtime_error("forge.resizeBore: face " + std::to_string(faceIndex) +
                                 " is not cylindrical");
    }
    const gp_Cylinder cy = ad.Cylinder();
    const double r0 = cy.Radius();
    if (std::abs(r0 - newRadius) < 1e-12) {
        throw std::runtime_error("forge.resizeBore: newRadius equals the current radius");
    }

    const gp_Dir ax = cy.Axis().Direction();
    const gp_Pnt loc = cy.Axis().Location();
    const std::array<double, 3> axis{{ax.X(), ax.Y(), ax.Z()}};

    // Widening CUTS the annulus, so overshooting the openings is free -- the
    // extra ring outside the solid removes nothing. Shrinking FUSES it, and any
    // overshoot welds a protruding lip onto the part: a padded ring on a 10mm
    // through-bore r 8->5 adds pi*(64-25)*2 = 245.04 mm^3 of material that was
    // never there. So the shrink ring must span exactly the bore's own axial
    // extent, with end faces coplanar with the openings.
    const bool widening = newRadius > r0;
    const double pad = widening ? 1.0 : 0.0;
    const double lo = ad.FirstVParameter();
    const double hi = ad.LastVParameter();
    const double length = (hi - lo) + 2.0 * pad;
    const std::array<double, 3> base{{loc.X() + ax.X() * (lo - pad),
                                      loc.Y() + ax.Y() * (lo - pad),
                                      loc.Z() + ax.Z() * (lo - pad)}};

    const double rOuter = std::max(r0, newRadius);
    const double rInner = std::min(r0, newRadius);
    const TopoDS_Shape outer = makeCylinder(base, axis, rOuter, length);
    const TopoDS_Shape inner = makeCylinder(base, axis, rInner, length);

    BRepAlgoAPI_Cut ringOp(outer, inner);
    ringOp.Build();
    if (!ringOp.IsDone()) throw std::runtime_error("forge.resizeBore: annulus construction failed");
    const TopoDS_Shape ring = ringOp.Shape();

    TopoDS_Shape result;
    if (widening) {                       // widen: remove the annulus
        BRepAlgoAPI_Cut op(shape, ring);
        op.SetRunParallel(Standard_True);
        op.Build();
        if (!op.IsDone()) throw std::runtime_error("forge.resizeBore: widen cut failed");
        result = op.Shape();
    } else {                              // shrink: add the annulus back
        BRepAlgoAPI_Fuse op(shape, ring);
        op.SetRunParallel(Standard_True);
        op.Build();
        if (!op.IsDone()) throw std::runtime_error("forge.resizeBore: shrink fuse failed");
        result = op.Shape();
    }
    return ShapeRegistry::instance().add(heal(result));
}

} // namespace forge
