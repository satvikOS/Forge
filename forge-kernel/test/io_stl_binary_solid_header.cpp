// forge-kernel/test/io_stl_binary_solid_header.cpp
//
// REGRESSION GATE — BINARY STL WHOSE 80-BYTE HEADER BEGINS "solid".
//
// forge::io::importStl used to classify ASCII-vs-binary by SNIFFING THE HEADER
// TEXT: any file whose first 5 bytes were "solid" was taken to be ASCII. That is
// wrong. A binary STL's 80-byte header is ARBITRARY bytes, and many exporters
// write a part name straight into it — a name that very commonly begins
// "solid ...". Such a file was classified ASCII, skipped the binary transcode,
// and was then rejected by the ASCII reader: a perfectly valid, extremely common
// file that could not be imported at all.
//
// The fix replaces the text sniff with the SIZE RULE every robust STL reader
// uses: a binary STL is EXACTLY 84 + 50*nTri bytes, where nTri is the
// little-endian uint32 at offset 80.
//
// THIS GATE MUST BE ABLE TO FAIL. It constructs a REAL binary STL of a closed
// 10mm box in-memory (12 triangles, consistent outward winding), deliberately
// stamps the header with "solid BinaryBoxFromScanner", writes it to a temp file
// and drives the PRODUCTION importStl. Under the old header sniff this import
// throws; under the size rule it must yield a 12-triangle closed mesh whose
// enclosed volume is exactly 1000.
//
// Three companion cases keep the gate honest in the other direction — the size
// rule must not start eating ASCII files, must not mistake a truncated binary
// file for a good one, and must still accept a binary file whose header does NOT
// say "solid":
//   (2) a genuine ASCII STL of the same box still reads as ASCII -> 12 tris, 1000.
//   (3) a binary STL with a "solid" header and a TRUNCATED body (size != 84+50n)
//       is NOT silently accepted — importStl throws.
//   (4) a binary STL with a conventional (non-"solid") header still reads.
//
// PROOF THE GATE CAN FAIL (SR-3): built once against the PRE-FIX src/IoExchange.cpp
// and once against the fixed one. Pre-fix it exits 1 with case [1] reporting three
// [FAIL]s ("STL read failed ... missing endsolid (truncated)" — the ASCII reader
// choking on binary payload it was handed by the header sniff); post-fix it exits 0
// with 16/16. The gate also asserts the COUNT of checks it executed against a
// declared constant, so a case that silently stops running is itself a failure.
//
// BUILD (macOS, OCCT 7.9.3 from homebrew), verified:
//   clang++ -std=c++20 -O1 -DFORGE_NATIVE_BREP -DFORGE_NATIVE_PROJECTION=1 \
//     -I forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     forge-kernel/test/io_stl_binary_solid_header.cpp \
//     forge-kernel/src/native/*.cpp forge-kernel/src/native/*/*.cpp \
//       (excluding NativeLoftPipe.cpp) \
//     forge-kernel/src/IoExchange.cpp forge-kernel/src/ShapeRegistry.cpp \
//     forge-kernel/src/Tessellate.cpp forge-kernel/src/NativeOcctBridge.cpp \
//     forge-kernel/src/OcctNativeMesh.cpp forge-kernel/src/OcctImport.cpp \
//     forge-kernel/src/OcctPrimBuilder.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKGeomAlgo -lTKPrim -lTKDE -lTKDESTEP -lTKXSBase -lTKShHealing -lTKMesh \
//     -lTKDESTL -lTKBO -lTKOffset -lTKFillet -lTKBool -lTKDEIGES \
//     -o /tmp/io_stl_binary_solid_header && /tmp/io_stl_binary_solid_header

#include "forge/IoExchange.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

// ===========================================================================
// Gate bookkeeping — SR-3: a gate that cannot fail is not a gate, so every
// assertion is counted and the COUNT of executed checks is asserted at the end.
// ===========================================================================
static int g_pass = 0, g_total = 0;
static void gate(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else      {           std::printf("  [FAIL] %s\n", name.c_str()); }
}

