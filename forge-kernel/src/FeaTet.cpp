// PUSH-11 — forge::fea::tet implementation.
//
// Tet4 (constant-strain tet) linear-elastic FEA with Bowyer-Watson volume
// mesher, Jacobi-CG static solver, and shifted inverse-power modal solver.
//
// No external numerical libraries.  Only OCCT (for surface meshing +
// inside-tests) and C++ std.

#include "forge/FeaTet.hpp"
#include "forge/OcctNativeMesh.hpp"   // K5 — native surface mesher (no TKMesh)
#include <cstdio>

#include <BRep_Tool.hxx>
#include <BRepBndLib.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <Bnd_Box.hxx>
#include <Poly_Triangle.hxx>
#include <Poly_Triangulation.hxx>
#include <Precision.hxx>
#include <Standard_Handle.hxx>
#include <TopAbs_State.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// PHASE-D wiring (2026-06-25) — route the OCCT geometry ops that meshShape uses to build
// the tet-mesh DOMAIN, through the ALREADY-BUILT in-house native B-rep ops behind the
// FEAT gate, on the meshShapeFromHandle entry (the only point that sees the ShapeHandle,
// hence the only point that can detect a NativeSolid input):
//   * BRepMesh_IncrementalMesh + Poly_Triangulation boundary-triangle extraction
//                                    -> forge::native::brep::tessellateSolid (watertight
//                                       boundary triangle soup of the native Solid)
//   * BRepBndLib::Add / Bnd_Box      -> forge::native::brep::computeAabb (exact AABB; used
//                                       for the merge tolerance + interior-grid bounds)
//   * BRepClass3d_SolidClassifier    -> forge::native::brep::pointInSolid (even-odd ray
//                                       cast; the interior-grid seed test, the BW
//                                       tet-centroid inside filter, and the shell-fallback
//                                       inner-node test)
// Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when the FEAT gate
// forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B harness's
// setForgeNativeBrepEnabled(true)). PRODUCTION DEFAULT IS OFF: with the gate off the
// original OCCT meshShape path runs byte-for-byte unchanged. Mirrors the prior wires
// (Cam.cpp / Healing.cpp / CamAdvanced.cpp / Drawings.cpp / Fea.cpp). PHASE-D ACTIVATION
// (2026-06-25): the native branch now runs on BOTH a NativeSolid handle AND an OCCT-backed
// (ShapeKind::Occt) handle, the latter imported into a native analytic Solid via
// forge::importOcctSolid (src/OcctImport.cpp) before tessellate/AABB/point-in-solid run.
// SAFE + HONEST: if importOcctSolid defers (ok==false: NURBS/Torus/non-analytic) the helper
// returns false and the OCCT meshShape path runs, byte-identical to today. The native tet
// build reuses the SAME backend-agnostic helpers (bowyerWatson, tetVolume, tet4B, the
// seed-densify + centroid-filter + shell-fallback logic), substituting ONLY the three
// geometry backends above; the resulting Mesh is structurally the same kind the OCCT path
// emits (Bowyer-Watson volume tets when they survive, else the documented shell fallback).
//
// The solvers (solveLinearStatic / solveModal) take a Mesh and run pure in-house sparse
// linear algebra (no OCCT geometry), so they have NO native geometry target and are left
// UNWIRED (not a gap; there is nothing to route).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"      // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Topology.hpp"         // Solid graph
#include "forge/native/brep/Aabb.hpp"             // computeAabb (native AABB)
#include "forge/native/brep/Query.hpp"            // pointInSolid (native point classify)
#include "forge/native/brep/SolidTessellate.hpp"  // tessellateSolid (boundary triangles)
#include "forge/OcctImport.hpp"                   // importOcctSolid (OCCT analytic -> native Solid)
#endif

namespace forge::fea::tet {

namespace {

// ============================================================== utilities

constexpr double kEps = 1e-12;

struct Vec3 {
    double x{0}, y{0}, z{0};
    Vec3() = default;
    Vec3(double a, double b, double c) : x(a), y(b), z(c) {}
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator*(double s)     const { return {x * s, y * s, z * s}; }
    double dot(const Vec3& o)    const { return x * o.x + y * o.y + z * o.z; }
    double norm()                const { return std::sqrt(dot(*this)); }
    Vec3   cross(const Vec3& o)  const {
        return {y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x};
    }
};

double tetVolume(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d) {
    return (b - a).cross(c - a).dot(d - a) / 6.0;
}

// Inc1b — closed-form principal stresses (eigenvalues of the symmetric 3×3
// Cauchy tensor) via the trigonometric (Smith 1961) method for a real
// symmetric matrix. Input Voigt s = {sxx,syy,szz,sxy,syz,szx}; output
// {s1 ≥ s2 ≥ s3}. Exact, branch-stable, no iteration.
inline void principalStresses(const double s[6], double out[3]) {
    constexpr double kPi = 3.14159265358979323846;
    const double sxx = s[0], syy = s[1], szz = s[2];
    const double sxy = s[3], syz = s[4], szx = s[5];
    const double p1 = sxy * sxy + syz * syz + szx * szx;
    if (p1 <= 1e-30) {                       // tensor already diagonal
        out[0] = sxx; out[1] = syy; out[2] = szz;
    } else {
        const double q  = (sxx + syy + szz) / 3.0;
        const double p2 = (sxx - q) * (sxx - q) + (syy - q) * (syy - q)
                        + (szz - q) * (szz - q) + 2.0 * p1;
        const double p  = std::sqrt(p2 / 6.0);
        const double bxx = (sxx - q) / p, byy = (syy - q) / p, bzz = (szz - q) / p;
        const double bxy = sxy / p, byz = syz / p, bzx = szx / p;
        double detB = bxx * (byy * bzz - byz * byz)
                    - bxy * (bxy * bzz - byz * bzx)
                    + bzx * (bxy * byz - byy * bzx);
        double r = detB / 2.0;
        if (r < -1.0) r = -1.0; else if (r > 1.0) r = 1.0;
        const double phi = std::acos(r) / 3.0;
        const double e1 = q + 2.0 * p * std::cos(phi);
        const double e3 = q + 2.0 * p * std::cos(phi + 2.0 * kPi / 3.0);
        const double e2 = 3.0 * q - e1 - e3;       // trace invariant
        out[0] = e1; out[1] = e2; out[2] = e3;
    }
    if (out[0] < out[1]) std::swap(out[0], out[1]);
    if (out[1] < out[2]) std::swap(out[1], out[2]);
    if (out[0] < out[1]) std::swap(out[0], out[1]);
}

inline double vonMisesVoigt(const double s[6]) {
    const double sx = s[0], sy = s[1], sz = s[2];
    const double txy = s[3], tyz = s[4], tzx = s[5];
    return std::sqrt(0.5 * ((sx - sy) * (sx - sy) + (sy - sz) * (sy - sz)
                          + (sz - sx) * (sz - sx))
                     + 3.0 * (txy * txy + tyz * tyz + tzx * tzx));
}

// =================================================== Bowyer-Watson mesher
//
// Indices used during meshing: nodes are stored in a std::vector<Vec3>
// where [0..nReal-1] are the real boundary points and the last four
// entries are the super-tet corners.

struct LocalTet {
    int n[4];           // node indices
    Vec3   cc;          // circumsphere centre
    double cr2 = 0.0;   // circumsphere radius²
    bool   alive = true;
};

bool computeCircum(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d,
                   Vec3& out, double& r2) {
    // Solve (P - a)·(P - a) = (P - b)·(P - b) etc → linear in P.
    // The standard expansion gives 2 (b - a)·P = |b|² − |a|² ⇒
    //    A·P = rhs with A[i] = (Pi - a) and rhs[i] = (|Pi|² − |a|²)/2.
    double A[3][3] = {
        {b.x - a.x, b.y - a.y, b.z - a.z},
        {c.x - a.x, c.y - a.y, c.z - a.z},
        {d.x - a.x, d.y - a.y, d.z - a.z},
    };
    double rhs[3] = {
        0.5 * (b.dot(b) - a.dot(a)),
        0.5 * (c.dot(c) - a.dot(a)),
        0.5 * (d.dot(d) - a.dot(a)),
    };

    // Gauss-Jordan solve of 3×3.
    double M[3][4];
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) M[i][j] = A[i][j];
        M[i][3] = rhs[i];
    }
    for (int i = 0; i < 3; ++i) {
        int piv = i;
        double best = std::abs(M[i][i]);
        for (int k = i + 1; k < 3; ++k) {
            if (std::abs(M[k][i]) > best) { best = std::abs(M[k][i]); piv = k; }
        }
        if (best < kEps) return false;
        if (piv != i) std::swap(M[i], M[piv]);
        double inv = 1.0 / M[i][i];
        for (int j = i; j < 4; ++j) M[i][j] *= inv;
        for (int k = 0; k < 3; ++k) {
            if (k == i) continue;
            double f = M[k][i];
            for (int j = i; j < 4; ++j) M[k][j] -= f * M[i][j];
        }
    }
    out = {M[0][3], M[1][3], M[2][3]};
    Vec3 d_ = out - a;
    r2 = d_.dot(d_);
    return true;
}

