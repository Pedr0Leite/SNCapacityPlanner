# Capacity Planner — Build Task List

ServiceNow scoped application. Implements the build handbook EXACTLY as written (spec §1–§19). Plan-mode only — no instance artifacts are created until this plan is signed off.

---

## Build Discipline (cross-cutting hard rules — apply to every phase)

- [ ] Use `GlideRecordSecure` for ALL user-context (client-initiated) reads/writes so ACLs are enforced; seed/fix scripts use plain `GlideRecord` as admin only (§8.2, §12.3).
- [ ] No hard-coded `sys_id`s anywhere — lookups by name/property; validate ids with `/^[0-9a-f]{32}$/` (§9.3, §17).
- [ ] All app artifacts (tables, script includes, widget, ACLs, BRs, properties, ATF) created with the **app scope `x_335329_capplan`** selected — captured by the app, NOT an update set (§4).
- [ ] ONLY the SheetJS UI Script (`CapacityPlannerSheetJS`) goes in the **global** update set "Capacity Planner – Global Support 1.0" (§5.2). No other global artifacts unless §5.2 bridge becomes strictly required.
- [ ] HTML-escape EVERY interpolated client value (`String(v).replace(/[&<>"']/g, …)`) — prototype is XSS-unsafe (§10.3).
- [ ] Delegated event listeners only (`$el.addEventListener` + `closest("[data-…]")`); no inline `onclick`; no `document.getElementById` (scope DOM lookups to `$element[0]`) (§10.3, §17).
- [ ] Consistent JS runtime: app set to **ES2021** in Phase 2 → use `const`/`let` everywhere; if runtime stays ES5, use `var` everywhere — NEVER mix (§9.1, §17). [OPEN DECISION — see below]
- [ ] Prefer MCP server **servicenow-sse** for all ServiceNow operations; background scripts run async via `sys_trigger`.
- [ ] Run the phase Verification block BEFORE marking any phase done (§16).
- [ ] Commit to Git at the end of every phase (`feature/phase-<n>` → merge) (§16).
- [ ] No deprecated APIs: no `GlideRecord.getRecord`, no synchronous GlideAjax, no `g_form` in server context, no `current.update()` in BRs (§17).
- [ ] Append any user correction to `tasks/lessons.md` (§16).

### Open decisions requiring user sign-off (resolve before/at Phase 1–7)
- [ ] **Portal target**: deploy `cap_planner` page to existing `/sp` OR a new dedicated `/cp` portal. RECOMMENDATION: new `/cp` portal — clean isolation from Employee Center (`esc`) default and full-width layout control; minimal footprint (§3.2, §10.1).
- [ ] **JS runtime**: ES2021 (recommended, app set to ES2021 in Phase 2, `const`/`let`) vs ES5 (`var`). Must be decided in Phase 2 and held everywhere (§9.1, §6 of risks).
- [ ] **SheetJS hosting approval**: vendor `xlsx.full.min.js` v0.18.5 as a global UI Script (recommended, CSP/offline-safe). Fallback if security review rejects: server-side CSV via `GlideStringUtil` + `sys_attachment` + 3 download links (§11). Needs security sign-off.

---

## Phase 0 — Discovery (COMPLETE)

Resolved facts (do NOT redo this phase):

- [x] Instance: `dev295018.service-now.com` (PDI), Australia release (`glide-australia-02-11-2026 patch2`); release family confirmed Australia (validated down to Xanadu per spec).
- [x] `glide.appcreator.company.code = 335329`.
- [x] **RESOLVED SCOPE: `x_335329_capplan`** — every `<vendor>` placeholder in the spec = `335329`; suffix `capplan` = 7 chars (≤ 18, OK).
- [x] Roles resolved: `x_335329_capplan.user` / `.planner` / `.admin`.
- [x] Service Portal plugin active; default portal is `esc` (Employee Center); spec allows `/sp` or a new `/cp` portal — decision flagged above for sign-off.
- [x] No pre-existing `capplan` scope (clean slate).
- [x] MCP server `servicenow-sse` reachable and is the chosen mode for all ServiceNow ops; background scripts run async via `sys_trigger`.
- [x] Admin credentials available via MCP servicenow-sse; Git repo reachable for Studio source control.

