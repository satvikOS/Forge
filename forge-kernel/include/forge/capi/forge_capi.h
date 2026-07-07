/* forge/capi/forge_capi.h
 *
 * ============================================================================
 * FORGE C-API — Parasolid/ACIS-style opaque-handle black-box modeler interface
 * (Keystone K7 of OCCT_REPLACEMENT_ROADMAP.md — the public interface Forge calls)
 * ============================================================================
 *
 * This is a STRICT C interface (ISO C99, `extern "C"`) that wraps the in-house
 * native geometry kernel (forge::native::brep / mesh / csg) as a functional,
 * token-driven black box — exactly the encapsulation posture of Parasolid's PK_
 * API and ACIS' kernel API:
 *
 *   * OPAQUE HANDLES ONLY. A body/entity is an opaque unsigned integer
 *     (FgHandle); a session is an opaque pointer (incomplete-type idiom). NO C++
 *     type (Solid, TopologyBuilder, HalfEdgeMesh, std::vector, std::string, ...)
 *     is ever named, sized, or laid bare in this header. A caller — in C, Rust,
 *     Swift, a Node N-API shim, a Python ctypes binding — links the .node/.dylib
 *     and sees only handles, doubles, ints, and C strings.
 *
 *   * FUNCTIONAL TOKENS. Every operation is a free function `Fg<Verb>(...)` that
 *     takes a session + input handles + plain scalars and returns an FgStatus
 *     code, writing any produced entity to an out-param FgHandle. There is no
 *     object graph, no inheritance, no callbacks into C++ — a black box.
 *
 *   * NO GRAPHICS / APP FRAMEWORK. Pure geometry + data-exchange. Tessellation
 *     hands back a plain indexed triangle soup (double* / uint32_t*) for the
 *     caller's own renderer; there is zero windowing / GL / scene-graph leakage.
 *
 * HONESTY (Bible sec.0/sec.9): this header is the DESIGNED, AUTHORED K7 skeleton.
 * The mapping .cpp (src/native/capi/forge_capi.cpp) wires each token to the
 * already-native op it names. It is authored WRITE-ONLY under the RAM rule (no
 * build); the post-train verify batch compiles it and runs the C-API smoke test.
 * No token here promises geometry the native kernel does not already produce —
 * each Fg* verb has a one-to-one native backing op documented at its declaration.
 *
 * MEMORY / OWNERSHIP CONTRACT:
 *   * Entities (FgHandle) are owned by the FgSession that minted them and live
 *     until FgDeleteBody or FgSessionDestroy. Handles are never reused within a
 *     session (monotonic mint), so a stale handle is a hard FG_ERR_INVALID_HANDLE
 *     rather than a silent alias.
 *   * Any buffer the API allocates for the caller (tessellation arrays, STEP
 *     text) is released with FgFree — never the caller's own free()/delete.
 *   * The API is single-threaded per session (a session holds no lock). Distinct
 *     sessions are independent and may run on separate threads.
 */

#ifndef FORGE_CAPI_H
#define FORGE_CAPI_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* --------------------------------------------------------------------------
 * Export / visibility
 * ------------------------------------------------------------------------ */
#if defined(_WIN32)
#  define FG_API __declspec(dllexport)
#else
#  define FG_API __attribute__((visibility("default")))
#endif

/* --------------------------------------------------------------------------
 * Opaque handle types (NO C++ leakage)
 * ------------------------------------------------------------------------ */

/* An opaque body / entity id. 0 == FG_NULL_HANDLE (never a valid entity). */
typedef uint64_t FgHandle;

/* An opaque session. Declared as a pointer to an incomplete struct so the
 * caller can hold/pass it but can never see its layout. */
typedef struct FgSession_* FgSession;

#define FG_NULL_HANDLE ((FgHandle)0)

/* --------------------------------------------------------------------------
 * Status codes — every op returns one of these (FG_OK == 0 == success)
 * ------------------------------------------------------------------------ */
typedef int32_t FgStatus;
enum {
    FG_OK                   =  0,  /* success                                      */
    FG_ERR_INVALID_SESSION  = -1,  /* session pointer is null / not a live session */
    FG_ERR_INVALID_HANDLE   = -2,  /* body handle unknown to this session          */
    FG_ERR_NULL_ARGUMENT    = -3,  /* a required out-param / array pointer is null  */
    FG_ERR_INVALID_ARGUMENT = -4,  /* a scalar arg is out of range / non-finite     */
    FG_ERR_OPERATION_FAILED = -5,  /* the native op ran but produced no valid body  */
    FG_ERR_NOT_MANIFOLD     = -6,  /* result was not a closed 2-manifold (honest)   */
    FG_ERR_UNSUPPORTED      = -7,  /* op not defined for this body kind            */
    FG_ERR_OUT_OF_MEMORY    = -8,  /* allocation failed                            */
    FG_ERR_IO               = -9,  /* file read/write failure                      */
    FG_ERR_EMPTY_RESULT     = -10  /* op succeeded but yielded an empty entity      */
};

