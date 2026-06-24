// dump_bevel_gear.cpp — milestone: a STRAIGHT BEVEL gear, a real mechanical part
// (involute tooth profile on the BACK CONE, teeth tapering toward the pitch-cone
// apex -> a genus-1 closed 2-manifold with a central bore). Dumps the tessellation
// to JSON for the multi-angle milestone render. New in forge-kernel burst-5.
#include "forge/native/brep/Gear.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include <cstdio>
#include <vector>
#include <cstdint>
using namespace forge::native::brep;

int main() {
    GearSpec spec;
    spec.gearType      = GearType::Bevel;          // straight bevel
    spec.module        = 3.0;
    spec.teeth         = 20;
    spec.pressureAngle = 0.34906585039886591;       // 20 deg
    spec.faceWidth     = 12.0;
    spec.boreRadius    = 5.0;
    spec.pitchConeAngle = 0.78539816339744831;      // pi/4 = 45 deg pitch cone
    GearResult R = buildGear(spec);
    if (!R.ok || !R.solid) { std::fprintf(stderr, "buildBevelGear failed: %s\n", R.reason); return 1; }
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    tessellateSolid(*R.solid, pos, idx);
    FILE* fp = std::fopen("/tmp/ms_bevel_gear.json", "w");
    std::fprintf(fp, "{\"positions\":[");
    for (std::size_t i = 0; i < pos.size(); ++i) std::fprintf(fp, "%s%.5g", i ? "," : "", pos[i]);
    std::fprintf(fp, "],\"indices\":[");
    for (std::size_t i = 0; i < idx.size(); ++i) std::fprintf(fp, "%s%u", i ? "," : "", idx[i]);
    std::fprintf(fp, "]}");
    std::fclose(fp);
    std::printf("bevel gear: pitchDia=%.3f teeth=%d cone=45deg verts=%zu tris=%zu\n",
                spec.module * spec.teeth, spec.teeth, pos.size()/3, idx.size()/3);
    return 0;
}