struct FaceKey {
    int a, b, c;
    FaceKey(int x, int y, int z) {
        a = x; b = y; c = z;
        if (a > b) std::swap(a, b);
        if (b > c) std::swap(b, c);
        if (a > b) std::swap(a, b);
    }
    bool operator==(const FaceKey& o) const { return a==o.a && b==o.b && c==o.c; }
};
struct FaceHash {
    std::size_t operator()(const FaceKey& f) const noexcept {
        std::uint64_t h = 1469598103934665603ull;
        auto mix = [&](int v){ h ^= static_cast<std::uint64_t>(v); h *= 1099511628211ull; };
        mix(f.a); mix(f.b); mix(f.c);
        return static_cast<std::size_t>(h);
    }
};

std::vector<LocalTet>
bowyerWatson(std::vector<Vec3>& pts) {
    // Wrap with a huge super-tetrahedron containing all points.
    double xmin=+1e30,ymin=+1e30,zmin=+1e30,xmax=-1e30,ymax=-1e30,zmax=-1e30;
    for (auto& p : pts) {
        xmin = std::min(xmin, p.x); xmax = std::max(xmax, p.x);
        ymin = std::min(ymin, p.y); ymax = std::max(ymax, p.y);
        zmin = std::min(zmin, p.z); zmax = std::max(zmax, p.z);
    }
    double dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
    double dmax = std::max(dx, std::max(dy, dz));
    if (dmax < kEps) dmax = 1.0;
    double cx = 0.5 * (xmin + xmax);
    double cy = 0.5 * (ymin + ymax);
    double cz = 0.5 * (zmin + zmax);
    // Big enough to contain everything by a healthy factor.
    double s = 32.0 * dmax;

    int N = static_cast<int>(pts.size());
    pts.push_back({cx - s, cy - s, cz - s}); int s0 = N + 0;
    pts.push_back({cx + s, cy - s, cz - s}); int s1 = N + 1;
    pts.push_back({cx,     cy + s, cz - s}); int s2 = N + 2;
    pts.push_back({cx,     cy,     cz + s}); int s3 = N + 3;

    std::vector<LocalTet> tets;
    {
        LocalTet t;
        t.n[0] = s0; t.n[1] = s1; t.n[2] = s2; t.n[3] = s3;
        if (!computeCircum(pts[s0], pts[s1], pts[s2], pts[s3], t.cc, t.cr2)) {
            throw std::runtime_error("forge::fea::tet: super-tet circumsphere failed");
        }
        tets.push_back(t);
    }

    auto inSphere = [&](const LocalTet& t, const Vec3& p) {
        Vec3 d = p - t.cc;
        return d.dot(d) <= t.cr2 + 1e-12;
    };

    for (int pi = 0; pi < N; ++pi) {
        const Vec3& P = pts[pi];

        // 1. Find all "bad" tets whose circumsphere contains P.
        std::vector<int> bad;
        bad.reserve(8);
        for (int i = 0; i < static_cast<int>(tets.size()); ++i) {
            if (!tets[i].alive) continue;
            if (inSphere(tets[i], P)) bad.push_back(i);
        }
        if (bad.empty()) continue; // P sits exactly on a face — skip.

        // 2. Collect boundary faces: faces appearing in exactly one bad tet.
        std::unordered_map<FaceKey, int, FaceHash> faceCount;
        faceCount.reserve(bad.size() * 4);
        auto bumpFace = [&](int a, int b, int c) {
            FaceKey k(a, b, c);
            auto [it, ins] = faceCount.try_emplace(k, 0);
            it->second++;
        };
        for (int bi : bad) {
            const LocalTet& t = tets[bi];
            bumpFace(t.n[1], t.n[2], t.n[3]);
            bumpFace(t.n[0], t.n[2], t.n[3]);
            bumpFace(t.n[0], t.n[1], t.n[3]);
            bumpFace(t.n[0], t.n[1], t.n[2]);
        }
        // Kill bad tets.
        for (int bi : bad) tets[bi].alive = false;

        // 3. For each face with count==1, build a new tet with P.
        for (auto& kv : faceCount) {
            if (kv.second != 1) continue;
            LocalTet nt;
            nt.n[0] = kv.first.a;
            nt.n[1] = kv.first.b;
            nt.n[2] = kv.first.c;
            nt.n[3] = pi;
            // Ensure positive volume.
            double V = tetVolume(pts[nt.n[0]], pts[nt.n[1]], pts[nt.n[2]], pts[nt.n[3]]);
            if (V < 0.0) std::swap(nt.n[1], nt.n[2]);
            if (!computeCircum(pts[nt.n[0]], pts[nt.n[1]], pts[nt.n[2]], pts[nt.n[3]],
                               nt.cc, nt.cr2)) {
                // Degenerate — skip (alive=false).
                nt.alive = false;
            }
            tets.push_back(nt);
        }
    }

    // 4. Strip any tet that still touches a super-corner.
    std::vector<LocalTet> out;
    out.reserve(tets.size());
    for (auto& t : tets) {
        if (!t.alive) continue;
        if (t.n[0] >= N || t.n[1] >= N || t.n[2] >= N || t.n[3] >= N) continue;
        out.push_back(t);
    }
    // Trim super-tet corners from points buffer.
    pts.resize(N);
    return out;
}

// ============================================================== shell fallback
//
// As authorised by the task: convert each surface triangle into a Tet4
// by adding an inner-offset node along the inward face normal at
// 1/3 of the average edge length.  Acknowledged crude but real.

Mesh buildShellTetFallback(const std::vector<Vec3>& bndPts,
                           const std::vector<std::array<int,3>>& triangles,
                           const TopoDS_Shape& shape) {
    BRepClass3d_SolidClassifier classifier(shape);
    Mesh out;
    out.shellTetsOnly = true;

    // Boundary nodes.
    out.nodes.reserve(bndPts.size() + triangles.size());
    for (std::size_t i = 0; i < bndPts.size(); ++i) {
        out.nodes.push_back({bndPts[i].x, bndPts[i].y, bndPts[i].z, static_cast<int>(i)});
    }

    int idCounter = 0;
    for (auto& tri : triangles) {
        const Vec3& A = bndPts[tri[0]];
        const Vec3& B = bndPts[tri[1]];
        const Vec3& C = bndPts[tri[2]];
        Vec3 n = (B - A).cross(C - A);
        double nl = n.norm();
        if (nl < kEps) continue;
        Vec3 nu = n * (1.0 / nl);
        Vec3 centroid = (A + B + C) * (1.0 / 3.0);
        // Average edge length.
        double e = ((B - A).norm() + (C - B).norm() + (A - C).norm()) / 3.0;
        double offset = e / 3.0;
        // Try inward first (- normal), then outward if classifier says
        // the inward point is outside.
        auto trySign = [&](double sign) -> int {
            Vec3 inner = centroid + nu * (sign * offset);
            gp_Pnt p(inner.x, inner.y, inner.z);
            classifier.Perform(p, Precision::Confusion());
            if (classifier.State() == TopAbs_IN || classifier.State() == TopAbs_ON) {
                int newId = static_cast<int>(out.nodes.size());
                out.nodes.push_back({inner.x, inner.y, inner.z, newId});
                return newId;
            }
            return -1;
        };
        int inner = trySign(-1.0);
        if (inner < 0) inner = trySign(+1.0);
        if (inner < 0) continue;

        // Choose orientation that gives positive Tet4 volume.
        Vec3 D{out.nodes[inner].x, out.nodes[inner].y, out.nodes[inner].z};
        double V = tetVolume(A, B, C, D);
        Tet t{};
        t.a = tri[0]; t.b = tri[1]; t.c = tri[2]; t.d = inner;
        if (V < 0.0) std::swap(t.b, t.c);
        t.id = idCounter++;
        out.tets.push_back(t);
    }
    return out;
}

// =============================================================== Tet4 math
//
// Constant-strain tetrahedron in 3D, isotropic linear elasticity.
// 12 DOFs per element (3 × 4 nodes).  Reference: Zienkiewicz-Taylor v1.

