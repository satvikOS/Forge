# Open-Ingest License Audit — PLM · PDM · BIM · MES · ERP · Systems-Engineering · Digital-Twin

> **Companion to** `archdisc-Models/scripts/ingest_plm.py` (the runnable,
> storage-safe, license-tagged bulk ingester) and the synthetic generator
> `archdisc-Models/scripts/bulk_synth_plm.py`. Where `sourcing_plm.md` says
> *which canon the framing must be faithful to*, this doc records *which sources
> we may actually INGEST verbatim* — and, critically, **why each is legally clean
> for a COMMERCIAL product (Archie)** plus the explicit **rejected** list.
>
> **Governing rule.** Archie ships commercially. We ingest **ONLY** sources whose
> license permits commercial use: **PUBLIC DOMAIN** (U.S.-gov works under
> 17 U.S.C. §105 — NIST / NASA / USGS), **CC0**, **CC BY**, or **CC BY-SA**.
> Any **NonCommercial (NC)**, **NoDerivatives (ND)**, or **research-only** license
> is **REJECTED** and never fetched. License verified on each source's own
> record/terms page (dates: 2026-06-24).

---

## 1. ACCEPTED SOURCES (all commercial-use-OK)

Every accepted source below is a **U.S.-Government work in the PUBLIC DOMAIN**.
U.S.-gov works are not subject to U.S. copyright (17 U.S.C. §105); they may be
copied, modified, redistributed, and used commercially royalty-free. We record
the standard courtesy attribution in each record's `meta.attribution` (a request,
not a copyright condition). No CC-NC / CC-ND / research-only source appears here.

| Key | Source | URL (PDF) | License verified | Commercial-use basis |
|---|---|---|---|---|
| `nasa_seh` | **NASA Systems Engineering Handbook Rev 2** (NASA/SP-2016-6105) | `https://ntrs.nasa.gov/api/citations/20170001761/downloads/20170001761.pdf` | NTRS record 20170001761 → **"Copyright: Public Use Permitted"**, Distribution: **Public** | U.S.-gov work, PD (17 U.S.C. §105). Free for any use incl. commercial. |
| `nasa_eg_se_v1` | **Expanded Guidance for NASA Systems Engineering, Vol 1** (NASA/SP-2016-6105-SUPPL) | `https://ntrs.nasa.gov/api/citations/20170007238/downloads/20170007238.pdf` | NTRS record 20170007238 → **"Work of the US Gov. Public Use Permitted"**, Distribution: **Public** | U.S.-gov work, PD. Commercial use OK. |
| `nist_ir8107` | **NIST IR 8107 — Current Standards Landscape for Smart Manufacturing Systems** | `https://nvlpubs.nist.gov/nistpubs/ir/2016/NIST.IR.8107.pdf` | NIST license policy (`nist.gov/open/license`): NIST employee works are PD per 17 U.S.C. §105 — "may copy, modify, create derivatives, distribute, royalty-free worldwide" | U.S.-gov work, PD. Commercial use OK. Attribution "Republished courtesy of NIST" recorded. |
| `nist_tn1820` | **NIST TN 1820 — Model-Based Enterprise Summit Report** | `https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.1820.pdf` | Same NIST PD policy | U.S.-gov work, PD. Commercial use OK. |
| `nist_ams_100_24` | **NIST AMS 100-24 — Proceedings, 10th Model-Based Enterprise Summit** | `https://nvlpubs.nist.gov/nistpubs/ams/NIST.AMS.100-24.pdf` | Same NIST PD policy | U.S.-gov work, PD. Commercial use OK. |
| `nist_ams_300_12` | **NIST AMS 300-12 — STEP AP242 / Digital-Thread Manufacturing Guidance** | `https://nvlpubs.nist.gov/nistpubs/ams/NIST.AMS.300-12.pdf` | Same NIST PD policy | U.S.-gov work, PD. Commercial use OK. |

### 1.1 License justification, per source

- **NASA SEH Rev 2 & Expanded Guidance Vol 1.** The authoritative provenance is
  the **NASA Technical Reports Server (NTRS)** record for each, which stamps the
  copyright field as *"Public Use Permitted"* / *"Work of the US Gov. Public Use
  Permitted"* and the distribution as *Public / Unlimited*. These are works
  authored by U.S.-Government employees → no U.S. copyright (17 U.S.C. §105) →
  free for commercial use. **Note on NASA's media-usage page:** that page's
  "commercial" cautions are about **trademark / endorsement** (do not use the
  NASA logo or imply NASA endorsement) and identifiable-persons publicity rights —
  *not* a copyright restriction on the **text** of a public-domain technical
  handbook. Our ingester takes only the **prose**, never the NASA insignia, and
  every record states it is a PD U.S.-gov work — so there is no endorsement or
  trademark exposure. (NTRS `robots.txt` is `Allow: /`.)

