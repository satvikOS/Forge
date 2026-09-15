/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * forge_gcs.h -- the C ABI of libforge_gcs.
 *
 * libforge_gcs is a modified version of FreeCAD's planegcs 2D geometric
 * constraint solver (FreeCAD commit 0a45a0a008d4af7a85601016c5ab31bd26c25b22,
 * src/Mod/Sketcher/App/planegcs/), licensed LGPL-2.1-or-later. This header and
 * src/forge_gcs.cpp were written for Forge on 2026-09-15 and are part of that
 * modified library; see ../../MODIFICATIONS.md and ../../COPYING.LGPL.
 *
 * WHY A C ABI. planegcs's own interface is C++ classes whose layouts contain
 * Eigen and Boost types. Exposing those would tie every program that links the
 * library to one Eigen version, one Boost version and one compiler, and it would
 * make "relink against a modified copy of the library" -- the freedom LGPL-2.1
 * section 6 protects -- a matter of luck. This interface carries only fixed-size
 * integers, doubles and opaque handles, and it is versioned
 * (forge_gcs_abi_version), so a rebuilt library can replace the installed one
 * and a mismatched one is detected instead of misread.
 *
 * ERROR MODEL. No function throws and none aborts on bad input. Every function
 * that can fail returns a negative forge_gcs_result, and forge_gcs_last_error()
 * then describes the failure in a sentence. An exception raised inside the
 * solver is caught at this boundary and reported as FORGE_GCS_ERR_INTERNAL.
 *
 * WHAT IS NOT HERE. The interface exposes solver primitives, one per planegcs
 * System::addConstraint* entry point it covers. What a *sketch* constraint means
 * (for example that "collinear" is parallel plus a point on the line) is decided
 * by the program using the library, not by the library.
 */
#ifndef FORGE_GCS_H
#define FORGE_GCS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32)
#  if defined(FORGE_GCS_BUILDING)
#    define FORGE_GCS_API __declspec(dllexport)
#  else
#    define FORGE_GCS_API __declspec(dllimport)
#  endif
#else
#  define FORGE_GCS_API __attribute__((visibility("default")))
#endif

/* Bumped whenever a signature, a struct layout or an enumerator value changes. */
#define FORGE_GCS_ABI_VERSION 1u

typedef struct forge_gcs_system forge_gcs_system;

typedef enum forge_gcs_result {
    FORGE_GCS_OK = 0,
    FORGE_GCS_ERR_NULL = -1,        /* a required pointer argument was NULL          */
    FORGE_GCS_ERR_BAD_POINT = -2,   /* a point index does not name a point           */
    FORGE_GCS_ERR_BAD_CURVE = -3,   /* a curve index does not name a curve           */
    FORGE_GCS_ERR_CURVE_KIND = -4,  /* the curve is not of the kind the call needs   */
    FORGE_GCS_ERR_ARGUMENT = -5,    /* an unknown enumerator, count or index          */
    FORGE_GCS_ERR_NO_MEMORY = -6,
    FORGE_GCS_ERR_INTERNAL = -7     /* the solver raised; see forge_gcs_last_error() */
} forge_gcs_result;

typedef enum forge_gcs_curve_kind {
    FORGE_GCS_CURVE_LINE = 1,
    FORGE_GCS_CURVE_CIRCLE = 2,
    FORGE_GCS_CURVE_ARC = 3
} forge_gcs_curve_kind;

/*
 * Constraint primitives. `refs` lists point indices and curve indices in the
 * order shown; "conic" accepts a circle or an arc. `value` is read only where
 * noted (lengths in model units, angles in RADIANS). `flags` is read only by
 * the tangent-to-line primitives.
 */
typedef enum forge_gcs_primitive {
    FORGE_GCS_P2P_COINCIDENT = 1,        /* point, point                      */
    FORGE_GCS_PARALLEL = 2,              /* line, line                        */
    FORGE_GCS_PERPENDICULAR = 3,         /* line, line                        */
    FORGE_GCS_P2P_DISTANCE = 4,          /* point, point            value     */
    FORGE_GCS_HORIZONTAL_LINE = 5,       /* line                              */
    FORGE_GCS_HORIZONTAL_POINTS = 6,     /* point, point                      */
    FORGE_GCS_VERTICAL_LINE = 7,         /* line                              */
    FORGE_GCS_VERTICAL_POINTS = 8,       /* point, point                      */
    FORGE_GCS_POINT_ON_LINE = 9,         /* point, line                       */
    FORGE_GCS_POINT_ON_CIRCLE = 10,      /* point, circle                     */
    FORGE_GCS_POINT_ON_ARC = 11,         /* point, arc                        */
    FORGE_GCS_EQUAL_LENGTH = 12,         /* line, line                        */
    FORGE_GCS_EQUAL_RADIUS = 13,         /* conic, conic                      */
    FORGE_GCS_TANGENT_LINE_CIRCLE = 14,  /* line, circle             flags    */
    FORGE_GCS_TANGENT_LINE_ARC = 15,     /* line, arc                flags    */
    FORGE_GCS_TANGENT_CIRCLE_CIRCLE = 16,/* circle, circle                    */
    FORGE_GCS_TANGENT_ARC_ARC = 17,      /* arc, arc                          */
    FORGE_GCS_TANGENT_CIRCLE_ARC = 18,   /* circle, arc                       */
    FORGE_GCS_CIRCLE_RADIUS = 19,        /* conic                    value    */
    FORGE_GCS_CIRCLE_DIAMETER = 20,      /* conic                    value    */
    FORGE_GCS_L2L_ANGLE = 21,            /* line, line               value    */
    FORGE_GCS_P2P_ANGLE = 22,            /* point, point             value    */
    FORGE_GCS_P2P_SYMMETRIC_LINE = 23,   /* point, point, line                */
    FORGE_GCS_P2P_SYMMETRIC_POINT = 24,  /* point, point, point               */
    FORGE_GCS_COORDINATE_X = 25,         /* point                    value    */
    FORGE_GCS_COORDINATE_Y = 26,         /* point                    value    */
    FORGE_GCS_DIFFERENCE_X = 27,         /* point a, point b   value = xb - xa */
    FORGE_GCS_DIFFERENCE_Y = 28          /* point a, point b   value = yb - ya */
} forge_gcs_primitive;

