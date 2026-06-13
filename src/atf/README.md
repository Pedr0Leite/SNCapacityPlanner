# ATF Suite — "Capacity Planner Regression"

Step script bodies for the 8 regression tests (spec §14). These are authored
locally; the ATF *records* are created in the instance (Studio → Automated Test
Framework, scope = Capacity Planner) and the suite is **run from the browser ATF
runner** by the operator — ATF cannot run headless via the MCP Table API, and
this PDI's background scheduler does not execute ad-hoc jobs.

## Prerequisites before running
1. Seed loaded (MANUAL_STEPS §4) — T01/T02/T03/T04/T07/T08 need real project+team rows.
2. ACL matrix created (MANUAL_STEPS §3) — T05/T06 assert ACL enforcement.
3. ATF enabled on the instance: property `sn_atf.runner.enabled = true`
   (sub-prod only; never enable ATF execution on production).
4. Two test users for T05/T06:
   - `capplan_user_test` — granted ONLY `x_335329_capplan.user`
   - `capplan_planner_test` — granted ONLY `x_335329_capplan.planner`

## Test composition
| Test | Steps | Script body |
|------|-------|-------------|
| T01 | 1× Run Server Side Script | `T01_bootstrap.js` |
| T02 | 1× Run Server Side Script | `T02_save_cell_upsert.js` |
| T03 | 1× Run Server Side Script | `T03_validation.js` |
| T04 | 1× Run Server Side Script | `T04_duplicate_guard.js` |
| T05 | Impersonate `capplan_user_test` → Run Server Side Script | `T05_acl_user.js` |
| T06 | Impersonate `capplan_planner_test` → Run Server Side Script | `T06_acl_planner.js` |
| T07 | 1× Run Server Side Script | `T07_seed_idempotency.js` |
| T08 | 1× Run Server Side Script | `T08_export_data.js` |

Each "Run Server Side Script" step: paste the file body verbatim. The step
provides `outputs, steps, params, stepResult, assertEqual`; the body calls
`stepResult.setSuccess()` / `setFailed()` with a diagnostic message.

Add all 8 tests to a Test Suite named **Capacity Planner Regression** and run the
suite. Capture PASS/FAIL into `tasks/todo.md` Phase 8 verification.

> Note: tests use isolated years (2097–2099) for mutation so they never disturb
> seeded 2026 data, and clean up after themselves.
