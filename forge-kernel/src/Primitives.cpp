#include "forge/Primitives.hpp"
#include "forge/Booleans.hpp"   // forge::cut for the hollow tube

// IN-HOUSE KERNEL STEP 3a — route the live primitives through forge::native
// behind FORGE_NATIVE_BREP (compile gate) + forgeNativeBrepEnabled() (runtime).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"
#include <memory>
#endif

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepPrimAPI_MakeWedge.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <Precision.hxx>
#include <cmath>
#include <stdexcept>

namespace forge {

namespace {
inline void requirePositive(double v, const char* what) {
    if (!(v > Precision::Confusion())) {
        throw std::invalid_argument(std::string("forge: ") + what +
                                    " must be > Precision::Confusion (1e-7)");
    }
}

#ifdef FORGE_NATIVE_BREP
// Build a native primitive with `fn(factory) -> Solid*` and register it behind a
// shared owner so the JS handle holds an analytic native B-rep solid. Returns
// the registry handle — byte-identical (a JS Number) to the OCCT path.
template <typename Fn>
ShapeHandle registerNative(Fn&& fn) {
    using namespace forge::native::brep;
    auto fac = std::make_shared<SolidFactory>();
    Solid* s = fn(*fac);
    // Wrap the factory's builder lifetime: the SolidFactory owns the
    // TopologyBuilder; we keep the whole factory alive via an aliasing
    // shared_ptr to its builder so the Solid* stays valid in the registry.
    std::shared_ptr<TopologyBuilder> owner(fac, &fac->builder());
    return ShapeRegistry::instance().addNativeSolid(std::move(owner), s);
}
#endif
}

ShapeHandle makeBox(double dx, double dy, double dz) {
    requirePositive(dx, "box.dx");
    requirePositive(dy, "box.dy");
    requirePositive(dz, "box.dz");
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildBox(dx, dy, dz); });
#endif
    BRepPrimAPI_MakeBox mk(dx, dy, dz);
    return ShapeRegistry::instance().add(mk.Shape());
}

ShapeHandle makeCylinder(double r, double h) {
    requirePositive(r, "cylinder.radius");
    requirePositive(h, "cylinder.height");
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildCylinder(r, h); });
#endif
    BRepPrimAPI_MakeCylinder mk(r, h);
    return ShapeRegistry::instance().add(mk.Shape());
}

ShapeHandle makeSphere(double r) {
    requirePositive(r, "sphere.radius");
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildSphere(r); });
#endif
    BRepPrimAPI_MakeSphere mk(r);
    return ShapeRegistry::instance().add(mk.Shape());
}

ShapeHandle makeCone(double r1, double r2, double h) {
    if (r1 < 0 || r2 < 0) {
        throw std::invalid_argument("forge: cone radii must be >= 0");
    }
    requirePositive(h, "cone.height");
    // Equal-radii cone is degenerate at the apex direction; auto-shim to cylinder.
    if (std::abs(r1 - r2) < Precision::Confusion()) {
        return makeCylinder(r1, h);
    }
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildCone(r1, r2, h); });
#endif
    BRepPrimAPI_MakeCone mk(r1, r2, h);
    return ShapeRegistry::instance().add(mk.Shape());
}

ShapeHandle makeTorus(double R, double r) {
    requirePositive(R, "torus.majorR");
    requirePositive(r, "torus.minorR");
    if (r >= R) {
        throw std::invalid_argument("forge: torus.minorR must be < majorR (self-intersecting otherwise)");
    }
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildTorus(R, r); });
#endif
    BRepPrimAPI_MakeTorus mk(R, r);
    return ShapeRegistry::instance().add(mk.Shape());
}

// ----------------------------------------------------------------------------
// Task #16 — canonical solid primitives.
// ----------------------------------------------------------------------------

// Regular n-gon prism: build the closed polygon profile on z=0 centred on the
// Z axis, face it on the XY plane, then linear-extrude +Z by `height`.
// Volume = (1/2)·n·R²·sin(2π/n)·height.  Topology: n side faces + 2 caps = n+2.
ShapeHandle makePrism(int n, double R, double h) {
    if (n < 3) {
        throw std::invalid_argument("forge: prism.nSides must be >= 3");
    }
    requirePositive(R, "prism.circumRadius");
    requirePositive(h, "prism.height");
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildPrism(n, R, h); });
#endif
    BRepBuilderAPI_MakePolygon poly;
    for (int i = 0; i < n; ++i) {
        const double a = 2.0 * M_PI * static_cast<double>(i) / static_cast<double>(n);
        poly.Add(gp_Pnt(R * std::cos(a), R * std::sin(a), 0.0));
    }
    poly.Close();
    if (!poly.IsDone()) {
        throw std::runtime_error("forge: prism profile wire build failed");
    }
    BRepBuilderAPI_MakeFace face(gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), poly.Wire());
    if (!face.IsDone()) {
        throw std::runtime_error("forge: prism base face build failed");
    }
    BRepPrimAPI_MakePrism mk(face.Face(), gp_Vec(0, 0, h));
    return ShapeRegistry::instance().add(mk.Shape());
}