/* flags */
#define FORGE_GCS_FLAG_CCW 1   /* tangent-to-line: planegcs's side selector (ccw = true) */

typedef enum forge_gcs_algorithm {
    FORGE_GCS_BFGS = 0,
    FORGE_GCS_LEVENBERG_MARQUARDT = 1,
    FORGE_GCS_DOGLEG = 2
} forge_gcs_algorithm;

/* planegcs's own solve outcomes (GCS::SolveStatus), unchanged. */
typedef enum forge_gcs_solve_status {
    FORGE_GCS_SOLVE_SUCCESS = 0,          /* the error function was driven to zero   */
    FORGE_GCS_SOLVE_CONVERGED = 1,        /* minimised, not zeroed                   */
    FORGE_GCS_SOLVE_FAILED = 2,
    FORGE_GCS_SOLVE_SUCCESS_INVALID = 3
} forge_gcs_solve_status;

typedef enum forge_gcs_tag_list {
    FORGE_GCS_TAGS_CONFLICTING = 0,
    FORGE_GCS_TAGS_REDUNDANT = 1,
    FORGE_GCS_TAGS_PARTIALLY_REDUNDANT = 2,
    FORGE_GCS_TAGS_PROPOSED_REMOVAL = 3
} forge_gcs_tag_list;

typedef enum forge_gcs_param_role {
    FORGE_GCS_PARAM_POINT_X = 0,
    FORGE_GCS_PARAM_POINT_Y = 1,
    FORGE_GCS_PARAM_CIRCLE_RADIUS = 2,
    FORGE_GCS_PARAM_ARC_RADIUS = 3,
    FORGE_GCS_PARAM_ARC_START_ANGLE = 4,
    FORGE_GCS_PARAM_ARC_END_ANGLE = 5,
    FORGE_GCS_PARAM_UNKNOWN = 255
} forge_gcs_param_role;

typedef struct forge_gcs_param {
    int32_t role;   /* forge_gcs_param_role                                    */
    int32_t owner;  /* point index for POINT_X/Y, curve index otherwise; -1 if unknown */
} forge_gcs_param;

typedef struct forge_gcs_curve {
    int32_t kind;   /* forge_gcs_curve_kind                                     */
    int32_t p1;     /* line: first point.  arc: start point.  circle: -1         */
    int32_t p2;     /* line: second point. arc: end point.    circle: -1         */
    int32_t center; /* circle / arc: centre point.            line: -1           */
    double radius;  /* circle / arc: the live radius parameter                   */
    double start_angle; /* arc: the live start-angle parameter (radians)         */
    double end_angle;   /* arc: the live end-angle parameter (radians)           */
} forge_gcs_curve;

typedef struct forge_gcs_diagnosis {
    int32_t dof;                     /* remaining degrees of freedom; -1 = not diagnosable */
    int32_t empty_matrix;            /* 1 when no driving constraint exists                */
    int32_t has_conflicting;
    int32_t has_redundant;
    int32_t has_partially_redundant;
} forge_gcs_diagnosis;

typedef void (*forge_gcs_log_fn)(void* user, int32_t level, const char* message);

/* ── library identity ─────────────────────────────────────────────────── */
FORGE_GCS_API uint32_t forge_gcs_abi_version(void);
/* A one-line description naming the upstream commit and the modification date. */
FORGE_GCS_API const char* forge_gcs_build_description(void);
/* Solver diagnostics go to `fn` (level 0 log, 1 warning). NULL discards them. */
FORGE_GCS_API void forge_gcs_set_log_sink(forge_gcs_log_fn fn, void* user);

/* ── systems ──────────────────────────────────────────────────────────── */
FORGE_GCS_API forge_gcs_system* forge_gcs_create(void);           /* NULL on no memory */
FORGE_GCS_API void forge_gcs_destroy(forge_gcs_system* sys);       /* NULL is a no-op   */
/* The last failure on `sys` as a sentence; "" when the last call succeeded. */
FORGE_GCS_API const char* forge_gcs_last_error(const forge_gcs_system* sys);

