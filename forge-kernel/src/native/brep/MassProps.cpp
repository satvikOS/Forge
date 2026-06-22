// forge/native/brep/MassProps.cpp
//
// Implementation of the in-house B-rep mass-properties (MassProps.hpp). Pure
// C++20, no external deps. See header for the divergence-theorem method.

#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Surface.hpp"

#include <array>
#include <cmath>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// Accumulator of the ten divergence-theorem surface integrals + area.
struct Accum {
    double vol = 0;            // ∮ x n_x dA  == V
    double mx = 0, my = 0, mz = 0;        // ∮ x²/2 n_x dA == ∫ x dV, etc.
    double ixx = 0, iyy = 0, izz = 0;     // ∫ x² dV, ∫ y² dV, ∫ z² dV (about origin)
    double ixy = 0, iyz = 0, izx = 0;     // ∫ xy dV, ∫ yz dV, ∫ zx dV (about origin)
    double area = 0;
};

// Add one quadrature sample: point p, outward unit normal n, scalar weight w
// (= |S_u x S_v| * gaussWeight, the differential area dA).
inline void addSample(Accum& a, const Vec3& p, const Vec3& n, double w) {
    const double x = p.x, y = p.y, z = p.z;
    a.area += w;
    // Volume & first moments via the symmetric-free single-axis divergence form.
    a.vol += x * n.x * w;                        // div(x,0,0)=1
    a.mx  += 0.5 * x * x * n.x * w;              // div(x²/2,0,0)=x
    a.my  += 0.5 * y * y * n.y * w;              // div(0,y²/2,0)=y
    a.mz  += 0.5 * z * z * n.z * w;              // div(0,0,z²/2)=z
    // Second moments about the ORIGIN.
    a.ixx += (x * x * x / 3.0) * n.x * w;        // ∫x² dV  = ∮ x³/3 n_x dA
    a.iyy += (y * y * y / 3.0) * n.y * w;        // ∫y² dV
    a.izz += (z * z * z / 3.0) * n.z * w;        // ∫z² dV
    a.ixy += 0.5 * x * x * y * n.x * w;          // ∫xy dV = ∮ x²y/2 n_x dA
    a.iyz += 0.5 * y * y * z * n.y * w;          // ∫yz dV
    a.izx += 0.5 * z * z * x * n.z * w;          // ∫zx dV
}

// Gauss-Legendre nodes/weights on [-1,1] for n in {2..10}. Returned mapped to
// [0,1]. Hard-coded high-precision values (standard tables).
void gauss01(int n, std::vector<double>& xs, std::vector<double>& ws) {
    // nodes/weights on [-1,1]
    std::vector<double> x, w;
    switch (n) {
    case 2:
        x = {-0.5773502691896257, 0.5773502691896257};
        w = {1.0, 1.0}; break;
    case 3:
        x = {-0.7745966692414834, 0.0, 0.7745966692414834};
        w = {0.5555555555555556, 0.8888888888888888, 0.5555555555555556}; break;
    case 4:
        x = {-0.8611363115940526, -0.3399810435848563,
              0.3399810435848563, 0.8611363115940526};
        w = {0.3478548451374538, 0.6521451548625461,
             0.6521451548625461, 0.3478548451374538}; break;
    case 5:
        x = {-0.9061798459386640, -0.5384693101056831, 0.0,
              0.5384693101056831, 0.9061798459386640};
        w = {0.2369268850561891, 0.4786286704993665, 0.5688888888888889,
             0.4786286704993665, 0.2369268850561891}; break;
    case 6:
        x = {-0.9324695142031521, -0.6612093864662645, -0.2386191860831969,
              0.2386191860831969, 0.6612093864662645, 0.9324695142031521};
        w = {0.1713244923791704, 0.3607615730481386, 0.4679139345726910,
             0.4679139345726910, 0.3607615730481386, 0.1713244923791704}; break;
    case 7:
        x = {-0.9491079123427585, -0.7415311855993945, -0.4058451513773972, 0.0,
              0.4058451513773972, 0.7415311855993945, 0.9491079123427585};
        w = {0.1294849661688697, 0.2797053914892766, 0.3818300505051189,
             0.4179591836734694, 0.3818300505051189, 0.2797053914892766,
             0.1294849661688697}; break;
    case 10:
        x = {-0.9739065285171717, -0.8650633666889845, -0.6794095682990244,
             -0.4333953941292472, -0.1488743389816312, 0.1488743389816312,
              0.4333953941292472, 0.6794095682990244, 0.8650633666889845,
              0.9739065285171717};
        w = {0.0666713443086881, 0.1494513491505806, 0.2190863625159820,
             0.2692667193099963, 0.2955242247147529, 0.2955242247147529,
             0.2692667193099963, 0.2190863625159820, 0.1494513491505806,
             0.0666713443086881}; break;
    case 8:
    default:
        x = {-0.9602898564975363, -0.7966664774136267, -0.5255324099163290,
             -0.1834346424956498, 0.1834346424956498, 0.5255324099163290,
              0.7966664774136267, 0.9602898564975363};
        w = {0.1012285362903763, 0.2223810344533745, 0.3137066458778873,
             0.3626837833783620, 0.3626837833783620, 0.3137066458778873,
             0.2223810344533745, 0.1012285362903763}; break;
    }
    xs.resize(x.size()); ws.resize(w.size());
    for (std::size_t i = 0; i < x.size(); ++i) {
        xs[i] = 0.5 * (x[i] + 1.0);   // map [-1,1] -> [0,1]
        ws[i] = 0.5 * w[i];           // weight scaled by Jacobian of the map
    }
}

