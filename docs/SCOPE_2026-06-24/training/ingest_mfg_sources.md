# Open-Ingest Audited Sources — Cluster: Manufacturing / DFM-DFA / CNC-CAM / GD&T / Tolerancing

**Date audited:** 2026-06-24
**Ingester:** `archdisc-Models/scripts/ingest_mfg.py`
**Output:** `archdisc-Models/data/open_ingest/mfg/*.jsonl`
**Companion synthetic generator:** `archdisc-Models/scripts/bulk_synth_mfg.py` (Pillar C / Cluster 3)

## Commercial-use gate (why this list exists)

Archie is a **commercial product**. Only licenses that permit **commercial use**
*and* **derivatives** are admissible:

| Allowed | Why |
|---|---|
| **Public Domain** (US-gov NASA/NIST, 17 U.S.C. §105) | Federal-employee works carry no copyright; any use incl. commercial. |
| **CC0 1.0** | Public-domain dedication; commercial use unrestricted. |
| **CC BY 4.0 / 3.0** | "...copy and redistribute... and remix, transform, and build upon the material **for any purpose, even commercially**" — verified verbatim at creativecommons.org/licenses/by/4.0 (attribution only). |
| **CC BY-SA 4.0 / 3.0** | Same commercial grant as CC BY **plus** share-alike (derivatives stay CC BY-SA). |

Every **NonCommercial (NC)**, **NoDerivatives (ND)**, and **research-only /
unknown / all-rights-reserved** source is **rejected and never fetched**. The
ingester enforces this at runtime with a license whitelist (`ACCEPT_LICENSES`)
that `make_record()` *asserts* on before any row is written, plus per-source
gates:
- NTRS: `copyright.determinationType ∈ {GOV_PUBLIC_USE_PERMITTED, GOV_PERMITTED}`
  **and** `distribution == PUBLIC` **and** not export-restricted.
- OpenStax: `license_url` must be **bare** `creativecommons.org/licenses/by(-sa)/<v>/`
  (a regex that rejects any url containing `nc` or `nd`).

We **never** ingest copyrighted standards full text (ASME Y14.5-2018, ISO 286-1/-2,
ISO 2768, AWS D1.1 PDFs). The factual fit/tolerance **values** (IT grades, H7/g6
limits, 0.707 throat, Cp/Cpk, Chvorinov, true-position) are non-copyrightable
facts and live in the deterministic `bulk_synth_mfg.py` (KNOWN-ANSWER validated).
This open-ingest only adds open-licensed **prose** around the same training schema.

---

## ACCEPTED sources (license verified 2026-06-24)

### 1. NASA NTRS — NASA Technical Reports Server  *(PUBLIC DOMAIN)*
- **Access:** JSON search API `POST https://ntrs.nasa.gov/api/citations/search`
  (descriptive User-Agent, ≥1.2 s polite per-host delay). robots.txt = `User-agent: *` / `Allow: /` (verified — `/api/` and `/citations/` not disallowed, no crawl-delay).
- **License (per record):** **Public Domain** for US-gov works. Verified at
  `sti.nasa.gov/disclaimers`: *"United States government works ... are not
  protected by copyright in the U.S."* and may be reused freely (attribute NASA;
  do not imply endorsement). NASA's own template (`PD-USGov-NASA`) confirms NASA
  material is public domain unless noted.
- **Why commercial-OK:** PD = no copyright = unrestricted commercial use. We
  attribute NASA in every assistant turn and never use NASA insignia/identity.
- **Per-item safety gate:** the API exposes `copyright.determinationType`. We
  accept **only** `GOV_PUBLIC_USE_PERMITTED` and `GOV_PERMITTED`. Items marked
  `MAY_INCLUDE_COPYRIGHT_MATERIAL`, `COPYRIGHTED`, `PUBLIC_USE_PERMITTED`
  (NASA-cleared but `belongsToUsGov=false`, no explicit open license), or `OTHER`
  are **rejected** — these may embed contractor / third-party copyright that the
  disclaimer warns "may not be modified, reproduced, or redistributed without
  permission."
- **What we ingest:** the gov-authored **abstract** (a factual public summary)
  only — never the full PDF (which the gate would also catch for mixed-copyright
  items). 10 manufacturing-cluster queries (DFM, GD&T, tolerance allocation, CNC,
  AM, assembly, weld design, sheet-metal forming, process capability, metrology).
- **Level tag:** `industry` / `MS` / `PhD` derived from `stiType`
  (presentation/brochure→industry, report/paper→MS, thesis→PhD).

