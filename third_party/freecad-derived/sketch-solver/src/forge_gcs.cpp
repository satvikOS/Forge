// SPDX-License-Identifier: LGPL-2.1-or-later
//
// forge_gcs.cpp -- implementation of the libforge_gcs C ABI over planegcs.
//
// Part of libforge_gcs, a modified version of FreeCAD's planegcs solver
// (FreeCAD commit 0a45a0a008d4af7a85601016c5ab31bd26c25b22). Written for Forge on
// 2026-09-15. See ../MODIFICATIONS.md.
//
// Everything here is marshalling: it owns the parameter storage planegcs's
// pointer-based geometry refers to, translates indices into planegcs objects,
// and converts every failure -- bad input or a solver exception -- into a
// result code and a sentence. It adds no numerics.

#define FORGE_GCS_BUILDING 1
#include "forge_gcs/forge_gcs.h"

#include "GCS.h"
#include "Geo.h"

#include <atomic>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <deque>
#include <exception>
#include <limits>
#include <memory>
#include <mutex>
#include <new>
#include <string>
#include <unordered_map>
#include <vector>

// ── the log sink the Base::Console stand-in forwards to ────────────────────
namespace {
std::mutex g_sinkMutex;
forge_gcs_log_fn g_sink = nullptr;
void* g_sinkUser = nullptr;
}  // namespace

namespace forge_gcs_detail {
void emitv(int level, const char* fmt, std::va_list args)
{
    forge_gcs_log_fn fn = nullptr;
    void* user = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_sinkMutex);
        fn = g_sink;
        user = g_sinkUser;
    }
    if (fn == nullptr || fmt == nullptr) {
        return;
    }
    char buf[1024];
    std::va_list copy;
    va_copy(copy, args);
    std::vsnprintf(buf, sizeof(buf), fmt, copy);
    va_end(copy);
    fn(user, level, buf);
}
}  // namespace forge_gcs_detail

struct forge_gcs_system {
    GCS::System gcs;

    // Parameter storage. A deque never moves its elements, and planegcs holds
    // raw pointers into this storage for the lifetime of the system.
    std::deque<double> unknowns;  // point x/y, circle radius, arc radius/angles
    std::deque<double> values;    // constraint targets (distances, angles, ...)

    std::vector<GCS::Point> points;
    struct CurveRec {
        int32_t kind;
        std::size_t typed;  // index into lines / circles / arcs
        int32_t p1, p2, center;
    };
    std::vector<CurveRec> curves;
    std::vector<std::unique_ptr<GCS::Line>> lines;
    std::vector<std::unique_ptr<GCS::Circle>> circles;
    std::vector<std::unique_ptr<GCS::Arc>> arcs;

    std::string lastError;

    double* allocUnknown(double v)
    {
        unknowns.push_back(v);
        return &unknowns.back();
    }
    double* allocValue(double v)
    {
        values.push_back(v);
        return &values.back();
    }

    // Points first, then circle radii, then arc radius/start/end -- each in
    // creation order. The ORDER is part of the contract: it fixes the column
    // order of the Jacobian, and so which parameters a rank-revealing
    // decomposition reports as dependent.
    void collectUnknowns(GCS::VEC_pD& out) const
    {
        out.clear();
        for (const auto& p : points) {
            out.push_back(p.x);
            out.push_back(p.y);
        }
        for (const auto& c : circles) {
            out.push_back(c->rad);
        }
        for (const auto& a : arcs) {
            out.push_back(a->rad);
            out.push_back(a->startAngle);
            out.push_back(a->endAngle);
        }
    }

    forge_gcs_param describe(const double* p) const
    {
        forge_gcs_param out{FORGE_GCS_PARAM_UNKNOWN, -1};
        for (std::size_t i = 0; i < points.size(); ++i) {
            if (points[i].x == p) {
                return {FORGE_GCS_PARAM_POINT_X, static_cast<int32_t>(i)};
            }
            if (points[i].y == p) {
                return {FORGE_GCS_PARAM_POINT_Y, static_cast<int32_t>(i)};
            }
        }
        for (std::size_t c = 0; c < curves.size(); ++c) {
            const CurveRec& rec = curves[c];
            if (rec.kind == FORGE_GCS_CURVE_CIRCLE) {
                if (circles[rec.typed]->rad == p) {
                    return {FORGE_GCS_PARAM_CIRCLE_RADIUS, static_cast<int32_t>(c)};
                }
            }
            else if (rec.kind == FORGE_GCS_CURVE_ARC) {
                const GCS::Arc& a = *arcs[rec.typed];
                if (a.rad == p) {
                    return {FORGE_GCS_PARAM_ARC_RADIUS, static_cast<int32_t>(c)};
                }
                if (a.startAngle == p) {
                    return {FORGE_GCS_PARAM_ARC_START_ANGLE, static_cast<int32_t>(c)};
                }
                if (a.endAngle == p) {
                    return {FORGE_GCS_PARAM_ARC_END_ANGLE, static_cast<int32_t>(c)};
                }
            }
        }
        return out;
    }
};

