// forge/native/brep/Sew.hpp
//
// K1.4 — native SEW / HEAL of independent B-rep faces into a connected SHELL,
// plus shell DIAGNOSIS (free / non-manifold edges, closed vs open, Euler/genus).
// This is the in-house replacement for OCCT's BRepBuilderAPI_Sewing + the first
// slice of ShapeFix (vertex-merge healing) — the "no sewing, no gap healing"
// gap called out in docs/SCOPE_2026-06-24/kernel/brep-nurbs.md §2.3 / Phase C1.
//
// It builds ON TOP of, and REUSES (no re-derivation) the K0 topology in
// Topology.hpp (Vertex / Edge / Coedge / Loop / Face / Shell) and the K0/K1.2
// face geometry (Surface, Curve/PCurve, TrimmedFace). A face handed to the sewer
// is an INDEPENDENT fragment: it owns its own vertices/edges/coedges (as if read
// from a separate STEP ADVANCED_FACE record), so coincident boundaries are
// DISTINCT topological entities until sewn. The sewer welds them.
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithm, pure C++20 + stdlib only — NO external dependencies, NO OCCT,
// NO WASM. ADDITIVE: a brand-new header + TU; Topology.hpp / TrimmedFace.hpp /
// Surface.hpp are NOT edited. The sewer mutates the topology graph that the
// caller's TopologyBuilder owns (re-pointing coedges at a surviving shared Edge,
// re-pointing edge endpoints at a surviving welded Vertex), so the lifetime of
// every entity stays with that builder.
//
// THREE REAL operations (no stub / MVP / placeholder):
//
//   1. SEW. Given a set of independent faces, the boundary edges of every face
//      are bucketed in a spatial hash keyed on each edge's two endpoint vertex
//      positions (quantised to the tolerance grid; both orderings are probed so
//      orientation does not matter for the match). A candidate pair is CONFIRMED
//      when both endpoint vertices coincide within `tol` AND a set of sampled
//      mid-curve points coincide within `tol` (so two edges that merely share
//      endpoints — e.g. the two diagonals of a quad — are NOT falsely merged).
//      A confirmed pair is welded into ONE surviving Edge carrying TWO Coedges
//      (one per face) with OPPOSITE orientation; the shared endpoint Vertices are
//      welded to one surviving Vertex each. The connected Shell adjacency is then
//      built (a union-find over faces joined by shared edges).
//
//   2. DIAGNOSE. After sewing, every surviving Edge is classified by its coedge
//      count: 1 = FREE (boundary / single use), 2 = MANIFOLD (interior), 3+ =
//      NON-MANIFOLD. A shell is CLOSED (watertight) iff it has 0 free edges and 0
//      non-manifold edges. The Euler characteristic chi = V - E + F and the genus
//      g (from chi = 2 - 2g for a closed orientable shell) are reported.
//
//   3. HEAL (light). Near-duplicate vertices within `tol` are merged (this is the
//      same weld the sew step performs on matched edges, exposed standalone so a
//      caller can de-dup a vertex cloud before/after sewing). Remaining FREE edges
//      after sewing are FLAGGED as gaps (their ids returned) — NOT yet filled.
//
// CONVENTIONS: namespace forge::native::brep. Tolerance is model-space distance.

#ifndef FORGE_NATIVE_BREP_SEW_HPP
#define FORGE_NATIVE_BREP_SEW_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/brep/Topology.hpp"   // Vertex/Edge/Coedge/Loop/Face/Shell, TopologyBuilder

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// SewOptions — tolerances and sampling controls for the match step.
// ---------------------------------------------------------------------------
struct SewOptions {
    // Model-space distance under which two points are considered coincident.
    double tol = 1e-6;

    // Number of interior sample points along each edge's curve (in addition to
    // the two endpoints) used to confirm an edge pair really is the SAME curve,
    // not just two curves sharing endpoints. >=1 recommended. The samples are
    // taken in arc-parameter order on both edges (forward on one, the curve is
    // sampled in BOTH directions on the candidate so an opposite-sense match is
    // accepted). Endpoints are always tested regardless of this count.
    std::size_t midSamples = 3;

    // When true, the light HEAL weld of near-duplicate vertices is run before the
    // edge match (so two faces whose corner vertices are within tol but were
    // created independently still match). Default true.
    bool weldVertices = true;
};

// ---------------------------------------------------------------------------
// SewDiagnosis — the topology signature + manifold/closure report of the sewn
// shell. This is exactly the A/B signature the parent compares against OCCT
// (free-edge count, closedness, V/E/F + Euler/genus).
// ---------------------------------------------------------------------------
struct SewDiagnosis {
    // Topology signature (surviving entities after sewing).
    std::size_t vertices = 0;   // V — distinct welded vertices on the sewn shell
    std::size_t edges    = 0;   // E — distinct shared edges on the sewn shell
    std::size_t faces    = 0;   // F — input faces (sewing does not add/remove faces)

