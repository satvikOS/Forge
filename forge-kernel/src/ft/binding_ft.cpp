// binding_ft.cpp — N-API binding for the declarative feature-tree IR compiler
// (include/forge/ft/FeatureTree.hpp, src/ft/FeatureTreeCompiler.cpp).
//
// JS surface, registered under `forge.ft`:
//   forge.ft.compile(irText [, outStepPath]) -> {
//       ok, error, failedOpId,
//       handle,                       // ShapeHandle of the result SOLID (0 if none)
//       valid, faceCount, edgeCount, volume,
//       bbox: { min:[x,y,z], max:[x,y,z] },
//       exported                      // true iff a STEP path was given + written
//   }
//
// This is the entry the smoke test (test/ft/*.mjs) drives: it hands the compiler
// the IR TEXT the VLM would emit, and the compiler parses -> walks -> native
// kernel -> real solid -> STEP, all in C++. Registered from binding.cpp::Init via
// forge::bind::InitFt(env, exports). Self-contained (its own safe() helper) so it
// does not depend on binding.cpp's anonymous-namespace helpers.

#include <napi.h>

#include <string>

#include "forge/ft/FeatureTree.hpp"

namespace forge {
namespace bind {
namespace {

template <typename Fn>
Napi::Value safe(const Napi::CallbackInfo& info, Fn&& fn) {
    try {
        return fn();
    } catch (const Napi::Error&) {
        throw;
    } catch (const std::exception& e) {
        throw Napi::Error::New(info.Env(), e.what());
    } catch (...) {
        throw Napi::Error::New(info.Env(), "forge.ft: unknown native exception");
    }
}

Napi::Value Compile(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsString())
            throw Napi::TypeError::New(env, "forge.ft.compile(irText[, outStepPath]): irText must be a string");
        std::string text = info[0].As<Napi::String>().Utf8Value();
        std::string outPath =
            (info.Length() > 1 && info[1].IsString()) ? info[1].As<Napi::String>().Utf8Value() : std::string();

        forge::ft::CompileResult r = forge::ft::compileText(text, outPath);

        auto out = Napi::Object::New(env);
        out.Set("ok", Napi::Boolean::New(env, r.ok));
        out.Set("error", Napi::String::New(env, r.error));
        out.Set("failedOpId", Napi::Number::New(env, r.failedOpId));
        out.Set("handle", Napi::Number::New(env, r.handle));
        out.Set("valid", Napi::Boolean::New(env, r.valid));
        out.Set("faceCount", Napi::Number::New(env, static_cast<double>(r.faceCount)));
        out.Set("edgeCount", Napi::Number::New(env, static_cast<double>(r.edgeCount)));
        out.Set("volume", Napi::Number::New(env, r.volume));
        out.Set("exported", Napi::Boolean::New(env, r.exported));

        auto mkVec = [&](const double v[3]) {
            auto a = Napi::Array::New(env, 3);
            for (uint32_t i = 0; i < 3; ++i) a.Set(i, Napi::Number::New(env, v[i]));
            return a;
        };
        auto bbox = Napi::Object::New(env);
        bbox.Set("min", mkVec(r.bboxMin));
        bbox.Set("max", mkVec(r.bboxMax));
        out.Set("bbox", bbox);
        return out;
    });
}

}  // namespace

// Public entry point — called from binding.cpp::Init().
void InitFt(Napi::Env env, Napi::Object exports) {
    Napi::Object ft;
    if (exports.Has("ft") && exports.Get("ft").IsObject()) {
        ft = exports.Get("ft").As<Napi::Object>();
    } else {
        ft = Napi::Object::New(env);
        exports.Set("ft", ft);
    }
    ft.Set("compile", Napi::Function::New(env, Compile));
}

}  // namespace bind
}  // namespace forge
