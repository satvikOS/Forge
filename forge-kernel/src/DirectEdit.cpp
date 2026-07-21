#include "forge/DirectEdit.hpp"

#include <cmath>
#include <stdexcept>

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GProp_GProps.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
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
    ShapeFix_Shape fixer(s);
    fixer.Perform();
    return fixer.Shape();
}

TopoDS_Shape makeCylinder(const std::array<double, 3>& base,
                          const std::array<double, 3>& axis,
                          double radius, double length) {
    const auto a = unit(axis);
    gp_Ax2 ax(gp_Pnt(base[0], base[1], base[2]), gp_Dir(a[0], a[1], a[2]));
    return BRepPrimAPI_MakeCylinder(ax, radius, length).Shape();
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
    const TopoDS_Shape prism = BRepPrimAPI_MakePrism(face, distance > 0 ? v : -v).Shape();

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