// Integrate one curved (or any) face by tensor Gauss-Legendre over its trim
// window [u0,u1]x[v0,v1]. Uses the analytic Jacobian |S_u x S_v| and the
// parametric normal, sign-corrected to point OUTWARD by comparing against the
// surface's intended outward normal (`reversed` handled inside normalAt, but we
// re-derive from the cross product so the trim-orientation cannot fool us).
void integrateParametric(const Face* f, int gaussN, Accum& acc) {
    const Surface* s = f->surface;
    std::vector<double> gu, gw, gv, gwv;
    gauss01(gaussN, gu, gw);
    gv = gu; gwv = gw;
    const double du = f->u1 - f->u0;
    const double dv = f->v1 - f->v0;
    for (std::size_t a = 0; a < gu.size(); ++a) {
        double u = f->u0 + du * gu[a];
        for (std::size_t b = 0; b < gv.size(); ++b) {
            double v = f->v0 + dv * gv[b];
            Vec3 p, su, sv;
            s->evaluateDeriv(u, v, p, su, sv);
            double jac = vlen(vcross(su, sv));
            if (jac <= 0.0) continue;
            // Use the surface's OWN outward normal (honours `reversed`), so the
            // material side is taken from the topology, not guessed from the
            // (left/right-handed) parameterization. The downstream global-volume
            // guard then only has to fix a globally-flipped shell, never an
            // individual mis-oriented face (e.g. a tube's inner wall).
            Vec3 n = s->normalAt(u, v);
            double w = jac * gw[a] * gwv[b] * du * dv;
            addSample(acc, p, n, w);
        }
    }
}

// Integrate one PLANAR face exactly by triangulating its polygon (fan from
// vertex 0) and applying a degree-3-exact triangle quadrature (the integrands
// are at most cubic monomials, the Jacobian is constant on a flat triangle, so
// this is EXACT to rounding). The polygon vertices come from the face's outer
// loop in ring order; the constant outward normal comes from the plane.
void integratePlanarExact(const Face* f, Accum& acc) {
    // Recover the ordered ring of 3D points by walking the loop's coedges.
    std::vector<Vec3> pts;
    Loop* lp = f->outerLoop;
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
        Vertex* o = c->originVertex();
        pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
        c = c->next;
    }
    if (pts.size() < 3) return;

    const Surface* s = f->surface;
    Vec3 n = s->normalAt(0.5 * (f->u0 + f->u1), 0.5 * (f->v0 + f->v1));

    // Degree-3-exact symmetric 4-point triangle rule (Strang/Hammer), barycentric.
    struct TQ { double a, b, c, w; };
    static const TQ rule[4] = {
        {1.0 / 3, 1.0 / 3, 1.0 / 3, -27.0 / 48.0},
        {0.6, 0.2, 0.2, 25.0 / 48.0},
        {0.2, 0.6, 0.2, 25.0 / 48.0},
        {0.2, 0.2, 0.6, 25.0 / 48.0},
    };
    const Vec3& P0 = pts[0];
    for (std::size_t t = 1; t + 1 < pts.size(); ++t) {
        const Vec3& P1 = pts[t];
        const Vec3& P2 = pts[t + 1];
        Vec3 e1 = vsub(P1, P0), e2 = vsub(P2, P0);
        double A = 0.5 * vlen(vcross(e1, e2)); // triangle area
        if (A <= 0.0) continue;
        // The 4-point rule weights q.w sum to 1, so ∫_T f dA ≈ A * Σ q.w f(b_i).
        for (const auto& q : rule) {
            Vec3 p = vadd(vadd(vscale(P0, q.a), vscale(P1, q.b)), vscale(P2, q.c));
            addSample(acc, p, n, q.w * A);
        }
    }
}

