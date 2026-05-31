// forge-kernel binding.cpp — N-API entry point.
//
// Exposes the Forge native C++ kernel to V8. Handles are uint32_t so they
// fit losslessly in a JS number; the actual TopoDS_Shape stays in C++.
// All functions check their argument types; type errors throw JS
// TypeError so the frontend can catch them in a uniform way.

#include <napi.h>

#include "forge/ShapeRegistry.hpp"
#include "forge/Primitives.hpp"
#include "forge/Booleans.hpp"
#include "forge/Tessellate.hpp"
#include "forge/MassProps.hpp"
#include "forge/Transform.hpp"
#include "forge/ComponentRegistry.hpp"
#include "forge/BVH.hpp"
#include "forge/LOD.hpp"
#include "forge/AssemblySolver.hpp"
#include "forge/AssemblyHierarchy.hpp"
#include "forge/InterferenceDetection.hpp"
#include "forge/MotionStudy.hpp"
#include "forge/Drawings.hpp"
#include "forge/Sketcher.hpp"
#include "forge/Fea.hpp"
#include "forge/Cam.hpp"
#include "forge/CamAdvanced.hpp"
#include "forge/GcodePost.hpp"
#include "forge/Cfd.hpp"
#include "forge/IoExchange.hpp"
#include "forge/DirectModeling.hpp"
#include "forge/Healing.hpp"
#include "forge/Features.hpp"
#include "forge/SheetMetal.hpp"
#include "forge/Weldments.hpp"
#include "forge/Nurbs.hpp"

#include <array>

#include <Standard_Version.hxx>
#include <Standard_Failure.hxx>
#include <cstring>

using namespace forge;

namespace {

// safe() wraps a binding body so that std::exceptions from the C++
// kernel surface as JS Errors instead of crashing the V8 isolate.
// NAPI_CPP_EXCEPTIONS only converts Napi::Error; anything else (e.g.
// std::invalid_argument from ShapeRegistry::get on a stale handle)
// would otherwise abort the process.
template <typename Fn>
Napi::Value safe(const Napi::CallbackInfo& info, Fn&& fn) {
    try {
        return fn();
    } catch (const Napi::Error&) {
        throw;
    } catch (const Standard_Failure& f) {
        // OCCT exceptions don't always derive from std::exception in
        // OCCT 7.9 (they do on most builds but not all); catch them
        // explicitly so we surface the real OCCT message to JS.
        const char* msg = f.GetMessageString();
        throw Napi::Error::New(info.Env(),
            std::string("forge (OCCT): ") + (msg ? msg : f.DynamicType()->Name()));
    } catch (const std::exception& e) {
        throw Napi::Error::New(info.Env(), e.what());
    } catch (...) {
        throw Napi::Error::New(info.Env(), "forge: unknown native exception");
    }
}

uint32_t requireHandle(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsNumber()) {
        throw Napi::TypeError::New(info.Env(),
            "forge: expected handle (uint32) at arg " + std::to_string(idx));
    }
    return info[idx].As<Napi::Number>().Uint32Value();
}

double requireNumber(const Napi::CallbackInfo& info, std::size_t idx, const char* what) {
    if (info.Length() <= idx || !info[idx].IsNumber()) {
        throw Napi::TypeError::New(info.Env(),
            std::string("forge: expected number for ") + what);
    }
    return info[idx].As<Napi::Number>().DoubleValue();
}

Transform4x4 readTransform(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsTypedArray()) {
        throw Napi::TypeError::New(info.Env(),
            "forge: transform must be a Float64Array of 16 row-major doubles");
    }
    auto arr = info[idx].As<Napi::Float64Array>();
    if (arr.ElementLength() != 16) {
        throw Napi::TypeError::New(info.Env(), "forge: transform must have 16 elements");
    }
    Transform4x4 t;
    std::copy(arr.Data(), arr.Data() + 16, t.m.begin());
    return t;
}

AABB readAABB(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsTypedArray()) {
        throw Napi::TypeError::New(info.Env(),
            "forge: AABB must be a Float64Array [minX,minY,minZ,maxX,maxY,maxZ]");
    }
    auto arr = info[idx].As<Napi::Float64Array>();
    if (arr.ElementLength() != 6) {
        throw Napi::TypeError::New(info.Env(), "forge: AABB must have 6 elements");
    }
    return AABB{
        arr.Data()[0], arr.Data()[1], arr.Data()[2],
        arr.Data()[3], arr.Data()[4], arr.Data()[5],
    };
}

// ----------------------------------------------------------- primitives
Napi::Value MakeBox(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeBox(requireNumber(info,0,"dx"), requireNumber(info,1,"dy"), requireNumber(info,2,"dz")));
    });
}
Napi::Value MakeCylinder(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeCylinder(requireNumber(info,0,"radius"), requireNumber(info,1,"height")));
    });
}
Napi::Value MakeSphere(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(), makeSphere(requireNumber(info,0,"radius")));
    });
}
Napi::Value MakeCone(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeCone(requireNumber(info,0,"r1"), requireNumber(info,1,"r2"), requireNumber(info,2,"h")));
    });
}
Napi::Value MakeTorus(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeTorus(requireNumber(info,0,"majorR"), requireNumber(info,1,"minorR")));
    });
}

// ----------------------------------------------------------- booleans
Napi::Value Fuse(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(), fuse(requireHandle(info,0), requireHandle(info,1)));
    });
}
Napi::Value Cut(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(), cut(requireHandle(info,0), requireHandle(info,1)));
    });
}
Napi::Value Common(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(), common(requireHandle(info,0), requireHandle(info,1)));
    });
}

// ----------------------------------------------------------- transform
Napi::Value Translate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            translate(requireHandle(info,0),
                      requireNumber(info,1,"dx"),
                      requireNumber(info,2,"dy"),
                      requireNumber(info,3,"dz")));
    });
}
Napi::Value Rotate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            rotate(requireHandle(info,0),
                   requireNumber(info,1,"ax"),
                   requireNumber(info,2,"ay"),
                   requireNumber(info,3,"az"),
                   requireNumber(info,4,"angleRad")));
    });
}

// ----------------------------------------------------------- tessellate
Napi::Value Tessellate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        double linTol = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : 0.1;
        double angTol = info.Length() > 2 && info[2].IsNumber() ? info[2].As<Napi::Number>().DoubleValue() : 0.5;

        Mesh m = tessellate(h, linTol, angTol);
        auto env = info.Env();
        auto out = Napi::Object::New(env);

        auto positions = Napi::Float32Array::New(env, m.positions.size());
        std::copy(m.positions.begin(), m.positions.end(), positions.Data());
        out.Set("positions", positions);

        auto normals = Napi::Float32Array::New(env, m.normals.size());
        std::copy(m.normals.begin(), m.normals.end(), normals.Data());
        out.Set("normals", normals);

        auto indices = Napi::Uint32Array::New(env, m.indices.size());
        std::copy(m.indices.begin(), m.indices.end(), indices.Data());
        out.Set("indices", indices);

        out.Set("triangleCount", Napi::Number::New(env, static_cast<double>(m.indices.size() / 3)));
        return out;
    });
}

// ----------------------------------------------------------- mass props
Napi::Value MassProps(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto p = massProperties(requireHandle(info, 0));
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("volume", p.volume);
        out.Set("area", p.area);
        auto com = Napi::Array::New(env, 3);
        com.Set(uint32_t{0}, p.cx);
        com.Set(uint32_t{1}, p.cy);
        com.Set(uint32_t{2}, p.cz);
        out.Set("centerOfMass", com);
        return out;
    });
}

// ----------------------------------------------------------- shape lifecycle
Napi::Value Retain(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        ShapeRegistry::instance().retain(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}
Napi::Value Release(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        ShapeRegistry::instance().release(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}
Napi::Value LiveCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(ShapeRegistry::instance().liveCount()));
    });
}

// ----------------------------------------------------------- components
Napi::Value AddInstance(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto comp = requireHandle(info, 0);
        auto xform = readTransform(info, 1);
        return Napi::Number::New(info.Env(),
            ComponentRegistry::instance().addInstance(comp, xform));
    });
}
Napi::Value RemoveInstance(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        ComponentRegistry::instance().removeInstance(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}
Napi::Value UpdateTransform(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto id = requireHandle(info, 0);
        auto xform = readTransform(info, 1);
        ComponentRegistry::instance().updateTransform(id, xform);
        return info.Env().Undefined();
    });
}
Napi::Value InstanceCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(ComponentRegistry::instance().count()));
    });
}
Napi::Value QueryAABB(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        AABB box = readAABB(info, 0);
        auto hits = ComponentRegistry::instance().queryAABB(box);
        auto arr = Napi::Uint32Array::New(info.Env(), hits.size());
        std::copy(hits.begin(), hits.end(), arr.Data());
        return arr;
    });
}
Napi::Value GetInstanceAABB(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto id = requireHandle(info, 0);
        auto a = ComponentRegistry::instance().getAABB(id);
        auto arr = Napi::Float64Array::New(info.Env(), 6);
        arr.Data()[0] = a.minX; arr.Data()[1] = a.minY; arr.Data()[2] = a.minZ;
        arr.Data()[3] = a.maxX; arr.Data()[4] = a.maxY; arr.Data()[5] = a.maxZ;
        return arr;
    });
}
Napi::Value InstanceExists(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            ComponentRegistry::instance().exists(requireHandle(info, 0)));
    });
}
Napi::Value ReserveInstances(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 1 || !info[0].IsNumber()) {
            throw Napi::TypeError::New(info.Env(), "forge: reserveInstances expects a number");
        }
        ComponentRegistry::instance().reserve(info[0].As<Napi::Number>().Uint32Value());
        return info.Env().Undefined();
    });
}
Napi::Value InstanceBytesUsed(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(ComponentRegistry::instance().bytesUsed()));
    });
}

// ----------------------------------------------------------- BVH (Forge-25)
//
// Spatial index over instance AABBs. Build is O(N log N) SAH-binned;
// queries are O(log N + k). Build is lazy — queryAABB falls back to the
// linear scan when the BVH is dirty so callers that never call buildBvh()
// keep the historical semantics.
Napi::Value BuildBvh(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(ComponentRegistry::instance().buildBvh()));
    });
}
Napi::Value IsBvhFresh(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            ComponentRegistry::instance().isBvhFresh());
    });
}
Napi::Value QueryRay(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.queryRay(origin: Float64Array[3], dir: Float64Array[3])");
        }
        auto o = info[0].As<Napi::Float64Array>();
        auto d = info[1].As<Napi::Float64Array>();
        if (o.ElementLength() != 3 || d.ElementLength() != 3) {
            throw Napi::TypeError::New(info.Env(),
                "forge.queryRay: origin and dir must each be Float64Array[3]");
        }
        auto hits = ComponentRegistry::instance().queryRay(
            o.Data()[0], o.Data()[1], o.Data()[2],
            d.Data()[0], d.Data()[1], d.Data()[2]);
        auto arr = Napi::Uint32Array::New(info.Env(), hits.size());
        std::copy(hits.begin(), hits.end(), arr.Data());
        return arr;
    });
}
Napi::Value QueryFrustum(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 1 || !info[0].IsTypedArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.queryFrustum(planes: Float64Array[24])");
        }
        auto p = info[0].As<Napi::Float64Array>();
        if (p.ElementLength() != 24) {
            throw Napi::TypeError::New(info.Env(),
                "forge.queryFrustum: planes must have 24 elements (6 × (a,b,c,d))");
        }
        std::array<double,24> arrIn{};
        std::copy(p.Data(), p.Data() + 24, arrIn.begin());
        auto hits = ComponentRegistry::instance().queryFrustum(arrIn);
        auto arr = Napi::Uint32Array::New(info.Env(), hits.size());
        std::copy(hits.begin(), hits.end(), arr.Data());
        return arr;
    });
}

// ----------------------------------------------------------- LOD (Forge-25)
Napi::Value TessellateLOD(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        const auto lvlInt = requireHandle(info, 1);
        if (lvlInt > 2) {
            throw Napi::TypeError::New(info.Env(),
                "forge.tessellateLOD: level must be 0|1|2 (Low|Med|High)");
        }
        const auto& m = tessellateLOD(h, static_cast<LODLevel>(lvlInt));
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        auto positions = Napi::Float32Array::New(env, m.positions.size());
        std::copy(m.positions.begin(), m.positions.end(), positions.Data());
        out.Set("positions", positions);
        auto normals = Napi::Float32Array::New(env, m.normals.size());
        std::copy(m.normals.begin(), m.normals.end(), normals.Data());
        out.Set("normals", normals);
        auto indices = Napi::Uint32Array::New(env, m.indices.size());
        std::copy(m.indices.begin(), m.indices.end(), indices.Data());
        out.Set("indices", indices);
        out.Set("triangleCount", Napi::Number::New(env, static_cast<double>(m.indices.size() / 3)));
        out.Set("level", Napi::Number::New(env, lvlInt));
        return out;
    });
}
Napi::Value SelectLOD(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto id = requireHandle(info, 0);
        const double ex = requireNumber(info, 1, "eyeX");
        const double ey = requireNumber(info, 2, "eyeY");
        const double ez = requireNumber(info, 3, "eyeZ");
        const double fov = requireNumber(info, 4, "fovRad");
        const double sh  = requireNumber(info, 5, "screenHeightPx");
        return Napi::Number::New(info.Env(),
            static_cast<double>(selectLOD(id, ex, ey, ez, fov, sh)));
    });
}
Napi::Value ClearLODCache(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        clearLODCache();
        return info.Env().Undefined();
    });
}
Napi::Value LODCacheEntries(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(), static_cast<double>(lodCacheEntries()));
    });
}

// ----------------------------------------------------------- async tessellate
//
// Returns a JS Promise that resolves to { positions, normals, indices,
// triangleCount } once a worker thread finishes the OCCT mesh. We use a
// Napi::ThreadSafeFunction so the worker thread can hand the result back
// to V8 from the main JS thread.
Napi::Value TessellateAsync(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto h = requireHandle(info, 0);
    double linTol = info.Length() > 1 && info[1].IsNumber()
        ? info[1].As<Napi::Number>().DoubleValue() : 0.1;
    double angTol = info.Length() > 2 && info[2].IsNumber()
        ? info[2].As<Napi::Number>().DoubleValue() : 0.5;

    auto deferred = Napi::Promise::Deferred::New(env);

    struct Box { Mesh mesh; bool ok; std::string err; };
    auto* slot = new Box{};

    auto tsfn = Napi::ThreadSafeFunction::New(
        env, Napi::Function(), "forge.tessellateAsync", 0, 1);

    tessellateAsync(h, linTol, angTol, [slot, tsfn, deferred](Mesh m) mutable {
        slot->mesh = std::move(m);
        slot->ok = true;
        tsfn.BlockingCall([slot, deferred](Napi::Env env, Napi::Function) {
            auto out = Napi::Object::New(env);
            auto positions = Napi::Float32Array::New(env, slot->mesh.positions.size());
            std::copy(slot->mesh.positions.begin(), slot->mesh.positions.end(), positions.Data());
            out.Set("positions", positions);
            auto normals = Napi::Float32Array::New(env, slot->mesh.normals.size());
            std::copy(slot->mesh.normals.begin(), slot->mesh.normals.end(), normals.Data());
            out.Set("normals", normals);
            auto indices = Napi::Uint32Array::New(env, slot->mesh.indices.size());
            std::copy(slot->mesh.indices.begin(), slot->mesh.indices.end(), indices.Data());
            out.Set("indices", indices);
            out.Set("triangleCount", Napi::Number::New(env,
                static_cast<double>(slot->mesh.indices.size() / 3)));
            deferred.Resolve(out);
            delete slot;
        });
        tsfn.Release();
    });

    return deferred.Promise();
}

Napi::Value TessellationPoolSize(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(tessellationPoolSize()));
    });
}
Napi::Value TessellationWaitIdle(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        waitForTessellationIdle();
        return info.Env().Undefined();
    });
}

// ----------------------------------------------------------- assembly solver
//
// Wraps AssemblySolver under the `forge.assembly` namespace. The kind code
// is the integer value of MateKind; topo ids are the schematic 0..3
// described in AssemblySolver.hpp. `value` is optional for kinds that
// don't use it (defaults to 0).
Napi::Value AddMate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto kind = static_cast<MateKind>(requireHandle(info, 0));
        MateRef a{static_cast<InstanceId>(requireHandle(info, 1)),
                  static_cast<std::uint32_t>(requireHandle(info, 2))};
        MateRef b{static_cast<InstanceId>(requireHandle(info, 3)),
                  static_cast<std::uint32_t>(requireHandle(info, 4))};
        const double value = info.Length() > 5 && info[5].IsNumber()
            ? info[5].As<Napi::Number>().DoubleValue() : 0.0;
        const auto id = AssemblySolver::instance().addMate(kind, a, b, value);
        return Napi::Number::New(info.Env(), id);
    });
}

Napi::Value RemoveMate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        AssemblySolver::instance().removeMate(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}

Napi::Value SetMateActive(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto id = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsBoolean()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.assembly.setMateActive: expected (id, bool)");
        }
        AssemblySolver::instance().setActive(id, info[1].As<Napi::Boolean>().Value());
        return info.Env().Undefined();
    });
}

Napi::Value SetFixed(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto id = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsBoolean()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.assembly.setFixed: expected (instanceId, bool)");
        }
        AssemblySolver::instance().setFixed(id, info[1].As<Napi::Boolean>().Value());
        return info.Env().Undefined();
    });
}

Napi::Value SolveAssembly(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto rep = AssemblySolver::instance().solve();
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("converged",  Napi::Boolean::New(env, rep.converged));
        out.Set("iterations", Napi::Number::New(env, rep.iterations));
        out.Set("residual",   Napi::Number::New(env, rep.residual));
        return out;
    });
}

Napi::Value MateCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(AssemblySolver::instance().mateCount()));
    });
}

Napi::Value ClearMates(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        AssemblySolver::instance().clearAll();
        return info.Env().Undefined();
    });
}

// ----------------------------------------------------------- hierarchy (Forge-35)
namespace {
Napi::Float64Array transformToTypedArray(Napi::Env env, const Transform4x4& x) {
    auto arr = Napi::Float64Array::New(env, 16);
    std::copy(x.m.begin(), x.m.end(), arr.Data());
    return arr;
}
} // namespace

Napi::Value ClearHierarchy(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        AssemblyHierarchy::instance().clearAll();
        return info.Env().Undefined();
    });
}

Napi::Value SetParent(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto child = static_cast<InstanceId>(requireHandle(info, 0));
        // parent may be 0 (root) — accept directly.
        if (info.Length() < 2 || !info[1].IsNumber()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.assembly.setParent: expected (childId, parentId)");
        }
        const auto parent = static_cast<InstanceId>(
            info[1].As<Napi::Number>().Uint32Value());
        AssemblyHierarchy::instance().setParent(child, parent);
        return info.Env().Undefined();
    });
}

Napi::Value GetChildren(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 1 || !info[0].IsNumber()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.assembly.getChildren: expected (parentId)");
        }
        const auto parent = static_cast<InstanceId>(
            info[0].As<Napi::Number>().Uint32Value());
        auto kids = AssemblyHierarchy::instance().getChildren(parent);
        auto arr = Napi::Uint32Array::New(info.Env(), kids.size());
        std::copy(kids.begin(), kids.end(), arr.Data());
        return arr;
    });
}

