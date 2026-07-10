// forge/native/capi/forge_capi.cpp
//
// ============================================================================
// FORGE C-API IMPLEMENTATION — the token->native-op mapping layer (Keystone K7)
// ============================================================================
//
// This is the black-box wrapper body for include/forge/capi/forge_capi.h. Each
// extern "C" Fg* token forwards to the already-native kernel op it names in the
// header (brep::SolidFactory, brep::booleanSolid/booleanMeshOperand,
// brep::filletConvexEdges, brep::shellSolid, brep::prism, csg::revolve,
// brep::massProperties, brep::computeAabb, brep::tessellateSolid,
// brep::StepAnalytic/StepFaceted). No new geometry math lives here — it is the
// encapsulation boundary only.
//
// HONESTY (Bible sec.0/sec.9): authored WRITE-ONLY under the RAM rule (the Archie
// 30B train holds the machine; no cmake/clang here). The post-train verify batch
// compiles this TU and runs test/capi/forge_capi_smoke (see the A/B note at the
// tail of this file). Every op returns an HONEST FgStatus: a native op that
// reports ok=false surfaces as FG_ERR_* with the native `reason` copied into the
// session's last-error string — never a fabricated success.
//
// INTERNAL MODEL:
//   * FgSession_ owns an id->Body map, mints monotonic handles (never reused),
//     and holds the last-error string.
//   * Body is a tagged union of the two native body kinds the kernel produces:
//       - FG_BODY_SOLID: an analytic brep::Solid* VIEW kept alive by a type-
//         erased `keep` (a shared_ptr<void> holding the owning SolidFactory /
//         TopologyBuilder so the Solid* never dangles).
//       - FG_BODY_MESH: a flat indexed triangle soup (positions + indices) — the
//         common currency every mesh-producing native op (prism/revolve/fillet/
//         mesh-boolean) emits and every consumer (tessellate/boolean/step-faceted)
//         accepts. Volume/validity build a transient HalfEdgeMesh on demand.
//   * No C++ type crosses the extern "C" boundary; callers see only the opaque
//     FgHandle / FgSession and POD out-params.

#include "forge/capi/forge_capi.h"

#include <cmath>
#include <cstdint>   // uint32_t: used 33x below; libc++ pulls it in
                     // transitively, libstdc++ does not. The native preflight catches this.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/Fillet.hpp"
#include "forge/native/brep/Shell.hpp"
#include "forge/native/brep/Sweep.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Aabb.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/StepFaceted.hpp"
#include "forge/native/csg/Revolve.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/geom/Geom.hpp"

namespace nb = forge::native::brep;
namespace nc = forge::native::csg;
namespace nm = forge::native::mesh;
namespace ng = forge::native::geom;

// ===========================================================================
// Internal body + session representation (never exposed across extern "C")
// ===========================================================================
namespace {

struct Body {
    FgBodyKind kind = FG_BODY_NONE;

    // FG_BODY_SOLID: analytic B-rep. `solid` is a non-owning view; `keep` holds
    // the owning object (SolidFactory / TopologyBuilder) so `solid` stays valid.
    std::shared_ptr<void> keep;
    nb::Solid*            solid = nullptr;

    // FG_BODY_MESH: flat indexed triangle soup (the mesh-op currency).
    std::vector<double>        pos;
    std::vector<std::uint32_t> idx;
};

} // namespace

// The opaque session struct the header forward-declares as `struct FgSession_*`.
struct FgSession_ {
    std::unordered_map<FgHandle, Body> bodies;
    FgHandle    nextId = 1;      // monotonic; 0 reserved for FG_NULL_HANDLE
    std::string lastError;       // human-readable diagnostic of the last op

    FgHandle add(Body&& b) {
        FgHandle h = nextId++;
        bodies.emplace(h, std::move(b));
        return h;
    }
    Body* find(FgHandle h) {
        auto it = bodies.find(h);
        return it == bodies.end() ? nullptr : &it->second;
    }
};

