// dump_gear.cpp — milestone: an involute spur gear, a real mechanical part
// (exact-involute tooth flank + circular-pattern teeth + central bore -> genus-1
// closed 2-manifold). Dumps the tessellation to JSON.
#include "forge/native/brep/Gear.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include <cstdio>
#include <vector>
#include <cstdint>
using namespace forge::native::brep;

int main() {
    GearSpec spec;
    spec.module = 2.5; spec.teeth = 24; spec.pressureAngle = 0.34906585039886591;
    spec.faceWidth = 8.0; spec.boreRadius = 6.0;
    GearResult R = buildGear(spec);
    if (!R.ok || !R.solid) { std::fprintf(stderr, "buildGear failed: %s\n", R.reason); return 1; }
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    tessellateSolid(*R.solid, pos, idx);
    FILE* fp = std::fopen("/tmp/ms_gear.json", "w");
    std::fprintf(fp, "{\"positions\":[");
    for (std::size_t i = 0; i < pos.size(); ++i) std::fprintf(fp, "%s%.5g", i ? "," : "", pos[i]);
    std::fprintf(fp, "],\"indices\":[");
    for (std::size_t i = 0; i < idx.size(); ++i) std::fprintf(fp, "%s%u", i ? "," : "", idx[i]);
    std::fprintf(fp, "]}");
    std::fclose(fp);
    std::printf("gear: pitchDia=%.3f teeth=%d verts=%zu tris=%zu\n",
                spec.module * spec.teeth, spec.teeth, pos.size()/3, idx.size()/3);
    return 0;
}