---

## Phase 1 — Global Update Set (§5, §16)

- [ ] Switch application picker to **Global** scope.
- [ ] Create `sys_update_set`: Name = `Capacity Planner – Global Support 1.0`, Description = "All global-scope artifacts supporting the Capacity Planner scoped app. Created per build spec §5.", State = In Progress (§5.1).
- [ ] Make it the **current** update set.
- [ ] Vendor `xlsx.full.min.js` v0.18.5 locally from npm `xlsx@0.18.5` dist (do NOT hot-link / no CDN).
- [ ] Create UI Script `CapacityPlannerSheetJS` (`sys_ui_script`, global) with SheetJS 0.18.5 content; UI Type: Desktop; Global: false (loaded on demand via widget dependency) (§5.2, §16 Phase 1).

### Verification — Phase 1
- [ ] Both customer updates (update set record + UI Script) appear in the `Capacity Planner – Global Support 1.0` set.
- [ ] Export update set XML to `/update-sets/` in the repo.
- [ ] Commit to Git (`feature/phase-1`).

---

## Phase 2 — Application Shell (§4, §8.1, §13, §16)

- [ ] Create scoped app **Capacity Planner**, scope `x_335329_capplan`, version 1.0.0, short description "Project pipeline and team capacity planning (monthly FTE allocation vs headcount)." Runtime access tracking = **Tracking** (not Enforcing yet, per §4).
- [ ] Set app JS runtime to **ES2021** [pending OPEN DECISION sign-off] (§9.1).
- [ ] Link the app to the Git repository (Studio → Source Control); branch naming `feature/phase-<n>` (§4).
- [ ] Create role `x_335329_capplan.user` (read everything; open portal page).
- [ ] Create role `x_335329_capplan.planner` — **contains** `x_335329_capplan.user`.
- [ ] Create role `x_335329_capplan.admin` — **contains** `x_335329_capplan.planner`.
- [ ] Create property `x_335329_capplan.default_year` (integer / default 2026).
- [ ] Create property `x_335329_capplan.max_fte_per_cell` (integer / default 30).
- [ ] Create property `x_335329_capplan.gap_warn_threshold` (string / default 1).

### Verification — Phase 2
- [ ] App appears in the application picker.
- [ ] All 3 roles exist with correct containment (`.planner` ⊃ `.user`; `.admin` ⊃ `.planner`).
- [ ] All 3 properties exist with correct types/defaults.
- [ ] Commit to Git (`feature/phase-2`).

---

## Phase 3 — Data Model (§6, §7, §16)

Create tables in this exact order (all scope `x_335329_capplan`, "Create access controls" ON; auditing ON for `_allocation` and `_project`):

- [ ] Create `x_335329_capplan_area` — fields: `name` (String 100, mandatory, unique, display), `color` (String 7), `badge_bg` (String 7), `badge_fg` (String 7), `order` (Integer), `active` (True/False default true) (§6.1).
- [ ] Create `x_335329_capplan_team` — fields: `name` (String 100, mandatory, unique, display), `order` (Integer), `active` (True/False default true) (§6.2).
- [ ] Create `x_335329_capplan_project` — fields per §6.3: `name` (String 255, mandatory, display, NOT unique), `area` (Reference → `x_335329_capplan_area`, mandatory), `priority` (Choice string), `t_shirt_size` (Choice string), `type` (Choice string), `start_date`/`end_date` (Date, nullable), `steerco_status` (String 100), `snow_initiative` (String 255), `snow_status` (Choice string), `ado_id` (String 100), `ado_status` (Choice string), `initiatives_group` (String 255), `comments` (String 4000), `active` (True/False default true). Auditing ON.
- [ ] Create `x_335329_capplan_headcount` — fields: `team` (Reference → `x_335329_capplan_team`, mandatory, delete restricts), `year` (Integer, mandatory), `month` (Integer 1–12, mandatory, choice Jan–Dec), `fte` (Decimal 2dp, ≥ 0) (§6.4).
- [ ] Create `x_335329_capplan_allocation` — fields: `project` (Reference → `x_335329_capplan_project`, mandatory, cascade delete), `team` (Reference → `x_335329_capplan_team`, mandatory, delete restricted), `year` (Integer, mandatory), `month` (Integer 1–12, mandatory), `fte` (Decimal 2dp, > 0). Auditing ON (§6.5).

