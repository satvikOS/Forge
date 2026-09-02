// forge_verify.cpp — the VERIFIER, native. No node, no JS, no bridge.
//
// SACROSANCT Law 3: everything C++. The path from Archie's emission to a
// measured solid is now C++ end to end — the IR text goes straight into
// forge::ft::compileText, and the measurement comes from the kernel in-process.
// The JS worker this replaces put a node runtime inside the one path that has to
// be trustworthy and fast.
//
// Protocol — one JSON object per line on stdin, one per line on stdout:
//   in : {"id":"..","ir":"%1 = BOX(...)\n...","inputStep":"..","outStep":".."}
//   out: {"id","ok","error","failedOpId","valid","volume","faceCount","edgeCount",
//         "bbox":{"min":[..],"max":[..]},"genus","shellCount",
//         "bores":[{r,cx,cy,span,at,axis,faces}],"verify":[..]}
//
//   or : {"id","ok":false,"instrument":"<kind>","rowIndex","pid","afterAnswer",
//         "error":"INSTRUMENT: .."}
//         An `instrument` record is a verdict on THIS TOOL, not on the tree it
//         was handed. It carries no measurement because none was made. A caller
//         MUST exclude such a row from the numerator AND the denominator of
//         every rate: it is not a pass, not a failure, and not evidence. See
//         THE INSTRUMENT IS NOT THE SPECIMEN, below main's helpers.
//
// One `bores` entry is one HOLE, keyed on its AXIS LINE: a wall split at a seam,
// across the gap of a clevis, or into pilot + counterbore is still one hole. `r`
// is the smallest radius on that axis (the pilot), `span` the total axial length
// of cylindrical wall on it, `at`+`axis` the line itself, and cx/cy its x,y for
// the Z-axis case older callers assume. See BORE DETECTION below for what makes
// a cylindrical face count at all.
//
// `inputStep` binds INPUT() for edit trees; `outStep` writes the built STEP so a
// caller can measure the artefact independently.
//
// The JSON reader here is deliberately minimal and self-contained: this tool must
// not acquire a third-party dependency to do the one job the kernel exists for.

#include <algorithm>
#include <array>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cxxabi.h>      // __cxa_current_exception_type — name the exception that
                         // is killing us WITHOUT taking an OCCT dependency here
#include <exception>
#include <functional>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <typeinfo>
#include <unistd.h>      // write() — the only output call that is signal-safe
#include <vector>

#include "forge/DirectEdit.hpp"
#include "forge/MassProps.hpp"
#include "forge/Tessellate.hpp"
#include "forge/Topology.hpp"
#include "forge/VoxelIoU.hpp"
#include "forge/IoExchange.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/ft/FeatureTree.hpp"

#include "InstrumentRecord.hpp"   // THE INSTRUMENT IS NOT THE SPECIMEN: the
                                  // per-row instrument record, the terminate
                                  // handler and the fatal-signal handlers.
using namespace forge::instrument;

namespace {

// ----------------------------------------------------------------- tiny JSON
// Only what the protocol needs: string fields out of a flat object, with the
// standard escapes. Anything richer belongs in the caller, not here.
std::string jsonUnescape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] != '\\' || i + 1 >= s.size()) { out.push_back(s[i]); continue; }
        switch (s[++i]) {
            case 'n': out.push_back('\n'); break;
            case 't': out.push_back('\t'); break;
            case 'r': out.push_back('\r'); break;
            case 'b': out.push_back('\b'); break;
            case 'f': out.push_back('\f'); break;
            case '"': out.push_back('"'); break;
            case '\\': out.push_back('\\'); break;
            case '/': out.push_back('/'); break;
            case 'u': {
                // A STRICT four-hex-digit parse, and deliberately NOT std::stoi.
                //
                // std::stoi throws std::invalid_argument on "\uZZZZ" (and std::out_of_range on a
                // value it cannot represent). main() calls jsonString() SIX times before it opens
                // its first try block, so that throw escaped main and killed the WHOLE BATCH: one
                // malformed byte in one record left every LATER record unverified, and the run
                // looked like a verifier crash rather than one bad input. That is the same
                // "one failure destroys the batch" shape the NAFEMS gate had.
                //
                // std::stoi is also wrong here in a quieter way that no crash would reveal:
                // base-16 parsing STOPS at the first non-hex character, so "\u00ZZ" partially
                // parses to 0 and silently emits a NUL byte instead of reporting bad input.
                // Parsing exactly four digits, and rejecting unless all four are hex, fixes both.
                int cp = 0;
                bool okHex = (i + 4 < s.size());
                for (int k = 1; okHex && k <= 4; ++k) {
                    const unsigned char h = static_cast<unsigned char>(s[i + k]);
                    int d;
                    if      (h >= '0' && h <= '9') d = h - '0';
                    else if (h >= 'a' && h <= 'f') d = h - 'a' + 10;
                    else if (h >= 'A' && h <= 'F') d = h - 'A' + 10;
                    else { okHex = false; break; }
                    cp = (cp << 4) | d;
                }
                if (!okHex) {
                    // Malformed or truncated: keep the 'u' literally, exactly as `default:` does
                    // for any other unknown escape, and do NOT consume what follows. Never throw
                    // -- a bad byte in one record must cost that record, never the batch.
                    out.push_back('u');
                    break;
                }
                {
                    i += 4;
                    if (cp < 0x80) {
                        out.push_back(static_cast<char>(cp));
                    } else if (cp < 0x800) {
                        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
                        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
                    } else {
                        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
                        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
                        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
                    }
                }
                break;
            }
            default: out.push_back(s[i]);
        }
    }
    return out;
}