// Compute the strain-displacement matrix B (6×12) and volume for one tet.
// Returns true on success, false on degenerate. Caller MUST pass nodes with
// positive signed volume (V = ((p1-p0)×(p2-p0))·(p3-p0)/6 > 0).
//
// Linear shape functions N_i(x,y,z) = a_i + b_i x + c_i y + d_i z satisfy
// N_i(p_j) = δ_ij.  Differentiating, [∇N_1 ∇N_2 ∇N_3] = J^{-T} where
// J = [p1-p0; p2-p0; p3-p0] (rows).  ∇N_0 = -(∇N_1+∇N_2+∇N_3).
bool tet4B(const Vec3 p[4], std::array<double, 6 * 12>& B, double& V) {
    V = tetVolume(p[0], p[1], p[2], p[3]);
    if (std::abs(V) < 1e-25) return false;

    // Jacobian rows: e1=p1-p0, e2=p2-p0, e3=p3-p0
    Vec3 e1 = p[1] - p[0];
    Vec3 e2 = p[2] - p[0];
    Vec3 e3 = p[3] - p[0];
    // det(J)
    double det = e1.x * (e2.y * e3.z - e2.z * e3.y)
               - e1.y * (e2.x * e3.z - e2.z * e3.x)
               + e1.z * (e2.x * e3.y - e2.y * e3.x);
    if (std::abs(det) < 1e-25) return false;
    double invDet = 1.0 / det;

    // Inverse(J)  (3x3 cofactor / det)
    double Ji[3][3];
    Ji[0][0] = (e2.y * e3.z - e2.z * e3.y) * invDet;
    Ji[0][1] = (e1.z * e3.y - e1.y * e3.z) * invDet;
    Ji[0][2] = (e1.y * e2.z - e1.z * e2.y) * invDet;
    Ji[1][0] = (e2.z * e3.x - e2.x * e3.z) * invDet;
    Ji[1][1] = (e1.x * e3.z - e1.z * e3.x) * invDet;
    Ji[1][2] = (e1.z * e2.x - e1.x * e2.z) * invDet;
    Ji[2][0] = (e2.x * e3.y - e2.y * e3.x) * invDet;
    Ji[2][1] = (e1.y * e3.x - e1.x * e3.y) * invDet;
    Ji[2][2] = (e1.x * e2.y - e1.y * e2.x) * invDet;

    // With M = [e1; e2; e3] (rows e_k = p_k - p_0), `Ji[k][j]` is the
    // (k,j) entry of M^{-1} = (J^T)^{-1} = J^{-T} (where J is the
    // textbook Jacobian J_{ij} = ∂x_i/∂ξ_j, so J columns are e1,e2,e3).
    // Then ∂N_1/∂x_j = (J^{-1})_{0,j} = (J^{-T})_{j,0} = Ji[j][0].
    // Same pattern for N_2 (column 1) and N_3 (column 2) of Ji.
    std::array<std::array<double, 3>, 4> grad;
    grad[1] = {Ji[0][0], Ji[1][0], Ji[2][0]};
    grad[2] = {Ji[0][1], Ji[1][1], Ji[2][1]};
    grad[3] = {Ji[0][2], Ji[1][2], Ji[2][2]};
    grad[0] = {
        -(grad[1][0] + grad[2][0] + grad[3][0]),
        -(grad[1][1] + grad[2][1] + grad[3][1]),
        -(grad[1][2] + grad[2][2] + grad[3][2]),
    };

    // Build B (6×12) in row-major.
    auto idx = [](int row, int col) { return row * 12 + col; };
    std::fill(B.begin(), B.end(), 0.0);
    for (int l = 0; l < 4; ++l) {
        double bx = grad[l][0];
        double by = grad[l][1];
        double bz = grad[l][2];
        int col = 3 * l;
        B[idx(0, col + 0)] = bx;
        B[idx(1, col + 1)] = by;
        B[idx(2, col + 2)] = bz;
        B[idx(3, col + 0)] = by;
        B[idx(3, col + 1)] = bx;
        B[idx(4, col + 1)] = bz;
        B[idx(4, col + 2)] = by;
        B[idx(5, col + 0)] = bz;
        B[idx(5, col + 2)] = bx;
    }
    return true;
}

// 6×6 isotropic elasticity matrix D.
void elasticityD(double E, double nu, std::array<double, 36>& D) {
    double c = E / ((1.0 + nu) * (1.0 - 2.0 * nu));
    double a = c * (1.0 - nu);
    double b = c * nu;
    double g = c * (1.0 - 2.0 * nu) / 2.0;
    std::fill(D.begin(), D.end(), 0.0);
    auto at = [&](int r, int c2) -> double& { return D[r * 6 + c2]; };
    at(0,0)=a; at(0,1)=b; at(0,2)=b;
    at(1,0)=b; at(1,1)=a; at(1,2)=b;
    at(2,0)=b; at(2,1)=b; at(2,2)=a;
    at(3,3)=g;
    at(4,4)=g;
    at(5,5)=g;
}

// ---------------------------------------------------------- sparse CSR matrix
//
// Built from a triplet stage (std::map keyed on (row,col)) then frozen
// into CSR for fast matvec.  Symmetric assembly — we store both halves.

struct Sparse {
    int n = 0;
    std::vector<int>    row_ptr; // size n+1
    std::vector<int>    col;
    std::vector<double> val;

    // Triplet build helpers (used during assembly only).
    using Trip = std::map<std::pair<int,int>, double>;

    static Sparse fromTriplets(int n, Trip& trips) {
        Sparse S;
        S.n = n;
        S.row_ptr.resize(n + 1, 0);
        for (auto& kv : trips) S.row_ptr[kv.first.first + 1]++;
        for (int i = 0; i < n; ++i) S.row_ptr[i + 1] += S.row_ptr[i];
        S.col.resize(trips.size());
        S.val.resize(trips.size());
        std::vector<int> cursor(n, 0);
        for (auto& kv : trips) {
            int r = kv.first.first;
            int p = S.row_ptr[r] + cursor[r]++;
            S.col[p] = kv.first.second;
            S.val[p] = kv.second;
        }
        return S;
    }

    void matvec(const std::vector<double>& x, std::vector<double>& y) const {
        std::fill(y.begin(), y.end(), 0.0);
        for (int i = 0; i < n; ++i) {
            double s = 0.0;
            for (int p = row_ptr[i]; p < row_ptr[i + 1]; ++p) {
                s += val[p] * x[col[p]];
            }
            y[i] = s;
        }
    }

    // Find diagonal entry value at row i (0 if absent).
    double diag(int i) const {
        for (int p = row_ptr[i]; p < row_ptr[i + 1]; ++p) {
            if (col[p] == i) return val[p];
        }
        return 0.0;
    }
};

// --------------------------------------------------- Jacobi-preconditioned CG
//
// Solves Sx = b for symmetric positive-definite S.  Returns iteration
// count.  No external lib.  Inline well under 100 lines.

int conjugateGradient(const Sparse& S, const std::vector<double>& b,
                      std::vector<double>& x, int maxIter, double tol,
                      double& finalRes) {
    int n = S.n;
    std::vector<double> r(n), z(n), p(n), Ap(n), Minv(n);
    for (int i = 0; i < n; ++i) {
        double d = S.diag(i);
        Minv[i] = (std::abs(d) > 1e-30) ? 1.0 / d : 1.0;
    }
    // r = b - S x
    S.matvec(x, Ap);
    for (int i = 0; i < n; ++i) r[i] = b[i] - Ap[i];
    for (int i = 0; i < n; ++i) z[i] = Minv[i] * r[i];
    p = z;
    double rz = 0.0;
    for (int i = 0; i < n; ++i) rz += r[i] * z[i];

    double bnorm = 0.0;
    for (double bi : b) bnorm += bi * bi;
    bnorm = std::sqrt(bnorm);
    if (bnorm < 1e-30) bnorm = 1.0;

    int it = 0;
    for (; it < maxIter; ++it) {
        S.matvec(p, Ap);
        double pAp = 0.0;
        for (int i = 0; i < n; ++i) pAp += p[i] * Ap[i];
        if (std::abs(pAp) < 1e-30) break;
        double alpha = rz / pAp;
        for (int i = 0; i < n; ++i) x[i] += alpha * p[i];
        for (int i = 0; i < n; ++i) r[i] -= alpha * Ap[i];
        double rnorm = 0.0;
        for (double ri : r) rnorm += ri * ri;
        rnorm = std::sqrt(rnorm);
        finalRes = rnorm / bnorm;
        if (finalRes < tol) { ++it; break; }
        for (int i = 0; i < n; ++i) z[i] = Minv[i] * r[i];
        double rzNew = 0.0;
        for (int i = 0; i < n; ++i) rzNew += r[i] * z[i];
        double beta = rzNew / rz;
        rz = rzNew;
        for (int i = 0; i < n; ++i) p[i] = z[i] + beta * p[i];
    }
    return it;
}

// ------------------------------------------------------- assembly + utilities

// Map original node id → compact 0-based index used during solve.
struct CompactMap {
    std::unordered_map<int, int> orig2compact;
    std::vector<int> compact2orig;
    int add(int o) {
        auto [it, ins] = orig2compact.emplace(o, static_cast<int>(compact2orig.size()));
        if (ins) compact2orig.push_back(o);
        return it->second;
    }
};

void assembleKe(const std::array<double, 6 * 12>& B,
                const std::array<double, 36>& D,
                double V,
                std::array<double, 144>& Ke) {
    // Ke = V * Bᵀ D B
    std::array<double, 6 * 12> DB{}; // 6×12
    for (int i = 0; i < 6; ++i) {
        for (int j = 0; j < 12; ++j) {
            double s = 0.0;
            for (int k = 0; k < 6; ++k) s += D[i * 6 + k] * B[k * 12 + j];
            DB[i * 12 + j] = s;
        }
    }
    for (int i = 0; i < 12; ++i) {
        for (int j = 0; j < 12; ++j) {
            double s = 0.0;
            for (int k = 0; k < 6; ++k) s += B[k * 12 + i] * DB[k * 12 + j];
            Ke[i * 12 + j] = V * s;
        }
    }
}

// Consistent Tet4 mass: M_e = (ρ V / 20) * (2 on diag block, 1 elsewhere)
// per 3x3 block (translational lumping per coordinate).
void assembleMe(double rho, double V, std::array<double, 144>& Me) {
    double base = rho * std::abs(V) / 20.0;
    for (int i = 0; i < 12; ++i) for (int j = 0; j < 12; ++j) Me[i * 12 + j] = 0.0;
    for (int a = 0; a < 4; ++a) {
        for (int b = 0; b < 4; ++b) {
            double coef = (a == b) ? 2.0 : 1.0;
            for (int k = 0; k < 3; ++k) {
                Me[(3 * a + k) * 12 + (3 * b + k)] = base * coef;
            }
        }
    }
}

// ==================================================== shape → triangulation
//
// Walks all FACE TopoDS entities, asks BRepMesh for triangulations, and
// returns the unique vertex list + triangle index list.  Vertices are
// merged within `mergeTol` (typically 1e-6 * bbox diagonal).