Choice lists (`sys_choice`, exact value → label per §7):
- [ ] `project.priority`: `0`→P0 BAU, `1`→P1 High, `2`→P2 Medium, `3`→P3 Low, `4`→P4 (empty=None).
- [ ] `project.snow_status`: `approved`→Approved, `screening`→Screening, `qualified`→Qualified, `pending`→Pending, `new`→New, `completed`→Completed, `canceled`→Canceled (empty=No status). Pipeline order = SS_ORDER.
- [ ] `project.ado_status`: `new`→New, `in_progress`→In Progress, `done`→Done, `on_hold`→On Hold.
- [ ] `project.type`: `project`→Project, `bau`→BAU.
- [ ] `project.t_shirt_size`: XS, S, M, L, XL (label = value).
- [ ] `*.month` (headcount + allocation): `1`..`12` → Jan..Dec (integer choice).

Indexes (mandatory BEFORE seeding, §15):
- [ ] `x_335329_capplan_headcount`: unique index on (team, year, month) (§6.4).
- [ ] `x_335329_capplan_allocation`: unique index on (project, team, year, month); non-unique (team, year); non-unique (year) (§6.5).

Business Rules (all on listed table, scope app, §6.6):
- [ ] BR-01 Validate & normalize — `x_335329_capplan_allocation`, before insert/update, order 100: abort if `fte` < 0 or > `max_fte_per_cell` (30, property-driven); round `fte` to 2dp; abort insert if duplicate (project,team,year,month) via single `GlideRecord` `setLimit(1)`.
- [ ] BR-02 Zero ⇒ delete — `x_335329_capplan_allocation`, before update, order 110: safety net — if `fte == 0`, `setAbortAction(true)` with message "Use delete" (service layer performs the actual delete).
- [ ] BR-03 Headcount guard — `x_335329_capplan_headcount`, before insert/update, order 100: 0 ≤ `fte` ≤ 999; duplicate guard on (team,year,month).

### Verification — Phase 3
- [ ] Background script: insert a test allocation — duplicate insert aborts (BR-01).
- [ ] Background script: insert with `fte = -1` aborts; `fte = 31` aborts (BR-01).
- [ ] Background script: headcount duplicate (team,year,month) aborts (BR-03).
- [ ] Clean up all test rows.
- [ ] Commit to Git (`feature/phase-3`).

---

## Phase 4 — Security (§8.2, §16)

Replace auto-generated table ACLs with the §8.2 matrix (record-type ACLs, role-based, NO scripts), scope app:

- [ ] `x_335329_capplan_area`: read `.user` / create `.admin` / write `.admin` / delete `.admin`.
- [ ] `x_335329_capplan_team`: read `.user` / create `.admin` / write `.admin` / delete `.admin`.
- [ ] `x_335329_capplan_project`: read `.user` / create `.admin` / write `.admin` / delete `.admin`.
- [ ] `x_335329_capplan_project` field ACL: `comments` writable by `.planner`.
- [ ] `x_335329_capplan_headcount`: read `.user` / create `.admin` / write `.admin` / delete `.admin`.
- [ ] `x_335329_capplan_allocation`: read `.user` / create `.planner` / write `.planner` / delete `.planner`.
- [ ] Set portal page `cap_planner` Roles = `x_335329_capplan.user` (page restriction — done at Phase 7 if page not yet created; record intent here) (§8.2, §10.1).

