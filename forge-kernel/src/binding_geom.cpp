// forge-kernel binding_geom.cpp — N-API bridge for the DARK computational
// geometry engines (predicates-geom.md "Phase A1").
//
// These engines already exist and compile natively in src/native/geom and
// src/native/mesh, are gated by their own standalone test/native gates, but were
// NOT exposed to JS by src/binding.cpp. This SELF-CONTAINED translation unit
// bridges them under a single `forge.geom.*` namespace, mirroring the exact
// N-API conventions of binding.cpp (safe()/requireNumber()/readDoubleVec()/
// readU32Vec()) so Archie's CUA can call each verb.
//
// 0 FAKES (Bible §0): every verb below calls a GENUINE native entry point whose
// implementation was read and whose signature was verified against its header.
// No verb is stubbed; every {ok,reason} result is forwarded faithfully so the
// honest native failure path (degenerate / unsupported input) surfaces to JS.
//
// Bound here (all verified implemented in src/native/{geom,mesh}):
//   forge.geom.insphere              <- native::insphere (Predicates.hpp)
//   forge.geom.delaunay2D            <- native::geom::delaunay2D
//   forge.geom.constrainedDelaunay2D <- native::geom::constrainedDelaunay2D
//   forge.geom.delaunay3D            <- native::geom::delaunay3D
//   forge.geom.voronoi3D             <- native::geom::voronoi3D
//   forge.geom.alphaShape3D          <- native::geom::alphaShape3D
//   forge.geom.polygonBoolean2D      <- native::geom::PolygonBoolean2D::compute
//   forge.geom.polygonOffset2D       <- native::geom::PolygonOffset2D::offsetPolygon
//   forge.geom.convexDecomposition   <- native::geom::convexDecompose
//   forge.geom.minkowskiSum3D        <- native::geom::minkowskiSum3D
//   forge.geom.selfIntersect         <- native::mesh::detectSelfIntersections
//
// Pure C++20 + N-API. No OCCT, no WASM, no third-party libs.

#include <napi.h>

#include <cstddef>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/Delaunay.hpp"
#include "forge/native/geom/ConstrainedDelaunay2D.hpp"
#include "forge/native/geom/Delaunay3D.hpp"
#include "forge/native/geom/Voronoi3D.hpp"
#include "forge/native/geom/AlphaShape3D.hpp"
#include "forge/native/geom/PolygonBoolean2D.hpp"
#include "forge/native/geom/PolygonOffset2D.hpp"
#include "forge/native/geom/ConvexDecomposition.hpp"
#include "forge/native/geom/MinkowskiSum3D.hpp"
#include "forge/native/mesh/SelfIntersect.hpp"