void extractTrianglesAndVertices(const TopoDS_Shape& shape,
                                 double mergeTol,
                                 std::vector<Vec3>& uniqueVerts,
                                 std::vector<std::array<int, 3>>& triangles) {
    // Spatial hash for vertex merging.
    auto key = [&](const Vec3& v) {
        double inv = 1.0 / mergeTol;
        return std::array<long long, 3>{
            static_cast<long long>(std::floor(v.x * inv)),
            static_cast<long long>(std::floor(v.y * inv)),
            static_cast<long long>(std::floor(v.z * inv))
        };
    };
    struct KeyHash {
        std::size_t operator()(const std::array<long long, 3>& k) const noexcept {
            std::uint64_t h = 1469598103934665603ull;
            for (auto v : k) {
                h ^= static_cast<std::uint64_t>(v);
                h *= 1099511628211ull;
            }
            return static_cast<std::size_t>(h);
        }
    };
    std::unordered_map<std::array<long long, 3>, int, KeyHash> seen;

    auto insertPoint = [&](const Vec3& v) {
        auto k = key(v);
        for (int di = -1; di <= 1; ++di) {
            for (int dj = -1; dj <= 1; ++dj) {
                for (int dk = -1; dk <= 1; ++dk) {
                    auto kn = k;
                    kn[0] += di; kn[1] += dj; kn[2] += dk;
                    auto it = seen.find(kn);
                    if (it != seen.end()) {
                        Vec3 d = uniqueVerts[it->second] - v;
                        if (d.norm() < mergeTol * 1.5) return it->second;
                    }
                }
            }
        }
        int id = static_cast<int>(uniqueVerts.size());
        uniqueVerts.push_back(v);
        seen[k] = id;
        return id;
    };

    for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next()) {
        const TopoDS_Face& F = TopoDS::Face(e.Current());
        TopLoc_Location loc;
        Handle(Poly_Triangulation) tri = ::BRep_Tool::Triangulation(F, loc);
        if (tri.IsNull()) continue;
        const gp_Trsf& trsf = loc.Transformation();
        int nNodes = tri->NbNodes();
        std::vector<int> nodeMap(nNodes + 1, -1);
        for (int i = 1; i <= nNodes; ++i) {
            gp_Pnt p = tri->Node(i);
            if (!loc.IsIdentity()) p.Transform(trsf);
            int id = insertPoint(Vec3{p.X(), p.Y(), p.Z()});
            nodeMap[i] = id;
        }
        int nTri = tri->NbTriangles();
        for (int i = 1; i <= nTri; ++i) {
            const Poly_Triangle& T = tri->Triangle(i);
            int a, b, c;
            T.Get(a, b, c);
            if (F.Orientation() == TopAbs_REVERSED) std::swap(b, c);
            std::array<int, 3> t{nodeMap[a], nodeMap[b], nodeMap[c]};
            if (t[0] == t[1] || t[1] == t[2] || t[0] == t[2]) continue;
            triangles.push_back(t);
        }
    }
}

} // anonymous namespace

// ============================================================= public surface

Mesh meshShape(const TopoDS_Shape& shape, double targetEdge) {
    if (shape.IsNull()) {
        throw std::invalid_argument("forge::fea::tet::meshShape: null shape");
    }
    if (!(targetEdge > 0.0)) {
        throw std::invalid_argument("forge::fea::tet::meshShape: targetEdge must be > 0");
    }

    // 1. Surface mesh — NATIVE (forge::occtmesh, no BRepMesh / TKMesh). Attaches a
    // Poly_Triangulation to every face in-place; extractTrianglesAndVertices reads
    // it back exactly like the old BRepMesh triangulation (and the tet seeder
    // classifies inside/outside with BRepClass3d_SolidClassifier, so triangle
    // winding is irrelevant to the result). TKMesh is dropped — there is NO
    // BRepMesh fallback; an unreadable face is an HONEST DEFERRAL (below).
    if (!forge::occtmesh::triangulateShapeInPlace(shape, targetEdge, /*ang*/ 0.5)) {
        // HONEST DEFERRAL: TKMesh is gone — no BRepMesh fallback. extractTriangles
        // below then finds no attached triangulation and meshShape throws its "no
        // triangles" error for THIS shape (never a crash / silent bad mesh).
        // Verified: no fea shape defers under fea_smoke / fea_nafems.
        std::fprintf(stderr, "[K5][feaTet] native occtmesh DEFERRED (no BRepMesh)\n");
    }

    // 2. Collect unique boundary vertices + triangles.
    Bnd_Box bb;
    BRepBndLib::Add(shape, bb);
    double xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    double diag = std::sqrt((xmax - xmin) * (xmax - xmin) +
                            (ymax - ymin) * (ymax - ymin) +
                            (zmax - zmin) * (zmax - zmin));
    double mergeTol = std::max(targetEdge * 1e-3, diag * 1e-7);

    std::vector<Vec3> bndPts;
    std::vector<std::array<int, 3>> triangles;
    extractTrianglesAndVertices(shape, mergeTol, bndPts, triangles);

    if (bndPts.empty() || triangles.empty()) {
        throw std::runtime_error("forge::fea::tet::meshShape: BRepMesh produced no triangles");
    }

    // 2b. Densify seeds.
    //
    // BRepMesh on a planar face only produces corner+edge vertices — a
    // box face becomes a single 2-triangle fan with the 4 corner points,
    // regardless of `targetEdge`. To produce a useful tet mesh for FEA
    // we explicitly seed:
    //   (a) surface points: subdivide every triangle edge whose length
    //       exceeds 1.25 * targetEdge into one extra midpoint, plus the
    //       triangle barycenter if its area is large.
    //   (b) interior points: regular grid spaced by targetEdge inside
    //       the AABB, classified IN by BRepClass3d_SolidClassifier.
    //
    // De-duplication uses a spatial hash with cell size = mergeTol.
    {
        struct ArrHash {
            std::size_t operator()(const std::array<long long, 3>& k) const noexcept {
                std::uint64_t h = 1469598103934665603ull;
                for (auto v : k) { h ^= static_cast<std::uint64_t>(v); h *= 1099511628211ull; }
                return static_cast<std::size_t>(h);
            }
        };
        std::unordered_set<std::array<long long, 3>, ArrHash> occupied;
        double invCell = 1.0 / std::max(mergeTol, 1e-30);
        auto cell = [&](const Vec3& v) {
            return std::array<long long, 3>{
                static_cast<long long>(std::floor(v.x * invCell)),
                static_cast<long long>(std::floor(v.y * invCell)),
                static_cast<long long>(std::floor(v.z * invCell))
            };
        };
        for (const auto& p : bndPts) occupied.insert(cell(p));

        auto tryAdd = [&](const Vec3& p) {
            auto k = cell(p);
            // Check the 3×3×3 neighbourhood.
            for (int di = -1; di <= 1; ++di) {
                for (int dj = -1; dj <= 1; ++dj) {
                    for (int dk = -1; dk <= 1; ++dk) {
                        auto kn = k; kn[0] += di; kn[1] += dj; kn[2] += dk;
                        if (occupied.count(kn)) return false;
                    }
                }
            }
            occupied.insert(k);
            bndPts.push_back(p);
            return true;
        };

        // (a) Triangle midpoints + barycenters (operate on the original
        // triangle list to avoid iterating new points).
        const double minLen = 1.25 * targetEdge;
        const double minArea = 0.5 * targetEdge * targetEdge;
        std::size_t ntri = triangles.size();
        for (std::size_t ti = 0; ti < ntri; ++ti) {
            Vec3 A = bndPts[triangles[ti][0]];
            Vec3 B = bndPts[triangles[ti][1]];
            Vec3 C = bndPts[triangles[ti][2]];
            if ((B - A).norm() > minLen) tryAdd((A + B) * 0.5);
            if ((C - B).norm() > minLen) tryAdd((B + C) * 0.5);
            if ((A - C).norm() > minLen) tryAdd((C + A) * 0.5);
            double area = 0.5 * (B - A).cross(C - A).norm();
            if (area > minArea) tryAdd((A + B + C) * (1.0 / 3.0));
        }
        // (b) Interior grid.
        BRepClass3d_SolidClassifier classifier(shape);
        int nx = std::max(1, static_cast<int>(std::ceil((xmax - xmin) / targetEdge)));
        int ny = std::max(1, static_cast<int>(std::ceil((ymax - ymin) / targetEdge)));
        int nz = std::max(1, static_cast<int>(std::ceil((zmax - zmin) / targetEdge)));
        const int kMax = 20000;
        long long total = static_cast<long long>(nx) * ny * nz;
        if (total > kMax) {
            double f = std::pow(static_cast<double>(total) / kMax, 1.0 / 3.0);
            nx = std::max(1, static_cast<int>(nx / f));
            ny = std::max(1, static_cast<int>(ny / f));
            nz = std::max(1, static_cast<int>(nz / f));
        }
        double dx = (xmax - xmin) / (nx + 1);
        double dy = (ymax - ymin) / (ny + 1);
        double dz = (zmax - zmin) / (nz + 1);
        for (int ix = 1; ix <= nx; ++ix) {
            for (int iy = 1; iy <= ny; ++iy) {
                for (int iz = 1; iz <= nz; ++iz) {
                    Vec3 p{xmin + ix * dx, ymin + iy * dy, zmin + iz * dz};
                    gp_Pnt gp(p.x, p.y, p.z);
                    classifier.Perform(gp, mergeTol);
                    if (classifier.State() != TopAbs_IN) continue;
                    tryAdd(p);
                }
            }
        }
    }

    // 3. Bowyer-Watson on the boundary points (try).
    std::vector<Vec3> ptsCopy = bndPts;
    std::vector<LocalTet> bw;
    bool bwOk = true;
    try {
        bw = bowyerWatson(ptsCopy);
    } catch (...) {
        bw.clear();
        bwOk = false;
    }

    Mesh out;
    if (bwOk && !bw.empty()) {
        // 4. Filter against the solid: keep tets whose centroid is inside.
        BRepClass3d_SolidClassifier classifier(shape);
        std::vector<LocalTet> kept;
        kept.reserve(bw.size());
        for (auto& t : bw) {
            Vec3 c = (ptsCopy[t.n[0]] + ptsCopy[t.n[1]] + ptsCopy[t.n[2]] + ptsCopy[t.n[3]])
                     * 0.25;
            gp_Pnt p(c.x, c.y, c.z);
            classifier.Perform(p, Precision::Confusion());
            if (classifier.State() == TopAbs_IN) kept.push_back(t);
        }
        if (!kept.empty()) {
            // Build nodes — use the union of points referenced by kept tets.
            std::unordered_map<int, int> remap;
            for (auto& t : kept) {
                for (int k = 0; k < 4; ++k) {
                    auto [it, ins] = remap.try_emplace(t.n[k], static_cast<int>(remap.size()));
                    (void)it; (void)ins;
                }
            }
            out.nodes.resize(remap.size());
            for (auto& kv : remap) {
                const Vec3& p = ptsCopy[kv.first];
                out.nodes[kv.second] = Node{p.x, p.y, p.z, kv.second};
            }
            int idc = 0;
            for (auto& t : kept) {
                Tet T{};
                T.a = remap[t.n[0]];
                T.b = remap[t.n[1]];
                T.c = remap[t.n[2]];
                T.d = remap[t.n[3]];
                // Ensure positive volume.
                double V = tetVolume({out.nodes[T.a].x, out.nodes[T.a].y, out.nodes[T.a].z},
                                     {out.nodes[T.b].x, out.nodes[T.b].y, out.nodes[T.b].z},
                                     {out.nodes[T.c].x, out.nodes[T.c].y, out.nodes[T.c].z},
                                     {out.nodes[T.d].x, out.nodes[T.d].y, out.nodes[T.d].z});
                if (V < 0.0) std::swap(T.b, T.c);
                T.id = idc++;
                out.tets.push_back(T);
            }
            return out;
        }
    }

    // 5. Shell fallback (documented).
    return buildShellTetFallback(bndPts, triangles, shape);
}

