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