### Verification — Phase 4
- [ ] Impersonation: `.user`-only user — allocation read succeeds, allocation insert via `GlideRecordSecure` fails (ATF T05 early ok).
- [ ] Impersonation: `.planner` — allocation CRUD succeeds, team insert fails (ATF T06 early ok).
- [ ] Impersonation: no-role user — blocked.
- [ ] Commit to Git (`feature/phase-4`).

---

## Phase 5 — Server Layer (§9, §12, §16)

- [ ] Create Script Include `CapacityPlannerService` (app scope, NOT client-callable), implement §9.1 method by method:
  - [ ] `getBootstrap(year)` — returns `{teams, areas, choices, headcount, projects}` per §9.2; build `projects[].ta` and `headcount` with ONE GlideRecord query each (no N+1), `addEncodedQuery("year=…")` + `orderBy("project")`; `GlideRecordSecure` for project/allocation reads; deny → empty arrays + access message; months keyed 1–12 ints.
  - [ ] `saveAllocation(projectId, teamId, year, month, fte)` — upsert one cell; `fte == 0` deletes; returns `{ok, sysId|deleted, error}`.
  - [ ] `saveAllocations(ops)` — array of cell ops in one loop; per-op results.
  - [ ] `validateTeamForProject(projectId, teamId)` — validates ids, returns team meta.
  - [ ] `removeTeamFromProject(projectId, teamId, year)` — deletes allocations for project+team(+year).
  - [ ] `getExportData(year, changes)` — builds 3 export datasets server-side (rows as arrays) per §11.
  - [ ] Every method defensive: id regex `/^[0-9a-f]{32}$/`, `parseInt`/`parseFloat` + `isNaN` guards, month 1–12, role checks on mutations (`gs.hasRole("x_335329_capplan.planner")`).
  - [ ] Set `type: "CapacityPlannerService"`; JSDoc each public method.
- [ ] Create Script Include `CapacityPlannerSeedData` (app scope, fix-script class) per §12 — idempotent upserts by natural key; plain `GlideRecord` as admin; `gs.info` created/updated/skipped summary per table; abort-all on >0 hard errors.

### Verification — Phase 5
- [ ] Background-script smoke call of each `CapacityPlannerService` method against empty tables — all return graceful empties (no errors).
- [ ] Commit to Git (`feature/phase-5`).

---

## Phase 6 — Seed Data (§12, §16)

- [ ] Locally parse `capacity_planner_HTML.html`: take FIRST `const RAW_DATA=[…]` only (ignore duplicated second decl) + `HEADCOUNT` (§12.2).
- [ ] Sanitize: trim/collapse names; drop Holidays/Hollidays rows; map `st`/`en` `YYYY-MM`→`YYYY-MM-01`, junk (`<openpy`)→null; map display statuses → choice values (§7); skip `ta` entries for teams not in the 10 canonical teams (log stray Sharepoint team, do NOT create it).
- [ ] Emit `/seed/seed_2026.json`: `{areas, teams, headcount, projects:[{…fields, allocations:[{team, month, fte}]}]}` with months as ints.
- [ ] Attach `seed_2026.json` to the fix script (`sys_attachment` or inline) and run `CapacityPlannerSeedData` in load order: Areas → Teams → Projects → Allocations → Headcount.
- [ ] Capture created/updated/skipped summary into `tasks/todo.md`.

### Verification — Phase 6
- [ ] Total projects in instance = count in JSON.
- [ ] `SUM(allocation.fte WHERE year=2026)` equals JSON sum within 0.01.
- [ ] Per-team January totals spot-checked against prototype heatmap values.
- [ ] Re-run seed → counts unchanged (idempotent, zero duplicates).
- [ ] Commit to Git (`feature/phase-6`).

