# Geometry cluster — open-ingest source audit (commercial-use license clearance)

Cluster: **Geometry / computational + differential geometry / CAD-math**
Ingester: `archdisc-Models/scripts/ingest_geom.py`
Output: `archdisc-Models/data/open_ingest/geom/<source>.jsonl`
Audited: 2026-06-24

**Archie is a COMMERCIAL product.** Therefore this ingester accepts ONLY sources
whose license permits commercial use and derivatives:

- **Public domain** (US-government works: NIST / NASA / USGS)
- **CC0**
- **CC BY** (any version)
- **CC BY-SA** (any version)

Any **NonCommercial (NC)**, **NoDerivatives (ND)**, or **research-only** license is
**REJECTED** — never fetched, never stored. Rejection is enforced at two layers:

1. **Source-level allow-list** — only the accepted sources below are wired in.
2. **Item-level license gate** (`_license_ok` in the script) — every fetched item's
   OWN license string is re-checked against the commercial-OK pattern set, with an
   explicit NC/ND token veto (`\b(nc|non-commercial|nd|no-deriv)\b`). arXiv and
   LibreTexts licenses vary per item, so being on the allow-list is NOT sufficient:
   each item must independently prove a PD/CC0/CC-BY/CC-BY-SA license or it is
   dropped and counted in `rejected_license`.

---

## ACCEPTED SOURCES (commercial-use OK)

### 1. arXiv cs.CG / cs.GR / math.MG / math.DG (per-paper CC license only)
- **Access:** OAI-PMH, `https://oaipmh.arxiv.org/oai` (`metadataPrefix=arXiv`).
  The `arXiv` metadata record exposes a per-paper `<license>` element.
- **License:** ACCEPT a paper **only** if its `<license>` is
  `creativecommons.org/licenses/by/4.0`, `…/by-sa/4.0`, or
  `creativecommons.org/publicdomain/zero` (CC0). Verified on the official arXiv
  license page (`info.arxiv.org/help/license`): CC BY 4.0 and CC BY-SA 4.0
  "permit commercial use and derivatives"; CC0 is unrestricted.
- **Commercial-use justification:** CC BY 4.0 — "Share … for any purpose, even
  commercially" + "Adapt … for any purpose, even commercially" (verified on
  `creativecommons.org/licenses/by/4.0`). CC BY-SA adds only a share-alike
  obligation, still commercial-OK. We ingest the **abstract** (authors' own
  CC-licensed text) into a research-grade Q/A, tagged with the paper's CC license
  and `arxiv.org/abs/<id>` source URL.
- **VERIFIED LIVE:** a real OAI batch (2024-01) returned ~6/34 records under CC
  BY / CC BY-SA and ~28 under the arXiv nonexclusive license; the gate accepted
  the CC ones and rejected the rest. Accepted sample: arXiv:2312.17533 "Void Shape
  Identification in a 2D Point Distribution" (cs.CG, CC-BY-4.0).
- **What is NOT taken:** PDFs / figures (license varies, attribution-heavy); only
  the CC-licensed abstract text + metadata.

### 2. Wikibooks (geometry / linear algebra / topology books)
- **Access:** MediaWiki action API `en.wikibooks.org/w/api.php`
  (`prop=extracts&explaintext`). **Robots-gated** — see note below; bulk path is
  the official Wikimedia dumps.