/* ── geometry; each returns the new index (>= 0) or a forge_gcs_result ─── */
FORGE_GCS_API int32_t forge_gcs_add_point(forge_gcs_system* sys, double x, double y);
FORGE_GCS_API int32_t forge_gcs_add_line(forge_gcs_system* sys, int32_t p1, int32_t p2);
FORGE_GCS_API int32_t forge_gcs_add_circle(forge_gcs_system* sys, int32_t center, double radius);
FORGE_GCS_API int32_t forge_gcs_add_arc(forge_gcs_system* sys, int32_t center, int32_t start,
                                        int32_t end, double radius, double start_angle,
                                        double end_angle);
FORGE_GCS_API int32_t forge_gcs_point_count(const forge_gcs_system* sys);
FORGE_GCS_API int32_t forge_gcs_curve_count(const forge_gcs_system* sys);
FORGE_GCS_API int32_t forge_gcs_get_point(const forge_gcs_system* sys, int32_t p, double* x,
                                          double* y);
FORGE_GCS_API int32_t forge_gcs_set_point(forge_gcs_system* sys, int32_t p, double x, double y);
FORGE_GCS_API int32_t forge_gcs_get_curve(const forge_gcs_system* sys, int32_t c,
                                          forge_gcs_curve* out);

/* ── constraints ──────────────────────────────────────────────────────── */
/* Adds one primitive under `tag`. Tags >= 1 are ordinary; see planegcs for the
 * meaning of tag 0 (priority) and negative tags (temporary). */
FORGE_GCS_API int32_t forge_gcs_add_constraint(forge_gcs_system* sys, int32_t primitive,
                                               const int32_t* refs, int32_t ref_count,
                                               double value, int32_t flags, int32_t tag);
/* Removes every primitive carrying `tag` and invalidates the cached diagnosis. */
FORGE_GCS_API int32_t forge_gcs_clear_tag(forge_gcs_system* sys, int32_t tag);
/* Primitives carrying `tag`, or all primitives when tag < 0. */
FORGE_GCS_API int32_t forge_gcs_constraint_count(const forge_gcs_system* sys, int32_t tag);
/* planegcs's per-tag error (RMS over the tag's primitives; signed when there is
 * one). NaN when no primitive carries the tag or `sys` is NULL. */
FORGE_GCS_API double forge_gcs_error_by_tag(forge_gcs_system* sys, int32_t tag);

/* ── solving ──────────────────────────────────────────────────────────── */
/* Declares every point coordinate, circle radius and arc radius/angle as an
 * unknown (points first, then circles, then arcs, each in creation order),
 * prepares the solution and solves. Geometry is NOT modified until
 * forge_gcs_apply_solution(). *status receives a forge_gcs_solve_status. */
FORGE_GCS_API int32_t forge_gcs_solve(forge_gcs_system* sys, int32_t algorithm,
                                      int32_t* status);
FORGE_GCS_API int32_t forge_gcs_apply_solution(forge_gcs_system* sys);

/* Declares the unknowns as forge_gcs_solve does and runs planegcs's rank
 * diagnosis. Does not move geometry. */
FORGE_GCS_API int32_t forge_gcs_diagnose(forge_gcs_system* sys, int32_t algorithm,
                                         forge_gcs_diagnosis* out);
/* The diagnosis the system currently holds, WITHOUT recomputing it -- for
 * example the one forge_gcs_solve() made while preparing the solution. With no
 * diagnosis held, dof is -1 and the three has_* flags are 1, exactly as
 * planegcs's own getters report an undiagnosed system. */
FORGE_GCS_API int32_t forge_gcs_get_diagnosis(const forge_gcs_system* sys,
                                              forge_gcs_diagnosis* out);

/* The lists below describe the most recent diagnosis. Each writes at most
 * `capacity` entries to `buf` (which may be NULL when capacity is 0) and returns
 * the TOTAL number available, so a caller can size a buffer and call again. */
FORGE_GCS_API int32_t forge_gcs_get_tags(const forge_gcs_system* sys, int32_t which,
                                         int32_t* buf, int32_t capacity);
FORGE_GCS_API int32_t forge_gcs_conflict_group_count(const forge_gcs_system* sys);
FORGE_GCS_API int32_t forge_gcs_get_conflict_group(const forge_gcs_system* sys, int32_t group,
                                                   int32_t* buf, int32_t capacity);
/* The engine's dependent (still free) parameters, in the engine's order and
 * with the engine's repetitions. */
FORGE_GCS_API int32_t forge_gcs_get_dependent_params(const forge_gcs_system* sys,
                                                     forge_gcs_param* buf, int32_t capacity);
FORGE_GCS_API int32_t forge_gcs_dependent_group_count(const forge_gcs_system* sys);
FORGE_GCS_API int32_t forge_gcs_get_dependent_group(const forge_gcs_system* sys, int32_t group,
                                                    forge_gcs_param* buf, int32_t capacity);

#ifdef __cplusplus
}
#endif

#endif /* FORGE_GCS_H */