---

## Phase 7 — Widget & Portal (§9.3, §10, §11, §16)

- [ ] Create widget `cap-planner` (`sp_widget`, app scope):
  - [ ] HTML template — port prototype `<body>` markup minus `<html>/<head>/<body>` wrappers + Google Fonts link; replace UNIT4 base64 logo with neutral text logo / option-driven image (no third-party branding) (§10.2).
  - [ ] CSS/SCSS — paste full `<style>`, scope every selector under `.capx` wrapper; convert `body{…}` → `.capx` flex container `height: calc(100vh - <portal header>)` (§10.2).
  - [ ] Client controller — port vanilla JS per §10.3: team keys = sys_ids (label via `teamName(id)`), month keys 1–12 ints, DOM lookups via `$element[0]`, `c.server.get` persistence with optimistic UI; HTML-escape interpolated values; delegated listeners; edit affordances gated on `c.data.canEdit`; Reset-all re-fetches bootstrap.
  - [ ] Server script router per §9.3 — thin router to `CapacityPlannerService`; `default_year` from property; every mutating action re-checks `gs.hasRole("x_335329_capplan.planner")` → `insufficient_role`; id regex + NaN/month guards; set `data.canEdit = gs.hasRole("x_335329_capplan.planner")`.
  - [ ] Widget Dependency → JS Include → UI Script `CapacityPlannerSheetJS` (global); include on load (§10.1).
  - [ ] Export to Excel client-side via SheetJS (`aoa_to_sheet`, column widths per prototype, `XLSX.writeFile("<yyyymmdd>_projects_capacity_2026.xlsx")`); 3 sheets per §11; no CDN loader. [Fallback per OPEN DECISION if SheetJS rejected.]
- [ ] Create portal page `cap_planner` (single container, single column, full width) on chosen portal (`/sp` or `/cp` — OPEN DECISION); page roles = `x_335329_capplan.user` (§10.1, §8.2).

### Verification — Phase 7
- [ ] As `.planner`: all 5 views render with seeded data (Overview, Pipeline, Projects, Heatmap, By Team).
- [ ] Edit a cell → reload page → value persisted.
- [ ] Month-range slider, area/priority/team filters, kanban board, heatmap modes (Capacity + Allocation), export workbook (3 sheets, correct headers per §11) all behave.
- [ ] As `.user`: read-only — no editing affordances visible.
- [ ] Commit to Git (`feature/phase-7`).

---

## Phase 8 — ATF (§14, §16)

Build suite **Capacity Planner Regression** with tests:

- [ ] T01 Service bootstrap — `getBootstrap(2026)`: assert `teams.length == 10`, `projects.length > 0`, headcount has 12 keyed months for a known team.
- [ ] T02 Save cell upsert — `saveAllocation(p,t,2026,1,0.5)` creates; `0.7` updates same sys_id; `0` deletes; count returns to baseline.
- [ ] T03 Validation — `fte=-1` and `fte=31` rejected (`ok=false`); `month=13` rejected; bad sys_id rejected.
- [ ] T04 Duplicate guard — direct GlideRecord insert of duplicate (project,team,year,month) aborted by BR-01.
- [ ] T05 ACL user role — impersonate `.user`: allocation insert via `GlideRecordSecure` fails; read succeeds.
- [ ] T06 ACL planner — impersonate `.planner`: allocation CRUD succeeds; team insert fails.
- [ ] T07 Seed idempotency — run seed twice on test subset; counts unchanged second run.
- [ ] T08 Export data — `getExportData(2026, [])` returns 3 arrays; sheet-1 header matches §11 exactly.

### Verification — Phase 8
- [ ] Full suite runs green.
- [ ] Suite scheduled in test environments only.
- [ ] Commit to Git (`feature/phase-8`).

---

