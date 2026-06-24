// binding_sketchdiag.cpp — self-contained N-API binding for the sketcher
// constraint DIAGNOSTICS (sketcher-constraints.md "Phase A").
//
// Surfaces the planegcs GCS::System diagnose pipeline that the original 3-state
// `forge.sketcher.solve()` status dropped: conflicting / redundant /
// partially-redundant constraint TAG lists, dependent (still-free) geometry
// parameters mapped back to point/entity IDs, the true Jacobian-rank DOF, and
// per-constraint residuals. It also exposes a SOLVER-BACKED audit that replaces
// the static counting table in src/SketchDof.cpp as the source of truth.
//
// JS surface, registered under `forge.sketch.diagnose`:
//   forge.sketch.diagnose.diagnose(handle)        -> full report (below)
//   forge.sketch.diagnose.audit(handle)           -> solver-backed DOF/health
//   forge.sketch.diagnose.residual(handle, tag)   -> number (RMS error, NaN if none)
//   forge.sketch.diagnose.residuals(handle)       -> [{ tag, residual }...]
//   forge.sketch.diagnose.paramRoles              -> { PointX:0, ... } enum table
//
// All native verbs forward to free functions added to the Forge facade in
// src/Sketcher.cpp (forge::diagnoseSketch / constraintResidual /
// allConstraintResiduals / auditSketch). Every one of those wraps a genuine,
// already-compiled GCS::System getter (cited in include/forge/Sketcher.hpp);
// no verb here stubs an absent engine.
//
// This TU is registered via forge::bind::InitSketchdiag(env, exports), called
// from binding.cpp's Init(). It deliberately re-declares its own local copies
// of the safe()/requireHandle()/requireNumber() helpers (the binding.cpp ones
// live in an anonymous namespace and are not linkable across TUs) so the file
// is fully self-contained and conflict-free with binding.cpp.

#include <napi.h>

#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/Sketcher.hpp"

namespace forge {
namespace bind {
namespace {

// ---- local N-API helpers (mirror binding.cpp's anonymous-namespace ones) ----

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

std::uint32_t requireHandle(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsNumber()) {
        throw Napi::TypeError::New(info.Env(),
            "forge: expected handle (uint32) at arg " + std::to_string(idx));
    }
    return info[idx].As<Napi::Number>().Uint32Value();
}

int requireInt(const Napi::CallbackInfo& info, std::size_t idx, const char* what) {
    if (info.Length() <= idx || !info[idx].IsNumber()) {
        throw Napi::TypeError::New(info.Env(),
            std::string("forge: expected integer for ") + what);
    }
    return info[idx].As<Napi::Number>().Int32Value();
}

// ---- JS-shape conversion ----------------------------------------------------

const char* roleName(SketchParamRole r) {
    switch (r) {
        case SketchParamRole::PointX:        return "pointX";
        case SketchParamRole::PointY:        return "pointY";
        case SketchParamRole::CircleRadius:  return "circleRadius";
        case SketchParamRole::ArcRadius:     return "arcRadius";
        case SketchParamRole::ArcStartAngle: return "arcStartAngle";
        case SketchParamRole::ArcEndAngle:   return "arcEndAngle";
        default:                             return "unknown";
    }
}

Napi::Array intVecToArray(Napi::Env env, const std::vector<int>& v) {
    auto arr = Napi::Array::New(env, v.size());
    for (std::uint32_t i = 0; i < v.size(); ++i) {
        arr.Set(i, Napi::Number::New(env, v[i]));
    }
    return arr;
}

// A residual is NaN when no constraint carries the tag — emit JS null so the
// JS side can distinguish "no such tag" from a genuine 0.0 residual.
Napi::Value residualValue(Napi::Env env, double r) {
    if (std::isnan(r)) return env.Null();
    return Napi::Number::New(env, r);
}

// ---- verbs ------------------------------------------------------------------

Napi::Value Diagnose(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        SketchDiagnostics d = forge::diagnoseSketch(requireHandle(info, 0));

        auto out = Napi::Object::New(env);
        out.Set("dof",                   Napi::Number::New(env, d.dof));
        out.Set("emptyDiagnoseMatrix",   Napi::Boolean::New(env, d.emptyDiagnoseMatrix));
        out.Set("hasConflicting",        Napi::Boolean::New(env, d.hasConflicting));
        out.Set("hasRedundant",          Napi::Boolean::New(env, d.hasRedundant));
        out.Set("hasPartiallyRedundant", Napi::Boolean::New(env, d.hasPartiallyRedundant));
        out.Set("conflicting",        intVecToArray(env, d.conflicting));
        out.Set("redundant",          intVecToArray(env, d.redundant));
        out.Set("partiallyRedundant", intVecToArray(env, d.partiallyRedundant));
        out.Set("dependentParamGroupCount", Napi::Number::New(env, d.dependentParamGroupCount));
        out.Set("classification",     Napi::String::New(env, d.classification));

        auto deps = Napi::Array::New(env, d.dependentParams.size());
        for (std::uint32_t i = 0; i < d.dependentParams.size(); ++i) {
            const auto& dp = d.dependentParams[i];
            auto o = Napi::Object::New(env);
            o.Set("role",    Napi::String::New(env, roleName(dp.role)));
            o.Set("ownerId", Napi::Number::New(env, static_cast<double>(dp.ownerId)));
            o.Set("group",   Napi::Number::New(env, dp.group));
            deps.Set(i, o);
        }
        out.Set("dependentParams", deps);
        return out;
    });
}