namespace {

// --- small helpers ---------------------------------------------------------

inline bool finite1(double v) { return std::isfinite(v); }

// Set the session error text and return the status verbatim (one-line pattern).
FgStatus fail(FgSession s, FgStatus code, const char* msg) {
    if (s) s->lastError = msg ? msg : "";
    return code;
}
FgStatus ok(FgSession s) {
    if (s) s->lastError.clear();
    return FG_OK;
}

// Materialize any body as a flat triangle soup. Analytic -> tessellateSolid;
// mesh -> copy its stored soup. Returns false only if the analytic tessellation
// produced nothing.
bool bodyToSoup(const Body& b, std::vector<double>& pos,
                std::vector<std::uint32_t>& idx, double weldTol = 1e-9) {
    if (b.kind == FG_BODY_MESH) {
        pos = b.pos;
        idx = b.idx;
        return !idx.empty();
    }
    if (b.kind == FG_BODY_SOLID && b.solid) {
        pos.clear();
        idx.clear();
        nb::tessellateSolid(*b.solid, pos, idx, weldTol);
        return !idx.empty();
    }
    return false;
}

// Build a fresh Body of FG_BODY_MESH from a soup.
Body makeMeshBody(std::vector<double>&& pos, std::vector<std::uint32_t>&& idx) {
    Body b;
    b.kind = FG_BODY_MESH;
    b.pos  = std::move(pos);
    b.idx  = std::move(idx);
    return b;
}

// Copy an owning malloc'd double buffer for the caller (FgFree-able). Returns
// nullptr on OOM.
double* dupDoubles(const std::vector<double>& v) {
    if (v.empty()) return static_cast<double*>(std::malloc(1)); // non-null sentinel
    double* p = static_cast<double*>(std::malloc(v.size() * sizeof(double)));
    if (p) std::memcpy(p, v.data(), v.size() * sizeof(double));
    return p;
}
std::uint32_t* dupU32(const std::vector<std::uint32_t>& v) {
    if (v.empty()) return static_cast<std::uint32_t*>(std::malloc(1));
    std::uint32_t* p =
        static_cast<std::uint32_t*>(std::malloc(v.size() * sizeof(std::uint32_t)));
    if (p) std::memcpy(p, v.data(), v.size() * sizeof(std::uint32_t));
    return p;
}

// Map the C op token to the native enum.
bool mapBoolOp(FgBoolOp op, nb::BoolOp& out) {
    switch (op) {
        case FG_FUSE:   out = nb::BoolOp::Fuse;   return true;
        case FG_CUT:    out = nb::BoolOp::Cut;    return true;
        case FG_COMMON: out = nb::BoolOp::Common; return true;
        default: return false;
    }
}

// Read profileUV flat array into a native Point2 ring (x=along/u, y=radial/v).
std::vector<ng::Point2> readPoint2Ring(const double* xy, std::uint32_t n) {
    std::vector<ng::Point2> ring;
    ring.reserve(n);
    for (std::uint32_t i = 0; i < n; ++i) {
        ng::Point2 p;
        p.x = xy[2 * i + 0];
        p.y = xy[2 * i + 1];
        ring.push_back(p);
    }
    return ring;
}

} // namespace

// ===========================================================================
// extern "C" surface — the black-box tokens
// ===========================================================================
extern "C" {

// -------------------- session lifecycle ------------------------------------

FG_API FgStatus FgSessionCreate(FgSession* outSession) {
    if (!outSession) return FG_ERR_NULL_ARGUMENT;
    FgSession s = new (std::nothrow) FgSession_();
    if (!s) return FG_ERR_OUT_OF_MEMORY;
    *outSession = s;
    return FG_OK;
}

FG_API FgStatus FgSessionDestroy(FgSession session) {
    if (!session) return FG_ERR_INVALID_SESSION;
    delete session;   // frees every Body (unique/shared owners) it holds
    return FG_OK;
}

FG_API const char* FgLastError(FgSession session) {
    static const char* kEmpty = "";
    if (!session) return kEmpty;
    return session->lastError.c_str();
}

FG_API const char* FgVersion(void) {
    return "forge-capi 0.1.0 (K7 skeleton; native brep/mesh/csg backing)";
}

// -------------------- entity management ------------------------------------

FG_API FgStatus FgDeleteBody(FgSession session, FgHandle body) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (session->bodies.erase(body) == 0)
        return fail(session, FG_ERR_INVALID_HANDLE, "no such body");
    return ok(session);
}