Napi::Value WorldTransform(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto id = static_cast<InstanceId>(requireHandle(info, 0));
        auto x = AssemblyHierarchy::instance().worldTransform(id);
        return transformToTypedArray(info.Env(), x);
    });
}

Napi::Value DetectInterference(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsArray()) {
            throw Napi::TypeError::New(env,
                "forge.assembly.detectInterference: arg 0 must be an InstanceId array");
        }
        auto idArr = info[0].As<Napi::Array>();
        std::vector<InstanceId> ids;
        ids.reserve(idArr.Length());
        for (std::uint32_t i = 0; i < idArr.Length(); ++i) {
            auto v = idArr.Get(i);
            if (!v.IsNumber()) {
                throw Napi::TypeError::New(env,
                    "forge.assembly.detectInterference: instance ids must be numbers");
            }
            ids.push_back(static_cast<InstanceId>(v.As<Napi::Number>().Uint32Value()));
        }
        const double tol = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().DoubleValue() : 0.0;

        auto pairs = detectInterference(ids, tol);
        auto out = Napi::Array::New(env, pairs.size());
        for (std::size_t i = 0; i < pairs.size(); ++i) {
            auto o = Napi::Object::New(env);
            o.Set("instA",  Napi::Number::New(env, pairs[i].instA));
            o.Set("instB",  Napi::Number::New(env, pairs[i].instB));
            o.Set("volume", Napi::Number::New(env, pairs[i].volume));
            out.Set(static_cast<std::uint32_t>(i), o);
        }
        return out;
    });
}

Napi::Value RunMotionStudy(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        const auto motor = static_cast<InstanceId>(requireHandle(info, 0));
        const auto axis  = static_cast<std::uint32_t>(requireHandle(info, 1));
        const double totalAngle = requireNumber(info, 2, "totalAngleRad");
        const auto steps = static_cast<std::uint32_t>(requireHandle(info, 3));

        auto run = runMotionStudy(motor, axis, totalAngle, steps);

        auto out = Napi::Object::New(env);
        auto framesArr = Napi::Array::New(env, run.frames.size());
        for (std::size_t i = 0; i < run.frames.size(); ++i) {
            const auto& f = run.frames[i];
            auto fo = Napi::Object::New(env);
            fo.Set("t", Napi::Number::New(env, f.t));
            fo.Set("value", Napi::Number::New(env, f.value));
            fo.Set("converged", Napi::Boolean::New(env, f.converged));
            auto transforms = Napi::Object::New(env);
            for (const auto& [id, xform] : f.transforms) {
                transforms.Set(std::to_string(id),
                    transformToTypedArray(env, xform));
            }
            fo.Set("transforms", transforms);
            framesArr.Set(static_cast<std::uint32_t>(i), fo);
        }
        out.Set("frames", framesArr);
        out.Set("allConverged", Napi::Boolean::New(env, run.allConverged));
        out.Set("maxResidual",  Napi::Number::New(env, run.maxResidual));
        out.Set("stepCount",
            Napi::Number::New(env, static_cast<double>(run.frames.size())));
        return out;
    });
}

// ----------------------------------------------------------- drawings
//
// projectShape(handle, presetName?: string)
//   → { visible:Float32Array, visibleStarts:Uint32Array,
//        hidden:Float32Array,  hiddenStarts:Uint32Array,
//        outline:Float32Array, outlineStarts:Uint32Array,
//        direction:[dx,dy,dz] }
//
// The Float32Array packs every polyline's vertices as x0,y0,x1,y1,...
// `*Starts[i]` is the *vertex index* (i.e. byte offset / 8) of polyline i's
// first vertex. `*Starts[polylineCount]` is the total vertex count, so
// polyline i runs from starts[i] to starts[i+1].
//
// View direction comes from either:
//   * arg[1] string preset: "front" | "top" | "right" | "iso"
//   * else arg[1] Float64Array [dx, dy, dz]
//   * else default to "front".
Napi::Value ProjectShape(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);

        ProjectionDirection dir = frontView();
        if (info.Length() > 1 && info[1].IsString()) {
            std::string name = info[1].As<Napi::String>();
            if      (name == "front")     dir = frontView();
            else if (name == "top")       dir = topView();
            else if (name == "right")     dir = rightView();
            else if (name == "iso"
                  || name == "isometric") dir = isometricView();
            else {
                throw Napi::TypeError::New(env,
                    "forge.drawings.projectShape: unknown preset '" + name + "'");
            }
        } else if (info.Length() > 1 && info[1].IsTypedArray()) {
            auto arr = info[1].As<Napi::Float64Array>();
            if (arr.ElementLength() != 3) {
                throw Napi::TypeError::New(env,
                    "forge.drawings.projectShape: direction must be Float64Array[3]");
            }
            dir = { arr.Data()[0], arr.Data()[1], arr.Data()[2] };
        }

        ProjectedView pv = projectShape(h, dir);

        // ---- packer ----
        auto pack = [&](const std::vector<Polyline2D>& polys) -> Napi::Object {
            std::size_t totalVerts = 0;
            for (const auto& p : polys) totalVerts += p.size();

            auto verts  = Napi::Float32Array::New(env, totalVerts * 2);
            auto starts = Napi::Uint32Array::New(env, polys.size() + 1);

            std::size_t vIdx = 0;
            for (std::size_t i = 0; i < polys.size(); ++i) {
                starts.Data()[i] = static_cast<std::uint32_t>(vIdx);
                for (const auto& xy : polys[i]) {
                    verts.Data()[2 * vIdx + 0] = static_cast<float>(xy.first);
                    verts.Data()[2 * vIdx + 1] = static_cast<float>(xy.second);
                    ++vIdx;
                }
            }
            starts.Data()[polys.size()] = static_cast<std::uint32_t>(vIdx);

            auto out = Napi::Object::New(env);
            out.Set("verts",  verts);
            out.Set("starts", starts);
            out.Set("count",  Napi::Number::New(env, static_cast<double>(polys.size())));
            return out;
        };

        auto vis = pack(pv.visible);
        auto hid = pack(pv.hidden);
        auto out_ = pack(pv.outline);

        auto out = Napi::Object::New(env);
        out.Set("visible",       vis.Get("verts"));
        out.Set("visibleStarts", vis.Get("starts"));
        out.Set("visibleCount",  vis.Get("count"));
        out.Set("hidden",        hid.Get("verts"));
        out.Set("hiddenStarts",  hid.Get("starts"));
        out.Set("hiddenCount",   hid.Get("count"));
        out.Set("outline",       out_.Get("verts"));
        out.Set("outlineStarts", out_.Get("starts"));
        out.Set("outlineCount",  out_.Get("count"));

        auto d = Napi::Array::New(env, 3);
        d.Set(uint32_t{0}, dir.dx);
        d.Set(uint32_t{1}, dir.dy);
        d.Set(uint32_t{2}, dir.dz);
        out.Set("direction", d);
        return out;
    });
}

// ----------------------------------------------------------- drawings (Forge-32)
//
// Helpers shared by projectSection / projectDetail / projectBroken — they
// each return a richer ProjectedView (Section adds `cut` + `hatch`).

namespace drawings_bind {

Napi::Object packBucket(const Napi::Env& env, const std::vector<Polyline2D>& polys) {
    std::size_t totalVerts = 0;
    for (const auto& p : polys) totalVerts += p.size();
    auto verts  = Napi::Float32Array::New(env, totalVerts * 2);
    auto starts = Napi::Uint32Array::New(env, polys.size() + 1);
    std::size_t vIdx = 0;
    for (std::size_t i = 0; i < polys.size(); ++i) {
        starts.Data()[i] = static_cast<std::uint32_t>(vIdx);
        for (const auto& xy : polys[i]) {
            verts.Data()[2 * vIdx + 0] = static_cast<float>(xy.first);
            verts.Data()[2 * vIdx + 1] = static_cast<float>(xy.second);
            ++vIdx;
        }
    }
    starts.Data()[polys.size()] = static_cast<std::uint32_t>(vIdx);
    auto out = Napi::Object::New(env);
    out.Set("verts",  verts);
    out.Set("starts", starts);
    out.Set("count",  Napi::Number::New(env, static_cast<double>(polys.size())));
    return out;
}

Napi::Object viewToObj(const Napi::Env& env, const ProjectedView& pv) {
    auto vis = packBucket(env, pv.visible);
    auto hid = packBucket(env, pv.hidden);
    auto ol  = packBucket(env, pv.outline);
    auto cut = packBucket(env, pv.cut);
    auto htc = packBucket(env, pv.hatch);
    auto out = Napi::Object::New(env);
    out.Set("visible",       vis.Get("verts"));
    out.Set("visibleStarts", vis.Get("starts"));
    out.Set("visibleCount",  vis.Get("count"));
    out.Set("hidden",        hid.Get("verts"));
    out.Set("hiddenStarts",  hid.Get("starts"));
    out.Set("hiddenCount",   hid.Get("count"));
    out.Set("outline",       ol.Get("verts"));
    out.Set("outlineStarts", ol.Get("starts"));
    out.Set("outlineCount",  ol.Get("count"));
    out.Set("cut",           cut.Get("verts"));
    out.Set("cutStarts",     cut.Get("starts"));
    out.Set("cutCount",      cut.Get("count"));
    out.Set("hatch",         htc.Get("verts"));
    out.Set("hatchStarts",   htc.Get("starts"));
    out.Set("hatchCount",    htc.Get("count"));
    return out;
}

ProjectionDirection parseDirection(const Napi::Env& env, const Napi::Value& v) {
    if (v.IsString()) {
        std::string name = v.As<Napi::String>();
        if      (name == "front")     return frontView();
        else if (name == "top")       return topView();
        else if (name == "right")     return rightView();
        else if (name == "iso"
              || name == "isometric") return isometricView();
        throw Napi::TypeError::New(env,
            "forge.drawings: unknown view preset '" + name + "'");
    }
    if (v.IsTypedArray()) {
        auto arr = v.As<Napi::Float64Array>();
        if (arr.ElementLength() != 3) {
            throw Napi::TypeError::New(env,
                "forge.drawings: direction must be Float64Array[3]");
        }
        return { arr.Data()[0], arr.Data()[1], arr.Data()[2] };
    }
    return frontView();
}

double objNum(const Napi::Object& o, const char* k, double fallback) {
    if (!o.Has(k)) return fallback;
    auto v = o.Get(k);
    if (!v.IsNumber()) return fallback;
    return v.As<Napi::Number>().DoubleValue();
}

} // namespace drawings_bind

Napi::Value ProjectShapeSection(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        ProjectionDirection dir = drawings_bind::parseDirection(env,
            info.Length() > 1 ? info[1] : env.Undefined());

        if (info.Length() < 3 || !info[2].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.drawings.projectSection: expected sectionPlane object {origin:[x,y,z], normal:[x,y,z]}");
        }
        auto planeObj = info[2].As<Napi::Object>();
        SectionPlane plane{};
        auto readVec3 = [&](const char* k, double& a, double& b, double& c) {
            auto v = planeObj.Get(k);
            if (v.IsArray()) {
                auto arr = v.As<Napi::Array>();
                if (arr.Length() >= 3) {
                    a = arr.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
                    b = arr.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
                    c = arr.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
                    return;
                }
            }
            if (v.IsTypedArray()) {
                auto arr = v.As<Napi::Float64Array>();
                if (arr.ElementLength() >= 3) {
                    a = arr.Data()[0]; b = arr.Data()[1]; c = arr.Data()[2];
                    return;
                }
            }
            throw Napi::TypeError::New(env,
                std::string("forge.drawings.projectSection: plane.") + k + " must be a 3-element array");
        };
        readVec3("origin", plane.ox, plane.oy, plane.oz);
        readVec3("normal", plane.nx, plane.ny, plane.nz);

        HatchSpec hatch{ 2.5, 45.0 };
        if (info.Length() > 3 && info[3].IsObject()) {
            auto h2 = info[3].As<Napi::Object>();
            hatch.spacing  = drawings_bind::objNum(h2, "spacing",  hatch.spacing);
            hatch.angleDeg = drawings_bind::objNum(h2, "angleDeg", hatch.angleDeg);
        }

        ProjectedView pv = projectShapeSection(h, dir, plane, hatch);
        auto out = drawings_bind::viewToObj(env, pv);
        auto d = Napi::Array::New(env, 3);
        d.Set(uint32_t{0}, dir.dx);
        d.Set(uint32_t{1}, dir.dy);
        d.Set(uint32_t{2}, dir.dz);
        out.Set("direction", d);
        return out;
    });
}

Napi::Value ProjectShapeDetail(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        ProjectionDirection dir = drawings_bind::parseDirection(env,
            info.Length() > 1 ? info[1] : env.Undefined());

        if (info.Length() < 3 || !info[2].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.drawings.projectDetail: expected focusCircle {x,y,r}");
        }
        auto fc = info[2].As<Napi::Object>();
        FocusCircle focus{
            drawings_bind::objNum(fc, "x", 0.0),
            drawings_bind::objNum(fc, "y", 0.0),
            drawings_bind::objNum(fc, "r", 0.0),
        };
        double scale = info.Length() > 3 && info[3].IsNumber()
            ? info[3].As<Napi::Number>().DoubleValue() : 2.0;

        ProjectedView pv = projectShapeDetail(h, dir, focus, scale);
        auto out = drawings_bind::viewToObj(env, pv);
        out.Set("scale", Napi::Number::New(env, scale));
        return out;
    });
}

Napi::Value ProjectShapeBroken(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        ProjectionDirection dir = drawings_bind::parseDirection(env,
            info.Length() > 1 ? info[1] : env.Undefined());

        if (info.Length() < 3 || !info[2].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.drawings.projectBroken: expected breakRegion {axis, start, end}");
        }
        auto br = info[2].As<Napi::Object>();
        BreakRegion region{};
        if (br.Has("axis")) {
            auto av = br.Get("axis");
            if (av.IsString()) {
                std::string s = av.As<Napi::String>();
                region.axis = (s == "y" || s == "Y" || s == "vertical") ? 1 : 0;
            } else if (av.IsNumber()) {
                region.axis = av.As<Napi::Number>().Int32Value();
            }
        }
        region.start = drawings_bind::objNum(br, "start", 0.0);
        region.end   = drawings_bind::objNum(br, "end",   0.0);

        ProjectedView pv = projectShapeBroken(h, dir, region);
        auto out = drawings_bind::viewToObj(env, pv);
        return out;
    });
}

// ----------------------------------------------------------- sketcher
Napi::Value SketcherCreate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::createSketch()));
    });
}
Napi::Value SketcherDestroy(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        forge::destroySketch(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}
Napi::Value SketcherAddPoint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addPoint(
                requireHandle(info, 0),
                requireNumber(info, 1, "x"),
                requireNumber(info, 2, "y"))));
    });
}
Napi::Value SketcherAddLine(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addLine(
                requireHandle(info, 0),
                requireHandle(info, 1),
                requireHandle(info, 2))));
    });
}
Napi::Value SketcherAddCircle(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addCircle(
                requireHandle(info, 0),
                requireHandle(info, 1),
                requireNumber(info, 2, "radius"))));
    });
}
Napi::Value SketcherAddArc(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addArc(
                requireHandle(info, 0),
                requireHandle(info, 1),
                requireHandle(info, 2),
                requireHandle(info, 3))));
    });
}
Napi::Value SketcherAddConstraint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h    = requireHandle(info, 0);
        auto kind = static_cast<forge::SketchConstraintKind>(requireHandle(info, 1));
        if (info.Length() < 3 || !info[2].IsArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge: addConstraint expects refs array at arg 2");
        }
        auto arr = info[2].As<Napi::Array>();
        std::vector<std::uint32_t> refs;
        refs.reserve(arr.Length());
        for (std::uint32_t i = 0; i < arr.Length(); ++i) {
            auto v = arr.Get(i);
            if (!v.IsNumber()) {
                throw Napi::TypeError::New(info.Env(),
                    "forge: addConstraint refs must be numbers");
            }
            refs.push_back(v.As<Napi::Number>().Uint32Value());
        }
        double value = (info.Length() > 3 && info[3].IsNumber())
                       ? info[3].As<Napi::Number>().DoubleValue()
                       : 0.0;
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addConstraint(h, kind, refs, value)));
    });
}
Napi::Value SketcherSolve(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto r = forge::solve(requireHandle(info, 0));
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("status", Napi::Number::New(env, static_cast<double>(r.status)));
        out.Set("dof",        Napi::Number::New(env, r.dof));
        out.Set("iterations", Napi::Number::New(env, r.iterations));
        return out;
    });
}
Napi::Value SketcherReadPoint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h   = requireHandle(info, 0);
        auto pid = requireHandle(info, 1);
        auto p = forge::readPoint(h, pid);
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("x", p.x);
        out.Set("y", p.y);
        return out;
    });
}
Napi::Value SketcherWritePoint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        forge::writePoint(
            requireHandle(info, 0),
            requireHandle(info, 1),
            requireNumber(info, 2, "x"),
            requireNumber(info, 3, "y"));
        return info.Env().Undefined();
    });
}
Napi::Value SketcherLiveCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::SketchRegistry::instance().liveCount()));
    });
}

// ----------------------------------------------------------- FEA (Forge-12)
//
// JS surface — under `forge.fea`:
//   meshFromBrep(handle, targetElemSize)
//     → { nodes: Float64Array, tets: Uint32Array,
//         nodeToFace: Uint32Array, elemNodeCount: 8, nodeCount, elemCount }
//   solveStatic(meshObj, materialObj, loadsArr, pressureLoadsArr, bcsArr)
//     → { u: Float64Array, vonMises: Float64Array,
//         maxVonMises, maxAtElem, residual }
//   solveModal(meshObj, materialObj, bcsArr, nModes)
//     → { eigenvalues: Float64Array, eigenvectors: [Float64Array...], nModes }
//   solveDynamic(meshObj, materialObj, loadsArr, bcsArr,
//                tEnd, dt, rayleighAlpha, rayleighBeta)
//     → { displacements: [Float64Array...], times: Float64Array,
//         maxStressEnvelope: Float64Array, cpuMs, stepCount }
//
// The mesh object can be the literal output of meshFromBrep — we read its
// `nodes`/`tets`/`nodeToFace`/`elemNodeCount` fields back into the C++
// `forge::fea::Mesh` struct. Materials, loads and BCs are plain JS objects.

namespace {

forge::fea::Mesh readMesh(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.fea: mesh must be an object");
    }
    auto obj = v.As<Napi::Object>();
    if (!obj.Has("nodes") || !obj.Get("nodes").IsTypedArray()) {
        throw Napi::TypeError::New(env, "forge.fea: mesh.nodes must be Float64Array");
    }
    if (!obj.Has("tets") || !obj.Get("tets").IsTypedArray()) {
        throw Napi::TypeError::New(env, "forge.fea: mesh.tets must be Uint32Array");
    }
    forge::fea::Mesh m;
    auto nodesArr = obj.Get("nodes").As<Napi::Float64Array>();
    m.nodes.assign(nodesArr.Data(), nodesArr.Data() + nodesArr.ElementLength());
    auto tetsArr = obj.Get("tets").As<Napi::Uint32Array>();
    m.tets.assign(tetsArr.Data(), tetsArr.Data() + tetsArr.ElementLength());
    if (obj.Has("nodeToFace") && obj.Get("nodeToFace").IsTypedArray()) {
        auto nf = obj.Get("nodeToFace").As<Napi::Uint32Array>();
        m.nodeToFace.assign(nf.Data(), nf.Data() + nf.ElementLength());
    }
    if (obj.Has("elemNodeCount") && obj.Get("elemNodeCount").IsNumber()) {
        m.elemNodeCount = obj.Get("elemNodeCount").As<Napi::Number>().Uint32Value();
    }
    return m;
}