// ===========================================================================
// A closed 10mm box as a triangle soup (12 triangles, outward winding).
// ===========================================================================
struct Tri { std::array<float, 3> n, a, b, c; };

static std::vector<Tri> boxTriangles(float L) {
    // 8 corners of [0,L]^3
    const std::array<std::array<float, 3>, 8> v = {{
        {{0, 0, 0}}, {{L, 0, 0}}, {{L, L, 0}}, {{0, L, 0}},
        {{0, 0, L}}, {{L, 0, L}}, {{L, L, L}}, {{0, L, L}},
    }};
    // 6 quads (outward CCW), each split into 2 triangles.
    const int q[6][4] = {
        {0, 3, 2, 1},  // z = 0  (normal -Z)
        {4, 5, 6, 7},  // z = L  (normal +Z)
        {0, 1, 5, 4},  // y = 0  (normal -Y)
        {3, 7, 6, 2},  // y = L  (normal +Y)
        {0, 4, 7, 3},  // x = 0  (normal -X)
        {1, 2, 6, 5},  // x = L  (normal +X)
    };
    std::vector<Tri> tris;
    for (const auto& f : q) {
        const int idx[2][3] = {{f[0], f[1], f[2]}, {f[0], f[2], f[3]}};
        for (const auto& t : idx) {
            Tri tr{};
            tr.a = v[static_cast<std::size_t>(t[0])];
            tr.b = v[static_cast<std::size_t>(t[1])];
            tr.c = v[static_cast<std::size_t>(t[2])];
            // facet normal from the winding (STL stores it; readers recompute).
            const float ux = tr.b[0] - tr.a[0], uy = tr.b[1] - tr.a[1], uz = tr.b[2] - tr.a[2];
            const float wx = tr.c[0] - tr.a[0], wy = tr.c[1] - tr.a[1], wz = tr.c[2] - tr.a[2];
            float nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            const float len = std::sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 0.0f) { nx /= len; ny /= len; nz /= len; }
            tr.n = {{nx, ny, nz}};
            tris.push_back(tr);
        }
    }
    return tris;
}

// Serialise a BINARY STL with a caller-chosen 80-byte header.
// `truncateBy` chops bytes off the end to forge a corrupt file for case (3).
static std::string binaryStl(const std::vector<Tri>& tris,
                             const std::string& header,
                             std::size_t truncateBy = 0) {
    std::string out;
    out.resize(80, '\0');
    for (std::size_t i = 0; i < header.size() && i < 80; ++i) out[i] = header[i];

    const std::uint32_t n = static_cast<std::uint32_t>(tris.size());
    // little-endian, explicitly (the format defines it; do not rely on the host).
    char cnt[4] = { static_cast<char>(n & 0xFF),
                    static_cast<char>((n >> 8) & 0xFF),
                    static_cast<char>((n >> 16) & 0xFF),
                    static_cast<char>((n >> 24) & 0xFF) };
    out.append(cnt, 4);

    for (const Tri& t : tris) {
        float rec[12] = { t.n[0], t.n[1], t.n[2],
                          t.a[0], t.a[1], t.a[2],
                          t.b[0], t.b[1], t.b[2],
                          t.c[0], t.c[1], t.c[2] };
        char buf[48];
        std::memcpy(buf, rec, 48);
        out.append(buf, 48);
        out.append(2, '\0');            // attribute byte count
    }
    if (truncateBy > 0 && truncateBy < out.size()) out.resize(out.size() - truncateBy);
    return out;
}