/* --------------------------------------------------------------------------
 * Enumerated tokens
 * ------------------------------------------------------------------------ */

/* Regularized boolean op (maps 1:1 to native brep::BoolOp / OCCT Fuse/Cut/Common). */
typedef int32_t FgBoolOp;
enum {
    FG_FUSE   = 0,  /* A U B */
    FG_CUT    = 1,  /* A - B */
    FG_COMMON = 2   /* A ^ B */
};

/* Body kind an FgHandle currently denotes (query via FgBodyKindOf). */
typedef int32_t FgBodyKind;
enum {
    FG_BODY_NONE  = 0,  /* not a live body                                          */
    FG_BODY_SOLID = 1,  /* analytic B-rep solid (brep::Solid — quadric faces)       */
    FG_BODY_MESH  = 2   /* faceted watertight mesh (extrude/revolve/fillet/...)      */
};

/* --------------------------------------------------------------------------
 * Session lifecycle
 * ------------------------------------------------------------------------ */

/* Create a modeling session (the owner of all bodies made through it).
 * Writes the new session to *outSession. */
FG_API FgStatus FgSessionCreate(FgSession* outSession);

/* Destroy a session and free every body it owns. All handles minted by it become
 * invalid. Passing an already-destroyed / null session -> FG_ERR_INVALID_SESSION. */
FG_API FgStatus FgSessionDestroy(FgSession session);

/* Human-readable diagnostic for the LAST op on this session (e.g. a native
 * `reason` string). Valid until the next call on the same session. Returns a
 * static "" when there is no error text. Never null. */
FG_API const char* FgLastError(FgSession session);

/* Library version string (build-stamped). Never null. */
FG_API const char* FgVersion(void);

/* --------------------------------------------------------------------------
 * Entity management
 * ------------------------------------------------------------------------ */

/* Delete one body, freeing its geometry. */
FG_API FgStatus FgDeleteBody(FgSession session, FgHandle body);

/* Deep-copy a body into a new handle (independent lifetime). */
FG_API FgStatus FgCopyBody(FgSession session, FgHandle body, FgHandle* outCopy);

/* Report the kind (FG_BODY_SOLID / FG_BODY_MESH / FG_BODY_NONE) of a handle. */
FG_API FgStatus FgBodyKindOf(FgSession session, FgHandle body, FgBodyKind* outKind);

/* 1 into *outValid if `body` is a live, geometrically valid body; else 0.
 * Returns FG_OK even when *outValid==0 (validity is data, not an API error). */
FG_API FgStatus FgIsValid(FgSession session, FgHandle body, int32_t* outValid);

/* --------------------------------------------------------------------------
 * Canonical primitives  ->  brep::SolidFactory  (analytic FG_BODY_SOLID)
 *   Placement matches OCCT BRepPrimAPI 1:1 (see brep/Primitives.hpp).
 * ------------------------------------------------------------------------ */

/* Axis-aligned box spanning [0,dx] x [0,dy] x [0,dz]. */
FG_API FgStatus FgCreateBox(FgSession session, double dx, double dy, double dz, FgHandle* out);

/* Cylinder radius r, height h, axis +Z, base on z=0. */
FG_API FgStatus FgCreateCylinder(FgSession session, double r, double h, FgHandle* out);

/* Cone/frustum: base radius r1 on z=0, top radius r2 on z=h (r2==0 -> apex). */
FG_API FgStatus FgCreateCone(FgSession session, double r1, double r2, double h, FgHandle* out);

/* Sphere radius r, centred at origin. */
FG_API FgStatus FgCreateSphere(FgSession session, double r, FgHandle* out);

/* Torus, major radius R (XY plane), minor radius r, axis +Z, centred at origin. */
FG_API FgStatus FgCreateTorus(FgSession session, double majorR, double minorR, FgHandle* out);

/* Regular n-gon prism, circumradius R, height h, axis +Z, z in [0,h]. */
FG_API FgStatus FgCreatePrism(FgSession session, int32_t nSides, double R, double h, FgHandle* out);

/* --------------------------------------------------------------------------
 * Sketch-based features  ->  brep::prism / csg::revolve  (FG_BODY_MESH)
 * ------------------------------------------------------------------------ */

/* Linear extrude (prism). `outerXY` is a flat array of 2*ptCount doubles: an
 * ordered, simple, closed polygon in the XY plane (do NOT repeat the first
 * point). The profile is swept `distance` along +Z. Backed by brep::prism. */
FG_API FgStatus FgExtrude(FgSession session,
                          const double* outerXY, uint32_t ptCount,
                          double distance, FgHandle* out);

/* Revolve a 2D profile about an axis. `profileUV` is a flat array of 2*ptCount
 * doubles (x = distance along axis, y = radial distance from axis; the whole
 * profile must lie on ONE side of the axis). `axisOrigin` / `axisDir` are
 * 3-vectors (dir need not be unit). Sweeps `angleDeg` (0<deg<=360) in `segments`
 * steps. Backed by csg::revolve. */
