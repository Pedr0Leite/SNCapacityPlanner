# Capacity Planner — Dev Log

## Phase 2 — Application shell, roles, properties

Tooling: MCP `servicenow-sse` (REST Table API, synchronous). Instance dev295018.

### Environment note / blocker (resolved)
- `execute_background_script` / `run_fix_script` schedule via `sys_trigger` (RunScriptJob).
  On this PDI those one-shot triggers stay in state=Ready, run_count=0, claimed_by empty
  (verified after 45s+). Recurring system triggers ARE advancing, so the scheduler core is
  alive but ad-hoc RunScriptJob jobs are not being claimed. => Background scripts UNUSABLE.
  All Phase 2 work done via synchronous REST Table API instead. syslog readback channel also
  never received rows (triggers never ran).

### Scope assignment gotcha (resolved)
- Metadata records (sys_user_role, sys_properties) created via REST landed in `global`
  despite MCP `set_scope x_335329_capplan` and explicit `sys_scope` in payload.
- Root cause: REST metadata scope follows the integration user's persisted current-application
  (`sys_user_preference` name=`apps.current_app`), which was `global`. The `sysparm_current_scope`
  URL param does not drive metadata scope assignment.
- Fix: set the admin user's `apps.current_app` preference (sys_id d62645fb47954b10654c57f1d16d434c)
  to the app sys_id `e0a1423347510f10654c57f1d16d43f1`. After that, all metadata inserts
  auto-scoped to the app correctly.
- `sys_scope`/`sys_package` are IMMUTABLE on existing metadata via PATCH (silently reverted),
  so the 3 records created before the fix (.user role, .planner role, default_year prop) were
  DELETED and RECREATED in-scope. Left `apps.current_app` pinned to the app (correct context
  for remaining build phases).

---

## Scoped Application
- Type: sys_app (scoped application)
- Scope: x_335329_capplan
- Status: BUILT
- sys_id: e0a1423347510f10654c57f1d16d43f1
- Name: Capacity Planner | version 1.0.0
- Short description: Project pipeline and team capacity planning (monthly FTE allocation vs headcount).
- JS runtime (js_level): es_latest = "ECMAScript 2021 (ES12)"  [confirmed via sys_choice on sys_scope; matches sibling x_335329_* apps]
- runtime_access_tracking: permissive = "Tracking" (NOT Enforcing, per spec §4/§5.2)
- vendor_prefix: x_335329
- Built at: 2026-06-12 17:34 (UTC)

## Roles (sys_user_role, scope = app)
- x_335329_capplan.user    sys_id a3f2cab747510f10654c57f1d16d4328  | BUILT
- x_335329_capplan.planner sys_id f7f2cab747510f10654c57f1d16d4395  | BUILT
- x_335329_capplan.admin   sys_id 23b28e7747510f10654c57f1d16d43d3  | BUILT

## Role containment (sys_user_role_contains, scope = app)
- planner contains user : sys_id 181342f747510f10654c57f1d16d4343  | BUILT
- admin contains planner: sys_id e41342f747510f10654c57f1d16d4364  | BUILT
- (admin -> planner -> user transitive chain per §8.1)

## Application properties (sys_properties, scope = app)
- x_335329_capplan.default_year       integer = 2026  sys_id d803cab747510f10654c57f1d16d43d4 | BUILT
- x_335329_capplan.max_fte_per_cell   integer = 30    sys_id 99034eb747510f10654c57f1d16d4350 | BUILT
- x_335329_capplan.gap_warn_threshold string  = 1     sys_id ce038eb747510f10654c57f1d16d43fe | BUILT

## Verification (all PASS)
- sys_app: 1 record, scope=x_335329_capplan, version=1.0.0, js_level=es_latest, runtime_access_tracking=permissive. PASS
- sys_user_role: 3 roles, all sys_scope = app. PASS
- sys_user_role_contains: planner->user and admin->planner confirmed. PASS
- sys_properties: 3 props, correct types/values, all sys_scope = app. PASS

## Notes for later phases
- Background scripts can't be used for Phase 3 verification (duplicate-insert/BR abort tests).
  Plan: verify BRs via synchronous REST inserts that trigger the BR and check the HTTP error,
  or via ATF (Phase 8) which runs through the transaction engine.