    // Edge manifold classification (by surviving coedge count per edge).
    std::size_t freeEdges        = 0;  // exactly 1 coedge  (boundary / gap)
    std::size_t manifoldEdges    = 0;  // exactly 2 coedges  (clean interior)
    std::size_t nonManifoldEdges = 0;  // 3+ coedges        (non-manifold join)

    // Number of connected shells found by the face-adjacency union-find (1 for a
    // fully-connected body; >1 if the input was several disjoint patches).
    std::size_t shellCount = 0;

    // CLOSED == watertight: 0 free edges AND 0 non-manifold edges (every edge is
    // shared by exactly two opposite-sense coedges). OPEN otherwise.
    bool closed = false;

    // Euler characteristic chi = V - E + F.
    long long eulerCharacteristic = 0;

    // Genus from chi = 2 - 2g (closed orientable shell). Only meaningful when
    // `closed` is true and there is a single shell; reported as (2 - chi) / 2.
    // For an open shell it is left at -1 (genus undefined for a surface with
    // boundary under this closed-surface formula).
    long long genus = -1;

    // The edge ids of every FREE edge — the "flagged gaps" the light heal reports
    // but does NOT yet fill. Empty for a watertight result.
    std::vector<std::uint32_t> freeEdgeIds;

    // The edge ids of every NON-MANIFOLD edge (3+ coedges), for the checker.
    std::vector<std::uint32_t> nonManifoldEdgeIds;
};

// ---------------------------------------------------------------------------
// MisorientedPair — a pair of faces that share a (geometrically coincident) edge
// whose two coedge uses run in the SAME direction instead of opposite. This is
// the orientation defect the diagnosis surfaces (two faces both wound CCW as seen
// from the same side cannot bound a consistent solid across their shared edge).
// ---------------------------------------------------------------------------
struct MisorientedPair {
    std::uint32_t edgeId = 0;  // the shared edge whose two coedges agree in sense
    Face* faceA = nullptr;
    Face* faceB = nullptr;
};

// ---------------------------------------------------------------------------
// SewResult — everything the sew op produces: the built shell, its diagnosis,
// and any orientation defects detected.
// ---------------------------------------------------------------------------
struct SewResult {
    bool ok = false;
    Shell* shell = nullptr;              // the (first / largest) connected shell built
    std::vector<Shell*> shells;          // all connected shells (>=1)
    SewDiagnosis diagnosis;

    // Orientation defects: shared edges whose two coedges are NOT opposite-sense.
    std::vector<MisorientedPair> misoriented;

    // How many independent edges were merged into a shared edge (pairs welded).
    std::size_t mergedEdgePairs = 0;
    // How many near-duplicate vertices were welded away by the heal/weld step.
    std::size_t weldedVertices = 0;

    const char* reason = "";
};

// ===========================================================================
// (1)+(2)+(3) THE SEW OP
// ===========================================================================
//
// Sew the given `faces` (each an independent fragment owned by `tb`) into one or
// more connected shells, weld coincident boundary edges/vertices, build shell
// adjacency, and diagnose the result. The faces' Edges/Coedges/Vertices are
// mutated in place (coedges re-pointed at the surviving shared edge; edge
// endpoints re-pointed at the surviving welded vertex). New Shell objects are
// allocated via `tb`. Returns the full result; `ok` is false only on a malformed
// input (a face with no outer loop, or an empty face set).
//
// NOTE on FACE INDEPENDENCE: this op assumes each input face was built so its
// boundary entities are PRIVATE (not already shared via addOuterLoopToFace's
// edge reuse). That is the real import scenario (N separate STEP ADVANCED_FACE
// records). A box already sewn through addOuterLoopToFace's edge-sharing is
// already a single shell; running the sewer on its faces is idempotent (every
// edge already has two coedges, so no new merges occur).
SewResult sewFaces(TopologyBuilder& tb,
                   const std::vector<Face*>& faces,
                   const SewOptions& opt = {});

// ---------------------------------------------------------------------------
// diagnoseShell — DIAGNOSE only (no mutation): classify the edges of an already-
// built shell and report the closure / Euler / genus signature. Useful to verify
// a shell that was assembled some other way (e.g. the box from buildBox).
// `faces` is the shell's face set; every Edge reachable from those faces' loops
// is classified by how many of those coedges use it.
// ---------------------------------------------------------------------------
SewDiagnosis diagnoseShell(const std::vector<Face*>& faces);

// ---------------------------------------------------------------------------
// weldNearVertices — HEAL (light), standalone: merge every pair of vertices in
// `verts` whose positions are within `tol` into a single surviving vertex, and
// re-point every Edge in `edges` that referenced a removed vertex at the
// survivor. Returns the number of vertices welded away. Pure topology fix-up; the
// removed Vertex objects stay owned by their builder (just unreferenced).
// ---------------------------------------------------------------------------
std::size_t weldNearVertices(const std::vector<Vertex*>& verts,
                             const std::vector<Edge*>& edges,
                             double tol);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_SEW_HPP
