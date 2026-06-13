# Capacity Planner — Bugs & Remaining Work to a Fully-Working `/cp`

Snapshot: 2026-06-13. Instance `dev295018`, scope `x_335329_capplan`, portal
`https://dev295018.service-now.com/cp`.

**Why the portal looked empty:** the project/allocation/headcount tables were
empty (the seed never ran — the PDI's background-job scheduler doesn't execute
ad-hoc jobs via MCP). Data is now being loaded directly via REST. As of this
snapshot: **areas 10, teams 10, projects 99, headcount 120, allocations 560/779**.
A second, independent blocker (ACLs) is described in P1-2 below.

Current data state to confirm before/after fixes (run in Scripts - Background, scope = Capacity Planner):
```javascript
['area','team','project','headcount','allocation'].forEach(function(t){
  var g=new GlideRecord('x_335329_capplan_'+t); g.query();
  gs.info('count '+t+' = '+g.getRowCount());
});
var a=new GlideAggregate('x_335329_capplan_allocation'); a.addQuery('year',2026);
a.addAggregate('SUM','fte'); a.query(); a.next();
gs.info('alloc fte sum = '+a.getAggregate('SUM','fte')+' (target 386.75)');
```

---

## P1 — Blockers preventing the portal from working for a normal user

### P1-1. Allocations incomplete — 560 of 779 loaded (~219 missing)
- **Effect:** Overview totals, Heatmap, By-Team utilisation and per-project grids
  are under-populated; FTE sums won't reconcile (currently < 386.75).
- **Cause:** bulk REST load was interrupted by session + monthly-spend limits.
- **Fix (recommended, one shot, free of agent cost):** attach `seed/seed_2026.json`
  to the `CapacityPlannerSeedData` Script Include and run it in **Scripts -
  Background** — see `tasks/MANUAL_STEPS.md §4`. The loader is **idempotent**
  (BR-01 dedup), so it inserts only the ~219 missing rows and touches nothing else.
- **Alt fix:** re-run the REST allocation loaders (each row re-attempt is dedup-safe).
- **Verify:** `SUM(allocation.fte where year=2026)` == **386.75 ± 0.01**; allocation
  row count == **779**.

### P1-2. ACL matrix missing — non-admin users see an empty widget
- **Effect:** The widget server uses `GlideRecordSecure` (correct, per spec §8).
  With **zero ACLs** on the scoped tables, a non-admin user — *even one holding
  `x_335329_capplan.user`, which is required just to open the page* — fails the
  read check, so `getBootstrap` returns empty `projects`/`allocations` arrays and
  the portal renders blank. An **admin** bypasses ACLs and sees data, which can
  mask this during testing.
- **Cause:** `sys_security_acl` cannot be written via REST without `security_admin`
  UI elevation (HTTP 403). 0 capplan ACLs currently exist.
- **Fix:** create the 21 ACLs in the UI — `tasks/MANUAL_STEPS.md §3` (full matrix
  + sys_ids).
- **Verify:** impersonate a user with only `x_335329_capplan.user`, open `/cp` →
  the 5 views populate (read-only, no edit affordances). A `.planner` user can
  edit cells.

---

## P2 — Data integrity / spec compliance (operator UI; not user-visible blockers)

### P2-1. Table auditing OFF on `project` + `allocation` (spec §6)
- REST PATCH of the audit attribute is ignored (cross-scope protection).
- **Fix:** `MANUAL_STEPS.md §1` (tick Audit on both tables).

### P2-2. Database indexes missing (spec §6.4/§6.5)
- 4 indexes (incl. the two UNIQUE ones) couldn't be created (`sys_index` 403).
  Uniqueness is currently enforced only by BR-01/BR-03 duplicate guards (works,
  but no DB-level guarantee or query index).
- **Fix:** `MANUAL_STEPS.md §2`.

---

## P3 — Testing not runnable headless

### P3-1. ATF step records not created
- Suite "Capacity Planner Regression" + 8 test shells exist, but
  `sys_atf_test_step` returns HTTP 400 via REST — steps must be added in the UI.
- Step script bodies are authored in `src/atf/T01–T08`.
- **Fix:** `MANUAL_STEPS.md §7 / §7.1`. Also create test users `capplan_user_test`
  (only `.user`) and `capplan_planner_test` (only `.planner`) for T05/T06.
- **Run:** ATF runs only from the browser ATF runner (enable `sn_atf.runner.enabled`).

---

## Browser-only verification (I have no browser/computer-use tool — operator must do)

Open `/cp` (as admin first, then as a `.planner` and a `.user`) and confirm
against `tasks/MANUAL_STEPS.md §6`:
- Widget renders inside `.capx`; **no JavaScript errors in the browser console**
  (a client render exception would blank the whole widget — this is the main
  thing I could not verify without a browser).
- 5 views populate; cell edit persists across reload; zero-deletes; add/remove
  team; month slider; filters (incl. SNOW multi-select); 3-sheet Excel export;
  `.user` is read-only; XSS spot-check on a project name with `<>&"`.

---

## Other notes / lower-confidence items to watch during the browser test

- **Widget CSS height** `calc(100vh - 50px)` in `src/widget/style.scss` assumes a
  ~50px portal header; the `/cp` header may differ → bottom clip or gap (cosmetic).
- **Update set XML export to `/update-sets/`** (spec §9 close-out) still pending —
  the SheetJS payload is ~881 KB and serializing it via REST is fragile; do the
  one-click **Export to XML** from the update set in the UI and save to the repo.
  The update set itself is already **Complete** and contains only the SheetJS
  UI Script (hygiene verified).
- **App export/publish v1.0.0** (spec §9) — operator action via Studio / app repo.