forge::fea::Material readMaterial(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.fea: material must be an object");
    }
    auto obj = v.As<Napi::Object>();
    forge::fea::Material mat{};
    auto reqNum = [&](const char* k) {
        if (!obj.Has(k) || !obj.Get(k).IsNumber()) {
            throw Napi::TypeError::New(env,
                std::string("forge.fea: material.") + k + " required (number)");
        }
        return obj.Get(k).As<Napi::Number>().DoubleValue();
    };
    mat.E   = reqNum("E");
    mat.nu  = reqNum("nu");
    mat.rho = reqNum("rho");
    return mat;
}

std::vector<forge::fea::LoadNodal>
readNodalLoads(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::LoadNodal> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea: loads must be an array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto el = arr.Get(i);
        if (!el.IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.fea: each load entry must be {nodeId, fx, fy, fz}");
        }
        auto o = el.As<Napi::Object>();
        forge::fea::LoadNodal L{};
        L.nodeId = o.Has("nodeId") ? o.Get("nodeId").As<Napi::Number>().Uint32Value() : 0u;
        L.fx     = o.Has("fx") ? o.Get("fx").As<Napi::Number>().DoubleValue() : 0.0;
        L.fy     = o.Has("fy") ? o.Get("fy").As<Napi::Number>().DoubleValue() : 0.0;
        L.fz     = o.Has("fz") ? o.Get("fz").As<Napi::Number>().DoubleValue() : 0.0;
        out.push_back(L);
    }
    return out;
}

std::vector<forge::fea::LoadPressure>
readPressureLoads(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::LoadPressure> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea: pressureLoads must be an array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto el = arr.Get(i);
        if (!el.IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.fea: each pressure entry must be {faceId, pressure}");
        }
        auto o = el.As<Napi::Object>();
        forge::fea::LoadPressure P{};
        P.faceId   = o.Has("faceId") ? o.Get("faceId").As<Napi::Number>().Uint32Value() : 0u;
        P.pressure = o.Has("pressure") ? o.Get("pressure").As<Napi::Number>().DoubleValue() : 0.0;
        out.push_back(P);
    }
    return out;
}

std::vector<forge::fea::BCPinned>
readBCs(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::BCPinned> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea: bcs must be an array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto el = arr.Get(i);
        if (!el.IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.fea: each BC entry must be {nodeId, fx, fy, fz}");
        }
        auto o = el.As<Napi::Object>();
        forge::fea::BCPinned B{};
        B.nodeId = o.Has("nodeId") ? o.Get("nodeId").As<Napi::Number>().Uint32Value() : 0u;
        B.fx     = o.Has("fx") ? o.Get("fx").As<Napi::Boolean>().Value() : false;
        B.fy     = o.Has("fy") ? o.Get("fy").As<Napi::Boolean>().Value() : false;
        B.fz     = o.Has("fz") ? o.Get("fz").As<Napi::Boolean>().Value() : false;
        out.push_back(B);
    }
    return out;
}

Napi::Object meshToJs(const Napi::Env& env, const forge::fea::Mesh& m) {
    auto out = Napi::Object::New(env);
    auto nodes = Napi::Float64Array::New(env, m.nodes.size());
    std::copy(m.nodes.begin(), m.nodes.end(), nodes.Data());
    out.Set("nodes", nodes);
    auto tets = Napi::Uint32Array::New(env, m.tets.size());
    std::copy(m.tets.begin(), m.tets.end(), tets.Data());
    out.Set("tets", tets);
    auto nodeToFace = Napi::Uint32Array::New(env, m.nodeToFace.size());
    std::copy(m.nodeToFace.begin(), m.nodeToFace.end(), nodeToFace.Data());
    out.Set("nodeToFace", nodeToFace);
    out.Set("elemNodeCount", Napi::Number::New(env, m.elemNodeCount));
    out.Set("nodeCount", Napi::Number::New(env,
        static_cast<double>(m.nodes.size() / 3)));
    out.Set("elemCount", Napi::Number::New(env,
        static_cast<double>(m.tets.size() / m.elemNodeCount)));
    return out;
}

} // namespace

Napi::Value FeaMeshFromBrep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        const double targetSize = requireNumber(info, 1, "targetElemSize");
        auto mesh = forge::fea::meshFromBRep(h, targetSize);
        return meshToJs(info.Env(), mesh);
    });
}

Napi::Value FeaSolveStatic(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh     = readMesh(env, info[0]);
        auto material = readMaterial(env, info[1]);
        auto loads    = readNodalLoads(env, info.Length() > 2 ? info[2] : env.Undefined());
        auto pres     = readPressureLoads(env, info.Length() > 3 ? info[3] : env.Undefined());
        auto bcs      = readBCs(env, info.Length() > 4 ? info[4] : env.Undefined());

        auto r = forge::fea::solveStatic(mesh, material, loads, pres, bcs);
        auto out = Napi::Object::New(env);
        auto u = Napi::Float64Array::New(env, r.u.size());
        std::copy(r.u.begin(), r.u.end(), u.Data());
        out.Set("u", u);
        auto vm = Napi::Float64Array::New(env, r.vonMises.size());
        std::copy(r.vonMises.begin(), r.vonMises.end(), vm.Data());
        out.Set("vonMises", vm);
        out.Set("maxVonMises", Napi::Number::New(env, r.maxVonMises));
        out.Set("maxAtElem",   Napi::Number::New(env, r.maxAtElem));
        out.Set("residual",    Napi::Number::New(env, r.residual));
        return out;
    });
}

Napi::Value FeaSolveModal(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh     = readMesh(env, info[0]);
        auto material = readMaterial(env, info[1]);
        auto bcs      = readBCs(env, info.Length() > 2 ? info[2] : env.Undefined());
        const int nModes = info.Length() > 3 && info[3].IsNumber()
            ? info[3].As<Napi::Number>().Int32Value() : 3;

        auto r = forge::fea::solveModal(mesh, material, bcs, nModes);
        auto out = Napi::Object::New(env);
        auto vals = Napi::Float64Array::New(env, r.eigenvalues.size());
        std::copy(r.eigenvalues.begin(), r.eigenvalues.end(), vals.Data());
        out.Set("eigenvalues", vals);
        auto vecsArr = Napi::Array::New(env, r.eigenvectors.size());
        for (std::size_t i = 0; i < r.eigenvectors.size(); ++i) {
            auto& phi = r.eigenvectors[i];
            auto ta = Napi::Float64Array::New(env, phi.size());
            std::copy(phi.begin(), phi.end(), ta.Data());
            vecsArr.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("eigenvectors", vecsArr);
        out.Set("nModes", Napi::Number::New(env, r.nModes));
        return out;
    });
}

Napi::Value FeaSolveDynamic(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh     = readMesh(env, info[0]);
        auto material = readMaterial(env, info[1]);
        auto loads    = readNodalLoads(env, info.Length() > 2 ? info[2] : env.Undefined());
        auto bcs      = readBCs(env, info.Length() > 3 ? info[3] : env.Undefined());
        const double tEnd  = requireNumber(info, 4, "tEnd");
        const double dt    = requireNumber(info, 5, "dt");
        const double alpha = info.Length() > 6 && info[6].IsNumber()
            ? info[6].As<Napi::Number>().DoubleValue() : 0.0;
        const double betaR = info.Length() > 7 && info[7].IsNumber()
            ? info[7].As<Napi::Number>().DoubleValue() : 0.0;

        auto r = forge::fea::solveDynamic(mesh, material, loads, bcs,
                                          tEnd, dt, alpha, betaR);
        auto out = Napi::Object::New(env);
        auto times = Napi::Float64Array::New(env, r.times.size());
        std::copy(r.times.begin(), r.times.end(), times.Data());
        out.Set("times", times);

        auto disps = Napi::Array::New(env, r.displacements.size());
        for (std::size_t i = 0; i < r.displacements.size(); ++i) {
            auto& u = r.displacements[i];
            auto ta = Napi::Float64Array::New(env, u.size());
            std::copy(u.begin(), u.end(), ta.Data());
            disps.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("displacements", disps);

        auto env_ = Napi::Float64Array::New(env, r.maxStressEnvelope.size());
        std::copy(r.maxStressEnvelope.begin(), r.maxStressEnvelope.end(), env_.Data());
        out.Set("maxStressEnvelope", env_);
        out.Set("cpuMs", Napi::Number::New(env, r.cpuMs));
        out.Set("stepCount", Napi::Number::New(env,
            static_cast<double>(r.displacements.size())));
        return out;
    });
}

// ----------------------------------------------------------- cam (Forge-13)
//
// All CAM operations take a Tool {} and CuttingParams {} as plain JS
// objects. The Tool fields map 1:1 onto forge::cam::Tool; type strings are
// translated to the enum at the boundary so JS callers can write
// `{ type: 'EndMill' }` rather than memorising integer codes.
namespace cam_bind {

forge::cam::Tool::Type parseToolType(Napi::Env env, const std::string& s) {
    if (s == "EndMill")  return forge::cam::Tool::EndMill;
    if (s == "BallNose") return forge::cam::Tool::BallNose;
    if (s == "Drill")    return forge::cam::Tool::Drill;
    if (s == "Chamfer")  return forge::cam::Tool::Chamfer;
    throw Napi::TypeError::New(env, "forge.cam: unknown tool type '" + s + "'");
}

forge::cam::Tool readTool(Napi::Env env, Napi::Value val) {
    if (!val.IsObject()) {
        throw Napi::TypeError::New(env, "forge.cam: tool must be an object");
    }
    Napi::Object obj = val.As<Napi::Object>();
    forge::cam::Tool t{};
    t.id          = obj.Has("id")          ? obj.Get("id").As<Napi::Number>().Uint32Value() : 0u;
    t.name        = obj.Has("name")        ? std::string(obj.Get("name").As<Napi::String>()) : std::string("tool");
    t.diameter    = obj.Has("diameter")    ? obj.Get("diameter").As<Napi::Number>().DoubleValue() : 0.0;
    t.fluteLength = obj.Has("fluteLength") ? obj.Get("fluteLength").As<Napi::Number>().DoubleValue() : 0.0;
    t.helix       = obj.Has("helix")       ? obj.Get("helix").As<Napi::Number>().DoubleValue() : 0.0;
    t.flutes      = obj.Has("flutes")      ? obj.Get("flutes").As<Napi::Number>().Int32Value()   : 2;
    if (obj.Has("type")) {
        Napi::Value tv = obj.Get("type");
        if (tv.IsString()) {
            t.type = parseToolType(env, std::string(tv.As<Napi::String>()));
        } else if (tv.IsNumber()) {
            t.type = static_cast<forge::cam::Tool::Type>(tv.As<Napi::Number>().Int32Value());
        } else {
            throw Napi::TypeError::New(env, "forge.cam: tool.type must be string or number");
        }
    } else {
        t.type = forge::cam::Tool::EndMill;
    }
    return t;
}

forge::cam::CuttingParams readParams(Napi::Env env, Napi::Value val) {
    if (!val.IsObject()) {
        throw Napi::TypeError::New(env, "forge.cam: params must be an object");
    }
    Napi::Object obj = val.As<Napi::Object>();
    forge::cam::CuttingParams p{};
    p.feedXY     = obj.Has("feedXY")     ? obj.Get("feedXY").As<Napi::Number>().DoubleValue()     : 600.0;
    p.feedZ      = obj.Has("feedZ")      ? obj.Get("feedZ").As<Napi::Number>().DoubleValue()      : 200.0;
    p.spindleRPM = obj.Has("spindleRPM") ? obj.Get("spindleRPM").As<Napi::Number>().DoubleValue() : 12000.0;
    p.stepover   = obj.Has("stepover")   ? obj.Get("stepover").As<Napi::Number>().DoubleValue()   : 1.0;
    p.stepdown   = obj.Has("stepdown")   ? obj.Get("stepdown").As<Napi::Number>().DoubleValue()   : 2.0;
    p.coolant    = obj.Has("coolant")    ? obj.Get("coolant").As<Napi::Number>().DoubleValue()    : 0.0;
    return p;
}

Napi::Value packToolpath(Napi::Env env, const forge::cam::Toolpath& tp) {
    auto out = Napi::Object::New(env);
    out.Set("toolId", Napi::Number::New(env, tp.toolId));

    // 5 floats per move: x, y, z, cutting (0/1), feedrate.
    auto moves = Napi::Float32Array::New(env, tp.moves.size() * 5);
    float* d = moves.Data();
    for (std::size_t i = 0; i < tp.moves.size(); ++i) {
        const auto& m = tp.moves[i];
        d[i * 5 + 0] = static_cast<float>(m.x);
        d[i * 5 + 1] = static_cast<float>(m.y);
        d[i * 5 + 2] = static_cast<float>(m.z);
        d[i * 5 + 3] = m.cutting ? 1.0f : 0.0f;
        d[i * 5 + 4] = static_cast<float>(m.feedrate);
    }
    out.Set("moves", moves);
    out.Set("moveCount",    Napi::Number::New(env, static_cast<double>(tp.moves.size())));
    out.Set("cycleTimeSec", Napi::Number::New(env, tp.cycleTimeSec));
    out.Set("estCuttingMm", Napi::Number::New(env, tp.estCuttingMm));
    return out;
}

std::uint32_t readFaceArg(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx) return forge::cam::kAutoFaceId;
    Napi::Value v = info[idx];
    if (v.IsNull() || v.IsUndefined()) return forge::cam::kAutoFaceId;
    if (v.IsNumber()) return v.As<Napi::Number>().Uint32Value();
    throw Napi::TypeError::New(info.Env(), "forge.cam: faceId must be a number or null");
}

forge::cam::gcode::Dialect parseDialect(Napi::Env env, Napi::Value v) {
    if (v.IsNumber()) {
        return static_cast<forge::cam::gcode::Dialect>(v.As<Napi::Number>().Int32Value());
    }
    if (v.IsString()) {
        std::string s = v.As<Napi::String>();
        if (s == "Fanuc")    return forge::cam::gcode::Fanuc;
        if (s == "Haas")     return forge::cam::gcode::Haas;
        if (s == "LinuxCNC") return forge::cam::gcode::LinuxCNC;
        if (s == "Grbl")     return forge::cam::gcode::Grbl;
        throw Napi::TypeError::New(env, "forge.cam.gcode: unknown dialect '" + s + "'");
    }
    throw Napi::TypeError::New(env, "forge.cam.gcode: dialect must be string or number");
}

forge::cam::Toolpath readToolpathFromObject(Napi::Env env, Napi::Object obj) {
    forge::cam::Toolpath tp{};
    tp.toolId       = obj.Has("toolId") ? obj.Get("toolId").As<Napi::Number>().Uint32Value() : 0u;
    tp.cycleTimeSec = obj.Has("cycleTimeSec") ? obj.Get("cycleTimeSec").As<Napi::Number>().DoubleValue() : 0.0;
    tp.estCuttingMm = obj.Has("estCuttingMm") ? obj.Get("estCuttingMm").As<Napi::Number>().DoubleValue() : 0.0;
    if (!obj.Has("moves")) {
        throw Napi::TypeError::New(env, "forge.cam.gcode.toGcode: toolpath.moves missing");
    }
    auto arr = obj.Get("moves").As<Napi::Float32Array>();
    const std::size_t n = arr.ElementLength() / 5;
    tp.moves.reserve(n);
    const float* d = arr.Data();
    for (std::size_t i = 0; i < n; ++i) {
        forge::cam::Move m{};
        m.x        = d[i * 5 + 0];
        m.y        = d[i * 5 + 1];
        m.z        = d[i * 5 + 2];
        m.cutting  = d[i * 5 + 3] > 0.5f;
        m.feedrate = d[i * 5 + 4];
        tp.moves.push_back(m);
    }
    return tp;
}

} // namespace cam_bind

Napi::Value CamProfile(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto shape = requireHandle(info, 0);
        auto faceId = cam_bind::readFaceArg(info, 1);
        auto tool   = cam_bind::readTool(info.Env(), info[2]);
        auto params = cam_bind::readParams(info.Env(), info[3]);
        double zTop    = requireNumber(info, 4, "zTop");
        double zBottom = requireNumber(info, 5, "zBottom");
        double leadIn  = info.Length() > 6 && info[6].IsNumber()
                            ? info[6].As<Napi::Number>().DoubleValue() : 0.0;
        auto tp = forge::cam::profile(shape, faceId, tool, params, zTop, zBottom, leadIn);
        return cam_bind::packToolpath(info.Env(), tp);
    });
}

Napi::Value CamPocket(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto shape  = requireHandle(info, 0);
        auto faceId = cam_bind::readFaceArg(info, 1);
        auto tool   = cam_bind::readTool(info.Env(), info[2]);
        auto params = cam_bind::readParams(info.Env(), info[3]);
        double zTop    = requireNumber(info, 4, "zTop");
        double zBottom = requireNumber(info, 5, "zBottom");
        auto tp = forge::cam::pocket(shape, faceId, tool, params, zTop, zBottom);
        return cam_bind::packToolpath(info.Env(), tp);
    });
}

Napi::Value CamDrill(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto shape = requireHandle(info, 0);
        if (!info[1].IsArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.cam.drill: expected holes array [[x,y,z], ...]");
        }
        auto arr = info[1].As<Napi::Array>();
        std::vector<std::array<double, 3>> holes;
        holes.reserve(arr.Length());
        for (std::uint32_t i = 0; i < arr.Length(); ++i) {
            auto el = arr.Get(i);
            if (!el.IsArray()) {
                throw Napi::TypeError::New(info.Env(),
                    "forge.cam.drill: hole element must be [x,y,z]");
            }
            auto a = el.As<Napi::Array>();
            std::array<double, 3> h{0.0, 0.0, 0.0};
            for (std::uint32_t j = 0; j < a.Length() && j < 3; ++j) {
                h[j] = a.Get(j).As<Napi::Number>().DoubleValue();
            }
            holes.push_back(h);
        }
        auto tool   = cam_bind::readTool(info.Env(), info[2]);
        auto params = cam_bind::readParams(info.Env(), info[3]);
        double zTop    = requireNumber(info, 4, "zTop");
        double zBottom = requireNumber(info, 5, "zBottom");
        bool   peck    = info.Length() > 6 && info[6].IsBoolean()
                            ? info[6].As<Napi::Boolean>().Value() : false;
        auto tp = forge::cam::drill(shape, holes, tool, params, zTop, zBottom, peck);
        return cam_bind::packToolpath(info.Env(), tp);
    });
}

Napi::Value CamFaceMill(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto shape  = requireHandle(info, 0);
        auto faceId = cam_bind::readFaceArg(info, 1);
        auto tool   = cam_bind::readTool(info.Env(), info[2]);
        auto params = cam_bind::readParams(info.Env(), info[3]);
        double zTop  = requireNumber(info, 4, "zTop");
        double depth = requireNumber(info, 5, "depth");
        auto tp = forge::cam::faceMill(shape, faceId, tool, params, zTop, depth);
        return cam_bind::packToolpath(info.Env(), tp);
    });
}

