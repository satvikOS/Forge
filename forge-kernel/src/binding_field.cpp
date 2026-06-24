// forge-kernel/src/binding_field.cpp
//
// SELF-CONTAINED N-API binding translation unit that EXPOSES the already-built /
// newly-built in-house IMPLICIT / F-rep / VOXEL-LATTICE stack to JS, so Archie's
// CUA and the Forge frontend can reach it. It registers a single entry point
//
//     void forge::bind::InitField(Napi::Env env, Napi::Object exports)
//
// which the parent calls once from binding.cpp's Init() (see initHook in the
// task result). It does NOT touch binding.cpp, CMakeLists.txt or ForgeRunner.js.
//
// WHAT IT BINDS (every verb is a GENUINE native function — verified against the
// headers in include/forge/native/implicit and include/forge/native/voxel; any
// listed-but-absent function is SKIPPED and called out in the task notes):
//
//   forge.implicit.*   SDF/F-rep tree:
//     primitives  : sphere, box, plane, cylinder (FRep — analytic), torus, cone,
//                   capsule, roundedBox, hexPrism (SdfLibrary)
//     ops         : union, intersection, difference, smoothUnion (SdfTree),
//                   smoothSub (SdfOps)
//     field ops   : offset, round, shell, elongate, twist, bend (SdfOps)
//     evaluation  : eval, gradient (analytic where the body is an FRep, else
//                   central-difference), range, classify (FRep interval pruning)
//     meshing     : mesh(handle, bounds, res[, iso])         -> marching cubes
//                   meshDual(handle, bounds, res[, iso])      -> dual contouring
//     lifecycle   : retainField, releaseField, fieldCount
//   forge.tpms.*       gyroid, schwarzP, schwarzD, neovius (SdfLibrary TPMS)
//   forge.lattice.*    sdf, mesh, volume (voxel::Lattice strut graph)
//   forge.voxelBoolean union, intersection, difference (voxel::VoxelBoolean)
//   forge.morphology   offset, dilate, erode, open, close (voxel::Morphology)
//   forge.dualContour  contour (implicit::DualContour over an FieldBody)
//   forge.meshToSdf    field   (implicit::MeshToFRep — wrap a closed mesh as an
//                               evaluable signed field FieldBody)
//
// FIELDBODY HANDLE TYPE (honest design note, Bible §0):
//   The global forge::ShapeRegistry (include/forge/ShapeRegistry.hpp) stores only
//   OCCT / NativeSolid / NativeMesh entries and its native variants are gated
//   behind FORGE_NATIVE_BREP — it has NO slot for an implicit::Sdf / F-rep tree.
//   So a *new, self-contained* FieldBody registry lives in THIS TU: a uint32_t
//   handle table (same handle convention as ShapeRegistry) over an implicit::Sdf
//   (the universal composition currency that every primitive/op/lib node yields)
//   plus, when the body originated as an analytic FRep, the FRep itself so the
//   analytic gradient / interval / classify verbs are real (not finite-diff). A
//   body's mesh flows out as positions+indices typed arrays exactly like the
//   existing forge.native.meshBoolean / nativeTessellate verbs.
//
// Pure C++20 + N-API. No new external deps. Mirrors the N-API patterns in
// src/binding.cpp (Napi::Function::New + a safe() try/catch wrapper).

#include <napi.h>

#include <cmath>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "forge/native/implicit/SdfTree.hpp"      // implicit::Sdf, Vec3, sphere/box/plane, CSG
#include "forge/native/implicit/SdfLibrary.hpp"   // implicit::SdfLibrary, SdfResult (torus/cone/.../TPMS)
#include "forge/native/implicit/SdfOps.hpp"       // implicit::SdfOps, OpResult (offset/round/shell/...)
#include "forge/native/implicit/FRepTree.hpp"     // implicit::FRep (analytic grad/interval) + Mesh/GridSpec
#include "forge/native/implicit/IsoMesher.hpp"    // implicit::IsoMesher, Mesh, GridSpec
#include "forge/native/implicit/DualContour.hpp"  // implicit::DualContour
#include "forge/native/implicit/MeshToFRep.hpp"   // implicit::MeshToFRep (mesh -> field)
#include "forge/native/mesh/HalfEdgeMesh.hpp"     // mesh::HalfEdgeMesh (mesh-to-field input)
#include "forge/native/voxel/VoxelGrid.hpp"       // native::VoxelGrid<float>
#include "forge/native/voxel/VoxelMesh.hpp"       // voxel::VoxelMesh::contour, ContourResult
#include "forge/native/voxel/VoxelBoolean.hpp"    // voxel::VoxelBoolean
#include "forge/native/voxel/Lattice.hpp"         // voxel::Lattice (LatticeSpec/voxelize/buildLatticeMesh)
#include "forge/native/voxel/Morphology.hpp"      // voxel::Morphology

