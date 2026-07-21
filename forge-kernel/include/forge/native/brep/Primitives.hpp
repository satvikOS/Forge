// forge/native/brep/Primitives.hpp
//
// In-house canonical PRIMITIVE SOLID builders for the Forge native B-rep kernel
// (KERNEL_INHOUSE_ROADMAP Stage 6 brep/, the OCCT replacement). Each builder
// emits a closed, oriented 2-manifold brep::Solid with an analytic Surface on
// every face where the geometry is a quadric (plane/cylinder/cone/sphere/torus),
// falling back to an exact rational NurbsSurface only where a quadric does not
// describe the face (ellipsoid skin, pyramid skin).
//
// ============================ HONESTY (Bible §0/§9) ========================
// PLACEMENT matches OCCT BRepPrimAPI 1:1 so the native numbers can be compared
// like-for-like with src/Primitives.cpp + src/MassProps.cpp:
//   * box      : min-corner at origin, spans [0,dx] x [0,dy] x [0,dz]
//   * cylinder : axis +Z, base circle on z=0, top on z=h
//   * cone     : axis +Z, base r1 on z=0, top r2 on z=h (frustum) / apex if r2=0
//   * sphere   : centred at origin, radius r
//   * torus    : centred at origin, axis +Z, major R in the XY plane, minor r
//   * prism    : regular n-gon, circumradius R centred on Z, z in [0,h]
//   * wedge    : min-corner at origin (OCCT MakeWedge), +Y face shrunk to ltx in X
//   * pyramid  : rectangular base dx x dy centred on origin at z=0, apex at z=h
//   * ellipsoid: unit sphere scaled by diag(rx,ry,rz), centred at origin
//   * tube     : hollow cylinder, outer rO inner rI, axis +Z, z in [0,h]
//
// Curved sides (cylinder/cone/sphere/torus/tube) are FACETED into angular
// sectors: each sector is its OWN face carrying a trim window over the SAME
// exact analytic surface. The geometry per face is therefore exact (it IS the
// quadric); only the parameter domain is subdivided, so the divergence-theorem
// mass integral over the union of trim windows recovers the exact whole-surface
// integral, and the tessellation refines each analytic face to a chord
// tolerance. This is faceted TOPOLOGY over EXACT analytic GEOMETRY — stated
// plainly, not overclaimed.
//
// Pure C++20, ZERO external deps (stdlib + forge native headers). No OCCT/WASM.

#ifndef FORGE_NATIVE_BREP_PRIMITIVES_HPP
#define FORGE_NATIVE_BREP_PRIMITIVES_HPP

#include <array>
#include <vector>

#include "forge/native/brep/Topology.hpp"

namespace forge {
namespace native {
namespace brep {

// Faceting resolution for the curved primitives. The MASS PROPERTIES are exact
// regardless of nSeg (analytic per-face integrand + Gauss quadrature), so nSeg
// only governs the tessellation chord error and the face count. Default 64 is a
// good balance for the gate.
struct PrimitiveOptions {
    int nSeg = 128;  // angular sectors (theta) for cylinder/cone/sphere/torus/tube
    int nBand = 64;  // latitude bands (phi) for sphere/torus
};

// SolidFactory wraps a TopologyBuilder and stamps the canonical primitives onto
// it. The factory OWNS the topology+surfaces it creates (via the builder); the
// returned Solid* is a non-owning view valid for the factory's lifetime.
class SolidFactory {
public:
    explicit SolidFactory(PrimitiveOptions opt = {}) : opt_(opt) {}

    TopologyBuilder& builder() { return tb_; }
    const TopologyBuilder& builder() const { return tb_; }

    // --- analytic primitives (planar + quadric faces) ---------------------
    Solid* buildBox(double dx, double dy, double dz);
    Solid* buildCylinder(double r, double h);
    Solid* buildCone(double r1, double r2, double h);   // frustum; r2==0 -> apex cone
    Solid* buildSphere(double r);
    Solid* buildTorus(double R, double r);
    Solid* buildPrism(int n, double R, double h);
    Solid* buildWedge(double dx, double dy, double dz, double ltx);
    Solid* buildTube(double rO, double rI, double h);

    // --- NURBS-skin primitives (no single quadric describes the side) ------
    Solid* buildPyramid(double dx, double dy, double h);  // planar skin via planar faces
    Solid* buildEllipsoid(double rx, double ry, double rz); // NURBS skin

    // --- analytic SWEPT solids (linear extrude + rotational revolve) -------
    //
    // ADDITIVE analytic replacements for OCCT BRepPrimAPI_MakePrism / MakeRevol.
    // Both return a REAL analytic brep::Solid (not a mesh): every face carries an
    // exact Plane / Cylinder / Cone Surface, so massProperties() is exact. They
    // are NEW entry points — no existing primitive/feature path calls them, so the
    // production default is byte-identical (Bible §0/§9). On a case they cannot do
    // analytically yet they DECLINE (return nullptr) — never a fake result.

    // PRISM / linear extrude: extrude the planar polygon `profile` (sketch (x,y)
    // in the Z=0 plane; simple, any winding — reoriented CCW internally) along the
    // vector (vx,vy,vz). Side faces are planar parallelograms (one per profile
    // edge); the two caps are the profile at z=0 and z=vz. Placement matches OCCT
    // BRepPrimAPI_MakePrism(faceOnZ0, gp_Vec(vx,vy,vz)) 1:1. All-planar => EXACT
    // analytic solid, so a non-convex (L / T / U) profile integrates exactly. The
    // profile normal is +Z, so a non-zero out-of-plane component is required:
    // returns nullptr on |vz| ~ 0, a degenerate/zero-area profile, or < 3 points.
    Solid* buildPrismFromProfile(const std::vector<std::array<double, 2>>& profile,
                                 double vx, double vy, double vz);

    // REVOLVE / rotational sweep: rotate the closed planar polygon `profileRZ`
    // (points (r,z), r >= 0, simple, reoriented CCW in the (r,z) half-plane) about
    // the +Z axis through `angleRad` (0 < angle <= 2*pi). Each profile edge sweeps
    // an analytic face: a segment at constant r -> CYLINDER, at constant z -> a
    // PLANAR annulus / disk, otherwise -> CONE (frustum, or apex where r hits 0).
    // A segment lying on the axis (both r == 0) contributes no face. A partial
    // angle additionally emits the two planar end-wall faces (the profile cross
    // section) that close the pie. Placement matches OCCT BRepPrimAPI_MakeRevol(
    // faceInXZhalfPlane, gp::OZ(), angle) 1:1. Faceted TOPOLOGY over EXACT analytic
    // GEOMETRY: mass is exact regardless of the angular segment count. Returns
    // nullptr on a degenerate/zero-area profile, < 3 points, or a non-positive /
    // over-full angle.
    Solid* buildRevolveProfile(const std::vector<std::array<double, 2>>& profileRZ,
                               double angleRad);

private:
    PrimitiveOptions opt_;
    TopologyBuilder tb_;
};

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_PRIMITIVES_HPP
