# Open-Ingestion Source Audit — Cluster 5 (EE · Control · Robotics · Mechatronics · Signals · MBD)

**Date:** 2026-06-24
**Ingester:** `archdisc-Models/scripts/ingest_mechatronics.py`
**Output:** `archdisc-Models/data/open_ingest/mechatronics/{arxiv,ntrs,books}.jsonl`

## Governing rule — COMMERCIAL USE ONLY

Archie ships as a **commercial product**. We ingest a source **only** if its
license permits commercial use:

| Allowed | Why commercial-OK |
|---|---|
| **Public Domain** (US-gov works: NASA / NIST / USGS) | 17 U.S.C. §105 — works of the US government are not subject to copyright; free for any use including commercial. |
| **CC0 1.0** | Public-domain dedication; no conditions; commercial use explicit. |
| **CC BY 3.0 / 4.0** | Attribution only; "for any purpose, even commercially" is in the deed. |
| **CC BY-SA 4.0** | Attribution + ShareAlike; commercial use permitted; derivatives must carry the same license (we honor this in distribution). |

**Rejected unconditionally** (never fetched / never ingested): any license with
**NC** (NonCommercial), **ND** (NoDerivatives), or **research-/distribution-only**
terms, plus "all rights reserved", "not declared", or unknown.

The gate is **per-item and authoritative** — see `classify_cc_url()` and the
per-source gates in the script. It is not a blanket trust of the host.

---

## ACCEPTED SOURCES

### 1. arXiv — `eess.SY`, `cs.RO`, `eess.SP` (CC BY / CC BY-SA / CC0 papers only)

- **Endpoint:** OAI-PMH `https://oaipmh.arxiv.org/oai?verb=ListRecords&metadataPrefix=arXivRaw&set=<set>`
  - sets: `eess:eess:SY` (Systems & Control), `cs:cs:RO` (Robotics), `eess:eess:SP` (Signal Processing)
- **License gate:** the per-paper `<license>` element in the OAI `arXivRaw` metadata.
  - **ACCEPT** only `creativecommons.org/licenses/by/{3.0,4.0}`, `…/by-sa/…`, `…/publicdomain/zero/…` (CC0).
  - **REJECT** `arxiv.org/licenses/nonexclusive-distrib/1.0/` (this is arXiv's own
    distribution license — **NOT** Creative Commons, no commercial grant) and any
    `…/by-nc-…` / `…/by-nd-…`.
