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
#include "forge/AssemblySolver.hpp"

#include <Standard_Version.hxx>

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

    // ---- assembly solver — wrapped under "assembly" namespace object.
    auto assembly = Napi::Object::New(env);
    assembly.Set("addMate",       Napi::Function::New(env, AddMate));
    assembly.Set("removeMate",    Napi::Function::New(env, RemoveMate));
    assembly.Set("setMateActive", Napi::Function::New(env, SetMateActive));
    assembly.Set("setFixed",      Napi::Function::New(env, SetFixed));
    assembly.Set("solve",         Napi::Function::New(env, SolveAssembly));
    assembly.Set("mateCount",     Napi::Function::New(env, MateCount));
    assembly.Set("clear",         Napi::Function::New(env, ClearMates));
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

    exports.Set("version", Napi::Function::New(env, Version));
    return exports;
}

NODE_API_MODULE(forge_kernel, Init)
