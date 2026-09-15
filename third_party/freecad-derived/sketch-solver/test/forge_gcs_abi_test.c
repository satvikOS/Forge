/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * forge_gcs_abi_test.c -- libforge_gcs exercised through its C header, in C.
 *
 * Part of libforge_gcs (a modified FreeCAD planegcs). Written for Forge on
 * 2026-09-15. Compiled as C11 with -Wall -Wextra -Werror -pedantic, so a C++-only
 * construct leaking into forge_gcs.h is a build failure here.
 *
 * The solver behaviours checked are the ones FreeCAD's own planegcs and Sketcher
 * tests check, restated against this interface:
 *   tests/src/Mod/Sketcher/App/planegcs/GCS.cpp  clearConstraints: removing by
 *       tag leaves no constraint behind;
 *   src/Mod/Sketcher/SketcherTests/TestSketcherSolver.py CreateRectangleSketch /
 *       testBoxCase: a rectangle pinned at a corner with two dimensions has no
 *       degrees of freedom left and solves;
 * plus the error model this interface adds (every bad input refused with a
 * sentence, nothing aborts) and the conflict groups the modification keeps.
 *
 * usage: forge_gcs_abi_test [--mutate N]   exit 0 = every check held
 *   --mutate 1  diagnose the rectangle WITHOUT its x dimension -> "0 dof" goes red
 *   --mutate 2  add the contradicting dimension with the SAME value -> no conflict
 *   --mutate 3  skip clear_tag -> "clearing a tag removes it" goes red
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "forge_gcs/forge_gcs.h"

static int g_checks = 0;
static int g_failures = 0;
static int g_mutation = 0;

static void check(int ok, const char* what)
{
    ++g_checks;
    if (!ok) {
        ++g_failures;
        printf("  FAIL  %s\n", what);
    }
}

static int contains(const int32_t* v, int32_t n, int32_t x)
{
    int32_t i;
    for (i = 0; i < n; ++i) {
        if (v[i] == x) {
            return 1;
        }
    }
    return 0;
}