- **License:** CC BY-SA 4.0 (verified on `en.wikibooks.org/wiki/Wikibooks:Copyrights`:
  text is "available under CC BY-SA 4.0"; "commercial use is permitted … There are
  no non-commercial restrictions").
- **Commercial-use justification:** CC BY-SA 4.0 explicitly allows commercial reuse
  and derivatives with attribution + share-alike. Source URL + `CC-BY-SA-4.0` tag
  stamped on every row.

### 3. Wikipedia (CAD-geometry articles) / Wikimedia Commons
- **Access:** MediaWiki action API `en.wikipedia.org/w/api.php`. Robots-gated for
  generic crawlers (bulk via Wikimedia dumps).
- **License:** CC BY-SA 4.0 (verified on `commons.wikimedia.org/wiki/Commons:Licensing`:
  "Commercial use of the work MUST be allowed"; NC and ND are explicitly "Not OK"
  on Commons, confirming the project ethos is commercial-OK).
- **Commercial-use justification:** same CC BY-SA 4.0 grant as Wikibooks. Curated
  to a hand-picked geometry page list (NURBS, B-spline, Bézier, differential
  geometry of surfaces, Gaussian curvature, Delaunay, Voronoi, convex hull,
  Gauss–Bonnet, subdivision, B-rep, Euler characteristic).

### 4. OpenStax CC BY 4.0 textbooks
- **License:** CC BY 4.0 for "all textbook content … EXCEPT Calculus, which is
  CC BY-NC-SA" (verified via OpenStax licensing statement).
- **Commercial-use justification:** CC BY 4.0 → commercial use + derivatives OK.
- **HARD CARVE-OUT:** **OpenStax Calculus is CC BY-NC-SA → REJECTED.** The ingester
  must take the CC BY titles only; the item-level NC veto blocks the Calculus title
  even if mis-listed.

### 5. LibreTexts — CC BY / CC BY-SA pages only (per-page gate)
- **License:** MIXED per page. Many LibreTexts pages are **CC BY-NC-SA**
  (non-commercial) — verified that pages carry a footer license stamp such as
  "shared under a CC BY-NC-SA 4.0 license".
- **Commercial-use justification:** ACCEPT only pages whose footer/metadata license
  is CC BY or CC BY-SA (commercial-OK); the per-page NC stamp (`license:ccbync*`) is
  vetoed by the item-level gate. **Do NOT ingest a LibreTexts page without reading
  its own license stamp.**

### 6. NIST publications & data (US-government public domain)
- **License:** Public domain in the US — works of US-federal employees are not
  subject to copyright (verified on NIST copyright statement:
  "information presented on NIST sites are considered public information and may be
  distributed or copied"; NIST software "not subject to copyright protection within
  the United States" with rights to "use, copy and distribute … create derivative
  works").
- **Commercial-use justification:** Public domain → unrestricted commercial use.
  (Scaffolded as an accepted source family; per-document disclaimers must still be
  honored — a few NIST products carry third-party content with its own terms.)

### 7. NURBS / CAGD / differential-geometry formula facts (public-domain math)
- **License:** Public domain — mathematical formulae and named theorems are NOT
  copyrightable (the *expression* in a specific textbook is; the *formula* is not).
- **Commercial-use justification:** facts/formulas are uncopyrightable. The ingester
  generates these from the formulas directly (Cox-de Boor recursion, Boehm knot
  insertion, exact-conic Bézier weight cos θ, Bézier degree elevation, Gaussian /
  mean curvature from the fundamental forms) — no copyrighted text is copied. Tagged
  `PD-math`. Guarantees an offline-safe commercial-OK contributor to the corpus.

---

## REJECTED SOURCES (NOT fetched — NC / ND / research-only / no commercial grant)

| Source | License found | Why rejected |
|---|---|---|
| **DeepCAD dataset** | Onshape-derived; per-model copyright "owned by their creators" under Onshape Terms of Use | Code is MIT, but the **dataset geometry has no blanket commercial grant** — each model's copyright is the creator's under Onshape ToU. Cannot establish commercial-OK per model → REJECT the dataset. |
| **ABC dataset (A Big CAD Model Dataset)** | "Copyright of the CAD models is owned by their creators"; governed by Onshape Terms of Use 1.g.ii | No commercial-use grant; per-model copyright retained by creators → REJECT. |
| **Fusion 360 Gallery Dataset** | Autodesk custom license: "only for non-commercial research purposes" (verified in LICENSE.md) | Explicitly **non-commercial research only** → REJECT. |
| **OpenStax Calculus** | CC BY-NC-SA | NonCommercial → REJECT (the only OpenStax title that is NC). |
| **LibreTexts CC BY-NC-SA pages** | CC BY-NC-SA 4.0 (per-page footer) | NonCommercial → REJECT at the per-page gate. Only CC BY / CC BY-SA LibreTexts pages are accepted. |
| **arXiv papers under the arXiv perpetual non-exclusive license** | `arxiv.org/licenses/nonexclusive-distrib/1.0` | Grants arXiv distribution rights only — **no commercial third-party reuse grant** → REJECT. (Verified live: e.g. arXiv:1906.01114 carries this license; ~80% of a real cs OAI batch is this license.) |
| **arXiv CC BY-NC-SA / CC BY-NC-ND papers** | CC BY-NC-SA 4.0 / CC BY-NC-ND 4.0 | NonCommercial (and ND) → REJECT at the per-paper gate. |

---

## STORAGE-SAFE + POLITENESS GUARANTEES (enforced in code)

- **download → process → delete, one item at a time.** Only the append-only JSONL of
  EXTRACTED training rows (text) is persisted; every network body lives in memory.
- **Disk floor:** `assert_disk()` aborts the run if free disk `< 15 GB` (checked
  before each fetch). Validating runs held steady at ~174 GB free.
- **robots.txt honored** per host via `urllib.robotparser` (the live MediaWiki API is
  correctly self-disabled under Wikimedia robots — bulk Wikimedia text must come from
  the official **dumps.wikimedia.org** CC BY-SA dumps, which are not robots-gated).
- **Rate limit:** fixed `RATE_DELAY = 3 s` between same-host requests; descriptive,
  contactable `User-Agent`.
- **stdlib-only** (urllib / xml.etree / html.parser) — no new dependencies.

## OUTPUT SCHEMA (every row)

Same `{messages:[system,user,assistant], meta:{field,topic,level}}` shape as
`scripts/bulk_synth_geom.py`, EXTENDED with mandatory provenance:

```
meta: { field, topic, level (BSc|MSc|PhD|industrial),
        source, source_url, license, ingest:"open_ingest_geom" }
```

Dedup: blake2b-96 content hash over the user+assistant text.

## VALIDATING RUN (tiny scale, proven 2026-06-24)

- `--sources cagd,arxiv --arxiv-from 2024-01-01 --arxiv-until 2024-01-02`:
  **8 accepted** (3 × CC-BY-4.0 arXiv geometry papers + 5 × PD-math CAGD facts),
  **149 rejected_license**, 62 off-topic; 1.69 MB fetched; disk safe.
- Accepted arXiv sample: arXiv:2312.17533 — CC-BY-4.0 — PhD-level Delaunay/Voronoi
  void-identification abstract — `source_url=https://arxiv.org/abs/2312.17533`.
