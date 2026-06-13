# Capacity Planner — ServiceNow Scoped Application

Production rebuild of the standalone HTML prototype
(`capacity_planner_HTML.html` — "UNIT4 Project Pipeline & Capacity Planner 2026")
as a data-driven ServiceNow scoped app. Projects, teams, monthly FTE allocations
and team headcount live in scoped tables, are edited through a Service Portal
widget that reproduces the prototype UX, and are secured by roles + ACLs.

- **Scope:** `x_335329_capplan` (vendor prefix `335329` resolved from
  `glide.appcreator.company.code`)
- **Instance built on:** `dev295018` (Australia release)
- **Version:** 1.0.0 · **Built per:** `Capacity_Planner_Requirements.docx` (build spec, executed phase by phase)

## Architecture

```
Service Portal page  cap_planner   (portal /cp)   — page role: x_335329_capplan.user
  └─ Widget  cap-planner (sp_widget)
       ├─ HTML template ...... ported prototype body (topbar, slider, sidebar, 5 panels), wrapped in .capx
       ├─ SCSS ............... prototype <style>, scoped under .capx
       ├─ Client controller .. ported vanilla JS → c.server.get(); sys_id team keys, int month keys,
       │                        $element-scoped DOM, HTML-escaped, delegated listeners, optimistic save
       ├─ Server script ...... thin router → CapacityPlannerService; sets data.canEdit
       └─ Dependency ......... global UI Script CapacityPlannerSheetJS (SheetJS 0.18.5, vendored)

Scoped app x_335329_capplan
  ├─ Tables: _area, _team, _project, _headcount, _allocation
  ├─ Script Includes: CapacityPlannerService (logic), CapacityPlannerSeedData (idempotent loader)
  ├─ Roles: .user ⊂ .planner ⊂ .admin  + ACL matrix (§8.2)
  ├─ Business Rules: BR-01 validate/normalize+dup-guard, BR-02 zero⇒delete safety net, BR-03 headcount guard
  ├─ Properties: default_year=2026, max_fte_per_cell=30, gap_warn_threshold=1
  └─ ATF suite: "Capacity Planner Regression" (T01–T08)

Global update set "Capacity Planner – Global Support 1.0"
  └─ ONLY the SheetJS UI Script (everything else is captured by the scoped app)
```

All UI data access goes through the widget server script → `CapacityPlannerService`
(no Scripted REST API in v1). Client-initiated reads/writes use `GlideRecordSecure`
so ACLs are enforced under user context; bootstrap is **3 bulk queries, no N+1**.

## Data model

5 scoped tables (no OOB extension). Allocation is the heart: one row per
project×team×year×month, `fte` decimal > 0 (0 ⇒ row deleted). See spec §6.
Choice lists per §7. Auditing on `project` + `allocation`. Unique indexes on
`allocation(project,team,year,month)` and `headcount(team,year,month)`.

## Seed / re-running the data load

The authoritative dataset is `seed/seed_2026.json` (generated from the prototype's
first `RAW_DATA` block + `HEADCOUNT`, sanitized per spec §12.2 — see
`seed/seed_log.md` for counts and every cleaning action). Load is **idempotent**
(natural-key upsert), so re-running never duplicates.

To (re)load: attach `seed/seed_2026.json` to the `CapacityPlannerSeedData` Script
Include, then in **Scripts - Background** (scope = Capacity Planner):

```javascript
var s = new x_335329_capplan.CapacityPlannerSeedData();
gs.info('SEED: ' + JSON.stringify(s.loadFromAttachment('seed_2026.json', 2026)));
```

Full step-by-step + §12.3 reconciliation queries: `tasks/MANUAL_STEPS.md §4`.

## Export to Excel (design decision)

Client-side **SheetJS** (xlsx 0.18.5), **vendored** as a global UI Script — no CDN
fetch (CSP-safe, offline-safe). The widget gathers session changes, calls
`getExportData` for 3 server-built row-arrays, and writes a 3-sheet workbook
("Soft & Hard Planning (2)", "Capacity vs Headcount", "Change Log") per spec §11.
Fallback (server CSV via GlideStringUtil) was specced but not needed — SheetJS
hosting as a UI Script was approved.

## Known limitations / notes (spec §19)

- **INTV / ADO ids** stored as verbatim strings (no live link to Demand). A
  cross-scope bridge is reserved for v2 (§5.2) — not built speculatively.
- **Year rollover:** all queries are year-scoped; `default_year` property drives
  the served year. Planning 2027 needs no schema change, just new data rows.
- **i18n:** v1 keeps EN literals in the widget; `gs.getMessage()` extraction is v1.1 debt.
- **Decimal FTE** rounded at write (BR-01) and display (2dp) to avoid drift.

## Build status (as of last automated run)

Built and verified via the MCP ServiceNow server, phase by phase:

| Phase | Status | Notes |
|-------|--------|-------|
| 1 Global update set + SheetJS | done | UI Script + update set created |
| 2 App shell / roles / properties | done | ES2021 runtime, role containment, 3 props |
| 3 Data model | built | 5 tables, 47 choices, 3 BRs; **auditing + 4 indexes = operator UI (REST 403)** |
| 4 Security ACLs | specified | `sys_security_acl` needs `security_admin` UI elevation → MANUAL_STEPS §3 |
| 5 Server layer | done | Both Script Includes; functional smoke → ATF |
| 6 Seed | built | JSON generated, areas+teams loaded; **full load = operator UI** → MANUAL_STEPS §4 |
| 7 Widget + /cp portal | built | All artifacts verified; **browser E2E = operator** → MANUAL_STEPS §6 |
| 8 ATF suite | scripts authored | Records built in UI + **run from ATF runner** → MANUAL_STEPS §7 |
| 9 Close-out | in progress | Update set complete/export pending MCP reconnect |

### Operator handover

Several steps require the ServiceNow UI because the integration user (MCP, REST
Table API) cannot write protected system tables (`sys_dictionary`, `sys_index`,
`sys_security_acl`) and this PDI's background-job scheduler does not execute
ad-hoc jobs. **All such steps are itemized in `tasks/MANUAL_STEPS.md`** with exact
clicks, snippets, and verification queries. None of them block the rest of the
build; functional uniqueness is already enforced by Business Rules.

Source of every artifact is version-controlled under `src/`. Phase log:
`dev-log.md`. Lessons: `tasks/lessons.md`. Task list: `tasks/todo.md`.
