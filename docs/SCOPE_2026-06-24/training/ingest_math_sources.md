# Open-Ingest Audited Sources — Cluster: Mathematics / Logic / Numerical Methods / Optimization

**Date audited:** 2026-06-24
**Ingester:** `archdisc-Models/scripts/ingest_math.py`
**Output:** `archdisc-Models/data/open_ingest/math/<source>.jsonl`
**Companion synthetic generator:** `archdisc-Models/scripts/bulk_synth_math.py` (Pillar A)

## Commercial-use gate (why this list exists)

Archie is a **commercial product**. Only licenses that permit **commercial use**
are admissible:

| Allowed | Why |
|---|---|
| **Public Domain** (US-gov NIST/NASA/USGS, or pre-1929 texts) | No copyright; any use incl. commercial. |
| **CC0 1.0** | Public-domain dedication; commercial use unrestricted. |
| **CC BY 4.0** | "...for any purpose, **even commercially**" — verified at creativecommons.org/licenses/by/4.0 (attribution only). |
| **CC BY-SA 4.0** | Same commercial grant as CC BY **plus** share-alike (derivatives must stay CC BY-SA). Verified per-project. |

Every **NonCommercial (NC)**, **NoDerivatives (ND)**, and **research-only**
license is **rejected** and never fetched. The ingester enforces this at runtime
with a license whitelist (`COMMERCIAL_OK`) + an overriding deny-list
(`LICENSE_DENY`: `by-nc`, `by-nd`, `nc-sa`, `nc-nd`, `noncommercial`, `noderiv`,
`nonexclusive-distrib`, `research-only`). A record whose verified license is not
commercial-OK is dropped before it can be written — proven by the deny-list unit
check (BY/BY-SA/CC0/PD pass; NC/ND/arXiv-nonexclusive fail).

---

## ACCEPTED sources (license verified 2026-06-24)

### 1. arXiv — `math.NA` (Numerical Analysis) + `math.OC` (Optimization & Control)
- **Access:** OAI-PMH `arXiv` metadata, `https://oaipmh.arxiv.org/oai` (set=`math`).
  *(The Atom/Query API does NOT carry a license field — verified; the OAI-PMH
  `arXiv` record DOES, in a machine-readable `<license>` element.)*
- **License (per record):** accepted **only** when `<license>` is exactly
  `http://creativecommons.org/licenses/by/4.0/` or `.../by-sa/4.0/`.
- **Commercial-use justification:** CC BY / CC BY-SA both grant commercial reuse
  with attribution (share-alike for BY-SA). Verified from
  info.arxiv.org/help/license: only **CC BY 4.0** and **CC BY-SA 4.0** of arXiv's
  options permit commercial use; CC BY-NC-SA, CC BY-NC-ND and the arXiv
  `nonexclusive-distrib/1.0` default are **rejected per record**.
- **What we ingest:** title + verbatim CC-licensed abstract → a "summarize the
  numerical/optimization contribution" study note. Abstracts only (no PDF bulk).
- **Validating run (literal):** records `arXiv:2301.12584`, `2303.00696`,
  `2306.11022` — each `<license> = CC BY 4.0`. The mixed-license OAI sample seen
  during audit (`nonexclusive-distrib`, `by-nc-sa`, `by-nc-nd` all present) was
  correctly filtered out by the gate. Level tag: **PhD** (research-grade).

### 2. Wikibooks — math books (Calculus, Linear Algebra, Numerical Methods, Optimization, Real Analysis, Discrete Math/Logic)
- **Access:** MediaWiki `action=parse` API, `https://en.wikibooks.org/w/api.php`
  (descriptive User-Agent + `maxlag=5` + ≥1 s polite delay).
- **License:** **CC BY-SA 4.0** (site-wide). Verified at
  `en.wikibooks.org/wiki/Wikibooks:Copyrights`: text is CC BY-SA 4.0 (and GFDL),
  both of which "**permit commercial use and creation of derivative works**."
- **Commercial-use justification:** CC BY-SA 4.0 explicitly allows commercial
  reuse; obligation is attribution + share-alike. Recorded in each row's
  assistant text and `meta.license`.
- **Validating run (literal):** `Calculus/Limits`, `Calculus/Differentiation`
  parsed and tagged `CC BY-SA 4.0`, level **bachelors**.