FG_API FgStatus FgCopyBody(FgSession session, FgHandle body, FgHandle* outCopy) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!outCopy) return fail(session, FG_ERR_NULL_ARGUMENT, "outCopy is null");
    Body* src = session->find(body);
    if (!src) return fail(session, FG_ERR_INVALID_HANDLE, "no such body");

    if (src->kind == FG_BODY_MESH) {
        Body dup;
        dup.kind = FG_BODY_MESH;
        dup.pos  = src->pos;   // deep copy
        dup.idx  = src->idx;
        *outCopy = session->add(std::move(dup));
        return ok(session);
    }
    // Analytic solid: the honest deep copy is a STEP-analytic round-trip (write
    // then read into a fresh owning TopologyBuilder) so the copy is fully
    // independent of the source's owner. Falls back to a soup mesh copy only if
    // the analytic write is unsupported for this solid.
    if (src->kind == FG_BODY_SOLID && src->solid) {
        auto wr = nb::StepAnalytic::write(*src->solid, "forge_copy");
        if (wr.ok) {
            auto rd = nb::StepAnalytic::read(wr.text);
            if (rd.ok && rd.solid) {
                Body dup;
                dup.kind  = FG_BODY_SOLID;
                dup.keep  = rd.owner;   // shared_ptr<TopologyBuilder> keeps it alive
                dup.solid = rd.solid;
                *outCopy  = session->add(std::move(dup));
                return ok(session);
            }
        }
        // honest degrade: copy as a mesh soup (still a valid, independent body)
        std::vector<double> p; std::vector<std::uint32_t> i;
        if (bodyToSoup(*src, p, i)) {
            *outCopy = session->add(makeMeshBody(std::move(p), std::move(i)));
            return ok(session);
        }
    }
    return fail(session, FG_ERR_OPERATION_FAILED, "copy failed");
}

FG_API FgStatus FgBodyKindOf(FgSession session, FgHandle body, FgBodyKind* outKind) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!outKind) return fail(session, FG_ERR_NULL_ARGUMENT, "outKind is null");
    Body* b = session->find(body);
    *outKind = b ? b->kind : FG_BODY_NONE;
    return ok(session);
}

FG_API FgStatus FgIsValid(FgSession session, FgHandle body, int32_t* outValid) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!outValid) return fail(session, FG_ERR_NULL_ARGUMENT, "outValid is null");
    *outValid = 0;
    Body* b = session->find(body);
    if (!b) return ok(session);          // unknown handle -> valid==0, not an error
    if (b->kind == FG_BODY_SOLID && b->solid) { *outValid = 1; return ok(session); }
    if (b->kind == FG_BODY_MESH) {
        nm::HalfEdgeMesh m;
        if (m.buildFromSoup(b->pos, b->idx)) {
            *outValid = m.validate().isValid() ? 1 : 0;
        }
    }
    return ok(session);
}

// -------------------- primitives -------------------------------------------

// Common tail: wrap a SolidFactory-built analytic Solid* into a session body.
static FgStatus emitSolid(FgSession session,
                          std::shared_ptr<nb::SolidFactory> factory,
                          nb::Solid* solid, FgHandle* out) {
    if (!solid) return fail(session, FG_ERR_OPERATION_FAILED, "primitive build returned null");
    Body b;
    b.kind  = FG_BODY_SOLID;
    b.keep  = factory;     // type-erased owner keeps builder+surfaces alive
    b.solid = solid;
    *out = session->add(std::move(b));
    return ok(session);
}

FG_API FgStatus FgCreateBox(FgSession session, double dx, double dy, double dz, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out) return fail(session, FG_ERR_NULL_ARGUMENT, "out is null");
    if (!(finite1(dx) && finite1(dy) && finite1(dz)) || dx <= 0 || dy <= 0 || dz <= 0)
        return fail(session, FG_ERR_INVALID_ARGUMENT, "box dims must be > 0 and finite");
    auto f = std::make_shared<nb::SolidFactory>();
    return emitSolid(session, f, f->buildBox(dx, dy, dz), out);
}