// Right-angular wedge (BRepPrimAPI_MakeWedge): a box dx×dy×dz with the +Y face
// shrunk in X to length `ltx`. Min-corner at the origin (like makeBox).
// Volume = (1/2)·(dx + ltx)·dz·dy  (trapezoid in XZ extruded along Y).
ShapeHandle makeWedge(double dx, double dy, double dz, double ltx) {
    requirePositive(dx, "wedge.dx");
    requirePositive(dy, "wedge.dy");
    requirePositive(dz, "wedge.dz");
    if (ltx < 0.0 || ltx > dx) {
        throw std::invalid_argument("forge: wedge.ltx must be in [0, dx]");
    }
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildWedge(dx, dy, dz, ltx); });
#endif
    BRepPrimAPI_MakeWedge mk(dx, dy, dz, ltx);
    return ShapeRegistry::instance().add(mk.Shape());
}

// Rectangular-base pyramid: base dx×dy centred on the origin (z=0) lofted as a
// ruled solid to a single apex on the +Z axis at `height`.
// Volume = (1/3)·baseArea·height = (1/3)·dx·dy·height.  Topology: 4 tris + base.
ShapeHandle makePyramid(double dx, double dy, double h) {
    requirePositive(dx, "pyramid.dx");
    requirePositive(dy, "pyramid.dy");
    requirePositive(h, "pyramid.height");
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildPyramid(dx, dy, h); });
#endif
    BRepBuilderAPI_MakePolygon base;
    base.Add(gp_Pnt(-dx / 2.0, -dy / 2.0, 0.0));
    base.Add(gp_Pnt(dx / 2.0, -dy / 2.0, 0.0));
    base.Add(gp_Pnt(dx / 2.0, dy / 2.0, 0.0));
    base.Add(gp_Pnt(-dx / 2.0, dy / 2.0, 0.0));
    base.Close();
    if (!base.IsDone()) {
        throw std::runtime_error("forge: pyramid base wire build failed");
    }
    // isSolid=true caps the base + apex so the loft mass-props as a solid;
    // ruled=true gives flat triangular sides (not a smooth B-spline skin).
    BRepOffsetAPI_ThruSections mk(Standard_True, Standard_True, 1e-6);
    mk.AddWire(base.Wire());
    mk.AddVertex(BRepBuilderAPI_MakeVertex(gp_Pnt(0, 0, h)).Vertex());
    mk.Build();
    if (!mk.IsDone()) {
        throw std::runtime_error("forge: pyramid ThruSections build failed");
    }
    return ShapeRegistry::instance().add(mk.Shape());
}

// Ellipsoid: a unit sphere scaled non-uniformly by the diagonal GTrsf
// diag(rx,ry,rz). The result is a genuine closed solid (BRepBuilderAPI_GTransform
// with copy=true rebuilds the geometry). Volume = (4/3)·π·rx·ry·rz.
ShapeHandle makeEllipsoid(double rx, double ry, double rz) {
    requirePositive(rx, "ellipsoid.rx");
    requirePositive(ry, "ellipsoid.ry");
    requirePositive(rz, "ellipsoid.rz");
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildEllipsoid(rx, ry, rz); });
#endif
    BRepPrimAPI_MakeSphere unit(1.0);
    gp_GTrsf g;  // identity; set the linear diagonal (1-indexed rows/cols).
    g.SetValue(1, 1, rx);
    g.SetValue(2, 2, ry);
    g.SetValue(3, 3, rz);
    BRepBuilderAPI_GTransform mk(unit.Shape(), g, Standard_True);
    if (!mk.IsDone()) {
        throw std::runtime_error("forge: ellipsoid GTransform build failed");
    }
    return ShapeRegistry::instance().add(mk.Shape());
}

// Hollow cylinder: outer minus a coaxial inner cylinder. Both are base-at-origin
// along +Z, so they are already coaxial — no translate needed.
// Volume = π·(rOuter² − rInner²)·height.
ShapeHandle makeTube(double rO, double rI, double h) {
    requirePositive(rO, "tube.rOuter");
    requirePositive(rI, "tube.rInner");
    requirePositive(h, "tube.height");
    if (rI >= rO) {
        throw std::invalid_argument("forge: tube.rInner must be < rOuter");
    }
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled())
        return registerNative([&](native::brep::SolidFactory& f){ return f.buildTube(rO, rI, h); });
#endif
    return cut(makeCylinder(rO, h), makeCylinder(rI, h));
}

} // namespace forge