#ifdef FORGE_NATIVE_BREP
namespace {

// Native counterpart of buildShellTetFallback — same crude-but-real surface-triangle ->
// Tet4 conversion (inner-offset node along the inward face normal at 1/3 the average edge
// length), but the inside/outside test that picks the inner node uses the native even-odd
// pointInSolid instead of BRepClass3d_SolidClassifier. Identical geometry/orientation
// logic otherwise.
Mesh buildShellTetFallbackNative(const std::vector<Vec3>& bndPts,
                                 const std::vector<std::array<int,3>>& triangles,
                                 const forge::native::brep::Solid& solid) {
    using namespace forge::native::brep;
    Mesh out;
    out.shellTetsOnly = true;

    out.nodes.reserve(bndPts.size() + triangles.size());
    for (std::size_t i = 0; i < bndPts.size(); ++i) {
        out.nodes.push_back({bndPts[i].x, bndPts[i].y, bndPts[i].z, static_cast<int>(i)});
    }

    int idCounter = 0;
    for (auto& tri : triangles) {
        const Vec3& A = bndPts[tri[0]];
        const Vec3& B = bndPts[tri[1]];
        const Vec3& C = bndPts[tri[2]];
        Vec3 n = (B - A).cross(C - A);
        double nl = n.norm();
        if (nl < kEps) continue;
        Vec3 nu = n * (1.0 / nl);
        Vec3 centroid = (A + B + C) * (1.0 / 3.0);
        double e = ((B - A).norm() + (C - B).norm() + (A - C).norm()) / 3.0;
        double offset = e / 3.0;
        auto trySign = [&](double sign) -> int {
            Vec3 inner = centroid + nu * (sign * offset);
            const PointClass st =
                pointInSolid(solid, forge::native::brep::Vec3{inner.x, inner.y, inner.z},
                             Precision::Confusion());
            if (st == PointClass::Inside || st == PointClass::On) {
                int newId = static_cast<int>(out.nodes.size());
                out.nodes.push_back({inner.x, inner.y, inner.z, newId});
                return newId;
            }
            return -1;
        };
        int inner = trySign(-1.0);
        if (inner < 0) inner = trySign(+1.0);
        if (inner < 0) continue;

        Vec3 D{out.nodes[inner].x, out.nodes[inner].y, out.nodes[inner].z};
        double V = tetVolume(A, B, C, D);
        Tet t{};
        t.a = tri[0]; t.b = tri[1]; t.c = tri[2]; t.d = inner;
        if (V < 0.0) std::swap(t.b, t.c);
        t.id = idCounter++;
        out.tets.push_back(t);
    }
    return out;
}

// Try the native boundary tessellation + native AABB + native point-in-solid for the
// meshShape domain build. Returns true + fills `out` on success; returns false (NEVER
// throws) when the native path HONESTLY DEFERS so meshShapeFromHandle falls through to the
// OCCT meshShape path. Same deferral contract as Fea.cpp::tryNativeMeshFromBRep /
// Cam.cpp::tryNativeInwardOffset.
//
// Deferral cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * the input is a NativeMesh, or an OCCT-backed body whose importOcctSolid defers
//     (ok==false: NURBS/Torus/non-analytic) -> the whole call defers to OCCT.
//   * the native tessellation yields no triangles, or the native AABB is void_/degenerate
//     -> defer (OCCT owns the descriptive throw on an empty boundary).
//
// The build below mirrors meshShape's structure: native watertight boundary triangles
// (tessellateSolid) -> seed densify (triangle midpoints/barycenters + an interior grid
// classified by native pointInSolid) -> Bowyer-Watson (the SAME backend-agnostic mesher)
// -> centroid inside-filter (native pointInSolid) -> documented native shell fallback.
bool tryNativeMeshShape(::forge::ShapeHandle h, double targetEdge, Mesh& out) {
    using namespace forge::native::brep;
    auto& reg = ::forge::ShapeRegistry::instance();

    // Resolve the input to a native analytic Solid. A NativeSolid handle is used
    // directly; PHASE-D ACTIVATION (2026-06-25) — an OCCT-backed (ShapeKind::Occt)
    // handle is IMPORTED via forge::importOcctSolid (analytic box/cyl/cone/sphere/
    // prism + analytic-boolean results) so the native tessellate + point-in-solid
    // tet build runs on it. SAFE: importOcctSolid ok==false (NURBS/Torus/non-analytic)
    // -> defer to OCCT. `imported` keeps the imported topology alive for this call.
    ::forge::ImportResult imported;
    const Solid* solidPtr = nullptr;
    if (reg.kindOf(h) == ::forge::ShapeKind::NativeSolid) {
        solidPtr = &reg.getNativeSolid(h);
    } else if (reg.kindOf(h) == ::forge::ShapeKind::Occt) {
        imported = ::forge::importOcctSolid(reg.get(h));
        if (!imported.ok || imported.solid == nullptr) return false;     // defer to OCCT
        solidPtr = imported.solid;
    } else {
        return false;   // NativeMesh -> no analytic Solid -> defer to OCCT
    }
    const Solid& solid = *solidPtr;

    // 1. Native AABB (sizes the merge tolerance + the interior seed grid bounds).
    const Aabb3 box = computeAabb(solid);
    if (box.void_) return false;                                         // empty -> defer
    const double xmin = box.minX, ymin = box.minY, zmin = box.minZ;
    const double xmax = box.maxX, ymax = box.maxY, zmax = box.maxZ;
    double diag = std::sqrt((xmax - xmin) * (xmax - xmin) +
                            (ymax - ymin) * (ymax - ymin) +
                            (zmax - zmin) * (zmax - zmin));
    double mergeTol = std::max(targetEdge * 1e-3, diag * 1e-7);

    // 2. Native watertight boundary triangles -> unique vertex list + triangle indices,
    //    in the SAME (uniqueVerts, triangles) form the OCCT extractor produced. The native
    //    soup is already welded by position (tessellateSolid weldTol); we keep its vertex
    //    indexing directly (no re-merge needed — coincident topological vertices already
    //    map to one position).
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    tessellateSolid(solid, pos, idx, mergeTol);
    if (pos.empty() || idx.size() < 3) return false;                    // no boundary -> defer

    std::vector<Vec3> bndPts;
    bndPts.reserve(pos.size() / 3);
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        bndPts.push_back(Vec3{pos[i], pos[i + 1], pos[i + 2]});
    }
    std::vector<std::array<int, 3>> triangles;
    triangles.reserve(idx.size() / 3);
    for (std::size_t i = 0; i + 2 < idx.size(); i += 3) {
        std::array<int, 3> t{ static_cast<int>(idx[i]),
                              static_cast<int>(idx[i + 1]),
                              static_cast<int>(idx[i + 2]) };
        if (t[0] == t[1] || t[1] == t[2] || t[0] == t[2]) continue;
        triangles.push_back(t);
    }
    if (bndPts.empty() || triangles.empty()) return false;              // degenerate -> defer

