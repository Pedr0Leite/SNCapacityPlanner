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