// ----------------------------------------------------------- cam advanced (Forge-33)
namespace camadv_bind {

forge::cam::StockAABB readStock(Napi::Env env, Napi::Value v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.cam.adv: stock must be { aabb: Float64Array[6] } or Float64Array[6]");
    }
    forge::cam::StockAABB s{};
    if (v.IsTypedArray()) {
        auto a = v.As<Napi::Float64Array>();
        if (a.ElementLength() != 6) {
            throw Napi::TypeError::New(env, "forge.cam.adv: stock AABB must have 6 elements");
        }
        s.minX = a.Data()[0]; s.minY = a.Data()[1]; s.minZ = a.Data()[2];
        s.maxX = a.Data()[3]; s.maxY = a.Data()[4]; s.maxZ = a.Data()[5];
        return s;
    }
    auto obj = v.As<Napi::Object>();
    Napi::Value av = obj.Has("aabb") ? obj.Get("aabb") : obj.Get("bbox");
    if (!av.IsTypedArray()) {
        throw Napi::TypeError::New(env, "forge.cam.adv: stock.aabb must be Float64Array[6]");
    }
    auto a = av.As<Napi::Float64Array>();
    if (a.ElementLength() != 6) {
        throw Napi::TypeError::New(env, "forge.cam.adv: stock.aabb must have 6 elements");
    }
    s.minX = a.Data()[0]; s.minY = a.Data()[1]; s.minZ = a.Data()[2];
    s.maxX = a.Data()[3]; s.maxY = a.Data()[4]; s.maxZ = a.Data()[5];
    return s;
}

forge::cam::AdaptiveParams readAdaptive(Napi::Env env, Napi::Value v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.cam.adv: adaptive params must be an object");
    }
    auto obj = v.As<Napi::Object>();
    forge::cam::AdaptiveParams ap{};
    ap.stepover   = obj.Has("stepover")   ? obj.Get("stepover").As<Napi::Number>().DoubleValue()   : 1.0;
    ap.zMax       = obj.Has("zMax")       ? obj.Get("zMax").As<Napi::Number>().DoubleValue()       : 0.0;
    ap.zMin       = obj.Has("zMin")       ? obj.Get("zMin").As<Napi::Number>().DoubleValue()       : 0.0;
    ap.helixAngle = obj.Has("helixAngle") ? obj.Get("helixAngle").As<Napi::Number>().DoubleValue() : 5.0;
    ap.minRadius  = obj.Has("minRadius")  ? obj.Get("minRadius").As<Napi::Number>().DoubleValue()  : 1.0;
    return ap;
}

} // namespace camadv_bind

Napi::Value CamAdaptiveClear(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto shape  = requireHandle(info, 0);
        auto stock  = camadv_bind::readStock(env, info[1]);
        auto tool   = cam_bind::readTool(env, info[2]);
        auto params = cam_bind::readParams(env, info[3]);
        auto adapt  = camadv_bind::readAdaptive(env, info[4]);
        auto tp = forge::cam::adaptiveClear3Axis(shape, stock, tool, params, adapt);
        return cam_bind::packToolpath(env, tp);
    });
}

Napi::Value CamMultiAxisIndexed(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto shape  = requireHandle(info, 0);
        auto tool   = cam_bind::readTool(env, info[1]);
        auto params = cam_bind::readParams(env, info[2]);
        if (!info[3].IsArray()) {
            throw Napi::TypeError::New(env, "forge.cam.multiAxisIndexed: orientations must be Array of [A,B,C]");
        }
        auto arr = info[3].As<Napi::Array>();
        std::vector<std::array<double, 3>> orient;
        orient.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto el = arr.Get(i);
            if (!el.IsArray()) {
                throw Napi::TypeError::New(env, "forge.cam.multiAxisIndexed: orientation entry must be [A,B,C]");
            }
            auto a = el.As<Napi::Array>();
            std::array<double, 3> abc{0.0, 0.0, 0.0};
            for (uint32_t j = 0; j < a.Length() && j < 3; ++j) {
                abc[j] = a.Get(j).As<Napi::Number>().DoubleValue();
            }
            orient.push_back(abc);
        }
        double zTop = requireNumber(info, 4, "zTop");
        double zBottom = requireNumber(info, 5, "zBottom");
        std::vector<forge::cam::OrientedToolpath> per;
        auto tp = forge::cam::multiAxisIndexed(shape, tool, params, orient, zTop, zBottom, &per);
        auto out = cam_bind::packToolpath(env, tp).As<Napi::Object>();
        auto perArr = Napi::Array::New(env, per.size());
        for (uint32_t i = 0; i < per.size(); ++i) {
            auto o = Napi::Object::New(env);
            auto ab = Napi::Array::New(env, 3);
            ab.Set(uint32_t{0}, per[i].abc[0]);
            ab.Set(uint32_t{1}, per[i].abc[1]);
            ab.Set(uint32_t{2}, per[i].abc[2]);
            o.Set("abc", ab);
            o.Set("startMove", Napi::Number::New(env, static_cast<double>(per[i].startMove)));
            perArr.Set(i, o);
        }
        out.Set("perOrientation", perArr);
        return out;
    });
}

Napi::Value CamMultiAxisContinuous(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto shape  = requireHandle(info, 0);
        auto tool   = cam_bind::readTool(env, info[1]);
        auto params = cam_bind::readParams(env, info[2]);
        if (!info[3].IsArray()) {
            throw Napi::TypeError::New(env, "forge.cam.multiAxisContinuous: path must be Array of {x,y,z,nx,ny,nz}");
        }
        auto arr = info[3].As<Napi::Array>();
        std::vector<forge::cam::SurfaceStation> path;
        path.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto el = arr.Get(i).As<Napi::Object>();
            forge::cam::SurfaceStation s{};
            s.x  = el.Has("x")  ? el.Get("x").As<Napi::Number>().DoubleValue()  : 0.0;
            s.y  = el.Has("y")  ? el.Get("y").As<Napi::Number>().DoubleValue()  : 0.0;
            s.z  = el.Has("z")  ? el.Get("z").As<Napi::Number>().DoubleValue()  : 0.0;
            s.nx = el.Has("nx") ? el.Get("nx").As<Napi::Number>().DoubleValue() : 0.0;
            s.ny = el.Has("ny") ? el.Get("ny").As<Napi::Number>().DoubleValue() : 0.0;
            s.nz = el.Has("nz") ? el.Get("nz").As<Napi::Number>().DoubleValue() : 1.0;
            path.push_back(s);
        }
        auto out = forge::cam::multiAxisContinuous(shape, tool, params, path);
        auto outObj = cam_bind::packToolpath(env, out.tp).As<Napi::Object>();
        auto orient = Napi::Float32Array::New(env, out.axisOrientations.size() * 3);
        for (std::size_t i = 0; i < out.axisOrientations.size(); ++i) {
            orient.Data()[i * 3 + 0] = static_cast<float>(out.axisOrientations[i][0]);
            orient.Data()[i * 3 + 1] = static_cast<float>(out.axisOrientations[i][1]);
            orient.Data()[i * 3 + 2] = static_cast<float>(out.axisOrientations[i][2]);
        }
        outObj.Set("axisOrientations", orient);
        return outObj;
    });
}

Napi::Value CamSimulateStock(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto stock = camadv_bind::readStock(env, info[0]);
        if (!info[1].IsObject()) {
            throw Napi::TypeError::New(env, "forge.cam.simulateStock: toolpath must be an object");
        }
        auto tp = cam_bind::readToolpathFromObject(env, info[1].As<Napi::Object>());
        auto tool = cam_bind::readTool(env, info[2]);
        std::uint32_t gridN = info.Length() > 3 && info[3].IsNumber()
            ? info[3].As<Napi::Number>().Uint32Value() : 50u;
        auto rep = forge::cam::simulateStock(stock, tp, tool, gridN);
        auto out = Napi::Object::New(env);
        out.Set("remainingVolume", Napi::Number::New(env, rep.remainingVolume));
        out.Set("initialVolume",   Napi::Number::New(env, rep.initialVolume));
        out.Set("maxCutDepth",     Napi::Number::New(env, rep.maxCutDepth));
        out.Set("collisionCount",  Napi::Number::New(env, rep.collisionCount));
        out.Set("gridResolution",  Napi::Number::New(env, rep.gridResolution));
        auto hist = Napi::Float64Array::New(env, rep.residueDistribution.size());
        std::copy(rep.residueDistribution.begin(), rep.residueDistribution.end(), hist.Data());
        out.Set("residueDistribution", hist);
        return out;
    });
}

Napi::Value CamGenerateCmm(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto shape = requireHandle(info, 0);
        if (!info[1].IsArray()) {
            throw Napi::TypeError::New(env, "forge.cam.generateCmm: features must be Array");
        }
        auto arr = info[1].As<Napi::Array>();
        std::vector<forge::cam::InspectionFeature> features;
        features.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto el = arr.Get(i).As<Napi::Object>();
            forge::cam::InspectionFeature f{};
            std::string k = el.Has("kind") ? el.Get("kind").As<Napi::String>().Utf8Value() : "point";
            if      (k == "plane")    f.kind = forge::cam::InspectionFeatureKind::Plane;
            else if (k == "cylinder") f.kind = forge::cam::InspectionFeatureKind::Cylinder;
            else                      f.kind = forge::cam::InspectionFeatureKind::Point;
            f.topo  = el.Has("topo")  ? el.Get("topo").As<Napi::Number>().Uint32Value() : forge::cam::kAutoFaceId;
            f.label = el.Has("label") ? el.Get("label").As<Napi::String>().Utf8Value()  : ("F" + std::to_string(i));
            features.push_back(f);
        }
        if (!info[2].IsObject()) {
            throw Napi::TypeError::New(env, "forge.cam.generateCmm: gauge must be { stepover, probeRadius }");
        }
        auto gObj = info[2].As<Napi::Object>();
        forge::cam::CmmGauge g{};
        g.stepover    = gObj.Has("stepover")    ? gObj.Get("stepover").As<Napi::Number>().DoubleValue()    : 5.0;
        g.probeRadius = gObj.Has("probeRadius") ? gObj.Get("probeRadius").As<Napi::Number>().DoubleValue() : 1.0;
        auto prog = forge::cam::generateCmm(shape, features, g);
        auto out = Napi::Object::New(env);
        auto pts = Napi::Float64Array::New(env, prog.points.size() * 6);
        for (std::size_t i = 0; i < prog.points.size(); ++i) {
            const auto& p = prog.points[i];
            pts.Data()[i * 6 + 0] = p.x;  pts.Data()[i * 6 + 1] = p.y;  pts.Data()[i * 6 + 2] = p.z;
            pts.Data()[i * 6 + 3] = p.nx; pts.Data()[i * 6 + 4] = p.ny; pts.Data()[i * 6 + 5] = p.nz;
        }
        out.Set("points", pts);
        out.Set("pointCount", Napi::Number::New(env, static_cast<double>(prog.points.size())));
        auto per = Napi::Uint32Array::New(env, prog.pointsPerFeature.size());
        std::copy(prog.pointsPerFeature.begin(), prog.pointsPerFeature.end(), per.Data());
        out.Set("pointsPerFeature", per);
        out.Set("text", Napi::String::New(env, prog.text));
        return out;
    });
}

Napi::Value CamToGcode(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.cam.gcode.toGcode: expected toolpath object");
        }
        auto env = info.Env();
        auto tp = cam_bind::readToolpathFromObject(env, info[0].As<Napi::Object>());
        auto dialect = cam_bind::parseDialect(env, info[1]);
        double safeZ = info.Length() > 2 && info[2].IsNumber()
                          ? info[2].As<Napi::Number>().DoubleValue() : 25.0;
        std::string gcode = forge::cam::gcode::toGcode(tp, dialect, safeZ);
        return Napi::String::New(env, gcode);
    });
}

// ----------------------------------------------------------- FEA extras (Forge-12b)
//
// JS surface — under `forge.fea`:
//   solveThermal(meshObj, materialObj, dirichletArr, sourcesArr, convectionArr)
//     → { T: Float64Array, elemFluxMag: Float64Array, maxT, minT, residual }
//   solveNonlinearStatic(meshObj, materialObj, loadsArr, bcsArr, cfgObj)
//     → { stepDisplacements: [Float64Array...], stepResiduals: Float64Array,
//         stepIterations: Uint32Array, converged: bool, cpuMs }
//   fatigueLife(stressHistory: Float64Array, nElem, nSteps, cfgObj)
//     → { cyclesToFailure: Float64Array, minLife, minLifeElem, maxAmplitude }

namespace {

std::vector<forge::fea::ThermalNodalT>
readDirichlet(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::ThermalNodalT> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea.solveThermal: dirichlet must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto o = arr.Get(i).As<Napi::Object>();
        forge::fea::ThermalNodalT d{};
        d.nodeId = o.Get("nodeId").As<Napi::Number>().Uint32Value();
        d.T      = o.Get("T").As<Napi::Number>().DoubleValue();
        out.push_back(d);
    }
    return out;
}

std::vector<forge::fea::ThermalElemSource>
readSources(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::ThermalElemSource> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea.solveThermal: sources must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto o = arr.Get(i).As<Napi::Object>();
        forge::fea::ThermalElemSource s{};
        s.elemId = o.Get("elemId").As<Napi::Number>().Uint32Value();
        s.q      = o.Get("q").As<Napi::Number>().DoubleValue();
        out.push_back(s);
    }
    return out;
}

std::vector<forge::fea::ThermalConvection>
readConvection(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::ThermalConvection> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea.solveThermal: convection must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto o = arr.Get(i).As<Napi::Object>();
        forge::fea::ThermalConvection c{};
        c.faceId = o.Get("faceId").As<Napi::Number>().Uint32Value();
        c.h      = o.Get("h").As<Napi::Number>().DoubleValue();
        c.Tinf   = o.Get("Tinf").As<Napi::Number>().DoubleValue();
        out.push_back(c);
    }
    return out;
}

} // namespace

Napi::Value FeaSolveThermal(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh = readMesh(env, info[0]);
        if (!info[1].IsObject()) {
            throw Napi::TypeError::New(env, "forge.fea.solveThermal: material must be {k}");
        }
        auto matObj = info[1].As<Napi::Object>();
        forge::fea::ThermalMaterial mat{};
        if (!matObj.Has("k")) {
            throw Napi::TypeError::New(env, "forge.fea.solveThermal: material.k required");
        }
        mat.k = matObj.Get("k").As<Napi::Number>().DoubleValue();
        auto dirichlet  = readDirichlet (env, info.Length() > 2 ? info[2] : env.Undefined());
        auto sources    = readSources   (env, info.Length() > 3 ? info[3] : env.Undefined());
        auto convection = readConvection(env, info.Length() > 4 ? info[4] : env.Undefined());
        auto r = forge::fea::solveThermal(mesh, mat, dirichlet, sources, convection);
        auto out = Napi::Object::New(env);
        auto T = Napi::Float64Array::New(env, r.T.size());
        std::copy(r.T.begin(), r.T.end(), T.Data());
        out.Set("T", T);
        auto fm = Napi::Float64Array::New(env, r.elemFluxMag.size());
        std::copy(r.elemFluxMag.begin(), r.elemFluxMag.end(), fm.Data());
        out.Set("elemFluxMag", fm);
        out.Set("maxT", Napi::Number::New(env, r.maxT));
        out.Set("minT", Napi::Number::New(env, r.minT));
        out.Set("residual", Napi::Number::New(env, r.residual));
        return out;
    });
}

Napi::Value FeaSolveNonlinearStatic(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh     = readMesh(env, info[0]);
        auto material = readMaterial(env, info[1]);
        auto loads    = readNodalLoads(env, info.Length() > 2 ? info[2] : env.Undefined());
        auto bcs      = readBCs(env, info.Length() > 3 ? info[3] : env.Undefined());
        forge::fea::NonlinearConfig cfg;
        if (info.Length() > 4 && info[4].IsObject()) {
            auto co = info[4].As<Napi::Object>();
            if (co.Has("loadSteps"))   cfg.loadSteps   = co.Get("loadSteps").As<Napi::Number>().Int32Value();
            if (co.Has("maxNewton"))   cfg.maxNewton   = co.Get("maxNewton").As<Napi::Number>().Int32Value();
            if (co.Has("residualTol")) cfg.residualTol = co.Get("residualTol").As<Napi::Number>().DoubleValue();
        }
        auto r = forge::fea::solveNonlinearStatic(mesh, material, loads, bcs, cfg);
        auto out = Napi::Object::New(env);
        auto disps = Napi::Array::New(env, r.stepDisplacements.size());
        for (std::size_t i = 0; i < r.stepDisplacements.size(); ++i) {
            auto& u = r.stepDisplacements[i];
            auto ta = Napi::Float64Array::New(env, u.size());
            std::copy(u.begin(), u.end(), ta.Data());
            disps.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("stepDisplacements", disps);
        auto res = Napi::Float64Array::New(env, r.stepResiduals.size());
        std::copy(r.stepResiduals.begin(), r.stepResiduals.end(), res.Data());
        out.Set("stepResiduals", res);
        auto its = Napi::Uint32Array::New(env, r.stepIterations.size());
        for (std::size_t i = 0; i < r.stepIterations.size(); ++i) its.Data()[i] = r.stepIterations[i];
        out.Set("stepIterations", its);
        out.Set("converged", Napi::Boolean::New(env, r.converged));
        out.Set("cpuMs", Napi::Number::New(env, r.cpuMs));
        return out;
    });
}

Napi::Value FeaFatigueLife(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsTypedArray()) {
            throw Napi::TypeError::New(env,
                "forge.fea.fatigueLife: stressHistory must be Float64Array");
        }
        auto sh = info[0].As<Napi::Float64Array>();
        std::vector<double> hist(sh.Data(), sh.Data() + sh.ElementLength());
        const auto nElem  = info[1].As<Napi::Number>().Uint32Value();
        const auto nSteps = info[2].As<Napi::Number>().Uint32Value();
        forge::fea::FatigueConfig cfg;
        if (!info[3].IsObject()) {
            throw Napi::TypeError::New(env, "forge.fea.fatigueLife: cfg must be an object");
        }
        auto co = info[3].As<Napi::Object>();
        if (!co.Has("sn") || !co.Get("sn").IsObject()) {
            throw Napi::TypeError::New(env, "forge.fea.fatigueLife: cfg.sn = { N, S }");
        }
        auto sn = co.Get("sn").As<Napi::Object>();
        auto Narr = sn.Get("N").As<Napi::Array>();
        auto Sarr = sn.Get("S").As<Napi::Array>();
        cfg.sn.N.resize(Narr.Length());
        cfg.sn.S.resize(Sarr.Length());
        for (uint32_t i = 0; i < Narr.Length(); ++i) cfg.sn.N[i] = Narr.Get(i).As<Napi::Number>().DoubleValue();
        for (uint32_t i = 0; i < Sarr.Length(); ++i) cfg.sn.S[i] = Sarr.Get(i).As<Napi::Number>().DoubleValue();
        if (co.Has("meanCorrection")) cfg.meanCorrection = co.Get("meanCorrection").As<Napi::Number>().Int32Value();
        if (co.Has("ultimateStress")) cfg.ultimateStress = co.Get("ultimateStress").As<Napi::Number>().DoubleValue();
        if (co.Has("yieldStress"))    cfg.yieldStress    = co.Get("yieldStress").As<Napi::Number>().DoubleValue();
        if (co.Has("cyclesPerSample"))cfg.cyclesPerSample= co.Get("cyclesPerSample").As<Napi::Number>().DoubleValue();
        auto r = forge::fea::fatigueLife(hist, nElem, nSteps, cfg);
        auto out = Napi::Object::New(env);
        auto cs = Napi::Float64Array::New(env, r.cyclesToFailure.size());
        std::copy(r.cyclesToFailure.begin(), r.cyclesToFailure.end(), cs.Data());
        out.Set("cyclesToFailure", cs);
        out.Set("minLife", Napi::Number::New(env, r.minLife));
        out.Set("minLifeElem", Napi::Number::New(env, r.minLifeElem));
        out.Set("maxAmplitude", Napi::Number::New(env, r.maxAmplitude));
        return out;
    });
}