### 3. Wikiversity — math learning resources (Numerical Analysis, Linear algebra, Nonlinear finite elements)
- **Access:** same MediaWiki `action=parse` API on `en.wikiversity.org`.
- **License:** **CC BY-SA 4.0** (site-wide). Verified at
  `en.wikiversity.org/wiki/Wikiversity:Copyrights` (CC BY-SA + GFDL, both
  commercial-OK with derivatives).
- **Commercial-use justification:** identical to Wikibooks (CC BY-SA 4.0).

### 4. Project Gutenberg — US-public-domain classic math texts (e.g. Hardy, *A Course of Pure Mathematics*)
- **Access:** plain-text `gutenberg.org/files/<id>/<id>-0.txt`; the PG trademark
  **START/END** header & license footer are stripped, leaving pure PD body.
- **License:** **US Public Domain** (pre-1929 / expired copyright).
- **Commercial-use justification:** PG permission policy
  (`gutenberg.org/policy/permission.html`): the underlying texts are public
  domain and, once the **Project Gutenberg trademark/header is removed**, carry
  "no restrictions whatsoever" — including commercial use. The ingester strips
  the header/footer for exactly this reason.
- **Status:** included in the script as an accepted source; gated/optional (PG
  endpoints returned transient 504s during the audit, so arXiv + Wikibooks /
  Wikiversity are the proven runnable backbone). Level tags: **MS / PhD**.

---

## REJECTED sources (NonCommercial / NoDerivatives / research-only — NEVER fetched)

| Source | License | Reason rejected |
|---|---|---|
| **OpenStax Calculus Vol 1 / 2 / 3** | **CC BY-NC-SA 4.0** | **NonCommercial.** VERIFIED from the authoritative collection XML: `calculus-volume-1.collection.xml` `<md:license>` = `http://creativecommons.org/licenses/by-nc-sa/4.0/`; corroborated by the per-page footer and the Wikipedia OpenStax article ("...except for Calculus, which is available under CC BY-NC-SA"). The task's "OpenStax Calculus, CC BY" premise is **wrong for the Calculus bundle** — it is NC. EXCLUDED. *(Note: many OTHER OpenStax STEM books are genuine CC BY 4.0 and would be admissible, but the Calculus volumes named here are not.)* |
| **MIT OpenCourseWare** | **CC BY-NC-SA 4.0** | NonCommercial. EXCLUDED (also named in the task to exclude). |
| **arXiv papers under** `nonexclusive-distrib/1.0`, `CC BY-NC-SA`, `CC BY-NC-ND` | research-redistribution / NC / ND | Not commercial-reusable. Skipped **per record** by the OAI `<license>` filter. |
| **LibreTexts pages under** `CC BY-NC` / `CC BY-NC-SA` | NonCommercial | LibreTexts is per-page mixed-license; any NC/ND page is skipped. (Only CC BY / CC BY-SA LibreTexts pages would be admissible — none are hard-coded here pending per-page license probe.) |

---

## Record schema (every row)

Canonical Archie chat shape (identical to `bulk_synth_math.py`) **plus** the
mandated provenance fields:

```json
{
  "messages": [
    {"role": "system",    "content": "<SYSTEM, byte-identical to bulk_synth_math.py>"},
    {"role": "user",      "content": "<question / study-note prompt>"},
    {"role": "assistant", "content": "<answer, with inline attribution>"}
  ],
  "meta": {
    "pillar": "A_math",
    "gen": "arxiv_abstract | wikibooks_page | wikiversity_page | gutenberg_text",
    "topic": "<e.g. numerical analysis>",
    "source": "arxiv | wikibooks | wikiversity | gutenberg",
    "source_url": "<canonical public URL>",
    "license": "CC BY 4.0 | CC BY-SA 4.0 | Public Domain (US)",
    "level": "bachelors | MS | PhD | industry",
    "level_code": "BSc | MSc | PhD | industrial",
    "origin": "open_ingest"
  }
}
```

## Storage & etiquette discipline

- **download → process → DELETE, one item at a time**; raw source never bulk-persisted.
- **ABORT if free disk < 15 GB** (checked before every fetch).
- Descriptive `User-Agent`, Wikimedia `maxlag=5`, ≥1 s inter-request delay,
  4 MB per-item read cap, bounded `--cap`.
- In-memory BLAKE2b content-hash dedup (+ re-dedup against any existing JSONL).
