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
//         "bbox":{"min":[..],"max":[..]},"genus","shellCount","bores":[{r,cx,cy,span}],
//         "verify":[..]}
//
// `inputStep` binds INPUT() for edit trees; `outStep` writes the built STEP so a
// caller can measure the artefact independently.
//
// The JSON reader here is deliberately minimal and self-contained: this tool must
// not acquire a third-party dependency to do the one job the kernel exists for.

#include <array>
#include <cmath>
#include <cstdio>
#include <functional>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "forge/DirectEdit.hpp"
#include "forge/MassProps.hpp"
#include "forge/Tessellate.hpp"
#include "forge/ft/FeatureTree.hpp"

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
                if (i + 4 < s.size()) {
                    const int cp = std::stoi(s.substr(i + 1, 4), nullptr, 16);
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
// Weld-betti signature from the tessellation: quantise + weld vertices,
// union-find the shells, chi = V - E + F, genus by the single-shell formula.
// Mirrors scripts/inv_of_step.mjs::topology — deflection-invariant, which is
// what makes genus usable as a GATE and not merely a diagnostic.
struct Topo { long vertexCount = 0; long eulerChar = 0; long genus = 0; long shellCount = 0; };

bool weldBetti(const forge::Mesh& m, Topo& out) {
    const auto& P = m.positions;
    const auto& I = m.indices;
    if (P.empty() || I.size() < 3) return false;

    const double q = 1e-4;
    const std::size_t nVraw = P.size() / 3;
    std::map<std::array<long long, 3>, int> weld;
    std::vector<int> rep(nVraw, 0);
    int nV = 0;
    for (std::size_t i = 0; i < nVraw; ++i) {
        const std::array<long long, 3> key{
            {static_cast<long long>(std::llround(P[i * 3] / q)),
             static_cast<long long>(std::llround(P[i * 3 + 1] / q)),
             static_cast<long long>(std::llround(P[i * 3 + 2] / q))}};
        auto it = weld.find(key);
        if (it == weld.end()) { it = weld.emplace(key, nV++).first; }
        rep[i] = it->second;
    }

    std::vector<int> parent(static_cast<std::size_t>(nV));
    for (int i = 0; i < nV; ++i) parent[static_cast<std::size_t>(i)] = i;
    std::function<int(int)> find = [&](int x) {
        while (parent[static_cast<std::size_t>(x)] != x) {
            parent[static_cast<std::size_t>(x)] =
                parent[static_cast<std::size_t>(parent[static_cast<std::size_t>(x)])];
            x = parent[static_cast<std::size_t>(x)];
        }
        return x;
    };
    auto uni = [&](int a, int b) {
        a = find(a); b = find(b);
        if (a != b) parent[static_cast<std::size_t>(a)] = b;
    };

    const std::size_t nF = I.size() / 3;
    std::set<std::pair<int, int>> edges;
    for (std::size_t f = 0; f < nF; ++f) {
        const int a = rep[I[f * 3]], b = rep[I[f * 3 + 1]], c = rep[I[f * 3 + 2]];
        uni(a, b); uni(b, c); uni(c, a);
        edges.insert({std::min(a, b), std::max(a, b)});
        edges.insert({std::min(b, c), std::max(b, c)});
        edges.insert({std::min(c, a), std::max(c, a)});
    }
    std::set<int> roots;
    for (int i = 0; i < nV; ++i) roots.insert(find(i));

    const long chi = static_cast<long>(nV) - static_cast<long>(edges.size()) +
                     static_cast<long>(nF);
    out.vertexCount = nV;
    out.eulerChar = chi;
    out.genus = std::max(0L, static_cast<long>(std::lround((2.0 - chi) / 2.0)));
    out.shellCount = static_cast<long>(roots.size());
    return true;
}

}  // namespace


int main(int argc, char** argv) {
    (void)argc; (void)argv;
    std::ios::sync_with_stdio(false);

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.find_first_not_of(" \t\r\n") == std::string::npos) continue;

        std::string id, ir, inStep, outStep, censusFlag;
        jsonString(line, "id", id);
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
            std::cout << o.str() << "\n" << std::flush;
            continue;
        }

        forge::ft::CompileResult r;
        try {
            r = forge::ft::compileText(ir, outStep, inStep);
        } catch (const std::exception& e) {
            o << ",\"ok\":false,\"error\":\"" << jsonEscape(e.what()) << "\"}";
            std::cout << o.str() << "\n" << std::flush;
            continue;
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

        if (r.ok) {
            o << ",\"valid\":" << (r.valid ? "true" : "false")
              << ",\"volume\":" << num(r.volume)
              << ",\"faceCount\":" << r.faceCount
              << ",\"edgeCount\":" << r.edgeCount
              << ",\"exported\":" << (r.exported ? "true" : "false")
              << ",\"bbox\":{\"min\":[" << num(r.bboxMin[0]) << "," << num(r.bboxMin[1])
              << "," << num(r.bboxMin[2]) << "],\"max\":[" << num(r.bboxMax[0]) << ","
              << num(r.bboxMax[1]) << "," << num(r.bboxMax[2]) << "]}";

            // topology — additive: never fail a real build because genus is unavailable
            try {
                forge::Mesh m = forge::tessellate(r.handle, 0.3, 0.6);
                Topo t;
                if (weldBetti(m, t)) {
                    o << ",\"genus\":" << t.genus << ",\"shellCount\":" << t.shellCount
                      << ",\"vertexCount\":" << t.vertexCount;
                }
            } catch (...) { /* additive */ }

            // bores — deduped by axis+radius, so coaxial strips count as ONE hole
            try {
                forge::ShapeHandle probe = r.handle;
                try { probe = forge::unifyFaces(r.handle); } catch (...) {}
                const auto inv = forge::faceInventory(probe);
                std::vector<std::array<double, 4>> bores;   // cx, cy, r, span
                for (const auto& f : inv) {
                    if (f.kind != "cylinder" || !f.concave) continue;
                    const double cx = f.axisLocation[0] != 0.0 ? f.axisLocation[0] : f.centroid[0];
                    const double cy = f.axisLocation[1] != 0.0 ? f.axisLocation[1] : f.centroid[1];
                    bool dup = false;
                    for (const auto& b : bores)
                        if (std::fabs(b[0] - cx) < 1e-4 && std::fabs(b[1] - cy) < 1e-4 &&
                            std::fabs(b[2] - f.radius) < 1e-4) { dup = true; break; }
                    if (dup) continue;
                    const double span =
                        f.radius > 1e-9 ? f.area / (2.0 * 3.14159265358979323846 * f.radius) : 0.0;
                    bores.push_back({{cx, cy, f.radius, span}});
                }
                o << ",\"bores\":[";
                for (std::size_t i = 0; i < bores.size(); ++i) {
                    if (i) o << ",";
                    o << "{\"cx\":" << num(bores[i][0]) << ",\"cy\":" << num(bores[i][1])
                      << ",\"r\":" << num(bores[i][2]) << ",\"span\":" << num(bores[i][3]) << "}";
                }
                o << "]";

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
        }

        o << "}";
        std::cout << o.str() << "\n" << std::flush;
    }
    return 0;
}
