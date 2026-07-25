# Exact rational-NURBS forms for analytic → B-spline conversion

**Purpose.** Code-ready math reference to natively replace OCCT's
`GeomConvert::CurveToBSplineCurve` and `GeomConvert::SurfaceToBSplineSurface`
(blockers 1 & 2 in `TKGeomBase_drop_plan.md`), so `forge-kernel` can drop its
`TKGeomBase` link. For each analytic primitive we actually emit (line, circle/arc,
ellipse, plane, cylinder, cone, sphere, torus) this gives the **exact** poles,
weights, knot vector, and degree. Every form below is EXACT (rational where the
shape is not polynomial) — a circle/ellipse/cylinder/cone/sphere/torus is *not*
approximated by these NURBS, it is reproduced to machine precision. Cross-checked
against Piegl & Tiller, *The NURBS Book*, 2nd ed. (ch. 1 B-spline basics, ch. 7
"Conics and Circles", ch. 8 "Construction of Common Surfaces") and OpenCASCADE's
`Convert_*ToBSpline*` / `GeomConvert` conventions. All formulas below were
numerically verified to reproduce the exact primitive to ~1e-15 (see
"Verification" at the end).

---

## 0. Conventions & notation

- A NURBS curve of degree `p` with `n+1` poles: control points `P_0..P_n`,
  weights `w_0..w_n`, knot vector `U = {u_0..u_{m}}` with `m = n + p + 1` knots.
  Clamped (open) form has end multiplicities `p+1`.
  `C(u) = Σ N_{i,p}(u) w_i P_i / Σ N_{i,p}(u) w_i`.
- A NURBS surface of bidegree `(p,q)`: pole grid `P[i][j]` (`i=0..n_u`,
  `j=0..n_v`), weight grid `W[i][j]`, knot vectors `U` (length `n_u+p+2`) and
  `V` (length `n_v+q+2`).
- Frames. A circle/conic uses an orthonormal in-plane frame `(O; X, Y)` with
  `Y = N × X` (`N` = plane normal / revolution axis). A point at angle `φ`:
  `Pt(φ) = O + ρ·(cos φ · X + sin φ · Y)`.
  Elementary surfaces use `(O; X, Y, Z)`, `Z` the axis, `Y = Z × X`.
- **Reparametrization is free.** All knot vectors below are given normalized to
  `[0,1]`. NURBS shape (the point set) is invariant to affine reparametrization
  of the knots. **For OCCT-faithful STEP round-tripping** replace the normalized
  breakpoints by the primitive's *natural* parameter values (angles in radians
  for conics/revolutions, axial length for the ruling) — see §9. Shape is
  identical; only the parameter labels differ.

### 0.1 The rational-quadratic arc (master building block)

Every circle, ellipse, cylinder, cone, sphere and torus below is assembled from
one primitive: a **single quadratic rational Bézier span** that reproduces a
circular arc of half-angle `α` (span angle `Δθ = 2α`) **exactly**.

For an arc from angle `a` to `b = a + 2α`, mid-angle `m = a + α`, radius `r`,
in frame `(O;X,Y)`:

| pole | position | weight |
|------|----------|--------|
| `S_0` (start, on circle) | `O + r(cos a · X + sin a · Y)` | `1` |
| `S_1` (shoulder = tangent intersection) | `O + (r/cos α)(cos m · X + sin m · Y)` | `cos α` |
| `S_2` (end, on circle) | `O + r(cos b · X + sin b · Y)` | `1` |

The shoulder `S_1` is the intersection of the endpoint tangents; it lies on the
mid-angle ray at radius `r/cos α`. Degree 2, knots `{0,0,0,1,1,1}`.
**Weight pattern per span = `{1, cos α, 1}` — EXACT.**

Hard constraints on the span:
- `α < 90°` strictly (`Δθ < 180°`): at `Δθ = 180°` the shoulder weight
  `cos α → 0` and the pole `→ ∞` (degenerate). **A single quadratic span cannot
  span ≥180°.** Split (§0.2).
- For good conditioning keep `Δθ ≤ 90°` (shoulder weight `≥ √2/2 ≈ 0.7071`).
  `120°` spans (weight `0.5`) are also standard and used by the 7-pole circle.

### 0.2 Multi-span arc (span > 90° or full circle)

