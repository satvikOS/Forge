# Data triage: A2Z-10M+ and Linkify

Measured 2026-09-01. Every number below was produced by a command run in this session
or read out of our own repo. Numbers taken from a paper or a README are labelled as
such. Nothing here is projected without the projection method being stated.

## Verdict up front

| | A2Z-10M+ | Linkify |
|---|---|---|
| Downloadable today | **No** — gated, empty file listing | **Yes** — public S3, no auth |
| Measured bytes obtained | **0** | 400 MiB pulled, 166 assemblies parsed |
| Full corpus | ~5 TB (paper) | 93.2 GB compressed / 211 GB uncompressed (README) |
| Fits in 86 GiB free | No | Not whole; **metadata tier does** |
| Minimal useful slice | n/a | **~1 GiB on disk**, ~93 GB streamed |
| License | CC BY-NC-SA 4.0 | Non-commercial research; no redistribution |

Neither dataset supplies the thing the reframing says has never been tried. A2Z is
explicitly B-rep **without construction history**; Linkify is assembly contacts. If
the goal is real human feature trees, MM-CAD:B remains the only candidate of the three.

---

## 1. A2Z-10M+ — not downloadable, and the sketches are synthetic

**Availability: nothing.** The project page carries no download link of any kind. Every
outbound href on `skazizali.com/a2z.github.io/` was enumerated: the paper PDF, the CVPR
poster, author pages, CSS/CDN. The "Dataset Explorer" (`./a2z/index.html`) returns HTTP
200 but is gated — *"Sign in required — Please sign in with your Google account to access
the dataset files"* — and its "Files in this item" section is **empty**. No Hugging Face
dataset, no Zenodo, no S3, no GitHub data repo. The paper says the data *"will be publicly
released"*, future tense. **Measured download size: 0 bytes.** Full corpus is ~5 TB by the
paper's own statement, against 86 GiB free, so it would not fit even if released.

**Correspondence: yes, and it is exact — but that is the problem, not the reassurance.**
The task asked whether the sketches carry a correspondence to the CAD model, on the
principle that a sketch dataset without correspondence is a picture collection. A2Z's
correspondence is perfect, because the sketches are **not drawings at all**. They are
BRep co-edges with a displacement field applied:

> "We generate 3D sketches using a novel algorithm that simulates different skill levels
> of drawing artists" — a scalar κ ∈ {1..5} modulates "hand skill": lower κ ⇒ higher
> displacement amplitudes.

Each stroke *is* a deformed parent edge, so it inherits that edge's id, loop membership
and face association by construction. The correspondence is a side effect of generation,
not a registration of an independent human drawing. Three consequences:

1. **The sketches are synthetic.** The brief's own framing — "synthetic assertions
   failed; what has never been tried is training on REAL construction sequences" — cuts
   against A2Z exactly as hard as it cuts against the assertion corpus. The five "skill
   levels" are five noise amplitudes on ground-truth geometry, not five humans.
2. **They are 3D curve networks, not 2D images.** The four benchmarks that want SKETCH
   as the answer want a drawing. A2Z gives world-space displaced 3D curves. Different
   modality; a conversion step with its own error budget stands between them.
3. **No construction history.** The paper states plainly that ABC's design history
   *"requires proprietary access to the OnShape repository, which is non-permissive."*

Note: MM-CAD:A's 3,276 **real** hand-drawn sketches are, on this axis, worth more than
all 1M of A2Z's — they are the only genuinely human drawings among the three sources.

---

## 2. Linkify — the minimal useful slice is ~1 GiB, and it is reachable

**Do not download the corpus.** 93.2 GB compressed + 211 GB extracted; the README itself
asks for ~304 GB free during extraction. We have 86 GiB (`df /Users/account_clawteam1`,
not `df /`) beside a 138 GB archdisc-Models.

**But the corpus does not have to be landed to be mined.** Measured facts:

- S3 serves the parts publicly with `Accept-Ranges: bytes` (verified by HEAD;
  `partaa` is exactly 10,737,418,240 B). No auth, no credentials.
- The archive is a **split `.tar.gz`, i.e. a stream**. A 400 MiB byte-range prefix of
  `partaa` decompressed and listed cleanly, yielding 166 complete assemblies.