// ----------------------------------------------------------- CFD (Forge-12b)
//
// JS surface — under `forge.cfd`:
//   solveSteadyNS(cfgObj)
//     → { u: Float64Array, v: Float64Array, w: Float64Array,
//         p: Float64Array, maxVelocity, reynolds, iterations,
//         finalResidual, initialResidual, cpuMs, Nx, Ny, Nz }

namespace {

std::vector<forge::cfd::BCFaceVelocity>
readInlets(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::cfd::BCFaceVelocity> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.cfd: inlets must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto o = arr.Get(i).As<Napi::Object>();
        forge::cfd::BCFaceVelocity in{};
        in.faceId = o.Get("faceId").As<Napi::Number>().Uint32Value();
        in.vx = o.Has("vx") ? o.Get("vx").As<Napi::Number>().DoubleValue() : 0.0;
        in.vy = o.Has("vy") ? o.Get("vy").As<Napi::Number>().DoubleValue() : 0.0;
        in.vz = o.Has("vz") ? o.Get("vz").As<Napi::Number>().DoubleValue() : 0.0;
        out.push_back(in);
    }
    return out;
}

std::vector<std::uint32_t> readFaceIdArray(const Napi::Env& env, const Napi::Value& v) {
    std::vector<std::uint32_t> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.cfd: face id list must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        out.push_back(arr.Get(i).As<Napi::Number>().Uint32Value());
    }
    return out;
}

} // namespace

Napi::Value CfdSolveSteadyNS(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsObject()) {
            throw Napi::TypeError::New(env, "forge.cfd.solveSteadyNS: cfg must be an object");
        }
        auto co = info[0].As<Napi::Object>();
        forge::cfd::CfdConfig cfg;
        if (!co.Has("domain")) throw Napi::TypeError::New(env, "forge.cfd: cfg.domain required");
        auto domain = co.Get("domain").As<Napi::Float64Array>();
        if (domain.ElementLength() != 6) {
            throw Napi::TypeError::New(env, "forge.cfd: domain must be Float64Array[6]");
        }
        cfg.domain = { domain.Data()[0], domain.Data()[1], domain.Data()[2],
                       domain.Data()[3], domain.Data()[4], domain.Data()[5] };
        cfg.Nx = co.Get("Nx").As<Napi::Number>().Int32Value();
        cfg.Ny = co.Get("Ny").As<Napi::Number>().Int32Value();
        cfg.Nz = co.Get("Nz").As<Napi::Number>().Int32Value();
        cfg.rho = co.Get("rho").As<Napi::Number>().DoubleValue();
        cfg.nu  = co.Get("nu").As<Napi::Number>().DoubleValue();
        if (co.Has("maxIter"))     cfg.maxIter     = co.Get("maxIter").As<Napi::Number>().Int32Value();
        if (co.Has("residualTol")) cfg.residualTol = co.Get("residualTol").As<Napi::Number>().DoubleValue();
        cfg.inlets  = readInlets(env, co.Has("inlets")  ? co.Get("inlets")  : env.Undefined());
        cfg.outlets = readFaceIdArray(env, co.Has("outlets") ? co.Get("outlets") : env.Undefined());
        cfg.walls   = readFaceIdArray(env, co.Has("walls")   ? co.Get("walls")   : env.Undefined());
        if (co.Has("lid") && co.Get("lid").IsObject()) {
            auto lo = co.Get("lid").As<Napi::Object>();
            cfg.lid.faceId = lo.Get("faceId").As<Napi::Number>().Uint32Value();
            cfg.lid.vx = lo.Has("vx") ? lo.Get("vx").As<Napi::Number>().DoubleValue() : 0.0;
            cfg.lid.vy = lo.Has("vy") ? lo.Get("vy").As<Napi::Number>().DoubleValue() : 0.0;
            cfg.lid.vz = lo.Has("vz") ? lo.Get("vz").As<Napi::Number>().DoubleValue() : 0.0;
            cfg.useLid = true;
        }
        auto r = forge::cfd::solveSteadyNS(cfg);
        auto out = Napi::Object::New(env);
        auto u = Napi::Float64Array::New(env, r.u.size()); std::copy(r.u.begin(), r.u.end(), u.Data()); out.Set("u", u);
        auto v = Napi::Float64Array::New(env, r.v.size()); std::copy(r.v.begin(), r.v.end(), v.Data()); out.Set("v", v);
        auto w = Napi::Float64Array::New(env, r.w.size()); std::copy(r.w.begin(), r.w.end(), w.Data()); out.Set("w", w);
        auto p = Napi::Float64Array::New(env, r.p.size()); std::copy(r.p.begin(), r.p.end(), p.Data()); out.Set("p", p);
        out.Set("maxVelocity", Napi::Number::New(env, r.maxVelocity));
        out.Set("reynolds",    Napi::Number::New(env, r.reynolds));
        out.Set("iterations",  Napi::Number::New(env, r.iterations));
        out.Set("finalResidual",   Napi::Number::New(env, r.finalResidual));
        out.Set("initialResidual", Napi::Number::New(env, r.initialResidual));
        out.Set("cpuMs",       Napi::Number::New(env, r.cpuMs));
        out.Set("Nx", Napi::Number::New(env, cfg.Nx));
        out.Set("Ny", Napi::Number::New(env, cfg.Ny));
        out.Set("Nz", Napi::Number::New(env, cfg.Nz));
        return out;
    });
}

// ----------------------------------------------------------- IO (Forge-21)
namespace io_bind {
std::string requirePath(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsString()) {
        throw Napi::TypeError::New(info.Env(),
            "forge.io: expected filepath string at arg " + std::to_string(idx));
    }
    return info[idx].As<Napi::String>().Utf8Value();
}
}

Napi::Value IoImportStep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importStep(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoExportStep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            forge::io::exportStep(requireHandle(info, 0), io_bind::requirePath(info, 1)));
    });
}
Napi::Value IoImportBrep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importBrep(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoExportBrep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            forge::io::exportBrep(requireHandle(info, 0), io_bind::requirePath(info, 1)));
    });
}
Napi::Value IoImportStl(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importStl(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoExportStl(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto handle = requireHandle(info, 0);
        const auto path = io_bind::requirePath(info, 1);
        const double linTol = info.Length() > 2 && info[2].IsNumber()
            ? info[2].As<Napi::Number>().DoubleValue() : 0.1;
        const double angTol = info.Length() > 3 && info[3].IsNumber()
            ? info[3].As<Napi::Number>().DoubleValue() : 0.5;
        const bool ascii = info.Length() > 4 && info[4].IsBoolean()
            ? info[4].As<Napi::Boolean>().Value() : false;
        return Napi::Boolean::New(info.Env(),
            forge::io::exportStl(handle, path, linTol, angTol, ascii));
    });
}

// Forge-34 — IGES / JT / Parasolid + PMI.
Napi::Value IoImportIges(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importIges(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoImportJt(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importJt(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoImportParasolid(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importParasolid(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoExportStepPmi(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto handle = requireHandle(info, 0);
        const auto path = io_bind::requirePath(info, 1);
        std::vector<forge::io::PmiNote> notes;
        if (info.Length() > 2 && info[2].IsArray()) {
            auto arr = info[2].As<Napi::Array>();
            notes.reserve(arr.Length());
            for (std::uint32_t i = 0; i < arr.Length(); ++i) {
                auto v = arr.Get(i);
                if (!v.IsObject()) {
                    throw Napi::TypeError::New(info.Env(),
                        "forge.io.exportStepWithPmi: notes[i] must be {text, anchorKind?, anchorId?}");
                }
                auto o = v.As<Napi::Object>();
                forge::io::PmiNote n{};
                n.text       = o.Has("text") && o.Get("text").IsString()
                               ? o.Get("text").As<Napi::String>().Utf8Value() : std::string();
                n.anchorKind = o.Has("anchorKind") && o.Get("anchorKind").IsString()
                               ? o.Get("anchorKind").As<Napi::String>().Utf8Value() : std::string();
                n.anchorId   = o.Has("anchorId") && o.Get("anchorId").IsNumber()
                               ? o.Get("anchorId").As<Napi::Number>().Uint32Value() : 0u;
                notes.push_back(std::move(n));
            }
        }
        return Napi::Boolean::New(info.Env(),
            forge::io::exportStepWithPmi(handle, path, notes));
    });
}

// ----------------------------------------------------------- direct modeling (Forge-23)
//
// JS surface — under `forge.direct`:
//   pushPullFace(handle, faceId, distance) → newHandle
//   moveFace(handle, faceId, [tx,ty,tz])    → newHandle
//   rotateFace(handle, faceId, [ox,oy,oz], [dx,dy,dz], angleRad) → newHandle
//   deleteFaceAndHeal(handle, [faceId, …])  → newHandle
//   replaceFace(handle, faceId, {kind, origin:[3], normal:[3], radius}) → newHandle
//   inferFeature(handle, faceId) → { kind, label, normal:[3], centroid:[3], area, radius }
//   faceCount(handle) → number
namespace direct_bind {

std::array<double, 3> readVec3(Napi::Env env, const Napi::Value& v, const char* what) {
    if (!v.IsArray()) {
        if (v.IsTypedArray()) {
            auto ta = v.As<Napi::Float64Array>();
            if (ta.ElementLength() != 3) {
                throw Napi::TypeError::New(env,
                    std::string("forge.direct: ") + what + " must be length 3");
            }
            return { ta.Data()[0], ta.Data()[1], ta.Data()[2] };
        }
        throw Napi::TypeError::New(env,
            std::string("forge.direct: expected array[3] for ") + what);
    }
    auto a = v.As<Napi::Array>();
    if (a.Length() != 3) {
        throw Napi::TypeError::New(env,
            std::string("forge.direct: ") + what + " must be length 3");
    }
    return { a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue(),
             a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue(),
             a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue() };
}

Napi::Array vec3ToArr(Napi::Env env, const std::array<double, 3>& v) {
    auto a = Napi::Array::New(env, 3);
    a.Set(uint32_t{0}, v[0]);
    a.Set(uint32_t{1}, v[1]);
    a.Set(uint32_t{2}, v[2]);
    return a;
}

const char* featureKindName(forge::direct::FeatureKind k) {
    switch (k) {
        case forge::direct::FeatureKind::Boss:    return "boss";
        case forge::direct::FeatureKind::Hole:    return "hole";
        case forge::direct::FeatureKind::Fillet:  return "fillet";
        case forge::direct::FeatureKind::Blend:   return "blend";
        case forge::direct::FeatureKind::Chamfer: return "chamfer";
        case forge::direct::FeatureKind::Unknown:
        default:                                  return "unknown";
    }
}
} // namespace direct_bind

Napi::Value DirectPushPullFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        const double d   = requireNumber(info, 2, "distance");
        return Napi::Number::New(info.Env(),
            forge::direct::pushPullFace(h, faceId, d));
    });
}

Napi::Value DirectMoveFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        auto t = direct_bind::readVec3(info.Env(), info[2], "translation");
        return Napi::Number::New(info.Env(),
            forge::direct::moveFace(h, faceId, t));
    });
}

Napi::Value DirectRotateFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        auto o = direct_bind::readVec3(info.Env(), info[2], "axisOrigin");
        auto d = direct_bind::readVec3(info.Env(), info[3], "axisDir");
        const double ang = requireNumber(info, 4, "angleRad");
        return Napi::Number::New(info.Env(),
            forge::direct::rotateFace(h, faceId, o, d, ang));
    });
}

Napi::Value DirectDeleteFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        if (!info[1].IsArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.direct.deleteFaceAndHeal: expected array of face ids");
        }
        auto arr = info[1].As<Napi::Array>();
        std::vector<forge::direct::FaceId> ids;
        ids.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            ids.push_back(arr.Get(i).As<Napi::Number>().Uint32Value());
        }
        return Napi::Number::New(info.Env(),
            forge::direct::deleteFaceAndHeal(h, ids));
    });
}

Napi::Value DirectReplaceFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        if (!info[2].IsObject()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.direct.replaceFace: expected SurfaceSpec object");
        }
        auto spec = info[2].As<Napi::Object>();
        forge::direct::SurfaceSpec s{};
        if (spec.Has("kind")) {
            std::string k = spec.Get("kind").As<Napi::String>();
            if      (k == "plane")    s.kind = forge::direct::SurfaceSpec::Kind::Plane;
            else if (k == "cylinder") s.kind = forge::direct::SurfaceSpec::Kind::Cylinder;
            else if (k == "sphere")   s.kind = forge::direct::SurfaceSpec::Kind::Sphere;
            else throw Napi::TypeError::New(info.Env(),
                "forge.direct.replaceFace: kind must be plane/cylinder/sphere");
        }
        if (spec.Has("origin")) s.origin = direct_bind::readVec3(info.Env(), spec.Get("origin"), "origin");
        if (spec.Has("normal")) s.normal = direct_bind::readVec3(info.Env(), spec.Get("normal"), "normal");
        if (spec.Has("radius")) s.radius = spec.Get("radius").As<Napi::Number>().DoubleValue();
        return Napi::Number::New(info.Env(),
            forge::direct::replaceFace(h, faceId, s));
    });
}

Napi::Value DirectInferFeature(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        const auto fi = forge::direct::inferFeature(h, faceId);
        auto out = Napi::Object::New(env);
        out.Set("kind",     Napi::String::New(env, direct_bind::featureKindName(fi.kind)));
        out.Set("label",    Napi::String::New(env, fi.label));
        out.Set("normal",   direct_bind::vec3ToArr(env, fi.normal));
        out.Set("centroid", direct_bind::vec3ToArr(env, fi.centroid));
        out.Set("area",     Napi::Number::New(env, fi.area));
        out.Set("radius",   Napi::Number::New(env, fi.radius));
        return out;
    });
}

Napi::Value DirectFaceCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::direct::faceCount(requireHandle(info, 0))));
    });
}

// ----------------------------------------------------------- healing (Forge-23)
namespace heal_bind {
Napi::Object sewReportToJs(Napi::Env env, const forge::heal::SewReport& r) {
    auto o = Napi::Object::New(env);
    o.Set("closedBefore",    Napi::Boolean::New(env, r.closedBefore));
    o.Set("closedAfter",     Napi::Boolean::New(env, r.closedAfter));
    o.Set("facesBefore",     Napi::Number::New(env, static_cast<double>(r.facesBefore)));
    o.Set("facesAfter",      Napi::Number::New(env, static_cast<double>(r.facesAfter)));
    o.Set("openEdgesBefore", Napi::Number::New(env, static_cast<double>(r.openEdgesBefore)));
    o.Set("openEdgesAfter",  Napi::Number::New(env, static_cast<double>(r.openEdgesAfter)));
    return o;
}
} // namespace heal_bind

Napi::Value HealSew(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        const double tol = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().DoubleValue() : 1e-3;
        auto env = info.Env();
        auto r = forge::heal::sewShape(h, tol);
        auto out = Napi::Object::New(env);
        out.Set("handle", Napi::Number::New(env, r.handle));
        out.Set("report", heal_bind::sewReportToJs(env, r.report));
        return out;
    });
}

Napi::Value HealSimplify(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        forge::heal::SimplifyOptions opts{};
        if (info.Length() > 1 && info[1].IsObject()) {
            auto o = info[1].As<Napi::Object>();
            if (o.Has("unifyFaces"))     opts.unifyFaces = o.Get("unifyFaces").As<Napi::Boolean>().Value();
            if (o.Has("unifyEdges"))     opts.unifyEdges = o.Get("unifyEdges").As<Napi::Boolean>().Value();
            if (o.Has("concatBSplines")) opts.concatBSplines = o.Get("concatBSplines").As<Napi::Boolean>().Value();
            if (o.Has("angularTol"))     opts.angularTol = o.Get("angularTol").As<Napi::Number>().DoubleValue();
        }
        auto env = info.Env();
        auto r = forge::heal::simplifyShape(h, opts);
        auto out = Napi::Object::New(env);
        out.Set("handle",      Napi::Number::New(env, r.handle));
        out.Set("facesBefore", Napi::Number::New(env, static_cast<double>(r.facesBefore)));
        out.Set("facesAfter",  Napi::Number::New(env, static_cast<double>(r.facesAfter)));
        out.Set("edgesBefore", Napi::Number::New(env, static_cast<double>(r.edgesBefore)));
        out.Set("edgesAfter",  Napi::Number::New(env, static_cast<double>(r.edgesAfter)));
        return out;
    });
}

Napi::Value HealAutoFill(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        const double tol = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().DoubleValue() : 1e-3;
        auto env = info.Env();
        auto r = forge::heal::autoFillMissingFaces(h, tol);
        auto out = Napi::Object::New(env);
        out.Set("handle", Napi::Number::New(env, r.handle));
        auto rep = Napi::Object::New(env);
        rep.Set("facesAdded",      Napi::Number::New(env, static_cast<double>(r.report.facesAdded)));
        rep.Set("closedAfter",     Napi::Boolean::New(env, r.report.closedAfter));
        rep.Set("openEdgesBefore", Napi::Number::New(env, static_cast<double>(r.report.openEdgesBefore)));
        rep.Set("openEdgesAfter",  Napi::Number::New(env, static_cast<double>(r.report.openEdgesAfter)));
        out.Set("report", rep);
        return out;
    });
}

Napi::Value HealAutoRepair(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        const double tol = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().DoubleValue() : 1e-3;
        auto env = info.Env();
        auto r = forge::heal::autoRepairSelfIntersection(h, tol);
        auto out = Napi::Object::New(env);
        out.Set("handle", Napi::Number::New(env, r.handle));
        auto rep = Napi::Object::New(env);
        rep.Set("fixedTolerance",        Napi::Boolean::New(env, r.report.fixedTolerance));
        rep.Set("fixedSelfIntersection", Napi::Boolean::New(env, r.report.fixedSelfIntersection));
        rep.Set("fixedSmallFaces",       Napi::Boolean::New(env, r.report.fixedSmallFaces));
        rep.Set("fixedOrientation",      Napi::Boolean::New(env, r.report.fixedOrientation));
        rep.Set("fixedWires",            Napi::Boolean::New(env, r.report.fixedWires));
        rep.Set("fixersFired",           Napi::Number::New(env, static_cast<double>(r.report.fixersFired)));
        out.Set("report", rep);
        return out;
    });
}