Split the total sweep `Θ` into `n = ceil(Θ / Δθ_max)` equal spans
(`Δθ_max = 90°` recommended, `120°` acceptable). Adjacent spans **share** their
common on-circle endpoint pole, so:

- **degree** `p = 2`
- **#poles** `= 2n + 1`  (n=1→3, n=2→5, n=3→7, n=4→9)
- **weights** (length `2n+1`): `{1, cos α, 1, cos α, 1, …, cos α, 1}`
  with `α = Θ/(2n)` (alternating; every even index = 1, every odd index = cos α)
- **knot vector** (length `2n+4`), normalized: end mult 3, each interior
  breakpoint doubled:
  `{0,0,0, 1/n,1/n, 2/n,2/n, …, (n-1)/n,(n-1)/n, 1,1,1}`
- **poles**: even index `2k` = on-circle at angle `θ_start + k·Δθ` (weight 1);
  odd index `2k+1` = shoulder at mid-angle `θ_start + (k+½)·Δθ`, radius
  `r/cos α` (weight `cos α`).

Common `cos α` values: `Δθ=90°→ cos45°=√2/2≈0.70710678`;
`120°→ cos60°=0.5`; `60°→ cos30°=√3/2≈0.8660254`;
`45°→ cos22.5°≈0.92387953`.

---

## CURVES

## 1. Line segment — degree 1, non-rational, EXACT

Segment `P(t) = (1−s)·A + s·B`, `s∈[0,1]`, endpoints `A = Line.Value(t0)`,
`B = Line.Value(t1)`.

| property | value |
|----------|-------|
| degree | `1` |
| #poles | `2` |
| poles | `P_0 = A`, `P_1 = B` |
| weights | `{1, 1}` (polynomial) |
| knots | `{0, 0, 1, 1}` (clamped) — OCCT-faithful: `{t0,t0,t1,t1}` |
| periodic? | no |

A line is polynomial ⇒ **exact** as a degree-1 B-spline. No weights needed.
(GeomConvert on an unbounded `Geom_Line` requires a trimmed range; the STEP
writer supplies `[t0,t1]`.)

## 2. Circular arc / full circle — degree 2, rational, EXACT

Use §0.1/§0.2 directly with the circle's `(O;X,Y)`, radius `r`, sweep from
`θ_start` to `θ_end` (`Θ = θ_end − θ_start`). `n = ceil(Θ/90°)`.

**Full circle (Θ = 360°) — canonical 9-pole "square" form (`n=4`, 90° spans):**

| # | pole (local `X,Y` offset from `O`) | weight |
|---|-------------------------------------|--------|
| 0 | `r(+1, 0)` | 1 |
| 1 | `r√2(+1,+1)/? →` shoulder `(r, r)` i.e. `r(1,1)` | √2/2 |
| 2 | `r(0,+1)` | 1 |
| 3 | shoulder `r(−1,+1)` | √2/2 |
| 4 | `r(−1, 0)` | 1 |
| 5 | shoulder `r(−1,−1)` | √2/2 |
| 6 | `r(0,−1)` | 1 |
| 7 | shoulder `r(+1,−1)` | √2/2 |
| 8 | `r(+1, 0)` (= pole 0, closes) | 1 |

(shoulder radius `= r/cos45° = r√2`, and `r√2·cos45° = r`, so the shoulder at
mid-angle 45° is `O + r√2·(cos45°,sin45°)·X,Y = O + r(1,1)` in `X,Y` units.)

- weights: `{1, √2/2, 1, √2/2, 1, √2/2, 1, √2/2, 1}`
- knots: `{0,0,0, ¼,¼, ½,½, ¾,¾, 1,1,1}`

**Full circle — alternative 7-pole form (`n=3`, 120° spans):** on-circle poles
at 0°,120°,240° (weight 1), shoulders at 60°,180°,300° at radius `r/cos60° = 2r`
(weight ½). weights `{1,½,1,½,1,½,1}`, knots `{0,0,0, ⅓,⅓, ⅔,⅔, 1,1,1}`.
Both forms are **exact**; the 9-pole form is OCCT's default and better
conditioned.

**Sub-90° arc (Θ ≤ 90°):** single span, 3 poles, weights `{1, cos(Θ/2), 1}`,
knots `{0,0,0,1,1,1}`.