static std::string asciiStl(const std::vector<Tri>& tris) {
    std::string out = "solid AsciiBox\n";
    char line[256];
    for (const Tri& t : tris) {
        std::snprintf(line, sizeof line, "facet normal %.9g %.9g %.9g\n outer loop\n",
                      static_cast<double>(t.n[0]), static_cast<double>(t.n[1]),
                      static_cast<double>(t.n[2]));
        out += line;
        for (const auto* p : { &t.a, &t.b, &t.c }) {
            std::snprintf(line, sizeof line, "  vertex %.9g %.9g %.9g\n",
                          static_cast<double>((*p)[0]), static_cast<double>((*p)[1]),
                          static_cast<double>((*p)[2]));
            out += line;
        }
        out += " endloop\nendfacet\n";
    }
    out += "endsolid AsciiBox\n";
    return out;
}

static std::string writeTemp(const std::string& name, const std::string& bytes) {
    const std::string path = std::string("/tmp/forge_stl_gate_") + name;
    std::ofstream of(path, std::ios::binary | std::ios::trunc);
    of.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    of.close();
    return path;
}

// Enclosed volume of the imported mesh by the divergence theorem — the real
// geometric check that the triangles actually arrived, not just a count.
static double meshVolume(const forge::native::mesh::HalfEdgeMesh& m,
                         std::size_t& triOut) {
    std::vector<double> P;
    std::vector<std::uint32_t> I;
    m.toSoup(P, I);
    triOut = I.size() / 3;
    double vol = 0.0;
    for (std::size_t t = 0; t + 2 < I.size(); t += 3) {
        const double* a = &P[3 * I[t + 0]];
        const double* b = &P[3 * I[t + 1]];
        const double* c = &P[3 * I[t + 2]];
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1])
              - a[1] * (b[0] * c[2] - b[2] * c[0])
              + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0;
    }
    return std::fabs(vol);
}

// Import and report (tris, volume). `ok` is false when importStl threw.
struct Imported { bool ok = false; std::size_t tris = 0; double vol = 0.0; std::string err; };
static Imported importAndMeasure(const std::string& path) {
    Imported r;
    try {
        forge::ShapeHandle h = forge::io::importStl(path);
        auto& reg = forge::ShapeRegistry::instance();
        if (reg.kindOf(h) != forge::ShapeKind::NativeMesh) {
            r.err = "handle is not a NativeMesh";
            return r;
        }
        r.vol = meshVolume(reg.getNativeMesh(h), r.tris);
        r.ok = true;
    } catch (const std::exception& e) {
        r.err = e.what();
    }
    return r;
}

static bool rel(double got, double exp, double tol) {
    return std::fabs(got - exp) <= tol * std::max(1.0, std::fabs(exp));
}