## Phase 9 — Close-out (§9, §16)

- [ ] Set the global update set `Capacity Planner – Global Support 1.0` to **Complete**; export XML to `/update-sets/` in repo.
- [ ] Publish app version 1.0.0 to the app repo (or export app as XML for the customer's pipeline).
- [ ] Write `README.md`: architecture summary, seed re-run instructions, export design decision (SheetJS vs CSV fallback), known limitations (§19).
- [ ] Final review against Definition of Done (§18); add review section to `tasks/todo.md`.

### Verification — Phase 9
- [ ] Global update set contains ONLY §5.2 artifacts (ideally just the SheetJS UI Script).
- [ ] App + update set both exported to Git.
- [ ] Commit to Git (`feature/phase-9`).

---

## Definition of Done (§18 — final acceptance checklist)

- [ ] All five views functionally equivalent to the prototype against live table data (side-by-side on 5 sample projects, heatmap totals, kanban counts).
- [ ] Cell edits persist across sessions and users; concurrent edit of the same cell is last-write-wins without error.
- [ ] Role matrix enforced (verified by impersonation + ATF).
- [ ] Export workbook opens in Excel with 3 correctly named/structured sheets.
- [ ] Seed reconciliation passed; re-run produces zero duplicates.
- [ ] ATF suite green; no errors in syslog (source = app scope) during a full manual regression pass.
- [ ] Global update set contains only §5.2 artifacts; app contains everything else; both exported to Git.

---

## Phase 9 — Definition of Done review (§18) — automated-build assessment

Status key: done/verified · BUILT(needs operator UI run) · SPEC(specified for operator) · MCP(pending reconnect)

- BUILT **Five views functionally equivalent to prototype** — widget fully ported & structurally verified (no getElementById, no inline onclick, 67 HTML-escapes, delegated listeners, canEdit gating, $element-scoped DOM). Side-by-side browser check = operator (MANUAL_STEPS §6) after seed + ACLs.
- BUILT **Cell edits persist across sessions; last-write-wins** — server saveAllocation upsert + optimistic UI + reload-persist path built; browser confirm = operator.
- SPEC **Role matrix enforced** — ACL matrix specified (MANUAL_STEPS §3, needs security_admin UI); BR aborts already verified live; runtime proof = ATF T05/T06.
- BUILT **Export workbook, 3 sheets** — client SheetJS + server getExportData (3 datasets, §11 headers); T08 asserts header exactness; Excel open = operator.
- BUILT **Seed reconciliation; zero-dup re-run** — seed_2026.json independently validated locally (projects 99, alloc fte 386.75, headcount 438, months valid ints, teams canonical); idempotent loader built; instance load + reconcile = operator (MANUAL_STEPS §4).
- MCP/BUILT **ATF suite green; no app-scope syslog errors** — T01–T08 step scripts authored (src/atf/); record creation pending MCP; run = operator (MANUAL_STEPS §7).
- MCP **Global update set contains only §5.2 artifacts; both exported to Git** — only SheetJS UI Script intentionally global; scoped artifacts captured by app package; complete + XML export to /update-sets/ pending MCP reconnect.

### Remaining to fully close
1. (MCP) Create ATF suite + 8 tests from src/atf/.
2. (MCP) Complete global update set, export XML to /update-sets/, confirm it holds only the SheetJS UI Script; export/publish app v1.0.0.
3. (Operator UI) MANUAL_STEPS §1–§4, §6–§7.

### Environment constraints encountered (immovable, not defects)
- MCP integration user -> HTTP 403 on protected system tables (sys_dictionary, sys_index, sys_security_acl): forces auditing, indexes, ACLs to UI.
- PDI ad-hoc job scheduler never executes MCP-scheduled sys_trigger jobs (confirmed 6x): forces seed run + ATF run to a UI session.
- MCP SSE session dropped during a session-limit pause: blocks remaining instance writes until /mcp reconnect.