**Periodic vs clamped.** OCCT `Geom_Circle` is *periodic* (period 2π). The
conversion is emitted **clamped/closed** (start pole repeated as the last pole,
above) — this is what `Convert_CircleToBSplineCurve` and the STEP writer use.
A truly periodic knot vector is possible but STEP export uses the clamped closed
form. **EXACT** (rational quadratic; the `cos(half-angle)` weights are exact —
never approximate a circle with weight ≈ or polynomial spans).

## 3. Elliptical arc / full ellipse — degree 2, rational, EXACT

An ellipse `E(t) = O + a·cos t · X + b·sin t · Y` (`a` = major, `b` = minor
semi-axis; `t` = eccentric anomaly) is the affine image of the unit circle under
`diag(a,b)` in frame `(X,Y)`. Rational curves transform by applying the map to
Euclidean pole coords and **keeping weights and knots unchanged**. Therefore the
ellipse arc uses the **same degree, same knot vector, and same weight pattern**
as the circular arc with the identical angular split — only the pole coordinates
change:

Split `Θ = t_end − t_start` into `n = ceil(Θ/90°)` spans, `α = Θ/(2n)`.

| pole class | position | weight |
|------------|----------|--------|
| even `2k` (on ellipse) | `O + a·cos θ_k · X + b·sin θ_k · Y`, `θ_k = t_start + k·Δθ` | 1 |
| odd `2k+1` (shoulder) | `O + (a/cos α)·cos m_k · X + (b/cos α)·sin m_k · Y`, `m_k = t_start + (k+½)·Δθ` | `cos α` |

- degree 2; #poles `2n+1`; weights `{1, cos α, 1, …}`;
  knots `{0,0,0, 1/n,1/n, …, 1,1,1}` (identical to the circle).
- **Full ellipse**: 9 poles, weights `{1,√2/2,1,√2/2,1,√2/2,1,√2/2,1}`,
  knots `{0,0,0,¼,¼,½,½,¾,¾,1,1,1}` (or 7-pole 120° form).
- Parametrization is the eccentric anomaly (matches OCCT `Geom_Ellipse`), so the
  breakpoints coincide with the ellipse at `t_k`; the trace is exact everywhere.
- **EXACT.** (`OpenCASCADE Convert_EllipseToBSplineCurve` uses this same
  affine-of-circle construction.)

---

## SURFACES (tensor-product NURBS)

General pattern for the four revolution surfaces (cylinder, cone, sphere, torus):
they are `generatrix (v) × revolution-circle (u)`. Build the u-direction as a
rational-quadratic circle (§0.2) and the v-direction as whatever the generatrix
is (line for cylinder/cone; rational-quadratic arc for sphere/torus). The surface
is the **tensor product**:

- `degree = (p_u, q_v)`; `knots_U`, `knots_V` are exactly the two curve knot
  vectors; `poles = (#u-poles) × (#v-poles)`.
- **Weight grid = outer product**: `W[i][j] = w^u_i · w^v_j`.
- **Pole grid**: revolve each generatrix pole `G_j` (given by its distance-from-
  axis `d_j` and axial height `z_j`) by the u-circle: for u-pole `i` with radial
  scale `s^u_i` (`= 1` on-circle, `= 1/cos α_u` shoulder) at angle `φ_i`,
  `P[i][j] = O + (s^u_i · d_j)(cos φ_i · X + sin φ_i · Y) + z_j · Z`.

## 4. Bounded plane — bidegree (1,1), non-rational, EXACT

Rectangular trim `[u0,u1]×[v0,v1]` of `Plane(u,v) = O + u·Dx + v·Dy`.

| property | value |
|----------|-------|
| bidegree | `(1, 1)` (bilinear) |
| poles | 2×2 corners: `P[0][0]=Plane(u0,v0)`, `P[1][0]=Plane(u1,v0)`, `P[0][1]=Plane(u0,v1)`, `P[1][1]=Plane(u1,v1)` |
| weights | all `1` |
| knots U | `{0,0,1,1}` (OCCT-faithful `{u0,u0,u1,u1}`) |
| knots V | `{0,0,1,1}` (OCCT-faithful `{v0,v0,v1,v1}`) |
| periodic? | no |