int main() {
    std::printf("io_stl_binary_solid_header — importStl ASCII/BINARY discrimination\n\n");

    const float L = 10.0f;
    const double expVol = 1000.0;
    const std::vector<Tri> tris = boxTriangles(L);

    // ================================================================== (1)
    // THE REGRESSION: a BINARY STL whose 80-byte header begins "solid".
    {
        std::printf("[1] BINARY STL, header begins \"solid\"  (the regression)\n");
        const std::string hdr = "solid BinaryBoxFromScanner";
        const std::string bytes = binaryStl(tris, hdr);
        const std::string path = writeTemp("binary_solid_header.stl", bytes);

        // The file must genuinely present the trap, or this gate proves nothing.
        gate(bytes.compare(0, 5, "solid") == 0,
             "fixture really does start with \"solid\" (the old sniff's trap)");
        gate(bytes.size() == 84 + 50 * tris.size(),
             "fixture really is a well-formed binary STL (84 + 50*nTri bytes)");
        gate(bytes.find("facet normal") == std::string::npos,
             "fixture has no ASCII \"facet normal\" text (sniff's 2nd clause misses too)");

        const Imported r = importAndMeasure(path);
        std::printf("    imported ok=%d tris=%zu vol=%.10g  %s\n",
                    (int)r.ok, r.tris, r.vol, r.err.c_str());
        gate(r.ok, std::string("importStl ACCEPTS the binary \"solid\"-header file")
                   + (r.ok ? "" : " — threw: " + r.err));
        gate(r.ok && r.tris == 12, "  -> 12 triangles");
        gate(r.ok && rel(r.vol, expVol, 1e-9), "  -> enclosed volume == 1000 (rel<=1e-9)");
        std::printf("\n");
    }

    // ================================================================== (2)
    // A genuine ASCII STL must still read as ASCII.
    {
        std::printf("[2] ASCII STL of the same box (the size rule must not eat ASCII)\n");
        const std::string bytes = asciiStl(tris);
        const std::string path = writeTemp("ascii_box.stl", bytes);
        gate(84 + 50 * tris.size() != bytes.size(),
             "ASCII fixture does NOT satisfy the binary size rule");
        const Imported r = importAndMeasure(path);
        std::printf("    imported ok=%d tris=%zu vol=%.10g  %s\n",
                    (int)r.ok, r.tris, r.vol, r.err.c_str());
        gate(r.ok, std::string("importStl accepts the ASCII file")
                   + (r.ok ? "" : " — threw: " + r.err));
        gate(r.ok && r.tris == 12, "  -> 12 triangles");
        gate(r.ok && rel(r.vol, expVol, 1e-9), "  -> enclosed volume == 1000 (rel<=1e-9)");
        std::printf("\n");
    }

    // ================================================================== (3)
    // A TRUNCATED binary file must NOT be silently accepted — the size rule is a
    // real check, not a rubber stamp. (This is the direction that proves the gate
    // can fail: if importStl were changed to "transcode anything", it fires.)
    {
        std::printf("[3] TRUNCATED binary STL, \"solid\" header (must be REJECTED)\n");
        const std::string bytes = binaryStl(tris, "solid BinaryBoxFromScanner", /*truncateBy=*/37);
        const std::string path = writeTemp("binary_truncated.stl", bytes);
        gate(84 + 50 * tris.size() != bytes.size(),
             "fixture violates the size rule (it is truncated)");
        const Imported r = importAndMeasure(path);
        std::printf("    imported ok=%d  err=%s\n", (int)r.ok, r.err.c_str());
        gate(!r.ok, "importStl REJECTS the corrupt file (honest throw, no partial mesh)");
        std::printf("\n");
    }

    // ================================================================== (4)
    // A binary STL with a conventional header still reads (no behaviour lost).
    {
        std::printf("[4] BINARY STL, conventional (non-\"solid\") header\n");
        const std::string bytes = binaryStl(tris, "Exported by SomeCAD 2026");
        const std::string path = writeTemp("binary_plain_header.stl", bytes);
        gate(bytes.compare(0, 5, "solid") != 0, "fixture header does NOT begin \"solid\"");
        const Imported r = importAndMeasure(path);
        std::printf("    imported ok=%d tris=%zu vol=%.10g  %s\n",
                    (int)r.ok, r.tris, r.vol, r.err.c_str());
        gate(r.ok, std::string("importStl accepts it")
                   + (r.ok ? "" : " — threw: " + r.err));
        gate(r.ok && r.tris == 12, "  -> 12 triangles");
        gate(r.ok && rel(r.vol, expVol, 1e-9), "  -> enclosed volume == 1000 (rel<=1e-9)");
        std::printf("\n");
    }

    // ---- ASSERT THE COUNT OF CHECKS ACTUALLY EXECUTED (SR-3) ----------------
    const int kExpectedChecks = 16;
    std::printf("io_stl_binary_solid_header RESULT: %d/%d checks passed\n", g_pass, g_total);
    if (g_total != kExpectedChecks) {
        std::printf("  [FAIL] GATE INTEGRITY: executed %d checks, expected %d — "
                    "the gate did not run what it claims to run.\n", g_total, kExpectedChecks);
        return 2;
    }
    std::printf("  gate integrity: %d/%d checks executed as declared\n", g_total, kExpectedChecks);
    return (g_pass == g_total) ? 0 : 1;
}