Napi::Value Audit(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        SketchAuditResult r = forge::auditSketch(requireHandle(info, 0));

        auto out = Napi::Object::New(env);
        out.Set("totalEntities",         Napi::Number::New(env, r.totalEntities));
        out.Set("totalConstraints",      Napi::Number::New(env, r.totalConstraints));
        out.Set("staticEstimate",        Napi::Number::New(env, r.staticEstimate));
        out.Set("solverDof",             Napi::Number::New(env, r.solverDof));
        out.Set("dof",                   Napi::Number::New(env, r.solverDof));  // alias
        out.Set("status",                Napi::String::New(env, r.status));
        out.Set("hasConflicting",        Napi::Boolean::New(env, r.hasConflicting));
        out.Set("hasRedundant",          Napi::Boolean::New(env, r.hasRedundant));
        out.Set("hasPartiallyRedundant", Napi::Boolean::New(env, r.hasPartiallyRedundant));
        return out;
    });
}

Napi::Value Residual(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        double r = forge::constraintResidual(
            requireHandle(info, 0), requireInt(info, 1, "tag"));
        return residualValue(env, r);
    });
}

Napi::Value Residuals(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto rs = forge::allConstraintResiduals(requireHandle(info, 0));
        auto arr = Napi::Array::New(env, rs.size());
        for (std::uint32_t i = 0; i < rs.size(); ++i) {
            auto o = Napi::Object::New(env);
            o.Set("tag",      Napi::Number::New(env, rs[i].tag));
            o.Set("residual", residualValue(env, rs[i].residual));
            arr.Set(i, o);
        }
        return arr;
    });
}

}  // namespace

// Public entry point — called from binding.cpp::Init().
void InitSketchdiag(Napi::Env env, Napi::Object exports) {
    // Namespace under forge.sketch.diagnose. We create `sketch` here if it does
    // not already exist so we don't clobber any prior forge.sketch.* exports;
    // diagnose verbs live one level down at forge.sketch.diagnose.*.
    Napi::Object sketch;
    if (exports.Has("sketch") && exports.Get("sketch").IsObject()) {
        sketch = exports.Get("sketch").As<Napi::Object>();
    } else {
        sketch = Napi::Object::New(env);
        exports.Set("sketch", sketch);
    }

    auto diagnose = Napi::Object::New(env);
    diagnose.Set("diagnose",  Napi::Function::New(env, Diagnose));
    diagnose.Set("audit",     Napi::Function::New(env, Audit));
    diagnose.Set("residual",  Napi::Function::New(env, Residual));
    diagnose.Set("residuals", Napi::Function::New(env, Residuals));

    // Enum table so the JS / tool-registry side can read dependent-param roles.
    auto roles = Napi::Object::New(env);
    roles.Set("pointX",        Napi::Number::New(env, static_cast<int>(SketchParamRole::PointX)));
    roles.Set("pointY",        Napi::Number::New(env, static_cast<int>(SketchParamRole::PointY)));
    roles.Set("circleRadius",  Napi::Number::New(env, static_cast<int>(SketchParamRole::CircleRadius)));
    roles.Set("arcRadius",     Napi::Number::New(env, static_cast<int>(SketchParamRole::ArcRadius)));
    roles.Set("arcStartAngle", Napi::Number::New(env, static_cast<int>(SketchParamRole::ArcStartAngle)));
    roles.Set("arcEndAngle",   Napi::Number::New(env, static_cast<int>(SketchParamRole::ArcEndAngle)));
    diagnose.Set("paramRoles", roles);

    sketch.Set("diagnose", diagnose);
}

}  // namespace bind
}  // namespace forge