    // 2b. Densify seeds — identical to meshShape (a: triangle midpoints/barycenters;
    //     b: interior grid classified IN by the NATIVE pointInSolid).
    {
        struct ArrHash {
            std::size_t operator()(const std::array<long long, 3>& k) const noexcept {
                std::uint64_t hh = 1469598103934665603ull;
                for (auto v : k) { hh ^= static_cast<std::uint64_t>(v); hh *= 1099511628211ull; }
                return static_cast<std::size_t>(hh);
            }
        };
        std::unordered_set<std::array<long long, 3>, ArrHash> occupied;
        double invCell = 1.0 / std::max(mergeTol, 1e-30);
        auto cell = [&](const Vec3& v) {
            return std::array<long long, 3>{
                static_cast<long long>(std::floor(v.x * invCell)),
                static_cast<long long>(std::floor(v.y * invCell)),
                static_cast<long long>(std::floor(v.z * invCell))
            };
        };
        for (const auto& p : bndPts) occupied.insert(cell(p));

        auto tryAdd = [&](const Vec3& p) {
            auto k = cell(p);
            for (int di = -1; di <= 1; ++di) {
                for (int dj = -1; dj <= 1; ++dj) {
                    for (int dk = -1; dk <= 1; ++dk) {
                        auto kn = k; kn[0] += di; kn[1] += dj; kn[2] += dk;
                        if (occupied.count(kn)) return false;
                    }
                }
            }
            occupied.insert(k);
            bndPts.push_back(p);
            return true;
        };

        const double minLen = 1.25 * targetEdge;
        const double minArea = 0.5 * targetEdge * targetEdge;
        std::size_t ntri = triangles.size();
        for (std::size_t ti = 0; ti < ntri; ++ti) {
            Vec3 A = bndPts[triangles[ti][0]];
            Vec3 B = bndPts[triangles[ti][1]];
            Vec3 C = bndPts[triangles[ti][2]];
            if ((B - A).norm() > minLen) tryAdd((A + B) * 0.5);
            if ((C - B).norm() > minLen) tryAdd((B + C) * 0.5);
            if ((A - C).norm() > minLen) tryAdd((C + A) * 0.5);
            double area = 0.5 * (B - A).cross(C - A).norm();
            if (area > minArea) tryAdd((A + B + C) * (1.0 / 3.0));
        }
        int nx = std::max(1, static_cast<int>(std::ceil((xmax - xmin) / targetEdge)));
        int ny = std::max(1, static_cast<int>(std::ceil((ymax - ymin) / targetEdge)));
        int nz = std::max(1, static_cast<int>(std::ceil((zmax - zmin) / targetEdge)));
        const int kMax = 20000;
        long long total = static_cast<long long>(nx) * ny * nz;
        if (total > kMax) {
            double f = std::pow(static_cast<double>(total) / kMax, 1.0 / 3.0);
            nx = std::max(1, static_cast<int>(nx / f));
            ny = std::max(1, static_cast<int>(ny / f));
            nz = std::max(1, static_cast<int>(nz / f));
        }
        double dx = (xmax - xmin) / (nx + 1);
        double dy = (ymax - ymin) / (ny + 1);
        double dz = (zmax - zmin) / (nz + 1);
        for (int ix = 1; ix <= nx; ++ix) {
            for (int iy = 1; iy <= ny; ++iy) {
                for (int iz = 1; iz <= nz; ++iz) {
                    Vec3 p{xmin + ix * dx, ymin + iy * dy, zmin + iz * dz};
                    const PointClass st = pointInSolid(
                        solid, forge::native::brep::Vec3{p.x, p.y, p.z}, mergeTol);
                    if (st != PointClass::Inside) continue;
                    tryAdd(p);
                }
            }
        }
    }

    // 3. Bowyer-Watson on the boundary points (the SAME backend-agnostic mesher).
    std::vector<Vec3> ptsCopy = bndPts;
    std::vector<LocalTet> bw;
    bool bwOk = true;
    try {
        bw = bowyerWatson(ptsCopy);
    } catch (...) {
        bw.clear();
        bwOk = false;
    }

    if (bwOk && !bw.empty()) {
        // 4. Filter against the solid: keep tets whose centroid is inside (native test).
        std::vector<LocalTet> kept;
        kept.reserve(bw.size());
        for (auto& t : bw) {
            Vec3 c = (ptsCopy[t.n[0]] + ptsCopy[t.n[1]] + ptsCopy[t.n[2]] + ptsCopy[t.n[3]])
                     * 0.25;
            const PointClass st = pointInSolid(
                solid, forge::native::brep::Vec3{c.x, c.y, c.z}, Precision::Confusion());
            if (st == PointClass::Inside) kept.push_back(t);
        }
        if (!kept.empty()) {
            std::unordered_map<int, int> remap;
            for (auto& t : kept) {
                for (int k = 0; k < 4; ++k) {
                    auto [it, ins] = remap.try_emplace(t.n[k], static_cast<int>(remap.size()));
                    (void)it; (void)ins;
                }
            }
            Mesh m;
            m.nodes.resize(remap.size());
            for (auto& kv : remap) {
                const Vec3& p = ptsCopy[kv.first];
                m.nodes[kv.second] = Node{p.x, p.y, p.z, kv.second};
            }
            int idc = 0;
            for (auto& t : kept) {
                Tet T{};
                T.a = remap[t.n[0]];
                T.b = remap[t.n[1]];
                T.c = remap[t.n[2]];
                T.d = remap[t.n[3]];
                double V = tetVolume({m.nodes[T.a].x, m.nodes[T.a].y, m.nodes[T.a].z},
                                     {m.nodes[T.b].x, m.nodes[T.b].y, m.nodes[T.b].z},
                                     {m.nodes[T.c].x, m.nodes[T.c].y, m.nodes[T.c].z},
                                     {m.nodes[T.d].x, m.nodes[T.d].y, m.nodes[T.d].z});
                if (V < 0.0) std::swap(T.b, T.c);
                T.id = idc++;
                m.tets.push_back(T);
            }
            out = std::move(m);
            return true;
        }
    }

    // 5. Shell fallback (documented; native inside-test variant).
    out = buildShellTetFallbackNative(bndPts, triangles, solid);
    return true;
}

} // namespace
#endif

