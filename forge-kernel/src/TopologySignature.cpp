// TopologySignature.cpp — weld-betti topology signature (see forge/Topology.hpp).
//
// One definition, used by the IR's VERIFY op and by the forge_verify tool, so a
// genus asserted inside a feature tree and a genus reported by the verifier can
// never disagree. They previously lived in two hand-copied implementations (a
// script and a tool); a gate whose value depends on which copy you ask is not a
// gate.
//
// The mesh overload is the definition and the ShapeHandle form delegates to it,
// so a caller that has already tessellated (forge_verify shares one mesh between
// this measurement and its bore detection) reuses THIS code instead of keeping
// the private copy of it that survived the first unification.

#include "forge/Topology.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <set>
#include <vector>

#include "forge/Tessellate.hpp"

namespace forge {

bool topologySignature(ShapeHandle body, TopoSignature& out,
                       double linearDeflection, double angularDeflection) {
    Mesh m;
    try {
        m = tessellate(body, linearDeflection, angularDeflection);
    } catch (...) {
        return false;
    }
    return topologySignature(m, out);
}

bool topologySignature(const Mesh& m, TopoSignature& out) {
    const auto& P = m.positions;
    const auto& I = m.indices;
    if (P.empty() || I.size() < 3) return false;

    // weld: quantise to 1e-4 mm so coincident vertices from adjacent faces merge
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
        if (it == weld.end()) it = weld.emplace(key, nV++).first;
        rep[i] = it->second;
    }

    std::vector<int> parent(static_cast<std::size_t>(nV));
    for (int i = 0; i < nV; ++i) parent[static_cast<std::size_t>(i)] = i;
    auto find = [&parent](int x) {
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
    out.edgeCount = static_cast<long>(edges.size());
    out.faceCount = static_cast<long>(nF);
    out.eulerChar = chi;
    out.genus = std::max(0L, static_cast<long>(std::lround((2.0 - static_cast<double>(chi)) / 2.0)));
    out.shellCount = static_cast<long>(roots.size());
    return true;
}

}  // namespace forge
