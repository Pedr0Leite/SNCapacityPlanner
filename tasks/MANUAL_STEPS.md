# Capacity Planner — Operator Manual Steps (UI only)

These items cannot be done via the MCP REST Table API on this instance — the
integration user gets **HTTP 403** writing to `sys_dictionary`, `sys_index`,
and the `sys_db_object` collection attributes (cross-scope system-table
protection). Per build spec §16, the operator performs these in Studio/UI.
None of them block Phases 4–7; functional uniqueness is already enforced by
the duplicate-guard Business Rules (BR-01, BR-03).

## 1. Table auditing (spec §6 — required)
In **System Definition → Tables** (or Studio), open each table and tick
**Controls → Audit = true**:
- [ ] `x_335329_capplan_project`
- [ ] `x_335329_capplan_allocation`

## 2. Database indexes (spec §6.4 / §6.5 — "mandatory before seeding")
Table → **Database Indexes → New** on each table:
- [ ] `x_335329_capplan_headcount` — **UNIQUE** on (team, year, month)
- [ ] `x_335329_capplan_allocation` — **UNIQUE** on (project, team, year, month)
- [ ] `x_335329_capplan_allocation` — non-unique on (team, year)
- [ ] `x_335329_capplan_allocation` — non-unique on (year)

> ponytail: indexes are a perf/integrity belt-and-braces; BR-01/BR-03 already
> abort duplicates with a clean message. Add the indexes before the dataset
> grows past a few thousand allocation rows. Seeding ~1,500 rows works without
> them but the unique indexes are the durable safety net.

## 3. ACL matrix (spec §8.2 — Phase 4) — BLOCKED via REST (HTTP 403)

`sys_security_acl` (and `sys_security_acl_role`) **403 on REST write** for the
integration user on this PDI — same cross-scope system-table protection as
sys_dictionary/sys_index. Verified 2026-06-12: 0 capplan ACLs exist (the
"Create access controls" table option did **not** generate any defaults for
these scoped tables), so the operator creates all 21 ACLs fresh in the UI.

**How to create each (Studio → scoped app, or System Security → Access Control (ACL)):**
New ACL → **Type = record**, **Operation = <op>**, **Name = <table>** (leave the
field/column box blank for record-type), **Active = true**, **Script empty**
(role-based, no script per §8.2). Save, then in the **Requires role** related
list add the role from the matrix. Ensure scope = `x_335329_capplan`.
Do NOT set Admin overrides scripts; rely on role containment
(admin ⊃ planner ⊃ user) so admin satisfies planner/user-gated ACLs implicitly.

### Record-type ACLs (20)

| # | Name (Type=record) | Operation | Requires role |
|---|---|---|---|
| 1 | `x_335329_capplan_area` | read | `x_335329_capplan.user` |
| 2 | `x_335329_capplan_area` | create | `x_335329_capplan.admin` |
| 3 | `x_335329_capplan_area` | write | `x_335329_capplan.admin` |
| 4 | `x_335329_capplan_area` | delete | `x_335329_capplan.admin` |
| 5 | `x_335329_capplan_team` | read | `x_335329_capplan.user` |
| 6 | `x_335329_capplan_team` | create | `x_335329_capplan.admin` |
| 7 | `x_335329_capplan_team` | write | `x_335329_capplan.admin` |
| 8 | `x_335329_capplan_team` | delete | `x_335329_capplan.admin` |
| 9 | `x_335329_capplan_project` | read | `x_335329_capplan.user` |
| 10 | `x_335329_capplan_project` | create | `x_335329_capplan.admin` |
| 11 | `x_335329_capplan_project` | write | `x_335329_capplan.admin` |
| 12 | `x_335329_capplan_project` | delete | `x_335329_capplan.admin` |
| 13 | `x_335329_capplan_headcount` | read | `x_335329_capplan.user` |
| 14 | `x_335329_capplan_headcount` | create | `x_335329_capplan.admin` |
| 15 | `x_335329_capplan_headcount` | write | `x_335329_capplan.admin` |
| 16 | `x_335329_capplan_headcount` | delete | `x_335329_capplan.admin` |
| 17 | `x_335329_capplan_allocation` | read | `x_335329_capplan.user` |
| 18 | `x_335329_capplan_allocation` | create | `x_335329_capplan.planner` |
| 19 | `x_335329_capplan_allocation` | write | `x_335329_capplan.planner` |
| 20 | `x_335329_capplan_allocation` | delete | `x_335329_capplan.planner` |

### Field-level ACL (1) — §8.2 exception

| # | Name (Type=record) | Operation | Requires role |
|---|---|---|---|
| 21 | `x_335329_capplan_project.comments` | write | `x_335329_capplan.planner` |