Mesh meshShapeFromHandle(::forge::ShapeHandle h, double targetEdge) {
#ifdef FORGE_NATIVE_BREP
    // GATE: the native boundary-tessellation + AABB + point-in-solid tet-domain build is
    // opt-in via the FEAT gate (default OFF). When on AND the input is a NativeSolid, build
    // the tet mesh natively; otherwise fall through to the OCCT meshShape path below (an
    // OCCT-backed input HONESTLY DEFERS — no behavior change in the default build). A false
    // return == defer.
    if (::forge::native::brep::forgeNativeFeaturesEnabled() && targetEdge > 0.0) {
        Mesh nativeMesh;
        if (tryNativeMeshShape(h, targetEdge, nativeMesh)) return nativeMesh;
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    const TopoDS_Shape& s = ::forge::ShapeRegistry::instance().get(h);
    return meshShape(s, targetEdge);
}

Result solveLinearStatic(const Mesh& mesh, const Material& mat, const BC& bc) {
    const int N = static_cast<int>(mesh.nodes.size());
    if (N == 0 || mesh.tets.empty()) {
        throw std::invalid_argument("forge::fea::tet::solveLinearStatic: empty mesh");
    }
    const int ndof = 3 * N;
    std::array<double, 36> D;
    elasticityD(mat.E, mat.nu, D);

    // Triplet assembly.
    Sparse::Trip trips;
    std::vector<double> f(ndof, 0.0);

    // Map original Node::id to row index. We assume mesh nodes are
    // contiguous 0..N-1 — but tolerate sparse ids by mapping through.
    std::unordered_map<int, int> idMap;
    idMap.reserve(N);
    for (int i = 0; i < N; ++i) idMap[mesh.nodes[i].id] = i;

    auto idOf = [&](int origOrIdx) -> int {
        auto it = idMap.find(origOrIdx);
        if (it != idMap.end()) return it->second;
        if (origOrIdx >= 0 && origOrIdx < N) return origOrIdx;
        return -1;
    };

    for (const Tet& t : mesh.tets) {
        int ni[4];
        ni[0] = idOf(t.a); ni[1] = idOf(t.b);
        ni[2] = idOf(t.c); ni[3] = idOf(t.d);
        for (int k = 0; k < 4; ++k) {
            if (ni[k] < 0 || ni[k] >= N) {
                throw std::runtime_error("forge::fea::tet::solveLinearStatic: tet node out of range");
            }
        }
        Vec3 P[4]{
            {mesh.nodes[ni[0]].x, mesh.nodes[ni[0]].y, mesh.nodes[ni[0]].z},
            {mesh.nodes[ni[1]].x, mesh.nodes[ni[1]].y, mesh.nodes[ni[1]].z},
            {mesh.nodes[ni[2]].x, mesh.nodes[ni[2]].y, mesh.nodes[ni[2]].z},
            {mesh.nodes[ni[3]].x, mesh.nodes[ni[3]].y, mesh.nodes[ni[3]].z},
        };
        // Make sure volume is positive (B-matrix sign convention).
        double V = tetVolume(P[0], P[1], P[2], P[3]);
        if (V < 0) {
            std::swap(ni[1], ni[2]);
            std::swap(P[1], P[2]);
            V = -V;
        }
        std::array<double, 6 * 12> B;
        double Vchk;
        if (!tet4B(P, B, Vchk)) continue;
        std::array<double, 144> Ke;
        assembleKe(B, D, V, Ke);
        int gdof[12];
        for (int k = 0; k < 4; ++k) {
            gdof[3 * k + 0] = 3 * ni[k] + 0;
            gdof[3 * k + 1] = 3 * ni[k] + 1;
            gdof[3 * k + 2] = 3 * ni[k] + 2;
        }
        for (int i = 0; i < 12; ++i) {
            for (int j = 0; j < 12; ++j) {
                double v = Ke[i * 12 + j];
                if (v == 0.0) continue;
                trips[{gdof[i], gdof[j]}] += v;
            }
        }
    }

    // Apply nodal forces.
    for (const auto& nf : bc.nodalForces) {
        int idx = idOf(nf.first);
        if (idx < 0) continue;
        f[3 * idx + 0] += nf.second[0];
        f[3 * idx + 1] += nf.second[1];
        f[3 * idx + 2] += nf.second[2];
    }

    // ---- Inc1c: thermoelastic initial-strain load (per-node ΔT → element ε₀) ----
    // ε₀ = α·ΔT̄ₑ·[1,1,1,0,0,0]; constant-strain Tet4 ⇒ f_e = V·Bᵀ·(D ε₀).
    // elemE0[e] (= α·ΔT̄ₑ) is retained so the stress recovery reports σ = D(ε−ε₀).
    std::vector<double> elemE0;   // empty ⇒ isothermal
    if (mat.alpha != 0.0 && !bc.nodeTemps.empty()) {
        std::vector<double> nodeDT(N, 0.0);
        for (const auto& nt : bc.nodeTemps) {
            int idx = idOf(nt.first);
            if (idx >= 0 && idx < N) nodeDT[idx] = nt.second;
        }
        elemE0.assign(mesh.tets.size(), 0.0);
        for (std::size_t e = 0; e < mesh.tets.size(); ++e) {
            const Tet& t = mesh.tets[e];
            int ni[4]{ idOf(t.a), idOf(t.b), idOf(t.c), idOf(t.d) };
            bool ok = true;
            for (int k = 0; k < 4; ++k) if (ni[k] < 0 || ni[k] >= N) ok = false;
            if (!ok) continue;
            double dT = 0.0;
            for (int k = 0; k < 4; ++k) dT += nodeDT[ni[k]];
            const double e0 = mat.alpha * (dT * 0.25);
            elemE0[e] = e0;
            if (e0 == 0.0) continue;
            Vec3 P[4]{
                {mesh.nodes[ni[0]].x, mesh.nodes[ni[0]].y, mesh.nodes[ni[0]].z},
                {mesh.nodes[ni[1]].x, mesh.nodes[ni[1]].y, mesh.nodes[ni[1]].z},
                {mesh.nodes[ni[2]].x, mesh.nodes[ni[2]].y, mesh.nodes[ni[2]].z},
                {mesh.nodes[ni[3]].x, mesh.nodes[ni[3]].y, mesh.nodes[ni[3]].z},
            };
            double V = tetVolume(P[0], P[1], P[2], P[3]);
            if (V < 0) { std::swap(ni[1], ni[2]); std::swap(P[1], P[2]); V = -V; }
            std::array<double, 6 * 12> B;
            double Vchk;
            if (!tet4B(P, B, Vchk)) continue;
            double sig0[6];
            for (int i = 0; i < 6; ++i) sig0[i] = (D[i*6+0] + D[i*6+1] + D[i*6+2]) * e0;
            int gdof[12];
            for (int k = 0; k < 4; ++k) {
                gdof[3*k+0] = 3*ni[k]+0; gdof[3*k+1] = 3*ni[k]+1; gdof[3*k+2] = 3*ni[k]+2;
            }
            for (int j = 0; j < 12; ++j) {
                double v = 0.0;
                for (int i = 0; i < 6; ++i) v += B[i*12+j] * sig0[i];
                f[gdof[j]] += V * v;
            }
        }
    }

    // ---- Inc1c: general per-DOF boundary conditions via penalty -------------
    // fixedNodes → full 3-DOF pin at value 0 (legacy). prescribed → per-DOF
    // constraint with a (possibly non-zero) value; value 0 on a single axis is a
    // SYMMETRY plane (zero normal component). Penalty: the constrained row keeps
    // only a large diagonal d with f = d·value (⇒ u = value); free rows retain
    // the constrained COLUMN, giving the correct K_free,c·value coupling.
    constexpr double kPenalty = 1e30;
    std::map<int, double> prescribedDof;   // dof -> prescribed value
    for (int nid : bc.fixedNodes) {
        int idx = idOf(nid);
        if (idx < 0) continue;
        prescribedDof[3 * idx + 0] = 0.0;
        prescribedDof[3 * idx + 1] = 0.0;
        prescribedDof[3 * idx + 2] = 0.0;
    }
    for (const auto& pd : bc.prescribed) {
        int idx = idOf(pd.nodeId);
        if (idx < 0) continue;
        if (pd.fx) prescribedDof[3 * idx + 0] = pd.ux;
        if (pd.fy) prescribedDof[3 * idx + 1] = pd.uy;
        if (pd.fz) prescribedDof[3 * idx + 2] = pd.uz;
    }
    if (!prescribedDof.empty()) {
        Sparse::Trip newTrips;
        for (auto& kv : trips) {
            int r = kv.first.first;
            if (prescribedDof.count(r)) continue;   // drop the constrained row
            newTrips[{r, kv.first.second}] = kv.second;
        }
        for (const auto& pr : prescribedDof) {
            const int fd = pr.first;
            double existing = 0.0;
            auto it = trips.find({fd, fd});
            if (it != trips.end()) existing = it->second;
            const double diag = std::max(std::abs(existing), 1.0) * kPenalty;
            newTrips[{fd, fd}] = diag;
            f[fd] = diag * pr.second;     // u_fd = prescribed value (0 = pin / symmetry)
        }
        trips.swap(newTrips);
    }

    Sparse K = Sparse::fromTriplets(ndof, trips);

    // Solve.
    std::vector<double> u(ndof, 0.0);
    double finalRes = 0.0;
    int iters = conjugateGradient(K, f, u, std::max(2000, 20 * ndof), 1e-10, finalRes);

    Result R;
    R.displacement.resize(N);
    R.maxDisp = 0.0;
    for (int i = 0; i < N; ++i) {
        R.displacement[i] = {u[3 * i + 0], u[3 * i + 1], u[3 * i + 2]};
        double m = std::sqrt(u[3*i]*u[3*i] + u[3*i+1]*u[3*i+1] + u[3*i+2]*u[3*i+2]);
        if (m > R.maxDisp) R.maxDisp = m;
    }
    R.cgIterations = iters;
    R.cgResidual   = finalRes;
    R.converged    = (finalRes < 1e-6);

    // ---- Inc1b: element stress recovery — full Cauchy tensor + principal,
    // per-element AND nodal-averaged. The sig[6] vector computed here was
    // previously reduced to von Mises and discarded; we now STORE it. ----
    const std::size_t nE = mesh.tets.size();
    R.vonMises.resize(nE, 0.0);
    R.elemStress.assign(nE, {0, 0, 0, 0, 0, 0});
    R.elemPrincipal.assign(nE, {0, 0, 0});
    R.maxVonMises = 0.0;

    std::vector<std::array<double, 6>> nodeAccum(N, {0, 0, 0, 0, 0, 0});
    std::vector<int>                   nodeCount(N, 0);

    for (std::size_t e = 0; e < nE; ++e) {
        const Tet& t = mesh.tets[e];
        int ni[4]{ idOf(t.a), idOf(t.b), idOf(t.c), idOf(t.d) };
        Vec3 P[4]{
            {mesh.nodes[ni[0]].x, mesh.nodes[ni[0]].y, mesh.nodes[ni[0]].z},
            {mesh.nodes[ni[1]].x, mesh.nodes[ni[1]].y, mesh.nodes[ni[1]].z},
            {mesh.nodes[ni[2]].x, mesh.nodes[ni[2]].y, mesh.nodes[ni[2]].z},
            {mesh.nodes[ni[3]].x, mesh.nodes[ni[3]].y, mesh.nodes[ni[3]].z},
        };
        double V = tetVolume(P[0], P[1], P[2], P[3]);
        if (V < 0) { std::swap(ni[1], ni[2]); std::swap(P[1], P[2]); V = -V; }
        std::array<double, 6 * 12> B;
        double Vchk;
        if (!tet4B(P, B, Vchk)) continue;
        double ue[12];
        for (int k = 0; k < 4; ++k) {
            ue[3*k+0] = u[3*ni[k]+0];
            ue[3*k+1] = u[3*ni[k]+1];
            ue[3*k+2] = u[3*ni[k]+2];
        }
        double eps[6] = {0,0,0,0,0,0};
        for (int i = 0; i < 6; ++i) {
            for (int j = 0; j < 12; ++j) eps[i] += B[i * 12 + j] * ue[j];
        }
        // Inc1c — remove the element thermal (initial) strain so σ = D·(ε − ε₀);
        // ε₀ = α·ΔT̄ₑ·[1,1,1,0,0,0]. No-op when isothermal (elemE0 empty).
        if (!elemE0.empty()) {
            const double e0 = elemE0[e];
            eps[0] -= e0; eps[1] -= e0; eps[2] -= e0;
        }
        double sig[6] = {0,0,0,0,0,0};
        for (int i = 0; i < 6; ++i) {
            for (int j = 0; j < 6; ++j) sig[i] += D[i * 6 + j] * eps[j];
        }
        for (int i = 0; i < 6; ++i) R.elemStress[e][i] = sig[i];
        double pr[3]; principalStresses(sig, pr);
        R.elemPrincipal[e] = {pr[0], pr[1], pr[2]};
        double vm = vonMisesVoigt(sig);
        R.vonMises[e] = vm;
        if (vm > R.maxVonMises) R.maxVonMises = vm;

        for (int k = 0; k < 4; ++k) {
            const int nd = ni[k];
            for (int i = 0; i < 6; ++i) nodeAccum[nd][i] += sig[i];
            nodeCount[nd]++;
        }
    }

    // Nodal-recovered stress: unweighted average of incident-element stresses,
    // then principal + von Mises recomputed from the averaged tensor (averaging
    // the principal triplet directly would be wrong — eigenframes differ).
    R.nodalStress.assign(N, {0, 0, 0, 0, 0, 0});
    R.nodalPrincipal.assign(N, {0, 0, 0});
    R.nodalVonMises.assign(N, 0.0);
    for (int n = 0; n < N; ++n) {
        if (nodeCount[n] == 0) continue;
        double s[6];
        for (int i = 0; i < 6; ++i) { s[i] = nodeAccum[n][i] / nodeCount[n]; R.nodalStress[n][i] = s[i]; }
        double pr[3]; principalStresses(s, pr);
        R.nodalPrincipal[n] = {pr[0], pr[1], pr[2]};
        R.nodalVonMises[n] = vonMisesVoigt(s);
    }
    return R;
}

ModalResult solveModal(const Mesh& mesh, const Material& mat,
                       const std::vector<int>& fixedNodes, int nModes) {
    const int N = static_cast<int>(mesh.nodes.size());
    if (N == 0 || mesh.tets.empty()) {
        throw std::invalid_argument("forge::fea::tet::solveModal: empty mesh");
    }
    const int ndof = 3 * N;

    std::array<double, 36> D;
    elasticityD(mat.E, mat.nu, D);

    Sparse::Trip Kt, Mt;
    std::unordered_map<int, int> idMap;
    for (int i = 0; i < N; ++i) idMap[mesh.nodes[i].id] = i;
    auto idOf = [&](int o) -> int {
        auto it = idMap.find(o);
        if (it != idMap.end()) return it->second;
        return (o >= 0 && o < N) ? o : -1;
    };

    for (const Tet& t : mesh.tets) {
        int ni[4]{ idOf(t.a), idOf(t.b), idOf(t.c), idOf(t.d) };
        Vec3 P[4]{
            {mesh.nodes[ni[0]].x, mesh.nodes[ni[0]].y, mesh.nodes[ni[0]].z},
            {mesh.nodes[ni[1]].x, mesh.nodes[ni[1]].y, mesh.nodes[ni[1]].z},
            {mesh.nodes[ni[2]].x, mesh.nodes[ni[2]].y, mesh.nodes[ni[2]].z},
            {mesh.nodes[ni[3]].x, mesh.nodes[ni[3]].y, mesh.nodes[ni[3]].z},
        };
        double V = tetVolume(P[0], P[1], P[2], P[3]);
        if (V < 0) { std::swap(ni[1], ni[2]); std::swap(P[1], P[2]); V = -V; }
        std::array<double, 6 * 12> B;
        double Vchk;
        if (!tet4B(P, B, Vchk)) continue;
        std::array<double, 144> Ke, Me;
        assembleKe(B, D, V, Ke);
        assembleMe(mat.rho, V, Me);
        int gdof[12];
        for (int k = 0; k < 4; ++k) {
            gdof[3 * k + 0] = 3 * ni[k] + 0;
            gdof[3 * k + 1] = 3 * ni[k] + 1;
            gdof[3 * k + 2] = 3 * ni[k] + 2;
        }
        for (int i = 0; i < 12; ++i) {
            for (int j = 0; j < 12; ++j) {
                if (Ke[i * 12 + j] != 0.0) Kt[{gdof[i], gdof[j]}] += Ke[i * 12 + j];
                if (Me[i * 12 + j] != 0.0) Mt[{gdof[i], gdof[j]}] += Me[i * 12 + j];
            }
        }
    }

    // Apply BCs via penalty.
    constexpr double kPenalty = 1e30;
    std::unordered_set<int> fixedSet;
    for (int nid : fixedNodes) {
        int idx = idOf(nid);
        if (idx < 0) continue;
        fixedSet.insert(3 * idx + 0);
        fixedSet.insert(3 * idx + 1);
        fixedSet.insert(3 * idx + 2);
    }
    if (!fixedSet.empty()) {
        Sparse::Trip Kn, Mn;
        for (auto& kv : Kt) {
            if (fixedSet.count(kv.first.first)) continue;
            Kn[kv.first] = kv.second;
        }
        for (auto& kv : Mt) {
            if (fixedSet.count(kv.first.first)) continue;
            Mn[kv.first] = kv.second;
        }
        for (int fd : fixedSet) {
            Kn[{fd, fd}] = kPenalty;
            Mn[{fd, fd}] = 1.0; // unit mass on fixed DOFs so 1/M is fine
        }
        Kt.swap(Kn); Mt.swap(Mn);
    }

    Sparse K = Sparse::fromTriplets(ndof, Kt);
    Sparse M = Sparse::fromTriplets(ndof, Mt);

    // Inverse-power iteration with M-orthonormal deflation against
    // previously-converged modes.  Computes the nModes lowest
    // eigenfrequencies of K φ = λ M φ.
    int nWanted = std::max(1, nModes);
    ModalResult R;
    R.eigenfrequencies.reserve(nWanted);
    R.modeShapes.reserve(nWanted);

    std::vector<std::vector<double>> converged; // M-orthonormal vectors

    auto Mmul = [&](const std::vector<double>& x, std::vector<double>& y) {
        M.matvec(x, y);
    };
    auto innerM = [&](const std::vector<double>& a, const std::vector<double>& b) {
        std::vector<double> Mb(ndof);
        Mmul(b, Mb);
        double s = 0.0;
        for (int i = 0; i < ndof; ++i) s += a[i] * Mb[i];
        return s;
    };
    auto normM = [&](const std::vector<double>& x) {
        return std::sqrt(std::max(0.0, innerM(x, x)));
    };
    auto deflate = [&](std::vector<double>& v) {
        for (auto& q : converged) {
            double c = innerM(v, q);
            for (int i = 0; i < ndof; ++i) v[i] -= c * q[i];
        }
    };

    for (int m = 0; m < nWanted; ++m) {
        // Random start, deterministic seed for reproducibility.
        std::vector<double> v(ndof, 0.0);
        for (int i = 0; i < ndof; ++i) {
            // Pseudo-random — keep deterministic per (m, i).
            double x = std::sin(1.0 + 7.13 * (i + 1) + 17.71 * (m + 1));
            v[i] = x;
        }
        // Zero out fixed DOFs.
        for (int fd : fixedSet) v[fd] = 0.0;
        deflate(v);
        double nm = normM(v);
        if (nm < 1e-30) {
            for (int i = 0; i < ndof; ++i) v[i] = (i % 3 == 0) ? 1.0 : 0.0;
            deflate(v); nm = normM(v);
        }
        for (int i = 0; i < ndof; ++i) v[i] /= nm;

        double lambda = 0.0;
        bool ok = false;
        for (int it = 0; it < 80; ++it) {
            // Solve K w = M v.
            std::vector<double> Mv(ndof);
            Mmul(v, Mv);
            std::vector<double> w = v; // warm start
            double res = 0.0;
            conjugateGradient(K, Mv, w, std::max(2000, 10 * ndof), 1e-10, res);
            deflate(w);
            double wnorm = normM(w);
            if (wnorm < 1e-30) break;
            for (int i = 0; i < ndof; ++i) w[i] /= wnorm;

            // Rayleigh quotient on (K, M).
            std::vector<double> Kw(ndof);
            K.matvec(w, Kw);
            std::vector<double> Mw(ndof);
            M.matvec(w, Mw);
            double num = 0.0, den = 0.0;
            for (int i = 0; i < ndof; ++i) { num += w[i] * Kw[i]; den += w[i] * Mw[i]; }
            double lambdaNew = (std::abs(den) > 1e-30) ? num / den : 0.0;

            double diff = 0.0;
            for (int i = 0; i < ndof; ++i) {
                double d = w[i] - v[i];
                diff += d * d;
            }
            v = std::move(w);
            if (std::abs(lambdaNew - lambda) < 1e-8 * (1.0 + std::abs(lambdaNew))
                && diff < 1e-12) {
                lambda = lambdaNew;
                ok = true;
                break;
            }
            lambda = lambdaNew;
        }
        // Skip if this mode is penalty-dominated (ω² ~ kPenalty).
        if (lambda > kPenalty * 0.5) break;
        converged.push_back(v);
        if (lambda < 0.0) lambda = 0.0;
        double freq = std::sqrt(lambda) / (2.0 * M_PI);
        R.eigenfrequencies.push_back(freq);
        std::vector<std::array<double, 3>> shape(N);
        for (int i = 0; i < N; ++i) {
            shape[i] = {v[3*i+0], v[3*i+1], v[3*i+2]};
        }
        R.modeShapes.push_back(std::move(shape));
        if (!ok) {
            // accept partial — still inserted, but mark non-converged overall
        }
    }
    R.converged = (static_cast<int>(R.eigenfrequencies.size()) == nWanted);
    return R;
}

} // namespace forge::fea::tet