std::string jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof buf, "\\u%04x", c);
                    out += buf;
                } else {
                    out.push_back(c);
                }
        }
    }
    return out;
}

// Value of a top-level "key": "..." string field. Returns false when absent.
bool jsonString(const std::string& line, const std::string& key, std::string& out) {
    const std::string needle = "\"" + key + "\"";
    std::size_t k = line.find(needle);
    if (k == std::string::npos) return false;
    std::size_t colon = line.find(':', k + needle.size());
    if (colon == std::string::npos) return false;
    std::size_t q = line.find('"', colon);
    if (q == std::string::npos) return false;
    std::string raw;
    for (std::size_t i = q + 1; i < line.size(); ++i) {
        if (line[i] == '\\') {                 // keep the escape pair intact
            if (i + 1 < line.size()) { raw.push_back(line[i]); raw.push_back(line[i + 1]); ++i; }
            continue;
        }
        if (line[i] == '"') { out = jsonUnescape(raw); return true; }
        raw.push_back(line[i]);
    }
    return false;
}

std::string num(double v) {
    if (!std::isfinite(v)) return "null";
    std::ostringstream os;
    os.precision(6);
    os << std::fixed << v;
    std::string s = os.str();
    // trim trailing zeros so the transcript stays readable
    std::size_t last = s.find_last_not_of('0');
    if (last != std::string::npos && s[last] == '.') --last;
    return s.substr(0, last + 1);
}

// --------------------------------------------------------------- topology
// The weld-betti signature is forge::topologySignature (include/forge/Topology.hpp,
// src/TopologySignature.cpp) -- ONE definition, shared with the IR's
// VERIFY("genus=..") op. This tool used to carry a second, hand-copied
// implementation of it, which is exactly what that unification was introduced to
// end: a gate whose value depends on which copy you ask is not a gate. The mesh
// overload is used, so the tessellation is still done ONCE and shared with the
// bore measurement below.

// ============================================================== BORE DETECTION
//
// A concave cylindrical face is NOT a hole. An edge blend, an internal-corner
// blend and the end of a slot are all concave cylinders, so counting them was
// counting fillets as holes: BOX(60,60,20) + one O5 hole + FILLET(3) reported
// SEVEN bores where there is one.
//
// The obvious face-local discriminator does not work, and this is measured, not
// assumed. Angular sweep is derivable from area/(radius*axialExtent), and a
// genuine O5 bore and the fillet faces on the same part BOTH report 1.5708 —
// `area` is not the full swept area that formula assumes. A rule built on it
// counted ZERO bores on a plain hole.
//
// What separates a bore is not the face but the SOLID around it. A bore's wall
// bounds a full cylindrical VOID: at some station along the axis, the axis
// itself is outside the material and the material closes right round it at a
// radius just past the wall. Measured that way:
//
//   convex edge blend     — axis sits UNDER the edge, inside the material: out
//   internal-corner blend — axis is in air, but the ring is ~half open:   out
//   slot end              — axis is in air, but the ring is ~half open:   out
//   through / blind bore  — axis in air, ring closed:                      IN
//
// Measuring the solid rather than the face is also what makes a bore whose wall
// is split into several faces come out as ONE hole — at a seam, across the air
// gap of a clevis, or into pilot + counterbore. The surrounding material is the
// same whichever piece of wall you start from, and the pieces share one axis,
// so the dedup key is the AXIS LINE and nothing else.

