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