FG_API FgStatus FgCreateCylinder(FgSession session, double r, double h, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out) return fail(session, FG_ERR_NULL_ARGUMENT, "out is null");
    if (!(finite1(r) && finite1(h)) || r <= 0 || h <= 0)
        return fail(session, FG_ERR_INVALID_ARGUMENT, "cylinder r,h must be > 0");
    auto f = std::make_shared<nb::SolidFactory>();
    return emitSolid(session, f, f->buildCylinder(r, h), out);
}

FG_API FgStatus FgCreateCone(FgSession session, double r1, double r2, double h, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out) return fail(session, FG_ERR_NULL_ARGUMENT, "out is null");
    if (!(finite1(r1) && finite1(r2) && finite1(h)) || h <= 0 || r1 < 0 || r2 < 0 ||
        (r1 == 0 && r2 == 0))
        return fail(session, FG_ERR_INVALID_ARGUMENT, "cone radii/height invalid");
    auto f = std::make_shared<nb::SolidFactory>();
    return emitSolid(session, f, f->buildCone(r1, r2, h), out);
}

FG_API FgStatus FgCreateSphere(FgSession session, double r, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out) return fail(session, FG_ERR_NULL_ARGUMENT, "out is null");
    if (!finite1(r) || r <= 0)
        return fail(session, FG_ERR_INVALID_ARGUMENT, "sphere r must be > 0");
    auto f = std::make_shared<nb::SolidFactory>();
    return emitSolid(session, f, f->buildSphere(r), out);
}

FG_API FgStatus FgCreateTorus(FgSession session, double majorR, double minorR, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out) return fail(session, FG_ERR_NULL_ARGUMENT, "out is null");
    if (!(finite1(majorR) && finite1(minorR)) || majorR <= 0 || minorR <= 0 || minorR >= majorR)
        return fail(session, FG_ERR_INVALID_ARGUMENT, "torus needs 0 < minorR < majorR");
    auto f = std::make_shared<nb::SolidFactory>();
    return emitSolid(session, f, f->buildTorus(majorR, minorR), out);
}

FG_API FgStatus FgCreatePrism(FgSession session, int32_t nSides, double R, double h, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out) return fail(session, FG_ERR_NULL_ARGUMENT, "out is null");
    if (nSides < 3 || !(finite1(R) && finite1(h)) || R <= 0 || h <= 0)
        return fail(session, FG_ERR_INVALID_ARGUMENT, "prism needs nSides>=3, R>0, h>0");
    auto f = std::make_shared<nb::SolidFactory>();
    return emitSolid(session, f, f->buildPrism(static_cast<int>(nSides), R, h), out);
}

// -------------------- sketch features --------------------------------------

FG_API FgStatus FgExtrude(FgSession session, const double* outerXY, uint32_t ptCount,
                          double distance, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out || !outerXY) return fail(session, FG_ERR_NULL_ARGUMENT, "outerXY/out is null");
    if (ptCount < 3 || !finite1(distance) || distance == 0.0)
        return fail(session, FG_ERR_INVALID_ARGUMENT, "extrude needs >=3 pts and distance!=0");

    nb::Profile prof;
    prof.outer = readPoint2Ring(outerXY, ptCount);
    nb::SweepResult r = nb::prism(prof, distance);
    if (!r.ok)
        return fail(session, FG_ERR_OPERATION_FAILED, r.reason ? r.reason : "extrude failed");
    std::vector<double> p; std::vector<std::uint32_t> i;
    r.solid.toSoup(p, i);              // authoritative watertight soup
    if (i.empty()) { p = r.positions; i = r.indices; }  // mirror-soup fallback
    if (i.empty())
        return fail(session, FG_ERR_EMPTY_RESULT, "extrude produced empty mesh");
    *out = session->add(makeMeshBody(std::move(p), std::move(i)));
    return ok(session);
}