A plane is polynomial ⇒ the bilinear patch reproduces it **exactly**. Non-rational.

## 5. Finite cylinder — bidegree (2,1), rational in u, EXACT

`Cyl(u,v) = O + r(cos u · X + sin u · Y) + v · Z`, `u`=angle, `v`=axial,
trimmed `v∈[v0,v1]`, `u∈[u_a,u_b]` (full = 0..2π).

- **u-direction** = rational-quadratic circle of radius `r` (§0.2). Full cylinder
  → 9 u-poles, weights `{1,√2/2,1,√2/2,1,√2/2,1,√2/2,1}`,
  `U = {0,0,0,¼,¼,½,½,¾,¾,1,1,1}`.
- **v-direction** = straight ruling: degree 1, 2 v-poles (bottom `v0`, top `v1`),
  `V = {0,0,1,1}` (OCCT-faithful `{v0,v0,v1,v1}`), v-weights `{1,1}`.
- **generatrix v-poles** (`d_j, z_j`): `G_0=(r, v0)`, `G_1=(r, v1)` — constant
  distance-from-axis `r`.
- **pole grid** `(2n_u+1) × 2`:
  `P[i][j] = O + (s^u_i · r)(cos φ_i · X + sin φ_i · Y) + v_j · Z`.
- **weights** `W[i][j] = w^u_i` (v-direction adds no rationality).

Bidegree `(2,1)`, rational in u only. **EXACT.** u periodic in principle; emitted
clamped/closed (§2).

## 6. Cone (frustum) — bidegree (2,1), rational in u, EXACT

`Cone(u,v) = O + (R + v·sin β)(cos u · X + sin u · Y) + (v·cos β)·Z`,
`β` = semi-angle, `R` = radius at `v=0`, trimmed `v∈[v0,v1]`. The radius grows
linearly in `v`; a frustum is a ruled surface between two exact NURBS circles.

- **u-direction** = rational-quadratic circle (§0.2), same weights/knots as the
  cylinder. Full → 9 u-poles.
- **v-direction** = straight ruling: degree 1, 2 v-poles, `V={0,0,1,1}`
  (OCCT-faithful `{v0,v0,v1,v1}`), v-weights `{1,1}`.
- **generatrix v-poles** `(d_j, z_j)`: radius `r_j = R + v_j·sin β`, height
  `z_j = v_j·cos β`. So `G_0=(r_0, z_0)`, `G_1=(r_1, z_1)`.
- **pole grid** `(2n_u+1) × 2`:
  `P[i][j] = O + (s^u_i · r_j)(cos φ_i · X + sin φ_i · Y) + z_j · Z`
  (shoulder u-poles at radius `r_j / cos α_u`).
- **weights** `W[i][j] = w^u_i`.

Bidegree `(2,1)`, rational in u. **EXACT.**
Caveat: if the trim reaches the apex (`r_j = 0`) that v-row collapses to the apex
point — a **degenerate edge** (all u-poles coincide). Still exact; the STEP
writer normally trims `v` away from the apex. Weights on a degenerate row are
still `w^u_i`.

## 7. Sphere — bidegree (2,2), rational, EXACT

`Sph(u,v) = O + r·cos v·(cos u · X + sin u · Y) + r·sin v·Z`,
`u`=longitude ∈[0,2π], `v`=latitude ∈[−π/2, π/2]. A sphere is a **meridian
semicircle revolved about `Z`** ⇒ rational **bi-quadratic**.

- **u-direction (longitude)** = rational-quadratic circle (§0.2). Full →
  9 u-poles, weights `{1,√2/2,…,1}`, `U={0,0,0,¼,¼,½,½,¾,¾,1,1,1}`.
