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
#include "forge/Drawings.hpp"
#include "forge/Sketcher.hpp"
#include "forge/Fea.hpp"
#include "forge/Cam.hpp"
#include "forge/GcodePost.hpp"
#include "forge/Cfd.hpp"
#include "forge/IoExchange.hpp"
#include "forge/DirectModeling.hpp"
#include "forge/Healing.hpp"

#include <Standard_Version.hxx>
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

    // ---- assembly solver (Forge-7) — wrapped under "assembly" namespace.
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

    // ---- engineering drawings (Forge-10) — HLR projection.
    auto drawings = Napi::Object::New(env);
    drawings.Set("projectShape", Napi::Function::New(env, ProjectShape));
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

    // -------- IO exchange (Forge-21) — STEP / BREP / STL ----------------
    auto io = Napi::Object::New(env);
    io.Set("importStep", Napi::Function::New(env, IoImportStep));
    io.Set("exportStep", Napi::Function::New(env, IoExportStep));
    io.Set("importBrep", Napi::Function::New(env, IoImportBrep));
    io.Set("exportBrep", Napi::Function::New(env, IoExportBrep));
    io.Set("importStl",  Napi::Function::New(env, IoImportStl));
    io.Set("exportStl",  Napi::Function::New(env, IoExportStl));
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

    return exports;
}

NODE_API_MODULE(forge_kernel, Init)