- **NIST IR / TN / AMS publications.** `https://www.nist.gov/open/license`
  states verbatim: *"works of NIST employees are not subject to copyright
  protection in the United States"* (17 U.S.C. §105) and grants the right to
  *copy, modify, create derivative works, distribute, royalty-free worldwide*.
  The only request is attribution — *"Republished courtesy of the National
  Institute of Standards and Technology"* — which we write into `meta.attribution`
  of every record. `nvlpubs.nist.gov` serves no `robots.txt` (404 → no crawl
  restriction). Commercial use is explicitly permitted.

### 1.2 Why these are the right ACCEPTED sources for this cluster

- NASA SEH + Expanded Guidance = the deepest **public-domain systems-engineering**
  corpus that exists: the SE engine, the 17 common technical processes,
  requirements flow-down, V-model verification/validation, trade studies,
  interface/risk/configuration management — exactly Cluster-4 sub-fields 1, 9.
- NIST IR 8107 / TN 1820 / AMS 100-24 / AMS 300-12 = the public-domain canon for
  **digital thread, Model-Based Enterprise / MBD, STEP AP242 interoperability and
  the smart-manufacturing standards landscape** — Cluster-4 sub-fields 1 (PLM/STEP),
  4 (MES), 6 (digital twin/thread). They name the very ISO/IEC standards (ISO 10303
  AP242, ISA-95, IEC 62264, OPC-UA) the generator already anchors to, but as
  freely-usable U.S.-gov prose rather than copyrighted standard text.

---

## 2. REJECTED SOURCES (never fetched)

These were considered for the cluster and **REJECTED** because their license does
**not** permit commercial use (NC / ND / research-only / all-rights-reserved).
`ingest_plm.py` does **not** reference any of them.

| Source | License found | Why REJECTED |
|---|---|---|
| **ISO 10303 (STEP) / ISO 19650 / ISO 16739 (IFC) / ISO 14040-44 / IEC 62264 (ISA-95) / IEC 61512 (ISA-88) / IEC 62541 (OPC-UA)** — the standards' own text | © ISO / © IEC, all rights reserved, sold per-copy | Copyrighted standards. We use only the **PD/CC summaries** and the standard's **defined facts** (numbers, hierarchy names) via `bulk_synth_plm.py`'s "modeled-on, never verbatim" anchors — we **never ingest the standard text**. |
| **INCOSE Systems Engineering Handbook v5 (2023)** + **SEBoK** body text | © INCOSE / Wiley, all rights reserved (SEBoK is CC BY-**NC**-SA) | INCOSE SEH is sold/copyrighted; **SEBoK is CC BY-NC-SA → NonCommercial → REJECTED.** Use only as a *rigor reference* in `sourcing_plm.md`, not ingested. |
| **MITRE Systems Engineering Guide (SEG)** | MITRE all-rights-reserved terms of use (IP page returned 403; terms restrict redistribution) | Not an open commercial-use license; **REJECTED** out of caution. |
| **PMBOK 7 (PMI), Stark *PLM*, Hopp & Spearman *Factory Physics*, Montgomery *SQC*, Hillier & Lieberman *OR*, Eastman *BIM Handbook*, Crawley *System Architecture*, Tompkins *Facilities Planning*** | © publishers (Springer / Wiley / McGraw-Hill / PMI / MIT Press), all rights reserved | Copyrighted textbooks. Used only as the **rigor bar** in `sourcing_plm.md`; **never ingested**. |
| **APICS/ASCM CPIM/CSCP body of knowledge** | © ASCM, member/paywalled | Copyrighted; **REJECTED**. |
| **AIAG-VDA FMEA Handbook (2019), EIA-649C, MIL-HDBK-61 (as distributed by SAE/ASQ resellers)** | © AIAG/VDA/SAE, sold | Copyrighted commercial handbooks; **REJECTED** for ingest. (MIL-STD/MIL-HDBK *original* DoD issues are PD, but the reseller-formatted PDFs are not cleanly so — we do not ingest them.) |
| **GrabCAD / ShapeNet** (mentioned only for context) | Gated / non-commercial terms | Already known-gated; not a text source for this cluster; **REJECTED**. |
| **Wikipedia / generic web PLM blogs** | CC BY-SA *would* be OK, but provenance/quality is unverifiable per-page | **Deferred** — not ingested here; we hold the corpus to named PD primary sources only. |

