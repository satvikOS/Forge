// PUSH-10 — forge::camx implementation. See CamExtended.hpp for the design.
//
// All polygon offsetting is done with an inline, dependency-free algorithm:
//   1. For each consecutive edge (p_i, p_{i+1}) compute the unit normal n_i
//      pointing inward (CCW polygon → left-normal) or outward.
//   2. Shift each edge by `d` along its normal, obtaining a new line.
//   3. Intersect successive shifted lines to get the new vertex.
//   4. Cull self-intersections by walking the new polygon and dropping any
//      segment that flips orientation versus its source edge.
//
// The algorithm is exact for convex polygons and produces a usable inset for
// most non-self-intersecting concave polygons; the cull step keeps the result
// well-formed even when concave corners would otherwise produce bowties.

#include "forge/CamExtended.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <sstream>
#include <stdexcept>

namespace forge { namespace camx {

namespace {

// ----------------- catalogue ----------------------------------------------
const std::vector<Tool>& catalogue() {
    static const std::vector<Tool> kTools = {
        // 6mm flat end mill, carbide, 4 flute
        Tool{1, ToolType_EndMill,   6.0, 22.0,  60.0, 4, "carbide", 18000.0, 0.025},
        // 10mm flat end mill, carbide, 4 flute
        Tool{2, ToolType_EndMill,  10.0, 30.0,  72.0, 4, "carbide", 14000.0, 0.040},
        // 3mm ball nose, carbide, 2 flute
        Tool{3, ToolType_BallMill,  3.0, 12.0,  50.0, 2, "carbide", 22000.0, 0.012},
        // 6mm ball nose, carbide, 2 flute
        Tool{4, ToolType_BallMill,  6.0, 18.0,  60.0, 2, "carbide", 18000.0, 0.020},
        // 5mm twist drill, HSS, 2 flute
        Tool{5, ToolType_Drill,     5.0, 28.0,  75.0, 2, "HSS",      3500.0, 0.080},
        // 50mm face mill, carbide, 5 inserts
        Tool{6, ToolType_FaceMill, 50.0, 10.0,  60.0, 5, "carbide",  4500.0, 0.150},
        // 3mm spot drill, HSS, 2 flute (90° tip)
        Tool{7, ToolType_SpotDrill, 3.0,  6.0,  40.0, 2, "HSS",      8000.0, 0.030},
    };
    return kTools;
}

// ----------------- vector math --------------------------------------------
struct V2 { double x; double y; };

inline V2 sub(const Pt2& a, const Pt2& b) { return V2{a.x - b.x, a.y - b.y}; }
inline double len(const V2& v)            { return std::sqrt(v.x*v.x + v.y*v.y); }
inline V2 norm(const V2& v) {
    double L = len(v);
    return (L > 1e-12) ? V2{v.x / L, v.y / L} : V2{0.0, 0.0};
}
inline double dot(const V2& a, const V2& b)   { return a.x*b.x + a.y*b.y; }
inline double cross(const V2& a, const V2& b) { return a.x*b.y - a.y*b.x; }

// Signed area of a closed polygon (positive = CCW, negative = CW).
double signedArea(const Polygon& poly) {
    if (poly.size() < 3) return 0.0;
    double s = 0.0;
    for (size_t i = 0; i < poly.size(); ++i) {
        const Pt2& a = poly[i];
        const Pt2& b = poly[(i + 1) % poly.size()];
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

bool isCCW(const Polygon& poly) { return signedArea(poly) > 0.0; }

Polygon ensureCCW(Polygon poly) {
    if (!isCCW(poly)) std::reverse(poly.begin(), poly.end());
    return poly;
}

// Axis-aligned bbox of a polygon.
struct BBox { double minX, minY, maxX, maxY; };
BBox bboxOf(const Polygon& poly) {
    BBox b{1e300, 1e300, -1e300, -1e300};
    for (auto& p : poly) {
        if (p.x < b.minX) b.minX = p.x;
        if (p.y < b.minY) b.minY = p.y;
        if (p.x > b.maxX) b.maxX = p.x;
        if (p.y > b.maxY) b.maxY = p.y;
    }
    return b;
}

// Inset a CCW polygon by `d` (positive = inward) using edge-normal offsetting.
// Returns an empty polygon if the inset collapses the area to nothing.
Polygon insetPolygon(const Polygon& src, double d) {
    if (src.size() < 3) return {};
    if (std::fabs(d) < 1e-9) return src;
    const size_t N = src.size();

    // Step 1: compute each edge's inward unit normal.
    // For a CCW polygon, the inward normal of edge (i → i+1) is the
    // left-rotated edge direction: n = (-dy, dx) / |edge|.
    std::vector<V2> n(N);
    std::vector<V2> dir(N);
    for (size_t i = 0; i < N; ++i) {
        V2 e = sub(src[(i + 1) % N], src[i]);
        double L = len(e);
        if (L < 1e-12) {
            n[i] = V2{0.0, 0.0};
            dir[i] = V2{0.0, 0.0};
        } else {
            dir[i] = V2{e.x / L, e.y / L};
            n[i]   = V2{-dir[i].y, dir[i].x};
        }
    }

    // Step 2: shift each edge by d along its normal, then intersect the
    // shifted edges of (i-1) and (i) to find the new vertex v_i.
    Polygon out;
    out.reserve(N);
    for (size_t i = 0; i < N; ++i) {
        size_t pi = (i + N - 1) % N;
        // Edge pi: from src[pi] in direction dir[pi]. Shifted point: src[pi] + n[pi]*d.
        // Edge i:  from src[i]  in direction dir[i].  Shifted point: src[i]  + n[i]*d.
        Pt2 p1{src[pi].x + n[pi].x * d, src[pi].y + n[pi].y * d};
        Pt2 p2{src[i ].x + n[i ].x * d, src[i ].y + n[i ].y * d};

        V2 d1 = dir[pi];
        V2 d2 = dir[i];
        double det = cross(d1, d2);

        if (std::fabs(det) < 1e-9) {
            // Parallel edges (continuation) — use shifted vertex on edge i.
            out.push_back(p2);
            continue;
        }
        // Intersect lines: p1 + t*d1 = p2 + u*d2  →  solve for t.
        V2 dp{p2.x - p1.x, p2.y - p1.y};
        double t = cross(dp, d2) / det;
        Pt2 v{p1.x + t * d1.x, p1.y + t * d1.y};
        out.push_back(v);
    }

    // Step 3: cull self-intersections by checking that each new edge's
    // direction still roughly aligns with its source edge. If an edge has
    // flipped (concave-corner pinch) skip it by removing the offending
    // vertex; iterate until stable or polygon collapses.
    bool changed = true;
    while (changed && out.size() >= 3) {
        changed = false;
        for (size_t i = 0; i < out.size(); ++i) {
            size_t j = (i + 1) % out.size();
            V2 e = sub(out[j], out[i]);
            // Find the matching source-edge index — same i in src thanks to
            // 1:1 correspondence.
            V2 srcDir = dir[i];
            if (len(e) < 1e-9 || dot(norm(e), srcDir) < -0.3) {
                // Edge flipped or collapsed — drop vertex i.
                out.erase(out.begin() + i);
                // Adjust dir/n vectors in sync so subsequent iterations are
                // still 1:1. The simplest stable thing is to rebuild dir from
                // the current `out`.
                if (out.size() < 3) break;
                std::vector<V2> dir2(out.size());
                for (size_t k = 0; k < out.size(); ++k) {
                    V2 ek = sub(out[(k + 1) % out.size()], out[k]);
                    double Lk = len(ek);
                    dir2[k] = (Lk > 1e-12) ? V2{ek.x / Lk, ek.y / Lk}
                                            : V2{0.0, 0.0};
                }
                dir = dir2;
                changed = true;
                break;
            }
        }
    }

    if (out.size() < 3) return {};
    if (signedArea(out) < 1e-6) return {};
    return out;
}

// Stack one offset chain at a single Z level into the Polyline3 list.
Polyline3 lift(const Polygon& flat, double z) {
    Polyline3 out;
    out.reserve(flat.size() + 1);
    for (auto& p : flat) out.push_back(Pt3{p.x, p.y, z});
    if (!flat.empty()) out.push_back(Pt3{flat.front().x, flat.front().y, z}); // close
    return out;
}

// ------------ G-code helpers ----------------------------------------------
inline std::string fmt(double v) {
    char buf[48];
    std::snprintf(buf, sizeof(buf), "%.4f", v);
    return buf;
}
inline std::string fmtF(double v) {
    char buf[24];
    std::snprintf(buf, sizeof(buf), "%.1f", v);
    return buf;
}

}  // namespace

// ============================== public API ===============================

std::vector<Tool> listTools() {
    return catalogue();
}

Tool toolById(std::uint32_t id) {
    for (auto& t : catalogue()) if (t.id == id) return t;
    throw std::out_of_range("forge.camx: unknown toolId " + std::to_string(id));
}

// --------------------------- pocket toolpath ------------------------------
std::vector<Polyline3> pocketToolpath(const Boundary& boundary,
                                      std::uint32_t toolId,
                                      const PocketParams& params)
{
    if (boundary.empty() || boundary[0].size() < 3) {
        throw std::invalid_argument("forge.camx.pocketToolpath: boundary[0] must be a closed polygon");
    }
    if (params.depth <= 0.0 || params.stepdown <= 0.0 || params.stepover <= 0.0) {
        throw std::invalid_argument("forge.camx.pocketToolpath: depth/stepdown/stepover must all be > 0");
    }
    Tool tool = toolById(toolId);
    double radius = tool.diameter * 0.5;

    // Z stepdown levels: 0 → -depth in stepdown increments. Final level is
    // exactly -depth even if it doesn't divide evenly.
    std::vector<double> zLevels;
    double z = -params.stepdown;
    while (z > -params.depth + 1e-9) {
        zLevels.push_back(z);
        z -= params.stepdown;
    }
    zLevels.push_back(-params.depth);

    // Build the initial inset chain: tool radius from the outer boundary.
    Polygon outer = ensureCCW(boundary[0]);
    Polygon current = insetPolygon(outer, radius);

    // Concentric chains shrinking inward by stepover.
    std::vector<Polygon> chains;
    while (!current.empty()) {
        chains.push_back(current);
        current = insetPolygon(chains.back(), params.stepover);
        if (chains.size() > 200) break; // safety bound
    }

    if (chains.empty()) {
        throw std::runtime_error("forge.camx.pocketToolpath: pocket too small for tool radius");
    }

    // If climb is false (conventional milling), reverse each chain so it
    // runs CW relative to the part normal (+Z).
    if (!params.climb) {
        for (auto& c : chains) std::reverse(c.begin(), c.end());
    }

    // Stack: outer-to-inner per Z level.
    std::vector<Polyline3> out;
    out.reserve(chains.size() * zLevels.size());
    for (double zi : zLevels) {
        for (auto& c : chains) {
            out.push_back(lift(c, zi));
        }
    }
    return out;
}

// --------------------------- contour toolpath -----------------------------
std::vector<Polyline3> contourToolpath(const Polygon& polyline,
                                       std::uint32_t toolId,
                                       ContourSide side,
                                       const ContourParams& params)
{
    if (polyline.size() < 3) {
        throw std::invalid_argument("forge.camx.contourToolpath: polyline must have >= 3 points");
    }
    if (params.depth <= 0.0 || params.stepdown <= 0.0) {
        throw std::invalid_argument("forge.camx.contourToolpath: depth/stepdown must be > 0");
    }
    Tool tool = toolById(toolId);
    double r = tool.diameter * 0.5;

    Polygon ccw = ensureCCW(polyline);
    Polygon offset;
    if (side == ContourSide_Inside)       offset = insetPolygon(ccw,  r);
    else if (side == ContourSide_Outside) offset = insetPolygon(ccw, -r); // negative = outward
    else                                  offset = ccw;

    if (offset.size() < 3) {
        throw std::runtime_error("forge.camx.contourToolpath: offset collapsed for given side/diameter");
    }
    if (!params.climb) std::reverse(offset.begin(), offset.end());

    std::vector<double> zLevels;
    double z = -params.stepdown;
    while (z > -params.depth + 1e-9) {
        zLevels.push_back(z);
        z -= params.stepdown;
    }
    zLevels.push_back(-params.depth);

    std::vector<Polyline3> out;
    out.reserve(zLevels.size());
    for (double zi : zLevels) out.push_back(lift(offset, zi));
    return out;
}

// --------------------------- drill toolpath -------------------------------
std::vector<Polyline3> drillToolpath(const std::vector<Pt2>& holes,
                                     std::uint32_t toolId,
                                     DrillCycle cycle,
                                     const DrillParams& params)
{
    if (holes.empty()) {
        throw std::invalid_argument("forge.camx.drillToolpath: holes must not be empty");
    }
    if (params.depth <= 0.0 || params.retract < 0.0) {
        throw std::invalid_argument("forge.camx.drillToolpath: depth>0 and retract>=0 required");
    }
    Tool tool = toolById(toolId);
    (void)tool; // bit metadata informs feeds in the post; geometry only uses XYZ.

    double zR  = params.retract;          // above-part retract
    double zD  = -params.depth;           // bottom of hole

    std::vector<Polyline3> out;
    out.reserve(holes.size());
    for (auto& h : holes) {
        Polyline3 seq;
        // Rapid to (x,y,zR)
        seq.push_back(Pt3{h.x, h.y, zR});
        if (cycle == DrillCycle_G81) {
            // Feed to bottom, rapid retract.
            seq.push_back(Pt3{h.x, h.y, zD});
            seq.push_back(Pt3{h.x, h.y, zR});
        } else {
            // G83 — peck cycle.
            double peck = (params.peck > 0.0) ? params.peck : std::max(1.0, params.depth * 0.25);
            double cur  = 0.0;
            while (-cur > zD + 1e-9) {
                cur -= peck;
                if (cur < zD) cur = zD;
                seq.push_back(Pt3{h.x, h.y, cur});  // feed down
                seq.push_back(Pt3{h.x, h.y, zR});   // rapid retract for chip clearance
                if (cur <= zD + 1e-9) break;
                seq.push_back(Pt3{h.x, h.y, cur + peck * 0.1}); // rapid back near last bottom
            }
        }
        out.push_back(std::move(seq));
    }
    return out;
}

// ============================== post-processors ===========================

namespace {

std::string postFanuc(const std::vector<Polyline3>& segs, const PostParams& p) {
    std::ostringstream os;
    os << "%\n";
    os << "O0001 (FORGE CAMX FANUC)\n";
    os << "G17 G21 G90 G54\n";
    os << "G0 Z" << fmt(p.safeZ) << "\n";
    os << "T" << p.toolId << " M6\n";
    os << "M3 S" << fmtF(p.spindleRPM) << "\n";
    for (size_t s = 0; s < segs.size(); ++s) {
        const auto& seg = segs[s];
        if (seg.empty()) continue;
        // Retract to safe Z, rapid to first XY, then plunge.
        os << "G0 Z" << fmt(p.safeZ) << "\n";
        os << "G0 X" << fmt(seg.front().x) << " Y" << fmt(seg.front().y) << "\n";
        os << "G1 Z" << fmt(seg.front().z) << " F" << fmtF(p.feed) << "\n";
        for (size_t i = 1; i < seg.size(); ++i) {
            const auto& m = seg[i];
            os << "G1 X" << fmt(m.x) << " Y" << fmt(m.y)
               << " Z" << fmt(m.z) << " F" << fmtF(p.feed) << "\n";
        }
    }
    os << "G0 Z" << fmt(p.safeZ) << "\n";
    os << "M5\n";
    os << "M30\n";
    os << "%\n";
    return os.str();
}

std::string postHeidenhain(const std::vector<Polyline3>& segs, const PostParams& p) {
    std::ostringstream os;
    os << "BEGIN PGM TEST MM\n";
    os << "TOOL CALL " << p.toolId << " Z S" << fmtF(p.spindleRPM) << "\n";
    os << "L Z" << fmt(p.safeZ) << " R0 FMAX M3\n";
    int line = 1;
    for (size_t s = 0; s < segs.size(); ++s) {
        const auto& seg = segs[s];
        if (seg.empty()) continue;
        os << line++ << " L Z" << fmt(p.safeZ) << " R0 FMAX\n";
        os << line++ << " L X" << fmt(seg.front().x) << " Y" << fmt(seg.front().y)
           << " R0 FMAX\n";
        os << line++ << " L Z" << fmt(seg.front().z)
           << " R0 F" << fmtF(p.feed) << " M3\n";
        for (size_t i = 1; i < seg.size(); ++i) {
            const auto& m = seg[i];
            os << line++ << " L X" << fmt(m.x) << " Y" << fmt(m.y)
               << " Z" << fmt(m.z) << " R0 F" << fmtF(p.feed) << "\n";
        }
    }
    os << line++ << " L Z" << fmt(p.safeZ) << " R0 FMAX M5\n";
    os << "END PGM TEST MM\n";
    return os.str();
}

std::string postSiemens(const std::vector<Polyline3>& segs, const PostParams& p) {
    std::ostringstream os;
    os << ";Header — FORGE CAMX SIEMENS\n";
    os << ";Tool=" << p.toolId << " RPM=" << fmtF(p.spindleRPM)
       << " Feed=" << fmtF(p.feed) << "\n";
    os << "T" << p.toolId << " M6\n";
    os << "G54\n";
    os << "S" << fmtF(p.spindleRPM) << " M3\n";
    os << "G0 Z" << fmt(p.safeZ) << "\n";
    for (size_t s = 0; s < segs.size(); ++s) {
        const auto& seg = segs[s];
        if (seg.empty()) continue;
        os << "G0 Z" << fmt(p.safeZ) << "\n";
        os << "G0 X" << fmt(seg.front().x) << " Y" << fmt(seg.front().y) << "\n";
        os << "G1 Z" << fmt(seg.front().z) << " F" << fmtF(p.feed) << "\n";
        for (size_t i = 1; i < seg.size(); ++i) {
            const auto& m = seg[i];
            os << "G1 X" << fmt(m.x) << " Y" << fmt(m.y)
               << " Z" << fmt(m.z) << " F" << fmtF(p.feed) << "\n";
        }
    }
    os << "G0 Z" << fmt(p.safeZ) << "\n";
    os << "M5\n";
    os << "M30\n";
    return os.str();
}

}  // namespace

std::string postProcess(const std::vector<Polyline3>& segments,
                        PostFlavour post,
                        const PostParams& params)
{
    switch (post) {
        case Post_Fanuc:      return postFanuc(segments, params);
        case Post_Heidenhain: return postHeidenhain(segments, params);
        case Post_Siemens:    return postSiemens(segments, params);
    }
    throw std::invalid_argument("forge.camx.postProcess: unknown post flavour");
}

// ----------------------------- cycle time ---------------------------------
CycleTime estimateCycleTime(const std::vector<Polyline3>& segments,
                            double feedMmMin)
{
    if (feedMmMin <= 0.0) {
        throw std::invalid_argument("forge.camx.estimateCycleTime: feed must be > 0");
    }
    double total = 0.0;
    for (auto& seg : segments) {
        for (size_t i = 1; i < seg.size(); ++i) {
            double dx = seg[i].x - seg[i - 1].x;
            double dy = seg[i].y - seg[i - 1].y;
            double dz = seg[i].z - seg[i - 1].z;
            total += std::sqrt(dx*dx + dy*dy + dz*dz);
        }
    }
    return CycleTime{ total, total / (feedMmMin / 60.0) };
}

}}  // namespace forge::camx
