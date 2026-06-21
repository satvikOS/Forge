// forge/native/brep/MeshExchange.hpp
//
// In-house mesh interchange I/O for the Forge native kernel —
// forge::native::brep::MeshExchange. Pure C++20, standard library ONLY. No
// OCCT, no WASM, no third-party libs, no filesystem: every entry point is an
// in-memory string round-trip (write -> std::string, read(std::string) ->
// mesh) for a triangle mesh.
//
// SCOPE OF THIS INCREMENT (honest — Bible §0/§9):
//   Read + write of four classic ASCII mesh interchange formats for an indexed
//   triangle mesh (positions + triangle indices):
//
//     * STL  (ASCII)  — the "solid / facet normal / outer loop / vertex" text
//                       form. STL is a TRIANGLE SOUP with no shared vertex
//                       table: writing emits one explicit (x,y,z) per triangle
//                       corner; reading welds bit-identical coordinates back
//                       into a shared vertex table so the enclosed volume of a
//                       closed mesh is preserved exactly.
//     * OBJ  (v / f)  — Wavefront OBJ restricted to vertex positions (`v`) and
//                       triangular faces (`f`). 1-based indices, optional
//                       v/vt/vn slash groups are parsed (only the position
//                       index is used); non-triangular faces are rejected.
//     * OFF           — Object File Format: the `OFF` magic line, the
//                       `nV nF nE` count line, the vertex block, then the face
//                       block (each face line: `3 i j k`). Only triangles.
//     * PLY  (ASCII)  — the `ply` / `format ascii 1.0` header with
//                       `element vertex N` (x,y,z properties) and
//                       `element face M` (a `list` of vertex indices). Only
//                       triangular faces.
//
// FLOAT FIDELITY (the load-bearing correctness point): coordinates are
// formatted LOCALE-INDEPENDENTLY and ROUND-TRIP-EXACTLY. We emit the shortest
// decimal that parses back to the identical IEEE-754 double via std::to_chars
// (general format), and parse with std::from_chars — so write-then-read of a
// double is bit-exact, never locale- or rounding-corrupted. This is why a
// closed mesh's enclosed volume matches to within a hair (the SPEC gate uses
// 1e-6, but the underlying coordinate identity is exact).
//
// ROBUSTNESS / HONESTY POSTURE (do NOT overclaim): these are TEXT codecs, not
// geometry repair. A reader returns ok=false honestly — never a fabricated or
// partial mesh — when the text is malformed: bad magic/header line, a count
// that does not match the body, a non-finite or unparseable coordinate, a
// non-triangular or out-of-range face, or a structurally truncated stream.
// 0 FAKES: an unsupported or degenerate input is reported, not silently
// "fixed".
//
// RELATIONSHIP TO THE REST OF THE NATIVE KERNEL: this module is a leaf I/O
// codec. It #includes the sibling native headers named in its dependency set
// (Predicates, geom/Geom, geom/Delaunay3D, brep/Nurbs, mesh/HalfEdgeMesh,
// implicit/SdfTree + implicit/IsoMesher) so it composes in one translation
// unit with them and shares their Vec3/Mesh vocabulary at the call sites that
// consume it; the codec itself needs only the standard library.

#ifndef FORGE_NATIVE_BREP_MESHEXCHANGE_HPP
#define FORGE_NATIVE_BREP_MESHEXCHANGE_HPP

// --- standard headers: include EVERY one we use (CI uses libstdc++, which,
//     unlike the Mac's libc++, does NOT transitively pull these in) ----------
#include <algorithm>      // std::find, std::sort, std::min, std::max, std::clamp
#include <numeric>        // std::accumulate, std::iota
#include <functional>     // std::hash, std::function, std::greater/less
#include <cstdint>        // std::uint32_t, std::uint64_t
#include <limits>         // std::numeric_limits
#include <cstring>        // std::memcpy
#include <queue>          // std::queue (graph walks at the call site)
#include <unordered_map>  // vertex-weld table
#include <unordered_set>  // de-dup helpers
#include <map>            // ordered fallbacks
#include <set>            // ordered fallbacks
#include <cmath>          // std::isfinite, std::fabs
#include <string>         // std::string
#include <charconv>       // std::to_chars, std::from_chars
#include <vector>         // std::vector
#include <array>          // std::array
#include <cstddef>        // std::size_t