Napi::Value HealHarmonizeNormals(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::heal::harmonizeNormals(requireHandle(info, 0)));
    });
}

Napi::Value HealCheckValidity(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto r = forge::heal::checkValidity(requireHandle(info, 0));
        auto out = Napi::Object::New(env);
        out.Set("isClosed",           Napi::Boolean::New(env, r.isClosed));
        out.Set("isManifold",         Napi::Boolean::New(env, r.isManifold));
        out.Set("isOriented",         Napi::Boolean::New(env, r.isOriented));
        out.Set("hasSelfIntersect",   Napi::Boolean::New(env, r.hasSelfIntersect));
        out.Set("hasNonManifoldEdge", Napi::Boolean::New(env, r.hasNonManifoldEdge));
        auto bf = Napi::Uint32Array::New(env, r.badFaces.size());
        std::copy(r.badFaces.begin(), r.badFaces.end(), bf.Data());
        out.Set("badFaces", bf);
        auto be = Napi::Uint32Array::New(env, r.badEdges.size());
        std::copy(r.badEdges.begin(), r.badEdges.end(), be.Data());
        out.Set("badEdges", be);
        return out;
    });
}

// ----------------------------------------------------------- part features (Forge-22)
namespace part_bind {

std::vector<double> readVec3(const Napi::CallbackInfo& info, std::size_t idx, const char* what) {
    auto env = info.Env();
    if (info.Length() <= idx) {
        throw Napi::TypeError::New(env,
            std::string("forge.part: missing ") + what + " (vec3)");
    }
    auto v = info[idx];
    if (v.IsTypedArray()) {
        auto a = v.As<Napi::Float64Array>();
        if (a.ElementLength() != 3) {
            throw Napi::TypeError::New(env,
                std::string("forge.part: ") + what + " must have 3 elements");
        }
        return {a.Data()[0], a.Data()[1], a.Data()[2]};
    }
    if (v.IsArray()) {
        auto a = v.As<Napi::Array>();
        if (a.Length() != 3) {
            throw Napi::TypeError::New(env,
                std::string("forge.part: ") + what + " must have 3 elements");
        }
        return {a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue(),
                a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue(),
                a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue()};
    }
    throw Napi::TypeError::New(env,
        std::string("forge.part: ") + what + " must be Float64Array[3] or Array[3]");
}

std::vector<std::uint32_t> readU32Array(const Napi::CallbackInfo& info, std::size_t idx, const char* what) {
    auto env = info.Env();
    std::vector<std::uint32_t> out;
    if (info.Length() <= idx) return out;
    auto v = info[idx];
    if (v.IsNull() || v.IsUndefined()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env,
            std::string("forge.part: ") + what + " must be an array of numbers");
    }
    auto a = v.As<Napi::Array>();
    out.reserve(a.Length());
    for (uint32_t i = 0; i < a.Length(); ++i) {
        out.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
    }
    return out;
}

} // namespace part_bind

// ----------------------------------------------------------- sheet metal (Forge-24)
//
// JS surface — under `forge.sheetMetal`:
//   baseFlange(wireHandle, params)                 → handle
//   edgeFlange(handle, edgeId, params, len, ang, mode) → handle
//   miterFlange(handle, edgeIds[], params, len, ang)   → handle
//   hem(handle, edgeId, params, hemType, length)       → handle
//   sketchedBend(handle, lineHandle, params, ang, r)   → handle
//   jog(handle, edgeId, params, height, ang)           → handle
//   closedCorner(handle, vertexId, params, gap)        → handle
//   cornerRelief(handle, vertexId, params, mode, sz)   → handle
//   unfold(handle, params)                             → handle
//   flatPattern(handle, params)
//      → { wire, bbox: [minX,minY,maxX,maxY], formedHeight }
//   bends(handle) → [{ angleRad, radius, length, devLength, x0,y0,x1,y1 }, ...]
namespace sheet_bind {

forge::sheet::SheetMetalParams readParams(const Napi::Env& env, const Napi::Value& v) {
    forge::sheet::SheetMetalParams p{};
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.sheetMetal: params must be an object");
    }
    auto obj = v.As<Napi::Object>();
    auto numOr = [&](const char* k, double def) {
        if (!obj.Has(k) || !obj.Get(k).IsNumber()) return def;
        return obj.Get(k).As<Napi::Number>().DoubleValue();
    };
    p.thickness     = numOr("thickness", 1.0);
    p.kFactor       = numOr("kFactor",   0.44);
    p.minBendRadius = numOr("minBendRadius", 0.5);
    return p;
}

std::vector<std::uint32_t> readU32Array(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.sheetMetal: expected uint32 array");
    }
    std::vector<std::uint32_t> out;
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (std::uint32_t i = 0; i < arr.Length(); ++i) {
        out.push_back(arr.Get(i).As<Napi::Number>().Uint32Value());
    }
    return out;
}

}  // namespace part_bind

Napi::Value PartExtrudeProfile(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sk = requireHandle(info, 0);
        double dist = requireNumber(info, 1, "distance");
        auto d = part_bind::readVec3(info, 2, "direction");
        return Napi::Number::New(info.Env(),
            forge::part::extrudeProfile(sk, dist, d[0], d[1], d[2]));
    });
}

Napi::Value PartRevolveProfile(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sk = requireHandle(info, 0);
        auto o = part_bind::readVec3(info, 1, "axisOrigin");
        auto d = part_bind::readVec3(info, 2, "axisDir");
        double ang = requireNumber(info, 3, "angleRad");
        return Napi::Number::New(info.Env(),
            forge::part::revolveProfile(sk, o[0], o[1], o[2], d[0], d[1], d[2], ang));
    });
}

Napi::Value PartSweep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto prof = requireHandle(info, 0);
        auto path = requireHandle(info, 1);
        bool wg = info.Length() > 2 && info[2].IsBoolean()
                      ? info[2].As<Napi::Boolean>().Value() : false;
        return Napi::Number::New(info.Env(), forge::part::sweep(prof, path, wg));
    });
}

Napi::Value PartLoft(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsArray()) {
            throw Napi::TypeError::New(env, "forge.part.loft: sections must be array of handles");
        }
        std::vector<forge::SketchHandle> sections;
        auto a = info[0].As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            sections.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
        }
        std::vector<forge::SketchHandle> guides;
        if (info.Length() > 1 && info[1].IsArray()) {
            auto g = info[1].As<Napi::Array>();
            for (uint32_t i = 0; i < g.Length(); ++i) {
                guides.push_back(g.Get(i).As<Napi::Number>().Uint32Value());
            }
        }
        bool ruled  = info.Length() > 2 && info[2].IsBoolean() ? info[2].As<Napi::Boolean>().Value() : false;
        bool closed = info.Length() > 3 && info[3].IsBoolean() ? info[3].As<Napi::Boolean>().Value() : false;
        return Napi::Number::New(env, forge::part::loft(sections, guides, ruled, closed));
    });
}

Napi::Value PartShell(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto faces = part_bind::readU32Array(info, 1, "faceIdsToRemove");
        double t = requireNumber(info, 2, "thickness");
        std::vector<forge::part::FaceThickness> mt;
        if (info.Length() > 3 && info[3].IsArray()) {
            auto a = info[3].As<Napi::Array>();
            mt.reserve(a.Length());
            for (uint32_t i = 0; i < a.Length(); ++i) {
                auto o = a.Get(i).As<Napi::Object>();
                forge::part::FaceThickness ft{};
                ft.faceId    = o.Get("faceId").As<Napi::Number>().Uint32Value();
                ft.thickness = o.Get("thickness").As<Napi::Number>().DoubleValue();
                mt.push_back(ft);
            }
        }
        return Napi::Number::New(info.Env(), forge::part::shell(h, faces, t, mt));
    });
}

Napi::Value PartFilletEdges(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto edges = part_bind::readU32Array(info, 1, "edgeIds");
        double r = requireNumber(info, 2, "radius");
        return Napi::Number::New(info.Env(), forge::part::filletEdges(h, edges, r));
    });
}

Napi::Value PartVariableFillet(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        auto e = requireHandle(info, 1);
        if (info.Length() < 3 || !info[2].IsArray()) {
            throw Napi::TypeError::New(env,
                "forge.part.variableFilletEdge: anchorRadii must be array of {u,r}");
        }
        auto a = info[2].As<Napi::Array>();
        std::vector<forge::part::VariableRadiusAnchor> anchors;
        anchors.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i) {
            auto o = a.Get(i).As<Napi::Object>();
            forge::part::VariableRadiusAnchor ar{};
            ar.u = o.Get("u").As<Napi::Number>().DoubleValue();
            ar.r = o.Get("r").As<Napi::Number>().DoubleValue();
            anchors.push_back(ar);
        }
        return Napi::Number::New(env, forge::part::variableFilletEdge(h, e, anchors));
    });
}

Napi::Value PartChamferEdges(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto edges = part_bind::readU32Array(info, 1, "edgeIds");
        double d = requireNumber(info, 2, "distance");
        double d2 = info.Length() > 3 && info[3].IsNumber()
                       ? info[3].As<Napi::Number>().DoubleValue() : -1.0;
        return Napi::Number::New(info.Env(), forge::part::chamferEdges(h, edges, d, d2));
    });
}

Napi::Value PartDraftFaces(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.part.draftFaces: neutralPlane must be {origin, normal}");
        }
        auto pl = info[1].As<Napi::Object>();
        forge::part::DraftPlane plane{};
        auto o = pl.Get("origin");
        auto n = pl.Get("normal");
        auto rdV = [&](Napi::Value v, double* out) {
            if (v.IsTypedArray()) {
                auto a = v.As<Napi::Float64Array>();
                if (a.ElementLength() != 3) {
                    throw Napi::TypeError::New(env, "forge.part.draftFaces: vec3 expected");
                }
                out[0] = a.Data()[0]; out[1] = a.Data()[1]; out[2] = a.Data()[2];
            } else if (v.IsArray()) {
                auto a = v.As<Napi::Array>();
                if (a.Length() != 3) {
                    throw Napi::TypeError::New(env, "forge.part.draftFaces: vec3 expected");
                }
                out[0] = a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
                out[1] = a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
                out[2] = a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
            } else {
                throw Napi::TypeError::New(env, "forge.part.draftFaces: vec3 expected");
            }
        };
        double oo[3], nn[3];
        rdV(o, oo); rdV(n, nn);
        plane.ox = oo[0]; plane.oy = oo[1]; plane.oz = oo[2];
        plane.nx = nn[0]; plane.ny = nn[1]; plane.nz = nn[2];
        auto faces = part_bind::readU32Array(info, 2, "faceIds");
        double ang = requireNumber(info, 3, "angleRad");
        return Napi::Number::New(env, forge::part::draftFaces(h, plane, faces, ang));
    });
}

Napi::Value PartHoleWizard(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        auto p = part_bind::readVec3(info, 1, "position");
        auto a = part_bind::readVec3(info, 2, "axis");
        if (info.Length() < 4 || !info[3].IsString()) {
            throw Napi::TypeError::New(env,
                "forge.part.holeWizard: type must be 'simple'|'counterbore'|'countersink'|'tapped'");
        }
        std::string t = info[3].As<Napi::String>().Utf8Value();
        std::uint32_t kind = 0;
        if      (t == "simple")      kind = 0;
        else if (t == "counterbore") kind = 1;
        else if (t == "countersink") kind = 2;
        else if (t == "tapped")      kind = 3;
        else throw Napi::TypeError::New(env, "forge.part.holeWizard: unknown type '" + t + "'");
        forge::part::HoleSpec spec{};
        if (info.Length() > 4 && info[4].IsObject()) {
            auto so = info[4].As<Napi::Object>();
            auto rd = [&](const char* k, double& dst) {
                if (so.Has(k) && so.Get(k).IsNumber()) {
                    dst = so.Get(k).As<Napi::Number>().DoubleValue();
                }
            };
            rd("diameter",     spec.diameter);
            rd("depth",        spec.depth);
            rd("headDiameter", spec.headDiameter);
            rd("headDepth",    spec.headDepth);
            rd("headAngle",    spec.headAngle);
            rd("tappedPitch",  spec.tappedPitch);
        }
        return Napi::Number::New(env,
            forge::part::holeWizard(h, p[0], p[1], p[2], a[0], a[1], a[2], kind, spec));
    });
}

Napi::Value PartRib(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sk = requireHandle(info, 0);
        double depth = requireNumber(info, 1, "depth");
        double thk   = requireNumber(info, 2, "thickness");
        std::uint32_t neutral = info.Length() > 3 && info[3].IsNumber()
                                    ? info[3].As<Napi::Number>().Uint32Value() : 0u;
        return Napi::Number::New(info.Env(), forge::part::rib(sk, depth, thk, neutral));
    });
}

Napi::Value PartLinearPattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto n = requireHandle(info, 1);
        double dx = requireNumber(info, 2, "dx");
        double dy = requireNumber(info, 3, "dy");
        double dz = requireNumber(info, 4, "dz");
        return Napi::Number::New(info.Env(), forge::part::linearPattern(h, n, dx, dy, dz));
    });
}

Napi::Value PartCircularPattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto n = requireHandle(info, 1);
        auto o = part_bind::readVec3(info, 2, "axisOrigin");
        auto d = part_bind::readVec3(info, 3, "axisDir");
        double ang = requireNumber(info, 4, "totalAngleRad");
        return Napi::Number::New(info.Env(),
            forge::part::circularPattern(h, n, o[0], o[1], o[2], d[0], d[1], d[2], ang));
    });
}

Napi::Value PartMirrorPattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.part.mirrorPattern: plane must be {origin, normal}");
        }
        auto pl = info[1].As<Napi::Object>();
        auto rdV = [&](Napi::Value v, double* out) {
            if (v.IsTypedArray()) {
                auto a = v.As<Napi::Float64Array>();
                out[0] = a.Data()[0]; out[1] = a.Data()[1]; out[2] = a.Data()[2];
            } else if (v.IsArray()) {
                auto a = v.As<Napi::Array>();
                out[0] = a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
                out[1] = a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
                out[2] = a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
            } else {
                throw Napi::TypeError::New(env, "forge.part.mirrorPattern: vec3 expected");
            }
        };
        double oo[3], nn[3];
        rdV(pl.Get("origin"), oo);
        rdV(pl.Get("normal"), nn);
        return Napi::Number::New(env,
            forge::part::mirrorPattern(h, oo[0], oo[1], oo[2], nn[0], nn[1], nn[2]));
    });
}

Napi::Value PartOnCurvePattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto sk = requireHandle(info, 1);
        auto n = requireHandle(info, 2);
        return Napi::Number::New(info.Env(), forge::part::onCurvePattern(h, sk, n));
    });
}

Napi::Value SmMakeWireRect(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        double w = requireNumber(info, 0, "w");
        double h = requireNumber(info, 1, "h");
        return Napi::Number::New(info.Env(), forge::sheet::makeWireRect(w, h));
    });
}
Napi::Value SmMakeLineEdge(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        double x0 = requireNumber(info, 0, "x0");
        double y0 = requireNumber(info, 1, "y0");
        double z0 = requireNumber(info, 2, "z0");
        double x1 = requireNumber(info, 3, "x1");
        double y1 = requireNumber(info, 4, "y1");
        double z1 = requireNumber(info, 5, "z1");
        return Napi::Number::New(info.Env(),
            forge::sheet::makeLineEdge(x0, y0, z0, x1, y1, z1));
    });
}
Napi::Value SmBaseFlange(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto wire = requireHandle(info, 0);
        auto params = sheet_bind::readParams(info.Env(), info[1]);
        return Napi::Number::New(info.Env(), forge::sheet::baseFlange(wire, params));
    });
}
Napi::Value SmEdgeFlange(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh = requireHandle(info, 0);
        auto eid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double len = requireNumber(info, 3, "flangeLengthMm");
        double ang = requireNumber(info, 4, "angleRad");
        forge::sheet::ReliefMode mode = forge::sheet::ReliefMode::Rect;
        if (info.Length() > 5 && info[5].IsString()) {
            std::string s = info[5].As<Napi::String>();
            if      (s == "rect")    mode = forge::sheet::ReliefMode::Rect;
            else if (s == "obround") mode = forge::sheet::ReliefMode::Obround;
            else if (s == "tear")    mode = forge::sheet::ReliefMode::Tear;
        }
        return Napi::Number::New(info.Env(),
            forge::sheet::edgeFlange(sh, eid, params, len, ang, mode));
    });
}
Napi::Value SmMiterFlange(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto ids = sheet_bind::readU32Array(info.Env(), info[1]);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double len = requireNumber(info, 3, "flangeLengthMm");
        double ang = requireNumber(info, 4, "angleRad");
        return Napi::Number::New(info.Env(),
            forge::sheet::miterFlange(sh, ids, params, len, ang));
    });
}
Napi::Value SmHem(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto eid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        forge::sheet::HemType ht = forge::sheet::HemType::Closed;
        if (info[3].IsString()) {
            std::string s = info[3].As<Napi::String>();
            if      (s == "closed")    ht = forge::sheet::HemType::Closed;
            else if (s == "open")      ht = forge::sheet::HemType::Open;
            else if (s == "tear-drop") ht = forge::sheet::HemType::TearDrop;
            else if (s == "rolled")    ht = forge::sheet::HemType::Rolled;
        }
        double len = requireNumber(info, 4, "length");
        return Napi::Number::New(info.Env(),
            forge::sheet::hem(sh, eid, params, ht, len));
    });
}
Napi::Value SmSketchedBend(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh   = requireHandle(info, 0);
        auto line = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double ang = requireNumber(info, 3, "bendAngleRad");
        double r   = requireNumber(info, 4, "bendRadius");
        return Napi::Number::New(info.Env(),
            forge::sheet::sketchedBend(sh, line, params, ang, r));
    });
}
Napi::Value SmJog(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto eid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double height = requireNumber(info, 3, "jogHeight");
        double ang    = requireNumber(info, 4, "angleRad");
        return Napi::Number::New(info.Env(),
            forge::sheet::jog(sh, eid, params, height, ang));
    });
}
Napi::Value SmClosedCorner(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto vid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double gap = requireNumber(info, 3, "gapMm");
        return Napi::Number::New(info.Env(),
            forge::sheet::closedCorner(sh, vid, params, gap));
    });
}
Napi::Value SmCornerRelief(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto vid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        forge::sheet::CornerRelief mode = forge::sheet::CornerRelief::Circular;
        if (info[3].IsString()) {
            std::string s = info[3].As<Napi::String>();
            if      (s == "circular")    mode = forge::sheet::CornerRelief::Circular;
            else if (s == "oval")        mode = forge::sheet::CornerRelief::Oval;
            else if (s == "rectangular") mode = forge::sheet::CornerRelief::Rectangular;
        }
        double sz = requireNumber(info, 4, "sizeMm");
        return Napi::Number::New(info.Env(),
            forge::sheet::cornerRelief(sh, vid, params, mode, sz));
    });
}
Napi::Value SmUnfold(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh = requireHandle(info, 0);
        auto params = sheet_bind::readParams(info.Env(), info[1]);
        return Napi::Number::New(info.Env(), forge::sheet::unfold(sh, params));
    });
}
Napi::Value SmFlatPattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh = requireHandle(info, 0);
        auto params = sheet_bind::readParams(info.Env(), info[1]);
        auto fp = forge::sheet::flatPattern(sh, params);
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("wire", Napi::Number::New(env, fp.wire));
        auto bbox = Napi::Array::New(env, 4);
        bbox.Set(uint32_t{0}, fp.minX);
        bbox.Set(uint32_t{1}, fp.minY);
        bbox.Set(uint32_t{2}, fp.maxX);
        bbox.Set(uint32_t{3}, fp.maxY);
        out.Set("bbox", bbox);
        out.Set("formedHeight", Napi::Number::New(env, fp.formedHeight));
        return out;
    });
}
Napi::Value SmBends(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh = requireHandle(info, 0);
        auto env = info.Env();
        if (!forge::sheet::SheetMetalRegistry::instance().has(sh)) {
            return Napi::Array::New(env, 0);
        }
        const auto& p = forge::sheet::SheetMetalRegistry::instance().cget(sh);
        auto arr = Napi::Array::New(env, p.bends.size());
        for (std::size_t i = 0; i < p.bends.size(); ++i) {
            const auto& b = p.bends[i];
            auto o = Napi::Object::New(env);
            o.Set("angleRad",  Napi::Number::New(env, b.angleRad));
            o.Set("radius",    Napi::Number::New(env, b.radius));
            o.Set("length",    Napi::Number::New(env, b.length));
            o.Set("devLength", Napi::Number::New(env, b.devLength));
            o.Set("x0", Napi::Number::New(env, b.x0));
            o.Set("y0", Napi::Number::New(env, b.y0));
            o.Set("x1", Napi::Number::New(env, b.x1));
            o.Set("y1", Napi::Number::New(env, b.y1));
            arr.Set(static_cast<std::uint32_t>(i), o);
        }
        return arr;
    });
}

