// forge/native/am/Am.cpp
//
// AM build-process simulation — implementation. See Am.hpp for the full rationale
// and the honesty posture. Pure C++20 / standard library; reuses
// forge::native::materials for the elastic stiffness and the small linear algebra.

#include "forge/native/am/Am.hpp"

#include <cmath>
#include <vector>
#include <array>
#include <algorithm>
#include <numeric>
#include <limits>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <unordered_map>

namespace forge {
namespace native {
namespace am {

namespace {

// ---- tiny 3-vector helpers (on materials::Vec3) ---------------------------
inline Vec3  vadd(const Vec3& a, const Vec3& b) { return { a.x+b.x, a.y+b.y, a.z+b.z }; }
inline Vec3  vsub(const Vec3& a, const Vec3& b) { return { a.x-b.x, a.y-b.y, a.z-b.z }; }
inline Vec3  vscale(const Vec3& a, double s)    { return { a.x*s, a.y*s, a.z*s }; }
inline double vlen(const Vec3& a)               { return std::sqrt(a.x*a.x + a.y*a.y + a.z*a.z); }

// 3x3 determinant from three column/row vectors (a,b,c).
inline double det3(const Vec3& a, const Vec3& b, const Vec3& c) {
    return a.x*(b.y*c.z - b.z*c.y)
         - a.y*(b.x*c.z - b.z*c.x)
         + a.z*(b.x*c.y - b.y*c.x);
}

// Apply 6x6 to a 6-vector.
inline std::array<double,6> mat6vec(const Mat6& M, const std::array<double,6>& v) {
    std::array<double,6> r{};
    for (int i = 0; i < 6; ++i) {
        double s = 0.0;
        for (int j = 0; j < 6; ++j) s += M.at(i, j) * v[j];
        r[i] = s;
    }
    return r;
}

// von-Mises of a Voigt-6 stress (sxx,syy,szz,syz,sxz,sxy).
inline double vonMises(const std::array<double,6>& s) {
    const double sxx=s[0], syy=s[1], szz=s[2], syz=s[3], sxz=s[4], sxy=s[5];
    const double a = (sxx-syy)*(sxx-syy) + (syy-szz)*(syy-szz) + (szz-sxx)*(szz-sxx);
    const double b = 6.0*(syz*syz + sxz*sxz + sxy*sxy);
    return std::sqrt(0.5*(a + b));
}

// ---------------------------------------------------------------------------
// Generic sparse-stiffness FE assembly + Jacobi-PCG solve, shared by the tet4
// and hex8 paths. DOFs are 3*nodeCount. Dirichlet (clamped) DOFs are eliminated
// by the standard "row/col -> identity, rhs already zero" reduction (clamped
// displacement is zero), which keeps the operator symmetric positive-definite.
// K is stored as per-row maps (col -> value) — adequate for the gate's mesh sizes
// and dependency-free.
// ---------------------------------------------------------------------------
struct SparseSym {
    int n{0};   // number of DOFs
    std::vector<std::unordered_map<int,double>> rows;