namespace forge {
namespace bind {

namespace {

namespace impl = forge::native::implicit;

// ---------------------------------------------------------------------------
// FieldBody — a uint32_t handle over an implicit::Sdf (+ optional originating
// FRep for analytic gradient/interval). Same handle convention as ShapeRegistry.
// ---------------------------------------------------------------------------
struct FieldEntry {
    impl::Sdf      sdf;            // the universal evaluable (always valid for a live handle)
    impl::FRep     frep;          // valid() only when the body originated as an analytic FRep
    std::uint32_t  refcount = 1;
};

class FieldRegistry {
public:
    static FieldRegistry& instance() {
        static FieldRegistry r;
        return r;
    }

    std::uint32_t add(impl::Sdf sdf, impl::FRep frep = impl::FRep{}) {
        std::lock_guard<std::mutex> lk(mtx_);
        std::uint32_t h = next_++;
        entries_.emplace(h, FieldEntry{std::move(sdf), std::move(frep), 1});
        return h;
    }
    const FieldEntry& get(std::uint32_t h) const {
        std::lock_guard<std::mutex> lk(mtx_);
        auto it = entries_.find(h);
        if (it == entries_.end())
            throw std::invalid_argument("forge.implicit: invalid / released field handle");
        return it->second;
    }
    void retain(std::uint32_t h) {
        std::lock_guard<std::mutex> lk(mtx_);
        auto it = entries_.find(h);
        if (it == entries_.end())
            throw std::invalid_argument("forge.implicit: retain on invalid field handle");
        ++it->second.refcount;
    }
    void release(std::uint32_t h) {
        std::lock_guard<std::mutex> lk(mtx_);
        auto it = entries_.find(h);
        if (it == entries_.end()) return;          // idempotent
        if (--it->second.refcount == 0) entries_.erase(it);
    }
    std::size_t liveCount() const {
        std::lock_guard<std::mutex> lk(mtx_);
        return entries_.size();
    }

private:
    FieldRegistry() = default;
    mutable std::mutex mtx_;
    std::unordered_map<std::uint32_t, FieldEntry> entries_;
    std::uint32_t next_ = 1;
};

// ---------------------------------------------------------------------------
// N-API helpers (mirrors binding.cpp's safe()/requireNumber()).
// ---------------------------------------------------------------------------
template <typename Fn>
Napi::Value safe(const Napi::CallbackInfo& info, Fn&& fn) {
    try {
        return fn();
    } catch (const Napi::Error&) {
        throw;
    } catch (const std::exception& e) {
        throw Napi::Error::New(info.Env(), e.what());
    } catch (...) {
        throw Napi::Error::New(info.Env(), "forge.implicit: unknown native exception");
    }
}

double num(const Napi::CallbackInfo& info, std::size_t i, const char* what, double dflt, bool* present = nullptr) {
    bool have = info.Length() > i && info[i].IsNumber();
    if (present) *present = have;
    if (!have) return dflt;
    return info[i].As<Napi::Number>().DoubleValue();
}

double reqNum(const Napi::CallbackInfo& info, std::size_t i, const char* what) {
    if (info.Length() <= i || !info[i].IsNumber())
        throw Napi::TypeError::New(info.Env(), std::string("forge.implicit: expected number for ") + what);
    return info[i].As<Napi::Number>().DoubleValue();
}

std::uint32_t reqHandle(const Napi::CallbackInfo& info, std::size_t i) {
    if (info.Length() <= i || !info[i].IsNumber())
        throw Napi::TypeError::New(info.Env(),
            "forge.implicit: expected field handle (uint32) at arg " + std::to_string(i));
    return info[i].As<Napi::Number>().Uint32Value();
}

std::vector<double> readVec(Napi::Env env, const Napi::Value& v, const char* what) {
    std::vector<double> out;
    if (v.IsTypedArray()) {
        auto a = v.As<Napi::Float64Array>();
        // Accept any numeric typed array via the generic path below if not f64.
        if (v.As<Napi::TypedArray>().TypedArrayType() == napi_float64_array) {
            out.assign(a.Data(), a.Data() + a.ElementLength());
            return out;
        }
    }
    if (v.IsArray()) {
        auto a = v.As<Napi::Array>();
        out.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i) out.push_back(a.Get(i).As<Napi::Number>().DoubleValue());
        return out;
    }
    if (v.IsTypedArray()) {
        auto a = v.As<Napi::Float32Array>();
        out.assign(a.Data(), a.Data() + a.ElementLength());
        return out;
    }
    throw Napi::TypeError::New(env, std::string("forge.implicit: ") + what + " must be a number[] or Float64Array");
}

std::vector<std::uint32_t> readU32(Napi::Env env, const Napi::Value& v, const char* what) {
    std::vector<std::uint32_t> out;
    if (v.IsTypedArray() && v.As<Napi::TypedArray>().TypedArrayType() == napi_uint32_array) {
        auto a = v.As<Napi::Uint32Array>();
        out.assign(a.Data(), a.Data() + a.ElementLength());
        return out;
    }
    if (v.IsArray()) {
        auto a = v.As<Napi::Array>();
        out.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i) out.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
        return out;
    }
    throw Napi::TypeError::New(env, std::string("forge.implicit: ") + what + " must be a number[] or Uint32Array");
}

// Read a 3-component center / vector from (info[i], info[i+1], info[i+2]) with a
// default of origin when absent. Returns a Vec3.
impl::Vec3 readVec3(const Napi::CallbackInfo& info, std::size_t i) {
    return impl::Vec3{ num(info, i, "x", 0.0), num(info, i + 1, "y", 0.0), num(info, i + 2, "z", 0.0) };
}

// Register a successful SdfResult/OpResult as a FieldBody, or throw its reason.
Napi::Value emitSdf(Napi::Env env, bool ok, const impl::Sdf& s, const std::string& reason,
                    const impl::FRep& frep = impl::FRep{}) {
    if (!ok || !s.valid())
        throw Napi::Error::New(env, std::string("forge.implicit: ") + (reason.empty() ? "degenerate input" : reason));
    std::uint32_t h = FieldRegistry::instance().add(s, frep);
    return Napi::Number::New(env, static_cast<double>(h));
}

// Pack a meshed Sdf (IsoMesher::Mesh) into the canonical { ok, reason, positions,
// indices, volume, area, triangleCount, vertexCount } object.
Napi::Value emitMesh(Napi::Env env, const impl::Mesh& m) {
    auto o = Napi::Object::New(env);
    if (m.empty()) {
        o.Set("ok", Napi::Boolean::New(env, false));
        o.Set("reason", Napi::String::New(env, "empty mesh (field did not cross the sampling box)"));
        o.Set("triangleCount", Napi::Number::New(env, 0.0));
        o.Set("vertexCount", Napi::Number::New(env, 0.0));
        return o;
    }
    auto pos = Napi::Float32Array::New(env, m.positions.size() * 3);
    for (std::size_t i = 0; i < m.positions.size(); ++i) {
        pos[3 * i + 0] = static_cast<float>(m.positions[i].x);
        pos[3 * i + 1] = static_cast<float>(m.positions[i].y);
        pos[3 * i + 2] = static_cast<float>(m.positions[i].z);
    }
    auto idx = Napi::Uint32Array::New(env, m.triangles.size() * 3);
    for (std::size_t i = 0; i < m.triangles.size(); ++i) {
        idx[3 * i + 0] = static_cast<std::uint32_t>(m.triangles[i][0]);
        idx[3 * i + 1] = static_cast<std::uint32_t>(m.triangles[i][1]);
        idx[3 * i + 2] = static_cast<std::uint32_t>(m.triangles[i][2]);
    }
    o.Set("ok", Napi::Boolean::New(env, true));
    o.Set("reason", Napi::String::New(env, ""));
    o.Set("positions", pos);
    o.Set("indices", idx);
    o.Set("volume", Napi::Number::New(env, m.volume()));
    o.Set("area", Napi::Number::New(env, m.area()));
    o.Set("triangleCount", Napi::Number::New(env, static_cast<double>(m.triangles.size())));
    o.Set("vertexCount", Napi::Number::New(env, static_cast<double>(m.positions.size())));
    return o;
}

// Pack a voxel HalfEdgeMesh (ContourResult) into the same canonical object.
Napi::Value emitContour(Napi::Env env, const forge::native::voxel::ContourResult& cr,
                        const char* failReason) {
    auto o = Napi::Object::New(env);
    if (!cr.ok) {
        o.Set("ok", Napi::Boolean::New(env, false));
        o.Set("reason", Napi::String::New(env, failReason ? failReason : "contour failed"));
        o.Set("triangleCount", Napi::Number::New(env, 0.0));
        o.Set("vertexCount", Napi::Number::New(env, 0.0));
        return o;
    }
    std::vector<double> p; std::vector<std::uint32_t> idx;
    cr.mesh.toSoup(p, idx);
    auto pos = Napi::Float32Array::New(env, p.size());
    for (std::size_t i = 0; i < p.size(); ++i) pos[i] = static_cast<float>(p[i]);
    auto ji = Napi::Uint32Array::New(env, idx.size());
    for (std::size_t i = 0; i < idx.size(); ++i) ji[i] = idx[i];
    o.Set("ok", Napi::Boolean::New(env, true));
    o.Set("reason", Napi::String::New(env, ""));
    o.Set("positions", pos);
    o.Set("indices", ji);
    o.Set("volume", Napi::Number::New(env, cr.mesh.signedVolume()));
    o.Set("area", Napi::Number::New(env, cr.mesh.surfaceArea()));
    o.Set("triangleCount", Napi::Number::New(env, static_cast<double>(idx.size() / 3)));
    o.Set("vertexCount", Napi::Number::New(env, static_cast<double>(cr.mesh.vertexCount())));
    o.Set("watertight", Napi::Boolean::New(env, cr.report.isValid()));
    return o;
}

std::string opStr(const Napi::CallbackInfo& info, std::size_t i, const char* dflt) {
    if (info.Length() > i && info[i].IsString()) return info[i].As<Napi::String>().Utf8Value();
    return dflt;
}

// Build a GridSpec/cubic-bounds from (loX,loY,loZ, hiX,hiY,hiZ, n) call args.
void readBounds(const Napi::CallbackInfo& info, std::size_t i,
                impl::Vec3& lo, impl::Vec3& hi, int& n) {
    lo = impl::Vec3{ reqNum(info, i + 0, "loX"), reqNum(info, i + 1, "loY"), reqNum(info, i + 2, "loZ") };
    hi = impl::Vec3{ reqNum(info, i + 3, "hiX"), reqNum(info, i + 4, "hiY"), reqNum(info, i + 5, "hiZ") };
    n  = static_cast<int>(reqNum(info, i + 6, "res"));
    if (n < 2) n = 2;
}

} // anonymous namespace