- **Commercial-use justification:** only papers the *author* released under CC BY /
  CC BY-SA / CC0 pass; those licenses grant commercial use directly. We store the
  abstract (the author's own copyrightable text, covered by the CC grant) + a link
  to `arxiv.org/abs/<id>` with attribution baked into the record.
- **Verified live (2026-06-24):** in one `eess:eess:SY` page, the gate **accepted**
  `arXiv:1906.05008` (CC BY 4.0) and **rejected 80** others — 79 carrying
  `nonexclusive-distrib/1.0` and 1 carrying `by-nc-sa/4.0`.
- **robots.txt:** `oaipmh.arxiv.org` serves no robots.txt (404) → no crawl restriction;
  we still rate-limit to 1.5 s/request with a contact UA.

### 2. NASA NTRS — US-government technical reports (PUBLIC DOMAIN)

- **Endpoint:** `https://ntrs.nasa.gov/api/citations/search?q=<query>&page.size=25` (JSON).
- **License gate:** `distribution == "PUBLIC"` **AND** `copyright.determinationType ∈
  {GOV_PUBLIC_USE_PERMITTED, PUBLIC_USE_PERMITTED}`.
- **Commercial-use justification:** US-government works are public domain (17 U.S.C.
  §105); NTRS explicitly marks the cleared records `PUBLIC` + public-use-permitted.
  Anything not matching the gate (e.g. contractor-copyright, export-restricted) is rejected.
- **Verified live (2026-06-24):** queries returned `distribution: PUBLIC`,
  `determinationType: GOV_PUBLIC_USE_PERMITTED`; ingested e.g. NTRS `19930022267`
  "Atmospheric control systems", tagged *Public Domain (US Government work)*.
- **robots.txt:** `ntrs.nasa.gov/robots.txt` = `User-agent: * / Allow: /` (all paths
  allowed). We rate-limit politely anyway.
- **Note:** at validation scale we ingest the citation **abstract** (research-grade) +
  provenance; the parent bulk run may also pull the PD `downloads/*.pdf` (still
  one-at-a-time, storage-safe).

### 3. LibreTexts (Engineering, CC BY / CC BY-SA pages only)

- **Seed verified:** `Chemical_Process_Dynamics_and_Controls_(Woolf)` → **CC BY 3.0**
  (commercial-OK). Confirmed live both by WebFetch and by the script's own
  `verify_page_license()` reading the CC URL out of the page HTML.
- **License gate:** LibreTexts licenses are **per-book / per-page** — the script
  re-reads the CC URL from each page and only extracts if it classifies as
  by / by-sa / zero. Pages marked "not declared" or NC are skipped (the
  Industrial-and-Systems-Engineering bookshelf *root*, e.g., reported "not declared"
  on WebFetch and would be rejected — we only seed pages whose own footer is CC BY/BY-SA).
- **Commercial-use justification:** CC BY 3.0 deed grants commercial use with attribution.
- **robots.txt:** honored at fetch time via `urllib.robotparser`.

### 4. Wikibooks (CC BY-SA 4.0)

- **Seeds verified:** `Control_Systems`, `Signals_and_Systems`, `Robotics` →
  **CC BY-SA 4.0** (Wikibooks site-wide text license), confirmed live on the
  `Control_Systems` page footer.
- **Commercial-use justification:** CC BY-SA 4.0 permits commercial use; we carry
  attribution + the BY-SA tag so downstream distribution can honor ShareAlike.
- **License gate:** still re-verified per page by `verify_page_license()`.
- **robots.txt:** honored.

### 5. OpenStax (CC BY 4.0 textbooks) — *configured, seed-gated*

- **License:** OpenStax core line is **CC BY 4.0** (commercial-OK). **Exception:**
  *Calculus* is **CC BY-NC-SA** → that title is REJECTED.
- **Status:** OpenStax book pages are JS-rendered (license not in the static HTML),
  so they are not in the live-scrape seed list yet; when added, the same
  per-page/per-book license gate applies and only CC BY 4.0 titles pass. Until then
  OpenStax content is reachable via its CC BY 4.0 CNX/where-stated sources only.

---

## REJECTED / EXCLUDED SOURCES (named — never fetched for content)

| Source | License | Reason rejected |
|---|---|---|
| **MIT OpenCourseWare** | CC BY-**NC**-SA 4.0 | **NC** — no commercial use. Excluded by directive and by rule. |
| **arXiv papers w/ `nonexclusive-distrib/1.0`** | arXiv distribution license | Not Creative Commons; grants arXiv distribution rights only, **no commercial grant** to us. (79/83 sampled SY papers.) |
| **arXiv papers w/ `CC BY-NC` / `CC BY-NC-SA` / `CC BY-NC-ND`** | CC **NC** (± **ND**) | NonCommercial (and some NoDerivatives). |
| **arXiv papers w/ `CC BY-ND`** | CC **ND** | NoDerivatives — cannot build training derivatives. |
| **LibreTexts "not declared" / CC BY-NC pages** | undeclared / **NC** | No commercial grant; rejected by `verify_page_license()`. |
| **OpenStax *Calculus*** | CC BY-**NC**-SA | **NC**. |
| **NTRS records not `PUBLIC` / not public-use-permitted** | contractor / export-restricted | Not cleanly public domain. |
| Any "all rights reserved" / unknown-license page | — | Default-deny. |

---

## Storage & politeness guarantees

- **download → process → delete, one item at a time**; nothing accumulates on disk
  except the passing JSONL rows.
- **Aborts** (`exit 3`) if free disk on the output volume drops below **15 GB**
  (`assert_disk_ok` is called before every source and inside each loop).
- **robots.txt** honored per host (`urllib.robotparser`); **1.5 s** rate-limit per host;
  descriptive `User-Agent` with a contact email.
- **Dedup** by content hash (blake2b over user+assistant text), in-memory and against
  the existing on-disk JSONL.

## Record schema (matches `bulk_synth_mechatronics.py` + provenance)

```json
{"messages":[
   {"role":"system","content":"…Archie…"},
   {"role":"user","content":"…question…"},
   {"role":"assistant","content":"…research-grade answer…"}],
 "meta":{"field":"…","topic":"…","level":"bachelors|MS|PhD|industry",
         "source":"arXiv|NASA NTRS|LibreTexts|Wikibooks",
         "source_url":"https://…","license":"CC BY 4.0|CC BY-SA 4.0|CC BY 3.0|Public Domain (US Government work)",
         "license_url":"https://…","ingest_ts":"ISO-8601"}}
```
