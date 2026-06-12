# Capacity Planner — Seed Migration Log (Phase 6, §12.2)

Generated locally from `capacity_planner_HTML.html` (FIRST `const RAW_DATA=[...]` declaration at line 544;
the duplicated 2nd declaration was ignored) plus `HEADCOUNT` (line 546) and the constant maps
(`AREA_CLR`, `AREA_CLS`, `TEAMS`, `PRI_LBL`, `SS_*`, `MONTHS` at lines 549–564).

Source: `C:\Users\PLEITE\Downloads\capacity_planner_HTML.html`
Output: `seed/seed_2026.json` (year = 2026, months as ints 1–12)

## Counts

| Entity | Count |
|---|---|
| areas | 10 |
| teams | 10 |
| projects | 99 |
| allocations (rows, fte>0) | 779 |
| headcount rows | 120 |

## JSON-side reconciliation totals (for §12.3 post-load check)

- **Project count:** 99
- **SUM of allocation FTE (year 2026):** 386.75
- **SUM of headcount FTE (year 2026):** 438 (10 teams × 12 months)
- **Per-team January allocation totals** (spot-check against prototype heatmap "Allocated" Jan column):

| Team | Jan allocated FTE |
|---|---|
| SALES | 9.2 |
| Architecture | 1.75 |
| WEB | 0.95 |
| AI Engineering | 0.6 |
| BA-BusinessAnalyst | 5.45 |
| ERP | 3.5 |
| Integrations | 1.3 |
| Internal Apps | 0.7 |
| Service Now | 5.75 |
| PM | 2.2 |

## Sanitization actions taken (per §12.2)

- **Raw RAW_DATA rows parsed:** 99 → **99 projects emitted** (no rows dropped).
- **Holidays/Hollidays rows dropped:** 0 (none present in the FIRST RAW_DATA declaration).
- **Stray (non-canonical) teams skipped:** 0. (Spec §12.2 warned of a possible `Sharepoint` stray in
  ROWS_INDEX; no such team appears in any project `ta` map of the first RAW_DATA block, so nothing was
  skipped or created. All `ta` team keys matched the 10 canonical teams.)
- **Junk dates nulled (`<openpy` → null):** 130 occurrences across `st`/`en` fields. Rows with valid
  `YYYY-MM` would have been converted to `YYYY-MM-01`; in this dataset every dated row used `<openpy`
  (or an empty string), so all `start_date`/`end_date` resolved to `null`.
- **Dirty t-shirt sizes cleared:** 1 — project **"Promotions Project"** had `s` = `"01.03.2026"`
  (a date in the size field) → cleared to empty string + warning logged.
- **Names:** trimmed and internal whitespace runs collapsed (e.g. `"BAU   (Incidents & Service Request)"`
  → single-spaced). Zero-width (U+200B) and NBSP (U+00A0) characters stripped/normalized
  (several project names carried trailing U+200B).
- **Multi-value fields kept verbatim:** `snow_initiative` and `ado_id` preserve embedded spaces/newlines
  exactly (e.g. `"INTV00002202 \nINTV00002285"`, `"49814\n53663"`), per §6.3 / §12.2.

## Display → choice value mappings applied (per §7)

- **priority:** source already uses `"0".."4"` keys; passed through, anything else → `""`.
- **type:** `"Project"` → `project`, `"BAU"` → `bau`, else → `""`.
- **snow_status:** `Approved→approved`, `Screening→screening`, `Qualified→qualified`, `Pending→pending`,
  `New→new`, `Completed→completed`, `Canceled→canceled`, blank → `""` (No status).
- **ado_status:** `New→new`, `In Progress→in_progress`, `Done→done`, `On Hold→on_hold`, else → `""`.
- **t_shirt_size:** kept only `XS/S/M/L/XL` (uppercased); junk → `""`.
- **months:** `Jan..Dec` → ints `1..12`.
- **start_date/end_date:** `YYYY-MM` → `YYYY-MM-01`; junk/blank → `null`.

## Spot-check (mapped values vs prototype)

| Project | area | priority | size | type | snow_status | ado_status | dates |
|---|---|---|---|---|---|---|---|
| 102 Cloud Migration… | cross function | 1 | "" | project | approved | "" | null/null (`<openpy`) |
| 107 Commissions… | Sales | 2 | "" | project | canceled | in_progress | null/null |
| 6sense D365 workflows | Marketing | 2 | M | "" | screening | "" | null/null |
| Partner Relationship Mgmt | Sales | 2 | "" | project | screening | on_hold | null/null |
| Initiative Management… | Global IT | 2 | "" | project | completed | done | null/null |
| Promotions Project | People Experience | 3 | "" (was "01.03.2026") | project | "" | "" | null/null |
| CMS Platform Project | Marketing | 1 | "" | "" | "" | "" | snow kept multi-value verbatim |

All sampled mappings verified correct against the prototype RAW_DATA.