The README's stated structure ("each directory contains a single `assembly.json`") is
incomplete. There are also `contact/contact_<id>.ply` point clouds, and **they are the
bulk**. Measured over the 400 MiB prefix (905.3 MiB uncompressed, gz ratio 2.26×):

```
assembly.json   n=  166      18,029,965 B    1.90%   mean 106.1 KiB
contact  .ply   n= 2131     931,195,766 B   98.10%   mean 426.7 KiB
```

So the parametric interface data is 1.9% of the corpus and the opaque point clouds are
98.1%. `tar --include='*/assembly.json'` writes the former and discards the latter as it
streams past.

**Minimal useful slice, three independent estimates:**

| method | estimate |
|---|---|
| naive: 8,251 assemblies × 106.1 KiB measured mean | **0.83 GiB** |
| parts-scaled (corpus 18.72 parts/assembly vs sample 15.83) | **0.99 GiB** |
| byte-share: 1.90% of 196.5 GiB | **3.73 GiB** (upper bound) |

The byte-share method reproduces the published total to within 0.1% (196.44 GiB projected
vs 211 GB = 196.5 GiB stated), so the share is trustworthy; the spread comes from the
prefix being directory-name ordered and therefore under-sampling assembly *size*. **Call
it ~1 GiB, bounded above by ~3.7 GiB.** Either fits with enormous headroom.

**The cost that does not go away: disk ≠ network.** gzip has no random access, so
reaching the last assembly still requires streaming all 93.2 GB across the wire, even
though only ~1 GiB is written. Measured pull rate from this machine was **1.74 MiB/s**
(400 MiB in 4m01s), i.e. **~15 hours** for the full stream. An early stop is cheap but
yields a name-biased sample, not a random one.

Tooling committed here: `scripts/linkify_metadata_slice.sh` does exactly this and refuses
to start without headroom.

---

## 3. Do Linkify's interface primitives match ours?

Read from `archdisc-Models/scripts/interface_metrics.py`, not from the paper. The metric
has exactly three face-kind predicates:

```
line 465   if f.get("kind") != "cylinder": continue    # bore / shaft_land walls
line 587   if f.get("kind") != "plane":    continue    # counterbore annular floor
line 704   if f.get("kind") != "plane":    continue    # mating_face
```

and consumes the census fields `kind, axis, axisAt, normal, centroid, area, radius,
concave, index`. The 7,554 figure is confirmed from our own surveys
(`reports/interface/survey_*.json`, 1,773 reference parts): bore 2833, shaft_land 2648,
mating_face 1615, bolt_pattern 203, counterbore 167, bolt_circle 88 — sum 7554.

**The answer is split, and the split is the finding.** Linkify ships two different things
and they answer oppositely.

### The contacts — what Linkify actually corrected — do NOT decompose

Measured over 2,169 real contact records in 166 assemblies, there are only two shapes:

```json
{"entity_one": {"body": "<uuid>", "occurrence": null},
 "entity_two": {"body": "<uuid>", "occurrence": null},
 "contact_area": 18.064, "contact_volume": 0.0, "id": "0_1"}
```

2,147 like that, 22 the same minus both scalars. **Body-pair plus two scalars.** No
`surface_type`, no `BRepFace`, no index, no normal, no axis. The geometry sits beside it
as an opaque `contact_<id>.ply`. This cannot drive `interface_metrics.py`.

It is in fact a **regression** for our purposes. The *original* Fusion 360 Gallery contact
record carries `entity_one: {type:"BRepFace", surface_type:"CylinderSurfaceType", index:6,
...}`, and Linkify's README instructs you to "copy (and overwrite) this data into the
original dataset". That overwrite replaces typed per-face contacts with untyped body-pair
contacts — trading the exact `surface_type` our metric keys on for contact correctness and
point clouds.

### The holes DO decompose — but they are not Linkify's

`assembly.json` also carries a `holes` array that maps almost 1:1 onto our `bore`:

```json
{"type": "RoundHoleWithThroughBottom", "diameter": 1.1, "length": 5.2,
 "origin": {...},        // -> our axisAt / foot-of-axis
 "direction": {...},     // -> our axis
 "faces": [{"surface_type": "CylinderSurfaceType", "bounding_box": {...}}]}
```

