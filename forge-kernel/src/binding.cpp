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

#include <Standard_Version.hxx>

using namespace forge;

namespace {

uint32_t requireHandle(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsNumber()) {
        throw Napi::TypeError::New(info.Env(), "forge: expected handle (uint32) at arg " + std::to_string(idx));
    }
    return info[idx].As<Napi::Number>().Uint32Value();
}

double requireNumber(const Napi::CallbackInfo& info, std::size_t idx, const char* what) {
    if (info.Length() <= idx || !info[idx].IsNumber()) {
        throw Napi::TypeError::New(info.Env(), std::string("forge: expected number for ") + what);
    }
    return info[idx].As<Napi::Number>().DoubleValue();
}

// ----------------------------------------------------------- primitives
Napi::Value MakeBox(const Napi::CallbackInfo& info) {
    auto h = makeBox(requireNumber(info,0,"dx"), requireNumber(info,1,"dy"), requireNumber(info,2,"dz"));
    return Napi::Number::New(info.Env(), h);
}
Napi::Value MakeCylinder(const Napi::CallbackInfo& info) {
    auto h = makeCylinder(requireNumber(info,0,"radius"), requireNumber(info,1,"height"));
    return Napi::Number::New(info.Env(), h);
}
Napi::Value MakeSphere(const Napi::CallbackInfo& info) {
    auto h = makeSphere(requireNumber(info,0,"radius"));
    return Napi::Number::New(info.Env(), h);
}
Napi::Value MakeCone(const Napi::CallbackInfo& info) {
    auto h = makeCone(requireNumber(info,0,"r1"), requireNumber(info,1,"r2"), requireNumber(info,2,"h"));
    return Napi::Number::New(info.Env(), h);
}
Napi::Value MakeTorus(const Napi::CallbackInfo& info) {
    auto h = makeTorus(requireNumber(info,0,"majorR"), requireNumber(info,1,"minorR"));
    return Napi::Number::New(info.Env(), h);
}

// ----------------------------------------------------------- booleans
Napi::Value Fuse(const Napi::CallbackInfo& info)   { return Napi::Number::New(info.Env(), fuse(requireHandle(info,0), requireHandle(info,1))); }
Napi::Value Cut(const Napi::CallbackInfo& info)    { return Napi::Number::New(info.Env(), cut(requireHandle(info,0), requireHandle(info,1))); }
Napi::Value Common(const Napi::CallbackInfo& info) { return Napi::Number::New(info.Env(), common(requireHandle(info,0), requireHandle(info,1))); }

// ----------------------------------------------------------- transform
Napi::Value Translate(const Napi::CallbackInfo& info) {
    auto h = translate(requireHandle(info,0),
                       requireNumber(info,1,"dx"),
                       requireNumber(info,2,"dy"),
                       requireNumber(info,3,"dz"));
    return Napi::Number::New(info.Env(), h);
}
Napi::Value Rotate(const Napi::CallbackInfo& info) {
    auto h = rotate(requireHandle(info,0),
                    requireNumber(info,1,"ax"),
                    requireNumber(info,2,"ay"),
                    requireNumber(info,3,"az"),
                    requireNumber(info,4,"angleRad"));
    return Napi::Number::New(info.Env(), h);
}

// ----------------------------------------------------------- tessellate
// Returns { positions: Float32Array, normals: Float32Array, indices: Uint32Array }
Napi::Value Tessellate(const Napi::CallbackInfo& info) {
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
}

// ----------------------------------------------------------- mass props
Napi::Value MassProps(const Napi::CallbackInfo& info) {
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
}

// ----------------------------------------------------------- lifecycle
Napi::Value Retain(const Napi::CallbackInfo& info) {
    ShapeRegistry::instance().retain(requireHandle(info, 0));
    return info.Env().Undefined();
}
Napi::Value Release(const Napi::CallbackInfo& info) {
    ShapeRegistry::instance().release(requireHandle(info, 0));
    return info.Env().Undefined();
}
Napi::Value LiveCount(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), static_cast<double>(ShapeRegistry::instance().liveCount()));
}

// ----------------------------------------------------------- diagnostics
Napi::Value Version(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto out = Napi::Object::New(env);
    out.Set("forgeKernel", "0.1.0");
    out.Set("occt", OCC_VERSION_STRING_EXT);
    out.Set("napiCpp", NAPI_VERSION);
    return out;
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

    exports.Set("version", Napi::Function::New(env, Version));
    return exports;
}

NODE_API_MODULE(forge_kernel, Init)