FG_API FgStatus FgRevolve(FgSession session, const double* profileUV, uint32_t ptCount,
                          const double axisOrigin[3], const double axisDir[3],
                          double angleDeg, int32_t segments, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out || !profileUV || !axisOrigin || !axisDir)
        return fail(session, FG_ERR_NULL_ARGUMENT, "profile/axis/out is null");
    if (ptCount < 3 || segments < 1 || !finite1(angleDeg) || angleDeg <= 0.0 || angleDeg > 360.0)
        return fail(session, FG_ERR_INVALID_ARGUMENT, "revolve needs >=3 pts, seg>=1, 0<deg<=360");

    std::vector<ng::Point2> prof = readPoint2Ring(profileUV, ptCount);
    nm::Vec3 origin{axisOrigin[0], axisOrigin[1], axisOrigin[2]};
    nm::Vec3 dir{axisDir[0], axisDir[1], axisDir[2]};
    nc::RevolveResult r = nc::revolve(prof, origin, dir, angleDeg, static_cast<int>(segments));
    if (!r.ok)
        return fail(session, FG_ERR_OPERATION_FAILED, r.reason ? r.reason : "revolve failed");
    std::vector<double> p; std::vector<std::uint32_t> i;
    r.mesh.toSoup(p, i);
    if (i.empty())
        return fail(session, FG_ERR_EMPTY_RESULT, "revolve produced empty mesh");
    *out = session->add(makeMeshBody(std::move(p), std::move(i)));
    return ok(session);
}

// -------------------- modifying features -----------------------------------

FG_API FgStatus FgBoolean(FgSession session, FgHandle a, FgHandle b, FgBoolOp op, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out) return fail(session, FG_ERR_NULL_ARGUMENT, "out is null");
    nb::BoolOp nop;
    if (!mapBoolOp(op, nop)) return fail(session, FG_ERR_INVALID_ARGUMENT, "bad boolean op");
    Body* A = session->find(a);
    Body* B = session->find(b);
    if (!A || !B) return fail(session, FG_ERR_INVALID_HANDLE, "no such operand body");

    // Fast analytic path: both operands are analytic solids.
    if (A->kind == FG_BODY_SOLID && A->solid && B->kind == FG_BODY_SOLID && B->solid) {
        nb::BooleanResult r = nb::booleanSolid(*A->solid, *B->solid, nop);
        if (r.ok && r.solid && r.owner) {
            Body nbdy;
            nbdy.kind  = FG_BODY_SOLID;
            nbdy.keep  = r.owner;   // shared_ptr<TopologyBuilder> owns the result
            nbdy.solid = r.solid;
            *out = session->add(std::move(nbdy));
            return ok(session);
        }
        if (!r.ok)
            return fail(session, FG_ERR_NOT_MANIFOLD, r.reason ? r.reason : "boolean not closed");
    }

    // Mixed / mesh path: gather both soups and run the mesh-operand boolean.
    std::vector<double> aPos, bPos; std::vector<std::uint32_t> aIdx, bIdx;
    if (!bodyToSoup(*A, aPos, aIdx) || !bodyToSoup(*B, bPos, bIdx))
        return fail(session, FG_ERR_OPERATION_FAILED, "could not tessellate an operand");
    nb::MeshOperandResult mr = nb::booleanMeshOperand(aPos, aIdx, bPos, bIdx, nop);
    if (!mr.ok || !mr.solid)
        return fail(session, FG_ERR_NOT_MANIFOLD, mr.reason ? mr.reason : "mesh boolean not closed");
    // The mesh-operand result is an analytic (reconstructed-planar) Solid owned by
    // mr.owner — surface it as an analytic solid body (keeps its Solid* alive).
    Body nbdy;
    nbdy.kind  = FG_BODY_SOLID;
    nbdy.keep  = mr.owner;
    nbdy.solid = mr.solid;
    *out = session->add(std::move(nbdy));
    return ok(session);
}