// ----------------------------------------------------------- weldments (Forge-24)
namespace weld_bind {

forge::weld::ProfileKind parseProfileKind(const Napi::Env& env, const std::string& s) {
    if (s == "IBeam")     return forge::weld::ProfileKind::IBeam;
    if (s == "CBeam")     return forge::weld::ProfileKind::CBeam;
    if (s == "RectTube")  return forge::weld::ProfileKind::RectTube;
    if (s == "RoundTube") return forge::weld::ProfileKind::RoundTube;
    if (s == "Angle")     return forge::weld::ProfileKind::Angle;
    if (s == "Channel")   return forge::weld::ProfileKind::Channel;
    if (s == "FlatBar")   return forge::weld::ProfileKind::FlatBar;
    throw Napi::TypeError::New(env, "forge.weldments: unknown profile kind '" + s + "'");
}

forge::weld::Alignment parseAlignment(const std::string& s) {
    if (s == "centroid")     return forge::weld::Alignment::Centroid;
    if (s == "top-left")     return forge::weld::Alignment::TopLeft;
    if (s == "top-right")    return forge::weld::Alignment::TopRight;
    if (s == "bottom-left")  return forge::weld::Alignment::BottomLeft;
    if (s == "bottom-right") return forge::weld::Alignment::BottomRight;
    if (s == "mid-left")     return forge::weld::Alignment::MidLeft;
    if (s == "mid-right")    return forge::weld::Alignment::MidRight;
    if (s == "top-center")   return forge::weld::Alignment::TopCenter;
    if (s == "bottom-center")return forge::weld::Alignment::BottomCenter;
    return forge::weld::Alignment::Centroid;
}

forge::weld::StructuralProfile readProfile(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.weldments: profile must be an object");
    }
    auto obj = v.As<Napi::Object>();
    forge::weld::StructuralProfile p{};
    if (obj.Has("kind")) {
        auto kv = obj.Get("kind");
        if (kv.IsString()) p.kind = parseProfileKind(env, kv.As<Napi::String>());
        else if (kv.IsNumber()) p.kind = static_cast<forge::weld::ProfileKind>(kv.As<Napi::Number>().Uint32Value());
    }
    if (obj.Has("name") && obj.Get("name").IsString()) {
        p.name = obj.Get("name").As<Napi::String>().Utf8Value();
    }
    if (obj.Has("dims") && obj.Get("dims").IsObject()) {
        auto d = obj.Get("dims").As<Napi::Object>();
        auto keys = d.GetPropertyNames();
        for (std::uint32_t i = 0; i < keys.Length(); ++i) {
            std::string k = keys.Get(i).As<Napi::String>().Utf8Value();
            p.dims[k] = d.Get(k).As<Napi::Number>().DoubleValue();
        }
    }
    return p;
}

forge::weld::TrimMode parseTrimMode(const std::string& s) {
    if (s == "butt")  return forge::weld::TrimMode::Butt;
    if (s == "miter") return forge::weld::TrimMode::Miter;
    if (s == "coped") return forge::weld::TrimMode::Coped;
    return forge::weld::TrimMode::Butt;
}

forge::weld::BeadKind parseBeadKind(const std::string& s) {
    if (s == "fillet")        return forge::weld::BeadKind::Fillet;
    if (s == "square-groove") return forge::weld::BeadKind::SquareGroove;
    if (s == "V-groove")      return forge::weld::BeadKind::VGroove;
    return forge::weld::BeadKind::Fillet;
}

std::vector<std::uint32_t> readU32Array(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.weldments: expected uint32 array");
    }
    std::vector<std::uint32_t> out;
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (std::uint32_t i = 0; i < arr.Length(); ++i) {
        out.push_back(arr.Get(i).As<Napi::Number>().Uint32Value());
    }
    return out;
}

} // namespace weld_bind

Napi::Value WdMakePathEdge(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        double x0 = requireNumber(info, 0, "x0");
        double y0 = requireNumber(info, 1, "y0");
        double z0 = requireNumber(info, 2, "z0");
        double x1 = requireNumber(info, 3, "x1");
        double y1 = requireNumber(info, 4, "y1");
        double z1 = requireNumber(info, 5, "z1");
        return Napi::Number::New(info.Env(),
            forge::weld::makePathEdge(x0, y0, z0, x1, y1, z1));
    });
}
Napi::Value WdStructuralMember(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto path = requireHandle(info, 0);
        auto profile = weld_bind::readProfile(info.Env(), info[1]);
        forge::weld::Alignment align = forge::weld::Alignment::Centroid;
        if (info.Length() > 2 && info[2].IsString()) {
            align = weld_bind::parseAlignment(info[2].As<Napi::String>().Utf8Value());
        }
        return Napi::Number::New(info.Env(),
            forge::weld::structuralMember(path, profile, align));
    });
}
Napi::Value WdEndCap(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto eid = requireHandle(info, 1);
        double thk = requireNumber(info, 2, "capThickness");
        double off = info.Length() > 3 && info[3].IsNumber()
                       ? info[3].As<Napi::Number>().DoubleValue() : 0.0;
        return Napi::Number::New(info.Env(),
            forge::weld::endCap(sh, eid, thk, off));
    });
}
Napi::Value WdGusset(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto vid = requireHandle(info, 1);
        double sz = requireNumber(info, 2, "gussetSize");
        double th = requireNumber(info, 3, "thickness");
        return Napi::Number::New(info.Env(),
            forge::weld::gusset(sh, vid, sz, th));
    });
}
Napi::Value WdWeldBead(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto ids = weld_bind::readU32Array(info.Env(), info[1]);
        double size = requireNumber(info, 2, "beadSize");
        forge::weld::BeadKind kind = forge::weld::BeadKind::Fillet;
        if (info.Length() > 3 && info[3].IsString()) {
            kind = weld_bind::parseBeadKind(info[3].As<Napi::String>().Utf8Value());
        }
        return Napi::Number::New(info.Env(),
            forge::weld::weldBead(sh, ids, size, kind));
    });
}
Napi::Value WdTrimMember(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto a = requireHandle(info, 0);
        auto b = requireHandle(info, 1);
        forge::weld::TrimMode mode = forge::weld::TrimMode::Butt;
        if (info.Length() > 2 && info[2].IsString()) {
            mode = weld_bind::parseTrimMode(info[2].As<Napi::String>().Utf8Value());
        }
        return Napi::Number::New(info.Env(),
            forge::weld::trimMember(a, b, mode));
    });
}
Napi::Value WdCutList(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1) {
            throw Napi::TypeError::New(env, "forge.weldments.cutList: expected handle or handle array");
        }
        std::vector<forge::weld::MemberRecord> records;
        if (info[0].IsArray()) {
            auto arr = info[0].As<Napi::Array>();
            for (std::uint32_t i = 0; i < arr.Length(); ++i) {
                auto h = arr.Get(i).As<Napi::Number>().Uint32Value();
                auto recs = forge::weld::cutList(h);
                records.insert(records.end(), recs.begin(), recs.end());
            }
        } else {
            auto h = info[0].As<Napi::Number>().Uint32Value();
            records = forge::weld::cutList(h);
        }
        auto out = Napi::Array::New(env, records.size());
        for (std::size_t i = 0; i < records.size(); ++i) {
            const auto& r = records[i];
            auto o = Napi::Object::New(env);
            o.Set("memberId",    Napi::Number::New(env, r.memberId));
            o.Set("profileName", Napi::String::New(env, r.profileName));
            o.Set("length",      Napi::Number::New(env, r.length));
            o.Set("qty",         Napi::Number::New(env, r.qty));
            o.Set("weight",      Napi::Number::New(env, r.weight));
            std::string trim = "butt";
            if (r.trim == forge::weld::TrimMode::Miter) trim = "miter";
            else if (r.trim == forge::weld::TrimMode::Coped) trim = "coped";
            o.Set("trim",     Napi::String::New(env, trim));
            o.Set("miterDeg", Napi::Number::New(env, r.miterDeg));
            out.Set(static_cast<std::uint32_t>(i), o);
        }
        return out;
    });
}

// ----------------------------------------------------------- part features (Forge-36 closures)
//
// sweepWithGuides / loftWithGuides / shellMultiThickness — the three
// closures for §1's "Sweep with guides", "Loft with guides", and
// "Shell (multi-thickness)" partial rows.
Napi::Value PartSweepWithGuides(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto prof = requireHandle(info, 0);
        auto path = requireHandle(info, 1);
        std::vector<forge::SketchHandle> guides;
        if (info.Length() > 2 && info[2].IsArray()) {
            auto a = info[2].As<Napi::Array>();
            for (uint32_t i = 0; i < a.Length(); ++i) {
                guides.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
            }
        }
        return Napi::Number::New(env, forge::part::sweepWithGuides(prof, path, guides));
    });
}

Napi::Value PartLoftWithGuides(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsArray()) {
            throw Napi::TypeError::New(env,
                "forge.part.loftWithGuides: sections must be array of handles");
        }
        std::vector<forge::SketchHandle> sections;
        auto a = info[0].As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            sections.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
        }
        std::vector<forge::SketchHandle> guides;
        if (info.Length() > 1 && info[1].IsArray()) {
            auto g = info[1].As<Napi::Array>();
            for (uint32_t i = 0; i < g.Length(); ++i) {
                guides.push_back(g.Get(i).As<Napi::Number>().Uint32Value());
            }
        }
        bool ruled  = info.Length() > 2 && info[2].IsBoolean() ? info[2].As<Napi::Boolean>().Value() : false;
        bool closed = info.Length() > 3 && info[3].IsBoolean() ? info[3].As<Napi::Boolean>().Value() : false;
        return Napi::Number::New(env,
            forge::part::loftWithGuides(sections, guides, ruled, closed));
    });
}

Napi::Value PartShellMultiThickness(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        auto faces = part_bind::readU32Array(info, 1, "faceIdsToRemove");
        double t = requireNumber(info, 2, "baseThickness");
        std::vector<forge::part::FaceThickness> overrides;
        if (info.Length() > 3 && info[3].IsArray()) {
            auto a = info[3].As<Napi::Array>();
            overrides.reserve(a.Length());
            for (uint32_t i = 0; i < a.Length(); ++i) {
                auto o = a.Get(i).As<Napi::Object>();
                forge::part::FaceThickness ft{};
                ft.faceId    = o.Get("faceId").As<Napi::Number>().Uint32Value();
                ft.thickness = o.Get("thickness").As<Napi::Number>().DoubleValue();
                overrides.push_back(ft);
            }
        }
        return Napi::Number::New(env,
            forge::part::shellMultiThickness(h, faces, t, overrides));
    });
}

// ----------------------------------------------------------- NURBS surfacing (Forge-36)
//
// JS surface — under `forge.surfacing`:
//   buildPatch({ uCount, vCount, xyz: Float64Array }, uDegree?, vDegree?, uKnots?, vKnots?) → handle
//   trim(face, uvFlatArray) → handle
//   sew([face, …], tolerance?) → handle
//   refine(face, uTimes, vTimes) → handle
//   eval(face, u, v) → { point, du, dv, normal, gaussian, mean }
//   intersect(faceA, faceB) → handle
//   projectPoint(face, [px, py, pz]) → { uv, point, distance }
//   classAAnalyse(face, samples?) → { minK, maxK, avgK, isophoteCount }
namespace surf_bind {

forge::surfacing::ControlGrid readControlGrid(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env,
            "forge.surfacing: control grid must be { uCount, vCount, xyz }");
    }
    auto obj = v.As<Napi::Object>();
    forge::surfacing::ControlGrid g{};
    g.uCount = obj.Get("uCount").As<Napi::Number>().Uint32Value();
    g.vCount = obj.Get("vCount").As<Napi::Number>().Uint32Value();
    auto xyz = obj.Get("xyz");
    if (!xyz.IsTypedArray()) {
        throw Napi::TypeError::New(env,
            "forge.surfacing: control grid .xyz must be a Float64Array");
    }
    auto ta = xyz.As<Napi::Float64Array>();
    g.xyz.assign(ta.Data(), ta.Data() + ta.ElementLength());
    return g;
}

std::vector<double> readF64Array(const Napi::Env& env, const Napi::Value& v) {
    std::vector<double> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (v.IsTypedArray()) {
        auto ta = v.As<Napi::Float64Array>();
        out.assign(ta.Data(), ta.Data() + ta.ElementLength());
        return out;
    }
    if (v.IsArray()) {
        auto a = v.As<Napi::Array>();
        out.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i) {
            out.push_back(a.Get(i).As<Napi::Number>().DoubleValue());
        }
        return out;
    }
    throw Napi::TypeError::New(env, "forge.surfacing: expected Float64Array or Array of numbers");
}

Napi::Array vec3ToArr(Napi::Env env, const std::array<double, 3>& v) {
    auto a = Napi::Array::New(env, 3);
    a.Set(uint32_t{0}, v[0]);
    a.Set(uint32_t{1}, v[1]);
    a.Set(uint32_t{2}, v[2]);
    return a;
}

} // namespace surf_bind

Napi::Value SurfBuildPatch(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto grid = surf_bind::readControlGrid(env, info[0]);
        std::uint32_t uDeg = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().Uint32Value() : 3;
        std::uint32_t vDeg = (info.Length() > 2 && info[2].IsNumber())
            ? info[2].As<Napi::Number>().Uint32Value() : 3;
        auto uKnots = surf_bind::readF64Array(env, info.Length() > 3 ? info[3] : env.Undefined());
        auto vKnots = surf_bind::readF64Array(env, info.Length() > 4 ? info[4] : env.Undefined());
        return Napi::Number::New(env,
            forge::surfacing::buildNurbsPatch(grid, uDeg, vDeg, uKnots, vKnots));
    });
}

Napi::Value SurfTrim(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        auto uv = surf_bind::readF64Array(env, info[1]);
        return Napi::Number::New(env, forge::surfacing::trimNurbsFace(h, uv));
    });
}

Napi::Value SurfSew(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsArray()) {
            throw Napi::TypeError::New(env, "forge.surfacing.sew: expected handle array");
        }
        auto a = info[0].As<Napi::Array>();
        std::vector<forge::ShapeHandle> handles;
        handles.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i) {
            handles.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
        }
        double tol = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().DoubleValue() : 1e-3;
        return Napi::Number::New(env, forge::surfacing::sewNurbsFaces(handles, tol));
    });
}

Napi::Value SurfRefine(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        std::uint32_t uTimes = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().Uint32Value() : 0;
        std::uint32_t vTimes = info.Length() > 2 && info[2].IsNumber()
            ? info[2].As<Napi::Number>().Uint32Value() : 0;
        return Napi::Number::New(info.Env(), forge::surfacing::refineNurbs(h, uTimes, vTimes));
    });
}

Napi::Value SurfEval(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        double u = requireNumber(info, 1, "u");
        double v = requireNumber(info, 2, "v");
        auto r = forge::surfacing::evalSurface(h, u, v);
        auto out = Napi::Object::New(env);
        out.Set("point",  surf_bind::vec3ToArr(env, r.point));
        out.Set("du",     surf_bind::vec3ToArr(env, r.du));
        out.Set("dv",     surf_bind::vec3ToArr(env, r.dv));
        out.Set("normal", surf_bind::vec3ToArr(env, r.normal));
        out.Set("gaussian", Napi::Number::New(env, r.gaussian));
        out.Set("mean",     Napi::Number::New(env, r.mean));
        return out;
    });
}

Napi::Value SurfIntersect(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto a = requireHandle(info, 0);
        auto b = requireHandle(info, 1);
        return Napi::Number::New(info.Env(), forge::surfacing::intersectSurfaces(a, b));
    });
}

Napi::Value SurfProjectPoint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        if (info.Length() < 2 || (!info[1].IsTypedArray() && !info[1].IsArray())) {
            throw Napi::TypeError::New(env,
                "forge.surfacing.projectPoint: pt must be [x,y,z]");
        }
        double px = 0.0, py = 0.0, pz = 0.0;
        if (info[1].IsTypedArray()) {
            auto ta = info[1].As<Napi::Float64Array>();
            if (ta.ElementLength() < 3) {
                throw Napi::TypeError::New(env,
                    "forge.surfacing.projectPoint: pt array must have 3 elements");
            }
            px = ta.Data()[0]; py = ta.Data()[1]; pz = ta.Data()[2];
        } else {
            auto a = info[1].As<Napi::Array>();
            if (a.Length() < 3) {
                throw Napi::TypeError::New(env,
                    "forge.surfacing.projectPoint: pt array must have 3 elements");
            }
            px = a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
            py = a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
            pz = a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
        }
        auto r = forge::surfacing::projectPointToSurface(h, px, py, pz);
        auto out = Napi::Object::New(env);
        auto uv = Napi::Array::New(env, 2);
        uv.Set(uint32_t{0}, r.u);
        uv.Set(uint32_t{1}, r.v);
        out.Set("uv", uv);
        out.Set("point", surf_bind::vec3ToArr(env, r.point));
        out.Set("distance", Napi::Number::New(env, r.distance));
        return out;
    });
}

Napi::Value SurfClassA(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        std::uint32_t samples = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().Uint32Value() : 16;
        auto r = forge::surfacing::classAAnalyse(h, samples);
        auto out = Napi::Object::New(env);
        out.Set("minK",          Napi::Number::New(env, r.minK));
        out.Set("maxK",          Napi::Number::New(env, r.maxK));
        out.Set("avgK",          Napi::Number::New(env, r.avgK));
        out.Set("isophoteCount", Napi::Number::New(env, static_cast<double>(r.isophoteCount)));
        return out;
    });
}