// ===========================================================================
// InitField — the single registration entry point.
// ===========================================================================
void InitField(Napi::Env env, Napi::Object exports) {
    using forge::native::voxel::VoxelBoolean;
    using forge::native::voxel::VoxelMesh;
    using forge::native::voxel::Morphology;
    namespace vox = forge::native::voxel;

    auto implicitNs = Napi::Object::New(env);
    auto tpmsNs     = Napi::Object::New(env);
    auto latticeNs  = Napi::Object::New(env);
    auto morphNs    = Napi::Object::New(env);
    auto dcNs       = Napi::Object::New(env);
    auto meshToSdfNs= Napi::Object::New(env);
    auto vboolNs    = Napi::Object::New(env);

    // ---- forge.implicit primitives (analytic FRep — gradient/interval real) ----
    implicitNs.Set("sphere", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            impl::Vec3 c = readVec3(info, 0);
            double r = reqNum(info, 3, "radius");
            impl::FRep f = impl::FRep::sphere(c, r);
            return emitSdf(info.Env(), f.ok(), f.toSdf(), "invalid sphere (radius<=0?)", f);
        });
    }));
    implicitNs.Set("box", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            impl::Vec3 c = readVec3(info, 0);
            impl::Vec3 s{ reqNum(info,3,"sizeX"), reqNum(info,4,"sizeY"), reqNum(info,5,"sizeZ") };
            impl::FRep f = impl::FRep::box(c, s);
            return emitSdf(info.Env(), f.ok(), f.toSdf(), "invalid box (size<=0?)", f);
        });
    }));
    implicitNs.Set("plane", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            impl::Vec3 nrm{ reqNum(info,0,"nx"), reqNum(info,1,"ny"), reqNum(info,2,"nz") };
            double off = reqNum(info, 3, "offset");
            impl::FRep f = impl::FRep::plane(nrm, off);
            return emitSdf(info.Env(), f.ok(), f.toSdf(), "invalid plane (zero normal?)", f);
        });
    }));
    implicitNs.Set("cylinder", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            impl::Vec3 c = readVec3(info, 0);
            double r = reqNum(info, 3, "radius"), h = reqNum(info, 4, "height");
            impl::FRep f = impl::FRep::cylinder(c, r, h);
            return emitSdf(info.Env(), f.ok(), f.toSdf(), "invalid cylinder (radius/height<=0?)", f);
        });
    }));

    // ---- forge.implicit library primitives (SdfLibrary — eval-only Sdf) ----
    implicitNs.Set("torus", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            impl::Vec3 c = readVec3(info, 0);
            auto r = impl::SdfLibrary::torus(c, reqNum(info,3,"R"), reqNum(info,4,"r"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));
    implicitNs.Set("cone", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            impl::Vec3 apex = readVec3(info, 0);
            auto r = impl::SdfLibrary::cone(apex, reqNum(info,3,"angle"), reqNum(info,4,"height"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));
    implicitNs.Set("capsule", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            impl::Vec3 a{ reqNum(info,0,"ax"), reqNum(info,1,"ay"), reqNum(info,2,"az") };
            impl::Vec3 b{ reqNum(info,3,"bx"), reqNum(info,4,"by"), reqNum(info,5,"bz") };
            auto r = impl::SdfLibrary::capsule(a, b, reqNum(info,6,"radius"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));
    implicitNs.Set("roundedBox", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            impl::Vec3 c = readVec3(info, 0);
            impl::Vec3 half{ reqNum(info,3,"halfX"), reqNum(info,4,"halfY"), reqNum(info,5,"halfZ") };
            auto r = impl::SdfLibrary::roundedBox(c, half, reqNum(info,6,"radius"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));
    implicitNs.Set("hexPrism", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            impl::Vec3 c = readVec3(info, 0);
            auto r = impl::SdfLibrary::hexPrism(c, reqNum(info,3,"halfHeight"), reqNum(info,4,"apothem"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));

    // ---- forge.implicit CSG ops (SdfTree + SdfOps::smoothSub) ----
    auto binaryOp = [](const Napi::CallbackInfo& info,
                       impl::Sdf (*op)(const impl::Sdf&, const impl::Sdf&)) -> Napi::Value {
        auto& reg = FieldRegistry::instance();
        const impl::Sdf& a = reg.get(reqHandle(info, 0)).sdf;
        const impl::Sdf& b = reg.get(reqHandle(info, 1)).sdf;
        impl::Sdf r = op(a, b);
        return emitSdf(info.Env(), r.valid(), r, "boolean produced an invalid field");
    };
    implicitNs.Set("union", Napi::Function::New(env, [binaryOp](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]{ return binaryOp(info, &impl::unionOp); });
    }));
    implicitNs.Set("intersection", Napi::Function::New(env, [binaryOp](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]{ return binaryOp(info, &impl::intersectionOp); });
    }));
    implicitNs.Set("difference", Napi::Function::New(env, [binaryOp](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]{ return binaryOp(info, &impl::differenceOp); });
    }));
    implicitNs.Set("smoothUnion", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            auto& reg = FieldRegistry::instance();
            const impl::Sdf& a = reg.get(reqHandle(info, 0)).sdf;
            const impl::Sdf& b = reg.get(reqHandle(info, 1)).sdf;
            double k = reqNum(info, 2, "k");
            impl::Sdf r = impl::smoothUnionOp(a, b, k);
            return emitSdf(info.Env(), r.valid(), r, "smoothUnion produced an invalid field");
        });
    }));
    implicitNs.Set("smoothSub", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            auto& reg = FieldRegistry::instance();
            const impl::Sdf& a = reg.get(reqHandle(info, 0)).sdf;
            const impl::Sdf& b = reg.get(reqHandle(info, 1)).sdf;
            auto r = impl::SdfOps::smoothSub(a, b, reqNum(info, 2, "k"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));

    // ---- forge.implicit field ops (SdfOps — unary remaps) ----
    implicitNs.Set("offset", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            auto r = impl::SdfOps::offset(f, reqNum(info, 1, "d"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));
    implicitNs.Set("round", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            auto r = impl::SdfOps::round(f, reqNum(info, 1, "r"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));
    implicitNs.Set("shell", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            auto r = impl::SdfOps::shell(f, reqNum(info, 1, "thickness"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));
    implicitNs.Set("elongate", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            impl::Vec3 h{ reqNum(info,1,"hx"), reqNum(info,2,"hy"), reqNum(info,3,"hz") };
            auto r = impl::SdfOps::elongate(f, h);
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));
    implicitNs.Set("twist", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            auto r = impl::SdfOps::twist(f, reqNum(info, 1, "k"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));
    implicitNs.Set("bend", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            auto r = impl::SdfOps::bend(f, reqNum(info, 1, "k"));
            return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
        });
    }));

    // ---- forge.implicit evaluation: eval / gradient / range / classify ----
    implicitNs.Set("eval", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            return Napi::Number::New(info.Env(), f.eval(readVec3(info, 1)));
        });
    }));
    implicitNs.Set("gradient", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const FieldEntry& e = FieldRegistry::instance().get(reqHandle(info, 0));
            impl::Vec3 p = readVec3(info, 1);
            impl::Vec3 g = e.frep.ok() ? e.frep.gradient(p)      // ANALYTIC chain-rule
                                       : e.sdf.gradient(p);      // central-difference fallback
            auto o = Napi::Object::New(info.Env());
            o.Set("x", Napi::Number::New(info.Env(), g.x));
            o.Set("y", Napi::Number::New(info.Env(), g.y));
            o.Set("z", Napi::Number::New(info.Env(), g.z));
            o.Set("analytic", Napi::Boolean::New(info.Env(), e.frep.ok()));
            return o;
        });
    }));
    implicitNs.Set("range", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const FieldEntry& e = FieldRegistry::instance().get(reqHandle(info, 0));
            if (!e.frep.ok())
                throw Napi::Error::New(info.Env(),
                    "forge.implicit.range: interval evaluation needs an analytic F-rep body "
                    "(sphere/box/plane/cylinder); this handle is eval-only");
            impl::Vec3 lo{ reqNum(info,1,"loX"), reqNum(info,2,"loY"), reqNum(info,3,"loZ") };
            impl::Vec3 hi{ reqNum(info,4,"hiX"), reqNum(info,5,"hiY"), reqNum(info,6,"hiZ") };
            impl::Interval iv = e.frep.range(lo, hi);
            auto o = Napi::Object::New(info.Env());
            o.Set("lo", Napi::Number::New(info.Env(), iv.lo));
            o.Set("hi", Napi::Number::New(info.Env(), iv.hi));
            return o;
        });
    }));
    implicitNs.Set("classify", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const FieldEntry& e = FieldRegistry::instance().get(reqHandle(info, 0));
            if (!e.frep.ok())
                throw Napi::Error::New(info.Env(),
                    "forge.implicit.classify: needs an analytic F-rep body");
            impl::Vec3 lo{ reqNum(info,1,"loX"), reqNum(info,2,"loY"), reqNum(info,3,"loZ") };
            impl::Vec3 hi{ reqNum(info,4,"hiX"), reqNum(info,5,"hiY"), reqNum(info,6,"hiZ") };
            auto c = e.frep.classify(lo, hi);
            const char* s = (c == impl::FRep::CellClass::Inside)  ? "inside"
                          : (c == impl::FRep::CellClass::Outside) ? "outside" : "crossing";
            return Napi::String::New(info.Env(), s);
        });
    }));

    // ---- forge.implicit meshing: marching cubes + dual contouring ----
    implicitNs.Set("mesh", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            impl::Vec3 lo, hi; int n; readBounds(info, 1, lo, hi, n);
            double iso = num(info, 8, "iso", 0.0);
            impl::Mesh m = impl::IsoMesher::marchCubic(f, lo, hi, n, iso);
            return emitMesh(info.Env(), m);
        });
    }));
    implicitNs.Set("meshDual", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            impl::Vec3 lo, hi; int n; readBounds(info, 1, lo, hi, n);
            double iso = num(info, 8, "iso", 0.0);
            impl::Mesh m = impl::DualContour::contourCubic(f, lo, hi, n, iso);
            return emitMesh(info.Env(), m);
        });
    }));

    // ---- forge.implicit handle lifecycle ----
    implicitNs.Set("retainField", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            FieldRegistry::instance().retain(reqHandle(info, 0));
            return info.Env().Undefined();
        });
    }));
    implicitNs.Set("releaseField", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            FieldRegistry::instance().release(reqHandle(info, 0));
            return info.Env().Undefined();
        });
    }));
    implicitNs.Set("fieldCount", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            return Napi::Number::New(info.Env(),
                static_cast<double>(FieldRegistry::instance().liveCount()));
        });
    }));

    // ---- forge.tpms (SdfLibrary TPMS fields) ----
    auto tpmsVerb = [](const Napi::CallbackInfo& info,
                       impl::SdfResult (*fn)(const impl::Vec3&, double, double)) -> Napi::Value {
        impl::Vec3 c = readVec3(info, 0);
        auto r = fn(c, reqNum(info, 3, "period"), reqNum(info, 4, "thickness"));
        return emitSdf(info.Env(), r.ok, r.sdf, r.reason);
    };
    tpmsNs.Set("gyroid", Napi::Function::New(env, [tpmsVerb](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]{ return tpmsVerb(info, &impl::SdfLibrary::gyroid); });
    }));
    tpmsNs.Set("schwarzP", Napi::Function::New(env, [tpmsVerb](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]{ return tpmsVerb(info, &impl::SdfLibrary::schwarzP); });
    }));
    tpmsNs.Set("schwarzD", Napi::Function::New(env, [tpmsVerb](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]{ return tpmsVerb(info, &impl::SdfLibrary::schwarzD); });
    }));
    tpmsNs.Set("neovius", Napi::Function::New(env, [tpmsVerb](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]{ return tpmsVerb(info, &impl::SdfLibrary::neovius); });
    }));

    // ---- forge.lattice (voxel strut lattice) ----
    // latticeSpec(info,i): type, cellSize, radius, nx, ny, nz, originX,Y,Z
    auto readLattice = [](const Napi::CallbackInfo& info) -> vox::LatticeSpec {
        vox::LatticeSpec s;
        std::string t = info.Length() > 0 && info[0].IsString()
            ? info[0].As<Napi::String>().Utf8Value() : "cubic";
        if      (t == "cubic" || t == "Cubic") s.type = vox::LatticeType::Cubic;
        else if (t == "bcc"   || t == "BCC")   s.type = vox::LatticeType::BCC;
        else if (t == "fcc"   || t == "FCC")   s.type = vox::LatticeType::FCC;
        else throw std::invalid_argument("forge.lattice: type must be 'cubic'|'bcc'|'fcc'");
        s.cellSize = reqNum(info, 1, "cellSize");
        s.radius   = reqNum(info, 2, "radius");
        s.nx = static_cast<std::size_t>(num(info, 3, "nx", 1.0));
        s.ny = static_cast<std::size_t>(num(info, 4, "ny", 1.0));
        s.nz = static_cast<std::size_t>(num(info, 5, "nz", 1.0));
        s.origin = forge::native::Vec3{ num(info,6,"ox",0.0), num(info,7,"oy",0.0), num(info,8,"oz",0.0) };
        return s;
    };
    latticeNs.Set("sdf", Napi::Function::New(env, [readLattice](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            vox::LatticeSpec s = readLattice(info);
            forge::native::Vec3 p{ reqNum(info,9,"px"), reqNum(info,10,"py"), reqNum(info,11,"pz") };
            return Napi::Number::New(info.Env(), vox::latticeSdf(s, p));
        });
    }));
    latticeNs.Set("mesh", Napi::Function::New(env, [readLattice](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            vox::LatticeSpec s = readLattice(info);
            std::size_t spc = static_cast<std::size_t>(num(info, 9, "samplesPerCell", 12.0));
            if (spc < 2) spc = 2;
            vox::LatticeMesh lm = vox::buildLatticeMesh(s, spc);
            return emitContour(info.Env(), lm.contour, lm.ok ? "" : lm.reason);
        });
    }));
    latticeNs.Set("volume", Napi::Function::New(env, [readLattice](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            vox::LatticeSpec s = readLattice(info);
            std::size_t spc = static_cast<std::size_t>(num(info, 9, "samplesPerCell", 12.0));
            if (spc < 2) spc = 2;
            vox::VoxelizeResult vr = vox::voxelize(s, spc);
            auto o = Napi::Object::New(info.Env());
            o.Set("ok", Napi::Boolean::New(info.Env(), vr.ok));
            o.Set("reason", Napi::String::New(info.Env(), vr.ok ? "" : (vr.reason ? vr.reason : "")));
            o.Set("measuredVolume", Napi::Number::New(info.Env(),
                vr.ok ? vox::measuredOccupiedVolume(vr) : 0.0));
            o.Set("analyticVolume", Napi::Number::New(info.Env(), vox::analyticStrutVolume(s)));
            o.Set("totalStrutLength", Napi::Number::New(info.Env(), vox::totalStrutLength(s)));
            return o;
        });
    }));

    // ---- forge.voxelBoolean (CSG on two aligned voxelized field bodies) ----
    // Inputs are FieldBody handles; each is voxelized over its own padded bounds.
    // To stay aligned we voxelize BOTH onto the SAME grid passed by the caller.
    // Signature: (handleA, handleB, op, loX,loY,loZ, hiX,hiY,hiZ, res)
    auto voxelizeField = [](const impl::Sdf& f, const impl::Vec3& lo, const impl::Vec3& hi, int n)
        -> forge::native::VoxelGrid<float> {
        // Isotropic spacing on the longest axis so cells stay ~cubic and the two
        // operand grids share an identical lattice (VoxelBoolean alignment req).
        double span = std::max(hi.x - lo.x, std::max(hi.y - lo.y, hi.z - lo.z));
        double spacing = span / double(n);
        if (!(spacing > 0.0)) spacing = 1.0;
        std::size_t nx = static_cast<std::size_t>(std::ceil((hi.x - lo.x) / spacing)) + 1;
        std::size_t ny = static_cast<std::size_t>(std::ceil((hi.y - lo.y) / spacing)) + 1;
        std::size_t nz = static_cast<std::size_t>(std::ceil((hi.z - lo.z) / spacing)) + 1;
        if (nx < 2) nx = 2; if (ny < 2) ny = 2; if (nz < 2) nz = 2;
        forge::native::VoxelGrid<float> g(nx, ny, nz,
            forge::native::Vec3{lo.x, lo.y, lo.z}, spacing);
        g.fillFromField([&](double x, double y, double z) {
            return f.eval(impl::Vec3{x, y, z});
        });
        return g;
    };
    vboolNs.Set("op", Napi::Function::New(env, [voxelizeField](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            auto& reg = FieldRegistry::instance();
            const impl::Sdf& a = reg.get(reqHandle(info, 0)).sdf;
            const impl::Sdf& b = reg.get(reqHandle(info, 1)).sdf;
            std::string op = opStr(info, 2, "union");
            impl::Vec3 lo, hi; int n; readBounds(info, 3, lo, hi, n);
            auto ga = voxelizeField(a, lo, hi, n);
            auto gb = voxelizeField(b, lo, hi, n);
            forge::native::voxel::BooleanResult r;
            if      (op == "union")        r = VoxelBoolean::unite(ga, gb);
            else if (op == "intersection") r = VoxelBoolean::intersect(ga, gb);
            else if (op == "difference")   r = VoxelBoolean::subtract(ga, gb);
            else throw Napi::TypeError::New(info.Env(),
                "forge.voxelBoolean: op must be 'union'|'intersection'|'difference'");
            if (!r.ok)
                throw Napi::Error::New(info.Env(),
                    "forge.voxelBoolean: input grids not aligned (internal voxelization mismatch)");
            auto cr = VoxelBoolean::contour(r.grid, 0.0);
            auto o = emitContour(info.Env(), cr, "non-manifold marching-cubes soup (rejected)").As<Napi::Object>();
            o.Set("enclosedVolume", Napi::Number::New(info.Env(),
                VoxelBoolean::enclosedVolume(r.grid, 0.0)));
            return o;
        });
    }));

    // ---- forge.morphology (level-set morphology on a voxelized field body) ----
    // Signature: (handle, op, radius, loX,loY,loZ, hiX,hiY,hiZ, res)
    auto morphVerb = [voxelizeField](const Napi::CallbackInfo& info) -> Napi::Value {
        const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
        std::string op = opStr(info, 1, "dilate");
        double r = reqNum(info, 2, "radius");
        impl::Vec3 lo, hi; int n; readBounds(info, 3, lo, hi, n);
        auto g = voxelizeField(f, lo, hi, n);
        vox::MorphResult mr;
        if      (op == "offset") mr = Morphology::offset(g, r);
        else if (op == "dilate") mr = Morphology::dilate(g, r);
        else if (op == "erode")  mr = Morphology::erode(g, r);
        else if (op == "open")   mr = Morphology::open(g, r);
        else if (op == "close")  mr = Morphology::close(g, r);
        else throw Napi::TypeError::New(info.Env(),
            "forge.morphology: op must be 'offset'|'dilate'|'erode'|'open'|'close'");
        if (!mr.ok)
            throw Napi::Error::New(info.Env(),
                "forge.morphology: degenerate input (negative/non-finite radius)");
        auto cr = VoxelMesh::contour(mr.grid, 0.0);
        auto o = emitContour(info.Env(), cr,
            mr.empty ? "morphology emptied the solid (honest empty result)"
                     : "non-manifold marching-cubes soup (rejected)").As<Napi::Object>();
        o.Set("empty", Napi::Boolean::New(info.Env(), mr.empty));
        o.Set("fieldVolume", Napi::Number::New(info.Env(), Morphology::fieldVolume(mr.grid, 0.0)));
        return o;
    };
    morphNs.Set("op", Napi::Function::New(env, [morphVerb](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]{ return morphVerb(info); });
    }));

    // ---- forge.dualContour (DualContour over a FieldBody) — sharp features ----
    dcNs.Set("contour", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            const impl::Sdf& f = FieldRegistry::instance().get(reqHandle(info, 0)).sdf;
            impl::Vec3 lo, hi; int n; readBounds(info, 1, lo, hi, n);
            double iso = num(info, 8, "iso", 0.0);
            double gradH = num(info, 9, "gradH", 0.0);
            impl::Mesh m = impl::DualContour::contourCubic(f, lo, hi, n, iso, gradH);
            return emitMesh(info.Env(), m);
        });
    }));

    // ---- forge.meshToSdf (wrap a closed mesh as an evaluable FieldBody) ----
    // Signature: field(positions: number[]|Float64Array, indices: number[]|Uint32Array)
    meshToSdfNs.Set("field", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
            auto env2 = info.Env();
            if (info.Length() < 2)
                throw Napi::TypeError::New(env2, "forge.meshToSdf.field(positions, indices)");
            auto pos = readVec(env2, info[0], "positions");
            auto idx = readU32(env2, info[1], "indices");
            forge::native::mesh::HalfEdgeMesh hem;
            if (!hem.buildFromSoup(pos, idx))
                throw Napi::Error::New(env2,
                    "forge.meshToSdf: input is not a manifold/consistently-wound triangle soup");
            auto r = impl::MeshToFRep::build(hem);
            if (!r.ok)
                throw Napi::Error::New(env2,
                    std::string("forge.meshToSdf: ") + (r.reason ? r.reason : "mesh is not a closed solid"));
            std::uint32_t h = FieldRegistry::instance().add(r.field(), impl::FRep{});
            auto o = Napi::Object::New(env2);
            o.Set("handle", Napi::Number::New(env2, static_cast<double>(h)));
            o.Set("closed", Napi::Boolean::New(env2, r.closed));
            o.Set("manifold", Napi::Boolean::New(env2, r.manifold));
            o.Set("triangleCount", Napi::Number::New(env2, static_cast<double>(r.numTriangles)));
            return o;
        });
    }));

    // ---- attach namespaces to exports ----
    exports.Set("implicit", implicitNs);
    exports.Set("tpms", tpmsNs);
    exports.Set("lattice", latticeNs);
    exports.Set("morphology", morphNs);
    exports.Set("dualContour", dcNs);
    exports.Set("meshToSdf", meshToSdfNs);
    exports.Set("voxelBoolean", vboolNs);
}

} // namespace bind
} // namespace forge