- `apps.current_app` preference left = app scope so Phase 3-7 metadata auto-scopes correctly.

---

# Phase 3 — Data model (5 tables, choices, indexes, business rules)

Tooling: MCP `servicenow-sse` synchronous REST Table API. All metadata auto-scoped to
`x_335329_capplan` (sys_scope e0a1423347510f10654c57f1d16d43f1) via the pinned
`apps.current_app` preference; verified on first table (area) before proceeding. Built 2026-06-12 ~17:43-17:51 UTC.

## Tables (sys_db_object, all scope = x_335329_capplan)
| Table | sys_id | Custom cols | Display | Auditing |
|---|---|---|---|---|
| x_335329_capplan_area | 27a3c63b47510f10654c57f1d16d4333 | 6 | name | n/a |
| x_335329_capplan_team | 83b3ca3b47510f10654c57f1d16d4311 | 3 | name | n/a |
| x_335329_capplan_project | a3b3ca3b47510f10654c57f1d16d434e | 15 | name | REQUIRED — NOT SET (blocker, see below) |
| x_335329_capplan_headcount | bbb3ca3b47510f10654c57f1d16d43b0 | 4 | (team) | n/a |
| x_335329_capplan_allocation | 10c30e3b47510f10654c57f1d16d4313 | 5 | (project) | REQUIRED — NOT SET (blocker, see below) |

- Status: BUILT. Created sys_db_object via REST; ServiceNow auto-generated the Collection row
  + 6 system fields per table. `create_access_controls=true` set on each (note: this does NOT
  actually generate ACLs on a raw REST insert — 0 ACLs exist; Phase 4 must create them anyway).
- All 33 custom columns verified in sys_dictionary: correct internal_type, max_length, mandatory,
  display, default_value, references and cascade rules. Key attributes:
  - project.name: String 255, mandatory, display, unique=false (per spec).
  - project.area: Reference -> area, mandatory.
  - allocation.project: Reference -> project, mandatory, cascade rule = **Cascade**.
  - allocation.team: Reference -> team, mandatory, cascade rule = **Restrict**.
  - headcount.team: Reference -> team, mandatory, cascade rule = **Restrict**.
  - month (headcount + allocation): Integer, mandatory, choice = "Dropdown without --None--".
  - priority/snow_status/ado_status/type/t_shirt_size: String, choice = "Dropdown with --None--".
  - active (area/team/project): True/False, default_value=true.
  - fte: Decimal (allocation mandatory; headcount optional per spec ">=0" vs ">0").

## Choice lists (sys_choice, scope = app) — 47 rows total, all verified value/label/sequence
- project.priority (5): 0=P0 BAU, 1=P1 High, 2=P2 Medium, 3=P3 Low, 4=P4
- project.snow_status (7), SS_ORDER sequence: approved, screening, qualified, pending, new, completed, canceled
- project.ado_status (4): new, in_progress, done, on_hold
- project.type (2): project, bau
- project.t_shirt_size (5): XS, S, M, L, XL (label=value)
- headcount.month (12): 1..12 = Jan..Dec
- allocation.month (12): 1..12 = Jan..Dec

## Business Rules (sys_script, scope = app, ES2021 const/let, advanced, no current.update())
| BR | Table | When | insert/update | order | sys_id |
|---|---|---|---|---|---|
| BR-01 Validate and normalize allocation | allocation | before | ins+upd | 100 | 87d44afb47510f10654c57f1d16d43a5 |
| BR-02 Zero implies delete | allocation | before | upd only | 110 | 11e40efb47510f10654c57f1d16d43e3 |
| BR-03 Validate headcount | headcount | before | ins+upd | 100 | f3e48efb47510f10654c57f1d16d43c3 |
- BR-01: cap from property max_fte_per_cell (=30); abort if fte<0 or >cap; round to 2dp via
  Math.round(x*100)/100; insert-only duplicate guard on (project,team,year,month) via single
  GlideRecord setLimit(1).