**1,445/1,445 holes (100%) carry the full (diameter, length, origin, direction) tuple.**
Surface types over 1,976 hole faces: Cylinder 1501 (76.0%), Cone 293 (14.8%), Plane 181
(9.2%), Sphere 1 — **85.1% are a primitive we score**.

But `holes` is **inherited unchanged from the original Fusion 360 Gallery dataset**
(confirmed against `AutodeskAILab/Fusion360GalleryDataset/docs/assembly.md`, which
documents the identical key set and type vocabulary). Linkify did not add it. So the part
of Linkify that is relevant to our 40% is the part Linkify did not contribute.

### Coverage against our own census

Produced by `scripts/linkify_interface_coverage.py`:

| family | count | share | from holes |
|---|---|---|---|
| bore | 2833 | 37.5% | direct |
| counterbore | 167 | 2.2% | direct |
| bolt_pattern | 203 | 2.7% | derived (group coaxial equal-Ø) |
| bolt_circle | 88 | 1.2% | derived |
| shaft_land | 2648 | 35.1% | **absent** |
| mating_face | 1615 | 21.4% | **absent** |

**39.7% direct, 3.9% derivable, 56.4% absent.** The absent majority is not an oversight:
`holes` are *voids only*. `shaft_land` is an **external** cylinder and `mating_face` is a
planar seat, and no hole record describes either. The single bit that separates our two
largest families — `concave`, which splits 2833 bores from 2648 shaft_lands, 72.6% of all
features — has no counterpart in a hole record at all.

One gap runs the other way: **countersinks**. 14.8% of hole faces are cones, and a
countersunk fastener lands on a cone, but our counterbore path looks for an annular
*plane* (line 587). That is a real interface family Fusion records and we do not.

**LAW 6 still binds.** `interface_metrics.py` measures a BUILT solid and reads no
model self-report. Hole records are an annotation, not a census, so they are **training
supervision, not a scoring path**. To score with them you would build from the referenced
`.step`/`.smt` — and those live in the **original** Fusion 360 Gallery Assembly download,
which is *not* in Linkify's archive (`bodies` entries reference them by name only).

---

## 4. Contamination

Scanned with the existing guard, `archdisc-Models/scripts/contamination_guard.py`, per the
standing rule that a second guard must not be invented.

A training-shaped corpus was built from the real slice — 103 rows, one per assembly with
holes, carrying the assembly id, the overall envelope (so R3 can fire) and the hole
records as the assistant turn.

```
clean linkify_slice_train.jsonl: 103 rows
[guard] 0 contaminated row(s) across 1 file(s)
```

**Positive control**, because a null result from a harness that cannot fire is worthless:
planting one known holdout stem (`ball_knob_000434_s20260505`, from the ACTIVE
`benchcad_canonical_42` registry row) into an otherwise identical row:

```
** CONTAMINATED poscontrol.jsonl: 1/3 rows
   by rule: {'R6': 1}
   line 3: R6 references part 'ball_knob_000434_s20260505' of ACTIVE split 'benchcad_canonical_42'
```

The guard fires on this row shape, and the two unplanted rows stayed clean. The 0/103 is
a real negative.

**It is also only 103 of 8,251 assemblies (1.2%), from the name-ordered head of the
archive.** It does not license ingesting the corpus. The full slice must be re-scanned
before any training, and Fusion 360 Gallery is a source our holdouts draw from, so the
risk is live rather than theoretical.

---

## Recommendation

1. **A2Z: park it.** Nothing to download. Re-check on release. Even then it is synthetic
   sketches, 3D curves rather than drawings, no construction history, and ~5 TB.
2. **Linkify: do not download the corpus.** If the holes are wanted, stream the
   metadata tier (~1 GiB disk, ~15 h wire) with `linkify_metadata_slice.sh`. But note
   that what it yields is the *original* dataset's holes, so compare against obtaining
   the Fusion 360 Gallery Assembly download directly before spending the 15 hours.
3. **What Linkify uniquely adds — corrected contacts — is the part our metric cannot
   read.** It is body-pair + scalar area + point cloud. Judged against
   `interface_metrics.py` as it stands today, that is not worth 93 GB.
4. **The open lever is countersinks**, a family Fusion records with 293 measured cone
   faces in a 166-assembly sample and our metric does not model at all.