namespace {

int32_t fail(forge_gcs_system* sys, int32_t code, const std::string& why)
{
    if (sys != nullptr) {
        try {
            sys->lastError = why;
        }
        catch (...) {  // NOLINT: assigning the message must not itself escape
        }
    }
    return code;
}

void ok(forge_gcs_system* sys)
{
    sys->lastError.clear();
}

// Runs `body`, converting any exception into FORGE_GCS_ERR_* on `sys`.
template<typename F>
int32_t guarded(forge_gcs_system* sys, const char* what, F&& body)
{
    if (sys == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    try {
        return body();
    }
    catch (const std::bad_alloc&) {
        return fail(sys, FORGE_GCS_ERR_NO_MEMORY, std::string(what) + ": out of memory");
    }
    catch (const std::exception& e) {
        return fail(sys, FORGE_GCS_ERR_INTERNAL, std::string(what) + ": the solver raised: " + e.what());
    }
    catch (...) {
        return fail(sys, FORGE_GCS_ERR_INTERNAL, std::string(what) + ": the solver raised an unknown exception");
    }
}

bool validPoint(const forge_gcs_system* sys, int32_t p)
{
    return p >= 0 && static_cast<std::size_t>(p) < sys->points.size();
}

bool validCurve(const forge_gcs_system* sys, int32_t c)
{
    return c >= 0 && static_cast<std::size_t>(c) < sys->curves.size();
}

const char* kindWord(int32_t kind)
{
    switch (kind) {
        case FORGE_GCS_CURVE_LINE:
            return "a line";
        case FORGE_GCS_CURVE_CIRCLE:
            return "a circle";
        case FORGE_GCS_CURVE_ARC:
            return "an arc";
        default:
            return "an unknown curve";
    }
}

// Typed resolution. Each returns nullptr after recording the failure.
struct Resolver {
    forge_gcs_system* sys;
    const int32_t* refs;
    int32_t count;
    int32_t code = FORGE_GCS_OK;

    GCS::Point* point(int32_t i)
    {
        if (code != FORGE_GCS_OK) {
            return nullptr;
        }
        const int32_t p = refs[i];
        if (!validPoint(sys, p)) {
            code = fail(sys, FORGE_GCS_ERR_BAD_POINT,
                        "operand " + std::to_string(i) + " (" + std::to_string(p) + ") is not a point of this system");
            return nullptr;
        }
        return &sys->points[static_cast<std::size_t>(p)];
    }
    const forge_gcs_system::CurveRec* curve(int32_t i)
    {
        if (code != FORGE_GCS_OK) {
            return nullptr;
        }
        const int32_t c = refs[i];
        if (!validCurve(sys, c)) {
            code = fail(sys, FORGE_GCS_ERR_BAD_CURVE,
                        "operand " + std::to_string(i) + " (" + std::to_string(c) + ") is not a curve of this system");
            return nullptr;
        }
        return &sys->curves[static_cast<std::size_t>(c)];
    }
    bool wrongKind(int32_t i, const forge_gcs_system::CurveRec* rec, const char* wanted)
    {
        code = fail(sys, FORGE_GCS_ERR_CURVE_KIND,
                    "operand " + std::to_string(i) + " is " + kindWord(rec->kind) + ", not " + wanted);
        return false;
    }
    GCS::Line* line(int32_t i)
    {
        const auto* rec = curve(i);
        if (rec == nullptr) {
            return nullptr;
        }
        if (rec->kind != FORGE_GCS_CURVE_LINE) {
            wrongKind(i, rec, "a line");
            return nullptr;
        }
        return sys->lines[rec->typed].get();
    }
    GCS::Circle* circle(int32_t i)
    {
        const auto* rec = curve(i);
        if (rec == nullptr) {
            return nullptr;
        }
        if (rec->kind != FORGE_GCS_CURVE_CIRCLE) {
            wrongKind(i, rec, "a circle");
            return nullptr;
        }
        return sys->circles[rec->typed].get();
    }
    GCS::Arc* arc(int32_t i)
    {
        const auto* rec = curve(i);
        if (rec == nullptr) {
            return nullptr;
        }
        if (rec->kind != FORGE_GCS_CURVE_ARC) {
            wrongKind(i, rec, "an arc");
            return nullptr;
        }
        return sys->arcs[rec->typed].get();
    }
    // A circle or an arc as planegcs's Circle (GCS::Arc derives from GCS::Circle).
    GCS::Circle* conic(int32_t i)
    {
        const auto* rec = curve(i);
        if (rec == nullptr) {
            return nullptr;
        }
        if (rec->kind == FORGE_GCS_CURVE_CIRCLE) {
            return sys->circles[rec->typed].get();
        }
        if (rec->kind == FORGE_GCS_CURVE_ARC) {
            return sys->arcs[rec->typed].get();
        }
        wrongKind(i, rec, "a circle or an arc");
        return nullptr;
    }
};

int32_t operandsNeeded(int32_t primitive)
{
    switch (primitive) {
        case FORGE_GCS_HORIZONTAL_LINE:
        case FORGE_GCS_VERTICAL_LINE:
        case FORGE_GCS_CIRCLE_RADIUS:
        case FORGE_GCS_CIRCLE_DIAMETER:
        case FORGE_GCS_COORDINATE_X:
        case FORGE_GCS_COORDINATE_Y:
            return 1;
        case FORGE_GCS_P2P_SYMMETRIC_LINE:
        case FORGE_GCS_P2P_SYMMETRIC_POINT:
            return 3;
        case FORGE_GCS_P2P_COINCIDENT:
        case FORGE_GCS_PARALLEL:
        case FORGE_GCS_PERPENDICULAR:
        case FORGE_GCS_P2P_DISTANCE:
        case FORGE_GCS_HORIZONTAL_POINTS:
        case FORGE_GCS_VERTICAL_POINTS:
        case FORGE_GCS_POINT_ON_LINE:
        case FORGE_GCS_POINT_ON_CIRCLE:
        case FORGE_GCS_POINT_ON_ARC:
        case FORGE_GCS_EQUAL_LENGTH:
        case FORGE_GCS_EQUAL_RADIUS:
        case FORGE_GCS_TANGENT_LINE_CIRCLE:
        case FORGE_GCS_TANGENT_LINE_ARC:
        case FORGE_GCS_TANGENT_CIRCLE_CIRCLE:
        case FORGE_GCS_TANGENT_ARC_ARC:
        case FORGE_GCS_TANGENT_CIRCLE_ARC:
        case FORGE_GCS_L2L_ANGLE:
        case FORGE_GCS_P2P_ANGLE:
        case FORGE_GCS_DIFFERENCE_X:
        case FORGE_GCS_DIFFERENCE_Y:
            return 2;
        default:
            return -1;
    }
}

int32_t copyOut(const std::vector<int>& src, int32_t* buf, int32_t capacity)
{
    const auto n = static_cast<int32_t>(src.size());
    for (int32_t i = 0; i < n && i < capacity && buf != nullptr; ++i) {
        buf[i] = static_cast<int32_t>(src[static_cast<std::size_t>(i)]);
    }
    return n;
}

}  // namespace

extern "C" {

uint32_t forge_gcs_abi_version(void)
{
    return FORGE_GCS_ABI_VERSION;
}

const char* forge_gcs_build_description(void)
{
    return "libforge_gcs ABI 1: FreeCAD planegcs at 0a45a0a008d4af7a85601016c5ab31bd26c25b22, "
           "modified for Forge 2026-09-15 (LGPL-2.1-or-later)";
}

void forge_gcs_set_log_sink(forge_gcs_log_fn fn, void* user)
{
    std::lock_guard<std::mutex> lock(g_sinkMutex);
    g_sink = fn;
    g_sinkUser = user;
}

forge_gcs_system* forge_gcs_create(void)
{
    try {
        return new forge_gcs_system();
    }
    catch (...) {
        return nullptr;
    }
}

void forge_gcs_destroy(forge_gcs_system* sys)
{
    try {
        delete sys;
    }
    catch (...) {  // NOLINT: a destructor that raised must not cross the C boundary
    }
}

const char* forge_gcs_last_error(const forge_gcs_system* sys)
{
    if (sys == nullptr) {
        return "no solver system (NULL handle)";
    }
    return sys->lastError.c_str();
}

int32_t forge_gcs_add_point(forge_gcs_system* sys, double x, double y)
{
    return guarded(sys, "add_point", [&]() -> int32_t {
        GCS::Point p;
        p.x = sys->allocUnknown(x);
        p.y = sys->allocUnknown(y);
        sys->points.push_back(p);
        ok(sys);
        return static_cast<int32_t>(sys->points.size() - 1);
    });
}

int32_t forge_gcs_add_line(forge_gcs_system* sys, int32_t p1, int32_t p2)
{
    return guarded(sys, "add_line", [&]() -> int32_t {
        if (!validPoint(sys, p1) || !validPoint(sys, p2)) {
            return fail(sys, FORGE_GCS_ERR_BAD_POINT, "add_line: an endpoint is not a point of this system");
        }
        auto line = std::make_unique<GCS::Line>();
        line->p1 = sys->points[static_cast<std::size_t>(p1)];
        line->p2 = sys->points[static_cast<std::size_t>(p2)];
        sys->lines.push_back(std::move(line));
        sys->curves.push_back({FORGE_GCS_CURVE_LINE, sys->lines.size() - 1, p1, p2, -1});
        ok(sys);
        return static_cast<int32_t>(sys->curves.size() - 1);
    });
}

int32_t forge_gcs_add_circle(forge_gcs_system* sys, int32_t center, double radius)
{
    return guarded(sys, "add_circle", [&]() -> int32_t {
        if (!validPoint(sys, center)) {
            return fail(sys, FORGE_GCS_ERR_BAD_POINT, "add_circle: the centre is not a point of this system");
        }
        auto circle = std::make_unique<GCS::Circle>();
        circle->center = sys->points[static_cast<std::size_t>(center)];
        circle->rad = sys->allocUnknown(radius);
        sys->circles.push_back(std::move(circle));
        sys->curves.push_back({FORGE_GCS_CURVE_CIRCLE, sys->circles.size() - 1, -1, -1, center});
        ok(sys);
        return static_cast<int32_t>(sys->curves.size() - 1);
    });
}

int32_t forge_gcs_add_arc(forge_gcs_system* sys, int32_t center, int32_t start, int32_t end,
                          double radius, double start_angle, double end_angle)
{
    return guarded(sys, "add_arc", [&]() -> int32_t {
        if (!validPoint(sys, center) || !validPoint(sys, start) || !validPoint(sys, end)) {
            return fail(sys, FORGE_GCS_ERR_BAD_POINT,
                        "add_arc: the centre, start or end is not a point of this system");
        }
        auto arc = std::make_unique<GCS::Arc>();
        arc->center = sys->points[static_cast<std::size_t>(center)];
        arc->start = sys->points[static_cast<std::size_t>(start)];
        arc->end = sys->points[static_cast<std::size_t>(end)];
        arc->rad = sys->allocUnknown(radius);
        arc->startAngle = sys->allocUnknown(start_angle);
        arc->endAngle = sys->allocUnknown(end_angle);
        sys->arcs.push_back(std::move(arc));
        sys->curves.push_back({FORGE_GCS_CURVE_ARC, sys->arcs.size() - 1, start, end, center});
        ok(sys);
        return static_cast<int32_t>(sys->curves.size() - 1);
    });
}

int32_t forge_gcs_point_count(const forge_gcs_system* sys)
{
    return sys == nullptr ? FORGE_GCS_ERR_NULL : static_cast<int32_t>(sys->points.size());
}

int32_t forge_gcs_curve_count(const forge_gcs_system* sys)
{
    return sys == nullptr ? FORGE_GCS_ERR_NULL : static_cast<int32_t>(sys->curves.size());
}

int32_t forge_gcs_get_point(const forge_gcs_system* sys, int32_t p, double* x, double* y)
{
    if (sys == nullptr || x == nullptr || y == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    if (!validPoint(sys, p)) {
        return FORGE_GCS_ERR_BAD_POINT;
    }
    const GCS::Point& pt = sys->points[static_cast<std::size_t>(p)];
    *x = *pt.x;
    *y = *pt.y;
    return FORGE_GCS_OK;
}

int32_t forge_gcs_set_point(forge_gcs_system* sys, int32_t p, double x, double y)
{
    if (sys == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    if (!validPoint(sys, p)) {
        return fail(sys, FORGE_GCS_ERR_BAD_POINT, "set_point: not a point of this system");
    }
    GCS::Point& pt = sys->points[static_cast<std::size_t>(p)];
    *pt.x = x;
    *pt.y = y;
    ok(sys);
    return FORGE_GCS_OK;
}

int32_t forge_gcs_get_curve(const forge_gcs_system* sys, int32_t c, forge_gcs_curve* out)
{
    if (sys == nullptr || out == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    if (!validCurve(sys, c)) {
        return FORGE_GCS_ERR_BAD_CURVE;
    }
    const forge_gcs_system::CurveRec& rec = sys->curves[static_cast<std::size_t>(c)];
    out->kind = rec.kind;
    out->p1 = rec.p1;
    out->p2 = rec.p2;
    out->center = rec.center;
    out->radius = 0.0;
    out->start_angle = 0.0;
    out->end_angle = 0.0;
    if (rec.kind == FORGE_GCS_CURVE_CIRCLE) {
        out->radius = *sys->circles[rec.typed]->rad;
    }
    else if (rec.kind == FORGE_GCS_CURVE_ARC) {
        const GCS::Arc& a = *sys->arcs[rec.typed];
        out->radius = *a.rad;
        out->start_angle = *a.startAngle;
        out->end_angle = *a.endAngle;
    }
    return FORGE_GCS_OK;
}

int32_t forge_gcs_add_constraint(forge_gcs_system* sys, int32_t primitive, const int32_t* refs,
                                 int32_t ref_count, double value, int32_t flags, int32_t tag)
{
    return guarded(sys, "add_constraint", [&]() -> int32_t {
        const int32_t need = operandsNeeded(primitive);
        if (need < 0) {
            return fail(sys, FORGE_GCS_ERR_ARGUMENT,
                        "add_constraint: " + std::to_string(primitive) + " is not a constraint primitive");
        }
        if (ref_count < need || (need > 0 && refs == nullptr)) {
            return fail(sys, FORGE_GCS_ERR_ARGUMENT,
                        "add_constraint: primitive " + std::to_string(primitive) + " needs " +
                            std::to_string(need) + " operand(s), got " + std::to_string(ref_count));
        }
        if (!std::isfinite(value)) {
            return fail(sys, FORGE_GCS_ERR_ARGUMENT, "add_constraint: the value is not a finite number");
        }
        Resolver r{sys, refs, ref_count};
        const bool ccw = (flags & FORGE_GCS_FLAG_CCW) != 0;
        GCS::System& g = sys->gcs;
        switch (primitive) {
            case FORGE_GCS_P2P_COINCIDENT: {
                auto* a = r.point(0);
                auto* b = r.point(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintP2PCoincident(*a, *b, tag);
                break;
            }
            case FORGE_GCS_PARALLEL:
            case FORGE_GCS_PERPENDICULAR:
            case FORGE_GCS_EQUAL_LENGTH: {
                auto* a = r.line(0);
                auto* b = r.line(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                if (primitive == FORGE_GCS_PARALLEL) {
                    g.addConstraintParallel(*a, *b, tag);
                }
                else if (primitive == FORGE_GCS_PERPENDICULAR) {
                    g.addConstraintPerpendicular(*a, *b, tag);
                }
                else {
                    g.addConstraintEqualLength(*a, *b, tag);
                }
                break;
            }
            case FORGE_GCS_P2P_DISTANCE: {
                auto* a = r.point(0);
                auto* b = r.point(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintP2PDistance(*a, *b, sys->allocValue(value), tag);
                break;
            }
            case FORGE_GCS_HORIZONTAL_LINE:
            case FORGE_GCS_VERTICAL_LINE: {
                auto* l = r.line(0);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                if (primitive == FORGE_GCS_HORIZONTAL_LINE) {
                    g.addConstraintHorizontal(*l, tag);
                }
                else {
                    g.addConstraintVertical(*l, tag);
                }
                break;
            }
            case FORGE_GCS_HORIZONTAL_POINTS:
            case FORGE_GCS_VERTICAL_POINTS: {
                auto* a = r.point(0);
                auto* b = r.point(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                if (primitive == FORGE_GCS_HORIZONTAL_POINTS) {
                    g.addConstraintHorizontal(*a, *b, tag);
                }
                else {
                    g.addConstraintVertical(*a, *b, tag);
                }
                break;
            }
            case FORGE_GCS_POINT_ON_LINE: {
                auto* p = r.point(0);
                auto* l = r.line(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintPointOnLine(*p, *l, tag);
                break;
            }
            case FORGE_GCS_POINT_ON_CIRCLE: {
                auto* p = r.point(0);
                auto* c = r.circle(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintPointOnCircle(*p, *c, tag);
                break;
            }
            case FORGE_GCS_POINT_ON_ARC: {
                auto* p = r.point(0);
                auto* a = r.arc(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintPointOnArc(*p, *a, tag);
                break;
            }
            case FORGE_GCS_EQUAL_RADIUS: {
                auto* a = r.conic(0);
                auto* b = r.conic(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintEqualRadius(*a, *b, tag);
                break;
            }
            case FORGE_GCS_TANGENT_LINE_CIRCLE: {
                auto* l = r.line(0);
                auto* c = r.circle(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintTangent(*l, *c, ccw, tag);
                break;
            }
            case FORGE_GCS_TANGENT_LINE_ARC: {
                auto* l = r.line(0);
                auto* a = r.arc(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintTangent(*l, *a, ccw, tag);
                break;
            }
            case FORGE_GCS_TANGENT_CIRCLE_CIRCLE: {
                auto* a = r.circle(0);
                auto* b = r.circle(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintTangent(*a, *b, tag);
                break;
            }
            case FORGE_GCS_TANGENT_ARC_ARC: {
                auto* a = r.arc(0);
                auto* b = r.arc(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintTangent(*a, *b, tag);
                break;
            }
            case FORGE_GCS_TANGENT_CIRCLE_ARC: {
                auto* c = r.circle(0);
                auto* a = r.arc(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintTangent(*c, *a, tag);
                break;
            }
            case FORGE_GCS_CIRCLE_RADIUS:
            case FORGE_GCS_CIRCLE_DIAMETER: {
                auto* c = r.conic(0);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                if (primitive == FORGE_GCS_CIRCLE_RADIUS) {
                    g.addConstraintCircleRadius(*c, sys->allocValue(value), tag);
                }
                else {
                    g.addConstraintCircleDiameter(*c, sys->allocValue(value), tag);
                }
                break;
            }
            case FORGE_GCS_L2L_ANGLE: {
                auto* a = r.line(0);
                auto* b = r.line(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintL2LAngle(*a, *b, sys->allocValue(value), tag);
                break;
            }
            case FORGE_GCS_P2P_ANGLE: {
                auto* a = r.point(0);
                auto* b = r.point(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                // The five-argument overload. planegcs's four-argument
                // addConstraintP2PAngle(p1, p2, angle, tagId) discards tagId and
                // registers the primitive under tag 0, where no per-tag query
                // (error, clear, conflict report) can reach it.
                g.addConstraintP2PAngle(*a, *b, sys->allocValue(value), 0.0, tag);
                break;
            }
            case FORGE_GCS_P2P_SYMMETRIC_LINE: {
                auto* a = r.point(0);
                auto* b = r.point(1);
                auto* l = r.line(2);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintP2PSymmetric(*a, *b, *l, tag);
                break;
            }
            case FORGE_GCS_P2P_SYMMETRIC_POINT: {
                auto* a = r.point(0);
                auto* b = r.point(1);
                auto* m = r.point(2);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                g.addConstraintP2PSymmetric(*a, *b, *m, tag);
                break;
            }
            case FORGE_GCS_COORDINATE_X:
            case FORGE_GCS_COORDINATE_Y: {
                auto* p = r.point(0);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                if (primitive == FORGE_GCS_COORDINATE_X) {
                    g.addConstraintCoordinateX(*p, sys->allocValue(value), tag);
                }
                else {
                    g.addConstraintCoordinateY(*p, sys->allocValue(value), tag);
                }
                break;
            }
            case FORGE_GCS_DIFFERENCE_X:
            case FORGE_GCS_DIFFERENCE_Y: {
                auto* a = r.point(0);
                auto* b = r.point(1);
                if (r.code != FORGE_GCS_OK) {
                    return r.code;
                }
                if (primitive == FORGE_GCS_DIFFERENCE_X) {
                    g.addConstraintDifference(a->x, b->x, sys->allocValue(value), tag);
                }
                else {
                    g.addConstraintDifference(a->y, b->y, sys->allocValue(value), tag);
                }
                break;
            }
            default:
                return fail(sys, FORGE_GCS_ERR_ARGUMENT, "add_constraint: unhandled primitive");
        }
        ok(sys);
        return FORGE_GCS_OK;
    });
}

int32_t forge_gcs_clear_tag(forge_gcs_system* sys, int32_t tag)
{
    return guarded(sys, "clear_tag", [&]() -> int32_t {
        sys->gcs.clearByTag(tag);
        // The cached rank analysis describes a system that no longer exists.
        sys->gcs.invalidatedDiagnosis();
        ok(sys);
        return FORGE_GCS_OK;
    });
}

namespace {
// GCS::System::_getNumberOfConstraints is the unit-testing interface FreeCAD's
// own tests use; it is protected, so it is reached through a subclass view.
struct CountingView : GCS::System {
    static std::size_t count(GCS::System& s, int tag)
    {
        return (s.*(&CountingView::_getNumberOfConstraints))(tag);
    }
};
}  // namespace

int32_t forge_gcs_constraint_count(const forge_gcs_system* sys, int32_t tag)
{
    if (sys == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    auto* mut = const_cast<forge_gcs_system*>(sys);
    return static_cast<int32_t>(CountingView::count(mut->gcs, tag < 0 ? -1 : tag));
}

double forge_gcs_error_by_tag(forge_gcs_system* sys, int32_t tag)
{
    if (sys == nullptr) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    try {
        return sys->gcs.calculateConstraintErrorByTag(tag);
    }
    catch (...) {
        fail(sys, FORGE_GCS_ERR_INTERNAL, "error_by_tag: the solver raised");
        return std::numeric_limits<double>::quiet_NaN();
    }
}

int32_t forge_gcs_solve(forge_gcs_system* sys, int32_t algorithm, int32_t* status)
{
    return guarded(sys, "solve", [&]() -> int32_t {
        if (status == nullptr) {
            return fail(sys, FORGE_GCS_ERR_NULL, "solve: no place to write the status");
        }
        if (algorithm < FORGE_GCS_BFGS || algorithm > FORGE_GCS_DOGLEG) {
            return fail(sys, FORGE_GCS_ERR_ARGUMENT, "solve: unknown algorithm");
        }
        const auto alg = static_cast<GCS::Algorithm>(algorithm);
        GCS::VEC_pD unknowns;
        sys->collectUnknowns(unknowns);
        sys->gcs.declareUnknowns(unknowns);
        sys->gcs.initSolution(alg);
        *status = sys->gcs.solve(/*isFine=*/true, alg);
        ok(sys);
        return FORGE_GCS_OK;
    });
}

int32_t forge_gcs_apply_solution(forge_gcs_system* sys)
{
    return guarded(sys, "apply_solution", [&]() -> int32_t {
        sys->gcs.applySolution();
        ok(sys);
        return FORGE_GCS_OK;
    });
}

int32_t forge_gcs_diagnose(forge_gcs_system* sys, int32_t algorithm, forge_gcs_diagnosis* out)
{
    return guarded(sys, "diagnose", [&]() -> int32_t {
        if (out == nullptr) {
            return fail(sys, FORGE_GCS_ERR_NULL, "diagnose: no place to write the diagnosis");
        }
        if (algorithm < FORGE_GCS_BFGS || algorithm > FORGE_GCS_DOGLEG) {
            return fail(sys, FORGE_GCS_ERR_ARGUMENT, "diagnose: unknown algorithm");
        }
        const auto alg = static_cast<GCS::Algorithm>(algorithm);
        GCS::VEC_pD unknowns;
        sys->collectUnknowns(unknowns);
        sys->gcs.declareUnknowns(unknowns);
        sys->gcs.initSolution(alg);
        sys->gcs.diagnose(alg);
        ok(sys);
        return forge_gcs_get_diagnosis(sys, out);
    });
}

int32_t forge_gcs_get_diagnosis(const forge_gcs_system* sys, forge_gcs_diagnosis* out)
{
    if (sys == nullptr || out == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    out->dof = sys->gcs.dofsNumber();
    out->empty_matrix = sys->gcs.isEmptyDiagnoseMatrix() ? 1 : 0;
    out->has_conflicting = sys->gcs.hasConflicting() ? 1 : 0;
    out->has_redundant = sys->gcs.hasRedundant() ? 1 : 0;
    out->has_partially_redundant = sys->gcs.hasPartiallyRedundant() ? 1 : 0;
    return FORGE_GCS_OK;
}

int32_t forge_gcs_get_tags(const forge_gcs_system* sys, int32_t which, int32_t* buf,
                           int32_t capacity)
{
    if (sys == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    if (capacity < 0 || (capacity > 0 && buf == nullptr)) {
        return FORGE_GCS_ERR_ARGUMENT;
    }
    GCS::VEC_I tags;
    switch (which) {
        case FORGE_GCS_TAGS_CONFLICTING:
            sys->gcs.getConflicting(tags);
            break;
        case FORGE_GCS_TAGS_REDUNDANT:
            sys->gcs.getRedundant(tags);
            break;
        case FORGE_GCS_TAGS_PARTIALLY_REDUNDANT:
            sys->gcs.getPartiallyRedundant(tags);
            break;
        case FORGE_GCS_TAGS_PROPOSED_REMOVAL:
            sys->gcs.getProposedRemovals(tags);
            break;
        default:
            return FORGE_GCS_ERR_ARGUMENT;
    }
    return copyOut(tags, buf, capacity);
}

int32_t forge_gcs_conflict_group_count(const forge_gcs_system* sys)
{
    if (sys == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    std::vector<GCS::VEC_I> groups;
    sys->gcs.getConflictingGroups(groups);
    return static_cast<int32_t>(groups.size());
}

int32_t forge_gcs_get_conflict_group(const forge_gcs_system* sys, int32_t group, int32_t* buf,
                                     int32_t capacity)
{
    if (sys == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    if (capacity < 0 || (capacity > 0 && buf == nullptr)) {
        return FORGE_GCS_ERR_ARGUMENT;
    }
    std::vector<GCS::VEC_I> groups;
    sys->gcs.getConflictingGroups(groups);
    if (group < 0 || static_cast<std::size_t>(group) >= groups.size()) {
        return FORGE_GCS_ERR_ARGUMENT;
    }
    return copyOut(groups[static_cast<std::size_t>(group)], buf, capacity);
}

int32_t forge_gcs_get_dependent_params(const forge_gcs_system* sys, forge_gcs_param* buf,
                                       int32_t capacity)
{
    if (sys == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    if (capacity < 0 || (capacity > 0 && buf == nullptr)) {
        return FORGE_GCS_ERR_ARGUMENT;
    }
    GCS::VEC_pD dependent;
    sys->gcs.getDependentParams(dependent);
    const auto n = static_cast<int32_t>(dependent.size());
    for (int32_t i = 0; i < n && i < capacity; ++i) {
        buf[i] = sys->describe(dependent[static_cast<std::size_t>(i)]);
    }
    return n;
}

int32_t forge_gcs_dependent_group_count(const forge_gcs_system* sys)
{
    if (sys == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    std::vector<std::vector<double*>> groups;
    sys->gcs.getDependentParamsGroups(groups);
    return static_cast<int32_t>(groups.size());
}

int32_t forge_gcs_get_dependent_group(const forge_gcs_system* sys, int32_t group,
                                      forge_gcs_param* buf, int32_t capacity)
{
    if (sys == nullptr) {
        return FORGE_GCS_ERR_NULL;
    }
    if (capacity < 0 || (capacity > 0 && buf == nullptr)) {
        return FORGE_GCS_ERR_ARGUMENT;
    }
    std::vector<std::vector<double*>> groups;
    sys->gcs.getDependentParamsGroups(groups);
    if (group < 0 || static_cast<std::size_t>(group) >= groups.size()) {
        return FORGE_GCS_ERR_ARGUMENT;
    }
    const std::vector<double*>& members = groups[static_cast<std::size_t>(group)];
    const auto n = static_cast<int32_t>(members.size());
    for (int32_t i = 0; i < n && i < capacity; ++i) {
        buf[i] = sys->describe(members[static_cast<std::size_t>(i)]);
    }
    return n;
}

}  // extern "C"