> **Net:** the cluster's copyrighted canon (ISO/IEC standards, INCOSE/SEBoK,
> textbooks) is honoured as a *framing/rigor reference* inside `bulk_synth_plm.py`
> (computed numbers + "modeled-on" anchors, never reproduced text). The only
> material we **ingest verbatim** is **public-domain U.S.-Government prose**.

---

## 3. THE INGESTER (`scripts/ingest_plm.py`)

- **Storage-safe.** One source at a time: download the single PDF to a temp file
  → extract+chunk in memory → append JSONL → **delete the temp PDF** (in a
  `finally`, every path). Free-disk checked **before each download**; **aborts if
  < 15 GB free**. Per-source 80 MB download cap. Nothing of a raw source persists.
- **Output.** `archdisc-Models/data/open_ingest/plm/<source>.jsonl` +
  merged `plm_open_ingest.jsonl` + `_ingest_summary.json`.
- **Schema** (identical to `bulk_synth_plm.py`, with provenance fields added):

  ```json
  {"messages":[
     {"role":"system","content":"<canonical Cluster-4 SYSTEM, byte-identical>"},
     {"role":"user","content":"Per the NASA Systems Engineering Handbook, explain ..."},
     {"role":"assistant","content":"<PD passage> [Source: ..., p.N. Courtesy ...]"}],
   "meta":{"field":"open_ingest_plm","topic":"systems_engineering","level":"MSc",
           "source":"nasa_seh","source_title":"NASA Systems Engineering Handbook Rev 2 ...",
           "source_url":"https://ntrs.nasa.gov/api/citations/20170001761/downloads/20170001761.pdf",
           "source_page_url":"https://ntrs.nasa.gov/citations/20170001761","source_page":15,
           "license":"PUBLIC DOMAIN (U.S. Government work, 17 U.S.C. 105; ...)",
           "attribution":"Courtesy NASA / NTRS (Public Use Permitted)"}}
  ```

  **Every record carries `source_url` + `license` + `level`** so a provenance/
  license audit is one `jq` away. `level ∈ {BSc, MSc, PhD, industrial}` (the
  `bulk_synth_plm.py` `LEVELS` vocabulary), assigned per topic in `LEVEL_BY_TOPIC`.
- **Quality gate.** `is_research_grade()` keeps only multi-sentence engineering
  prose (≥0.62 letter ratio, domain anchor terms, no TOC/figure/dotted-leader
  noise). Dedup = in-memory blake2b on the user text (matches `bulk_synth_*`).
- **Politeness.** Honours `robots.txt` (NTRS `Allow:/`; nvlpubs has none) and
  sleeps 4 s between hosts.

### 3.1 Run modes

```bash
# license/robots/deps preflight, fetches NOTHING
python scripts/ingest_plm.py --selfcheck

# tiny PROOF run (a few pages, a few rows per source)
python scripts/ingest_plm.py --sources nasa_seh nist_ir8107 --max-pages 6 --max-rows 4

# full bounded ingest (the PARENT runs this; not run here)
python scripts/ingest_plm.py
```

### 3.2 Validating PROOF run (2026-06-24)

`--sources nasa_seh nist_ir8107 --max-pages 6 --max-rows 4`: downloaded
NASA SEH (4.1 MB) then NIST IR 8107 (2.5 MB) **one at a time**, deleted each temp
PDF, wrote **8 rows**, all `license = PUBLIC DOMAIN`, free disk 174.3 GB. Sample
record (NIST IR 8107, p.9, MSc): research-grade smart-manufacturing prose
("…seamless integrations within and across SMS dimensions … lead to SMS
capabilities…"), `source_url = https://nvlpubs.nist.gov/nistpubs/ir/2016/NIST.IR.8107.pdf`,
attributed "Republished courtesy of NIST". Pipeline proven; bulk run deferred to
the parent.

---

## 4. SCALE ESTIMATE (this cluster, these PD sources)

| Source | Pages | Research-grade passages (est.) |
|---|---|---|
| NASA SEH Rev 2 | 356 | ~1,200–1,600 |
| NASA Expanded Guidance Vol 1 | ~700 | ~2,500–3,200 |
| NIST IR 8107 | 39 | ~120–180 |
| NIST TN 1820 | ~50 | ~150–220 |
| NIST AMS 100-24 | ~120 | ~350–500 |
| NIST AMS 300-12 | ~80 | ~250–350 |
| **Total (1 passage → 1 row)** | | **~4,600–6,000 PD ingested rows** |

This is a focused, **fully license-clean** PD seed (single passage → single row).
It complements — not replaces — the millions of computed synthetic rows from
`bulk_synth_plm.py`. Additional PD breadth (more NIST AMS/IR titles, GAO
Cost/Schedule guides, additional NASA SP handbooks, USGS) can be added to the
`SOURCES` dict the same way without changing the pipeline.
