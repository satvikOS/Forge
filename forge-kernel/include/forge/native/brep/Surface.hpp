// forge/native/brep/Surface.hpp
//
// In-house ANALYTIC SURFACE geometry attached to B-rep Faces — the geometry
// layer that turns the bare topology (Topology.hpp) into a measurable solid
// (KERNEL_INHOUSE_ROADMAP Stage 6 brep/, the OCCT replacement).
//
// ============================ HONESTY (Bible §0/§9) ========================
// This file adds the SURFACE TYPE that a Face's geometry points at. What is
// REAL and VALIDATED here (see test/native/brep/native_primitives_test.cpp):
//
//   * A tagged-union analytic surface: Plane, Cylinder, Cone, Sphere, Torus,
//     plus a Nurbs fallback (reusing brep::NurbsSurface).
//   * For each analytic kind, the exact point S(u,v), the partials dS/du, dS/dv
//     and hence the surface area element |dS/du x dS/dv| and the OUTWARD unit
//     normal — the integrands the divergence-theorem mass integrator needs.
//   * A face is parameterised over a rectangle [u0,u1] x [v0,v1] that is carried
//     by the Face (the trim window), so a planar quad face, a cylinder side, a
//     cone side, a sphere/torus patch are all sampled on their own (u,v) box.
//
// What is explicitly TARGETED (NOT built here):
//   * No general trimmed-NURBS faces with arbitrary inner loops; the trim is a
//     parameter rectangle. (Enough for the canonical primitives.)
//   * No surface-surface intersection / surface fitting (NurbsCalculus/Surfit
//     own adjacent pieces).
//
// Pure C++20, ZERO external deps (stdlib + existing forge native headers). No
// OCCT, no WASM. CONVENTIONS: namespace forge::native::brep.

#ifndef FORGE_NATIVE_BREP_SURFACE_HPP
#define FORGE_NATIVE_BREP_SURFACE_HPP

#include <cstddef>
#include <vector>

#include "forge/native/brep/Nurbs.hpp"          // Vec3, NurbsSurface
#include "forge/native/brep/NurbsSurface.hpp"   // evaluateWithDerivatives

namespace forge {
namespace native {
namespace brep {

// Lightweight 3-vector helpers (kept local so this header is self-sufficient
// over the existing brep::Vec3 POD).
inline Vec3 vadd(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 vsub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 vscale(const Vec3& a, double s)    { return {a.x * s, a.y * s, a.z * s}; }
inline double vdot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 vcross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
double vlen(const Vec3& a);
Vec3   vnorm(const Vec3& a);

// ---------------------------------------------------------------------------
// SurfaceKind — the analytic surface families used by the canonical primitives.
// ---------------------------------------------------------------------------
enum class SurfaceKind {
    Plane,     // origin + normal axis; refDir spans the in-plane u direction
    Cylinder,  // axis line (origin,axis), radius r1; u=angle, v=along axis
    Cone,      // apex/axis cone; r1 = base radius at v=0, r2 at v=1, height in axis
    Sphere,    // centre origin, radius r1
    Torus,     // centre origin, axis; major radius r1, minor radius r2
    Nurbs,     // fallback (ellipsoid, pyramid sides) — exact rational surface
    EllipseExtrusion  // linear extrusion of an ELLIPSE with the extrusion vector
                      // PERPENDICULAR to the ellipse plane (an elliptical cylinder):
                      // origin = ellipse centre, axis = extrusion dir, refDir = major
                      // axis; r1 = semi-major a, r2 = semi-minor b; u = ellipse angle,
                      // v = signed distance along axis. Exact analytic mass path (its
                      // periodic seam is handled by the same angular-unwrap region
                      // integrator as the cylinder — the tensor-NURBS form's point
                      // inversion could not close the seam).
};

// ---------------------------------------------------------------------------
// Surface — a tagged analytic surface. The (axis, refDir) frame is right-handed:
// refDir is the local +X in the surface's plane/equator, (axis x refDir) the +Y.
//
// Parameter conventions (each face also carries its own [u,v] trim rectangle):
//   Plane:    S(u,v) = origin + u*refDir + v*(axis x refDir)
//   Cylinder: S(theta,z) = origin + r1*(cos th * refDir + sin th * binormal)
//                          + z*axis
//   Cone:     S(theta,t)  with radius r(t) = r1 + (r2-r1)*t, along axis*height*t.
//             (height stored in `param`.)
//   Sphere:   S(theta,phi) = origin + r1*(sin phi (cos th refDir + sin th binorm)
//                          + cos phi axis)            phi in [0,pi], theta [0,2pi]
//   Torus:    S(theta,phi) = origin
//                          + (r1 + r2 cos phi)*(cos th refDir + sin th binorm)
//                          + r2 sin phi * axis
// ---------------------------------------------------------------------------
struct Surface {
    SurfaceKind kind = SurfaceKind::Plane;
    Vec3   origin{};                 // plane point / cylinder-base centre / sphere-torus centre / cone base centre
    Vec3   axis{0, 0, 1};            // unit normal (plane) or symmetry axis
    Vec3   refDir{1, 0, 0};          // unit in-plane / equator reference direction
    double r1 = 0.0;                 // plane: unused; cyl/sphere radius; cone base r; torus major R
    double r2 = 0.0;                 // cone top r; torus minor r
    double param = 0.0;              // cone/cylinder height (axis length of the param domain)
    bool   reversed = false;         // flip the computed normal so it points OUT of the solid
    NurbsSurface nurbs;              // valid only when kind == Nurbs

    // EXACT circular-disk annotation for a Plane cap face. When isDisk is true
    // the planar face is the exact annular sector centred on `origin` with
    // outer radius diskOuter, inner radius diskInner (0 for a full disk), spanning
    // the angular trim window in the (refDir,binormal) frame — NOT the chord
    // polygon of its loop vertices. This keeps a curved-primitive's cap boundary
    // consistent with the exact arc boundary of its analytic side (so the closed
    // surface encloses exactly the analytic volume, COM and inertia). The mass
    // integrator integrates this in polar coordinates; tessellation still uses
    // the loop polygon (chordal), which is the intended tessellation tolerance.
    bool   isDisk = false;
    double diskOuter = 0.0;
    double diskInner = 0.0;

    // binormal = axis x refDir (the +Y of the local frame).
    Vec3 binormal() const { return vcross(axis, refDir); }

    // Point S(u,v) on the surface.
    Vec3 evaluate(double u, double v) const;

    // Point + partials dS/du, dS/dv. The unsigned area element is |du x dv|.
    void evaluateDeriv(double u, double v, Vec3& s, Vec3& du, Vec3& dv) const;

    // Outward unit normal at (u,v) (respects `reversed`).
    Vec3 normalAt(double u, double v) const;
};

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_SURFACE_HPP
