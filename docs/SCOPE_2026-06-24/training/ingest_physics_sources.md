# Audited Open-Ingest Sources — PHYSICS CLUSTER (commercial-use license audit)

> **Cluster:** Mechanics · structures · thermodynamics · fluids · heat transfer · materials.
> **Generated 2026-06-24** for the Archie 14B "pure CAD/CAM/CAE engineer" curriculum.
> **Driver script:** [`archdisc-Models/scripts/ingest_physics.py`](../../../../archdisc-Models/scripts/ingest_physics.py)
> **Sibling:** the synthetic generator `bulk_synth_physics.py` and its taxonomy `sourcing_physics.md`.

## 0. Governing rule — Archie is a COMMERCIAL product

Archie ships in a commercial product. We may therefore ingest a source **only** if its
license grants **commercial use**. The admissible licenses are:

| Admissible | Why commercial-OK |
|---|---|
| **Public Domain** (US-Gov works: NASA, NIST-authored) | No copyright under 17 U.S.C. §105 — free for any use incl. commercial. |
| **CC0 / Public-Domain Dedication** | All rights waived; commercial use explicit. |
| **CC BY 4.0** | Commercial use permitted; only requires attribution. |
| **CC BY-SA 4.0** | Commercial use permitted; requires attribution **and** share-alike of derivatives. |

**Hard-rejected (never fetched):** any **NC** (NonCommercial), **ND** (NoDerivatives),
or **research-only / default non-exclusive** license. These are named in §3 so they are
never ingested. The ingester's `classify_license()` rejects-by-default: a missing or
unrecognised license is treated as NOT a commercial grant.

The script enforces this at fetch time (it parses the per-record / per-page license and
skips anything not on the admissible list) — the policy is **code-enforced**, not just
documented.

---

## 1. ACCEPTED SOURCES (verified 2026-06-24)

### 1.1 NASA NTRS — US-Government PUBLIC DOMAIN

- **What:** NASA Technical Reports Server abstracts (mechanics/structures/aero/thermo/
  fluids/heat/materials reports).
- **API:** `POST https://ntrs.nasa.gov/api/citations/search` (JSON). robots.txt = `Allow: /`.
- **License:** **Public Domain** for US-Government-authored works.
- **Verification (sti.nasa.gov disclaimers):** *"Generally, United States government works
  … are not protected by copyright in the U.S."* — confirmed via WebFetch 2026-06-24.
- **Commercial-use justification:** US-Gov works carry no copyright → usable for any
  purpose, including a commercial model.
- **CAVEAT handled in code:** the same disclaimer warns that NTRS may host (a) **contractor/
  grantee** reports (those authors retain copyright) and (b) embedded **third-party**
  figures. The ingester therefore admits a record **only** when
  `copyright.determinationType == "GOV_PUBLIC_USE_PERMITTED"` **and**
  `containsThirdPartyMaterial == False` **and** not `belongsToContractor/belongsToPublisher`,
  and it ingests **only the gov-authored ABSTRACT TEXT** — never the PDF or its figures.
- **Live-verified:** the API returns a `copyright` object per record with exactly these
  fields (see §4 sample).

### 1.2 arXiv — per-paper CC BY / CC BY-SA / CC0 abstracts ONLY

- **What:** arXiv physics-set abstracts (`physics:physics`, `physics:nlin`).
- **API:** `https://oaipmh.arxiv.org/oai?verb=ListRecords&set=…&metadataPrefix=arXiv`
  (the **dedicated OAI-PMH host**; it serves **no** robots.txt → no crawl restriction).
  *Note:* `export.arxiv.org/robots.txt` is a blanket `Disallow: /`, so the ingester
  **refuses** that host (robots honoured) and uses the sanctioned `oaipmh.arxiv.org` host.
- **License:** **mixed and per-paper.** arXiv offers CC BY 4.0, CC BY-SA 4.0,
  CC BY-NC-SA, CC BY-NC-ND, **and** a default *non-exclusive* license. The `arXiv`
  metadata format exposes a per-record `<license>` element.
