// forge/native/brep/Heal.hpp
//
// K5-heal — native B-REP HEALING (the in-house replacement for OCCT's
// ShapeFix_Shape / ShapeFix_Wire / ShapeUpgrade_* on a native shell) — Phase H3
// of docs/SCOPE_2026-06-24/kernel/healing-tolerance.md. It takes a single connected
// native B-rep shell (a set of polygonal `Face`s owned by a TopologyBuilder, each
// bounded by one outer Loop + zero-or-more inner Loops) that has IMPORT DEFECTS and
// repairs it in place to a clean, ideally closed 2-manifold shell, reporting exactly
// what was fixed and what could NOT be safely fixed.
//
// It BUILDS ON, and REUSES (no re-derivation), the K1.4 SEW layer (Sew.hpp):
//   * weldNearVertices   — the tolerance spatial-hash vertex weld (duplicate-vertex
//                          removal step (4) IS this weld; gap-fill step (1) snaps
//                          near-coincident free-edge endpoints then re-welds),
//   * sewFaces           — re-stitches the welded faces into shared-edge coedge
//                          mates (so after a collapse / weld the topology is rebuilt
//                          with the same matcher the sewer uses, not a second copy),
//   * diagnoseShell      — the free/manifold/non-manifold + closed/Euler/genus
//                          signature, used VERBATIM for the before/after report.
// and the K0 topology graph (Topology.hpp Vertex/Edge/Coedge/Loop/Face/Shell).
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithm, pure C++20 + stdlib only — NO external dependencies, NO OCCT, NO
// WASM. ADDITIVE: a brand-new header + TU; Topology.hpp / Sew.hpp / TrimmedFace.hpp
// are NOT edited. It MUTATES the topology graph the caller's TopologyBuilder owns
// (re-pointing edge endpoints at welded survivors, dropping collapsed edges and
// sliver faces, re-running the sewer to re-mate coedges); every entity's lifetime
// stays with that builder (dropped entities are just unreferenced, never freed
// here). NO geometry is fabricated: gap-fill only SNAPS free endpoints that are
// already within `tol`; a gap wider than `tol`, a non-collapsible short edge, or a
// hole the sliver-removal opens that does not re-close is reported UNFIXED with its
// entity ids — never papered over.
//
// THE FIVE REAL HEAL OPERATIONS (1:1 with the spec's H3 / OCCT ShapeFix items,
// no stub / MVP / placeholder):
//
//   (1) GAP-FILL (extends the sewer's weld). Free-edge ENDPOINTS that lie within
//       `tol` of another free-edge endpoint (but were distinct topological vertices
//       — a sub-tol gap a plain endpoint-equality sew would miss) are SNAPPED to a
//       common welded vertex, then the faces are re-sewn so the now-coincident free
//       edges merge into shared-edge coedge mates. This closes the kind of gap an
//       imported STEP leaves between two ADVANCED_FACE records whose shared edge was
//       written twice with a δ < tol mismatch. (OCCT ShapeFix free-edge reduction.)
//
//   (2) SMALL-EDGE COLLAPSE. An edge whose two endpoint vertices are within `tol`
//       (a zero-length / sub-tol edge — e.g. a STEP-imported edge written with a
//       duplicated point, or a split-edge artefact's stub) is REMOVED by welding its
//       two endpoints into one and deleting the now-degenerate coedge uses from
//       every loop that referenced it, re-stitching those loops' next/prev so each
//       ring stays closed with one fewer coedge. (ACIS api_remove_short_edges.)
//
//   (3) SLIVER-FACE REMOVAL. A face whose polygonal area < `tol`^2, OR whose aspect
//       ratio is degenerate (longest edge / shortest altitude beyond `aspectMax`),
//       is DROPPED from the shell; the hole it leaves is healed by re-sewing the
//       remaining faces (the sliver's neighbours' edges re-mate across the gap when
//       the sliver was a thin bridge, leaving a clean closed shell). If dropping the
//       face leaves an unclosable hole, the face is KEPT and reported unfixed. (ACIS
//       api_remove_sliver_faces.)
//
//   (4) DUPLICATE / DEGENERATE REMOVAL. Coincident vertices within `tol` are welded
//       (REUSE: weldNearVertices); zero-length edges (start ≡ end after the weld) are
//       removed exactly as (2). This is the de-dup pass the import scenario needs and
//       is run BEFORE the gap-fill / collapse passes so they see a de-duplicated graph.
//
//   (5) REPORT. The HealReport carries the COUNTS of every fix actually applied
//       (vertices welded, gaps closed, short edges collapsed, sliver faces removed,
//       duplicate faces removed) AND the BEFORE / AFTER diagnosis signature
//       (free-edge count, manifold/non-manifold counts, closed flag, V/E/F, Euler,
//       genus) taken from diagnoseShell — plus the ids of any defect left UNFIXED.
//
// CONVENTIONS: namespace forge::native::brep. Tolerance is model-space distance.
// Faces are POLYGONAL (their boundary geometry is taken from the loop vertex
// positions — the box / imported-faceted gate); the area / volume invariants are
// computed from those polygons by Green's theorem / the divergence theorem, exactly
// as the mesh validator's signedVolume does, so "volume preserved to tol" is a real
// measured invariant, not an assumption.