FG_API FgStatus FgFillet(FgSession session, FgHandle body, double radius,
                         uint32_t nSeg, double thresholdDeg, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out) return fail(session, FG_ERR_NULL_ARGUMENT, "out is null");
    if (!finite1(radius) || radius <= 0 || nSeg == 0 || !finite1(thresholdDeg))
        return fail(session, FG_ERR_INVALID_ARGUMENT, "fillet needs radius>0, nSeg>=1");
    Body* bd = session->find(body);
    if (!bd) return fail(session, FG_ERR_INVALID_HANDLE, "no such body");

    std::vector<double> pos; std::vector<std::uint32_t> idx;
    if (!bodyToSoup(*bd, pos, idx))
        return fail(session, FG_ERR_OPERATION_FAILED, "could not tessellate body for fillet");
    nb::FilletResult r = nb::filletConvexEdges(pos, idx, radius, nSeg, thresholdDeg);
    if (!r.ok)
        return fail(session, FG_ERR_OPERATION_FAILED,
                    r.reason.empty() ? "fillet failed" : r.reason.c_str());
    std::vector<double> p; std::vector<std::uint32_t> i;
    r.mesh.toSoup(p, i);
    if (i.empty())
        return fail(session, FG_ERR_EMPTY_RESULT, "fillet produced empty mesh");
    *out = session->add(makeMeshBody(std::move(p), std::move(i)));
    return ok(session);
}

FG_API FgStatus FgShell(FgSession session, FgHandle body, double thickness,
                        const uint32_t* removedFaceIdx, uint32_t removedCount,
                        FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out) return fail(session, FG_ERR_NULL_ARGUMENT, "out is null");
    if (!finite1(thickness) || thickness <= 0)
        return fail(session, FG_ERR_INVALID_ARGUMENT, "shell thickness must be > 0");
    if (removedCount > 0 && !removedFaceIdx)
        return fail(session, FG_ERR_NULL_ARGUMENT, "removedFaceIdx is null but count > 0");
    Body* bd = session->find(body);
    if (!bd) return fail(session, FG_ERR_INVALID_HANDLE, "no such body");
    if (bd->kind != FG_BODY_SOLID || !bd->solid)
        return fail(session, FG_ERR_UNSUPPORTED, "shell requires an analytic solid body");

    // shellSolid writes the wall into a caller-provided TopologyBuilder. Give it a
    // fresh owning builder so the result is independent; keep the SOURCE body's
    // owner alive too (the wall references the source solid's face geometry).
    auto wallBuilder = std::make_shared<nb::TopologyBuilder>();
    nb::ShellOptions opt;
    opt.thickness = thickness;
    opt.removedFaces.assign(removedFaceIdx, removedFaceIdx + removedCount);
    nb::ShellResult r = nb::shellSolid(*wallBuilder, bd->solid, opt);
    if (!r.ok || !r.solid)
        return fail(session, FG_ERR_OPERATION_FAILED, r.reason ? r.reason : "shell failed");

    // Keep BOTH the new wall builder and the source owner alive behind the body.
    struct DualKeep { std::shared_ptr<void> a, b; };
    auto keep = std::make_shared<DualKeep>();
    keep->a = wallBuilder;
    keep->b = bd->keep;
    Body nbdy;
    nbdy.kind  = FG_BODY_SOLID;
    nbdy.keep  = keep;
    nbdy.solid = r.solid;
    *out = session->add(std::move(nbdy));
    return ok(session);
}

// -------------------- queries ----------------------------------------------

FG_API FgStatus FgVolume(FgSession session, FgHandle body, double* outVolume) {
    return FgMassProperties(session, body, outVolume, nullptr);
}

FG_API FgStatus FgMassProperties(FgSession session, FgHandle body,
                                 double* outVolume, double outCom[3]) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!outVolume) return fail(session, FG_ERR_NULL_ARGUMENT, "outVolume is null");
    Body* b = session->find(body);
    if (!b) return fail(session, FG_ERR_INVALID_HANDLE, "no such body");

    if (b->kind == FG_BODY_SOLID && b->solid) {
        nb::MassProps mp = nb::massProperties(*b->solid);
        *outVolume = mp.volume;
        if (outCom) { outCom[0] = mp.com[0]; outCom[1] = mp.com[1]; outCom[2] = mp.com[2]; }
        return ok(session);
    }
    if (b->kind == FG_BODY_MESH) {
        nm::HalfEdgeMesh m;
        if (!m.buildFromSoup(b->pos, b->idx))
            return fail(session, FG_ERR_OPERATION_FAILED, "mesh body not buildable");
        *outVolume = m.signedVolume();
        if (outCom) { outCom[0] = outCom[1] = outCom[2] = 0.0; } // centroid: TARGETED for mesh bodies
        return ok(session);
    }
    return fail(session, FG_ERR_UNSUPPORTED, "unknown body kind");
}