namespace forge {
namespace bind {

namespace {

// ---------------------------------------------------------------------------
// Local N-API helpers — same shape/semantics as binding.cpp's safe()/
// requireNumber()/readDoubleVec()/readU32Vec(), redeclared here so this TU is
// fully self-contained (no cross-TU dependency on binding.cpp internals).
// ---------------------------------------------------------------------------

// safe() wraps a binding body so std::exceptions surface as JS Errors instead of
// aborting the V8 isolate (NAPI_CPP_EXCEPTIONS only auto-converts Napi::Error).
template <typename Fn>
Napi::Value geomSafe(const Napi::CallbackInfo& info, Fn&& fn) {
    try {
        return fn();
    } catch (const Napi::Error&) {
        throw;
    } catch (const std::exception& e) {
        throw Napi::Error::New(info.Env(), e.what());
    } catch (...) {
        throw Napi::Error::New(info.Env(), "forge.geom: unknown native exception");
    }
}

double requireNumber(const Napi::CallbackInfo& info, std::size_t idx,
                     const char* what) {
    if (info.Length() <= idx || !info[idx].IsNumber()) {
        throw Napi::TypeError::New(info.Env(),
            std::string("forge.geom: expected number for ") + what);
    }
    return info[idx].As<Napi::Number>().DoubleValue();
}

// Read a flat numeric sequence (Float64Array or plain Array) -> doubles.
std::vector<double> readDoubleVec(Napi::Env e2, Napi::Value v, const char* what) {
    std::vector<double> out;
    if (v.IsTypedArray() && v.As<Napi::TypedArray>().TypedArrayType()
                              == napi_float64_array) {
        auto a = v.As<Napi::Float64Array>();
        out.assign(a.Data(), a.Data() + a.ElementLength());
        return out;
    }
    if (v.IsArray()) {
        auto a = v.As<Napi::Array>();
        out.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i)
            out.push_back(a.Get(i).As<Napi::Number>().DoubleValue());
        return out;
    }
    throw Napi::TypeError::New(e2,
        std::string("forge.geom: ") + what + " must be a Float64Array or number[]");
}

// Read a flat index sequence (Uint32Array / Float64Array / Array) -> u32.
std::vector<std::uint32_t> readU32Vec(Napi::Env e2, Napi::Value v,
                                      const char* what) {
    std::vector<std::uint32_t> out;
    if (v.IsTypedArray() && v.As<Napi::TypedArray>().TypedArrayType()
                              == napi_uint32_array) {
        auto a = v.As<Napi::Uint32Array>();
        out.assign(a.Data(), a.Data() + a.ElementLength());
        return out;
    }
    if (v.IsArray()) {
        auto a = v.As<Napi::Array>();
        out.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i)
            out.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
        return out;
    }
    throw Napi::TypeError::New(e2,
        std::string("forge.geom: ") + what + " must be a Uint32Array or number[]");
}

// flat xy -> Point2 vector (rejects odd length).
std::vector<forge::native::geom::Point2> toPoint2(Napi::Env e2,
                                                  const std::vector<double>& flat,
                                                  const char* what) {
    if (flat.size() % 2 != 0)
        throw Napi::TypeError::New(e2,
            std::string("forge.geom: ") + what + " length must be a multiple of 2");
    std::vector<forge::native::geom::Point2> pts;
    pts.reserve(flat.size() / 2);
    for (std::size_t i = 0; i + 1 < flat.size(); i += 2)
        pts.push_back({flat[i], flat[i + 1]});
    return pts;
}

// flat xyz -> Point3 vector (rejects non-multiple-of-3 length).
std::vector<forge::native::geom::Point3> toPoint3(Napi::Env e2,
                                                  const std::vector<double>& flat,
                                                  const char* what) {
    if (flat.size() % 3 != 0)
        throw Napi::TypeError::New(e2,
            std::string("forge.geom: ") + what + " length must be a multiple of 3");
    std::vector<forge::native::geom::Point3> pts;
    pts.reserve(flat.size() / 3);
    for (std::size_t i = 0; i + 2 < flat.size(); i += 3)
        pts.push_back({flat[i], flat[i + 1], flat[i + 2]});
    return pts;
}

// Pack a Point2 vector into a flat Float64Array (xy pairs).
Napi::Float64Array packPoint2(Napi::Env e2,
                              const std::vector<forge::native::geom::Point2>& pts) {
    auto out = Napi::Float64Array::New(e2, pts.size() * 2);
    for (std::size_t i = 0; i < pts.size(); ++i) {
        out[2 * i]     = pts[i].x;
        out[2 * i + 1] = pts[i].y;
    }
    return out;
}

// Pack a Point3 vector into a flat Float64Array (xyz triples).
Napi::Float64Array packPoint3(Napi::Env e2,
                              const std::vector<forge::native::geom::Point3>& pts) {
    auto out = Napi::Float64Array::New(e2, pts.size() * 3);
    for (std::size_t i = 0; i < pts.size(); ++i) {
        out[3 * i]     = pts[i].x;
        out[3 * i + 1] = pts[i].y;
        out[3 * i + 2] = pts[i].z;
    }
    return out;
}

// Pack a vector<array<int,N>> of index tuples into a flat Uint32Array.
template <std::size_t N>
Napi::Uint32Array packIndexTuples(
    Napi::Env e2, const std::vector<std::array<int, N>>& tuples) {
    auto out = Napi::Uint32Array::New(e2, tuples.size() * N);
    for (std::size_t i = 0; i < tuples.size(); ++i)
        for (std::size_t k = 0; k < N; ++k)
            out[N * i + k] = static_cast<std::uint32_t>(tuples[i][k]);
    return out;
}

// Pack vector<int> into a Float64Array (used for inputIndex maps).
Napi::Float64Array packIntVec(Napi::Env e2, const std::vector<int>& v) {
    auto out = Napi::Float64Array::New(e2, v.size());
    for (std::size_t i = 0; i < v.size(); ++i)
        out[i] = static_cast<double>(v[i]);
    return out;
}

} // namespace