- BR-02: if fte===0 -> addErrorMessage("Use delete...") + setAbortAction(true).
- BR-03: 0<=fte<=999; round 2dp; insert-only duplicate guard on (team,year,month).
- GOTCHA: `create_business_rule` MCP tool created all 3 with action_insert=action_update=FALSE
  (BRs would never fire). Fixed via PATCH on sys_script setting the correct action flags.

## DB indexes (§6.4/§6.5) — NOT CREATED (blocker, see below)
- Required: headcount UNIQUE(team,year,month); allocation UNIQUE(project,team,year,month);
  allocation non-unique(team,year); allocation non-unique(year).

## Verification results (synchronous REST)
- 5 tables exist in scope with correct names/labels. PASS
- 33 custom columns match spec (names, types, mandatory, reference, cascade, choice, display, defaults). PASS
- 47 sys_choice rows match spec exactly. PASS
- BR functional test (created ZZ_TEST area/team/project as valid refs):
  - INSERT allocation fte=2.5 (2026,m1)  -> 201 SUCCESS (baseline valid insert)
  - INSERT allocation fte=-1  (2026,m1)  -> **HTTP 403** (BR-01 range abort)  PASS
  - INSERT allocation fte=3   (2026,m1 DUP) -> **HTTP 403** (BR-01 duplicate guard abort)  PASS
  - INSERT allocation fte=1.5 (2026,m2)  -> 201 SUCCESS (proves 403s are BR aborts, not ACL)
  - INSERT allocation fte=1.555 (2026,m3) -> stored as **1.56** (BR-01 2dp rounding)  PASS
  - NOTE: scoped before-BR setAbortAction(true) surfaces as HTTP 403 Forbidden through the
    Table API (the abort is reported as access-denied). Confirmed it is a BR abort and not an
    ACL block because two other valid inserts on the same table succeeded.
- All test rows (3 allocations + project + team + area) DELETED. All 5 tables confirmed EMPTY
  for Phase 6 seeding. PASS

## BLOCKERS — require manual UI action (cannot be done via REST or script on this PDI)
1. **Auditing on project + allocation NOT enabled.** The "Auditing" toggle writes
   `update_synch=true` to the table's attributes. Could not set it: PATCH to
   `sys_db_object.attributes` reports success but is silently ignored (sys_mod_count stays 0,
   field reads back empty); the Collection dictionary row (where the attribute also lives) is
   403-protected via Table API; and script-based toggle is impossible (sys_trigger jobs never
   claimed). MANUAL FIX: in the platform UI, open each table (project, allocation) ->
   Table definition -> check "Audit" (Controls section / or set attributes update_synch=true).
2. **4 DB indexes NOT created.** `sys_index` is not writable via Table API (403 on both read
   and write); index creation otherwise needs a server-side index-manager script, but
   sys_trigger jobs are not claimed on this PDI. MANUAL FIX (Table -> Database Indexes -> New):
   - headcount: UNIQUE on team, year, month
   - allocation: UNIQUE on project, team, year, month
   - allocation: non-unique on team, year
   - allocation: non-unique on year
   MITIGATION: functional uniqueness for the two unique indexes is already enforced at the
   application layer by BR-01 (allocation) and BR-03 (headcount) duplicate guards, exactly as
   the spec intended ("BR gives a clean gs.addErrorMessage; index alone aborts ugly"). The
   indexes remain needed for performance and as a hard DB-level constraint.

## ATF test suggestions (for Phase 8)
- T03/T04 already exercisable: fte<0, fte>30, duplicate insert all abort (BR-01); fte=0 update
  aborts (BR-02); headcount fte>999 and duplicate abort (BR-03). After indexes are added,
  add an ATF asserting the DB-level unique constraint as defense-in-depth.

---

## Phase 4 — Security / ACL matrix (§8.2)

Tooling: MCP `servicenow-sse` synchronous REST. Scope verified `x_335329_capplan` (active_scope).

### Pre-check
- Queried `sys_security_acl` for capplan ACLs (`nameLIKEx_335329_capplan`, also explicit IN of 5
  tables): **0 found**. The table "Create access controls" option did NOT generate any default
  ACLs for these scoped tables. => Phase 4 is a clean create of all 21 ACLs (no defaults to edit,
  no leftover empty-role ACL to neutralize).