### 2. OpenStax — open textbooks  *(CC BY 4.0 books ONLY)*
- **Access:** CMS metadata API `https://openstax.org/apps/cms/api/v2/pages/`
  (book list + per-book detail). robots.txt: `/apps/cms/api/` is **allowed**
  (only `/apps/archive`, `/apps/cms/api/spike`, `/contents`, `/general`,
  `/extras` are disallowed — we touch none of those). We use a non-GPTBot UA
  (GPTBot is disallowed from `/books/`; our descriptive UA falls under `*`).
- **License (per book):** the API returns `license_name` / `license_url` /
  `license_version` per book. We accept **only** bare **CC BY 4.0**. Verified at
  creativecommons.org/licenses/by/4.0 and en.wikipedia.org/wiki/OpenStax: OpenStax
  books are CC BY 4.0 *except* a few titles (Calculus, Algebra 1, Additive
  Manufacturing Essentials) that are **CC BY-NC-SA** — those are rejected by the
  url gate.
- **Why commercial-OK:** CC BY 4.0 grants commercial reuse + derivatives with
  attribution; recorded in `meta.attribution` + the assistant text.
- **What we ingest:** the CC-BY book **title + description** (the openly licensed
  catalog prose) framed as a "what does this text cover / how does it support
  manufacturing & quality engineering" study note. Accepted STEM titles that feed
  the cluster: *College Physics, Physics, University Physics, Introductory
  Statistics, Introductory Business Statistics, Chemistry, College Algebra,
  Algebra and Trigonometry* (statistics → SPC / Cp / Cpk / tolerance stack-ups;
  physics/materials → process selection & DFM).
- **Level tag:** `bachelors`.

### 3. NIST — National Institute of Standards and Technology  *(PUBLIC DOMAIN)*
- **Access:** **curated allowed-URL seed list** of `/publications/<slug>` landing
  pages (NOT the search index). robots.txt **DISALLOWS** `/search/`,
  `/site-search`, `/fusion-search` — so we deliberately do **not** crawl NIST
  search. `/publications/` landing pages are allowed; we fetch each seed URL
  directly and extract the abstract from its `dc.description` / `og:description`
  meta tag.
- **License:** **Public Domain** (US-gov, 17 U.S.C. §105). Verified at
  `nist.gov/oism/copyrights`: *"information presented on NIST sites are considered
  public information and may be distributed or copied"* (byline credit requested,
  not required).
- **Why commercial-OK:** PD = unrestricted commercial use. NIST is the US national
  metrology institute → authoritative measurement-grounded tolerancing/GD&T prose.
- **What we ingest:** the PD abstract of each seeded publication (e.g. *"A Brief
  Analysis of Recent ISO Tolerancing Standards…"*, *"Investigating the Role of
  GD&T in Additive Manufacturing"*). Extend the seed list (verified-allowed
  landing-page URLs only) for the bulk run; the fetcher skips any 404.
- **Level tag:** `industry`.

---

## REJECTED sources (named so we never ingest them)

| Source | License found | Reason rejected |
|---|---|---|
| **LibreTexts** (chem/eng/workforce bookshelves) | **CC BY-NC-SA 4.0** (site default; verified in chem.libretexts.org page footer) | **NonCommercial** — no commercial use. Licenses also vary per page, so unsafe for bulk. Excluded entirely unless a specific page explicitly shows CC BY / CC BY-SA / CC0 / PD. |
| **OpenStax — Additive Manufacturing Essentials** | **CC BY-NC-SA 4.0** (verified via CMS API `license_url`) | **NonCommercial** — topically perfect but NC; rejected by the OpenStax url gate. |
| **OpenStax — Calculus Vol 1/2/3, Algebra 1, Algebra & Trig 2e** | **CC BY-NC-SA 4.0** | **NonCommercial** — rejected by the url gate. |
| **NTRS items: `MAY_INCLUDE_COPYRIGHT_MATERIAL` / `COPYRIGHTED` / `OTHER`** | mixed / third-party copyright | May embed contractor/journal copyright; rejected per-item. |
| **NTRS items: `PUBLIC_USE_PERMITTED` with `belongsToUsGov=false`** | NASA-cleared, no open license, not US-gov-authored | No explicit commercial grant + not a §105 PD gov work → rejected for a commercial product (conservative). |
| **ASME Y14.5-2018, ISO 286-1/-2, ISO 2768, AWS D1.1 (standards full text PDFs)** | All-rights-reserved (SDO copyright) | Copyrighted. We use only the **factual numeric values** (facts, not copyrightable) inside the deterministic generator — never the prose/PDF. |
| **GrabCAD / ShapeNet** (per memory) | gated / research-only | Not commercial-clean; not fetched. |

---

## Output record schema