// ===========================================================================
// InitGeom — register the forge.geom.* verbs on `exports`.
//
// Called from binding.cpp's Init() (the parent adds the single line
// `forge::bind::InitGeom(env, exports);`). Builds one `geom` namespace object
// and attaches it as `forge.geom`.
// ===========================================================================
void InitGeom(Napi::Env env, Napi::Object exports) {
    using namespace forge::native;
    using namespace forge::native::geom;

    auto geomNs = Napi::Object::New(env);

    // -- exact predicate: insphere -----------------------------------------
    // insphere(ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz, ex,ey,ez) -> -1|0|+1.
    //   Sign of the 5x5 in-sphere determinant: for (a,b,c,d) POSITIVE-oriented,
    //   +1 if e is strictly INSIDE their circumsphere, -1 outside, 0 cospherical.
    geomNs.Set("insphere", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 15)
            throw Napi::TypeError::New(e2,
                "forge.geom.insphere(ax,ay,az,bx,by,bz,cx,cy,cz,"
                "dx,dy,dz,ex,ey,ez)");
          auto s = insphere(
              requireNumber(info,0,"ax"),  requireNumber(info,1,"ay"),  requireNumber(info,2,"az"),
              requireNumber(info,3,"bx"),  requireNumber(info,4,"by"),  requireNumber(info,5,"bz"),
              requireNumber(info,6,"cx"),  requireNumber(info,7,"cy"),  requireNumber(info,8,"cz"),
              requireNumber(info,9,"dx"),  requireNumber(info,10,"dy"), requireNumber(info,11,"dz"),
              requireNumber(info,12,"ex"), requireNumber(info,13,"ey"), requireNumber(info,14,"ez"));
          return Napi::Number::New(e2, signValue(s));
        });
      }));

    // -- delaunay2D --------------------------------------------------------
    // delaunay2D(points: flat xy number[]) ->
    //   { ok, reason, points: Float64Array(xy), inputIndex: Float64Array,
    //     triangles: Uint32Array (CCW index triples into points) }.
    geomNs.Set("delaunay2D", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 1)
            throw Napi::TypeError::New(e2, "forge.geom.delaunay2D(flatXY: number[])");
          auto pts = toPoint2(e2, readDoubleVec(e2, info[0], "points"), "points");
          auto r = delaunay2D(pts);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
          o.Set("points", packPoint2(e2, r.points));
          o.Set("inputIndex", packIntVec(e2, r.inputIndex));
          o.Set("triangles", packIndexTuples<3>(e2, r.triangles));
          o.Set("triangleCount",
                Napi::Number::New(e2, static_cast<double>(r.triangles.size())));
          return o;
        });
      }));

    // -- constrainedDelaunay2D ---------------------------------------------
    // constrainedDelaunay2D(points: flat xy number[],
    //                       constraints: flat index PAIRS number[] into points) ->
    //   { ok, reason, points, inputIndex, triangles, inside: Uint32Array(0/1),
    //     constraintEdges: Uint32Array (u,v pairs), closedLoops }.
    geomNs.Set("constrainedDelaunay2D", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 2)
            throw Napi::TypeError::New(e2,
                "forge.geom.constrainedDelaunay2D(flatXY: number[], "
                "constraintPairs: number[])");
          auto pts = toPoint2(e2, readDoubleVec(e2, info[0], "points"), "points");
          auto cflat = readU32Vec(e2, info[1], "constraints");
          if (cflat.size() % 2 != 0)
            throw Napi::TypeError::New(e2,
                "forge.geom.constrainedDelaunay2D: constraints length must be "
                "a multiple of 2 (index pairs)");
          std::vector<ConstraintEdge> cons;
          cons.reserve(cflat.size() / 2);
          for (std::size_t i = 0; i + 1 < cflat.size(); i += 2)
            cons.push_back({static_cast<int>(cflat[i]),
                            static_cast<int>(cflat[i + 1])});
          auto r = constrainedDelaunay2D(pts, cons);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
          o.Set("points", packPoint2(e2, r.points));
          o.Set("inputIndex", packIntVec(e2, r.inputIndex));
          o.Set("triangles", packIndexTuples<3>(e2, r.triangles));
          // inside[] is a vector<char>; surface as a 0/1 Uint32Array parallel
          // to triangles.
          auto inside = Napi::Uint32Array::New(e2, r.inside.size());
          for (std::size_t i = 0; i < r.inside.size(); ++i)
            inside[i] = r.inside[i] ? 1u : 0u;
          o.Set("inside", inside);
          o.Set("constraintEdges", packIndexTuples<2>(e2, r.constraintEdges));
          o.Set("closedLoops", Napi::Boolean::New(e2, r.closedLoops));
          o.Set("triangleCount",
                Napi::Number::New(e2, static_cast<double>(r.triangles.size())));
          return o;
        });
      }));

    // -- delaunay3D --------------------------------------------------------
    // delaunay3D(points: flat xyz number[]) ->
    //   { ok, reason, points: Float64Array(xyz), inputIndex,
    //     tetrahedra: Uint32Array (POSITIVE-orient index quads),
    //     hullFaces: Uint32Array (CCW-outward triples) }.
    geomNs.Set("delaunay3D", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 1)
            throw Napi::TypeError::New(e2, "forge.geom.delaunay3D(flatXYZ: number[])");
          auto pts = toPoint3(e2, readDoubleVec(e2, info[0], "points"), "points");
          auto r = delaunay3D(pts);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
          o.Set("points", packPoint3(e2, r.points));
          o.Set("inputIndex", packIntVec(e2, r.inputIndex));
          o.Set("tetrahedra", packIndexTuples<4>(e2, r.tetrahedra));
          o.Set("hullFaces", packIndexTuples<3>(e2, r.hullFaces));
          o.Set("tetCount",
                Napi::Number::New(e2, static_cast<double>(r.tetrahedra.size())));
          return o;
        });
      }));

    // -- voronoi3D ---------------------------------------------------------
    // voronoi3D(points: flat xyz number[]) ->
    //   { ok, reason, boundedCellCount, sites: Float64Array(xyz),
    //     voronoiVertices: Float64Array(xyz),
    //     cells: [ { site, bounded, vertexCount, volume,
    //                vertices: Float64Array(xyz),
    //                hullFaces: Uint32Array(triples into vertices) } ] }.
    geomNs.Set("voronoi3D", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 1)
            throw Napi::TypeError::New(e2, "forge.geom.voronoi3D(flatXYZ: number[])");
          auto pts = toPoint3(e2, readDoubleVec(e2, info[0], "points"), "points");
          auto r = voronoi3D(pts);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
          o.Set("boundedCellCount", Napi::Number::New(e2, r.boundedCellCount));
          o.Set("sites", packPoint3(e2, r.sites));
          o.Set("voronoiVertices", packPoint3(e2, r.voronoiVertices));
          auto cells = Napi::Array::New(e2, r.cells.size());
          for (std::size_t i = 0; i < r.cells.size(); ++i) {
            const auto& c = r.cells[i];
            auto co = Napi::Object::New(e2);
            co.Set("site", Napi::Number::New(e2, c.site));
            co.Set("bounded", Napi::Boolean::New(e2, c.bounded));
            co.Set("vertexCount", Napi::Number::New(e2, c.vertexCount));
            co.Set("volume", Napi::Number::New(e2, c.volume));
            co.Set("vertices", packPoint3(e2, c.vertices));
            co.Set("hullFaces", packIndexTuples<3>(e2, c.hullFaces));
            cells[i] = co;
          }
          o.Set("cells", cells);
          return o;
        });
      }));

    // -- alphaShape3D ------------------------------------------------------
    // alphaShape3D(points: flat xyz number[], alpha: number) ->
    //   { ok, reason, alpha, maxCircumradius, points: Float64Array(xyz),
    //     inputIndex, boundary: Uint32Array(outward triples),
    //     keptTets: Uint32Array(index quads) }.
    geomNs.Set("alphaShape3D", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 2)
            throw Napi::TypeError::New(e2,
                "forge.geom.alphaShape3D(flatXYZ: number[], alpha: number)");
          auto pts = toPoint3(e2, readDoubleVec(e2, info[0], "points"), "points");
          double alpha = requireNumber(info, 1, "alpha");
          auto r = alphaShape3D(pts, alpha);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
          o.Set("alpha", Napi::Number::New(e2, r.alpha));
          o.Set("maxCircumradius", Napi::Number::New(e2, r.maxCircumradius));
          o.Set("points", packPoint3(e2, r.points));
          o.Set("inputIndex", packIntVec(e2, r.inputIndex));
          o.Set("boundary", packIndexTuples<3>(e2, r.boundary));
          o.Set("keptTets", packIndexTuples<4>(e2, r.keptTets));
          return o;
        });
      }));

    // -- polygonBoolean2D --------------------------------------------------
    // polygonBoolean2D(aOuter, aHoles, bOuter, bHoles, op) where each *Outer is a
    //   flat xy number[] ring and each *Holes is an array of flat xy number[]
    //   rings; op in "union"|"intersection"|"difference"|"xor". ->
    //   { ok, reason, netArea, contourCount,
    //     contours: [ Float64Array(xy ring) ... ] }.
    geomNs.Set("polygonBoolean2D", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 5)
            throw Napi::TypeError::New(e2,
                "forge.geom.polygonBoolean2D(aOuter, aHoles, bOuter, bHoles, op)");

          auto readContour = [&](Napi::Value v, const char* what) -> BoolContour {
            BoolContour c;
            c.pts = toPoint2(e2, readDoubleVec(e2, v, what), what);
            return c;
          };
          auto readPoly = [&](Napi::Value outerV, Napi::Value holesV,
                              const char* what) -> BoolPolygon {
            BoolPolygon p;
            p.outer = readContour(outerV, what);
            if (!holesV.IsUndefined() && !holesV.IsNull()) {
              if (!holesV.IsArray())
                throw Napi::TypeError::New(e2,
                    std::string("forge.geom.polygonBoolean2D: ") + what +
                    " holes must be an array of flat-xy rings");
              auto arr = holesV.As<Napi::Array>();
              for (uint32_t i = 0; i < arr.Length(); ++i)
                p.holes.push_back(readContour(arr.Get(i), "hole"));
            }
            return p;
          };

          BoolPolygon A = readPoly(info[0], info[1], "A");
          BoolPolygon B = readPoly(info[2], info[3], "B");

          BoolOp op = BoolOp::Union;
          if (info[4].IsString()) {
            std::string s = info[4].As<Napi::String>().Utf8Value();
            if      (s == "union")        op = BoolOp::Union;
            else if (s == "intersection") op = BoolOp::Intersection;
            else if (s == "difference")   op = BoolOp::Difference;
            else if (s == "xor")          op = BoolOp::Xor;
            else throw Napi::TypeError::New(e2,
                "forge.geom.polygonBoolean2D: op must be "
                "'union'|'intersection'|'difference'|'xor'");
          } else {
            throw Napi::TypeError::New(e2,
                "forge.geom.polygonBoolean2D: op must be a string");
          }

          BoolResult r = PolygonBoolean2D::compute(A, B, op);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("reason", Napi::String::New(e2, r.reason));
          o.Set("netArea", Napi::Number::New(e2, r.netArea()));
          o.Set("contourCount",
                Napi::Number::New(e2, static_cast<double>(r.contourCount())));
          auto contours = Napi::Array::New(e2, r.contours.size());
          for (std::size_t i = 0; i < r.contours.size(); ++i)
            contours[i] = packPoint2(e2, r.contours[i].pts);
          o.Set("contours", contours);
          return o;
        });
      }));

    // -- polygonOffset2D ---------------------------------------------------
    // polygonOffset2D(outer, holes, d [, join="round"|"miter"]) where outer is a
    //   flat xy number[] ring, holes an array of flat xy rings, d a signed
    //   distance. ->
    //   { ok, reason, netArea, droppedLoops, loops: [ Float64Array(xy) ... ] }.
    geomNs.Set("polygonOffset2D", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 3)
            throw Napi::TypeError::New(e2,
                "forge.geom.polygonOffset2D(outer, holes, d[, join])");
          Polygon2 poly;
          poly.outer.pts = toPoint2(e2, readDoubleVec(e2, info[0], "outer"), "outer");
          if (!info[1].IsUndefined() && !info[1].IsNull()) {
            if (!info[1].IsArray())
              throw Napi::TypeError::New(e2,
                  "forge.geom.polygonOffset2D: holes must be an array of flat-xy "
                  "rings");
            auto arr = info[1].As<Napi::Array>();
            for (uint32_t i = 0; i < arr.Length(); ++i) {
              Loop2 h;
              h.pts = toPoint2(e2, readDoubleVec(e2, arr.Get(i), "hole"), "hole");
              poly.holes.push_back(h);
            }
          }
          double d = requireNumber(info, 2, "d");
          OffsetOptions opts;
          if (info.Length() > 3 && info[3].IsString()) {
            std::string j = info[3].As<Napi::String>().Utf8Value();
            if      (j == "round") opts.join = JoinType::Round;
            else if (j == "miter") opts.join = JoinType::Miter;
            else throw Napi::TypeError::New(e2,
                "forge.geom.polygonOffset2D: join must be 'round'|'miter'");
          }
          OffsetResult r = PolygonOffset2D::offsetPolygon(poly, d, opts);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("reason", Napi::String::New(e2, r.reason));
          o.Set("netArea", Napi::Number::New(e2, r.netArea()));
          o.Set("droppedLoops",
                Napi::Number::New(e2, static_cast<double>(r.droppedLoops)));
          auto loops = Napi::Array::New(e2, r.loops.size());
          for (std::size_t i = 0; i < r.loops.size(); ++i)
            loops[i] = packPoint2(e2, r.loops[i].pts);
          o.Set("loops", loops);
          return o;
        });
      }));

    // -- convexDecomposition -----------------------------------------------
    // convexDecomposition(positions: flat xyz number[], indices: flat triple
    //   number[] [, concavityTol [, maxPieces [, maxDepth ]]]) ->
    //   { ok, reason, inputWasConvex, inputVolume, totalVolume,
    //     pieces: [ { volume, concavity, convex,
    //                 positions: Float64Array, indices: Uint32Array } ] }.
    geomNs.Set("convexDecomposition", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 2)
            throw Napi::TypeError::New(e2,
                "forge.geom.convexDecomposition(positions, indices"
                "[, concavityTol[, maxPieces[, maxDepth]]])");
          auto pos = readDoubleVec(e2, info[0], "positions");
          auto idx = readU32Vec(e2, info[1], "indices");
          DecompositionParams params;
          if (info.Length() > 2 && info[2].IsNumber())
            params.concavityTol = info[2].As<Napi::Number>().DoubleValue();
          if (info.Length() > 3 && info[3].IsNumber())
            params.maxPieces =
                static_cast<std::size_t>(info[3].As<Napi::Number>().Uint32Value());
          if (info.Length() > 4 && info[4].IsNumber())
            params.maxDepth =
                static_cast<std::size_t>(info[4].As<Napi::Number>().Uint32Value());
          DecompositionResult r = convexDecompose(pos, idx, params);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
          o.Set("inputWasConvex", Napi::Boolean::New(e2, r.inputWasConvex));
          o.Set("inputVolume", Napi::Number::New(e2, r.inputVolume));
          o.Set("totalVolume", Napi::Number::New(e2, r.totalVolume));
          auto pieces = Napi::Array::New(e2, r.pieces.size());
          for (std::size_t i = 0; i < r.pieces.size(); ++i) {
            const auto& pc = r.pieces[i];
            auto po = Napi::Object::New(e2);
            po.Set("volume", Napi::Number::New(e2, pc.volume));
            po.Set("concavity", Napi::Number::New(e2, pc.concavity));
            po.Set("convex", Napi::Boolean::New(e2, pc.convex));
            auto pa = Napi::Float64Array::New(e2, pc.positions.size());
            for (std::size_t k = 0; k < pc.positions.size(); ++k)
              pa[k] = pc.positions[k];
            po.Set("positions", pa);
            auto ia = Napi::Uint32Array::New(e2, pc.indices.size());
            for (std::size_t k = 0; k < pc.indices.size(); ++k)
              ia[k] = pc.indices[k];
            po.Set("indices", ia);
            pieces[i] = po;
          }
          o.Set("pieces", pieces);
          o.Set("pieceCount",
                Napi::Number::New(e2, static_cast<double>(r.pieces.size())));
          return o;
        });
      }));

    // -- minkowskiSum3D ----------------------------------------------------
    // minkowskiSum3D(aXYZ: flat number[], bXYZ: flat number[]
    //   [, aConvex=true [, bConvex=true ]]) ->
    //   { ok, exact, reason, points: Float64Array(xyz),
    //     faces: Uint32Array(CCW-outward triples), volume }.
    geomNs.Set("minkowskiSum3D", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 2)
            throw Napi::TypeError::New(e2,
                "forge.geom.minkowskiSum3D(aXYZ, bXYZ[, aConvex[, bConvex]])");
          auto A = toPoint3(e2, readDoubleVec(e2, info[0], "A"), "A");
          auto B = toPoint3(e2, readDoubleVec(e2, info[1], "B"), "B");
          bool aConvex = !(info.Length() > 2 && info[2].IsBoolean())
                           ? true : info[2].As<Napi::Boolean>().Value();
          bool bConvex = !(info.Length() > 3 && info[3].IsBoolean())
                           ? true : info[3].As<Napi::Boolean>().Value();
          MinkowskiResult r = minkowskiSum3D(A, B, aConvex, bConvex);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("exact", Napi::Boolean::New(e2, r.exact));
          o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
          o.Set("points", packPoint3(e2, r.points));
          o.Set("faces", packIndexTuples<3>(e2, r.faces));
          o.Set("volume", Napi::Number::New(e2, hullVolume(r.points, r.faces)));
          return o;
        });
      }));

    // -- selfIntersect -----------------------------------------------------
    // selfIntersect(positions: flat xyz number[], indices: flat triple number[]
    //   [, weldTol=0]) ->
    //   { ok, isClean, numTris, gridCells, pairCount,
    //     pairs: Uint32Array (i,j,relation triples) }.
    geomNs.Set("selfIntersect", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return geomSafe(info, [&]() -> Napi::Value {
          auto e2 = info.Env();
          if (info.Length() < 2)
            throw Napi::TypeError::New(e2,
                "forge.geom.selfIntersect(positions, indices[, weldTol])");
          auto pos = readDoubleVec(e2, info[0], "positions");
          auto idx = readU32Vec(e2, info[1], "indices");
          double weldTol = (info.Length() > 2 && info[2].IsNumber())
                             ? info[2].As<Napi::Number>().DoubleValue() : 0.0;
          mesh::SelfIntersectReport r =
              mesh::detectSelfIntersections(pos, idx, weldTol);
          auto o = Napi::Object::New(e2);
          o.Set("ok", Napi::Boolean::New(e2, r.ok));
          o.Set("isClean", Napi::Boolean::New(e2, r.isClean));
          o.Set("numTris", Napi::Number::New(e2, static_cast<double>(r.numTris)));
          o.Set("gridCells",
                Napi::Number::New(e2, static_cast<double>(r.gridCells)));
          o.Set("pairCount",
                Napi::Number::New(e2, static_cast<double>(r.pairs.size())));
          // Each pair -> (i, j, relation) flat Uint32Array triple.
          auto pairs = Napi::Uint32Array::New(e2, r.pairs.size() * 3);
          for (std::size_t k = 0; k < r.pairs.size(); ++k) {
            pairs[3 * k]     = r.pairs[k].i;
            pairs[3 * k + 1] = r.pairs[k].j;
            pairs[3 * k + 2] = static_cast<std::uint32_t>(r.pairs[k].relation);
          }
          o.Set("pairs", pairs);
          return o;
        });
      }));

    exports.Set("geom", geomNs);
}

} // namespace bind
} // namespace forge