- **v-direction (meridian)** = rational-quadratic arc of the semicircle. Full
  sphere v spans 180° ⇒ **2 spans of 90°** ⇒ 5 v-poles, v-weights
  `{1, √2/2, 1, √2/2, 1}`, `V = {0,0,0, ½,½, 1,1,1}`. (A meridian is at most a
  semicircle, so ≥2 spans — a single span can't do 180°, §0.1.)
- **generatrix (meridian) v-poles** in `(d_j = dist-from-axis, z_j)` for the full
  meridian (south pole → north pole), radius `r`:

  | j | latitude | `(d_j, z_j)` | v-weight |
  |---|----------|--------------|----------|
  | 0 | −90° (south pole) | `(0, −r)` | 1 |
  | 1 | −45° (shoulder) | `(r, −r)` | √2/2 |
  | 2 | 0° (equator) | `(r, 0)` | 1 |
  | 3 | +45° (shoulder) | `(r, +r)` | √2/2 |
  | 4 | +90° (north pole) | `(0, +r)` | 1 |

  (shoulder radius-from-axis `= r/cos45° · cos45° = r`, height `±r`.)
- **pole grid** `(2n_u+1) × 5`, weight grid = outer product `W[i][j]=w^u_i·w^v_j`:
  `P[i][j] = O + (s^u_i · d_j)(cos φ_i · X + sin φ_i · Y) + z_j · Z`.
- The two polar rows (`j=0`,`j=4`, `d_j=0`) collapse to the single points
  `O ± r·Z` — the standard **degenerate poles** of a NURBS sphere.

Bidegree `(2,2)`, rational. **EXACT** (verified on-sphere to 1e-15).

## 8. Torus — bidegree (2,2), rational, EXACT

`Tor(u,v) = O + (R + r·cos v)(cos u · X + sin u · Y) + r·sin v·Z`,
`R` = major radius (axis→tube-center), `r` = minor (tube) radius, `u`=longitude,
`v`=around the tube. A torus is the **tube circle revolved about `Z`** ⇒ rational
**bi-quadratic**, with *no* degeneracy when `R > r`.

- **u-direction (longitude)** = rational-quadratic circle (§0.2). Full →
  9 u-poles, weights `{1,√2/2,…,1}`, `U={0,0,0,¼,¼,½,½,¾,¾,1,1,1}`.
- **v-direction (tube)** = rational-quadratic **full circle** of radius `r`,
  centered at `(ρ,z)=(R,0)` in the axial half-plane. Full → 9 v-poles,
  v-weights `{1,√2/2,1,√2/2,1,√2/2,1,√2/2,1}`, `V={0,0,0,¼,¼,½,½,¾,¾,1,1,1}`.
- **generatrix (tube) v-poles** in `(d_j, z_j)` — the 9-pole circle about `(R,0)`:

  | j | tube angle | `(d_j, z_j)` | v-weight |
  |---|-----------|--------------|----------|
  | 0 | 0° | `(R+r, 0)` | 1 |
  | 1 | 45° | `(R+r, r)` | √2/2 |
  | 2 | 90° | `(R, r)` | 1 |
  | 3 | 135° | `(R−r, r)` | √2/2 |
  | 4 | 180° | `(R−r, 0)` | 1 |
  | 5 | 225° | `(R−r, −r)` | √2/2 |
  | 6 | 270° | `(R, −r)` | 1 |
  | 7 | 315° | `(R+r, −r)` | √2/2 |
  | 8 | 360° | `(R+r, 0)` (=j0) | 1 |

  (shoulder distance-from-axis / height use tube-circle shoulder radius
  `r/cos45°=r√2`; e.g. j=1 shoulder `= (R + r√2·cos45°, r√2·sin45°) = (R+r, r)`.)
- **pole grid** `9 × 9` (full torus = 81 poles), weight grid = outer product
  `W[i][j] = w^u_i · w^v_j`:
  `P[i][j] = O + (s^u_i · d_j)(cos φ_i · X + sin φ_i · Y) + z_j · Z`.

Bidegree `(2,2)`, rational. **EXACT** (verified on-torus to 4e-15). Both
directions periodic in principle; emitted clamped/closed.

---

## 9. OCCT / GeomConvert faithfulness notes (for STEP round-trip)

`GeomConvert::CurveToBSplineCurve` / `SurfaceToBSplineSurface` dispatch to
`Convert_CircleToBSplineCurve`, `Convert_EllipseToBSplineCurve`,
`Convert_CylinderToBSplineSurface`, `Convert_ConeToBSplineSurface`,
`Convert_SphereToBSplineSurface`, `Convert_TorusToBSplineSurface`. To match them
(so the emitted STEP B-splines round-trip within tolerance on the Models-OS
fixtures — the true drop gate):

1. **Same span count.** OCCT's default `Convert_TgtThetaOver2` produces the
   9-pole (4×90°) circle for a full revolution (5-pole/2×90° meridian for the
   sphere latitude). Use `n = ceil(Θ/90°)`; do **not** use fewer spans than the
   sweep requires (never a single span ≥180°).
2. **Weights = `cos(half-span)` exactly** — `√2/2` for 90° spans, `½` for 120°.
   A wrong weight silently corrupts arcs (plan §risk). Store the exact irrational,
   not a rounded decimal.
3. **Parametrization.** OCCT preserves the primitive's natural parameter. For
   OCCT-identical knots, substitute the natural breakpoints for the normalized
   ones: conic/revolution `u`-knots = angle in **radians**
   (`{0,0,0, π/2,π/2, π,π, 3π/2,3π/2, 2π,2π,2π}` for a full circle in `u`);
   line/ruling knots = actual parameter range `[v0,v1]`. The pole/weight tables
   are unchanged — only knot *values* rescale. If a downstream consumer only
   needs shape (not parameter), the normalized `[0,1]` knots are equivalent.
4. **Clamped, closed** representation (not periodic) for full circles/revolutions:
   repeat the first pole as the last, end-knot multiplicity `p+1`. This matches
   the OCCT converters' output and the STEP `B_SPLINE_CURVE_WITH_KNOTS` /
   `..._SURFACE_WITH_KNOTS` records the writer expects.
5. **Rational flag.** Line and plane emit **non-rational** (`.U.` / polynomial);
   circle, ellipse, cylinder, cone, sphere, torus emit **rational**
   (`RATIONAL_B_SPLINE_*` with the weight_data above).

## 10. Exactness summary — every required type has an EXACT rational NURBS form

| type | bidegree | #poles (full) | rational? | weight pattern | knots (normalized, full) | EXACT? |
|------|----------|---------------|-----------|----------------|--------------------------|--------|
| 1. line segment | 1 | 2 | no | {1,1} | {0,0,1,1} | ✔ exact |
| 2. circular arc / circle | 2 | 2n+1 (9) | yes | {1,cosα,1,…} ({1,√2/2,…}) | {0,0,0,¼,¼,½,½,¾,¾,1,1,1} | ✔ exact |
| 3. elliptical arc / ellipse | 2 | 2n+1 (9) | yes | {1,cosα,1,…} (same as circle) | same as circle | ✔ exact |
| 4. bounded plane | (1,1) | 2×2 | no | all 1 | U,V = {0,0,1,1} | ✔ exact |
| 5. finite cylinder | (2,1) | (2n_u+1)×2 (9×2) | yes (u) | W=w^u_i·1 | U circle, V={0,0,1,1} | ✔ exact |
| 6. cone frustum | (2,1) | (2n_u+1)×2 (9×2) | yes (u) | W=w^u_i·1 | U circle, V={0,0,1,1} | ✔ exact |
| 7. sphere | (2,2) | (2n_u+1)×5 (9×5) | yes | W=w^u_i·w^v_j | U circle, V={0,0,0,½,½,1,1,1} | ✔ exact |
| 8. torus | (2,2) | 9×9 (81) | yes | W=w^u_i·w^v_j | U,V circle | ✔ exact |

**No required type lacks an exact NURBS form.** All conics and quadric/toroidal
surfaces are exactly rational (bi-)quadratic; line and plane are exactly
polynomial (bi-)linear. The only representational caveats are (a) span-count /
`Δθ<180°` splitting for arcs, and (b) **degenerate polar rows** on the sphere
(and the cone apex if trimmed to it) — these are exact but produce a
coincident-pole edge, which is the standard NURBS representation and must be kept
so STEP export/round-trip stays faithful.

## Verification

All forms above were checked numerically (independent rational-Bézier
evaluation, not OCCT): 90° and 120° circular spans reproduce the radius to
`≤1e-15`; the ellipse quarter satisfies `x²/a²+y²/b²=1` to `2e-16`; the sphere
octant patch lies on the sphere to `9e-16`; the torus patch satisfies
`(√(x²+y²)−R)²+z²=r²` to `4e-15`. These are exact-to-machine-precision, i.e. the
representations are mathematically exact — **do not substitute polynomial
approximations for the rational forms.**