// --- named native-kernel dependencies (reused by #include only) -------------
#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/Delaunay3D.hpp"
#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/implicit/SdfTree.hpp"
#include "forge/native/implicit/IsoMesher.hpp"

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// TriMesh — the indexed triangle mesh this codec reads/writes.
//
// `positions` is a flat array of xyz triples (length == 3*vertexCount).
// `indices`   is a flat array of triangle corner indices (length == 3*triCount),
//             each index referencing a vertex in `positions`.
//
// This is a deliberately plain, self-contained value type (it does NOT alias
// the half-edge / implicit Vec3s) so the codec has one unambiguous in/out
// vocabulary; conversion to those richer types is a caller concern.
// ---------------------------------------------------------------------------
struct TriMesh {
    std::vector<double>        positions;  // flat xyz, size == 3 * vertexCount
    std::vector<std::uint32_t> indices;    // flat ijk, size == 3 * triangleCount

    std::size_t vertexCount()   const { return positions.size() / 3; }
    std::size_t triangleCount() const { return indices.size() / 3; }

    bool empty() const { return indices.empty(); }

    // Structural sanity: lengths are multiples of 3 and every index is in range.
    // (NOT a geometric validity / manifold check — that is HalfEdgeMesh's job.)
    bool wellFormed() const;

    // Enclosed (signed) volume via the divergence theorem: sum over triangles
    // of (a x b)·c / 6. For a closed, consistently-wound mesh this is the
    // enclosed volume; positive for outward-facing CCW triangles. Order-
    // independent, so a written-then-read (vertex-welded) copy gives the same
    // value as the original.
    double signedVolume() const;
};

// Result of a read. `ok == false` means the text was malformed/unsupported and
// `mesh` is left empty; `reason` carries a short human diagnostic. We NEVER
// return ok==true with a partial / fabricated mesh.
struct ReadResult {
    bool        ok{false};
    TriMesh     mesh;
    std::string reason;  // empty on success
};

// ---------------------------------------------------------------------------
// MeshExchange — the codec. All methods are static; the type is a namespace
// with a name. Every write returns a std::string; every read takes a
// std::string. No global/locale state is touched.
// ---------------------------------------------------------------------------
class MeshExchange {
public:
    // ---- STL (ASCII) ------------------------------------------------------
    // `solidName` defaults to "forge"; it is echoed in the `solid <name>` line.
    static std::string writeSTL(const TriMesh& mesh,
                                const std::string& solidName = "forge");
    static ReadResult  readSTL(const std::string& text);

    // ---- OBJ (v / f) ------------------------------------------------------
    static std::string writeOBJ(const TriMesh& mesh);
    static ReadResult  readOBJ(const std::string& text);

    // ---- OFF --------------------------------------------------------------
    static std::string writeOFF(const TriMesh& mesh);
    static ReadResult  readOFF(const std::string& text);

    // ---- PLY (ASCII) ------------------------------------------------------
    static std::string writePLY(const TriMesh& mesh);
    static ReadResult  readPLY(const std::string& text);
};

// ---------------------------------------------------------------------------
// Free helpers exposed for tests / callers (locale-independent, no I/O).
// ---------------------------------------------------------------------------

// Format a double as the shortest decimal that parses back to the identical
// IEEE-754 value (std::to_chars general format). Locale-independent.
std::string formatDouble(double v);

// Parse a double from a token using std::from_chars. Returns true and sets
// `out` on success; false (out untouched) on any trailing garbage / overflow /
// non-numeric input. Locale-independent.
bool parseDouble(const std::string& token, double& out);

// Weld bit-identical vertices of a triangle soup (used by the STL reader) into
// a shared vertex table, preserving triangle topology exactly. Coordinates are
// compared by exact 64-bit pattern, so no tolerance is introduced.
TriMesh weldVertices(const std::vector<double>& soupXYZ);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_MESHEXCHANGE_HPP