#ifndef FORGE_NATIVE_BREP_HEAL_HPP
#define FORGE_NATIVE_BREP_HEAL_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/brep/Topology.hpp"   // Vertex/Edge/Coedge/Loop/Face/Shell, TopologyBuilder
#include "forge/native/brep/Sew.hpp"        // SewDiagnosis (reused as the report signature)

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// HealOptions — the tolerances / toggles for the five heal passes.
// ---------------------------------------------------------------------------
struct HealOptions {
    // Model-space distance under which two points coincide / a gap is closeable /
    // an edge is "short". This is the single ACIS-style modelling tolerance.
    double tol = 1e-6;

    // A face is a SLIVER (removable) when its polygonal area is below this. Default
    // tol^2 (so a face thinner than tol in one direction over a tol-scale extent is
    // a sliver). Set <= 0 to use tol*tol.
    double sliverAreaEps = -1.0;

    // Degenerate-aspect threshold: a face whose (longest boundary edge) / (its area /
    // longest edge, i.e. the mean altitude across the long edge) exceeds aspectMax is
    // treated as a sliver even if its raw area is above sliverAreaEps. Default 1e4.
    double aspectMax = 1e4;

    // Toggles (all on by default) so a caller can run a single pass for A/B.
    bool weldDuplicateVertices = true;  // (4) coincident-vertex weld
    bool collapseShortEdges     = true; // (2) sub-tol edge removal
    bool removeSliverFaces      = true; // (3) sliver-face drop + hole heal
    bool fillGaps               = true; // (1) free-endpoint snap + re-sew

    // Interior mid-curve samples handed to the re-sew step (Sew's confirm match).
    std::size_t sewMidSamples = 3;
};

// ---------------------------------------------------------------------------
// HealReport — what the heal did + the before/after signature + unfixed defects.
// ---------------------------------------------------------------------------
struct HealReport {
    bool ok = false;             // false only on malformed input (null/empty/no loop)
    const char* reason = "";

    // ---- counts of fixes ACTUALLY applied -------------------------------------
    std::size_t verticesWelded     = 0;  // (4) duplicate/coincident vertices merged away
    std::size_t gapsClosed         = 0;  // (1) free-edge endpoint pairs snapped together
    std::size_t shortEdgesCollapsed = 0; // (2) sub-tol edges removed
    std::size_t sliverFacesRemoved = 0;  // (3) sliver faces dropped
    std::size_t edgePairsMerged    = 0;  // shared edges re-mated by the re-sew (gap-fill result)