- Roles present: `.user` a3f2cab747510f10654c57f1d16d4328 · `.planner` f7f2cab747510f10654c57f1d16d4395
  · `.admin` 23b28e7747510f10654c57f1d16d43d3.
- Operation sys_ids are literal: read / create / write / delete.

### Intended ACL set (per §8.2 matrix) — 21 total
- area/team/project/headcount: read=.user, create/write/delete=.admin (16 ACLs)
- allocation: read=.user, create/write/delete=.planner (4 ACLs)
- FIELD ACL: `x_335329_capplan_project.comments` write=.planner (1 ACL)
- Record-type, role-based, no scripts. Admin satisfies planner/user-gated ACLs via role
  containment (admin ⊃ planner ⊃ user) — no admin-override scripts added.

### Status: BLOCKED — pushed to operator (MANUAL_STEPS.md §3)
- Type: Access Control (sys_security_acl + sys_security_acl_role)
- Scope: x_335329_capplan
- Status: FAILED via REST → DEFERRED to operator UI
- Notes: `create_record` on `sys_security_acl` returns **HTTP 403 Forbidden** (cross-scope
  system-table protection, same as sys_dictionary/sys_index in Phase 3). Stopped after the first
  4 failed creates (area read/create/write/delete), did NOT retry/spin. Full 21-row operator
  checklist with Type/Operation/Name/Requires-role + field-ACL instructions written to
  tasks/MANUAL_STEPS.md §3, including operation/role sys_ids for an optional admin-run fix script.
- Built at: 2026-06-12

### Verification
- Pre-state verified (0 existing ACLs). Post-creation verification (21 ACLs + role grants) and
  runtime impersonation (T05/T06) DEFERRED — the latter to Phase 8 ATF per instructions. Operator
  creates the ACLs in UI, then the verification queries in MANUAL_STEPS.md §3 confirm.

### ATF test suggestions (Phase 8)
- T05: impersonate .user-only → reads OK, any insert fails (GlideRecordSecure).
- T06: impersonate .planner → allocation CRUD OK; project create/write fails; BUT project.comments
  write succeeds (field ACL); team/area/headcount create fails.
- Admin: full CRUD on all 5 tables via containment.

---

## Phase 5 — Server layer (Script Includes)

Tooling: MCP `servicenow-sse` `create_script_include` (synchronous REST). Scope verified
`x_335329_capplan` (active_scope) before build. Built 2026-06-12. ES2021 runtime — const/let
throughout method bodies; `var ClassName = Class.create()` kept per the spec §9.1 skeleton.

### Components built

## CapacityPlannerService
- Type: Script Include (sys_script_include)
- Scope: x_335329_capplan  | api_name: x_335329_capplan.CapacityPlannerService
- sys_id: **ccb1eafb47550f10654c57f1d16d43aa**
- client_callable: **false** | active: true | access: All application scopes (public) | type: "CapacityPlannerService"
- Status: BUILT (saved without syntax error — SN rejects invalid SI on save; record persisted)
- Implements §9.1 method set with §9.2 payload contract:
  - `getBootstrap(year)` — 3 BULK queries (projects via GlideRecordSecure orderBy name;
    allocations via GlideRecordSecure addQuery(year) orderBy project — single pass fills
    projects[].ta keyed by team sys_id then integer month; headcount via GlideRecord
    addQuery(year) orderBy team). Plus 2 tiny static-reference reads (team, area). NO N+1.
    Returns {year, months[12], teams[{id,name,order}], areas[{id,name,color,badgeBg,badgeFg}],
    choices{priority,snowStatus(SS_ORDER),adoStatus}, headcount{teamId:{1..12}},
    projects[{id,n,a,p,s,ty,sc,snow,ado,ss,as,ig,comments,st,en,ta}]}. Month keys are ints 1–12.
  - `saveAllocation(projectId,teamId,year,month,fte)` — GlideRecordSecure upsert of one cell;
    **fte==0 deletes** the existing row (no-op if none) and returns {ok:true,deleted:true};
    else update/insert returns {ok,sysId}. Role re-check first.
  - `saveAllocations(ops)` — loops saveAllocation, returns {ok, results[]} per-op.
  - `validateTeamForProject(projectId,teamId)` — id validation + existence check, returns team meta.
  - `removeTeamFromProject(projectId,teamId,year)` — deletes all allocations for project+team
    (+year if valid); returns {ok, deleted:count}. Role re-check.
  - `getExportData(year,changes)` — 3 datasets (arrays of row-arrays, header row first), LABELS not codes:
    Sheet1 "Soft & Hard Planning (2)" one row per project×team with the EXACT §11 header
    (Areas, Priority, Tech Team, Type of work, ADO, SNOW, ADO Status, SNOW status, SteerCo Status,
    Projects Name, Initiatives Group, Dependency, T-Shirt Sizing, Start date, End date, Jan..Dec, Comments);
    Sheet2 "Capacity vs Headcount" per-team Allocated/Headcount/Gap rows × 12 months + Total;
    Sheet3 "Change Log" (Project, Tech Team, Month, Original FTE, Updated FTE, Delta) from client deltas.
    Reuses getBootstrap as the single live-data source (still 3 bulk queries).