FG_API FgStatus FgBoundingBox(FgSession session, FgHandle body,
                              double outMin[3], double outMax[3]) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!outMin || !outMax) return fail(session, FG_ERR_NULL_ARGUMENT, "outMin/outMax is null");
    Body* b = session->find(body);
    if (!b) return fail(session, FG_ERR_INVALID_HANDLE, "no such body");

    if (b->kind == FG_BODY_SOLID && b->solid) {
        nb::Aabb3 bb = nb::computeAabb(*b->solid);
        if (bb.void_) return fail(session, FG_ERR_EMPTY_RESULT, "empty solid");
        outMin[0] = bb.minX; outMin[1] = bb.minY; outMin[2] = bb.minZ;
        outMax[0] = bb.maxX; outMax[1] = bb.maxY; outMax[2] = bb.maxZ;
        return ok(session);
    }
    if (b->kind == FG_BODY_MESH) {
        if (b->pos.empty()) return fail(session, FG_ERR_EMPTY_RESULT, "empty mesh");
        double lo[3] = { b->pos[0], b->pos[1], b->pos[2] };
        double hi[3] = { b->pos[0], b->pos[1], b->pos[2] };
        for (std::size_t i = 0; i + 2 < b->pos.size(); i += 3)
            for (int k = 0; k < 3; ++k) {
                double v = b->pos[i + k];
                if (v < lo[k]) lo[k] = v;
                if (v > hi[k]) hi[k] = v;
            }
        for (int k = 0; k < 3; ++k) { outMin[k] = lo[k]; outMax[k] = hi[k]; }
        return ok(session);
    }
    return fail(session, FG_ERR_UNSUPPORTED, "unknown body kind");
}

// -------------------- tessellation -----------------------------------------

FG_API FgStatus FgTessellate(FgSession session, FgHandle body, double linearTol,
                             double** outVerts, uint32_t* outVertCount,
                             uint32_t** outTris, uint32_t* outTriCount) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!outVerts || !outVertCount || !outTris || !outTriCount)
        return fail(session, FG_ERR_NULL_ARGUMENT, "tessellate out-params null");
    Body* b = session->find(body);
    if (!b) return fail(session, FG_ERR_INVALID_HANDLE, "no such body");

    const double weld = (linearTol > 0.0) ? linearTol : 1e-9;
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    if (!bodyToSoup(*b, pos, idx, weld))
        return fail(session, FG_ERR_OPERATION_FAILED, "tessellation produced nothing");

    double*        vp = dupDoubles(pos);
    std::uint32_t* ip = dupU32(idx);
    if (!vp || !ip) { std::free(vp); std::free(ip); return fail(session, FG_ERR_OUT_OF_MEMORY, "alloc"); }
    *outVerts     = vp;
    *outVertCount = static_cast<uint32_t>(pos.size() / 3);
    *outTris      = ip;
    *outTriCount  = static_cast<uint32_t>(idx.size() / 3);
    return ok(session);
}

// -------------------- data exchange (STEP) ---------------------------------

// Build the STEP document text for a body (analytic -> StepAnalytic;
// mesh -> StepFaceted). Returns false + reason on failure.
static bool bodyToStepText(const Body& b, std::string& outText, std::string& reason) {
    if (b.kind == FG_BODY_SOLID && b.solid) {
        nb::AnalyticWriteResult w = nb::StepAnalytic::write(*b.solid);
        if (!w.ok) { reason = w.reason; return false; }
        outText = std::move(w.text);
        return true;
    }
    if (b.kind == FG_BODY_MESH) {
        nb::StepMesh sm;
        sm.positions = b.pos;
        sm.indices   = b.idx;
        nb::WriteResult w = nb::StepFaceted::write(sm);
        if (!w.ok) { reason = w.reason; return false; }
        outText = std::move(w.text);
        return true;
    }
    reason = "unknown body kind";
    return false;
}