// ----------------------------------------------------------- diagnostics
Napi::Value Version(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("forgeKernel", "0.1.0");
        out.Set("occt", OCC_VERSION_STRING_EXT);
        out.Set("napiCpp", NAPI_VERSION);
        return out;
    });
}

} // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("makeBox",      Napi::Function::New(env, MakeBox));
    exports.Set("makeCylinder", Napi::Function::New(env, MakeCylinder));
    exports.Set("makeSphere",   Napi::Function::New(env, MakeSphere));
    exports.Set("makeCone",     Napi::Function::New(env, MakeCone));
    exports.Set("makeTorus",    Napi::Function::New(env, MakeTorus));

    exports.Set("fuse",   Napi::Function::New(env, Fuse));
    exports.Set("cut",    Napi::Function::New(env, Cut));
    exports.Set("common", Napi::Function::New(env, Common));

    exports.Set("translate", Napi::Function::New(env, Translate));
    exports.Set("rotate",    Napi::Function::New(env, Rotate));

    exports.Set("tessellate",   Napi::Function::New(env, Tessellate));
    exports.Set("massProps",    Napi::Function::New(env, MassProps));

    exports.Set("retain",    Napi::Function::New(env, Retain));
    exports.Set("release",   Napi::Function::New(env, Release));
    exports.Set("liveCount", Napi::Function::New(env, LiveCount));

    exports.Set("addInstance",      Napi::Function::New(env, AddInstance));
    exports.Set("removeInstance",   Napi::Function::New(env, RemoveInstance));
    exports.Set("updateTransform",  Napi::Function::New(env, UpdateTransform));
    exports.Set("instanceCount",    Napi::Function::New(env, InstanceCount));
    exports.Set("queryAABB",        Napi::Function::New(env, QueryAABB));
    exports.Set("getInstanceAABB",  Napi::Function::New(env, GetInstanceAABB));
    exports.Set("instanceExists",   Napi::Function::New(env, InstanceExists));
    exports.Set("reserveInstances", Napi::Function::New(env, ReserveInstances));
    exports.Set("instanceBytesUsed",Napi::Function::New(env, InstanceBytesUsed));

    // ---- BVH spatial index (Forge-25) ---------------------------------
    exports.Set("buildBvh",     Napi::Function::New(env, BuildBvh));
    exports.Set("isBvhFresh",   Napi::Function::New(env, IsBvhFresh));
    exports.Set("queryRay",     Napi::Function::New(env, QueryRay));
    exports.Set("queryFrustum", Napi::Function::New(env, QueryFrustum));

    // ---- LOD chain (Forge-25) -----------------------------------------
    exports.Set("tessellateLOD",   Napi::Function::New(env, TessellateLOD));
    exports.Set("selectLOD",       Napi::Function::New(env, SelectLOD));
    exports.Set("clearLODCache",   Napi::Function::New(env, ClearLODCache));
    exports.Set("lodCacheEntries", Napi::Function::New(env, LODCacheEntries));
    auto lodLevels = Napi::Object::New(env);
    lodLevels.Set("Low",  Napi::Number::New(env, 0));
    lodLevels.Set("Med",  Napi::Number::New(env, 1));
    lodLevels.Set("High", Napi::Number::New(env, 2));
    exports.Set("LODLevel", lodLevels);

    // ---- worker-thread tessellation (Forge-25) ------------------------
    exports.Set("tessellateAsync",       Napi::Function::New(env, TessellateAsync));
    exports.Set("tessellationPoolSize",  Napi::Function::New(env, TessellationPoolSize));
    exports.Set("tessellationWaitIdle",  Napi::Function::New(env, TessellationWaitIdle));

    // ---- assembly solver (Forge-7) — wrapped under "assembly" namespace.
    auto assembly = Napi::Object::New(env);
    assembly.Set("addMate",       Napi::Function::New(env, AddMate));
    assembly.Set("removeMate",    Napi::Function::New(env, RemoveMate));
    assembly.Set("setMateActive", Napi::Function::New(env, SetMateActive));
    assembly.Set("setFixed",      Napi::Function::New(env, SetFixed));
    assembly.Set("solve",         Napi::Function::New(env, SolveAssembly));
    assembly.Set("mateCount",     Napi::Function::New(env, MateCount));
    assembly.Set("clear",         Napi::Function::New(env, ClearMates));
    // Forge-35 — hierarchy + interference + motion.
    assembly.Set("clearHierarchy",     Napi::Function::New(env, ClearHierarchy));
    assembly.Set("setParent",          Napi::Function::New(env, SetParent));
    assembly.Set("getChildren",        Napi::Function::New(env, GetChildren));
    assembly.Set("worldTransform",     Napi::Function::New(env, WorldTransform));
    assembly.Set("detectInterference", Napi::Function::New(env, DetectInterference));
    assembly.Set("runMotionStudy",     Napi::Function::New(env, RunMotionStudy));
    // Mate-kind integer codes (must mirror MateKind in AssemblySolver.hpp).
    auto kinds = Napi::Object::New(env);
    kinds.Set("Coincident",    Napi::Number::New(env, 0));
    kinds.Set("Concentric",    Napi::Number::New(env, 1));
    kinds.Set("Parallel",      Napi::Number::New(env, 2));
    kinds.Set("Perpendicular", Napi::Number::New(env, 3));
    kinds.Set("Distance",      Napi::Number::New(env, 4));
    kinds.Set("Angle",         Napi::Number::New(env, 5));
    kinds.Set("Tangent",       Napi::Number::New(env, 6));
    kinds.Set("Fixed",         Napi::Number::New(env, 7));
    assembly.Set("MateKind", kinds);
    exports.Set("assembly", assembly);

    // ---- engineering drawings (Forge-10 + Forge-32) — HLR projection +
    // section / detail / broken views.
    auto drawings = Napi::Object::New(env);
    drawings.Set("projectShape",   Napi::Function::New(env, ProjectShape));
    drawings.Set("projectSection", Napi::Function::New(env, ProjectShapeSection));
    drawings.Set("projectDetail",  Napi::Function::New(env, ProjectShapeDetail));
    drawings.Set("projectBroken",  Napi::Function::New(env, ProjectShapeBroken));
    exports.Set("drawings", drawings);
    exports.Set("projectShape", Napi::Function::New(env, ProjectShape));

    exports.Set("version", Napi::Function::New(env, Version));

    // -------- sketcher (parametric 2D constraint solver) ----------------
    auto sketcher = Napi::Object::New(env);
    sketcher.Set("createSketch",  Napi::Function::New(env, SketcherCreate));
    sketcher.Set("destroySketch", Napi::Function::New(env, SketcherDestroy));
    sketcher.Set("addPoint",      Napi::Function::New(env, SketcherAddPoint));
    sketcher.Set("addLine",       Napi::Function::New(env, SketcherAddLine));
    sketcher.Set("addCircle",     Napi::Function::New(env, SketcherAddCircle));
    sketcher.Set("addArc",        Napi::Function::New(env, SketcherAddArc));
    sketcher.Set("addConstraint", Napi::Function::New(env, SketcherAddConstraint));
    sketcher.Set("solve",         Napi::Function::New(env, SketcherSolve));
    sketcher.Set("readPoint",     Napi::Function::New(env, SketcherReadPoint));
    sketcher.Set("writePoint",    Napi::Function::New(env, SketcherWritePoint));
    sketcher.Set("liveCount",     Napi::Function::New(env, SketcherLiveCount));

    auto sketchKinds = Napi::Object::New(env);
    sketchKinds.Set("Coincident",    Napi::Number::New(env, 1));
    sketchKinds.Set("Parallel",      Napi::Number::New(env, 2));
    sketchKinds.Set("Perpendicular", Napi::Number::New(env, 3));
    sketchKinds.Set("Distance",      Napi::Number::New(env, 4));
    sketchKinds.Set("Horizontal",    Napi::Number::New(env, 5));
    sketchKinds.Set("Vertical",      Napi::Number::New(env, 6));
    sketchKinds.Set("PointOnLine",   Napi::Number::New(env, 7));
    sketchKinds.Set("PointOnCircle", Napi::Number::New(env, 8));
    sketchKinds.Set("Equal",         Napi::Number::New(env, 9));
    sketchKinds.Set("Tangent",       Napi::Number::New(env, 10));
    sketcher.Set("kinds", sketchKinds);

    auto statuses = Napi::Object::New(env);
    statuses.Set("Success",      Napi::Number::New(env, 0));
    statuses.Set("Failed",       Napi::Number::New(env, 1));
    statuses.Set("Inconsistent", Napi::Number::New(env, 2));
    sketcher.Set("statuses", statuses);

    exports.Set("sketcher", sketcher);

    // -------- FEA (Forge-12 + Forge-12b) ---------------------------------
    auto fea = Napi::Object::New(env);
    fea.Set("meshFromBrep",        Napi::Function::New(env, FeaMeshFromBrep));
    fea.Set("solveStatic",         Napi::Function::New(env, FeaSolveStatic));
    fea.Set("solveModal",          Napi::Function::New(env, FeaSolveModal));
    fea.Set("solveDynamic",        Napi::Function::New(env, FeaSolveDynamic));
    fea.Set("solveThermal",        Napi::Function::New(env, FeaSolveThermal));
    fea.Set("solveNonlinearStatic",Napi::Function::New(env, FeaSolveNonlinearStatic));
    fea.Set("fatigueLife",         Napi::Function::New(env, FeaFatigueLife));
    // Mean-stress correction enum mirrored to JS.
    auto fc = Napi::Object::New(env);
    fc.Set("None",      Napi::Number::New(env, 0));
    fc.Set("Goodman",   Napi::Number::New(env, 1));
    fc.Set("Soderberg", Napi::Number::New(env, 2));
    fea.Set("MeanStressCorrection", fc);
    exports.Set("fea", fea);
    // -------- cam (2.5D toolpath generators + G-code post) -------------
    auto cam = Napi::Object::New(env);
    cam.Set("profile",  Napi::Function::New(env, CamProfile));
    cam.Set("pocket",   Napi::Function::New(env, CamPocket));
    cam.Set("drill",    Napi::Function::New(env, CamDrill));
    cam.Set("faceMill", Napi::Function::New(env, CamFaceMill));
    cam.Set("adaptiveClear",       Napi::Function::New(env, CamAdaptiveClear));
    cam.Set("multiAxisIndexed",    Napi::Function::New(env, CamMultiAxisIndexed));
    cam.Set("multiAxisContinuous", Napi::Function::New(env, CamMultiAxisContinuous));
    cam.Set("simulateStock",       Napi::Function::New(env, CamSimulateStock));
    cam.Set("generateCmm",         Napi::Function::New(env, CamGenerateCmm));

    auto toolTypes = Napi::Object::New(env);
    toolTypes.Set("EndMill",  Napi::Number::New(env, forge::cam::Tool::EndMill));
    toolTypes.Set("BallNose", Napi::Number::New(env, forge::cam::Tool::BallNose));
    toolTypes.Set("Drill",    Napi::Number::New(env, forge::cam::Tool::Drill));
    toolTypes.Set("Chamfer",  Napi::Number::New(env, forge::cam::Tool::Chamfer));
    cam.Set("ToolType", toolTypes);
    cam.Set("kAutoFaceId", Napi::Number::New(env, forge::cam::kAutoFaceId));

    auto gcode = Napi::Object::New(env);
    gcode.Set("toGcode", Napi::Function::New(env, CamToGcode));
    auto dialects = Napi::Object::New(env);
    dialects.Set("Fanuc",    Napi::Number::New(env, forge::cam::gcode::Fanuc));
    dialects.Set("Haas",     Napi::Number::New(env, forge::cam::gcode::Haas));
    dialects.Set("LinuxCNC", Napi::Number::New(env, forge::cam::gcode::LinuxCNC));
    dialects.Set("Grbl",     Napi::Number::New(env, forge::cam::gcode::Grbl));
    gcode.Set("Dialect", dialects);
    cam.Set("gcode", gcode);
    exports.Set("cam", cam);

    // -------- CFD (Forge-12b) -------------------------------------------
    auto cfd = Napi::Object::New(env);
    cfd.Set("solveSteadyNS", Napi::Function::New(env, CfdSolveSteadyNS));
    exports.Set("cfd", cfd);

    // -------- part features (Forge-22) ----------------------------------
    auto part = Napi::Object::New(env);
    part.Set("extrudeProfile",      Napi::Function::New(env, PartExtrudeProfile));
    part.Set("revolveProfile",      Napi::Function::New(env, PartRevolveProfile));
    part.Set("sweep",               Napi::Function::New(env, PartSweep));
    part.Set("loft",                Napi::Function::New(env, PartLoft));
    part.Set("shell",               Napi::Function::New(env, PartShell));
    part.Set("filletEdges",         Napi::Function::New(env, PartFilletEdges));
    part.Set("variableFilletEdge",  Napi::Function::New(env, PartVariableFillet));
    part.Set("chamferEdges",        Napi::Function::New(env, PartChamferEdges));
    part.Set("draftFaces",          Napi::Function::New(env, PartDraftFaces));
    part.Set("holeWizard",          Napi::Function::New(env, PartHoleWizard));
    part.Set("rib",                 Napi::Function::New(env, PartRib));
    part.Set("linearPattern",       Napi::Function::New(env, PartLinearPattern));
    part.Set("circularPattern",     Napi::Function::New(env, PartCircularPattern));
    part.Set("mirrorPattern",       Napi::Function::New(env, PartMirrorPattern));
    part.Set("onCurvePattern",      Napi::Function::New(env, PartOnCurvePattern));
    // Forge-36 closures of the §1 partial rows.
    part.Set("sweepWithGuides",     Napi::Function::New(env, PartSweepWithGuides));
    part.Set("loftWithGuides",      Napi::Function::New(env, PartLoftWithGuides));
    part.Set("shellMultiThickness", Napi::Function::New(env, PartShellMultiThickness));
    exports.Set("part", part);

    // -------- NURBS surfacing (Forge-36) -------------------------------
    auto surfacing = Napi::Object::New(env);
    surfacing.Set("buildPatch",     Napi::Function::New(env, SurfBuildPatch));
    surfacing.Set("trim",           Napi::Function::New(env, SurfTrim));
    surfacing.Set("sew",            Napi::Function::New(env, SurfSew));
    surfacing.Set("refine",         Napi::Function::New(env, SurfRefine));
    surfacing.Set("eval",           Napi::Function::New(env, SurfEval));
    surfacing.Set("intersect",      Napi::Function::New(env, SurfIntersect));
    surfacing.Set("projectPoint",   Napi::Function::New(env, SurfProjectPoint));
    surfacing.Set("classAAnalyse",  Napi::Function::New(env, SurfClassA));
    exports.Set("surfacing", surfacing);

    // -------- IO exchange (Forge-21) — STEP / BREP / STL ----------------
    auto io = Napi::Object::New(env);
    io.Set("importStep", Napi::Function::New(env, IoImportStep));
    io.Set("exportStep", Napi::Function::New(env, IoExportStep));
    io.Set("importBrep", Napi::Function::New(env, IoImportBrep));
    io.Set("exportBrep", Napi::Function::New(env, IoExportBrep));
    io.Set("importStl",  Napi::Function::New(env, IoImportStl));
    io.Set("exportStl",  Napi::Function::New(env, IoExportStl));
    // Forge-34: IGES + JT/Parasolid stubs + PMI/MBD STEP AP242 export.
    io.Set("importIges",       Napi::Function::New(env, IoImportIges));
    io.Set("importJt",         Napi::Function::New(env, IoImportJt));
    io.Set("importParasolid",  Napi::Function::New(env, IoImportParasolid));
    io.Set("exportStepWithPmi",Napi::Function::New(env, IoExportStepPmi));
    exports.Set("io", io);

    // -------- Direct modeling (Forge-23) — push/pull/move/delete face ---
    auto direct = Napi::Object::New(env);
    direct.Set("pushPullFace",      Napi::Function::New(env, DirectPushPullFace));
    direct.Set("moveFace",          Napi::Function::New(env, DirectMoveFace));
    direct.Set("rotateFace",        Napi::Function::New(env, DirectRotateFace));
    direct.Set("deleteFaceAndHeal", Napi::Function::New(env, DirectDeleteFace));
    direct.Set("replaceFace",       Napi::Function::New(env, DirectReplaceFace));
    direct.Set("inferFeature",      Napi::Function::New(env, DirectInferFeature));
    direct.Set("faceCount",         Napi::Function::New(env, DirectFaceCount));
    exports.Set("direct", direct);

    // -------- Healing (Forge-23) — sew / fill / validity ---------------
    auto healing = Napi::Object::New(env);
    healing.Set("sewShape",                    Napi::Function::New(env, HealSew));
    healing.Set("simplifyShape",               Napi::Function::New(env, HealSimplify));
    healing.Set("autoFillMissingFaces",        Napi::Function::New(env, HealAutoFill));
    healing.Set("autoRepairSelfIntersection",  Napi::Function::New(env, HealAutoRepair));
    healing.Set("harmonizeNormals",            Napi::Function::New(env, HealHarmonizeNormals));
    healing.Set("checkValidity",               Napi::Function::New(env, HealCheckValidity));
    exports.Set("heal", healing);
    // -------- Sheet metal (Forge-24) -----------------------------------
    auto sheetMetal = Napi::Object::New(env);
    sheetMetal.Set("makeWireRect", Napi::Function::New(env, SmMakeWireRect));
    sheetMetal.Set("makeLineEdge", Napi::Function::New(env, SmMakeLineEdge));
    sheetMetal.Set("baseFlange",   Napi::Function::New(env, SmBaseFlange));
    sheetMetal.Set("edgeFlange",   Napi::Function::New(env, SmEdgeFlange));
    sheetMetal.Set("miterFlange",  Napi::Function::New(env, SmMiterFlange));
    sheetMetal.Set("hem",          Napi::Function::New(env, SmHem));
    sheetMetal.Set("sketchedBend", Napi::Function::New(env, SmSketchedBend));
    sheetMetal.Set("jog",          Napi::Function::New(env, SmJog));
    sheetMetal.Set("closedCorner", Napi::Function::New(env, SmClosedCorner));
    sheetMetal.Set("cornerRelief", Napi::Function::New(env, SmCornerRelief));
    sheetMetal.Set("unfold",       Napi::Function::New(env, SmUnfold));
    sheetMetal.Set("flatPattern",  Napi::Function::New(env, SmFlatPattern));
    sheetMetal.Set("bends",        Napi::Function::New(env, SmBends));
    exports.Set("sheetMetal", sheetMetal);

    // -------- Weldments (Forge-24) -------------------------------------
    auto weldments = Napi::Object::New(env);
    weldments.Set("makePathEdge",     Napi::Function::New(env, WdMakePathEdge));
    weldments.Set("structuralMember", Napi::Function::New(env, WdStructuralMember));
    weldments.Set("endCap",           Napi::Function::New(env, WdEndCap));
    weldments.Set("gusset",           Napi::Function::New(env, WdGusset));
    weldments.Set("weldBead",         Napi::Function::New(env, WdWeldBead));
    weldments.Set("trimMember",       Napi::Function::New(env, WdTrimMember));
    weldments.Set("cutList",          Napi::Function::New(env, WdCutList));
    exports.Set("weldments", weldments);

    return exports;
}

NODE_API_MODULE(forge_kernel, Init)