- Defensive everywhere: id regex `/^[0-9a-f]{32}$/`; parseFloat/parseInt + isNaN guards; month 1–12;
  **planner role re-check on every mutation** (`gs.hasRole('x_335329_capplan.planner')` → error
  'insufficient_role'); cap from property `max_fte_per_cell`; year defaults to `default_year`.
  GlideRecordSecure for all project/allocation reads+writes (denied reads → empty arrays, not throw).
- JSDoc on every public method.

## CapacityPlannerSeedData
- Type: Script Include (sys_script_include), fix-script-style loader class
- Scope: x_335329_capplan  | api_name: x_335329_capplan.CapacityPlannerSeedData
- sys_id: **01e1e23f47550f10654c57f1d16d4343**
- client_callable: **false** | active: true | access: All application scopes (public) | type: "CapacityPlannerSeedData"
- Status: BUILT (NOT RUN — execution is Phase 6 per instructions)
- Implements §12: `load(payload, year)` consumes §12.2 JSON shape
  `{areas, teams, headcount, projects:[{...,allocations:[{team,month,fte}]}]}`.
  Load order Areas→Teams→Projects→Allocations→Headcount. Idempotent natural-key upserts:
  area.name; team.name; project.name+initiatives_group; allocation project+team+year+month;
  headcount team+year+month. Uses **GlideRecord (NOT Secure)** as admin. `gs.info` summary of
  created/updated/skipped per table; **abort-all on >0 hard errors** (returns after each phase if
  errors accumulated). Stray/non-canonical teams logged via gs.warn and SKIPPED (no team created),
  per §12.2. Headcount loader accepts both flat rows and the nested {team:{month:fte}} map.

### Verification — path used: DEFERRED (background scripts still stalled)
- Re-ran the background smoke probe as instructed: scheduled `execute_background_script` writing a
  syslog row source='CAPPLAN_P5', then queried syslog. Trigger b1502e3b... stayed **state=Ready,
  claimed_by empty, next_action in the past, run_count 0**; syslog source=CAPPLAN_P5 = 0 rows.
  => ad-hoc RunScriptJob jobs STILL not being claimed on this PDI (consistent with Phases 2–4).
- Therefore functional smoke (getBootstrap empties, save/delete round-trips) is **DEFERRED to
  Phase 8 ATF (T01–T08)**, which runs through the transaction engine, not sys_trigger.
- Records-saved verification (sys_script_include query, display values): BOTH present in scope
  `x_335329_capplan` / "Capacity Planner", client_callable=false, active=true, correct
  names/api_names/type. Saving succeeded → no syntax error (SN compile-checks SI on save). PASS.
- Probe trigger cleanup `delete_record` on sys_trigger was DENIED by the auto-mode classifier
  (out-of-task shared-resource action). Left in place — it is an expired one-shot and harmless.

### Focused self-review (in lieu of functional smoke)
- **3-query bootstrap:** confirmed — exactly 3 bulk GlideRecord(Secure) queries (projects,
  allocations, headcount) + 2 trivial reference reads (team, area). Allocations & headcount each
  single-pass populate their maps; no per-project/per-team queries (no N+1). Matches §15.