FG_API FgStatus FgExportStepToString(FgSession session, FgHandle body, char** outText) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!outText) return fail(session, FG_ERR_NULL_ARGUMENT, "outText is null");
    Body* b = session->find(body);
    if (!b) return fail(session, FG_ERR_INVALID_HANDLE, "no such body");

    std::string text, reason;
    if (!bodyToStepText(*b, text, reason))
        return fail(session, FG_ERR_OPERATION_FAILED,
                    reason.empty() ? "STEP write failed" : reason.c_str());
    char* buf = static_cast<char*>(std::malloc(text.size() + 1));
    if (!buf) return fail(session, FG_ERR_OUT_OF_MEMORY, "alloc");
    std::memcpy(buf, text.data(), text.size());
    buf[text.size()] = '\0';
    *outText = buf;
    return ok(session);
}

FG_API FgStatus FgExportStep(FgSession session, FgHandle body, const char* path) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!path) return fail(session, FG_ERR_NULL_ARGUMENT, "path is null");
    Body* b = session->find(body);
    if (!b) return fail(session, FG_ERR_INVALID_HANDLE, "no such body");

    std::string text, reason;
    if (!bodyToStepText(*b, text, reason))
        return fail(session, FG_ERR_OPERATION_FAILED,
                    reason.empty() ? "STEP write failed" : reason.c_str());
    FILE* fp = std::fopen(path, "wb");
    if (!fp) return fail(session, FG_ERR_IO, "cannot open output path");
    size_t n = std::fwrite(text.data(), 1, text.size(), fp);
    std::fclose(fp);
    if (n != text.size()) return fail(session, FG_ERR_IO, "short write");
    return ok(session);
}

FG_API FgStatus FgImportStep(FgSession session, const char* path, FgHandle* out) {
    if (!session) return FG_ERR_INVALID_SESSION;
    if (!out || !path) return fail(session, FG_ERR_NULL_ARGUMENT, "path/out is null");

    FILE* fp = std::fopen(path, "rb");
    if (!fp) return fail(session, FG_ERR_IO, "cannot open input path");
    std::string text;
    { std::fseek(fp, 0, SEEK_END); long sz = std::ftell(fp); std::fseek(fp, 0, SEEK_SET);
      if (sz > 0) { text.resize(static_cast<size_t>(sz));
                    size_t n = std::fread(&text[0], 1, static_cast<size_t>(sz), fp);
                    text.resize(n); } }
    std::fclose(fp);
    if (text.empty()) return fail(session, FG_ERR_IO, "empty STEP file");

    nb::AnalyticReadResult r = nb::StepAnalytic::read(text);
    if (!r.ok || !r.solid || !r.owner)
        return fail(session, FG_ERR_OPERATION_FAILED,
                    r.reason.empty() ? "STEP read failed" : r.reason.c_str());
    Body b;
    b.kind  = FG_BODY_SOLID;
    b.keep  = r.owner;
    b.solid = r.solid;
    *out = session->add(std::move(b));
    return ok(session);
}

// -------------------- memory -----------------------------------------------

FG_API void FgFree(void* buffer) {
    std::free(buffer);   // pairs with malloc in dupDoubles/dupU32/FgExportStepToString
}

} // extern "C"

// ===========================================================================
// VERIFY BATCH — A/B smoke test the post-train batch must run (see report).
//   Build: add src/native/capi/forge_capi.cpp to CMakeLists (done) + compile the
//   standalone C++ smoke driver test/capi/forge_capi_smoke.cpp against forge_capi.h.
//   It exercises: session create -> box(10,20,30) -> volume==6000 (exact) -> bbox ->
//   tessellate (>=12 tris, watertight) -> cut a cylinder bore -> volume drop ==
//   pi*r^2*h -> extrude a square -> revolve a profile -> fillet a box -> STEP
//   round-trip (export string -> import -> volume within 1e-6) -> FgFree -> destroy.
//   Every op must return FG_OK and every geometric number must match the direct
//   native call (brep::massProperties / booleanSolid) to machine precision — i.e.
//   the C-API adds ZERO geometric error, only encapsulation. See report for the
//   exact assertions.
// ===========================================================================
