// dump_steinmetz.cpp — K1.3 milestone: two equal orthogonal cylinders and the
// MARCHED NURBS surface-surface intersection seam (intersectNurbsSurfaces). The
// two cylinders are drawn semi-transparent; the seam is the bright curve the
// SSI marcher produced — the Steinmetz bicylinder seam (exactly 2 closed loops).
#include "forge/native/brep/NurbsSurfaceIntersect.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Nurbs.hpp"
#include <cmath>
#include <cstdio>
#include <vector>
using namespace forge::native::brep;
constexpr double PI = 3.14159265358979323846;

static Vec3 vnorm_(Vec3 v) { double m = std::sqrt(v.x*v.x+v.y*v.y+v.z*v.z); return {v.x/m, v.y/m, v.z/m}; }
static Vec3 vcross_(Vec3 a, Vec3 b) { return {a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x}; }

static Surface cylSurf(Vec3 b, Vec3 ax, double r) {
    Surface s; s.kind = SurfaceKind::Cylinder; s.origin = b; s.axis = vnorm_(ax); s.r1 = r;
    Vec3 t = (std::fabs(s.axis.x) < 0.9) ? Vec3{1,0,0} : Vec3{0,1,0};
    s.refDir = vnorm_(vcross_(s.axis, t)); return s;
}

// Parametric cylinder triangle mesh. axis: 0=+x, 2=+z.
static void cylMesh(int axis, double R, double L, int nT, int nL,
                    std::vector<double>& pos, std::vector<unsigned>& idx) {
    unsigned base = (unsigned)(pos.size()/3);
    for (int i = 0; i <= nL; ++i) {
        double t = -L + 2*L*i/nL;
        for (int j = 0; j <= nT; ++j) {
            double a = 2*PI*j/nT, c = R*std::cos(a), s = R*std::sin(a);
            if (axis == 0) { pos.push_back(t); pos.push_back(c); pos.push_back(s); }
            else           { pos.push_back(c); pos.push_back(s); pos.push_back(t); }
        }
    }
    int stride = nT + 1;
    for (int i = 0; i < nL; ++i) for (int j = 0; j < nT; ++j) {
        unsigned a = base + i*stride + j, b = a+1, cc = a+stride, d = cc+1;
        idx.push_back(a); idx.push_back(cc); idx.push_back(b);
        idx.push_back(b); idx.push_back(cc); idx.push_back(d);
    }
}

int main() {
    const double R = 1.5, L = 2.4;
    Surface cA = cylSurf({0,0,0}, {1,0,0}, R);
    Surface cB = cylSurf({0,0,0}, {0,0,1}, R);
    PromotedSurface pA = promoteToNurbs(cA, 1.0, 3.0*R);
    PromotedSurface pB = promoteToNurbs(cB, 1.0, 3.0*R);
    if (!pA.ok || !pB.ok) { std::fprintf(stderr, "promote failed\n"); return 1; }
    NurbsSSIOptions opt; opt.tol = 1e-10; opt.subdiv = 32;
    NurbsSSIResult r = intersectNurbsSurfaces(pA.surface, pB.surface, opt);
    std::printf("steinmetz SSI: branches=%zu maxResid=%.2e\n", r.branchCount, r.maxResidual);

    std::vector<double> cylApos, cylBpos; std::vector<unsigned> cylAidx, cylBidx;
    cylMesh(0, R, L, 96, 2, cylApos, cylAidx);
    cylMesh(2, R, L, 96, 2, cylBpos, cylBidx);

    FILE* fp = std::fopen("/tmp/ms_steinmetz.json", "w");
    std::fprintf(fp, "{\"meshes\":[");
    auto emitMesh = [&](std::vector<double>& p, std::vector<unsigned>& ix, const char* col, double op, bool comma) {
        std::fprintf(fp, "%s{\"color\":%s,\"opacity\":%.2f,\"positions\":[", comma ? "," : "", col, op);
        for (size_t i=0;i<p.size();++i) std::fprintf(fp, "%s%.5g", i?",":"", p[i]);
        std::fprintf(fp, "],\"indices\":[");
        for (size_t i=0;i<ix.size();++i) std::fprintf(fp, "%s%u", i?",":"", ix[i]);
        std::fprintf(fp, "]}");
    };
    emitMesh(cylApos, cylAidx, "5476143", 0.45, false);   // 0x539daf teal
    emitMesh(cylBpos, cylBidx, "9078920", 0.45, true);    // 0x8a8a88 grey
    std::fprintf(fp, "],\"lines\":[");
    for (size_t b = 0; b < r.branches.size(); ++b) {
        const auto& pts = r.branches[b].points;
        std::fprintf(fp, "%s{\"color\":16734268,\"radius\":0.045,\"points\":[", b?",":"");  // 0xff5a3c
        for (size_t i=0;i<pts.size();++i) std::fprintf(fp, "%s%.5g,%.5g,%.5g", i?",":"", pts[i].x, pts[i].y, pts[i].z);
        std::fprintf(fp, "]}");
    }
    std::fprintf(fp, "]}");
    std::fclose(fp);
    std::printf("wrote /tmp/ms_steinmetz.json (2 cylinders + %zu seam branches)\n", r.branchCount);
    return 0;
}