Chat-JSONL matching the FROZEN `bulk_synth_*.py` schema, with three added
provenance fields on `meta`:

```json
{
  "messages": [
    {"role": "system",    "content": "You are Archie, an expert manufacturing ... engineer."},
    {"role": "user",      "content": "<question grounded in the open-licensed source>"},
    {"role": "assistant", "content": "Source: <citation> (<license>) ... <content> ... takeaway"}
  ],
  "meta": {
    "field": "ntrs_mfg | openstax_foundations | nist_mfg",
    "topic": "<sti type / book title / metrology-standards>",
    "source_url": "<canonical citation/landing URL>",
    "license": "PUBLIC-DOMAIN-USGov | CC-BY-4.0 | CC-BY-SA-4.0 | CC0-1.0",
    "level": "bachelors | MS | PhD | industry",
    "origin": "open_ingest",
    "attribution": "<required CC-BY attribution string, OpenStax only>"
  }
}
```

## Storage safety & politeness

- Strictly **one item at a time**: fetch → parse in memory → one tiny `mktemp`
  file → append to output → `os.remove` the temp. No bulk download.
- **Aborts immediately** (exit 3) if free disk < **15 GB** (`--min-free-gb`),
  checked before *every* record.
- Per-host rate-limit (1.2 s), descriptive User-Agent, robots-aware (we only hit
  endpoints verified ALLOWED above; NIST `/search/` deliberately avoided).
- In-memory `blake2b` dedup on the user text. `--out /dev/stdout` stays pure JSONL
  (all logging → stderr).

## Validating run (literal — 2026-06-24)

```
$ python3 scripts/ingest_mfg.py --out /tmp/mfg_sample.jsonl \
      --sources ntrs,openstax,nist --ntrs-per-query 2 --max-openstax 2 --cap 6
[ntrs] REJECT id=20250011008 det=MAY_INCLUDE_COPYRIGHT_MATERIAL dist=PUBLIC
[ntrs] REJECT id=20000097370 det=PUBLIC_USE_PERMITTED dist=PUBLIC
[ntrs] REJECT id=20220004028 det=MAY_INCLUDE_COPYRIGHT_MATERIAL dist=PUBLIC
[ntrs] REJECT id=20150018301 det=PUBLIC_USE_PERMITTED dist=PUBLIC
[ntrs] REJECT id=20060036678 det=OTHER dist=PUBLIC
[ingest_mfg] DONE 6 unique records -> /tmp/mfg_sample.jsonl ; by-source={'ntrs_mfg': 6}

$ python3 scripts/ingest_mfg.py --sources openstax --max-openstax 3 --cap 3
[openstax] REJECT 'Calculus Volume 1' license=...Attribution-NonCommercial-ShareAlike url=.../by-nc-sa/4.0/
[ingest_mfg] DONE 3 unique records ; by-source={'openstax_foundations': 3}  (CC-BY-4.0 only)

$ python3 scripts/ingest_mfg.py --sources nist --cap 3
[ingest_mfg] DONE 2 unique records ; by-source={'nist_mfg': 2}  (both seeds 200, PD)
```

One extracted record (NTRS, public domain):
```json
{"meta": {"field": "ntrs_mfg", "topic": "PRESENTATION",
  "source_url": "https://ntrs.nasa.gov/citations/20240001401",
  "license": "PUBLIC-DOMAIN-USGov", "level": "industry", "origin": "open_ingest"},
 "user": "Summarize the manufacturing/DFM problem and the reported approach in
   the NASA technical work titled \"Demonstration of How Manufacturing
   Innovations Challenge Conventional Structural Design\"...",
 "assistant": "Source: NASA NTRS technical record (PRESENTATION), public domain
   (US-gov). ... lightweight metallic fuselage prototype ... innovative forming
   and joining processes ... high-rate manufacturing ..."}
```

## Realistic scale available

- **NASA NTRS:** the manufacturing/DFM/AM/GD&T/metrology corpus runs into the
  **tens of thousands** of PUBLIC records; after the `GOV_*` determination + topic
  gate, on the order of **5k–15k** clean PD abstracts are reachable by broadening
  the query set and paging. **Largest commercial-clean engine here.**
- **OpenStax:** ~**8–12** pure-CC-BY STEM titles (book-level metadata) → tens of
  records at metadata granularity; foundational, not high-volume.
- **NIST:** seed-list bounded; **hundreds** of PD publication landing pages are
  reachable by hand-curating allowed `/publications/` URLs (search is robots-off).
- **Combined realistic clean yield for this cluster: ~6k–16k open-licensed prose
  records**, complementing the deterministic millions from `bulk_synth_mfg.py`.
