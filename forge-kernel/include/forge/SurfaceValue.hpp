#pragma once

// ============================================================================
// forge::surf — the KERNEL SIDE OF THE `SURFACE` IR VALUE KIND.
//
// The feature-tree IR had exactly three value kinds (PROFILE, WIRE, SOLID) and
// therefore no way to NAME a sheet body. That was not a missing op, it was a
// missing TYPE: every surfacing verb the kernel already owns (loftguide::loft
// with solid=false, heal::sewShape, heal::autoFillMissingFaces,
// part::thickenSurface, surfacing::buildNurbsPatch) produces or consumes a
// FACE / SHELL / COMPOUND-of-faces, and there was no value a `%N` could hold it
// in. The consequence is measurable: the canonical INPUT inventory of
// archie_edit_214 is 430 faces of which 67 are BSPLINE, and the IR could not
// address a single one of them as a value.
//
// This file supplies the TWO primitives the IR needed that the kernel did not
// already export:
//
//   facesOf(body, indices)  — SOLID -> SURFACE. Without a face extractor the
//                             new kind is a one-way street: you could make a
//                             sheet but never get one out of a part you were
//                             asked to edit.
//   statsOf(sheet)          — the DIAGNOSIS. The SURFACE kind is defined by
//                             having the weakest invariant of the four, which
//                             only works if every way it can be degenerate is
//                             ANSWERABLE: unsewn (freeEdges), no p-curves
//                             (edgesWithoutPCurve), non-manifold, empty
//                             (faces == 0). SURFCHECK reports these; nothing
//                             here refuses a shape for having them.
//
// NOTHING IN THIS FILE THROWS FOR A DEGENERATE SHEET. `facesOf` with an empty
// index list returns EVERY face; with an index list that selects nothing it
// returns an EMPTY compound, which is a legal SURFACE value. A tolerant
// producer plus an honest measurement is the only combination that lets an
// ultra-long tree survive one bad selector.
//
// OCCT-backed, like its neighbours DirectEdit.cpp / Healing.cpp: the feature-tree
// compiler forces the OCCT analytic backend for the duration of a build, so this
// is the live path. Face INDEXING is deliberately identical to
// forge::faceInventory's (TopExp::MapShapes over TopAbs_FACE, 1-based), because
// FACES("sel") resolves its selector through that inventory and an index that
// meant something different here would silently extract the wrong faces.
// ============================================================================

#include <cstddef>
#include <string>
#include <vector>

#include "forge/ShapeRegistry.hpp"

namespace forge {
namespace surf {

// What a sheet body IS, measured rather than assumed. Every field is a fact a
// repair loop can act on; none of them is a permission.
struct SheetStats {
    std::size_t faces = 0;
    std::size_t edges = 0;
    // Edges used by exactly ONE face: the sheet's free boundary. > 0 means
    // "unsewn / open", which is a legal SURFACE and the normal state of a
    // freshly extracted face set.
    std::size_t freeEdges = 0;
    // Edges used by MORE than two faces. A non-manifold sheet is representable;
    // THICKEN will decline it, and the decline names this number.
    std::size_t nonManifoldEdges = 0;
    std::size_t shells = 0;
    // Edges carrying no p-curve on an adjacent face. A surface whose edges have
    // no 2D parametric curves is exactly the STEP/IGES import that every sewing
    // and offsetting algorithm silently mis-handles, so it is measured, not
    // assumed away.
    std::size_t edgesWithoutPCurve = 0;
    // Free-form faces (BSpline / Bezier / any non-analytic surface). This is the
    // number the ground-truth fixture is about.
    std::size_t freeformFaces = 0;
    bool        closed = false;   // no free edges AND at least one face
    double      area = 0.0;
};

// Measure `sheet`. Never throws for a degenerate sheet: an empty or malformed
// shape simply reports zeros. Throws only if the handle itself is invalid, which
// is a programming error, not a geometry state.
SheetStats statsOf(ShapeHandle sheet);

// Extract EXACTLY the named faces of `body` as a sheet body. Indices are 1-based
// in forge::faceInventory order.
//
// AN EMPTY INDEX LIST YIELDS AN EMPTY SHEET, and that is load-bearing rather than
// incidental. The first version of this function read an empty list as "every
// face", which collides with the one case the SURFACE kind exists to survive: a
// selector that matched nothing. Measured, `FACES(%body, "bore:r=99999")` on a
// 6-face box then returned all SIX faces and THICKEN happily built a 5587 mm^3
// body out of them — a wrong answer wearing the shape of a right one, which is
// strictly worse than the refusal it was meant to replace. "Give me the whole
// boundary" is now a DIFFERENT function (boundaryOf), so the two can never be
// spelled the same way again.
//
// Out-of-range and duplicate indices are SKIPPED, not refused; `skipped` (when
// non-null) receives them so the caller can say what it dropped.
//
// The result is a single FACE when exactly one face was selected, and otherwise a
// COMPOUND of the selected faces. It is deliberately NOT sewn: SEW is the explicit
// stitching verb, and sewing here would hide from the caller whether the faces it
// asked for actually meet.
ShapeHandle facesOf(ShapeHandle body, const std::vector<int>& faceIndices,
                    std::vector<int>* skipped = nullptr);

// Every face of `body` as one sheet — the total, lossless promotion SOLID ->
// SURFACE (a solid's boundary IS a sheet). A body with no faces yields an empty
// sheet rather than throwing.
ShapeHandle boundaryOf(ShapeHandle body);

// How many faces `body` has, in the same indexing facesOf uses. 0 for a shape
// with no faces. Never throws for an empty shape.
std::size_t faceCountOf(ShapeHandle body);

}  // namespace surf
}  // namespace forge