int main(int argc, char** argv)
{
    int i;
    for (i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
            g_mutation = atoi(argv[++i]);
        }
    }
    if (g_mutation != 0) {
        printf("[forge_gcs] MUTATION %d ACTIVE\n", g_mutation);
    }

    /* ── identity ─────────────────────────────────────────────────────── */
    check(forge_gcs_abi_version() == FORGE_GCS_ABI_VERSION, "the library speaks the header's ABI version");
    check(strstr(forge_gcs_build_description(), "0a45a0a008d4af7a85601016c5ab31bd26c25b22") != NULL,
          "the library names its upstream commit");

    /* ── NULL is refused, never dereferenced ──────────────────────────── */
    {
        double x = 0.0, y = 0.0;
        forge_gcs_diagnosis d;
        int32_t st = 0;
        check(forge_gcs_add_point(NULL, 0.0, 0.0) == FORGE_GCS_ERR_NULL, "add_point(NULL) is refused");
        check(forge_gcs_get_point(NULL, 0, &x, &y) == FORGE_GCS_ERR_NULL, "get_point(NULL) is refused");
        check(forge_gcs_solve(NULL, FORGE_GCS_DOGLEG, &st) == FORGE_GCS_ERR_NULL, "solve(NULL) is refused");
        check(forge_gcs_diagnose(NULL, FORGE_GCS_DOGLEG, &d) == FORGE_GCS_ERR_NULL, "diagnose(NULL) is refused");
        check(isnan(forge_gcs_error_by_tag(NULL, 1)), "error_by_tag(NULL) is NaN");
        check(strlen(forge_gcs_last_error(NULL)) > 0, "last_error(NULL) still says something");
        forge_gcs_destroy(NULL);
    }

    /* ── bad input on a live system: refused with a sentence, nothing added ── */
    {
        forge_gcs_system* s = forge_gcs_create();
        int32_t p0, p1, c0, l0;
        int32_t refs[2];
        check(s != NULL, "a system can be created");
        if (s == NULL) {
            return 1;
        }
        p0 = forge_gcs_add_point(s, 0.0, 0.0);
        p1 = forge_gcs_add_point(s, 10.0, 0.0);
        check(p0 == 0 && p1 == 1, "points are numbered in creation order");
        check(forge_gcs_add_line(s, p0, 7) == FORGE_GCS_ERR_BAD_POINT, "a line to a point that does not exist is refused");
        check(strlen(forge_gcs_last_error(s)) > 0, "and the refusal is explained");
        l0 = forge_gcs_add_line(s, p0, p1);
        c0 = forge_gcs_add_circle(s, p0, 5.0);
        check(l0 == 0 && c0 == 1, "curves are numbered in creation order across kinds");
        refs[0] = l0;
        refs[1] = c0;
        check(forge_gcs_add_constraint(s, FORGE_GCS_PARALLEL, refs, 2, 0.0, 0, 1) == FORGE_GCS_ERR_CURVE_KIND,
              "PARALLEL on a line and a circle is refused as the wrong kind");
        check(strstr(forge_gcs_last_error(s), "circle") != NULL, "and the refusal names what it got");
        check(forge_gcs_constraint_count(s, -1) == 0, "a refused constraint adds nothing");
        check(forge_gcs_add_constraint(s, 999, refs, 2, 0.0, 0, 1) == FORGE_GCS_ERR_ARGUMENT,
              "an unknown primitive is refused");
        refs[0] = p0;
        refs[1] = p1;
        check(forge_gcs_add_constraint(s, FORGE_GCS_P2P_DISTANCE, refs, 2, NAN, 0, 1) == FORGE_GCS_ERR_ARGUMENT,
              "a NaN dimension is refused");
        check(forge_gcs_add_constraint(s, FORGE_GCS_P2P_DISTANCE, refs, 1, 5.0, 0, 1) == FORGE_GCS_ERR_ARGUMENT,
              "too few operands are refused");

        /* FreeCAD GCSTest.clearConstraints: removing by tag leaves nothing. */
        check(forge_gcs_add_constraint(s, FORGE_GCS_P2P_DISTANCE, refs, 2, 12.0, 0, 7) == FORGE_GCS_OK, "a distance is accepted");
        check(forge_gcs_add_constraint(s, FORGE_GCS_HORIZONTAL_POINTS, refs, 2, 0.0, 0, 7) == FORGE_GCS_OK, "a horizontal is accepted");
        /* a point-to-point distance is one solver primitive, and so is a
           horizontal between two points (equal y) */
        check(forge_gcs_constraint_count(s, 7) == 2, "both primitives are held under their tag");
        if (g_mutation != 3) {
            check(forge_gcs_clear_tag(s, 7) == FORGE_GCS_OK, "clearing a tag succeeds");
        }
        check(forge_gcs_constraint_count(s, 7) == 0, "clearing a tag removes every primitive under it");
        check(isnan(forge_gcs_error_by_tag(s, 7)), "a cleared tag has no error to report");
        forge_gcs_destroy(s);
    }

    /* ── a rectangle pinned at a corner and dimensioned: 0 dof ────────── */
    {
        forge_gcs_system* s = forge_gcs_create();
        int32_t p[4], l[4], r[2], one[1];
        int32_t k, st = -1, n, g, groups, tagsN;
        forge_gcs_diagnosis d;
        int32_t tags[16];
        double x = 0.0, y = 0.0;
        /* drawn 50 x 30, dimensioned 60 x 40 */
        p[0] = forge_gcs_add_point(s, 0.0, 0.0);
        p[1] = forge_gcs_add_point(s, 50.0, 1.0);
        p[2] = forge_gcs_add_point(s, 49.0, 30.0);
        p[3] = forge_gcs_add_point(s, 1.0, 31.0);
        for (k = 0; k < 4; ++k) {
            l[k] = forge_gcs_add_line(s, p[k], p[(k + 1) % 4]);
        }
        one[0] = l[0];
        forge_gcs_add_constraint(s, FORGE_GCS_HORIZONTAL_LINE, one, 1, 0.0, 0, 1);
        one[0] = l[2];
        forge_gcs_add_constraint(s, FORGE_GCS_HORIZONTAL_LINE, one, 1, 0.0, 0, 2);
        one[0] = l[1];
        forge_gcs_add_constraint(s, FORGE_GCS_VERTICAL_LINE, one, 1, 0.0, 0, 3);
        one[0] = l[3];
        forge_gcs_add_constraint(s, FORGE_GCS_VERTICAL_LINE, one, 1, 0.0, 0, 4);
        one[0] = p[0];
        forge_gcs_add_constraint(s, FORGE_GCS_COORDINATE_X, one, 1, 0.0, 0, 5);
        forge_gcs_add_constraint(s, FORGE_GCS_COORDINATE_Y, one, 1, 0.0, 0, 5);
        r[0] = p[0];
        r[1] = p[1];
        if (g_mutation != 1) {
            check(forge_gcs_add_constraint(s, FORGE_GCS_DIFFERENCE_X, r, 2, 60.0, 0, 6) == FORGE_GCS_OK, "width 60");
        }
        r[1] = p[3];
        check(forge_gcs_add_constraint(s, FORGE_GCS_DIFFERENCE_Y, r, 2, 40.0, 0, 7) == FORGE_GCS_OK, "height 40");

        check(forge_gcs_diagnose(s, FORGE_GCS_DOGLEG, &d) == FORGE_GCS_OK, "the rectangle diagnoses");
        check(d.dof == 0, "a pinned, dimensioned rectangle has 0 degrees of freedom");
        check(!d.has_conflicting && !d.has_redundant, "and nothing conflicts or repeats");
        check(forge_gcs_solve(s, FORGE_GCS_DOGLEG, &st) == FORGE_GCS_OK && st == FORGE_GCS_SOLVE_SUCCESS,
              "it solves to success");
        forge_gcs_get_point(s, p[2], &x, &y);
        check(fabs(x - 50.0) < 1e-12 && fabs(y - 30.0) < 1e-12, "geometry does not move before apply_solution");
        forge_gcs_apply_solution(s);
        forge_gcs_get_point(s, p[2], &x, &y);
        check(fabs(x - 60.0) < 1e-9 && fabs(y - 40.0) < 1e-9, "the far corner lands at (60, 40)");
        check(fabs(forge_gcs_error_by_tag(s, 6)) < 1e-9, "the width is satisfied");

        /* The same two points given a second, CONTRADICTING width. */
        r[1] = p[1];
        forge_gcs_add_constraint(s, FORGE_GCS_DIFFERENCE_X, r, 2, g_mutation == 2 ? 60.0 : 70.0, 0, 8);
        check(forge_gcs_diagnose(s, FORGE_GCS_DOGLEG, &d) == FORGE_GCS_OK, "the over-constrained rectangle diagnoses");
        check(d.has_conflicting, "a second, different width conflicts");
        tagsN = forge_gcs_get_tags(s, FORGE_GCS_TAGS_CONFLICTING, tags, 16);
        check(contains(tags, tagsN, 6) && contains(tags, tagsN, 8), "both widths are named as conflicting");
        groups = forge_gcs_conflict_group_count(s);
        check(groups >= 1, "the conflict is reported as a group");
        {
            int pair = 0;
            for (g = 0; g < groups; ++g) {
                n = forge_gcs_get_conflict_group(s, g, tags, 16);
                if (contains(tags, n, 6) && contains(tags, n, 8)) {
                    pair = 1;
                }
            }
            check(pair, "one group holds exactly the two widths that contradict each other");
        }
        n = forge_gcs_get_tags(s, FORGE_GCS_TAGS_PROPOSED_REMOVAL, tags, 16);
        check(n >= 1 && contains(tags, n, 8), "the solver proposes dropping the newer width");
        check(forge_gcs_get_conflict_group(s, groups, tags, 16) == FORGE_GCS_ERR_ARGUMENT,
              "a group index past the end is refused");
        check(forge_gcs_get_tags(s, FORGE_GCS_TAGS_CONFLICTING, NULL, 0) == tagsN,
              "a size query with no buffer returns the count");

        /* A repeated, AGREEING width is redundant, not conflicting. */
        forge_gcs_clear_tag(s, 8);
        forge_gcs_add_constraint(s, FORGE_GCS_DIFFERENCE_X, r, 2, 60.0, 0, 9);
        forge_gcs_diagnose(s, FORGE_GCS_DOGLEG, &d);
        check(!d.has_conflicting && d.has_redundant, "a repeated width that agrees is redundant, not a conflict");
        forge_gcs_destroy(s);
    }

    /* ── a free point reports its freedom by role and owner ───────────── */
    {
        forge_gcs_system* s = forge_gcs_create();
        int32_t a, b, r[2], n, k, sawX = 0, sawY = 0;
        forge_gcs_param params[16];
        forge_gcs_diagnosis d;
        a = forge_gcs_add_point(s, 0.0, 0.0);
        b = forge_gcs_add_point(s, 3.0, 4.0);
        r[0] = a;
        forge_gcs_add_constraint(s, FORGE_GCS_COORDINATE_X, r, 1, 0.0, 0, 1);
        forge_gcs_add_constraint(s, FORGE_GCS_COORDINATE_Y, r, 1, 0.0, 0, 1);
        r[1] = b;
        forge_gcs_add_constraint(s, FORGE_GCS_P2P_DISTANCE, r, 2, 5.0, 0, 2);
        forge_gcs_diagnose(s, FORGE_GCS_DOGLEG, &d);
        check(d.dof == 1, "a point on a circle about a fixed point has one freedom");
        n = forge_gcs_get_dependent_params(s, params, 16);
        for (k = 0; k < n && k < 16; ++k) {
            if (params[k].owner == b && params[k].role == FORGE_GCS_PARAM_POINT_X) sawX = 1;
            if (params[k].owner == b && params[k].role == FORGE_GCS_PARAM_POINT_Y) sawY = 1;
            check(params[k].owner != a, "the fixed point is never reported free");
        }
        check(sawX || sawY, "the free parameter is attributed to the moving point by role");
        check(forge_gcs_dependent_group_count(s) >= 1, "and belongs to a group");
        forge_gcs_destroy(s);
    }

    printf("=== forge_gcs ABI: %d checks, %d failed ===\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