    // ---- before / after topology+manifold signature (from diagnoseShell) ------
    SewDiagnosis before;   // signature of the defective input shell
    SewDiagnosis after;    // signature after all enabled heal passes

    // ---- measured geometric invariants ----------------------------------------
    // Closed-shell volume (divergence theorem over the polygonal faces) before/after
    // — only meaningful when that state is closed; reported regardless so the caller
    // can see how far from closed the open states were (an open shell's "volume" is
    // the same surface integral and is reported for completeness, marked by closed).
    double volumeBefore = 0.0;
    double volumeAfter  = 0.0;
    double areaBefore   = 0.0;   // total polygonal surface area before
    double areaAfter    = 0.0;   // total polygonal surface area after

    // ---- defects left UNFIXED (honest, no fabrication) ------------------------
    // Free edges still open after every enabled pass (gap too wide to snap, or a
    // genuine missing face). Empty iff the result is watertight.
    std::vector<std::uint32_t> unfixedFreeEdgeIds;
    // Non-manifold edges that remain (3+ coedge uses the manifold model cannot heal).
    std::vector<std::uint32_t> unfixedNonManifoldEdgeIds;
    // Short edges that could NOT be collapsed safely (collapsing would pinch a loop
    // below 3 coedges / merge two distinct loop corners) — kept, reported here.
    std::vector<std::uint32_t> uncollapsibleShortEdgeIds;
    // Sliver faces detected but KEPT because dropping them would open an unclosable
    // hole. Reported so the caller knows the geometry is still dirty there.
    std::vector<std::uint32_t> keptSliverFaceIds;

    // The faces of the healed shell (the input faces minus removed slivers). This is
    // the live face set the caller re-shells / re-diagnoses; `shell` is the (re-sewn)
    // primary connected shell when one was built.
    std::vector<Face*> faces;
    Shell* shell = nullptr;

    // Convenience: every enabled defect class is resolved.
    bool fullyHealed() const {
        return after.closed &&
               unfixedFreeEdgeIds.empty() &&
               unfixedNonManifoldEdgeIds.empty() &&
               keptSliverFaceIds.empty();
    }
};

// ===========================================================================
// healBRep — THE HEAL OP.
// ===========================================================================
//
// Heal the polygonal B-rep shell given by `faces` (each an independent / loosely
// stitched fragment owned by `tb`) in place. Runs, in order:
//   (4) weld duplicate/coincident vertices  (REUSE weldNearVertices)
//   (2) collapse sub-tol short edges + re-stitch their loops
//   (3) remove sliver faces + heal the hole
//   (1) snap remaining free-edge endpoints within tol + re-sew  (REUSE sewFaces)
// then DIAGNOSE the before/after signature (REUSE diagnoseShell) and report.
//
// Mutates the entities in `faces` (vertex positions/links, loop rings, edge/coedge
// mates) via `tb`. Returns the full report; `ok` is false only on a malformed input
// (empty face set, or a face with no outer loop). A defect that cannot be safely
// healed is reported in the unfixed* lists — NEVER silently "fixed".
HealReport healBRep(TopologyBuilder& tb,
                    const std::vector<Face*>& faces,
                    const HealOptions& opt = {});

// ---------------------------------------------------------------------------
// shellSignedVolume / shellSurfaceArea — the measured geometric invariants used in
// the report, exposed standalone for the A/B harness. The volume is the divergence
// theorem ∮ (1/3) r·n dA over the polygonal faces (each face fanned from its first
// outer-loop vertex; inner loops subtract), so it is the EXACT signed volume of the
// closed polyhedral shell (machine-precise for the box). The area is the sum of the
// faces' polygon areas. Both read the loop VERTEX POSITIONS (no surface geometry
// required — the faceted / box gate).
double shellSignedVolume(const std::vector<Face*>& faces);
double shellSurfaceArea(const std::vector<Face*>& faces);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_HEAL_HPP
