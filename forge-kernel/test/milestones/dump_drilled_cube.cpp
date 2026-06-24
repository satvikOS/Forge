// dump_drilled_cube.cpp — K2 milestone: the iconic exact-boolean stress test.
// A cube with THREE orthogonal cylindrical through-bores, produced by chaining
// meshBooleanExact DIFFERENCE three times. The three bores mutually intersect
// inside the cube (each later subtraction removes material partly already gone),
// exactly the coplanar/shared-edge/near-degenerate class K2's exact-construction
// boolean is built to survive. Result must be a single watertight 2-manifold.
#include "forge/native/mesh/MeshBooleanExact.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <vector>
using namespace forge::native::mesh;
constexpr double PI = 3.14159265358979323846;

static void makeBox(double x0,double y0,double z0,double x1,double y1,double z1,
                    std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    double v[8][3] = {{x0,y0,z0},{x1,y0,z0},{x1,y1,z0},{x0,y1,z0},{x0,y0,z1},{x1,y0,z1},{x1,y1,z1},{x0,y1,z1}};
    for (auto& p : v) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    auto quad = [&](int a,int b,int c,int d){ idx.push_back(a);idx.push_back(b);idx.push_back(c); idx.push_back(a);idx.push_back(c);idx.push_back(d); };
    quad(0,3,2,1); quad(4,5,6,7); quad(0,1,5,4); quad(2,3,7,6); quad(1,2,6,5); quad(0,4,7,3);
}

// Capped cylinder along axis (0=x,1=y,2=z), radius r, half-length h, seg facets.
// (u,v,w) is a right-handed frame so the +z winding pattern stays outward for any axis.
static void cappedCyl(int axis, double r, double h, int seg,
                      std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    double u[3]={0,0,0}, v[3]={0,0,0}, w[3]={0,0,0};
    if (axis==2){ u[0]=1; v[1]=1; w[2]=1; } else if (axis==0){ u[1]=1; v[2]=1; w[0]=1; } else { u[2]=1; v[0]=1; w[1]=1; }
    auto P=[&](double a,double t,double out[3]){ double c=std::cos(a),s=std::sin(a);
        for(int k=0;k<3;k++) out[k]=u[k]*r*c + v[k]*r*s + w[k]*t; };
    double p[3];
    for(int i=0;i<seg;i++){ P(2*PI*i/seg,-h,p); pos.push_back(p[0]);pos.push_back(p[1]);pos.push_back(p[2]); }
    for(int i=0;i<seg;i++){ P(2*PI*i/seg,+h,p); pos.push_back(p[0]);pos.push_back(p[1]);pos.push_back(p[2]); }
    std::uint32_t cb=(std::uint32_t)(pos.size()/3); for(int k=0;k<3;k++) pos.push_back(w[k]*-h);
    std::uint32_t ct=(std::uint32_t)(pos.size()/3); for(int k=0;k<3;k++) pos.push_back(w[k]*+h);
    for(int i=0;i<seg;i++){ std::uint32_t i0=i,i1=(i+1)%seg,j0=seg+i,j1=seg+(i+1)%seg;
        idx.push_back(i0);idx.push_back(i1);idx.push_back(j1); idx.push_back(i0);idx.push_back(j1);idx.push_back(j0);
        idx.push_back(cb);idx.push_back(i1);idx.push_back(i0); idx.push_back(ct);idx.push_back(j0);idx.push_back(j1); }
}

int main() {
    std::vector<double> ap, bp; std::vector<std::uint32_t> ai, bi;
    makeBox(-1.2,-1.2,-1.2, 1.2,1.2,1.2, ap, ai);
    const double R = 0.62, H = 1.6; const int SEG = 36;  // facet count kept modest: the EPECK exact boolean is correctness-first
    int axes[3] = {2, 0, 1};
    for (int s = 0; s < 3; ++s) {
        cappedCyl(axes[s], R, H, SEG, bp, bi);
        BoolResultN d = meshBooleanExact(ap, ai, bp, bi, BoolOpN::DIFFERENCE);
        if (!d.ok) { std::fprintf(stderr, "boolean %d failed\n", s); return 1; }
        d.mesh.toSoup(ap, ai);
        std::printf("bore %d (axis %d): vol=%.6f verts=%zu tris=%zu\n", s, axes[s], std::fabs(d.mesh.signedVolume()), ap.size()/3, ai.size()/3);
    }
    FILE* fp = std::fopen("/tmp/ms_drilled.json", "w");
    std::fprintf(fp, "{\"positions\":[");
    for (size_t i=0;i<ap.size();++i) std::fprintf(fp, "%s%.6g", i?",":"", ap[i]);
    std::fprintf(fp, "],\"indices\":[");
    for (size_t i=0;i<ai.size();++i) std::fprintf(fp, "%s%u", i?",":"", ai[i]);
    std::fprintf(fp, "]}");
    std::fclose(fp);
    std::printf("wrote /tmp/ms_drilled.json (cube with 3 orthogonal exact-boolean bores)\n");
    return 0;
}