- **Verification (info.arxiv.org/help/license):** confirmed the four CC options + default
  license, and that *"a CC0 1.0 dedication applies to all metadata."* — WebFetch 2026-06-24.
- **Commercial-use justification & code filter:** the ingester keeps a record **only** if
  its `<license>` URI is `creativecommons.org/licenses/by/`, `…/by-sa/`, or a public-domain/
  CC0 dedication. **No `<license>` element ⇒ default non-exclusive license ⇒ REJECT**
  (most older physics papers fall here and are correctly dropped). Only the author-licensed
  **abstract** is ingested. A topical keyword gate drops cross-listed q-bio/biology
  abstracts that appear in the physics sets.
- **Live-verified:** `GetRecord` for `oai:arXiv.org:1410.6579` returns
  `<license>http://creativecommons.org/licenses/publicdomain/</license>` → classified OK.

### 1.3 LibreTexts (Engineering / Physics) — per-page CC BY / CC BY-SA only

- **What:** OER lesson pages (e.g. *Mechanics Map* (Moore et al.), *Mechanics of Materials*
  (Roylance)) on `eng.libretexts.org` / `phys.libretexts.org`.
- **Access:** rendered page HTML. robots.txt = `Crawl-delay: 5`, `Request-rate: 1/5`
  (both honoured by the ingester's per-host throttle).
- **License:** **mixed and per-page.** LibreTexts hosts CC BY, CC BY-SA, CC BY-NC,
  CC BY-NC-SA, and CC BY-NC-ND pages side by side. **The license is declared per page**
  in the footer sentence, e.g. *"This page titled 1.0: … is shared under a **CC BY-SA 4.0**
  license and was authored … by Jacob Moore."*
- **Commercial-use justification & code filter:** the ingester parses that explicit
  per-page footer sentence (`shared under a CC BY[-SA] 4.0 license`) and **keeps only
  CC BY / CC BY-SA / CC0 / PD pages**, **rejecting every CC BY-NC* / CC BY-ND page**.
  CC BY-SA pages are tagged so the corpus's downstream use honours share-alike.
- **Live-verified:** the *Mechanics Map* leaf pages carry
  `creativecommons.org/licenses/by-sa/4.0` and the footer "shared under a CC BY-SA 4.0
  license" → classified OK; index/`Special:`/landing pages without a license sentence are
  REJECTed (seen live in the validating run).

### 1.4 Known-answer reference FACTS (NIST / NAFEMS / Ghia / CODATA) — uncopyrightable

- **What:** a tiny hand-curated table of **single numeric reference values** used to
  validate CAE solvers (Euler β₁L = 1.875104; Blasius Cf = 0.664/√Re; Darcy f = 64/Re;
  Stefan-Boltzmann σ = 5.670374419e-8; Ghia lid-driven-cavity centerline numbers; NAFEMS
  LE1 = 92.7 MPa; Carnot η = 1−Tc/Th; ISA speed of sound 340.3 m/s).
- **License:** **facts are not copyrightable** (Feist v. Rural). Each value is cited to its
  named published source, but **no source text is reproduced** — only the bare number.
- **Commercial-use justification:** physical constants and single benchmark numbers carry no
  copyright. This mirrors the `KNOWN_ANSWER_ANCHORS` of `bulk_synth_physics.py` and gives the
  ingested corpus its published-benchmark anchors with explicit citation.
- **NIST note:** NIST-**authored** content is PD, but the **NIST SRD WebBook bulk data
  *compilation*** is copyright-protected under the Standard Reference Data Act
  (**15 U.S.C. §290e**) — confirmed via `nist.gov/open/license` (WebFetch 2026-06-24). We
  therefore **do NOT scrape the WebBook database**; we use only individually-cited single
  facts, which are not protected.

---

## 2. Storage-safety & politeness (code-enforced)

- **download → process → delete, one item at a time.** No raw source file is persisted;
  each NTRS citation / arXiv record / LibreTexts page is fetched into memory, converted to a
  training row, written to JSONL, and the raw bytes are dropped (`del`).
- **disk guard:** `assert_disk()` aborts (exit 3) before any fetch if free disk
  `< --min-free-gb` (default **15 GB**).
- **robots.txt honoured** per host (`urllib.robotparser`); **export.arxiv.org is refused**
  because its robots is `Disallow: /`.
- **rate-limit:** per-host throttle ≥ the host `Crawl-delay` / `Request-rate`
  (NTRS 3 s, arXiv-OAI 3 s, LibreTexts 5 s); descriptive `User-Agent` with contact email.
- **dedup** by blake2b(user+assistant) content hash.
- **schema:** every row is `{"messages":[system,user,assistant],"meta":{…}}` — byte-identical
  SYSTEM prompt to `bulk_synth_physics.py` — and **every** `meta` carries `source_url`,
  `license`, and `level` (bachelors / MS / PhD / industry).

---

## 3. REJECTED SOURCES (named — never ingested)

| Source | License found | Reason rejected |
|---|---|---|
| **OpenStax University Physics (Vol 1-3)** | **CC BY-NC-SA 4.0** | **NonCommercial** — verified via OpenStax help center (`help.openstax.org`, WebFetch 2026-06-24): *"licensed under CC BY-NC-SA … may not be used for commercial purposes without permission."* The candidate brief's "CC BY" premise is **incorrect** for OpenStax. |
| **OpenStax College Physics / the whole OpenStax catalogue** | CC BY-NC-SA 4.0 | Same NC restriction — rejected outright. |
| **arXiv papers with no `<license>` (default non-exclusive)** | arXiv default non-exclusive | Not a commercial grant; rejected by `classify_license()` default. |
| **arXiv CC BY-NC-SA / CC BY-NC-ND papers** | NC / ND | NonCommercial and/or NoDerivatives. |
| **LibreTexts CC BY-NC / CC BY-NC-SA / CC BY-ND pages** | NC / ND | NonCommercial / NoDerivatives — rejected per-page by the footer parser. |
| **NIST SRD WebBook bulk data compilation** | SRD-copyrighted (15 U.S.C. §290e) | The *compilation* is copyrighted; only individually-cited single facts are used. |
| **NTRS contractor / grantee / publisher reports** | author/publisher copyright | `determinationType != GOV_PUBLIC_USE_PERMITTED` or `containsThirdPartyMaterial`. |
| **NAFEMS / Ghia benchmark *documents* (full text/figures)** | publisher copyright | Only the bare uncopyrightable benchmark *numbers* are used, with citation; no text reproduced. |

---

## 4. Validating run (tiny — proof the pipeline works)

Run per source at `--cap` of a few items (the parent runs bulk later):

```
python3.12 scripts/ingest_physics.py --source ntrs        --cap 3
python3.12 scripts/ingest_physics.py --source arxiv       --cap 3
python3.12 scripts/ingest_physics.py --source libretexts  --cap 2
python3.12 scripts/ingest_physics.py --source anchors     --cap 50
```

Output → `archdisc-Models/data/open_ingest/physics/<source>_<ts>.jsonl`. See the task
report for the literal rows fetched and a sample extracted record showing its
`source_url` + `license` tag.

---

## 5. Realistic scale available (commercial-OK, this cluster)

| Source | Realistic commercial-OK volume |
|---|---|
| NASA NTRS (gov-public-use abstracts, physics cluster) | tens of thousands of distinct reports across the query set |
| arXiv CC BY / CC BY-SA physics abstracts | a few thousand (CC-licensed is a minority of physics submissions, but grows yearly) |
| LibreTexts CC BY / CC BY-SA engineering/physics leaf pages | a few thousand lesson pages across the mapped OER books |
| Known-answer reference facts | ~tens (curated anchors; expandable by hand) |

Net: a **low-tens-of-thousands** record open corpus that is fully commercial-clean, to be
blended with the multi-million-sample synthetic `bulk_synth_physics.py` corpus.