FG_API FgStatus FgRevolve(FgSession session,
                          const double* profileUV, uint32_t ptCount,
                          const double axisOrigin[3], const double axisDir[3],
                          double angleDeg, int32_t segments, FgHandle* out);

/* --------------------------------------------------------------------------
 * Modifying features
 * ------------------------------------------------------------------------ */

/* Regularized boolean A (op) B. If both operands are analytic solids the result
 * is an analytic FG_BODY_SOLID via brep::booleanSolid; if either is a mesh the
 * result is an FG_BODY_MESH via brep::booleanMeshOperand. `out` receives a NEW
 * body; the operands are untouched. FG_ERR_NOT_MANIFOLD if the result cannot be
 * closed (honest — never a wrong solid). */
FG_API FgStatus FgBoolean(FgSession session, FgHandle a, FgHandle b,
                          FgBoolOp op, FgHandle* out);

/* Constant-radius fillet of every sharp CONVEX edge whose dihedral exceeds
 * `thresholdDeg`. `radius` > 0, `nSeg` = blend segments (>=1). Result is an
 * FG_BODY_MESH via brep::filletConvexEdges. */
FG_API FgStatus FgFillet(FgSession session, FgHandle body,
                         double radius, uint32_t nSeg, double thresholdDeg,
                         FgHandle* out);

/* Hollow a solid to a uniform wall of `thickness` (model units, inward). The
 * optional `removedFaceIdx` (length `removedCount`, indices into the solid's
 * outer-shell face list) are the open mouths; pass NULL/0 for a closed hollow.
 * Analytic solids only (FG_ERR_UNSUPPORTED on a mesh body). Backed by
 * brep::shellSolid; result is an analytic FG_BODY_SOLID. */
FG_API FgStatus FgShell(FgSession session, FgHandle body, double thickness,
                        const uint32_t* removedFaceIdx, uint32_t removedCount,
                        FgHandle* out);

/* --------------------------------------------------------------------------
 * Queries  ->  brep::massProperties / computeAabb / mesh::signedVolume
 * ------------------------------------------------------------------------ */

/* Signed volume (unit density) of a body. */
FG_API FgStatus FgVolume(FgSession session, FgHandle body, double* outVolume);

/* Mass properties: volume + centre of mass (outCom[3]) at unit density.
 * `outCom` may be NULL if only the volume is wanted. */
FG_API FgStatus FgMassProperties(FgSession session, FgHandle body,
                                 double* outVolume, double outCom[3]);

/* Axis-aligned bounding box of the (untransformed) body: outMin[3], outMax[3]. */
FG_API FgStatus FgBoundingBox(FgSession session, FgHandle body,
                              double outMin[3], double outMax[3]);

/* --------------------------------------------------------------------------
 * Tessellation  ->  brep::tessellateSolid / mesh::toSoup
 * ------------------------------------------------------------------------ */

/* Tessellate a body to an indexed triangle soup. On success the API ALLOCATES:
 *   *outVerts : 3*(*outVertCount) doubles (flat xyz), and
 *   *outTris  : 3*(*outTriCount)  uint32_t (flat triangle indices).
 * The caller MUST release BOTH via FgFree. `linearTol` is the chord tolerance
 * (<=0 -> a kernel default). Analytic solids honor their as-built faceting; mesh
 * bodies return their stored soup. */
FG_API FgStatus FgTessellate(FgSession session, FgHandle body, double linearTol,
                             double**   outVerts, uint32_t* outVertCount,
                             uint32_t** outTris,  uint32_t* outTriCount);

/* --------------------------------------------------------------------------
 * Data exchange (STEP AP242)  ->  brep::StepAnalytic / StepFaceted
 * ------------------------------------------------------------------------ */

/* Write a body to a STEP file at `path`. Analytic solids emit an
 * ADVANCED_BREP_SHAPE_REPRESENTATION (real CYLINDRICAL/SPHERICAL/... surfaces);
 * mesh bodies emit a faceted MANIFOLD_SOLID_BREP. */
FG_API FgStatus FgExportStep(FgSession session, FgHandle body, const char* path);

/* Same as FgExportStep but returns the STEP document as a NUL-terminated C
 * string in *outText (API-allocated; release with FgFree). */
FG_API FgStatus FgExportStepToString(FgSession session, FgHandle body, char** outText);

/* Read the FIRST solid from a STEP file at `path` into a new analytic
 * FG_BODY_SOLID (brep::StepAnalytic::read). */
FG_API FgStatus FgImportStep(FgSession session, const char* path, FgHandle* out);

/* --------------------------------------------------------------------------
 * Memory
 * ------------------------------------------------------------------------ */

/* Release any buffer the API handed the caller (tessellation arrays / STEP text).
 * NULL is a no-op. Do NOT pass the caller's own pointers. */
FG_API void FgFree(void* buffer);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* FORGE_CAPI_H */