- **GlideRecordSecure:** used for project + allocation reads in getBootstrap and for all
  allocation reads/writes/deletes in saveAllocation/removeTeamFromProject/validateTeamForProject.
  Headcount & team & area are reference reads via plain GlideRecord (read-only, .user-readable).
- **Role re-check:** `_canEdit()` (gs.hasRole planner) gates saveAllocation, saveAllocations,
  removeTeamFromProject — returns {ok:false,error:'insufficient_role'} when absent. Read-only
  getBootstrap/validateTeamForProject correctly do NOT gate (read ACL handles them).
- **fte==0 delete:** saveAllocation rounds fte, and when result===0 deletes the existing row
  (deleteRecord, GlideRecordSecure) returning {ok:true,deleted:true}; no-op if no row exists.
- **Export 3-dataset shape:** getExportData returns {ok, sheet1{name,rows}, sheet2{name,rows},
  sheet3{name,rows}} with sheet names "Soft & Hard Planning (2)" / "Capacity vs Headcount" /
  "Change Log"; sheet1 header matches §11 verbatim; values rendered as LABELS.

### Deviations / notes
- `access` set to "public" (All application scopes) rather than "package private". Rationale:
  the widget server script (Phase 7) and a future Scripted REST API (§3.1) call the service;
  public scoped access is the safe, conventional choice and does not affect client_callable=false.
  Flag for Phase 7 review if the team prefers package-private.
- §11 "Dependency" column has no backing field in the §6 data model → emitted as blank string
  (column position preserved so the header/row arity matches §11 exactly).
- ATF (Phase 8) is the real verification gate for the server layer on this PDI: T01 bootstrap,
  T02 save/upsert/delete, T03 validation, T08 export header — all map directly to these methods.

### Repo source saved
- C:\Users\PLEITE\OneDrive - Unit4\Documents\Scripts\ServiceNowApps\SNCapacityPlanner\src\script_includes\CapacityPlannerService.js
- C:\Users\PLEITE\OneDrive - Unit4\Documents\Scripts\ServiceNowApps\SNCapacityPlanner\src\script_includes\CapacityPlannerSeedData.js