// Integrate an EXACT circular disk / annular sector planar face in polar
// coordinates. The face is in the plane through `origin` with constant outward
// normal; it spans theta in [u0,u1] and radius in [v0,v1] (== [diskInner,
// diskOuter] in the canonical builders). dA = rho d(rho) d(theta). Gauss order
// is bumped to 10 in rho to keep the cubic-in-position integrands exact.
void integrateDiskExact(const Face* f, Accum& acc) {
    const Surface* s = f->surface;
    Vec3 n = s->normalAt(0.5 * (f->u0 + f->u1), 0.5 * (f->v0 + f->v1));
    Vec3 er = s->refDir;
    Vec3 et = s->binormal();
    std::vector<double> gt, gtw, gr, grw;
    gauss01(10, gt, gtw);
    gr = gt; grw = gtw;
    const double t0 = f->u0, t1 = f->u1, r0 = f->v0, r1 = f->v1;
    const double dt = t1 - t0, dr = r1 - r0;
    for (std::size_t a = 0; a < gt.size(); ++a) {
        double th = t0 + dt * gt[a];
        double ct = std::cos(th), st = std::sin(th);
        for (std::size_t b = 0; b < gr.size(); ++b) {
            double rho = r0 + dr * gr[b];
            Vec3 p = vadd(s->origin, vadd(vscale(er, rho * ct), vscale(et, rho * st)));
            double w = rho * gtw[a] * grw[b] * dt * dr; // rho dA Jacobian
            addSample(acc, p, n, w);
        }
    }
}

} // namespace

MassProps massProperties(const Solid& solid, int gaussN) {
    Accum acc;
    for (Shell* sh : solid.shells) {
        for (Face* f : sh->faces) {
            if (f->surface == nullptr) continue; // bare-topology face: skip (no geometry)
            if (f->surface->kind == SurfaceKind::Plane) {
                if (f->surface->isDisk) integrateDiskExact(f, acc);
                else                    integratePlanarExact(f, acc);
            } else {
                integrateParametric(f, gaussN, acc);
            }
        }
    }

    // Global orientation guard: the per-face sign correction only makes each
    // face self-consistent, not globally outward (a parameterization may be
    // left-handed). The divergence theorem fixes this unambiguously — if the net
    // signed volume came out negative the whole boundary was integrated with
    // INWARD normals, so flip every accumulated moment uniformly (this is exactly
    // the integral with outward normals; area, being ∮dA, is sign-independent and
    // already positive). Robust for convex AND for the genus-1 torus/tube where a
    // centroid-interior test would fail.
    if (acc.vol < 0.0) {
        acc.vol = -acc.vol;
        acc.mx = -acc.mx; acc.my = -acc.my; acc.mz = -acc.mz;
        acc.ixx = -acc.ixx; acc.iyy = -acc.iyy; acc.izz = -acc.izz;
        acc.ixy = -acc.ixy; acc.iyz = -acc.iyz; acc.izx = -acc.izx;
    }

    MassProps out;
    out.volume = acc.vol;
    out.area = acc.area;
    const double V = acc.vol;
    if (std::fabs(V) > 0.0) {
        out.com[0] = acc.mx / V;
        out.com[1] = acc.my / V;
        out.com[2] = acc.mz / V;
    }
    // Inertia about the ORIGIN:
    //   Ixx = ∫(y²+z²)dV = iyy + izz ; Iyy = izz + ixx ; Izz = ixx + iyy
    //   Ixy = -∫xy dV ; Iyz = -∫yz dV ; Izx = -∫zx dV
    double IxxO = acc.iyy + acc.izz;
    double IyyO = acc.izz + acc.ixx;
    double IzzO = acc.ixx + acc.iyy;
    double IxyO = -acc.ixy;
    double IyzO = -acc.iyz;
    double IzxO = -acc.izx;
    // Huygens parallel-axis shift to the COM: I_com = I_O - m * shift.
    const double cx = out.com[0], cy = out.com[1], cz = out.com[2];
    const double m = V; // unit density
    // Diagonal:  I_O = I_C + m*(perp distance²)  =>  I_C = I_O - m*(...).
    double IxxC = IxxO - m * (cy * cy + cz * cz);
    double IyyC = IyyO - m * (cz * cz + cx * cx);
    double IzzC = IzzO - m * (cx * cx + cy * cy);
    // Products:  Ixy(O) = Ixy(C) - m*cx*cy  =>  Ixy(C) = Ixy(O) + m*cx*cy.
    double IxyC = IxyO + m * cx * cy;
    double IyzC = IyzO + m * cy * cz;
    double IzxC = IzxO + m * cz * cx;

    out.inertiaCom[0] = IxxC; out.inertiaCom[1] = IxyC; out.inertiaCom[2] = IzxC;
    out.inertiaCom[3] = IxyC; out.inertiaCom[4] = IyyC; out.inertiaCom[5] = IyzC;
    out.inertiaCom[6] = IzxC; out.inertiaCom[7] = IyzC; out.inertiaCom[8] = IzzC;
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