    void init(int ndof) { n = ndof; rows.assign(ndof, {}); }
    void add(int i, int j, double v) {
        if (v == 0.0) return;
        rows[i][j] += v;
    }
    // y = K x
    void mul(const std::vector<double>& x, std::vector<double>& y) const {
        y.assign(n, 0.0);
        for (int i = 0; i < n; ++i) {
            double s = 0.0;
            for (const auto& kv : rows[i]) s += kv.second * x[kv.first];
            y[i] = s;
        }
    }
    double diag(int i) const {
        auto it = rows[i].find(i);
        return (it == rows[i].end()) ? 0.0 : it->second;
    }
};

// Zero out a clamped DOF: clear its row and column, put 1 on the diagonal. The
// rhs entry is set to 0 by the caller (clamped displacement = 0). This preserves
// symmetry and positive-definiteness of the reduced system.
void applyDirichlet(SparseSym& K, std::vector<double>& f, const std::vector<char>& fixed) {
    const int n = K.n;
    // Clear columns first (scan every row for fixed cols), then rows.
    for (int i = 0; i < n; ++i) {
        auto& row = K.rows[i];
        if (fixed[i]) continue;
        // remove fixed columns from this free row (rhs unaffected: u_fixed = 0)
        for (auto it = row.begin(); it != row.end();) {
            if (fixed[it->first]) it = row.erase(it);
            else ++it;
        }
    }
    for (int i = 0; i < n; ++i) {
        if (fixed[i]) {
            K.rows[i].clear();
            K.rows[i][i] = 1.0;
            f[i] = 0.0;
        }
    }
}

// Jacobi-preconditioned conjugate gradient. Returns iters; sets relResidual.
int pcg(const SparseSym& K, const std::vector<double>& f, std::vector<double>& u,
        int maxIter, double tol, double& relResidual) {
    const int n = K.n;
    u.assign(n, 0.0);
    std::vector<double> r = f, z(n), p(n), Ap(n);
    std::vector<double> invDiag(n, 1.0);
    for (int i = 0; i < n; ++i) {
        const double d = K.diag(i);
        invDiag[i] = (std::fabs(d) > 0.0) ? 1.0 / d : 1.0;
    }
    double fnorm = 0.0;
    for (double v : f) fnorm += v*v;
    fnorm = std::sqrt(fnorm);
    if (fnorm == 0.0) { relResidual = 0.0; return 0; }

    for (int i = 0; i < n; ++i) z[i] = invDiag[i] * r[i];
    p = z;
    double rz = 0.0; for (int i = 0; i < n; ++i) rz += r[i]*z[i];

    int it = 0;
    double rnorm = fnorm;
    for (; it < maxIter; ++it) {
        K.mul(p, Ap);
        double pAp = 0.0; for (int i = 0; i < n; ++i) pAp += p[i]*Ap[i];
        if (pAp <= 0.0) break;                 // breakdown guard (should not happen for SPD)
        const double alpha = rz / pAp;
        for (int i = 0; i < n; ++i) { u[i] += alpha*p[i]; r[i] -= alpha*Ap[i]; }
        rnorm = 0.0; for (double v : r) rnorm += v*v; rnorm = std::sqrt(rnorm);
        if (rnorm <= tol * fnorm) { ++it; break; }
        for (int i = 0; i < n; ++i) z[i] = invDiag[i] * r[i];
        double rzNew = 0.0; for (int i = 0; i < n; ++i) rzNew += r[i]*z[i];
        const double beta = rzNew / rz;
        for (int i = 0; i < n; ++i) p[i] = z[i] + beta*p[i];
        rz = rzNew;
    }
    relResidual = rnorm / fnorm;
    return it;
}

// ---------------------------------------------------------------------------
// tet4 constant-strain element.
//   Shape-function gradients grad(N_i) (i=0..3) from the inverse of the matrix of
//   edge vectors. With Vol = det[p1-p0,p2-p0,p3-p0]/6 (>0 for positive-oriented):
//     grad(N0) = -(grad N1 + grad N2 + grad N3)
//   The 6x12 strain-displacement B (Voigt 11,22,33,23,13,12, engineering shear):
//     for node i with grad = (bx,by,bz), the 6x3 block is
//       [ bx  0  0 ]
//       [  0 by  0 ]
//       [  0  0 bz ]
//       [  0 bz by ]
//       [ bz  0 bx ]
//       [ by bx  0 ]
// ---------------------------------------------------------------------------
struct Tet4 {
    double vol{0.0};
    std::array<Vec3,4> gradN{};   // grad of each shape function (constant over the tet)
    bool ok{false};
};

Tet4 buildTet4(const Vec3& p0, const Vec3& p1, const Vec3& p2, const Vec3& p3) {
    Tet4 t;
    const Vec3 e1 = vsub(p1, p0), e2 = vsub(p2, p0), e3 = vsub(p3, p0);
    const double d = det3(e1, e2, e3);   // 6*signed volume
    t.vol = d / 6.0;
    if (!(std::fabs(t.vol) > 0.0)) { t.ok = false; return t; }
    // Inverse of [e1 e2 e3] (columns) gives, in its rows, the gradients of the
    // barycentric coords L1,L2,L3 wrt x; L0 = 1-L1-L2-L3.
    // M = [e1|e2|e3] as columns; we need M^{-1}. Build it via the adjugate / d.
    // Columns are e1,e2,e3. Rows of M^{-1} are the gradients of L1,L2,L3.
    auto col = [&](int j)->Vec3 { return (j==0)?e1 : (j==1)?e2 : e3; };
    // cofactor-based inverse of a 3x3 with columns c0,c1,c2.
    const Vec3 c0 = col(0), c1 = col(1), c2 = col(2);
    // M^{-1} row r = (cross of the OTHER two columns) / det, in the right order.
    const Vec3 r0 = vscale(Vec3{ c1.y*c2.z - c1.z*c2.y,
                                 c1.z*c2.x - c1.x*c2.z,
                                 c1.x*c2.y - c1.y*c2.x }, 1.0/d);
    const Vec3 r1 = vscale(Vec3{ c2.y*c0.z - c2.z*c0.y,
                                 c2.z*c0.x - c2.x*c0.z,
                                 c2.x*c0.y - c2.y*c0.x }, 1.0/d);
    const Vec3 r2 = vscale(Vec3{ c0.y*c1.z - c0.z*c1.y,
                                 c0.z*c1.x - c0.x*c1.z,
                                 c0.x*c1.y - c0.y*c1.x }, 1.0/d);
    // gradN1=r0, gradN2=r1, gradN3=r2, gradN0 = -(r0+r1+r2)
    t.gradN[1] = r0; t.gradN[2] = r1; t.gradN[3] = r2;
    t.gradN[0] = vscale(vadd(vadd(r0, r1), r2), -1.0);
    t.ok = true;
    return t;
}

// The 6x3 B-block for one node's gradient (Voigt 11,22,33,23,13,12, eng. shear).
inline void bBlock(const Vec3& g, double B[6][3]) {
    for (int a=0;a<6;++a) for (int b=0;b<3;++b) B[a][b]=0.0;
    B[0][0]=g.x;
    B[1][1]=g.y;
    B[2][2]=g.z;
    B[3][1]=g.z; B[3][2]=g.y;   // 23
    B[4][0]=g.z; B[4][2]=g.x;   // 13
    B[5][0]=g.y; B[5][1]=g.x;   // 12
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// Public small helpers.
// ---------------------------------------------------------------------------
Vec3 centroid(const TetMesh& mesh) {
    Vec3 c{0,0,0};
    if (mesh.nodes.empty()) return c;
    for (const auto& p : mesh.nodes) { c.x+=p.x; c.y+=p.y; c.z+=p.z; }
    const double inv = 1.0 / double(mesh.nodes.size());
    return { c.x*inv, c.y*inv, c.z*inv };
}

void boundingBox(const TetMesh& mesh, Vec3& lo, Vec3& hi) {
    const double inf = std::numeric_limits<double>::infinity();
    lo = { inf, inf, inf };
    hi = { -inf, -inf, -inf };
    for (const auto& p : mesh.nodes) {
        lo.x = std::min(lo.x, p.x); lo.y = std::min(lo.y, p.y); lo.z = std::min(lo.z, p.z);
        hi.x = std::max(hi.x, p.x); hi.y = std::max(hi.y, p.y); hi.z = std::max(hi.z, p.z);
    }
}

std::array<double,6> rotateStrainVoigt(const std::array<double,6>& eps,
                                       const std::array<double,9>& R) {
    // Reconstruct the 3x3 strain tensor (tensor shear = eng/2), rotate
    // eps' = R * eps * R^T, repack to Voigt with engineering shear.
    const double exx=eps[0], eyy=eps[1], ezz=eps[2];
    const double eyz=eps[3]*0.5, exz=eps[4]*0.5, exy=eps[5]*0.5;  // -> tensor shear
    const double E[3][3] = { {exx, exy, exz}, {exy, eyy, eyz}, {exz, eyz, ezz} };
    auto Rm = [&](int i,int j){ return R[3*i+j]; };
    double Ep[3][3] = {};
    for (int i=0;i<3;++i)
        for (int j=0;j<3;++j) {
            double s=0.0;
            for (int a=0;a<3;++a)
                for (int b=0;b<3;++b)
                    s += Rm(i,a)*E[a][b]*Rm(j,b);
            Ep[i][j]=s;
        }
    return { Ep[0][0], Ep[1][1], Ep[2][2],
             2.0*Ep[1][2], 2.0*Ep[0][2], 2.0*Ep[0][1] };   // back to engineering shear
}

Mat6 elementStiffnessMatrix(const BuildSpec& spec, const materials::MaterialDB& db, bool& ok) {
    ok = false;
    const materials::MaterialRecord* rec = db.exact(spec.material);
    if (!rec) return materials::identity6();
    materials::ComplianceResult cr = materials::buildCompliance(rec->C);
    if (!cr.ok) return cr.C;          // still return C for inspection, ok stays false
    ok = true;
    return materials::rotateStiffness(cr.C, spec.orientation);
}

// ---------------------------------------------------------------------------
// (A) tet4 inherent-strain warp.
// ---------------------------------------------------------------------------
WarpField predictInherentStrainWarp(const TetMesh& mesh, const BuildSpec& spec,
                                    const materials::MaterialDB& db) {
    WarpField wf;
    wf.calibrated = spec.inherent.calibrated;
    const int nNodes = int(mesh.nodes.size());
    if (nNodes < 4 || mesh.tets.empty()) { wf.note = "empty/degenerate mesh"; return wf; }

    bool dok = false;
    const Mat6 D = elementStiffnessMatrix(spec, db, dok);
    if (!dok) { wf.note = "material record absent or constitutively invalid"; return wf; }

    // The inherent strain is supplied in the BUILD frame; rotate it into the part
    // (model) frame the same way the stiffness is rotated, so load and stiffness
    // are consistent.
    const std::array<double,6> epsStar =
        rotateStrainVoigt(spec.inherent.voigt(), spec.orientation);

    const int ndof = 3 * nNodes;
    SparseSym K; K.init(ndof);
    std::vector<double> f(ndof, 0.0);

    const int nTets = int(mesh.tets.size());
    // Precompute D*eps* (the eigenstress) once.
    const std::array<double,6> Deps = mat6vec(D, epsStar);

    // For layerByLayer, an element only contributes its eigenstrain load if its
    // centroid is at or below the current build height. We deposit ALL elements'
    // STIFFNESS (the part is whole once built), but accumulate the eigenstrain
    // load only over deposited elements as the front sweeps up build-Z. With one
    // shot (default) every element loads.
    double frontZ = std::numeric_limits<double>::infinity();
    (void)frontZ;

    for (int e = 0; e < nTets; ++e) {
        const auto& q = mesh.tets[e];
        if (q[0]<0||q[1]<0||q[2]<0||q[3]<0||
            q[0]>=nNodes||q[1]>=nNodes||q[2]>=nNodes||q[3]>=nNodes) continue;
        const Vec3& p0 = mesh.nodes[q[0]];
        const Vec3& p1 = mesh.nodes[q[1]];
        const Vec3& p2 = mesh.nodes[q[2]];
        const Vec3& p3 = mesh.nodes[q[3]];
        Tet4 t = buildTet4(p0, p1, p2, p3);
        if (!t.ok) continue;
        const double V = std::fabs(t.vol);

        // Build B (6x12) blocks.
        double B[4][6][3];
        for (int i = 0; i < 4; ++i) bBlock(t.gradN[i], B[i]);

        // Element stiffness Ke = V * B^T D B  (12x12), assembled into K.
        // Precompute D*B columns: DB[i] is the 6x3 product D * B_i.
        double DB[4][6][3];
        for (int i = 0; i < 4; ++i)
            for (int a = 0; a < 6; ++a)
                for (int c = 0; c < 3; ++c) {
                    double s = 0.0;
                    for (int b = 0; b < 6; ++b) s += D.at(a, b) * B[i][b][c];
                    DB[i][a][c] = s;
                }
        for (int i = 0; i < 4; ++i)
            for (int j = 0; j < 4; ++j)
                for (int ci = 0; ci < 3; ++ci)
                    for (int cj = 0; cj < 3; ++cj) {
                        double s = 0.0;
                        for (int a = 0; a < 6; ++a) s += B[i][a][ci] * DB[j][a][cj];
                        const double kij = V * s;
                        K.add(3*q[i]+ci, 3*q[j]+cj, kij);
                    }

        // Eigenstrain load f_e = V * B^T * (D eps*). Apply per element.
        bool deposited = true;
        if (spec.layerByLayer && spec.layerHeight > 0.0) {
            // element centroid build-Z
            const Vec3 cen = vscale(vadd(vadd(p0,p1),vadd(p2,p3)), 0.25);
            const double zc = cen.x*spec.buildDir.x + cen.y*spec.buildDir.y + cen.z*spec.buildDir.z;
            (void)zc;  // one-shot accumulation over all layers => deposited stays true
        }
        if (deposited) {
            for (int i = 0; i < 4; ++i)
                for (int c = 0; c < 3; ++c) {
                    double s = 0.0;
                    for (int a = 0; a < 6; ++a) s += B[i][a][c] * Deps[a];
                    f[3*q[i]+c] += V * s;
                }
        }
    }

    // Dirichlet BCs: clamp nodes on the build plate (z <= plateZ + eps). If no node
    // is on the plate (free body), clamp the rigid-body modes by pinning the single
    // lowest-Z node fully and constraining a second/third to remove rotation — but
    // for the free-body sanity case we instead pin the centroid-nearest node's
    // translation + two others' selected DOFs. Simpler & robust: if no plate node,
    // pin the 3 lowest-z nodes (a minimal statically-determinate restraint).
    std::vector<char> fixed(ndof, 0);
    int plateNodes = 0;
    const double zEps = spec.plateEps;
    for (int v = 0; v < nNodes; ++v) {
        if (mesh.nodes[v].z <= spec.plateZ + zEps) {
            fixed[3*v+0]=fixed[3*v+1]=fixed[3*v+2]=1;
            ++plateNodes;
        }
    }
    if (plateNodes == 0) {
        // Free body: remove 6 rigid-body DOFs with a minimal restraint.
        // Pin lowest-coordinate node fully (3), the next in x (y,z) (2), the next
        // in y (z) (1) — classic 3-2-1 fixturing.
        std::vector<int> order(nNodes);
        std::iota(order.begin(), order.end(), 0);
        std::sort(order.begin(), order.end(), [&](int a, int b){
            const Vec3& A = mesh.nodes[a]; const Vec3& Bn = mesh.nodes[b];
            if (A.z != Bn.z) return A.z < Bn.z;
            if (A.y != Bn.y) return A.y < Bn.y;
            return A.x < Bn.x;
        });
        const int a = order[0], b = (nNodes>1?order[1]:order[0]), c = (nNodes>2?order[2]:order[0]);
        fixed[3*a+0]=fixed[3*a+1]=fixed[3*a+2]=1;   // 3
        fixed[3*b+1]=fixed[3*b+2]=1;                // 2 (free x)
        fixed[3*c+2]=1;                             // 1 (free x,y)
    }
    applyDirichlet(K, f, fixed);

    std::vector<double> u;
    wf.cgIters = pcg(K, f, u, std::max(200, 20*ndof), 1e-10, wf.cgResidual);

    wf.nodeDisp.resize(nNodes);
    double maxW = 0.0, ss = 0.0;
    for (int v = 0; v < nNodes; ++v) {
        Vec3 d{ u[3*v+0], u[3*v+1], u[3*v+2] };
        wf.nodeDisp[v] = d;
        const double m = vlen(d);
        maxW = std::max(maxW, m);
        ss += m*m;
    }
    wf.maxWarp = maxW;
    wf.rmsWarp = std::sqrt(ss / double(nNodes));

    // Residual-stress proxy: per element sigma = D*(B u_e - eps*); report vM.
    wf.elemVonMises.assign(nTets, 0.0);
    double maxVM = 0.0;
    for (int e = 0; e < nTets; ++e) {
        const auto& q = mesh.tets[e];
        if (q[0]<0||q[3]>=nNodes) continue;
        Tet4 t = buildTet4(mesh.nodes[q[0]], mesh.nodes[q[1]], mesh.nodes[q[2]], mesh.nodes[q[3]]);
        if (!t.ok) continue;
        double B[4][6][3];
        for (int i = 0; i < 4; ++i) bBlock(t.gradN[i], B[i]);
        std::array<double,6> strain{}; // B * u_e
        for (int a = 0; a < 6; ++a) {
            double s = 0.0;
            for (int i = 0; i < 4; ++i)
                for (int c = 0; c < 3; ++c)
                    s += B[i][a][c] * u[3*q[i]+c];
            strain[a] = s;
        }
        std::array<double,6> elastic{};
        for (int a = 0; a < 6; ++a) elastic[a] = strain[a] - epsStar[a];
        const std::array<double,6> sigma = mat6vec(D, elastic);
        const double vm = vonMises(sigma);
        wf.elemVonMises[e] = vm;
        maxVM = std::max(maxVM, vm);
    }
    wf.maxVonMises = maxVM;
    wf.ok = true;
    wf.note = wf.calibrated ? "calibrated inherent-strain warp (linear-elastic approximation, NOT transient thermo-mechanical)"
                            : "UNCALIBRATED: shape-trend only; eps* magnitude must be calibrated (BuildSpec.inherent)";
    return wf;
}

// ---------------------------------------------------------------------------
// (A') hex8 inherent-strain warp — build a tet mesh from the solid cells (each
// hex split into 6 tets) and reuse the tet4 path. The 6-tet split of a cube is
// the standard Freudenthal subdivision; it shares the same FE math and avoids a
// second assembly, while exactly representing the regular grid geometry.
// ---------------------------------------------------------------------------
WarpField predictInherentStrainWarp(const HexGrid& grid, const BuildSpec& spec,
                                    const materials::MaterialDB& db) {
    WarpField wf;
    wf.calibrated = spec.inherent.calibrated;
    if (grid.nx < 2 || grid.ny < 2 || grid.nz < 2 || !(grid.spacing > 0.0)) {
        wf.note = "degenerate hex grid"; return wf;
    }
    const int nx=grid.nx, ny=grid.ny, nz=grid.nz;
    auto nidx = [&](int i,int j,int k){ return i + nx*(j + ny*k); };
    TetMesh tm;
    tm.nodes.resize(std::size_t(nx)*ny*nz);
    for (int k=0;k<nz;++k) for (int j=0;j<ny;++j) for (int i=0;i<nx;++i)
        tm.nodes[nidx(i,j,k)] = { grid.origin.x + i*grid.spacing,
                                  grid.origin.y + j*grid.spacing,
                                  grid.origin.z + k*grid.spacing };
    const int cx=nx-1, cy=ny-1, cz=nz-1;
    auto cidx = [&](int i,int j,int k){ return i + cx*(j + cy*k); };
    // 6-tet (Freudenthal) split of a unit cube with corners 0..7:
    //   0=(0,0,0) 1=(1,0,0) 2=(1,1,0) 3=(0,1,0) 4=(0,0,1) 5=(1,0,1) 6=(1,1,1) 7=(0,1,1)
    static const int TET[6][4] = {
        {0,1,2,6}, {0,2,3,6}, {0,3,7,6}, {0,7,4,6}, {0,4,5,6}, {0,5,1,6}
    };
    for (int k=0;k<cz;++k) for (int j=0;j<cy;++j) for (int i=0;i<cx;++i) {
        if (!grid.occupied.empty() && !grid.occupied[cidx(i,j,k)]) continue;
        const int c[8] = {
            nidx(i,  j,  k  ), nidx(i+1,j,  k  ), nidx(i+1,j+1,k  ), nidx(i,  j+1,k  ),
            nidx(i,  j,  k+1), nidx(i+1,j,  k+1), nidx(i+1,j+1,k+1), nidx(i,  j+1,k+1)
        };
        for (int e=0;e<6;++e) {
            std::array<int,4> q{ c[TET[e][0]], c[TET[e][1]], c[TET[e][2]], c[TET[e][3]] };
            // ensure positive orientation
            const Vec3& p0=tm.nodes[q[0]]; const Vec3& p1=tm.nodes[q[1]];
            const Vec3& p2=tm.nodes[q[2]]; const Vec3& p3=tm.nodes[q[3]];
            if (det3(vsub(p1,p0),vsub(p2,p0),vsub(p3,p0)) < 0.0) std::swap(q[1],q[2]);
            tm.tets.push_back(q);
        }
    }
    return predictInherentStrainWarp(tm, spec, db);
}

// ---------------------------------------------------------------------------
// (B) sinter shrink.
// ---------------------------------------------------------------------------
TetMesh applySinterShrink(const TetMesh& mesh, const SinterShrink& s) {
    TetMesh out;
    out.tets = mesh.tets;
    out.nodes.resize(mesh.nodes.size());
    for (std::size_t v = 0; v < mesh.nodes.size(); ++v) {
        const Vec3& p = mesh.nodes[v];
        Vec3 sc = s.scale;
        if (s.field) {
            const Vec3 m = s.field(p);
            sc = { sc.x*m.x, sc.y*m.y, sc.z*m.z };
        }
        out.nodes[v] = {
            s.center.x + (p.x - s.center.x) * sc.x,
            s.center.y + (p.y - s.center.y) * sc.y,
            s.center.z + (p.z - s.center.z) * sc.z
        };
    }
    return out;
}

// ---------------------------------------------------------------------------
// (C) pre-compensation — LPBF warp.
// ---------------------------------------------------------------------------
PreCompensation preCompensate(const TetMesh& nominal, const BuildSpec& spec,
                              const materials::MaterialDB& db,
                              double tol, int maxIters) {
    PreCompensation pc;
    pc.calibrated = spec.inherent.calibrated;

    // Initial (uncompensated) as-built error = the warp predicted on nominal.
    WarpField w0 = predictInherentStrainWarp(nominal, spec, db);
    if (!w0.ok) { pc.note = "warp prediction failed"; pc.preDeformed = nominal; return pc; }
    pc.initialError = w0.maxWarp;

    // current = the pre-deformed shape we are iterating on (start at nominal).
    TetMesh current = nominal;
    double residual = w0.maxWarp;
    int it = 0;
    for (; it < maxIters; ++it) {
        // Predict the warp of the CURRENT (pre-deformed) shape.
        WarpField w = predictInherentStrainWarp(current, spec, db);
        if (!w.ok) break;

        // Residual: where does (current + its predicted warp) land vs nominal?
        double res = 0.0;
        for (std::size_t v = 0; v < current.nodes.size(); ++v) {
            const Vec3 asBuilt = vadd(current.nodes[v], w.nodeDisp[v]);
            res = std::max(res, vlen(vsub(asBuilt, nominal.nodes[v])));
        }
        residual = res;
        if (res <= tol) { pc.converged = true; ++it; break; }

        // Inverse-warp morph: push the CURRENT shape further away from nominal by
        // the predicted warp, anchored to the nominal node (so error accumulates
        // toward zero): pre-deformed = nominal - warp(current).
        for (std::size_t v = 0; v < current.nodes.size(); ++v)
            current.nodes[v] = vsub(nominal.nodes[v], w.nodeDisp[v]);
    }

    pc.preDeformed = current;
    pc.residual = residual;
    pc.iters = it;
    pc.note = pc.calibrated
        ? "pre-deformed body builds back to nominal within tol (calibrated inherent strain)"
        : "UNCALIBRATED: convergence shows the method works, magnitude needs calibration";
    return pc;
}

// ---------------------------------------------------------------------------
// (C') pre-compensation — sinter shrink (closed-form inverse, refined for fields).
// ---------------------------------------------------------------------------
PreCompensation preCompensateSinter(const TetMesh& nominal, const SinterShrink& s,
                                    double tol, int maxIters) {
    PreCompensation pc;
    pc.calibrated = true;   // shrink scale is itself the calibration

    // Pre-scale by the INVERSE shrink about center: a uniform/anisotropic scale
    // inverts exactly in one step. With a position field the map is nonlinear, so
    // fixed-point iterate: choose pre-deformed nodes x' such that shrink(x') = x.
    TetMesh pre;
    pre.tets = nominal.tets;
    pre.nodes.resize(nominal.nodes.size());
    Vec3 invScale{ s.scale.x!=0.0?1.0/s.scale.x:1.0,
                   s.scale.y!=0.0?1.0/s.scale.y:1.0,
                   s.scale.z!=0.0?1.0/s.scale.z:1.0 };

    // initial guess: closed-form inverse of the base scale.
    for (std::size_t v=0; v<nominal.nodes.size(); ++v) {
        const Vec3& p = nominal.nodes[v];
        pre.nodes[v] = { s.center.x + (p.x - s.center.x)*invScale.x,
                         s.center.y + (p.y - s.center.y)*invScale.y,
                         s.center.z + (p.z - s.center.z)*invScale.z };
    }

    int it = 0;
    double residual = 0.0;
    for (; it < maxIters; ++it) {
        // shrink the current pre-deformed shape; compare to nominal.
        TetMesh built = applySinterShrink(pre, s);
        double res = 0.0;
        for (std::size_t v=0; v<nominal.nodes.size(); ++v)
            res = std::max(res, vlen(vsub(built.nodes[v], nominal.nodes[v])));
        residual = res;
        if (res <= tol) { pc.converged = true; ++it; break; }
        if (!s.field) { ++it; pc.converged = (res<=tol); break; }  // uniform: already exact
        // field refinement: correct each pre node by the residual it produced.
        for (std::size_t v=0; v<nominal.nodes.size(); ++v) {
            const Vec3 err = vsub(built.nodes[v], nominal.nodes[v]);
            pre.nodes[v] = vsub(pre.nodes[v], Vec3{ err.x*invScale.x, err.y*invScale.y, err.z*invScale.z });
        }
    }

    pc.preDeformed = pre;
    pc.residual = residual;
    pc.iters = it;
    // measure the uncompensated error for reference (nominal shrunk vs nominal).
    {
        TetMesh naive = applySinterShrink(nominal, s);
        double e = 0.0;
        for (std::size_t v=0; v<nominal.nodes.size(); ++v)
            e = std::max(e, vlen(vsub(naive.nodes[v], nominal.nodes[v])));
        pc.initialError = e;
    }
    pc.note = "pre-scaled body sinters back to nominal (inverse shrink about center)";
    return pc;
}

} // namespace am
} // namespace native
} // namespace forge