struct V3 { double x = 0, y = 0, z = 0; };

inline V3 v3cross(const V3& a, const V3& b) {
    return V3{a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double v3dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline bool v3unit(V3& a) {
    const double n = std::sqrt(v3dot(a, a));
    if (!(n > 1e-300)) return false;
    a.x /= n; a.y /= n; a.z /= n;
    return true;
}

// Point-in-solid comes from the kernel (forge::PointInSolid, src/VoxelIoU.cpp) —
// the same BRepClass3d machinery the IoU metric already relies on. This tool
// adds no geometry code, only queries, and links nothing OCCT of its own.
using State = forge::PointInSolid::State;

inline State stateAt(const forge::PointInSolid& probe, const V3& p) {
    return probe.at(p.x, p.y, p.z);
}

// The classifier has to be shown to WORK before its answers are allowed to
// REMOVE anything from the bore list. A classifier that answered OUT everywhere
// would silently zero the hole count, and nothing downstream could tell that
// from a part that genuinely has no holes.
//
// The probe is a MESH TRIANGLE, not a face centroid and not a lattice cell,
// because only a triangle gives a point that is certainly ON the boundary with
// a normal that is certainly across it. Both alternatives were measured and
// both fail on ordinary parts: a rectangular tube's annular end face has its
// centroid in the HOLE, so stepping either way from it lands outside; and a
// lattice coarse enough to be cheap steps clean over an 8 mm wall on a 559 mm
// part. Either one declines to measure a part it could have measured.
//
// It is also orientation-agnostic by construction — it asks only whether the
// two sides DIFFER, never which side is which. That matters here: the
// face-orientation flag is what produced this defect, and it is measurably
// unreliable (of a box's four identical convex corner blends, two report
// concave and two do not).
bool probeDiscriminates(const forge::PointInSolid& probe, const forge::Mesh& mesh,
                        const double lo[3], const double hi[3], double volume,
                        std::string& why) {
    double span = 0.0;
    for (int k = 0; k < 3; ++k) span = std::max(span, hi[k] - lo[k]);
    if (!(span > 0.0)) { why = "bounding box has no extent"; return false; }
    const double eps = 1e-4 * span;

    const auto& P = mesh.positions;
    const auto& I = mesh.indices;
    const std::size_t nTri = I.size() / 3;
    if (nTri > 0) {
        const std::size_t kSamples = std::min<std::size_t>(nTri, 64);
        const std::size_t stride = std::max<std::size_t>(1, nTri / kSamples);
        for (std::size_t t = 0; t < nTri; t += stride) {
            const std::size_t a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
            if (c + 2 >= P.size()) continue;
            const V3 v0{P[a], P[a + 1], P[a + 2]};
            const V3 v1{P[b], P[b + 1], P[b + 2]};
            const V3 v2{P[c], P[c + 1], P[c + 2]};
            V3 n = v3cross(V3{v1.x - v0.x, v1.y - v0.y, v1.z - v0.z},
                           V3{v2.x - v0.x, v2.y - v0.y, v2.z - v0.z});
            if (!v3unit(n)) continue;                       // degenerate triangle
            const V3 m{(v0.x + v1.x + v2.x) / 3.0, (v0.y + v1.y + v2.y) / 3.0,
                       (v0.z + v1.z + v2.z) / 3.0};
            const auto in = stateAt(probe, V3{m.x - n.x * eps, m.y - n.y * eps, m.z - n.z * eps});
            const auto out = stateAt(probe, V3{m.x + n.x * eps, m.y + n.y * eps, m.z + n.z * eps});
            if (in == State::Error || out == State::Error) continue;
            if ((in == State::In) != (out == State::In)) return true;
        }
    }

    // No mesh (tessellation declined). Fall back to asking whether a coarse
    // lattice over the bounding box finds the solid at all.
    const int N = 10;
    long inCount = 0;
    for (int i = 0; i < N; ++i)
        for (int j = 0; j < N; ++j)
            for (int k = 0; k < N; ++k) {
                const V3 p{lo[0] + (i + 0.5) * (hi[0] - lo[0]) / N,
                           lo[1] + (j + 0.5) * (hi[1] - lo[1]) / N,
                           lo[2] + (k + 0.5) * (hi[2] - lo[2]) / N};
                if (stateAt(probe, p) == State::In) ++inCount;
            }
    if (inCount > 0) return true;
    why = volume > 0.0
              ? "point-in-solid could not tell inside from outside anywhere on a "
                "solid of volume " + num(volume)
              : "point-in-solid found no material and the solid has no volume";
    return false;
}

// Does the SOLID close all the way round this cylindrical face's axis?
//    1  yes — a full cylindrical void: this face is a bore wall
//    0  no  — material ON the axis (a blend under a convex edge), or an open
//             ring (an internal-corner blend, the end of a slot)
//   -1  could not measure — the caller must FALL BACK, never drop a hole
//
// EXISTENTIAL over axial stations, deliberately. A real bore crossed by another
// feature (a cross-drilling, a groove) has stations where the ring is broken by
// the intersecting void; requiring every station to close would delete it. One
// station that closes is proof the void is a full cylinder; a blend has none.
int surroundsAxis(const forge::PointInSolid& probe, const forge::FaceInfo& f,
                  std::string* dbg) {
    V3 d{f.direction[0], f.direction[1], f.direction[2]};
    if (!v3unit(d)) return -1;
    const double r = f.radius;
    if (!(r > 1e-12)) return -1;
    const double v0 = f.vMin, v1 = f.vMax;
    if (!(v1 > v0)) return -1;

    // An orthonormal pair spanning the plane normal to the axis.
    V3 t = (std::fabs(d.x) < 0.9) ? V3{1, 0, 0} : V3{0, 1, 0};
    V3 e1 = v3cross(d, t);
    if (!v3unit(e1)) return -1;
    V3 e2 = v3cross(d, e1);
    if (!v3unit(e2)) return -1;

    // Just past the wall, in units of the bore's OWN radius, so the test is
    // scale-free: a part modelled in metres must behave exactly as one in mm.
    // A fixed millimetre offset would step clean through the wall of a small
    // part and fail to leave the surface of a large one.
    const double off = 0.01 * r;
    const int kAng = 24;                       // 15 deg; a blend leaves ~half open
    static const double kStations[] = {0.1, 0.3, 0.5, 0.7, 0.9};

    bool sawError = false;
    for (double s : kStations) {
        const double v = v0 + s * (v1 - v0);
        const V3 c{f.axisLocation[0] + d.x * v, f.axisLocation[1] + d.y * v,
                   f.axisLocation[2] + d.z * v};
        const auto axisState = stateAt(probe, c);
        if (axisState == State::Error) { sawError = true; continue; }
        // Material ON the axis is a blend sitting under a convex edge, or a
        // boss — not the wall of a void.
        if (axisState != State::Out) continue;

        bool closed = true, err = false;
        for (int k = 0; k < kAng; ++k) {
            const double a = 2.0 * 3.14159265358979323846 * k / kAng;
            const double ca = std::cos(a) * (r + off), sa = std::sin(a) * (r + off);
            const V3 p{c.x + ca * e1.x + sa * e2.x, c.y + ca * e1.y + sa * e2.y,
                       c.z + ca * e1.z + sa * e2.z};
            const auto st = stateAt(probe, p);
            if (st == State::Error) { err = true; break; }
            if (st != State::In) { closed = false; break; }
        }
        if (err) { sawError = true; continue; }
        if (closed) {
            if (dbg) *dbg = "closed at v=" + num(v);
            return 1;
        }
    }
    if (dbg) *dbg = sawError ? "classification error" : "ring open at every station";
    return sawError ? -1 : 0;
}

}  // namespace



int main(int argc, char** argv) {
    (void)argc; (void)argv;
    std::ios::sync_with_stdio(false);
    installInstrumentHandlers();

    std::string line;
    long rowIndex = -1;
    while (std::getline(std::cin, line)) {
        if (line.find_first_not_of(" \t\r\n") == std::string::npos) continue;
        beginRow(++rowIndex);

        // THE WHOLE ROW UNDER ONE NET, so "this row produced no record" cannot
        // happen quietly. The lambda is what makes that provable: `continue` is
        // illegal inside it, so every early exit from the row body had to become
        // a `return` that passes through this net -- the compiler enforces the
        // property rather than a reviewer.
        try {
            [&] {
        std::string id, ir, inStep, outStep, censusFlag, refStep, gridStr;
        jsonString(line, "id", id);
        setRowId(id);   // the crash handlers cannot chase a std::string
        maybeInjectFault(id);   // inert unless FORGE_VERIFY_FAULT is set
        jsonString(line, "refStep", refStep);   // reference solid -> Voxel IoU
        jsonString(line, "iouGrid", gridStr);
        jsonString(line, "ir", ir);
        jsonString(line, "inputStep", inStep);
        jsonString(line, "outStep", outStep);
        // "census":"full" -> also emit the GROUND-TRUTH face census (see below)
        const bool wantCensus =
            jsonString(line, "census", censusFlag) && censusFlag == "full";

        std::ostringstream o;
        o << "{\"id\":\"" << jsonEscape(id) << "\"";

        if (ir.empty()) {
            o << ",\"ok\":false,\"error\":\"no ir\"}";
            emitRow(o.str());
            return;
        }

        forge::ft::CompileResult r;
        try {
            r = forge::ft::compileText(ir, outStep, inStep);
        } catch (const std::exception& e) {
            o << ",\"ok\":false,\"error\":\"" << jsonEscape(e.what()) << "\"}";
            emitRow(o.str());
            return;
        }

        o << ",\"ok\":" << (r.ok ? "true" : "false")
          << ",\"error\":\"" << jsonEscape(r.error) << "\""
          << ",\"failedOpId\":" << r.failedOpId;

        o << ",\"verify\":[";
        for (std::size_t i = 0; i < r.verify.size(); ++i) {
            if (i) o << ",";
            o << "\"" << jsonEscape(r.verify[i]) << "\"";
        }
        o << "]";

        // Report the measured geometry whenever the solid was actually BUILT, not
        // only when the tree passed. A tree can now fail solely because it asserted
        // something false about itself while having constructed a perfectly good
        // solid; suppressing the measurement in that case discards the very fact
        // that distinguishes "wrong claim, right part" from "did not build".
        // r.handle != 0 is the honest test of "there is something to measure".
        if (r.ok || r.handle != 0) {
            o << ",\"valid\":" << (r.valid ? "true" : "false")
              << ",\"volume\":" << num(r.volume)
              << ",\"faceCount\":" << r.faceCount
              << ",\"edgeCount\":" << r.edgeCount
              << ",\"exported\":" << (r.exported ? "true" : "false")
              << ",\"bbox\":{\"min\":[" << num(r.bboxMin[0]) << "," << num(r.bboxMin[1])
              << "," << num(r.bboxMin[2]) << "],\"max\":[" << num(r.bboxMax[0]) << ","
              << num(r.bboxMax[1]) << "," << num(r.bboxMax[2]) << "]}";

            // Tessellated ONCE and shared: the weld-betti genus below reads it, and
            // so does the bore measurement, which uses a triangle as the one point
            // it can be sure lies on the boundary.
            forge::Mesh mesh;
            try { mesh = forge::tessellate(r.handle, 0.3, 0.6); } catch (...) { /* additive */ }

            // topology — additive: never fail a real build because genus is unavailable
            try {
                forge::TopoSignature t;
                if (forge::topologySignature(mesh, t)) {
                    o << ",\"genus\":" << t.genus << ",\"shellCount\":" << t.shellCount
                      << ",\"vertexCount\":" << t.vertexCount;
                }
            } catch (...) { /* additive */ }

            // bores — a cylindrical face counts only when the SOLID closes right
            // round its axis (see BORE DETECTION above), and coaxial faces are
            // ONE hole however the wall is split.
            try {
                forge::ShapeHandle probe = r.handle;
                try { probe = forge::unifyFaces(r.handle); } catch (...) {}
                const auto inv = forge::faceInventory(probe);

                const bool boreDebug = std::getenv("FORGE_VERIFY_BORE_DEBUG") != nullptr;

                // Classify against the SAME shape the faces came from, so a face's
                // own axis coordinates address the same solid.
                forge::PointInSolid solid(probe);
                std::string degraded = solid.why();
                bool measured = solid.loaded();
                if (measured && !probeDiscriminates(solid, mesh, r.bboxMin, r.bboxMax,
                                                    r.volume, degraded)) {
                    measured = false;
                }

                // One accumulated hole per AXIS LINE. Radius is NOT part of the
                // key: a counterbore is a pilot and a recess on one axis and is
                // one hole, not two.
                struct Bore {
                    V3 dir;          // canonical (largest component positive)
                    V3 foot;         // the axis' closest point to the origin
                    double rMin;     // the pilot diameter is what "the hole" means
                    double span;     // total axial length of cylindrical wall
                    int faces;
                };
                std::vector<Bore> bores;

                double partSpan = 0.0;
                for (int k = 0; k < 3; ++k)
                    partSpan = std::max(partSpan, r.bboxMax[k] - r.bboxMin[k]);
                const double axisTol = std::max(1e-7, 1e-6 * partSpan);

                long fellBack = 0;
                for (const auto& f : inv) {
                    if (f.kind != "cylinder") continue;

                    bool isBore;
                    std::string wS;
                    if (!measured) {
                        isBore = f.concave;                // exactly the old rule
                    } else {
                        const int s = surroundsAxis(solid, f, boreDebug ? &wS : nullptr);
                        if (s < 0) { ++fellBack; isBore = f.concave; }
                        else       { isBore = (s == 1); }
                    }
                    if (boreDebug) {
                        std::fprintf(stderr,
                            "[bore] face %d r=%.4f concave=%d v=[%.4f,%.4f] area=%.3f "
                            "axis=(%.3f,%.3f,%.3f)@(%.3f,%.3f,%.3f) -> %s  %s\n",
                            f.index, f.radius, f.concave ? 1 : 0, f.vMin, f.vMax, f.area,
                            f.direction[0], f.direction[1], f.direction[2],
                            f.axisLocation[0], f.axisLocation[1], f.axisLocation[2],
                            isBore ? "BORE" : "not-a-bore", wS.c_str());
                    }
                    if (!isBore) continue;

                    V3 d{f.direction[0], f.direction[1], f.direction[2]};
                    if (!v3unit(d)) continue;
                    // A line has no preferred sense; fix one so the two walls of a
                    // split bore cannot land on opposite keys.
                    const double ax = std::fabs(d.x), ay = std::fabs(d.y), az = std::fabs(d.z);
                    const double dom = (ax >= ay && ax >= az) ? d.x : (ay >= az ? d.y : d.z);
                    if (dom < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; }

                    const V3 p{f.axisLocation[0], f.axisLocation[1], f.axisLocation[2]};
                    const double t = v3dot(p, d);
                    const V3 foot{p.x - d.x * t, p.y - d.y * t, p.z - d.z * t};

                    const double wall =
                        f.radius > 1e-12
                            ? f.area / (2.0 * 3.14159265358979323846 * f.radius) : 0.0;

                    Bore* hit = nullptr;
                    for (auto& b : bores) {
                        if (std::fabs(v3dot(b.dir, d)) < 1.0 - 1e-9) continue;
                        if (std::fabs(b.foot.x - foot.x) > axisTol ||
                            std::fabs(b.foot.y - foot.y) > axisTol ||
                            std::fabs(b.foot.z - foot.z) > axisTol) continue;
                        hit = &b;
                        break;
                    }
                    if (hit) {
                        hit->rMin = std::min(hit->rMin, f.radius);
                        hit->span += wall;
                        hit->faces += 1;
                    } else {
                        bores.push_back(Bore{d, foot, f.radius, wall, 1});
                    }
                }

                o << ",\"bores\":[";
                for (std::size_t i = 0; i < bores.size(); ++i) {
                    if (i) o << ",";
                    // cx/cy are the axis' x,y — the hole's position for the Z-axis
                    // case every consumer of this field assumes. `at` and `axis`
                    // are the whole truth: two X-axis holes at the same y and
                    // different z share cx/cy and are NOT the same hole, and the
                    // old key could not tell them apart (a 16-hole vented panel
                    // reported 4).
                    o << "{\"cx\":" << num(bores[i].foot.x) << ",\"cy\":" << num(bores[i].foot.y)
                      << ",\"r\":" << num(bores[i].rMin) << ",\"span\":" << num(bores[i].span)
                      << ",\"at\":[" << num(bores[i].foot.x) << "," << num(bores[i].foot.y)
                      << "," << num(bores[i].foot.z) << "]"
                      << ",\"axis\":[" << num(bores[i].dir.x) << "," << num(bores[i].dir.y)
                      << "," << num(bores[i].dir.z) << "],\"faces\":" << bores[i].faces << "}";
                }
                o << "]";
                // Say so when the measurement was declined and the old
                // concave-cylinder rule stood in, rather than let a silently
                // over-counted list look like a measured one.
                if (!measured)
                    o << ",\"boresDegraded\":\"" << jsonEscape(degraded) << "\"";
                else if (fellBack)
                    o << ",\"boresFellBack\":" << fellBack;

                // FULL FACE CENSUS, in the GROUND-TRUTH schema.
                //
                // The retained ground-truth records (archie_edit_203/209/214) condition
                // every edit on a COMPLETE per-face inventory of the input solid — 156,
                // 190 and 430 faces — not on a summary. Each entry carries kind, area and
                // centroid, plus radius for cylinder/sphere/cone and major/minor for
                // torus. "Shrink the largest bore" can only be GROUNDED by a planner that
                // can see every bore; a summarised census is the difference between a
                // measured quantity and a guess.
                if (wantCensus) {
                    const auto full = forge::faceInventory(probe);
                    std::map<std::string, long> hist;
                    for (const auto& f : full) hist[f.kind]++;
                    o << ",\"census\":{\"faceCount\":" << full.size() << ",\"kind_histogram\":{";
                    bool first = true;
                    for (const auto& kv : hist) {
                        if (!first) o << ",";
                        first = false;
                        o << "\"" << jsonEscape(kv.first) << "\":" << kv.second;
                    }
                    o << "},\"bbox\":{\"min\":[" << num(r.bboxMin[0]) << "," << num(r.bboxMin[1])
                      << "," << num(r.bboxMin[2]) << "],\"max\":[" << num(r.bboxMax[0]) << ","
                      << num(r.bboxMax[1]) << "," << num(r.bboxMax[2]) << "]},\"faces\":[";
                    for (std::size_t i = 0; i < full.size(); ++i) {
                        const auto& f = full[i];
                        if (i) o << ",";
                        o << "{\"kind\":\"" << jsonEscape(f.kind) << "\",\"area\":" << num(f.area)
                          << ",\"centroid\":[" << num(f.centroid[0]) << "," << num(f.centroid[1])
                          << "," << num(f.centroid[2]) << "]";
                        if (f.kind == "cylinder" || f.kind == "sphere" || f.kind == "cone")
                            o << ",\"radius\":" << num(f.radius);
                        if (f.kind == "torus")
                            o << ",\"major\":" << num(f.radius)
                              << ",\"minor\":" << num(f.minorRadius);
                        // Beyond ground truth, but free here and load-bearing for
                        // selection: a plan cannot say "the concave bore at (x, y)"
                        // without an axis position, and cannot say "+Z face" without a
                        // normal.
                        if (f.kind == "cylinder" || f.kind == "cone" || f.kind == "torus")
                            o << ",\"axis\":[" << num(f.direction[0]) << ","
                              << num(f.direction[1]) << "," << num(f.direction[2])
                              << "],\"axisAt\":[" << num(f.axisLocation[0]) << ","
                              << num(f.axisLocation[1]) << "," << num(f.axisLocation[2]) << "]";
                        if (f.kind == "plane")
                            o << ",\"normal\":[" << num(f.direction[0]) << ","
                              << num(f.direction[1]) << "," << num(f.direction[2]) << "]";
                        o << ",\"concave\":" << (f.concave ? "true" : "false")
                          << ",\"index\":" << f.index << "}";
                    }
                    o << "]}";
                }
            } catch (...) { /* additive */ }

            // VOXEL IoU against a reference STEP — the metric BenchCAD
            // Vision2Code scores. Volume and IoU disagree exactly where it
            // matters: a part can match volume to 0.1% and sit in the wrong
            // place. Both solids are voxelised on ONE grid spanning the union of
            // their bounding boxes, so an offset candidate is penalised rather
            // than silently re-centred.
            if (!refStep.empty()) {
                try {
                    forge::ShapeHandle ref = 0;
                    try {
                        ref = forge::io::importStep(refStep);
                    } catch (const std::exception& e) {
                        // Say that the REFERENCE failed to import, and why. This
                        // was previously indistinguishable from an IoU that simply
                        // could not be computed.
                        o << ",\"voxelIoUError\":\"reference import failed: "
                          << jsonEscape(e.what()) << "\"";
                        throw;
                    }
                    if (ref == 0) {
                        o << ",\"voxelIoUError\":\"reference imported as handle 0 from "
                          << jsonEscape(refStep) << "\"";
                    }
                    if (ref != 0) {
                        int grid = 64;
                        if (!gridStr.empty()) {
                            try { grid = std::stoi(gridStr); } catch (...) { grid = 64; }
                        }
                        std::string alignStr;
                        jsonString(line, "iouAlign", alignStr);
                        forge::IoUAlign align = forge::IoUAlign::Raw;
                        if (alignStr == "centred" || alignStr == "centered")
                            align = forge::IoUAlign::Centred;
                        else if (alignStr == "centred-scaled" || alignStr == "centered-scaled")
                            align = forge::IoUAlign::CentredScaled;
                        // BenchCAD's own convention: normalise by the LONGEST AXIS,
                        // not the bbox diagonal. Without this the tool could not
                        // produce a number comparable to a published BenchCAD figure.
                        else if (alignStr == "centred-longest" ||
                                 alignStr == "centered-longest" || alignStr == "benchcad")
                            align = forge::IoUAlign::CentredLongest;
                        bool alignUnknown = false;
                        if (!alignStr.empty() && alignStr != "raw" &&
                            alignStr != "centred" && alignStr != "centered" &&
                            alignStr != "centred-scaled" && alignStr != "centered-scaled" &&
                            alignStr != "centred-longest" && alignStr != "centered-longest" &&
                            alignStr != "benchcad") {
                            alignUnknown = true;
                        }
                        forge::VoxelIoUResult v;
                        // An unrecognised convention REFUSES the measurement. Falling
                        // back to raw would answer a question the caller did not ask,
                        // in a normalisation they did not choose — and IoU conventions
                        // are not interchangeable (centring alone moved a 41-task mean
                        // from 0.372 to 0.439). A number under the wrong convention is
                        // not a slightly-off number; it is not comparable at all.
                        const bool okIoU = !alignUnknown &&
                                           forge::voxelIoU(r.handle, ref, v, grid, align);
                        if (alignUnknown) {
                            o << ",\"voxelIoUError\":\"unknown iouAlign '"
                              << jsonEscape(alignStr)
                              << "'; refusing to measure (raw|centred|centred-scaled|"
                                 "centred-longest)\"";
                        } else if (!okIoU) {
                            // say WHY, rather than omitting the field and leaving
                            // the caller to guess whether it was 0 or unmeasurable
                            o << ",\"voxelIoUError\":\"" << jsonEscape(v.failure) << "\"";
                        }
                        if (okIoU) {
                            o << ",\"voxelIoU\":" << num(v.iou)
                              << ",\"iouGrid\":" << v.gridN
                              << ",\"iouCells\":{\"candidate\":" << v.inA
                              << ",\"reference\":" << v.inB
                              << ",\"intersection\":" << v.intersection
                              << ",\"union\":" << v.unionCount << "}"
                              << ",\"iouAlign\":\"" << jsonEscape(
                                     align == forge::IoUAlign::Raw ? "raw" :
                                     align == forge::IoUAlign::Centred ? "centred" :
                                     align == forge::IoUAlign::CentredLongest
                                         ? "centred-longest" :
                                     "centred-scaled") << "\"";
                            if (!v.failure.empty())
                                o << ",\"voxelIoUNote\":\"" << jsonEscape(v.failure) << "\"";
                        }
                    }
                } catch (...) { /* additive: a missing reference must not fail a build */ }
            }
        }

        o << "}";
        emitRow(o.str());
            }();
        } catch (const std::exception& e) {
            // A throw that reached here is the TOOL failing, not the tree: the
            // per-op handlers inside the kernel already turn a real modelling
            // failure into a CompileResult. Recording it as an `instrument`
            // outcome keeps it out of both halves of every rate downstream.
            emitInstrument("verifier_exception", e.what(), false);
        } catch (...) {
            char ty[512];
            emitInstrument("verifier_exception",
                           currentExceptionTypeName(ty, sizeof ty), false);
        }
        if (!g_rowAnswered)
            emitInstrument("verifier_no_record",
                           "the row body returned without emitting a record", false);
    }
    return 0;
}