> Field ACL #21: New ACL → Type = record, Operation = write, Name = select
> table `Project [x_335329_capplan_project]` then **Field = comments**, Active =
> true, Requires role `x_335329_capplan.planner`. This lets planners edit the
> `comments` field even though the table-level write ACL (#11) requires admin —
> ServiceNow field-level write is granted if EITHER the field ACL OR (no field
> ACL → table ACL) passes; here the explicit field ACL grants planner write to
> comments only. Admins still write all fields via containment.

### Operation/role sys_ids (for scripted creation if operator prefers a fix script run as admin in UI)
- Operations are literal sys_ids: `read`, `create`, `write`, `delete`.
- Roles: `.user` = `a3f2cab747510f10654c57f1d16d4328` ·
  `.planner` = `f7f2cab747510f10654c57f1d16d4395` ·
  `.admin` = `23b28e7747510f10654c57f1d16d43d3`.
- Table scope sys_scope = `e0a1423347510f10654c57f1d16d43f1`.

### Verification after operator creates them (re-run from this agent or UI)
- `sys_security_acl` query `nameLIKEx_335329_capplan` → expect 21 active record ACLs.
- For each, the **Requires role** related list (`sys_security_acl_role`) holds
  exactly the role from the matrix above.
- Runtime impersonation (T05 .user read-only / T06 .planner allocation CRUD)
  is DEFERRED to Phase 8 ATF — do not attempt impersonation via REST.

## 4. Phase 6 — run the seed  (spec §12)

**Why this is a manual UI step:** the ad-hoc background/fix-script scheduler does
NOT execute on this PDI (`sys_trigger` jobs are never claimed — confirmed 5×), so
the seed cannot be triggered via MCP `execute_background_script` / `run_fix_script`.
**Scripts - Background runs synchronously in the operator's own session**, so the
whole load completes inline and prints its summary. That is the supported path here.

Pre-loaded already (via MCP REST, idempotent — do not redo): the **10 areas** and
**10 teams** exist. The seed run below re-checks them (upserts, 0 dupes) and then
loads the **99 projects, 779 allocations, 120 headcount rows**.

### 4a. Attach the dataset to the seed Script Include (one-time, UI)
The runner reads the JSON from an attachment on its own script-include record
(no scheduler, no 132 KB paste).

1. Navigate to **System Definition → Script Includes →** `CapacityPlannerSeedData`
   (sys_id `01e1e23f47550f10654c57f1d16d4343`).
2. Use the **paperclip (Manage Attachments)** in the form header → **Choose / drag**
   the repo file **`seed/seed_2026.json`** (from
   `…\SNCapacityPlanner\seed\seed_2026.json`). Keep the file name **`seed_2026.json`**.
3. Confirm the attachment shows on the record.

> Note: this attach step is UI-only because (a) the MCP toolset exposes no
> attachment-upload tool and (b) no direct PDI Attachment-API credentials are
> available to this agent. The file content is authoritative and version-controlled
> in the repo.

### 4b. Run the seed — Scripts - Background (scope = Capacity Planner)
Open **System Definition → Scripts - Background**. At the top, set
**"Run script in scope" = Capacity Planner (`x_335329_capplan`)**. Paste and run:

```javascript
// Capacity Planner — Phase 6 seed. Synchronous; ~1,700 upserts. Idempotent.
var seeder = new x_335329_capplan.CapacityPlannerSeedData();
var result = seeder.loadFromAttachment('seed_2026.json', 2026);
gs.info('SEED RESULT: ' + JSON.stringify(result));
```

Expect in the output / system log a summary line like:

```
[CapacityPlannerSeedData] Summary (ok=true): x_335329_capplan_area{c:0,u:10,s:0}
  x_335329_capplan_team{c:0,u:10,s:0} x_335329_capplan_project{c:99,u:0,s:0}
  x_335329_capplan_allocation{c:779,u:0,s:0} x_335329_capplan_headcount{c:120,u:0,s:0}
```

(areas/teams show `u:10` because they were pre-loaded; projects/allocations/headcount
show `c:` on first run. A second run shows everything as `u:` — idempotent, 0 dupes.)

#### Inline fallback (only if attaching is not possible)
`loadFromAttachment` is just a thin wrapper over `load(jsonStringOrObject, year)`.
If you cannot attach the file, open `seed/seed_2026.json`, copy its entire contents,
and run instead:

```javascript
var SEED = /* paste the full contents of seed_2026.json here */ ;
var seeder = new x_335329_capplan.CapacityPlannerSeedData();
gs.info('SEED RESULT: ' + JSON.stringify(seeder.load(SEED, 2026)));
```

### 4c. §12.3 verification queries (run after the seed, scope = Capacity Planner)
Paste into Scripts - Background and confirm against the JSON reconciliation totals
in `seed/seed_log.md` (projects **99**, allocation FTE sum **386.75**,
headcount FTE sum **438**).

```javascript
// §12.3 reconciliation
var YR = 2026;

// 1) total projects == JSON count (99)
var gp = new GlideAggregate('x_335329_capplan_project');
gp.addAggregate('COUNT'); gp.query(); gp.next();
gs.info('projects = ' + gp.getAggregate('COUNT') + ' (expect 99)');

// 2) SUM(allocation.fte WHERE year=2026) within 0.01 of 386.75
var ga = new GlideAggregate('x_335329_capplan_allocation');
ga.addQuery('year', YR);
ga.addAggregate('SUM', 'fte'); ga.query(); ga.next();
gs.info('allocation fte sum = ' + ga.getAggregate('SUM', 'fte') + ' (expect 386.75 +/- 0.01)');

// 3) headcount sum (expect 438) + per-team January allocation spot-check
var gh = new GlideAggregate('x_335329_capplan_headcount');
gh.addQuery('year', YR);
gh.addAggregate('SUM', 'fte'); gh.query(); gh.next();
gs.info('headcount fte sum = ' + gh.getAggregate('SUM', 'fte') + ' (expect 438)');

// per-team January (month=1) allocation totals — compare to seed_log.md table
var gj = new GlideAggregate('x_335329_capplan_allocation');
gj.addQuery('year', YR);
gj.addQuery('month', 1);
gj.addAggregate('SUM', 'fte');
gj.groupBy('team');
gj.query();
while (gj.next()) {
  gs.info('Jan ' + gj.team.getDisplayValue() + ' = ' + gj.getAggregate('SUM', 'fte'));
}
// Expected Jan totals: SALES 9.2, Architecture 1.75, WEB 0.95, AI Engineering 0.6,
// BA-BusinessAnalyst 5.45, ERP 3.5, Integrations 1.3, Internal Apps 0.7,
// Service Now 5.75, PM 2.2
```

PASS criteria: projects == 99; allocation FTE sum within 0.01 of 386.75;
headcount sum == 438; per-team Jan totals match the seed_log.md table.

## 6. Phase 7 — Widget browser verification (DEFERRED — needs a logged-in browser)

The widget, `/cp` portal, `cap_planner` page, sp_instance and the SheetJS
dependency are all built and structurally verified via REST (see dev-log.md
Phase 7). The following are end-to-end checks that REST cannot perform — they
require a real browser session AND prerequisites below. Spec §16 Phase 7 verify
list + Definition of Done §18.

**Prerequisites (must be done first):**
- [ ] Operator has run the seed (`CapacityPlannerSeedData`) so projects +
      allocations exist (areas/teams are already loaded; without the seed the
      widget renders but Pipeline/Projects/Heatmap are empty).
- [ ] ACL matrix applied (MANUAL_STEPS §3) — otherwise `GlideRecordSecure`
      reads in the service return empty arrays and the widget shows no data.
- [ ] Test users exist: one with `x_335329_capplan.planner`, one with only
      `x_335329_capplan.user`.

**Browser checks — open `https://dev295018.service-now.com/cp` (homepage = cap_planner):**
- [ ] Page loads; widget renders inside the `.capx` container; no console
      errors; SheetJS (`XLSX`) is present on `window` (dependency loaded).
- [ ] All 5 views render with seeded data: **Overview** (KPI cards, by-area
      cards, project table with sparklines), **Pipeline** (kanban columns in
      SS_ORDER with per-column FTE footers), **Projects** (sidebar list +
      detail card + allocation grid), **Heatmap** (Capacity mode: Alloc/HC/Gap
      rows with green/amber/red gap colors; Allocation mode: blue intensity),
      **By Team** (team cards + per-team detail table).
- [ ] As **planner**: click an allocation cell → edit → Enter → toast "Saved";
      **reload the page** → the new value persists (server round-trip OK).
- [ ] As planner: zero a cell → row total drops, value cleared (delete path).
- [ ] As planner: Add team / Remove team (with confirm) work and persist.
- [ ] Two-thumb **month slider** restricts every view's aggregation; Reset
      restores Jan–Dec.
- [ ] Sidebar + Overview + Pipeline **filters** (area, priority, team, SNOW
      multi-select, search) all narrow the lists; SNOW dropdown opens/closes.
- [ ] **Export to Excel** downloads `<yyyymmdd>_projects_capacity_2026.xlsx`
      that opens in Excel with 3 sheets: "Soft & Hard Planning (2)",
      "Capacity vs Headcount", "Change Log" — headers per spec §11; Change Log
      lists the cells edited this session with Original/Updated/Delta.
- [ ] As **.user only** (no planner): NO edit affordances — no cell editing,
      no Add/Remove team, no fill-row, no Reset-all; export still works
      (read-only aggregation). A save attempt (if forced) returns
      `insufficient_role`.
- [ ] XSS spot-check: a project whose name/comments contain `<`, `>`, `&`, `"`
      renders as literal text (HTML-escaped), not interpreted markup.
- [ ] Confirm no syslog errors (source = app scope) during a full pass.

> Note: the portal header height in `style.scss` is `calc(100vh - 50px)`. If the
> `/cp` portal uses a taller/shorter header the bottom of the widget may clip or
> leave a gap — adjust the 50px in the widget CSS if needed (cosmetic only).