## Phase 6 — Seed data (data migration)
- Type: Data migration (local parse) + Script Include enhancement + REST pre-load of dimensions
- Tables: x_335329_capplan_area, _team (pre-loaded); _project/_allocation/_headcount (operator seed run)
- Scope: x_335329_capplan
- Status: BUILT (load run itself is the operator's synchronous UI step — see MANUAL_STEPS §4)
- Built at: 2026-06-12

### A. seed_2026.json generated (§12.2)
- Parsed FIRST `const RAW_DATA=[...]` (HTML line 544; duplicated 2nd declaration ignored) +
  HEADCOUNT (line 546) + constant maps (AREA_CLR/AREA_CLS/TEAMS/PRI_LBL/SS_*/MONTHS, lines 549-564).
- Local Node parser (brace-matched extraction, no eval) -> seed/seed_2026.json (valid JSON, 132 KB).
- Counts: areas 10, teams 10, projects 99, allocations 779 (fte>0), headcount 120.
- Reconciliation: project count 99; SUM(allocation.fte) 386.75; SUM(headcount.fte) 438.
  Per-team Jan allocation: SALES 9.2, Architecture 1.75, WEB 0.95, AI Engineering 0.6,
  BA-BusinessAnalyst 5.45, ERP 3.5, Integrations 1.3, Internal Apps 0.7, Service Now 5.75, PM 2.2.
- Sanitization: 130 `<openpy` junk dates -> null; 1 dirty t-shirt size ("01.03.2026" on
  "Promotions Project") -> ""; names trimmed + whitespace collapsed + zero-width/NBSP stripped;
  0 Holidays rows (none present); 0 stray teams (the spec-warned "Sharepoint" stray is NOT in the
  first RAW_DATA block's ta maps); multi-value snow_initiative/ado_id kept verbatim (newlines).
- Mappings (§7): snow_status display->value (Approved->approved etc.); ado_status (In Progress->
  in_progress, On Hold->on_hold, Done->done); type (Project->project, BAU->bau); months->ints 1-12;
  YYYY-MM->YYYY-MM-01. Spot-checked 7 projects vs prototype — all correct.
- Migration log: seed/seed_log.md (counts, every sanitization action, recon totals for §12.3).

### B. Synchronous UI run wiring
- Added `loadFromAttachment(fileName, year)` to CapacityPlannerSeedData: reads the JSON attached
  to its own sys_script_include record (sys_id 01e1e23f...4343) via GlideSysAttachment.getContent,
  then delegates to load(). One-paste operator snippet documented in MANUAL_STEPS §4b.
- Repo file updated + pushed to instance via MCP update_script_include (sys_mod_count 1, ok).
- Rationale for UI run: ad-hoc scheduler does not execute on this PDI (sys_trigger never claimed,
  5x confirmed); Scripts-Background runs inline in the operator session. load() already idempotent.

### C. Cheap dimensions pre-loaded via MCP create_record (idempotent: tables were empty)
- 10 areas inserted with name/color/badge_bg/badge_fg/order/active (verified: count=10, colors per §7).
- 10 teams inserted with canonical names/order/active (verified: count=10).
- Projects/allocations/headcount (~1,700 rows) deliberately NOT bulk-inserted via REST — left to the
  operator seed run, which idempotently upserts everything (and re-checks areas/teams as updates).

### D. Operator run documented
- tasks/MANUAL_STEPS.md §4: attach step (4a), Scripts-Background run snippet scoped to Capacity
  Planner (4b) + inline fallback, and §12.3 verification queries (4c) with expected totals.

### Deviations / blockers
- BLOCKER (worked around): could not attach seed_2026.json via REST. The MCP toolset has no
  attachment-upload tool, and no direct PDI Attachment-API basic-auth creds (SN_USER/SN_PASS unset)
  are available. The sys_attachment + sys_attachment_doc chunk-crafting route is impractical
  (gzip+base64 chunking + hash). Resolution: attaching is a one-click UI step (MANUAL_STEPS §4a),
  and loadFromAttachment() consumes it; an inline-paste fallback path is also documented so the
  run is never blocked. seed_2026.json is authoritative and version-controlled in the repo.
- The load run + §12.3 reconciliation are the operator's step; this agent verified everything
  verifiable now (JSON shape/counts, areas+teams loaded, mappings spot-check). No attachment row
  exists yet on the script-include record (will appear after step 4a).

### ATF test suggestions (Phase 8)
- T07 Seed idempotency: run loadFromAttachment twice on a subset -> second run all `u:`/`s:`, 0 created.
- Post-seed data assert: getBootstrap(2026) returns projects.length==99, allocation fte sum 386.75.

### Phase 6 repo artifacts saved
- C:\Users\PLEITE\OneDrive - Unit4\Documents\Scripts\ServiceNowApps\SNCapacityPlanner\seed\seed_2026.json
- C:\Users\PLEITE\OneDrive - Unit4\Documents\Scripts\ServiceNowApps\SNCapacityPlanner\seed\seed_log.md
- C:\Users\PLEITE\OneDrive - Unit4\Documents\Scripts\ServiceNowApps\SNCapacityPlanner\src\script_includes\CapacityPlannerSeedData.js (loadFromAttachment added)
- C:\Users\PLEITE\OneDrive - Unit4\Documents\Scripts\ServiceNowApps\SNCapacityPlanner\tasks\MANUAL_STEPS.md (§4 added)

---

## Phase 7 — Widget & Portal

### cap-planner (sp_widget)
- Type: Service Portal Widget
- Scope: x_335329_capplan (Capacity Planner)
- sys_id: b64866b347950f10654c57f1d16d437e  (id=cap-planner, controller_as=c)
- Status: BUILT
- Notes: All four code fields populated — template (ported prototype body, neutral
  text logo, `.capx` wrapper, no Google Fonts), css (full prototype <style> nested
  under `.capx`, body->flex container height calc(100vh - 50px)), script (thin router
  §9.3 -> CapacityPlannerService, canEdit + role re-checks + id/month/fte validation),
  client_script (near-1:1 vanilla JS port adapted per §10.3). Built via MCP
  create_record + 4x update_record (one per large field). The client_script update
  echo exceeded the tool output cap but the WRITE succeeded (verified via follow-up
  query + grep of the saved tool-result: api.controller / wireEvents / buildXLSX
  present, 0 getElementById).

### Widget dependency -> SheetJS UI Script
- sp_dependency "Capacity Planner SheetJS": 742a2abf47950f10654c57f1d16d4318 (page_load=true)
- m2m_sp_widget_dependency (widget<->dependency): d62a6abf47950f10654c57f1d16d4359
- sp_js_include -> UI Script CapacityPlannerSheetJS (c2ef397f47110f10654c57f1d16d43a5): 2a2a6abf47950f10654c57f1d16d43f9 (source=UI Script)
- Status: BUILT — chain verified end-to-end.

### Portal /cp (sp_portal)
- sys_id: 373a2ebf47950f10654c57f1d16d4334  (url_suffix=cp, title="Capacity Planner", homepage=cap_planner)
- Status: BUILT

### Page cap_planner (sp_page)
- sys_id: e63aeabf47950f10654c57f1d16d4386
- roles: x_335329_capplan.user  (page access restriction per §8/§10.1)
- Layout: sp_container 544a6ebf47950f10654c57f1d16d438a (width=container-fluid, full width)
  -> sp_row ca4aaebf47950f10654c57f1d16d43dd -> sp_column 2b4aeebf47950f10654c57f1d16d43e0
  (size=12) -> sp_instance b95a22ff47950f10654c57f1d16d434b (cap-planner, active=true)
- Status: BUILT

### Grep verification (saved client.js)
- document.getElementById: 0 (only in comments) — all lookups via $el.querySelector
- inline onclick: 0 (only in comments) — delegated $el.addEventListener + data-act/closest
- HTML-escape esc(): 67 call sites — every interpolated user value escaped
- canEdit gating: 15 sites — cell edit / add-remove team / reset hidden unless data.canEdit

### Repo source paths
- src/widget/template.html
- src/widget/style.scss
- src/widget/client.js
- src/widget/server.js

### Deferred (operator)
- Full browser end-to-end verification (5 views, cell persist, slider/filters/kanban/
  heatmap/export, .user read-only) — needs logged-in browser + seed run + ACLs.
  Checklist added to tasks/MANUAL_STEPS.md §6.

### ATF suggestions (for Phase 8)
- T-W1: bootstrap action returns data.bootstrap with teams/areas/choices/headcount/projects.
- T-W2: saveCell as planner upserts; reload bootstrap reflects new fte; as .user -> insufficient_role.
- T-W3: export action returns 3 sheets with §11 headers.
- T-W4: removeTeam deletes all of a team's allocations for the year.

## Phase 6 — Seed data (projects + headcount)

2026-06-13: Loaded 99/99 projects and 120/120 headcount rows into x_335329_capplan_project / x_335329_capplan_headcount via MCP servicenow-sse create_record (direct inserts; PDI scheduler not running). Area/team names mapped to sys_id. 0 skips, 0 failures, no BR-03 rejections. Verified counts (99/120), project area refs + fields, SALES headcount sum=102. COMPLETE. Allocations NOT loaded (separate job).

2026-06-13: Allocations slice projects[33..65] (parallel job). STOPPED INCOMPLETE — MCP write session began returning 403 Forbidden mid-run (reads still OK; net-new rows, not a dedup abort). Slice = 165 alloc rows (idx 35,40,51,53,57,64,65 have 0 allocations). Maps: 99 projects + 10 teams; idx39 "GLT EA´s" and idx47 EOL (non-breaking hyphens) resolved by sys_id; 0 unmapped teams; all fte>0. Inserted 95 (work rows 0-94 = projects idx 33-49 complete). Skipped-as-dup 0, unmapped 0, failures 70 (all 403 Forbidden, work rows 95-164 = projects idx 50,52,54,55,56,58,59,60,61,62,63). Follow-up: re-run from work row 95 (project idx 50); cached work list at C:\Users\PLEITE\.claude\workspace\work.json.
